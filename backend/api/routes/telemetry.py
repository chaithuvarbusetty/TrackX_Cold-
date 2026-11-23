"""
==============================================================================
FILE: telemetry.py
PURPOSE:
Hardware Telemetry Ingestion and Time-Series Query Routes for ColdChain CMS.
Provides latest telemetry packets, AI forecasting windows, CSV export,
health check endpoints, and physical tracker ingestion.
==============================================================================
"""

import io
import os
import csv
import re
import time
from datetime import datetime, timezone
from typing import List, Dict, Any, Optional
from fastapi import APIRouter, HTTPException, Query, Response, status
from fastapi.responses import JSONResponse, Response, HTMLResponse

from ...database.coldchain_db import coldchain_db
from ...services.coldchain_engine import (
    coldchain_engine,
    compute_thermal_forecast,
    evaluate_geofences,
    haversine_meters,
    compute_bearing_degrees
)
from ...services.push_service import push_service
from ..websocket import manager

telemetry_router = APIRouter(tags=["Telemetry"])

# Global rolling buffer of live hardware packets
RECENT_HARDWARE_PACKETS: List[Dict[str, Any]] = []


@telemetry_router.get("/api/v1/health")
async def health_check():
    """System health check endpoint."""
    return {
        "status": "ok",
        "engine": "postgresql" if coldchain_db.is_postgres else "sqlite-wal",
        "paused": coldchain_engine.paused,
        "ts": int(time.time() * 1000)
    }


@telemetry_router.get("/api/v1/telemetry/{device_id}/latest")
async def get_latest_telemetry(device_id: str):
    """Retrieves the latest telemetry point, AI thermal forecast, and recent history window."""
    manager.active_selected_device = device_id
    packet = coldchain_db.get_latest_packet(device_id)
    if not packet:
        raise HTTPException(status_code=404, detail="Device telemetry not found")

    dev = coldchain_db.get_device(device_id)
    t_min = float(dev["target_min_c"]) if dev else 2.0
    t_max = float(dev["target_max_c"]) if dev else 8.0

    history = coldchain_db.get_device_telemetry_history(device_id, limit=60)
    samples = [{"recorded_at_ms": p["recorded_at_ms"], "cargo_temp_c": p["cargo_temp_c"]} for p in history]
    forecast = compute_thermal_forecast(samples, t_min, t_max)

    return {
        "device": dev,
        "packet": packet,
        "forecast": forecast,
        "history": history
    }


@telemetry_router.get("/api/v1/telemetry/{device_id}/history")
async def get_telemetry_history(
    device_id: str,
    limit: int = Query(60, ge=10, le=2000),
    from_ms: Optional[int] = Query(None),
    to_ms: Optional[int] = Query(None)
):
    """Retrieves chronological telemetry points for time-series charts and breadcrumb trails."""
    lim = int(limit) if isinstance(limit, (int, float, str)) and str(limit).isdigit() else 60
    f_ms = int(from_ms) if isinstance(from_ms, (int, float, str)) and str(from_ms).isdigit() else None
    t_ms = int(to_ms) if isinstance(to_ms, (int, float, str)) and str(to_ms).isdigit() else None
    history = coldchain_db.get_device_telemetry_history(device_id, limit=lim, from_ms=f_ms, to_ms=t_ms)
    return {
        "device_id": device_id,
        "count": len(history),
        "history": history
    }


def build_telemetry_csv(history: List[Dict[str, Any]]) -> str:
    """Builds standard RFC-4180 CSV matching frontend export."""
    headers = [
        "Sequence", "Timestamp (UTC)", "Recorded Epoch (ms)", "Device ID", "Node ID",
        "Cargo Temp (°C)", "Ambient Temp (°C)", "Humidity (%)", "Latitude", "Longitude",
        "Altitude (m)", "Speed (km/h)", "Heading (°)", "Satellites", "Accuracy (m)",
        "Network RSSI (dBm)", "LTE CSQ", "Node RSSI (dBm)", "Node Connected",
        "Door Status", "Tamper Breach", "Battery (%)", "Compressor Active",
        "Distance (km)", "Address", "Sub-Area", "Geofence Name", "Inside Geofence"
    ]
    out = io.StringIO()
    writer = csv.writer(out, lineterminator="\r\n")
    writer.writerow(headers)

    for p in history:
        writer.writerow([
            p.get("seq", 0),
            p.get("timestamp", ""),
            p.get("recorded_at_ms", 0),
            p.get("device_id", ""),
            p.get("node_id", ""),
            f"{float(p['cargo_temp_c']):.2f}" if p.get("cargo_temp_c") is not None else "NULL",
            f"{float(p.get('ambient_temp_c', 0.0)):.2f}",
            f"{float(p.get('humidity_pct', 0.0)):.1f}",
            f"{float(p.get('lat', 0.0)):.6f}",
            f"{float(p.get('lng', 0.0)):.6f}",
            f"{float(p.get('altitude_m', 0.0)):.1f}",
            f"{float(p.get('speed_kmh', 0.0)):.1f}",
            p.get("heading_deg", 0),
            p.get("satellites", 0),
            f"{float(p.get('location_accuracy_m', 0.0)):.1f}",
            p.get("network_rssi_dbm", 0),
            p.get("lte_csq", 0),
            p.get("node_rssi_dbm") if p.get("node_rssi_dbm") is not None else "NULL",
            "TRUE" if p.get("node_connected") else "FALSE",
            p.get("door_status", "SEALED"),
            "TRUE" if p.get("tamper") else "FALSE",
            f"{float(p.get('battery_pct', 0.0)):.1f}",
            "TRUE" if p.get("compressor_active") else "FALSE",
            f"{float(p.get('distance_km', 0.0)):.3f}",
            p.get("address", ""),
            p.get("sub_area", ""),
            p.get("geofence_name") or "None",
            "TRUE" if p.get("geofence_inside") else "FALSE"
        ])
    return out.getvalue()


@telemetry_router.get("/api/v1/telemetry/{device_id}/export.csv")
async def export_telemetry_csv(
    device_id: str,
    limit: int = Query(1500, ge=10, le=2000),
    from_ms: Optional[int] = Query(None),
    to_ms: Optional[int] = Query(None)
):
    """Generates and streams an RFC-4180 CSV export of sensor history."""
    lim = int(limit) if isinstance(limit, (int, float, str)) and str(limit).isdigit() else 1500
    f_ms = int(from_ms) if isinstance(from_ms, (int, float, str)) and str(from_ms).isdigit() else None
    t_ms = int(to_ms) if isinstance(to_ms, (int, float, str)) and str(to_ms).isdigit() else None
    history = coldchain_db.get_device_telemetry_history(device_id, limit=lim, from_ms=f_ms, to_ms=t_ms)
    if not history:
        raise HTTPException(status_code=404, detail="No telemetry history found for device in selected range")

    csv_content = build_telemetry_csv(history)
    safe_id = re.sub(r"[^a-zA-Z0-9_-]", "_", device_id)
    filename = f"coldchain-{safe_id}-telemetry.csv"

    return Response(
        content=csv_content,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )


# --- PHYSICAL HARDWARE INGESTION ENDPOINTS ---
def _safe_float(val: Any, default: float = 0.0) -> float:
    if val is None or val == "":
        return default
    try:
        return float(val)
    except (ValueError, TypeError):
        return default

def _safe_int(val: Any, default: int = 0) -> int:
    if val is None or val == "":
        return default
    try:
        return int(float(val))
    except (ValueError, TypeError):
        return default

@telemetry_router.post("/api/v1/telemetry")
@telemetry_router.post("/api/v1/telemetry/temperature")
@telemetry_router.post("/api/v1/telemetry/gps")
@telemetry_router.post("/api/v1/telemetry/tamper")
@telemetry_router.post("/api/container/data")
@telemetry_router.post("/data")
async def ingest_hardware_telemetry(payload: Dict[str, Any]):
    """
    Ingests live telemetry from physical IoT hardware (Quectel EC200U, ESP32, STM32).
    Evaluates safety rules, computes AI forecast, persists into PostgreSQL, and broadcasts.
    """
    print(f"[*] Hardware Ingestion Received: {payload}", flush=True)
    now_ms = int(time.time() * 1000)
    dev_id = str(payload.get("device_id") or payload.get("gateway_id") or payload.get("dev_id") or payload.get("id") or "GW-001").strip()
    
    dev = coldchain_db.get_device(dev_id)
    if not dev:
        # Auto-provision hardware unit
        dev = coldchain_db.register_device({
            "device_id": dev_id,
            "vehicle_name": f"{dev_id} (Hardware Tracker)",
            "cargo_type": "Cold-Chain Pharma & Vaccines",
            "target_min_c": 2.0,
            "target_max_c": 8.0,
            "sampling_interval_sec": 2
        })
        coldchain_engine.sync_devices()

    last_pkt = coldchain_db.get_latest_packet(dev_id)
    last_lat = float(last_pkt["lat"]) if (last_pkt and last_pkt.get("lat") is not None) else 17.4390934
    last_lng = float(last_pkt["lng"]) if (last_pkt and last_pkt.get("lng") is not None) else 78.3652306
    seq = (last_pkt["seq"] + 1) if last_pkt else 1
    dist = float(last_pkt["distance_km"]) if (last_pkt and last_pkt.get("distance_km") is not None) else 0.0

    # Extract sensor values safely with alias fallbacks
    raw_temp = payload.get("cargo_temp_c") if payload.get("cargo_temp_c") is not None else payload.get("temperature", payload.get("temp", payload.get("t")))
    if raw_temp is not None and str(raw_temp).strip() not in ["", "None", "null", "NONE", "NULL"]:
        cargo_temp = _safe_float(raw_temp, default=None)
    else:
        cargo_temp = None

    raw_amb = payload.get("ambient_temp_c") if payload.get("ambient_temp_c") is not None else payload.get("ambient_temp", payload.get("amb_temp"))
    ambient_temp = _safe_float(raw_amb, default=30.2)

    raw_hum = payload.get("humidity_pct") if payload.get("humidity_pct") is not None else payload.get("humidity", payload.get("hum"))
    humidity = _safe_float(raw_hum, default=54.0)

    raw_lat = payload.get("latitude") if payload.get("latitude") is not None else payload.get("lat", payload.get("gps_lat"))
    gps_lat = None
    if raw_lat is not None and str(raw_lat).strip() not in ["", "None", "null", "NONE", "NULL"]:
        _parsed_lat = _safe_float(raw_lat, default=None)
        if _parsed_lat is not None and abs(_parsed_lat) > 0.0001:
            gps_lat = _parsed_lat

    raw_lng = payload.get("longitude") if payload.get("longitude") is not None else payload.get("lng", payload.get("lon", payload.get("gps_lng")))
    gps_lng = None
    if raw_lng is not None and str(raw_lng).strip() not in ["", "None", "null", "NONE", "NULL"]:
        _parsed_lng = _safe_float(raw_lng, default=None)
        if _parsed_lng is not None and abs(_parsed_lng) > 0.0001:
            gps_lng = _parsed_lng

    has_gps_fix = (gps_lat is not None and gps_lng is not None)

    # Coordinates for spatial database persistence (dead-reckoning / last known location fallback)
    lat = gps_lat if has_gps_fix else last_lat
    lng = gps_lng if has_gps_fix else last_lng

    # Accurate address lookup
    if 17.42 <= lat <= 17.46 and 78.33 <= lng <= 78.38:
        address = "Financial District / Gachibowli"
        sub_area = "Hyderabad, Telangana"
    else:
        address = str(payload.get("address") or "Hyderabad Logistics Corridor")
        sub_area = str(payload.get("sub_area") or "Telangana")

    # Calculate real-time kinematic displacement, speed, and heading from GPS coordinates
    calc_speed = 0.0
    calc_heading = None
    if has_gps_fix and last_pkt and last_pkt.get("lat") and last_pkt.get("lng"):
        last_lat_f = float(last_pkt["lat"])
        last_lng_f = float(last_pkt["lng"])
        last_ms = int(last_pkt.get("recorded_at_ms", now_ms - 20000))
        d_m = haversine_meters(last_lat_f, last_lng_f, lat, lng)
        delta_sec = max(1.0, (now_ms - last_ms) / 1000.0)

        # GPS movement filter: filter out minor stationary GPS jitter (< 3 meters)
        if 3.0 <= d_m <= 15000.0:
            dist = round(dist + d_m / 1000.0, 3)
            # Speed (km/h) = (d_m in meters / delta_sec) * 3.6
            raw_calc_spd = (d_m * 3.6) / delta_sec
            if raw_calc_spd <= 160.0:
                calc_speed = round(raw_calc_spd, 1)
            # Compute actual movement heading vector in degrees
            calc_heading = compute_bearing_degrees(last_lat_f, last_lng_f, lat, lng)

    # Use hardware speed if provided and > 0.5 km/h, otherwise fallback to calculated GPS kinematic speed
    raw_speed = payload.get("speed_kmh") if payload.get("speed_kmh") is not None else payload.get("speed", payload.get("spd"))
    hw_speed = _safe_float(raw_speed, default=0.0)
    if hw_speed > 0.5:
        speed = round(hw_speed, 1)
    else:
        speed = calc_speed

    # Heading: prefer calculated movement vector when moving, else hardware/last heading
    raw_heading = payload.get("heading_deg") if payload.get("heading_deg") is not None else payload.get("heading", payload.get("course"))
    if calc_heading is not None and speed >= 2.0:
        heading = calc_heading
    else:
        heading = _safe_int(raw_heading, default=int(last_pkt.get("heading_deg", 90)) if last_pkt else 90)

    raw_door = str(payload.get("door_status") or payload.get("door") or "").upper()
    door = "OPEN" if raw_door in ["OPEN", "BREACH", "1", "TRUE"] else "SEALED"

    tamper = bool(payload.get("tamper", False) or payload.get("tamper_switch_open", False) or payload.get("tamper_switch_closed") == 0)
    
    raw_bat = payload.get("battery_pct") if payload.get("battery_pct") is not None else payload.get("battery", payload.get("bat"))
    battery = _safe_float(raw_bat, default=95.0)

    rssi = _safe_int(payload.get("network_rssi_dbm", payload.get("network_rssi", payload.get("rssi"))), default=-75)
    csq = _safe_int(payload.get("lte_csq", payload.get("csq")), default=max(10, min(31, int((rssi + 113) / 2))))

    raw_node_conn = payload.get("node_connected")
    node_connected = bool(raw_node_conn) if raw_node_conn is not None else True

    raw_node_rssi = payload.get("node_rssi_dbm", payload.get("node_rssi"))
    if raw_node_rssi is not None and str(raw_node_rssi).strip() not in ["", "None", "null", "NONE", "NULL"]:
        node_rssi = _safe_int(raw_node_rssi, default=None)
    else:
        node_rssi = None

    geo_res = evaluate_geofences(lat, lng, coldchain_engine.geofences)

    packet = {
        "seq": seq,
        "device_id": dev_id,
        "node_id": dev.get("node_id", "NODE-001"),
        "recorded_at_ms": now_ms,
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now_ms / 1000)),
        "cargo_temp_c": cargo_temp,
        "ambient_temp_c": ambient_temp,
        "humidity_pct": humidity,
        "lat": lat,
        "lng": lng,
        "altitude_m": _safe_float(payload.get("altitude_m", payload.get("altitude")), default=602.8),
        "speed_kmh": speed,
        "heading_deg": heading,
        "satellites": _safe_int(payload.get("satellites", payload.get("sats")), default=12),
        "location_accuracy_m": _safe_float(payload.get("location_accuracy_m", payload.get("location_accuracy", payload.get("accuracy"))), default=25.0),
        "network_rssi_dbm": rssi,
        "lte_csq": csq,
        "node_rssi_dbm": node_rssi,
        "node_connected": node_connected,
        "door_status": door,
        "tamper": tamper,
        "battery_pct": battery,
        "compressor_active": True,
        "distance_km": dist,
        "address": address,
        "sub_area": sub_area,
        "geofence_name": geo_res.get("geofence_name") or payload.get("geofence_name"),
        "geofence_inside": geo_res.get("inside", False) or bool(payload.get("geofence_inside", False))
    }

    try:
        history = coldchain_db.get_device_telemetry_history(dev_id, limit=20)
        samples = [{"recorded_at_ms": p["recorded_at_ms"], "cargo_temp_c": float(p["cargo_temp_c"])} for p in history if p.get("cargo_temp_c") is not None]
        if cargo_temp is not None:
            samples.append({"recorded_at_ms": now_ms, "cargo_temp_c": cargo_temp})
        forecast = compute_thermal_forecast(samples, dev.get("target_min_c", 2.0), dev.get("target_max_c", 8.0))

        health = 98.0
        if cargo_temp is not None:
            if cargo_temp > dev.get("target_max_c", 8.0) or cargo_temp < dev.get("target_min_c", 2.0):
                health -= 38.0
        if door == "OPEN":
            health -= 24.0
        if tamper:
            health -= 14.0

        coldchain_db.record_telemetry_point(packet, {
            "predicted_temp_30m_c": forecast.get("predicted_30m_c"),
            "excursion_risk_pct": forecast.get("excursion_risk_pct", 0),
            "health_score": max(20.0, health),
            "history_temps": [s["cargo_temp_c"] for s in samples[-12:]] if samples else []
        })

        # Real-time Track Formation: Append incoming GPS coordinates as waypoints to active trip
        active_trip = coldchain_db.get_active_trip_for_device(dev_id)
        if active_trip and has_gps_fix and gps_lat is not None and gps_lng is not None:
            coldchain_db.append_trip_waypoint(
                active_trip["trip_id"],
                lat=gps_lat,
                lng=gps_lng,
                speed_kmh=speed,
                heading_deg=heading,
                cargo_temp_c=cargo_temp,
                timestamp=packet["timestamp"]
            )

        # --------------------------------------------------------------------
        # Real-time Live Hardware Alert Detection & Mobile Push Dispatch
        # --------------------------------------------------------------------
        new_alerts = []
        target_min = float(dev.get("target_min_c", 2.0))
        target_max = float(dev.get("target_max_c", 8.0))

        if cargo_temp is not None:
            if cargo_temp > target_max:
                al = coldchain_engine._maybe_create_alert(
                    dev_id, "Temperature Excursion",
                    f"Thermal Excursion on {dev.get('vehicle_name', dev_id)}: {cargo_temp:.2f}°C breaches {target_max:.1f}°C ceiling.",
                    "CRITICAL", f"Thermal drift under load. Location: {address}.",
                    now_ms
                )
                if al:
                    new_alerts.append(al)
            elif cargo_temp < target_min:
                al = coldchain_engine._maybe_create_alert(
                    dev_id, "Freeze Risk Excursion",
                    f"Freeze Excursion on {dev.get('vehicle_name', dev_id)}: {cargo_temp:.2f}°C drops below {target_min:.1f}°C floor.",
                    "CRITICAL", f"Sub-zero/freeze crystallization risk at {address}.",
                    now_ms
                )
                if al:
                    new_alerts.append(al)
            elif cargo_temp > target_max - 0.6:
                al = coldchain_engine._maybe_create_alert(
                    dev_id, "Upper Limit Warning",
                    f"Warning: {dev.get('vehicle_name', dev_id)} reading {cargo_temp:.2f}°C approaches {target_max:.1f}°C ceiling.",
                    "HIGH", f"30m forecast projects potential excursion at {address}.",
                    now_ms
                )
                if al:
                    new_alerts.append(al)
        elif node_connected is False or raw_node_conn is False:
            al = coldchain_engine._maybe_create_alert(
                dev_id, "Sensor Probe Disconnected",
                f"Probe Disconnected on {dev.get('vehicle_name', dev_id)}: BLE sensor capsule NODE-001 offline.",
                "HIGH", "BLE sensor link lost. Temperature data temporarily unavailable.",
                now_ms
            )
            if al:
                new_alerts.append(al)

        if rssi < -98:
            al = coldchain_engine._maybe_create_alert(
                dev_id, "Weak Signal Warning",
                f"Signal Degradation on {dev.get('vehicle_name', dev_id)}: Cellular RSSI dropped to {rssi} dBm.",
                "HIGH", "Vehicle entering cellular dead-zone or RF shadowing area.",
                now_ms
            )
            if al:
                new_alerts.append(al)

        if door == "OPEN":
            al = coldchain_engine._maybe_create_alert(
                dev_id, "Door Breach",
                f"Security Breach on {dev.get('vehicle_name', dev_id)}: Cargo bay door OPEN at {address}.",
                "CRITICAL", f"Chamber door opened unexpectedly outside authorized loading bay.",
                now_ms
            )
            if al:
                new_alerts.append(al)

        if tamper:
            al = coldchain_engine._maybe_create_alert(
                dev_id, "Tamper Alarm",
                f"Anti-Tamper Alarm on {dev.get('vehicle_name', dev_id)}: Chassis enclosure switch open!",
                "CRITICAL", f"Hardware tracker casing breached or disconnected at {address}.",
                now_ms
            )
            if al:
                new_alerts.append(al)

        if battery < 20.0:
            al = coldchain_engine._maybe_create_alert(
                dev_id, "Low Battery",
                f"Power Warning on {dev.get('vehicle_name', dev_id)}: Battery down to {battery:.1f}%.",
                "HIGH", "Connect tracker to vehicle 12V/24V power bus.",
                now_ms
            )
            if al:
                new_alerts.append(al)

        # Dispatch alerts immediately via Web Push to registered mobile phones
        for al in new_alerts:
            push_service.dispatch_alert(al)
            await manager.broadcast({
                "type": "ALERT_NEW",
                "server_ts_ms": now_ms,
                "alert": al
            })

        # Synchronize with engine state in-memory
        if dev_id in coldchain_engine.states:
            st = coldchain_engine.states[dev_id]
            st.last_packet = packet
            st.cargo_temp = cargo_temp
            st.anchor_lat = lat
            st.anchor_lng = lng
            st.door_status = door
            st.tamper = tamper
            st.distance_km = dist
            st.battery_pct = battery
            st.recent_samples.append({"recorded_at_ms": now_ms, "cargo_temp_c": cargo_temp})
            if len(st.recent_samples) > 20:
                st.recent_samples.pop(0)

        # Broadcast to dashboard
        overview = coldchain_db.get_fleet_overview()
        await manager.broadcast({
            "type": "TELEMETRY_TICK",
            "server_ts_ms": now_ms,
            "query_latency_ms": overview.get("query_latency_ms", 0.1),
            "tick": {
                "kpis": overview["kpis"],
                "fleet_health": overview["fleet_health"],
                "updates": overview["fleet_table"],
                "selected_packet": packet
            }
        })

        # Append to live in-memory telemetry inspection queue (preserves true hardware state)
        RECENT_HARDWARE_PACKETS.append({
            "received_at": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime()),
            "device_id": dev_id,
            "lat": gps_lat,
            "lng": gps_lng,
            "has_gps_fix": has_gps_fix,
            "location_source": str(payload.get("location_source") or ("GPS" if has_gps_fix else "NONE")),
            "last_known_lat": lat,
            "last_known_lng": lng,
            "cargo_temp_c": cargo_temp,
            "battery_pct": battery,
            "network_rssi_dbm": rssi,
            "door_status": door,
            "tamper": tamper,
            "raw_payload": payload
        })
        if len(RECENT_HARDWARE_PACKETS) > 50:
            RECENT_HARDWARE_PACKETS.pop(0)

        return {
            "status": "ok",
            "device_id": dev_id,
            "recorded_at_ms": now_ms,
            "cargo_temp_c": cargo_temp,
            "lat": gps_lat,
            "lng": gps_lng,
            "has_gps_fix": has_gps_fix,
            "last_known_lat": lat,
            "last_known_lng": lng,
            "speed_kmh": speed,
            "heading_deg": heading,
            "forecast": forecast
        }
    except Exception as e:
        print(f"[-] Ingestion processing error: {e}", flush=True)
        return JSONResponse(status_code=400, content={"status": "error", "detail": str(e), "received": payload})


@telemetry_router.get("/api/v1/logs")
async def get_server_logs(limit: int = 100):
    """Retrieves clean recent server and telemetry ingestion logs."""
    base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
    log_file = os.path.join(base_dir, "backend.log")
    if not os.path.exists(log_file):
        return {"count": 0, "lines": []}
    try:
        with open(log_file, "r", encoding="utf-8", errors="replace") as f:
            all_lines = [l.rstrip() for l in f if l.strip() and not l.startswith("\x00")]
        return {
            "count": len(all_lines[-limit:]),
            "lines": all_lines[-limit:]
        }
    except Exception as e:
        return {"error": str(e), "lines": []}


@telemetry_router.get("/api/v1/telemetry/live/packets")
async def get_live_hardware_packets():
    """Retrieves raw live hardware packets received from physical devices."""
    return {
        "count": len(RECENT_HARDWARE_PACKETS),
        "packets": list(reversed(RECENT_HARDWARE_PACKETS))
    }


@telemetry_router.get("/logs", response_class=HTMLResponse)
async def view_live_logs_page():
    """Renders a responsive, auto-refreshing live terminal log viewer in the browser."""
    return """<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>TracX ColdChain — Live Telemetry & Server Logs</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #0b0f19; color: #f1f5f9; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; height: 100vh; display: flex; flex-direction: column; }
        header { background: #111827; border-bottom: 1px solid #1f2937; padding: 12px 20px; display: flex; align-items: center; justify-content: space-between; }
        .title { display: flex; align-items: center; gap: 10px; font-size: 14px; font-weight: 600; color: #38bdf8; }
        .dot { width: 8px; height: 8px; background: #22c55e; border-radius: 50%; box-shadow: 0 0 8px #22c55e; animation: pulse 2s infinite; }
        @keyframes pulse { 0% { opacity: 0.4; } 50% { opacity: 1; } 100% { opacity: 0.4; } }
        .controls { display: flex; gap: 10px; align-items: center; font-size: 12px; }
        button { background: #1e293b; color: #94a3b8; border: 1px solid #334155; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 12px; }
        button:hover { background: #334155; color: #fff; }
        .container { flex: 1; display: grid; grid-template-columns: 1fr 1fr; gap: 1px; background: #1f2937; overflow: hidden; }
        .pane { background: #0b0f19; display: flex; flex-direction: column; overflow: hidden; }
        .pane-header { background: #131d31; padding: 8px 16px; font-size: 12px; font-weight: 600; color: #94a3b8; border-bottom: 1px solid #1f2937; display: flex; justify-content: space-between; }
        .log-stream { flex: 1; overflow-y: auto; padding: 12px; font-size: 11.5px; line-height: 1.5; white-space: pre-wrap; word-break: break-all; }
        .log-stream::-webkit-scrollbar { width: 6px; }
        .log-stream::-webkit-scrollbar-thumb { background: #334155; border-radius: 3px; }
        .log-line { margin-bottom: 4px; padding: 2px 4px; border-radius: 3px; }
        .log-line:hover { background: rgba(255,255,255,0.04); }
        .line-ingest { color: #38bdf8; background: rgba(56,189,248,0.06); }
        .line-ok { color: #4ade80; }
        .line-info { color: #94a3b8; }
        .line-err { color: #f87171; }
        .card { background: #111827; border: 1px solid #1f2937; border-radius: 6px; padding: 10px; margin-bottom: 8px; }
        .card-header { display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 6px; }
        .badge { background: #0284c7; color: #fff; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: bold; }
        .val-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; font-size: 11px; }
        .val-item span { color: #64748b; display: block; font-size: 10px; }
    </style>
</head>
<body>
    <header>
        <div class="title"><div class="dot"></div> ColdChain Telemetry & Ingestion Console</div>
        <div class="controls">
            <span id="stat" style="color: #64748b;">Polling 1Hz</span>
            <button onclick="fetchData()">Refresh</button>
            <button onclick="copyLogs()">Copy Server Logs</button>
        </div>
    </header>
    <div class="container">
        <div class="pane">
            <div class="pane-header">
                <span>HARDWARE TELEMETRY PACKETS (GW-001 Live Ingestion)</span>
                <span id="pkt-count" style="color: #38bdf8;">0 packets</span>
            </div>
            <div class="log-stream" id="packets-stream">Loading live packets...</div>
        </div>
        <div class="pane">
            <div class="pane-header">
                <span>SERVER ENGINE LOGS (backend.log)</span>
                <span id="log-count" style="color: #4ade80;">0 lines</span>
            </div>
            <div class="log-stream" id="logs-stream">Loading server log output...</div>
        </div>
    </div>
    <script>
        let autoScroll = true;
        async function fetchData() {
            try {
                const [pktRes, logRes] = await Promise.all([
                    fetch('/api/v1/telemetry/live/packets'),
                    fetch('/api/v1/logs?limit=80')
                ]);
                const pkts = await pktRes.json();
                const logs = await logRes.json();

                // Render Packets
                const pktContainer = document.getElementById('packets-stream');
                document.getElementById('pkt-count').innerText = `${pkts.count || 0} received`;
                if (!pkts.packets || pkts.packets.length === 0) {
                    pktContainer.innerHTML = '<div style="color:#64748b;padding:20px;text-align:center;">Waiting for hardware telemetry packet...</div>';
                } else {
                    pktContainer.innerHTML = pkts.packets.map(p => `
                        <div class="card">
                            <div class="card-header">
                                <span style="color:#38bdf8;font-weight:bold;">${p.device_id || 'GW-001'}</span>
                                <div style="display:flex;gap:6px;align-items:center;">
                                    ${p.has_gps_fix
                                        ? '<span class="badge" style="background:#16a34a;">GPS LOCKED</span>'
                                        : '<span class="badge" style="background:#d97706;">NO GPS FIX</span>'
                                    }
                                    <span class="badge" style="background:#334155;">${p.received_at}</span>
                                </div>
                            </div>
                            <div class="val-grid">
                                <div class="val-item">
                                    <span>Latitude</span>
                                    ${p.lat !== null && p.lat !== undefined
                                        ? p.lat
                                        : '<span style="color:#f59e0b;font-weight:600;">null (No Fix)</span>'}
                                </div>
                                <div class="val-item">
                                    <span>Longitude</span>
                                    ${p.lng !== null && p.lng !== undefined
                                        ? p.lng
                                        : '<span style="color:#f59e0b;font-weight:600;">null (No Fix)</span>'}
                                </div>
                                <div class="val-item">
                                    <span>Location Source</span>
                                    ${p.has_gps_fix
                                        ? '<span style="color:#4ade80;font-weight:600;">' + (p.location_source || 'GPS') + '</span>'
                                        : '<span style="color:#f59e0b;font-weight:600;">' + (p.location_source || 'NONE') + '</span>'}
                                </div>
                                <div class="val-item">
                                    <span>Cargo Temp</span>
                                    ${p.cargo_temp_c !== null && p.cargo_temp_c !== undefined
                                        ? `${p.cargo_temp_c}°C`
                                        : '<span style="color:#94a3b8;">null (Standby)</span>'}
                                </div>
                                <div class="val-item"><span>RSSI</span>${p.network_rssi_dbm} dBm</div>
                                <div class="val-item"><span>Battery</span>${p.battery_pct}%</div>
                            </div>
                        </div>
                    `).join('');
                }

                // Render Server Logs
                const logContainer = document.getElementById('logs-stream');
                document.getElementById('log-count').innerText = `${logs.count || 0} lines`;
                if (logs.lines && logs.lines.length > 0) {
                    logContainer.innerHTML = logs.lines.map(line => {
                        let cls = 'line-info';
                        if (line.includes('Hardware Ingestion Received')) cls = 'line-ingest';
                        else if (line.includes('200 OK')) cls = 'line-ok';
                        else if (line.includes('ERROR') || line.includes('Errno')) cls = 'line-err';
                        return `<div class="log-line ${cls}">${escapeHtml(line)}</div>`;
                    }).join('');
                    if (autoScroll) {
                        logContainer.scrollTop = logContainer.scrollHeight;
                    }
                }
            } catch (e) {
                console.error(e);
            }
        }
        function escapeHtml(t) {
            return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        }
        function copyLogs() {
            const txt = document.getElementById('logs-stream').innerText;
            navigator.clipboard.writeText(txt);
            alert('Server logs copied to clipboard!');
        }
        fetchData();
        setInterval(fetchData, 2000);
    </script>
</body>
</html>"""
