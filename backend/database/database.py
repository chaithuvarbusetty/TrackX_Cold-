"""
==============================================================================
FILE: database.py
PURPOSE:
Persistent Database Layer (SQLite / PostgreSQL compatible) for TracX.

STORES:
1. `devices`: Registered hardware units, metadata, vehicle info, and temperature thresholds.
2. `telemetry_history`: Time-series sensor logs with spatial GPS and AI inference records.
3. `alerts_history`: Complete audit trail of safety excursions and tamper alarms.
==============================================================================
"""

import sqlite3
import os
import json
import logging
from datetime import datetime
from typing import List, Dict, Any, Optional

logger = logging.getLogger("tracx.database")

DB_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "tracx_fleet.db")


def get_db_connection():
    """Establishes connection to SQLite database with dictionary cursor row support."""
    conn = sqlite3.connect(DB_FILE, timeout=30.0, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    try:
        conn.execute("PRAGMA busy_timeout = 30000;")
    except Exception:
        pass
    return conn


def init_database():
    """Initializes tables and indexes if they do not already exist."""
    try:
        conn = get_db_connection()
        try:
            conn.execute("PRAGMA journal_mode=WAL;")
        except Exception:
            pass
        cursor = conn.cursor()

        # 1. Devices Master Table
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS devices (
            device_id TEXT PRIMARY KEY,
            imei TEXT UNIQUE,
            vehicle_name TEXT NOT NULL,
            cargo_type TEXT NOT NULL,
            target_min_c REAL NOT NULL DEFAULT 2.0,
            target_max_c REAL NOT NULL DEFAULT 8.0,
            sampling_interval_sec INTEGER NOT NULL DEFAULT 5,
            is_active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """)

        # 2. Time-Series Telemetry Table (Partitioned/Indexed by device_id and timestamp)
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS telemetry_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            device_id TEXT NOT NULL,
            timestamp TEXT NOT NULL,
            lat REAL NOT NULL,
            lng REAL NOT NULL,
            speed_kmh REAL NOT NULL,
            heading_deg REAL NOT NULL,
            altitude_m REAL,
            cargo_temp_c REAL NOT NULL,
            ambient_temp_c REAL,
            imu_vector_g REAL,
            tamper_switch_closed INTEGER NOT NULL,
            battery_pct INTEGER NOT NULL,
            battery_voltage_v REAL,
            lte_csq INTEGER,
            ai_predicted_15m_c REAL,
            ai_risk_pct REAL,
            ai_risk_level TEXT,
            ai_driver_score INTEGER,
            FOREIGN KEY (device_id) REFERENCES devices (device_id)
        )
        """)

        # Index for fast time-series queries
        cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_telemetry_device_time 
        ON telemetry_history (device_id, timestamp DESC)
        """)

        # 3. Alerts Audit History Table
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS alerts_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            device_id TEXT NOT NULL,
            alert_id TEXT NOT NULL,
            severity TEXT NOT NULL,
            rule_name TEXT NOT NULL,
            message TEXT NOT NULL,
            timestamp TEXT NOT NULL,
            acknowledged INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY (device_id) REFERENCES devices (device_id)
        )
        """)

        # 4. Master Trips Table (Automated 30-min Trip Segmentation)
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS trips (
            trip_id TEXT PRIMARY KEY,
            device_id TEXT NOT NULL,
            start_time TEXT NOT NULL,
            end_time TEXT,
            duration_minutes REAL DEFAULT 0.0,
            moving_minutes REAL DEFAULT 0.0,
            halt_minutes REAL DEFAULT 0.0,
            total_distance_km REAL DEFAULT 0.0,
            max_speed_kmh REAL DEFAULT 0.0,
            avg_speed_kmh REAL DEFAULT 0.0,
            min_temp_c REAL,
            max_temp_c REAL,
            mkt_temp_c REAL,
            start_lat REAL,
            start_lng REAL,
            end_lat REAL,
            end_lng REAL,
            start_location TEXT,
            end_location TEXT,
            halt_count INTEGER DEFAULT 0,
            excursion_flag INTEGER DEFAULT 0,
            status TEXT DEFAULT 'ACTIVE',
            created_at TEXT NOT NULL,
            FOREIGN KEY (device_id) REFERENCES devices (device_id)
        )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_trips_dev ON trips (device_id, start_time DESC)")

        # 5. Trip Halts Table (Stoppages between 2 and 30 minutes)
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS trip_halts (
            halt_id TEXT PRIMARY KEY,
            trip_id TEXT NOT NULL,
            device_id TEXT NOT NULL,
            start_time TEXT NOT NULL,
            end_time TEXT,
            duration_minutes REAL DEFAULT 0.0,
            lat REAL NOT NULL,
            lng REAL NOT NULL,
            location_name TEXT,
            start_temp_c REAL,
            end_temp_c REAL,
            FOREIGN KEY (trip_id) REFERENCES trips (trip_id)
        )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_halts_trip ON trip_halts (trip_id)")

        # 6. Trip Waypoints Table (For breadcrumb route replay)
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS trip_waypoints (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            trip_id TEXT NOT NULL,
            timestamp TEXT NOT NULL,
            lat REAL NOT NULL,
            lng REAL NOT NULL,
            speed_kmh REAL NOT NULL,
            heading_deg REAL NOT NULL,
            cargo_temp_c REAL NOT NULL,
            FOREIGN KEY (trip_id) REFERENCES trips (trip_id)
        )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_wp_trip ON trip_waypoints (trip_id, timestamp ASC)")

        # 7. System Settings Table (For persistent Multi-Channel Webhook, Telegram, WhatsApp configs)
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS system_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """)

        # 8. Device Latest Telemetry & Raw Firmware State (Persists across restarts)
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS device_latest_state (
            device_id TEXT PRIMARY KEY,
            latest_telemetry_json TEXT NOT NULL,
            raw_payload_json TEXT,
            updated_at TEXT NOT NULL
        )
        """)

        # 9. Geofences Table (Circle, Polygon, Speed/Temp/Dwell Rule Sets)
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS geofences (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            device_id TEXT NOT NULL,
            geometry_type TEXT NOT NULL DEFAULT 'CIRCLE',
            center_lat REAL,
            center_lng REAL,
            radius_m REAL,
            polygon_coords_json TEXT,
            enabled INTEGER NOT NULL DEFAULT 1,
            alert_on_enter INTEGER NOT NULL DEFAULT 1,
            alert_on_exit INTEGER NOT NULL DEFAULT 1,
            alert_on_dwell INTEGER NOT NULL DEFAULT 0,
            dwell_seconds INTEGER NOT NULL DEFAULT 300,
            max_speed_kmh REAL,
            temperature_min_c REAL,
            temperature_max_c REAL,
            schedule_json TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_geo_device ON geofences (device_id, enabled)")

        # 10. Geofence Events Table (Audit Logs for Enter, Exit, Dwell, Breach)
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS geofence_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            geofence_id INTEGER,
            device_id TEXT NOT NULL,
            trip_id TEXT,
            event_type TEXT NOT NULL,
            latitude REAL,
            longitude REAL,
            accuracy_m REAL,
            distance_to_boundary_m REAL,
            temperature_c REAL,
            speed_kmh REAL,
            previous_state TEXT,
            new_state TEXT,
            severity TEXT NOT NULL DEFAULT 'INFO',
            timestamp TEXT NOT NULL,
            FOREIGN KEY (geofence_id) REFERENCES geofences (id)
        )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_geoevent_device ON geofence_events (device_id, timestamp DESC)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_geoevent_geo ON geofence_events (geofence_id, timestamp DESC)")

        conn.commit()
        conn.close()
    except Exception as e:
        pass


# ============================================================================
# DEVICE CRUD OPERATIONS (Create, Read, Update, Partial Update, Delete)
# ============================================================================

def db_add_device(device_data: dict) -> dict:
    """Inserts a new hardware device record into the database."""
    conn = get_db_connection()
    cursor = conn.cursor()
    now_str = datetime.utcnow().isoformat()

    cursor.execute("""
    INSERT INTO devices (device_id, imei, vehicle_name, cargo_type, target_min_c, target_max_c, sampling_interval_sec, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        device_data["device_id"],
        device_data.get("imei", f"8642010{device_data['device_id']}"),
        device_data["vehicle_name"],
        device_data.get("cargo_type", "General Goods"),
        device_data.get("target_min_c", 2.0),
        device_data.get("target_max_c", 8.0),
        device_data.get("sampling_interval_sec", 5),
        1 if device_data.get("is_active", True) else 0,
        now_str,
        now_str
    ))
    conn.commit()
    conn.close()
    return db_get_device(device_data["device_id"])


def db_get_device(device_id: str) -> Optional[dict]:
    """Retrieves a single device by ID."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM devices WHERE device_id = ?", (device_id,))
    row = cursor.fetchone()
    conn.close()
    return dict(row) if row else None


def db_get_all_devices() -> List[dict]:
    """Retrieves list of all registered fleet devices."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM devices ORDER BY created_at ASC")
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]


def db_partial_update_device(device_id: str, updates: dict) -> Optional[dict]:
    """
    Performs partial update (PATCH) on device attributes (e.g. Updating temperature
    thresholds target_min_c / target_max_c, vehicle_name, sampling_interval_sec).
    """
    conn = get_db_connection()
    cursor = conn.cursor()

    allowed_fields = [
        "vehicle_name", "cargo_type", "target_min_c", "target_max_c",
        "sampling_interval_sec", "is_active"
    ]
    set_clauses = []
    values = []

    for key, val in updates.items():
        if key in allowed_fields and val is not None:
            set_clauses.append(f"{key} = ?")
            values.append(val)

    if not set_clauses:
        conn.close()
        return db_get_device(device_id)

    set_clauses.append("updated_at = ?")
    values.append(datetime.utcnow().isoformat())
    values.append(device_id)

    query = f"UPDATE devices SET {', '.join(set_clauses)} WHERE device_id = ?"
    cursor.execute(query, values)
    conn.commit()
    conn.close()
    return db_get_device(device_id)


def db_delete_device(device_id: str) -> bool:
    """Removes a device record from database."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM devices WHERE device_id = ?", (device_id,))
    deleted = cursor.rowcount > 0
    conn.commit()
    conn.close()
    return deleted


# ============================================================================
# PERSISTENT TELEMETRY & ALERTS LOGGING
# ============================================================================

def db_save_telemetry(enriched_data: dict):
    """Saves raw sensor telemetry and AI predictions into the persistent SQLite database."""
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        raw = enriched_data["raw_telemetry"]
        ai = enriched_data.get("layer2_ai_intelligence", {})
        temp_ai = ai.get("temperature_prediction", {})
        driver_ai = ai.get("driver_behavior", {})

        cursor.execute("""
        INSERT INTO telemetry_history (
            device_id, timestamp, lat, lng, speed_kmh, heading_deg, altitude_m,
            cargo_temp_c, ambient_temp_c, imu_vector_g, tamper_switch_closed,
            battery_pct, battery_voltage_v, lte_csq,
            ai_predicted_15m_c, ai_risk_pct, ai_risk_level, ai_driver_score
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            enriched_data["device_id"],
            str(enriched_data["timestamp"]),
            raw["gps"].get("lat") if raw.get("gps", {}).get("lat") is not None else 0.0,
            raw["gps"].get("lng") if raw.get("gps", {}).get("lng") is not None else 0.0,
            raw["gps"].get("speed_kmh", 0.0),
            raw["gps"].get("heading_deg", 0.0),
            raw["gps"].get("altitude_m", 0.0),
            raw["temperature"].get("cargo_temp_c") if raw.get("temperature", {}).get("cargo_temp_c") is not None else -999.0,
            raw["temperature"].get("ambient_temp_c", 25.0) if raw.get("temperature", {}).get("ambient_temp_c") is not None else 25.0,
            driver_ai.get("vector_g_magnitude", 1.0),
            1 if raw.get("tamper_switch_closed", True) else 0,
            int((raw.get("power_network") or {}).get("battery_pct")) if (raw.get("power_network") or {}).get("battery_pct") is not None else 0,
            (raw.get("power_network") or {}).get("battery_voltage_v"),
            (raw.get("power_network") or {}).get("lte_csq_rssi"),
            temp_ai.get("predicted_temp_15m_c"),
            temp_ai.get("excursion_risk_pct"),
            temp_ai.get("risk_level"),
            driver_ai.get("driver_safety_score_100")
        ))

        # Also record any alerts
        for alert in enriched_data.get("layer1_deterministic_alerts", []):
            cursor.execute("""
            INSERT INTO alerts_history (device_id, alert_id, severity, rule_name, message, timestamp, acknowledged)
            VALUES (?, ?, ?, ?, ?, ?, 0)
            """, (
                enriched_data["device_id"],
                alert["alert_id"],
                alert["severity"],
                alert["rule_name"],
                alert["message"],
                str(alert["timestamp"])
            ))

        conn.commit()
        conn.close()
    except Exception as e:
        logger.exception("Failed to save telemetry to database: %s", e)


# ============================================================================
# TRIP & HALT DATABASE OPERATIONS
# ============================================================================

def db_get_active_trip(device_id: str) -> Optional[Dict[str, Any]]:
    """Fetches currently ongoing active trip for a vehicle, if one exists."""
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM trips WHERE device_id = ? AND status = 'ACTIVE' ORDER BY start_time DESC LIMIT 1", (device_id,))
        row = cursor.fetchone()
        conn.close()
        return dict(row) if row else None
    except Exception:
        return None


def db_create_trip(trip: Dict[str, Any]):
    """Inserts a newly initiated trip session."""
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("""
        INSERT INTO trips (
            trip_id, device_id, start_time, duration_minutes, moving_minutes, halt_minutes,
            total_distance_km, max_speed_kmh, avg_speed_kmh, min_temp_c, max_temp_c,
            start_lat, start_lng, start_location, halt_count, excursion_flag, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?)
        """, (
            trip["trip_id"], trip["device_id"], trip["start_time"],
            trip.get("duration_minutes", 0.0), trip.get("moving_minutes", 0.0), trip.get("halt_minutes", 0.0),
            trip.get("total_distance_km", 0.0), trip.get("max_speed_kmh", 0.0), trip.get("avg_speed_kmh", 0.0),
            trip.get("min_temp_c", 4.0), trip.get("max_temp_c", 4.0),
            trip.get("start_lat", 0.0), trip.get("start_lng", 0.0), trip.get("start_location", "Start Point"),
            trip.get("halt_count", 0), trip.get("excursion_flag", 0),
            datetime.utcnow().isoformat()
        ))
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"Error creating trip: {e}")


def db_update_trip(trip_id: str, updates: Dict[str, Any]):
    """Updates metrics or closes an ongoing trip session."""
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        set_clauses = [f"{k} = ?" for k in updates.keys()]
        values = list(updates.values()) + [trip_id]
        cursor.execute(f"UPDATE trips SET {', '.join(set_clauses)} WHERE trip_id = ?", values)
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"Error updating trip: {e}")


def db_get_vehicle_trips(device_id: str, limit: int = 20) -> List[Dict[str, Any]]:
    """Lists recent trips for a specific vehicle."""
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("""
        SELECT * FROM trips WHERE device_id = ? ORDER BY start_time DESC LIMIT ?
        """, (device_id, limit))
        rows = cursor.fetchall()
        conn.close()
        return [dict(r) for r in rows]
    except Exception:
        return []


def db_get_trip_details(trip_id: str) -> Optional[Dict[str, Any]]:
    """Retrieves full trip summary along with its stoppage halts and breadcrumb waypoints."""
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM trips WHERE trip_id = ?", (trip_id,))
        trip_row = cursor.fetchone()
        if not trip_row:
            conn.close()
            return None
        
        trip_data = dict(trip_row)

        # Get halts
        cursor.execute("SELECT * FROM trip_halts WHERE trip_id = ? ORDER BY start_time ASC", (trip_id,))
        trip_data["halts"] = [dict(h) for h in cursor.fetchall()]

        # Get waypoints for playback
        cursor.execute("SELECT timestamp, lat, lng, speed_kmh, heading_deg, cargo_temp_c FROM trip_waypoints WHERE trip_id = ? ORDER BY timestamp ASC", (trip_id,))
        trip_data["waypoints"] = [dict(w) for w in cursor.fetchall()]

        conn.close()
        return trip_data
    except Exception as e:
        print(f"Error getting trip details: {e}")
        return None


def db_add_trip_halt(halt: Dict[str, Any]):
    """Records a new stoppage halt event."""
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("""
        INSERT OR REPLACE INTO trip_halts (
            halt_id, trip_id, device_id, start_time, end_time, duration_minutes,
            lat, lng, location_name, start_temp_c, end_temp_c
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            halt["halt_id"], halt["trip_id"], halt["device_id"], halt["start_time"],
            halt.get("end_time"), halt.get("duration_minutes", 0.0),
            halt["lat"], halt["lng"], halt.get("location_name", "Halt Point"),
            halt.get("start_temp_c"), halt.get("end_temp_c")
        ))
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"Error adding halt: {e}")


def db_add_trip_waypoint(wp: Dict[str, Any]):
    """Appends a breadcrumb coordinate to a trip."""
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("""
        INSERT INTO trip_waypoints (trip_id, timestamp, lat, lng, speed_kmh, heading_deg, cargo_temp_c)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (
            wp["trip_id"], wp["timestamp"], wp["lat"], wp["lng"],
            wp["speed_kmh"], wp["heading_deg"], wp["cargo_temp_c"]
        ))
        conn.commit()
        conn.close()
    except Exception:
        pass


# ============================================================================
# SYSTEM SETTINGS & CHANNEL CONFIGURATIONS
# ============================================================================

def db_get_setting(key: str, default: Optional[str] = None) -> Optional[str]:
    """Retrieves a system setting from the database."""
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT value FROM system_settings WHERE key = ?", (key,))
        row = cursor.fetchone()
        conn.close()
        return row["value"] if row else default
    except Exception:
        return default


def db_set_setting(key: str, value: str):
    """Saves or updates a system setting in the database."""
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        now_str = datetime.utcnow().isoformat()
        cursor.execute("""
        INSERT OR REPLACE INTO system_settings (key, value, updated_at)
        VALUES (?, ?, ?)
        """, (key, str(value), now_str))
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"Error saving setting {key}: {e}")


def db_get_all_settings() -> Dict[str, str]:
    """Retrieves all system settings as a dictionary."""
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT key, value FROM system_settings")
        rows = cursor.fetchall()
        conn.close()
        return {r["key"]: r["value"] for r in rows}
    except Exception:
        return {}


def db_clear_all_telemetry_and_trips():
    """Wipes all test telemetry history, trips, halts, waypoints, and alerts from the database."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM telemetry_history")
    cursor.execute("DELETE FROM alerts_history")
    cursor.execute("DELETE FROM trip_waypoints")
    cursor.execute("DELETE FROM trip_halts")
    cursor.execute("DELETE FROM trips")
    conn.commit()
    conn.close()


def db_save_latest_device_state(device_id: str, latest_telemetry: dict, raw_payload: Optional[dict] = None):
    """Persists the latest enriched telemetry and raw firmware payload for a device."""
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        now_str = datetime.utcnow().isoformat()
        cursor.execute("""
        INSERT OR REPLACE INTO device_latest_state (device_id, latest_telemetry_json, raw_payload_json, updated_at)
        VALUES (?, ?, ?, ?)
        """, (
            device_id,
            json.dumps(latest_telemetry) if latest_telemetry else "{}",
            json.dumps(raw_payload) if raw_payload else None,
            now_str
        ))
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"Error persisting latest device state for {device_id}: {e}")


def db_get_latest_device_state(device_id: str) -> Optional[Dict[str, Any]]:
    """Retrieves the latest state record for a device from the database."""
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM device_latest_state WHERE device_id = ?", (device_id,))
        row = cursor.fetchone()
        conn.close()
        if not row:
            return None
        res = dict(row)
        if res.get("latest_telemetry_json"):
            try:
                res["latest_telemetry"] = json.loads(res["latest_telemetry_json"])
            except Exception:
                res["latest_telemetry"] = None
        if res.get("raw_payload_json"):
            try:
                res["raw_payload"] = json.loads(res["raw_payload_json"])
            except Exception:
                res["raw_payload"] = None
        return res
    except Exception:
        return None


def db_get_all_latest_device_states() -> List[Dict[str, Any]]:
    """Retrieves all latest state records from the database."""
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM device_latest_state")
        rows = cursor.fetchall()
        conn.close()
        results = []
        for r in rows:
            res = dict(r)
            if res.get("latest_telemetry_json"):
                try:
                    res["latest_telemetry"] = json.loads(res["latest_telemetry_json"])
                except Exception:
                    res["latest_telemetry"] = None
            if res.get("raw_payload_json"):
                try:
                    res["raw_payload"] = json.loads(res["raw_payload_json"])
                except Exception:
                    res["raw_payload"] = None
            results.append(res)
        return results
    except Exception:
        return []



# ============================================================================
# GEOFENCING & GEOFENCE EVENTS DATABASE OPERATIONS
# ============================================================================

def _format_geofence_row(row: dict) -> dict:
    """Formats a database row into a structured Geofence dictionary."""
    center = None
    if row.get("center_lat") is not None and row.get("center_lng") is not None:
        center = {
            "lat": float(row["center_lat"]),
            "lng": float(row["center_lng"])
        }
    
    polygon_coords = None
    if row.get("polygon_coords_json"):
        try:
            polygon_coords = json.loads(row["polygon_coords_json"])
        except Exception:
            polygon_coords = None

    schedule = {"enabled": False}
    if row.get("schedule_json"):
        try:
            schedule = json.loads(row["schedule_json"])
        except Exception:
            schedule = {"enabled": False}

    temp_rule = {
        "enabled": (row.get("temperature_min_c") is not None or row.get("temperature_max_c") is not None),
        "min_c": row.get("temperature_min_c"),
        "max_c": row.get("temperature_max_c")
    }

    geom_type = (row.get("geometry_type") or "CIRCLE").upper()
    if geom_type in ["POLYGON", "CORRIDOR"] and center is None and polygon_coords and len(polygon_coords) > 0:
        c_lat = sum(p[0] for p in polygon_coords) / len(polygon_coords)
        c_lng = sum(p[1] for p in polygon_coords) / len(polygon_coords)
        center = {"lat": round(c_lat, 6), "lng": round(c_lng, 6)}

    radius_val = float(row["radius_m"]) if row.get("radius_m") is not None else (500.0 if geom_type in ["CIRCLE", "CORRIDOR"] else None)

    corridor_envelope = None
    if geom_type == "CORRIDOR" and polygon_coords and len(polygon_coords) >= 2:
        try:
            from ..geofencing.geometry import generate_corridor_polygon
            corridor_envelope = generate_corridor_polygon(polygon_coords, radius_val or 500.0)
        except Exception:
            corridor_envelope = None

    return {
        "id": row["id"],
        "name": row["name"],
        "device_id": row["device_id"],
        "geometry": {
            "type": geom_type,
            "center": center,
            "radius_m": radius_val,
            "corridor_buffer_m": radius_val if geom_type == "CORRIDOR" else None,
            "coordinates": polygon_coords,
            "corridor_envelope": corridor_envelope
        },
        "rules": {
            "enter": bool(row.get("alert_on_enter", 1)),
            "exit": bool(row.get("alert_on_exit", 1)),
            "dwell": bool(row.get("alert_on_dwell", 0)),
            "dwell_seconds": int(row.get("dwell_seconds", 300)),
            "max_speed_kmh": float(row["max_speed_kmh"]) if row.get("max_speed_kmh") is not None else None,
            "temperature": temp_rule
        },
        "schedule": schedule,
        "enabled": bool(row.get("enabled", 1)),
        "created_at": row.get("created_at", ""),
        "updated_at": row.get("updated_at", "")
    }


def db_save_geofence(geo_dict: dict) -> dict:
    """Inserts a new geofence record into the SQLite database."""
    conn = get_db_connection()
    cursor = conn.cursor()
    now_str = datetime.utcnow().isoformat()

    geometry = geo_dict.get("geometry", {})
    center = geometry.get("center") or {}
    center_lat = center.get("lat") if isinstance(center, dict) else None
    center_lng = center.get("lng") if isinstance(center, dict) else None
    geom_type = (geometry.get("type") or "CIRCLE").upper()
    radius_m = geometry.get("radius_m")
    if radius_m is None and geometry.get("corridor_buffer_m") is not None:
        radius_m = geometry.get("corridor_buffer_m")
    if radius_m is None and geom_type in ["CIRCLE", "CORRIDOR"]:
        radius_m = 500.0
    poly_json = json.dumps(geometry.get("coordinates")) if geometry.get("coordinates") else None

    rules = geo_dict.get("rules", {})
    temp_rule = rules.get("temperature", {})
    temp_min = temp_rule.get("min_c") if temp_rule.get("enabled") else None
    temp_max = temp_rule.get("max_c") if temp_rule.get("enabled") else None

    schedule_json = json.dumps(geo_dict.get("schedule", {"enabled": False}))

    cursor.execute("""
    INSERT INTO geofences (
        name, device_id, geometry_type, center_lat, center_lng, radius_m,
        polygon_coords_json, enabled, alert_on_enter, alert_on_exit, alert_on_dwell,
        dwell_seconds, max_speed_kmh, temperature_min_c, temperature_max_c,
        schedule_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        geo_dict["name"],
        geo_dict["device_id"],
        geom_type,
        center_lat,
        center_lng,
        radius_m,
        poly_json,
        1 if geo_dict.get("enabled", True) else 0,
        1 if rules.get("enter", True) else 0,
        1 if rules.get("exit", True) else 0,
        1 if rules.get("dwell", False) else 0,
        rules.get("dwell_seconds", 300),
        rules.get("max_speed_kmh"),
        temp_min,
        temp_max,
        schedule_json,
        now_str,
        now_str
    ))

    new_id = cursor.lastrowid
    conn.commit()
    conn.close()

    return db_get_geofence(new_id)


def db_get_geofences(device_id: Optional[str] = None, enabled_only: bool = False) -> List[dict]:
    """Retrieves all geofences, optionally filtered by device and enabled state."""
    conn = get_db_connection()
    cursor = conn.cursor()

    query = "SELECT * FROM geofences WHERE 1=1"
    params = []
    if device_id:
        query += " AND device_id = ?"
        params.append(device_id)
    if enabled_only:
        query += " AND enabled = 1"
    
    query += " ORDER BY id DESC"

    cursor.execute(query, tuple(params))
    rows = cursor.fetchall()
    conn.close()

    return [_format_geofence_row(dict(r)) for r in rows]


def db_get_geofence(geofence_id: int) -> Optional[dict]:
    """Retrieves a single geofence by its ID."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM geofences WHERE id = ?", (geofence_id,))
    row = cursor.fetchone()
    conn.close()
    if not row:
        return None
    return _format_geofence_row(dict(row))


def db_update_geofence(geofence_id: int, updates: dict) -> Optional[dict]:
    """Updates an existing geofence record."""
    current = db_get_geofence(geofence_id)
    if not current:
        return None

    conn = get_db_connection()
    cursor = conn.cursor()
    now_str = datetime.utcnow().isoformat()

    name = updates.get("name", current["name"])
    device_id = updates.get("device_id", current["device_id"])
    enabled = 1 if updates.get("enabled", current["enabled"]) else 0

    geometry = updates.get("geometry") or current["geometry"]
    geom_type = geometry.get("type", current["geometry"]["type"])
    center = geometry.get("center") or (current["geometry"].get("center") or {})
    center_lat = center.get("lat") if isinstance(center, dict) else None
    center_lng = center.get("lng") if isinstance(center, dict) else None
    radius_m = geometry.get("radius_m", current["geometry"].get("radius_m", 500.0))
    poly_json = json.dumps(geometry.get("coordinates")) if geometry.get("coordinates") else None

    rules = updates.get("rules") or current["rules"]
    temp_rule = rules.get("temperature", {})
    temp_min = temp_rule.get("min_c") if temp_rule.get("enabled") else None
    temp_max = temp_rule.get("max_c") if temp_rule.get("enabled") else None

    schedule_json = json.dumps(updates.get("schedule") or current.get("schedule", {"enabled": False}))

    cursor.execute("""
    UPDATE geofences SET
        name = ?, device_id = ?, geometry_type = ?, center_lat = ?, center_lng = ?,
        radius_m = ?, polygon_coords_json = ?, enabled = ?, alert_on_enter = ?,
        alert_on_exit = ?, alert_on_dwell = ?, dwell_seconds = ?, max_speed_kmh = ?,
        temperature_min_c = ?, temperature_max_c = ?, schedule_json = ?, updated_at = ?
    WHERE id = ?
    """, (
        name,
        device_id,
        geom_type,
        center_lat,
        center_lng,
        radius_m,
        poly_json,
        enabled,
        1 if rules.get("enter", True) else 0,
        1 if rules.get("exit", True) else 0,
        1 if rules.get("dwell", False) else 0,
        rules.get("dwell_seconds", 300),
        rules.get("max_speed_kmh"),
        temp_min,
        temp_max,
        schedule_json,
        now_str,
        geofence_id
    ))
    conn.commit()
    conn.close()

    return db_get_geofence(geofence_id)


def db_delete_geofence(geofence_id: int) -> bool:
    """Deletes a geofence and its associated event history."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM geofence_events WHERE geofence_id = ?", (geofence_id,))
    cursor.execute("DELETE FROM geofences WHERE id = ?", (geofence_id,))
    deleted = cursor.rowcount > 0
    conn.commit()
    conn.close()
    return deleted


def db_save_geofence_event(event_dict: dict) -> dict:
    """Persists a geofence event (ENTER, EXIT, DWELL, SPEED_VIOLATION, TEMPERATURE_VIOLATION)."""
    conn = get_db_connection()
    cursor = conn.cursor()
    ts = event_dict.get("timestamp") or datetime.utcnow().isoformat()

    cursor.execute("""
    INSERT INTO geofence_events (
        geofence_id, device_id, trip_id, event_type, latitude, longitude,
        accuracy_m, distance_to_boundary_m, temperature_c, speed_kmh,
        previous_state, new_state, severity, timestamp
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        event_dict.get("geofence_id"),
        event_dict["device_id"],
        event_dict.get("trip_id"),
        event_dict["event_type"],
        event_dict.get("latitude"),
        event_dict.get("longitude"),
        event_dict.get("accuracy_m"),
        event_dict.get("distance_to_boundary_m"),
        event_dict.get("temperature_c"),
        event_dict.get("speed_kmh"),
        event_dict.get("previous_state"),
        event_dict.get("new_state"),
        event_dict.get("severity", "INFO"),
        ts
    ))

    event_id = cursor.lastrowid
    conn.commit()
    conn.close()

    event_dict["id"] = event_id
    return event_dict


def db_get_geofence_events(
    geofence_id: Optional[int] = None,
    device_id: Optional[str] = None,
    trip_id: Optional[str] = None,
    limit: int = 50
) -> List[dict]:
    """Retrieves chronological geofence audit events."""
    conn = get_db_connection()
    cursor = conn.cursor()

    query = """
    SELECT ge.*, g.name AS geofence_name
    FROM geofence_events ge
    LEFT JOIN geofences g ON ge.geofence_id = g.id
    WHERE 1=1
    """
    params = []

    if geofence_id:
        query += " AND ge.geofence_id = ?"
        params.append(geofence_id)
    if device_id:
        query += " AND ge.device_id = ?"
        params.append(device_id)
    if trip_id:
        query += " AND ge.trip_id = ?"
        params.append(trip_id)

    query += " ORDER BY ge.timestamp DESC LIMIT ?"
    params.append(limit)

    cursor.execute(query, tuple(params))
    rows = cursor.fetchall()
    conn.close()

    return [dict(r) for r in rows]


# Initialize database automatically on import if not already locked
try:
    init_database()
except Exception:
    pass



