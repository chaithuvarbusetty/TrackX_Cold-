"""
Telemetry Service: Coordinates ingestion, validation, processing, rules, AI,
persistence, and real-time WebSocket distribution.
"""

import asyncio
from datetime import datetime, timezone
from typing import Dict, Any, Optional

from ..models import (
    RawTelemetryPacket,
    EnrichedTelemetryResponse,
    GPSCoordinates,
    TemperatureReading,
    IMUData,
    PowerAndNetwork
)
from ..processors.speed_calculator import SpeedCalculator
from ..rules.rule_engine import DeterministicRuleEngine
from ..ai.ai_engine import AIEngine
from ..storage import store
from ..database import db_get_device, db_add_device, db_save_telemetry
from ..trip_engine import trip_engine
from ..notifications import notifications
from ..api.websocket import manager
from .geocoding_service import GeocodingService
from .geofence_service import GeofenceService



class TelemetryService:
    """Service layer managing the end-to-end lifecycle of telemetry packets."""

    @classmethod
    async def process_and_broadcast_packet(
        cls, 
        packet: RawTelemetryPacket,
        raw_payload: Optional[Dict[str, Any]] = None
    ) -> EnrichedTelemetryResponse:
        """
        Evaluates deterministic rules, executes AI predictive models,
        persists to database, and broadcasts to connected clients.
        """
        # 1. Automatically populate temperature thresholds if missing
        if packet.temperature.target_min_c is None or packet.temperature.target_max_c is None:
            dev = db_get_device(packet.device_id)
            if dev:
                packet.temperature.target_min_c = dev.get("target_min_c", 2.0)
                packet.temperature.target_max_c = dev.get("target_max_c", 8.0)
            else:
                packet.temperature.target_min_c = 2.0
                packet.temperature.target_max_c = 8.0

        # 2. Evaluate Layer-1 deterministic safety rules
        alerts = DeterministicRuleEngine.evaluate(packet)

        # 3. Execute Layer-2 AI Intelligence models
        ai_insights = AIEngine.evaluate(packet)

        # 4. Construct enriched telemetry response
        enriched = EnrichedTelemetryResponse(
            device_id=packet.device_id,
            timestamp=packet.timestamp,
            raw_telemetry=packet,
            layer1_deterministic_alerts=alerts,
            layer2_ai_intelligence=ai_insights
        )

        # 5. Save to in-memory cache
        store.insert(enriched)

        # 6. Persist to SQLite database
        try:
            db_save_telemetry(enriched.model_dump(mode="json"))
        except Exception as e:
            print(f"Database persist warning: {e}")

        # 7. Process automated trip segmentation
        try:
            trip_engine.process_telemetry(packet)
        except Exception as e:
            print(f"Trip engine warning: {e}")

        # 7b. Real telemetry-driven Geofence Engine evaluation
        geofence_eval = {"geofences": [], "events": []}
        try:
            geofence_eval = GeofenceService.evaluate_telemetry({
                "device_id": packet.device_id,
                "latitude": packet.gps.lat if packet.gps else None,
                "longitude": packet.gps.lng if packet.gps else None,
                "accuracy_m": (raw_payload or {}).get("location_accuracy"),
                "speed_kmh": packet.gps.speed_kmh if packet.gps else 0.0,
                "temperature": packet.temperature.cargo_temp_c if packet.temperature else None,
                "timestamp": packet.timestamp
            })
        except Exception as e:
            print(f"Geofence evaluation warning: {e}")

        # 8. Asynchronously dispatch alerts
        if alerts:
            for alt in alerts:
                asyncio.create_task(notifications.dispatch_alert(
                    device_id=packet.device_id,
                    alert_name=alt.rule_name,
                    message=alt.message,
                    severity=alt.severity,
                    details={
                        "lat": packet.gps.lat,
                        "lng": packet.gps.lng,
                        "cargo_temp_c": packet.temperature.cargo_temp_c if packet.temperature else None,
                        "threshold_min": packet.temperature.target_min_c if packet.temperature else 2.0,
                        "threshold_max": packet.temperature.target_max_c if packet.temperature else 8.0,
                    }
                ))

        # 9. Resolve rich human-readable location, landmark, and geofence
        location_ctx = GeocodingService.resolve_location(
            device_id=packet.device_id,
            lat=packet.gps.lat if packet.gps else None,
            lng=packet.gps.lng if packet.gps else None,
            accuracy_m=(raw_payload or {}).get("location_accuracy"),
            speed_kmh=packet.gps.speed_kmh if packet.gps else 0.0,
            timestamp=packet.timestamp
        )
        store.set_location_context(packet.device_id, location_ctx)

        # 10. Real-time broadcast to browser WebSockets
        broadcast_data = enriched.model_dump(mode="json")
        broadcast_data["raw_payload"] = raw_payload or store.get_raw_payload(packet.device_id)
        broadcast_data["location_context"] = location_ctx
        broadcast_data["geofence_status"] = geofence_eval.get("geofences", [])
        broadcast_data["geofence_events"] = geofence_eval.get("events", [])
        broadcast_data["is_online"] = True
        broadcast_data["packet_age_sec"] = 0
        await manager.broadcast(broadcast_data)

        return enriched

    @classmethod
    async def process_ec200u_gateway_payload(cls, data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Parses raw Quectel EC200U Gateway JSON, auto-provisions device, computes speed,
        and hands off to standard processing pipeline.
        """
        dev_id = str(data.get("gateway_id") or data.get("device_id") or data.get("deviceId") or data.get("id") or "GW-001")

        # Auto-provision new hardware gateway into fleet database if not already present
        existing_dev = db_get_device(dev_id)
        if not existing_dev:
            try:
                db_add_device({
                    "device_id": dev_id,
                    "imei": str(data.get("gateway_imei") or f"8607380{dev_id}"),
                    "vehicle_name": dev_id,
                    "cargo_type": f"Node: {data.get('node_id', 'NODE-001')}",
                    "target_min_c": 2.0,
                    "target_max_c": 8.0,
                    "sampling_interval_sec": 30,
                    "is_active": True
                })
                print(f"🎉 Auto-provisioned new Hardware Gateway: {dev_id}")
            except Exception as e:
                print(f"Device provisioning notice: {e}")

        # Fetch last known state for speed and continuity calculations
        latest = store.get_latest(dev_id)
        prev_gps = latest.raw_telemetry.gps if latest else None
        prev_time = latest.raw_telemetry.timestamp if latest else None

        # Parse Transmission Timestamp (Preserve firmware timestamp)
        raw_ts = data.get("timestamp")
        packet_time = None
        if raw_ts:
            try:
                if isinstance(raw_ts, (int, float)):
                    packet_time = datetime.fromtimestamp(raw_ts, tz=timezone.utc)
                elif isinstance(raw_ts, str):
                    # Strip trailing Z if present and parse
                    clean_ts = raw_ts.replace("Z", "+00:00")
                    packet_time = datetime.fromisoformat(clean_ts)
                    if packet_time.tzinfo is None:
                        packet_time = packet_time.replace(tzinfo=timezone.utc)
            except Exception:
                packet_time = None
        if packet_time is None:
            packet_time = datetime.now(timezone.utc)

        # Parse Coordinates
        raw_lat = data.get("latitude") if data.get("latitude") is not None else data.get("lat")
        raw_lng = data.get("longitude") if data.get("longitude") is not None else (data.get("lon") if data.get("lon") is not None else data.get("lng"))
        has_gps_fix = (raw_lat is not None and raw_lng is not None)

        try:
            lat_val = float(raw_lat) if raw_lat is not None else None
            lng_val = float(raw_lng) if raw_lng is not None else None
        except (ValueError, TypeError):
            lat_val = None
            lng_val = None

        # Compute speed dynamically on backend via SpeedCalculator
        raw_speed = data.get("speed_kmh") if data.get("speed_kmh") is not None else data.get("speed")
        raw_heading = data.get("heading_deg") if data.get("heading_deg") is not None else (data.get("heading") if data.get("heading") is not None else data.get("bearing"))

        if raw_speed is not None:
            try:
                speed_val = float(raw_speed)
            except (ValueError, TypeError):
                speed_val = 0.0
        else:
            # Automatic backend speed calculation using firmware timestamp interval
            speed_info = SpeedCalculator.calculate_speed(
                prev_lat=prev_gps.lat if prev_gps else None,
                prev_lon=prev_gps.lng if prev_gps else None,
                prev_time=prev_time,
                curr_lat=lat_val,
                curr_lon=lng_val,
                curr_time=packet_time,
                fallback_speed=prev_gps.speed_kmh if (prev_gps and prev_gps.speed_kmh is not None) else 0.0
            )
            speed_val = speed_info["speed"]
            if raw_heading is None and speed_info.get("bearing_deg") is not None:
                raw_heading = speed_info["bearing_deg"]

        try:
            heading_val = float(raw_heading) if raw_heading is not None else 0.0
        except (ValueError, TypeError):
            heading_val = 0.0

        # Parse Temperature & Node Connectivity
        node_connected = bool(data.get("node_connected", False))
        raw_temp = data.get("temperature") if data.get("temperature") is not None else data.get("cargo_temp_c")
        if raw_temp is None:
            temp_val = None
            probe_connected = False
        else:
            try:
                temp_val = float(raw_temp)
                probe_connected = True
            except (ValueError, TypeError):
                temp_val = None
                probe_connected = False

        # Parse Door Status & Tamper
        door_str = str(data.get("door_status") or "").upper()
        tamper_flag = bool(data.get("tamper", False))
        door_closed = (not tamper_flag) if door_str in ["", "UNKNOWN"] else (door_str != "OPEN")

        # Parse Network RSSI to CSQ
        net_rssi = data.get("network_rssi")
        if net_rssi is not None:
            try:
                csq = max(0, min(31, int((float(net_rssi) + 113) / 2)))
            except Exception:
                csq = None
        else:
            raw_csq = data.get("lte_csq") or data.get("csq")
            try:
                csq = int(raw_csq) if raw_csq is not None else None
            except Exception:
                csq = None

        raw_alt = data.get("altitude") if data.get("altitude") is not None else data.get("altitude_m")
        try:
            alt_val = float(raw_alt) if raw_alt is not None else None
        except (ValueError, TypeError):
            alt_val = None

        raw_sats = data.get("satellites") or data.get("satellites_count")
        try:
            sats_val = int(raw_sats) if raw_sats is not None else (10 if has_gps_fix else 0)
        except (ValueError, TypeError):
            sats_val = 10 if has_gps_fix else 0

        gps_obj = GPSCoordinates(
            lat=lat_val,
            lng=lng_val,
            speed_kmh=speed_val,
            heading_deg=heading_val,
            altitude_m=alt_val,
            satellites_count=sats_val,
            fix_status="3D_FIX" if has_gps_fix else "NO_FIX"
        )

        temp_obj = TemperatureReading(
            cargo_temp_c=temp_val,
            ambient_temp_c=float(data.get("ambient_temp_c")) if data.get("ambient_temp_c") is not None else None,
            probe_connected=probe_connected
        )

        # Real Battery & Power parsing - NO fabricated fallback values
        battery_raw = data.get("battery") if data.get("battery") is not None else data.get("battery_pct")
        try:
            battery_pct = int(battery_raw) if battery_raw is not None else None
        except (ValueError, TypeError):
            battery_pct = None

        volt_raw = data.get("battery_voltage_v") if data.get("battery_voltage_v") is not None else data.get("voltage")
        try:
            battery_voltage_v = float(volt_raw) if volt_raw is not None else None
        except (ValueError, TypeError):
            battery_voltage_v = None

        ext_power_raw = data.get("external_power_connected") if data.get("external_power_connected") is not None else data.get("external_power")
        external_power_connected = bool(ext_power_raw) if ext_power_raw is not None else None

        power_obj = PowerAndNetwork(
            battery_pct=battery_pct,
            battery_voltage_v=battery_voltage_v,
            external_power_connected=external_power_connected,
            lte_csq_rssi=csq,
            network_rat=str(data.get("network_rat") or "4G Cat-1 (EC200U)")
        )

        # Real IMU Parsing - distinguish absent IMU from active sensor
        accel_x = data.get("accel_x") if data.get("accel_x") is not None else data.get("accel_x_g")
        accel_y = data.get("accel_y") if data.get("accel_y") is not None else data.get("accel_y_g")
        accel_z = data.get("accel_z") if data.get("accel_z") is not None else data.get("accel_z_g")
        gyro_x = data.get("gyro_x") if data.get("gyro_x") is not None else data.get("gyro_x_dps")
        gyro_y = data.get("gyro_y") if data.get("gyro_y") is not None else data.get("gyro_y_dps")
        gyro_z = data.get("gyro_z") if data.get("gyro_z") is not None else data.get("gyro_z_dps")
        has_imu = (accel_x is not None or accel_y is not None or accel_z is not None)

        if has_imu:
            try:
                imu_obj = IMUData(
                    available=True,
                    accel_x_g=float(accel_x) if accel_x is not None else 0.0,
                    accel_y_g=float(accel_y) if accel_y is not None else 0.0,
                    accel_z_g=float(accel_z) if accel_z is not None else 1.0,
                    gyro_x_dps=float(gyro_x) if gyro_x is not None else 0.0,
                    gyro_y_dps=float(gyro_y) if gyro_y is not None else 0.0,
                    gyro_z_dps=float(gyro_z) if gyro_z is not None else 0.0,
                    shock_detected=bool(data.get("shock_detected", False))
                )
            except (ValueError, TypeError):
                imu_obj = IMUData(available=False)
        else:
            imu_obj = IMUData(available=False)

        packet = RawTelemetryPacket(
            device_id=dev_id,
            timestamp=packet_time,
            gps=gps_obj,
            temperature=temp_obj,
            imu=imu_obj,
            tamper_switch_closed=bool(door_closed),
            power_network=power_obj
        )

        # Store raw payload
        store.set_raw_payload(dev_id, data)

        # Detailed server console diagnostic logging
        utc_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
        gps_desc = f"Lat: {lat_val:.6f}, Lng: {lng_val:.6f} [3D GNSS LOCKED]" if has_gps_fix else "🛰️ Acquiring GNSS Fix (Indoor / Cold Start)"
        temp_desc = f"{temp_val:.2f} °C (Pharma Optimal)" if (raw_temp is not None and 2.0 <= temp_val <= 8.0) else (f"{temp_val:.2f} °C" if raw_temp is not None else "⏳ Awaiting Wireless Node (NODE-001)")
        door_desc = "🔒 SEALED (Normal)" if door_closed else "🚨 TAMPER BREACH (Door Open / Tamper True!)"

        print("\n" + "=" * 65)
        print("📡 INCOMING FIRMWARE TELEMETRY RECEIVED [EC200U GATEWAY]")
        print("-" * 65)
        print(f"⏰ Timestamp:    {utc_str}")
        print(f"🆔 Gateway ID:   {dev_id} | Node: {data.get('node_id', 'NODE-001')}")
        print(f"📍 GPS Status:   {gps_desc}")
        print(f"📶 Cellular 4G:  {net_rssi} dBm (CSQ {csq}/31 - EC200U Connected)")
        print(f"❄️ Temperature:  {temp_desc}")
        print(f"🚪 Enclosure:    {door_desc}")
        print(f"📦 Raw Payload:  {data}")
        print("=" * 65 + "\n")

        await cls.process_and_broadcast_packet(packet, raw_payload=data)

        return {
            "status": "received",
            "code": 200,
            "gateway_id": dev_id,
            "device_id": dev_id,
            "server_time": datetime.now(timezone.utc).isoformat(),
            "received_summary": {
                "gateway_id": dev_id,
                "node_id": data.get("node_id", "NODE-001"),
                "lat": lat_val if has_gps_fix else None,
                "lng": lng_val if has_gps_fix else None,
                "gps_status": "LOCKED" if has_gps_fix else "ACQUIRING_SATELLITES",
                "temperature_c": temp_val if raw_temp is not None else None,
                "speed_kmh": speed_val,
                "node_connected": node_connected,
                "door_sealed": bool(door_closed),
                "lte_csq": csq
            }
        }
