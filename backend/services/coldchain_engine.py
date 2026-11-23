"""
==============================================================================
FILE: coldchain_engine.py
PURPOSE:
Real-Time Telemetry Physics Engine, Spatial Kinematics, Geofence Evaluator,
and Dual-Layer AI Forecasting Simulation Loop for ColdChain CMS.
==============================================================================
"""

import math
import time
import json
import asyncio
from typing import List, Dict, Any, Optional, Set, Callable
from ..database.coldchain_db import coldchain_db, ColdChainDatabase

# Realistic Hyderabad Pharmaceutical Cold-Chain Corridors
HYDERABAD_CORRIDORS = [
    # Corridor 0: HITEC City Pharma Hub -> Medchal NH-44 Depot
    [
        {"lat": 17.4483, "lng": 78.3915, "area": "HITEC City Pharma Hub", "sub_area": "Madhapur, Hyderabad", "speed_limit": 38},
        {"lat": 17.4725, "lng": 78.4080, "area": "Kukatpally Junction", "sub_area": "NH-65 Corridor, Hyderabad", "speed_limit": 46},
        {"lat": 17.4980, "lng": 78.4310, "area": "Balanagar Industrial Park", "sub_area": "North Corridor, Hyderabad", "speed_limit": 52},
        {"lat": 17.5320, "lng": 78.4620, "area": "Kompally Cold Plaza", "sub_area": "NH-44 Highway, Hyderabad", "speed_limit": 64},
        {"lat": 17.5840, "lng": 78.4755, "area": "Kandlakoya Logistics Gate", "sub_area": "NH-44 Express, Medchal", "speed_limit": 68},
        {"lat": 17.6297, "lng": 78.4812, "area": "Medchal Cold Depot", "sub_area": "Medchal District, Telangana", "speed_limit": 28},
    ],
    # Corridor 1: Gachibowli Genome Valley -> Shamshabad Air Cargo Terminal
    [
        {"lat": 17.4401, "lng": 78.3489, "area": "Gachibowli Pharma Hub", "sub_area": "Financial District, Hyderabad", "speed_limit": 40},
        {"lat": 17.4020, "lng": 78.3660, "area": "Narsingi ORR Entry", "sub_area": "Outer Ring Road, Hyderabad", "speed_limit": 72},
        {"lat": 17.3510, "lng": 78.3890, "area": "Rajendranagar Bio-Park", "sub_area": "ORR Exit 17, Hyderabad", "speed_limit": 76},
        {"lat": 17.2940, "lng": 78.4120, "area": "Tondpally Cold Transit", "sub_area": "Shamshabad Corridor", "speed_limit": 66},
        {"lat": 17.2403, "lng": 78.4294, "area": "Shamshabad Cargo Terminal", "sub_area": "RGIA Air Freight Hub", "speed_limit": 25},
    ],
    # Corridor 2: Uppal Bio-Cluster -> Patancheru Vaccine Plant via ORR
    [
        {"lat": 17.4065, "lng": 78.5591, "area": "Uppal Bio-Cluster", "sub_area": "East Logistics Zone, Hyderabad", "speed_limit": 42},
        {"lat": 17.4480, "lng": 78.5220, "area": "Tarnaka Cold Exchange", "sub_area": "Secunderabad Corridor", "speed_limit": 48},
        {"lat": 17.4790, "lng": 78.4650, "area": "Bowenpally Cold Hub", "sub_area": "NH-44 Junction", "speed_limit": 50},
        {"lat": 17.5080, "lng": 78.3420, "area": "Miyapur Transit Point", "sub_area": "NH-65 West, Hyderabad", "speed_limit": 54},
        {"lat": 17.5285, "lng": 78.2640, "area": "Patancheru Vaccine Plant", "sub_area": "Sangareddy Industrial Belt", "speed_limit": 30},
    ]
]


def haversine_meters(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    R = 6371000.0
    p1 = math.radians(lat1)
    p2 = math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2)**2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c


def compute_bearing_degrees(lat1: float, lng1: float, lat2: float, lng2: float) -> int:
    p1 = math.radians(lat1)
    p2 = math.radians(lat2)
    dl = math.radians(lng2 - lng1)
    y = math.sin(dl) * math.cos(p2)
    x = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    theta = math.atan2(y, x)
    return round((math.degrees(theta) + 360) % 360)


def filter_and_accumulate_distance_km(
    prev_lat: float, prev_lng: float, next_lat: float, next_lng: float, current_distance_km: float
) -> tuple[float, bool]:
    meters = haversine_meters(prev_lat, prev_lng, next_lat, next_lng)
    if 100 <= meters < 20000:
        return round(current_distance_km + meters / 1000.0, 3), True
    return current_distance_km, False


def interpolate_corridor_position(route: List[Dict[str, Any]], progress: float) -> Dict[str, Any]:
    if not route:
        return {"lat": 17.4483, "lng": 78.3915, "area": "Hyderabad Hub", "sub_area": "Telangana", "speed_kmh": 40.0, "heading_deg": 90}
    norm = progress % 2.0
    forward = norm <= 1.0
    eff = norm if forward else (2.0 - norm)
    pts = route if forward else list(reversed(route))
    n = len(pts) - 1
    total_idx = eff * n
    base_idx = min(n - 1, max(0, int(math.floor(total_idx))))
    frac = total_idx - base_idx

    p0 = pts[base_idx]
    p1 = pts[min(n, base_idx + 1)]

    lat = p0["lat"] + (p1["lat"] - p0["lat"]) * frac
    lng = p0["lng"] + (p1["lng"] - p0["lng"]) * frac
    heading = compute_bearing_degrees(p0["lat"], p0["lng"], p1["lat"], p1["lng"])
    base_spd = p0["speed_limit"] + (p1["speed_limit"] - p0["speed_limit"]) * frac

    return {
        "lat": round(lat, 6),
        "lng": round(lng, 6),
        "area": p0["area"] if frac < 0.5 else p1["area"],
        "sub_area": p0["sub_area"] if frac < 0.5 else p1["sub_area"],
        "speed_kmh": max(15.0, round(base_spd, 1)),
        "heading_deg": heading
    }


def compute_thermal_forecast(
    samples: List[Dict[str, Any]], target_min_c: float = 2.0, target_max_c: float = 8.0
) -> Dict[str, Any]:
    valid_samples = [s for s in samples if s.get("cargo_temp_c") is not None]
    if not valid_samples:
        return {
            "current_temp_c": None,
            "predicted_15m_c": None,
            "predicted_30m_c": None,
            "predicted_60m_c": None,
            "rate_c_per_min": 0.0,
            "excursion_risk_pct": 0,
            "risk_level": "LOW",
            "baseline_ready": False,
            "recommendation": "Probe standby: Gateway active, awaiting digital sensor probe telemetry."
        }
    ordered = sorted(valid_samples, key=lambda s: s["recorded_at_ms"])
    current = ordered[-1]["cargo_temp_c"]
    if len(ordered) < 3:
        return {
            "current_temp_c": round(current, 2),
            "predicted_15m_c": None,
            "predicted_30m_c": None,
            "predicted_60m_c": None,
            "rate_c_per_min": 0.0,
            "excursion_risk_pct": 0,
            "risk_level": "LOW",
            "baseline_ready": False,
            "recommendation": f"Acquiring thermal baseline ({len(ordered)}/3 packets)."
        }

    t0 = ordered[0]["recorded_at_ms"]
    xs = [(s["recorded_at_ms"] - t0) / 60000.0 for s in ordered]
    ys = [s["cargo_temp_c"] for s in ordered]
    mean_x = sum(xs) / len(xs)
    mean_y = sum(ys) / len(ys)

    num = sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, ys))
    den = sum((x - mean_x)**2 for x in xs)

    raw_slope = (num / den) if den > 1e-6 else 0.0
    span_min = max(0.05, xs[-1] - xs[0])
    total_delta = abs(ys[-1] - ys[0])
    damped_slope = raw_slope * 0.12 if (span_min < 1.0 and total_delta < 0.35) else raw_slope
    slope = max(-0.45, min(0.45, damped_slope))

    pred15 = round(current + slope * 15 * 0.85, 2)
    pred30 = round(current + slope * 30 * 0.70, 2)
    pred60 = round(current + slope * 60 * 0.52, 2)

    risk_pct = 8
    if current > target_max_c or current < target_min_c:
        risk_pct = 92
    elif pred30 > target_max_c or pred30 < target_min_c:
        risk_pct = 78
    elif pred60 > target_max_c or pred60 < target_min_c:
        risk_pct = 56
    elif (target_max_c - current < 1.2) or (current - target_min_c < 0.8):
        risk_pct = 36
    else:
        risk_pct = max(4, round(abs(slope) * 180))

    risk_level = "HIGH" if risk_pct >= 70 else ("MODERATE" if risk_pct >= 35 else "LOW")

    if current > target_max_c:
        recommendation = "CRITICAL: Cargo temperature above threshold. Inspect refrigeration compressor and door seal immediately."
    elif risk_level == "HIGH":
        recommendation = f"Thermal drift (+{slope:.2f}°C/min) projected to breach {target_max_c}°C within 30m."
    elif risk_level == "MODERATE":
        recommendation = "Mild thermal warming trend observed. Monitor door dwell intervals."
    else:
        recommendation = "Operating within GDP pharmaceutical cold-chain band (2.0–8.0°C)."

    return {
        "current_temp_c": round(current, 2),
        "predicted_15m_c": pred15,
        "predicted_30m_c": pred30,
        "predicted_60m_c": pred60,
        "rate_c_per_min": round(slope, 3),
        "excursion_risk_pct": risk_pct,
        "risk_level": risk_level,
        "baseline_ready": True,
        "recommendation": recommendation
    }


def point_in_polygon(lat: float, lng: float, coords: List[List[float]]) -> bool:
    inside = False
    j = len(coords) - 1
    for i in range(len(coords)):
        lat_i, lng_i = coords[i][0], coords[i][1]
        lat_j, lng_j = coords[j][0], coords[j][1]
        intersect = ((lng_i > lng) != (lng_j > lng)) and (lat < (lat_j - lat_i) * (lng - lng_i) / (lng_j - lng_i + 1e-9) + lat_i)
        if intersect:
            inside = not inside
        j = i
    return inside


def evaluate_geofences(lat: float, lng: float, geofences: List[Dict[str, Any]]) -> Dict[str, Any]:
    for gf in geofences:
        if not gf.get("enabled", True):
            continue
        geom = gf.get("geometry", {})
        gtype = geom.get("type", "CIRCLE").upper()
        if gtype == "CIRCLE":
            center = geom.get("center", {})
            c_lat = center.get("lat")
            c_lng = center.get("lng")
            radius = geom.get("radius_m", 500)
            if c_lat is not None and c_lng is not None:
                dist = haversine_meters(lat, lng, c_lat, c_lng)
                if dist <= radius:
                    return {"inside": True, "geofence_name": gf["name"], "geofence_id": gf["id"]}
        elif gtype == "POLYGON":
            coords = geom.get("coordinates", [])
            if coords and point_in_polygon(lat, lng, coords):
                return {"inside": True, "geofence_name": gf["name"], "geofence_id": gf["id"]}
    return {"inside": False, "geofence_name": None, "geofence_id": None}


class DeviceSimState:
    def __init__(self, dev: Dict[str, Any], initial_row: Optional[Dict[str, Any]] = None):
        self.device = dev
        self.dev_id = dev["device_id"]
        self.is_real = (self.dev_id == "GW-001")
        self.seq = initial_row["seq"] if initial_row else 1
        num_suffix = int("".join([c for c in self.dev_id if c.isdigit()] or ["1"]))
        self.progress = (num_suffix * 0.27) % 2.0
        self.route_id = int(dev.get("route_id", num_suffix % 3))
        self.route = HYDERABAD_CORRIDORS[self.route_id % len(HYDERABAD_CORRIDORS)] if not self.is_real else []

        default_temp = None if self.is_real else 4.4
        self.cargo_temp = initial_row.get("cargo_temp_c") if (initial_row and initial_row.get("cargo_temp_c") is not None) else default_temp
        self.ambient_temp = initial_row.get("ambient_temp_c", 30.2) if initial_row else 30.2
        self.humidity = 54.0
        self.door_status = str(initial_row.get("door_status", "SEALED")) if initial_row else "SEALED"
        self.tamper = bool(initial_row.get("tamper", False)) if initial_row else False
        self.compressor_active = True
        self.fault_mode = "NONE"
        self.stopped = self.is_real
        self.distance_km = float(initial_row.get("distance_km", 0.0)) if initial_row else 0.0
        
        default_lat = 17.4390934 if self.is_real else (self.route[0]["lat"] if self.route else 17.4483)
        default_lng = 78.3652306 if self.is_real else (self.route[0]["lng"] if self.route else 78.3915)
        self.anchor_lat = float(initial_row.get("lat", default_lat)) if initial_row else default_lat
        self.anchor_lng = float(initial_row.get("lng", default_lng)) if initial_row else default_lng
        self.battery_pct = float(initial_row.get("battery_pct", 95.0)) if initial_row else 95.0
        self.recent_samples: List[Dict[str, Any]] = []
        self.last_packet: Optional[Dict[str, Any]] = None


class TelemetryEngine:
    def __init__(self, db: Optional[ColdChainDatabase] = None):
        self.db = db or coldchain_db
        self.states: Dict[str, DeviceSimState] = {}
        self.geofences: List[Dict[str, Any]] = []
        self.paused = False
        self.last_alert_time: Dict[str, int] = {}
        self.broadcast_callback: Optional[Callable[[Dict[str, Any]], Any]] = None
        self.is_running = False
        self._task: Optional[asyncio.Task] = None
        self.alert_seq = 1000

        self.sync_devices()
        self.refresh_geofences()

    def sync_devices(self):
        devices = self.db.get_devices()
        valid_ids = {dev["device_id"] for dev in devices}
        self.states = {k: v for k, v in self.states.items() if k in valid_ids}
        fleet_rows = {r["device_id"]: r for r in self.db.get_fleet_rows()}
        for dev in devices:
            d_id = dev["device_id"]
            if d_id not in self.states:
                self.states[d_id] = DeviceSimState(dev, fleet_rows.get(d_id))
            else:
                self.states[d_id].device = dev

    def refresh_geofences(self):
        self.geofences = self.db.get_geofences()

    def register_broadcast_callback(self, cb: Callable[[Dict[str, Any]], Any]):
        self.broadcast_callback = cb

    async def broadcast(self, message: Dict[str, Any]):
        if self.broadcast_callback:
            try:
                res = self.broadcast_callback(message)
                if asyncio.iscoroutine(res):
                    await res
            except Exception as e:
                pass

    def step_tick(self, selected_dev_id: str = "GW-001") -> Dict[str, Any]:
        now_ms = int(time.time() * 1000)
        self.db.check_and_auto_close_inactive_trips()
        self.sync_devices()
        updated_rows = []
        selected_packet = None
        new_alerts = []

        for dev_id, state in self.states.items():
            if state.is_real or dev_id == "GW-001":
                # GW-001 is a physical IoT hardware tracking device.
                # Its coordinates and sensor values are updated strictly and exclusively
                # by incoming hardware telemetry packets (/api/v1/telemetry).
                # Do NOT simulate movement or overwrite with synthetic corridor positions!
                if dev_id == selected_dev_id:
                    selected_packet = state.last_packet or self.db.get_latest_packet(dev_id)
                continue

            if state.fault_mode == "SIGNAL_DROP":
                # Stale packet behavior for offline demonstration
                continue

            dev = state.device
            target_min = float(dev.get("target_min_c", 2.0))
            target_max = float(dev.get("target_max_c", 8.0))

            if not state.stopped:
                state.progress = (state.progress + 0.0022) % 2.0
            pos = interpolate_corridor_position(state.route, state.progress)
            speed = 0.0 if state.stopped else pos["speed_kmh"]

            # Temperature physics simulation
            target_mid = (target_min + target_max) / 2.0
            if state.fault_mode == "DOOR_BREACH":
                state.cargo_temp = round(min(14.0, state.cargo_temp + 0.14), 2)
            elif state.fault_mode == "COMPRESSOR_FAULT":
                state.cargo_temp = round(min(13.5, state.cargo_temp + 0.08), 2)
            else:
                if state.compressor_active:
                    cooling = (state.cargo_temp - target_mid) * 0.04
                    noise = (math.sin(state.seq * 0.2) * 0.03)
                    state.cargo_temp = round(max(target_min + 0.2, min(target_max - 0.2, state.cargo_temp - cooling + noise)), 2)

            # 100m GPS jitter noise filter for odometer
            dist_res, accepted = filter_and_accumulate_distance_km(
                state.anchor_lat, state.anchor_lng, pos["lat"], pos["lng"], state.distance_km
            )
            state.distance_km = dist_res
            if accepted:
                state.anchor_lat = pos["lat"]
                state.anchor_lng = pos["lng"]

            geo_check = evaluate_geofences(pos["lat"], pos["lng"], self.geofences)
            state.seq += 1
            rssi = -70 - (state.seq % 17)
            csq = max(10, min(31, int((rssi + 113) / 2)))

            packet = {
                "seq": state.seq,
                "device_id": dev["device_id"],
                "node_id": dev["node_id"],
                "recorded_at_ms": now_ms,
                "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now_ms / 1000)),
                "cargo_temp_c": state.cargo_temp,
                "ambient_temp_c": state.ambient_temp,
                "humidity_pct": state.humidity,
                "lat": pos["lat"],
                "lng": pos["lng"],
                "altitude_m": 542.0,
                "speed_kmh": speed,
                "heading_deg": pos["heading_deg"],
                "satellites": 11 + (state.seq % 4),
                "location_accuracy_m": 2.8,
                "network_rssi_dbm": rssi,
                "lte_csq": csq,
                "node_rssi_dbm": -63 - (state.seq % 9),
                "node_connected": True,
                "door_status": state.door_status,
                "tamper": state.tamper,
                "battery_pct": round(max(72.0, state.battery_pct - 0.002), 1),
                "compressor_active": state.compressor_active,
                "distance_km": state.distance_km,
                "address": pos["area"],
                "sub_area": pos["sub_area"],
                "geofence_name": geo_check["geofence_name"],
                "geofence_inside": geo_check["inside"]
            }

            state.last_packet = packet
            state.recent_samples.append({"recorded_at_ms": now_ms, "cargo_temp_c": state.cargo_temp})
            if len(state.recent_samples) > 20:
                state.recent_samples.pop(0)

            forecast = compute_thermal_forecast(state.recent_samples, target_min, target_max)

            # Health scoring
            health_score = 96.0
            if state.cargo_temp > target_max or state.cargo_temp < target_min:
                health_score -= 38.0
            elif state.cargo_temp > target_max - 0.8:
                health_score -= 18.0
            if state.door_status == "OPEN":
                health_score -= 24.0
            if state.tamper:
                health_score -= 14.0

            # Alert evaluation
            if state.cargo_temp > target_max:
                alert = self._maybe_create_alert(
                    dev_id, "Temperature Excursion",
                    f"Excursion alert on {dev['vehicle_name']}: {state.cargo_temp}°C breaches {target_max}°C ceiling.",
                    "CRITICAL", f"Thermal drift rate at {forecast['rate_c_per_min']:.2f}°C/min under load.",
                    now_ms
                )
                if alert:
                    new_alerts.append(alert)
            elif state.cargo_temp > target_max - 0.6:
                alert = self._maybe_create_alert(
                    dev_id, "Upper Limit Warning",
                    f"Warning: {dev['vehicle_name']} reading {state.cargo_temp}°C approaches {target_max}°C upper threshold.",
                    "HIGH", f"30m forecast projects {forecast['predicted_30m_c']}°C chamber temperature.",
                    now_ms
                )
                if alert:
                    new_alerts.append(alert)

            self.db.record_telemetry_point(packet, {
                "predicted_temp_30m_c": forecast["predicted_30m_c"],
                "excursion_risk_pct": forecast["excursion_risk_pct"],
                "health_score": max(20.0, health_score),
                "history_temps": [s["cargo_temp_c"] for s in state.recent_samples[-12:]]
            })

            if dev_id == selected_dev_id:
                selected_packet = packet

        overview = self.db.get_fleet_overview()
        fleet_rows = overview.get("fleet_table", [])

        hr_bucket = int(now_ms // 3600000)
        dt = time.gmtime(hr_bucket * 3600)
        label = f"{dt.tm_hour:02d}:00"
        matching_trend = next((t for t in overview["temperature_trend_24h"] if t["label"] == label), None)

        tick_msg = {
            "type": "TELEMETRY_TICK",
            "server_ts_ms": now_ms,
            "query_latency_ms": overview["query_latency_ms"],
            "tick": {
                "kpis": overview["kpis"],
                "fleet_health": overview["fleet_health"],
                "updates": fleet_rows,
                "trend_latest": matching_trend,
                "selected_packet": selected_packet or (self.db.get_latest_packet(selected_dev_id))
            }
        }
        return {"tick": tick_msg, "alerts": new_alerts, "overview": overview}

    def _maybe_create_alert(
        self, dev_id: str, alert_type: str, message: str, severity: str, ai_analysis: str, now_ms: int
    ) -> Optional[Dict[str, Any]]:
        key = f"{dev_id}:{alert_type}"
        last = self.last_alert_time.get(key, 0)
        if now_ms - last < 45000:
            return None
        self.last_alert_time[key] = now_ms
        self.alert_seq += 1
        return self.db.insert_alert({
            "alert_id": f"ALT-{str(now_ms)[-4:]}-{self.alert_seq}",
            "device_id": dev_id,
            "alert_type": alert_type,
            "message": message,
            "severity": severity,
            "ai_analysis": ai_analysis,
            "status": "Active",
            "created_at_ms": now_ms
        })

    def perform_action(self, device_id: str, action: str) -> Dict[str, Any]:
        # Support both naming conventions
        action_upper = action.upper()
        if action in ["pause", "PAUSE_STREAM"]:
            self.paused = True
            return {"paused": True, "overview": self.db.get_fleet_overview(), "action": action}
        elif action in ["resume", "RESUME_STREAM"]:
            self.paused = False
            return {"paused": False, "overview": self.db.get_fleet_overview(), "action": action}

        self.sync_devices()
        state = self.states.get(device_id)
        if not state:
            state = next(iter(self.states.values()), None)
            if not state:
                return {"error": f"Device {device_id} not found"}

        now_ms = int(time.time() * 1000)
        created_alert = None

        if action in ["DOOR_BREACH", "fault_door"]:
            state.fault_mode = "DOOR_BREACH"
            state.door_status = "OPEN"
            state.tamper = True
            base_t = state.cargo_temp if state.cargo_temp is not None else 4.4
            state.cargo_temp = round(max(base_t + 1.1, 7.2), 2)
            created_alert = self.db.insert_alert({
                "alert_id": f"ALT-{str(now_ms)[-4:]}-DOOR",
                "device_id": state.dev_id,
                "alert_type": "Door Breach",
                "message": f"Seal broken on {state.device['vehicle_name']}; cargo temp rising ({state.cargo_temp:.1f}°C).",
                "severity": "CRITICAL",
                "ai_analysis": "Optical door reed switch triggered outside authorized depot window.",
                "status": "Active",
                "created_at_ms": now_ms
            })
            self.step_tick(state.dev_id)
        elif action in ["COMPRESSOR_FAULT", "fault_excursion"]:
            state.fault_mode = "COMPRESSOR_FAULT"
            state.compressor_active = False
            base_t = state.cargo_temp if state.cargo_temp is not None else 4.4
            state.cargo_temp = round(max(base_t + 1.4, 8.3), 2)
            created_alert = self.db.insert_alert({
                "alert_id": f"ALT-{str(now_ms)[-4:]}-COMP",
                "device_id": state.dev_id,
                "alert_type": "Compressor Fault",
                "message": f"Reefer compressor current drop on {state.device['vehicle_name']}; temp at {state.cargo_temp:.1f}°C.",
                "severity": "HIGH",
                "ai_analysis": "Evaporator relay disabled; chamber rising toward critical pharma threshold.",
                "status": "Active",
                "created_at_ms": now_ms
            })
            self.step_tick(state.dev_id)
        elif action in ["SIGNAL_DROP", "fault_offline"]:
            state.fault_mode = "SIGNAL_DROP"
            stale_ms = now_ms - 315000
            stale_packet = {
                "seq": state.seq,
                "device_id": state.dev_id,
                "node_id": state.device["node_id"],
                "recorded_at_ms": stale_ms,
                "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(stale_ms / 1000)),
                "cargo_temp_c": state.cargo_temp,
                "ambient_temp_c": state.ambient_temp,
                "humidity_pct": state.humidity,
                "lat": state.anchor_lat,
                "lng": state.anchor_lng,
                "altitude_m": 542.0,
                "speed_kmh": 0.0,
                "heading_deg": 0,
                "satellites": 3,
                "location_accuracy_m": 48.0,
                "network_rssi_dbm": -111,
                "lte_csq": 2,
                "node_rssi_dbm": -96,
                "node_connected": False,
                "door_status": state.door_status,
                "tamper": state.tamper,
                "battery_pct": state.battery_pct,
                "compressor_active": state.compressor_active,
                "distance_km": state.distance_km,
                "address": "ORR Corridor",
                "sub_area": "Hyderabad",
                "geofence_name": None,
                "geofence_inside": False
            }
            state.last_packet = stale_packet
            pred_t = round(state.cargo_temp + 0.9, 2) if state.cargo_temp is not None else None
            self.db.record_telemetry_point(stale_packet, {
                "predicted_temp_30m_c": pred_t,
                "excursion_risk_pct": 68,
                "health_score": 44,
                "history_temps": [s["cargo_temp_c"] for s in state.recent_samples[-12:]]
            })
            created_alert = self.db.insert_alert({
                "alert_id": f"ALT-{str(now_ms)[-4:]}-OFFL",
                "device_id": state.dev_id,
                "alert_type": "Node Offline",
                "message": f"Heartbeat timeout (>300s) on {state.device['vehicle_name']}.",
                "severity": "CRITICAL",
                "ai_analysis": "Last known LTE CSQ dropped to -111 dBm prior to silence.",
                "status": "Active",
                "created_at_ms": now_ms
            })
        elif action in ["RESTORE_NORMAL", "reset_normal"]:
            state.fault_mode = "NONE"
            state.door_status = "SEALED"
            state.tamper = False
            state.compressor_active = True
            state.cargo_temp = 4.4
            self.step_tick(state.dev_id)
        elif action == "step":
            res = self.step_tick(state.dev_id)
            return {"paused": self.paused, "overview": res["overview"], "packet": self.db.get_latest_packet(state.dev_id)}

        return {
            "paused": self.paused,
            "overview": self.db.get_fleet_overview(),
            "alert": created_alert,
            "packet": self.db.get_latest_packet(state.dev_id)
        }

    async def run_loop(self):
        self.is_running = True
        while self.is_running:
            try:
                if not self.paused:
                    tick_res = self.step_tick()
                    await self.broadcast(tick_res["tick"])
                    for al in tick_res.get("alerts", []):
                        await self.broadcast({
                            "type": "ALERT_NEW",
                            "server_ts_ms": int(time.time() * 1000),
                            "alert": al
                        })
            except Exception as e:
                pass
            await asyncio.sleep(1.0)


# Global engine instance
coldchain_engine = TelemetryEngine()
