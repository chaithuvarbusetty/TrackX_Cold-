"""
==============================================================================
FILE: test_sync.py
PURPOSE:
Full Integration Verification Suite for Synced Frontend & Backend.
Tests all API routes, database consistency, WebSocket protocols, and physics.
==============================================================================
"""

import asyncio
import json
import time

from backend.database.coldchain_db import coldchain_db
from backend.services.coldchain_engine import coldchain_engine
from backend.api.websocket import manager
from backend.api.routes.devices import get_fleet_overview, list_devices, register_new_device
from backend.api.routes.telemetry import health_check, get_latest_telemetry, export_telemetry_csv, ingest_hardware_telemetry
from backend.api.routes.trips import list_trips, get_trip_details, get_daily_trips
from backend.api.routes.geofences import list_geofences, create_geofence, delete_geofence
from backend.api.routes.alerts import list_alerts, update_alert_status
from backend.api.routes.ai import handle_simulation_action, get_database_diagnostics, run_live_database_benchmark


class MockWebSocket:
    def __init__(self):
        self.sent_messages = []
        self.accepted = False

    async def accept(self):
        self.accepted = True

    async def send_text(self, text):
        self.sent_messages.append(json.loads(text))


async def test_full_platform_sync():
    print("=" * 60)
    print("STARTING FULL PLATFORM SYNC TEST SUITE")
    print("=" * 60)

    # 1. Health check
    print("\n[TEST 1] Checking /api/v1/health...")
    h = await health_check()
    assert h["status"] == "ok"
    assert "engine" in h
    print("   ✓ Health check passed:", h["status"])

    # 2. Fleet Overview
    print("\n[TEST 2] Checking /api/v1/fleet/overview...")
    ov = await get_fleet_overview()
    assert "kpis" in ov
    assert "fleet_health" in ov
    assert "fleet_table" in ov
    assert "temperature_trend_24h" in ov
    assert len(ov["fleet_table"]) == 1
    print(f"   ✓ Fleet Overview passed: {ov['kpis']['total_vehicles']} vehicles, {len(ov['fleet_table'])} table rows")

    # 3. Devices Listing & Registration
    print("\n[TEST 3] Checking /api/v1/devices (GET & POST)...")
    devs = await list_devices()
    initial_count = len(devs["devices"])
    assert initial_count == 1
    print(f"   ✓ Device listing passed: {initial_count} devices found")

    test_dev_id = f"TEST-DEV-{int(time.time()) % 1000}"
    reg_res = await register_new_device({
        "device_id": test_dev_id,
        "vehicle_name": "Sync Test Truck",
        "cargo_type": "Insulin & Biologics",
        "target_min_c": 2.0,
        "target_max_c": 8.0,
        "sampling_interval_sec": 2
    })
    assert reg_res["device"]["device_id"] == test_dev_id
    assert reg_res["overview"]["kpis"]["total_vehicles"] == initial_count + 1
    print(f"   ✓ Device registration passed: {test_dev_id} provisioned")

    # Cleanup test device
    coldchain_db.delete_device(test_dev_id)
    coldchain_engine.sync_devices()

    # 4. Telemetry Latest & History
    print("\n[TEST 4] Checking /api/v1/telemetry/GW-001/latest...")
    telem = await get_latest_telemetry("GW-001")
    assert telem["packet"]["device_id"] == "GW-001"
    assert "forecast" in telem
    assert "baseline_ready" in telem["forecast"]
    print(f"   ✓ Latest Telemetry passed: Temp = {telem['packet']['cargo_temp_c']}°C, Risk = {telem['forecast']['risk_level']}")

    # 5. CSV Export
    print("\n[TEST 5] Checking /api/v1/telemetry/GW-001/export.csv...")
    csv_resp = await export_telemetry_csv("GW-001", limit=50)
    csv_text = csv_resp.body.decode("utf-8")
    assert "Sequence,Timestamp (UTC)" in csv_text
    assert "GW-001" in csv_text
    print(f"   ✓ CSV Export passed: {len(csv_text)} bytes generated")

    # 6. Trips & Details & Daily Trips
    print("\n[TEST 6] Checking /api/v1/trips & /api/v1/trips/daily/GW-001...")
    trips_res = await list_trips(None)
    assert len(trips_res["trips"]) > 0
    t_id = trips_res["trips"][0]["trip_id"]
    details = await get_trip_details(t_id)
    assert len(details["waypoints"]) > 0
    assert "start_time" in details and "end_time" in details
    daily_res = await get_daily_trips("GW-001")
    assert "legs" in daily_res and len(daily_res["legs"]) > 0
    print(f"   ✓ Trips passed: {len(trips_res['trips'])} trips, trip {t_id} has {len(details['waypoints'])} waypoints, daily legs: {len(daily_res['legs'])}")

    # 7. Geofences CRUD
    print("\n[TEST 7] Checking /api/v1/geofences...")
    geos = await list_geofences()
    assert len(geos["geofences"]) >= 3
    print(f"   ✓ Geofences listing passed: {len(geos['geofences'])} geofences")

    new_geo = await create_geofence({
        "name": "Sync Test Depot",
        "device_id": "ALL",
        "geometry": {"type": "CIRCLE", "center": {"lat": 17.4483, "lng": 78.3915}, "radius_m": 600},
        "rules": {"enter": True, "exit": True, "dwell": True, "dwell_seconds": 300},
        "enabled": True
    })
    geo_id = new_geo["geofence"]["id"]
    assert geo_id > 0
    del_res = await delete_geofence(geo_id)
    assert del_res["deleted"] is True
    print(f"   ✓ Geofence create & delete passed (ID: {geo_id})")

    # 8. Alerts & Status Update
    print("\n[TEST 8] Checking /api/v1/alerts...")
    alerts = await list_alerts(None, None, None)
    assert len(alerts["alerts"]) > 0
    a_id = alerts["alerts"][0]["alert_id"]
    upd_res = await update_alert_status(a_id, {"status": "Acknowledged"})
    assert upd_res["alert"]["status"] == "Acknowledged"
    print(f"   ✓ Alert status update passed: {a_id} marked Acknowledged")

    # 9. Simulation Action
    print("\n[TEST 9] Checking /api/v1/simulate/action (COMPRESSOR_FAULT)...")
    sim_res = await handle_simulation_action({"device_id": "GW-001", "action": "COMPRESSOR_FAULT"})
    assert sim_res.get("alert") is not None
    print(f"   ✓ Simulation fault passed: {sim_res['alert']['alert_type']} created")

    # Restore normal state
    await handle_simulation_action({"device_id": "GW-001", "action": "RESTORE_NORMAL"})
    print("   ✓ Reset to normal passed")

    # 10. Hardware Telemetry Ingestion
    print("\n[TEST 10] Checking POST /api/v1/telemetry (Live Quectel/ESP32 Ingestion)...")
    ingest_res = await ingest_hardware_telemetry({
        "device_id": "GW-001",
        "cargo_temp_c": 4.6,
        "ambient_temp_c": 30.5,
        "speed_kmh": 5.4,
        "latitude": 17.4390901,
        "longitude": 78.3652322,
        "door_status": "SEALED",
        "tamper": False
    })
    assert ingest_res["status"] == "ok"
    assert ingest_res["cargo_temp_c"] == 4.6
    print("   ✓ Hardware Ingestion passed: Live payload ingested and processed")

    # 10b. Real Hardware Payload with NULL Temperature & Probe Standby
    print("\n[TEST 10b] Checking POST /api/v1/telemetry with NULL Temperature & -75 dBm RSSI...")
    null_temp_res = await ingest_hardware_telemetry({
        "gateway_id": "GW-001",
        "temperature": None,
        "network_rssi": -75,
        "node_connected": False,
        "node_rssi": None,
        "latitude": 17.4390901,
        "longitude": 78.3652322,
        "location_accuracy": 23.6,
        "door_status": "UNKNOWN",
        "tamper": False
    })
    assert null_temp_res["status"] == "ok"
    assert null_temp_res["cargo_temp_c"] is None
    fleet = coldchain_db.get_fleet_rows()
    gw1 = next(r for r in fleet if r["device_id"] == "GW-001")
    assert gw1["current_temp_c"] is None
    assert gw1["network_rssi_dbm"] == -75
    assert gw1["connectivity"] == "ONLINE"
    assert gw1["node_connected"] is False
    print("   ✓ Real Hardware Standby passed: current_temp_c=None, network_rssi=-75 dBm, connectivity=ONLINE, node_connected=False")

    # 10c. Real Hardware Payload with NULL GPS Coordinates (Indoors / No Fix)
    print("\n[TEST 10c] Checking POST /api/v1/telemetry with NULL Latitude & Longitude (Awaiting Fix)...")
    null_gps_res = await ingest_hardware_telemetry({
        "gateway_id": "GW-001",
        "temperature": 28.5,
        "network_rssi": -77,
        "node_connected": True,
        "latitude": None,
        "longitude": None,
        "location_source": "NONE",
        "location_accuracy": None,
        "door_status": "SEALED",
        "tamper": False
    })
    assert null_gps_res["status"] == "ok"
    assert null_gps_res["lat"] is None, f"Expected lat to be None, got {null_gps_res['lat']}"
    assert null_gps_res["lng"] is None, f"Expected lng to be None, got {null_gps_res['lng']}"
    assert null_gps_res["has_gps_fix"] is False
    print("   ✓ Real Hardware No-Fix passed: lat=None, lng=None, has_gps_fix=False (No hardcoded coordinates injected)")

    # Ensure trip waypoints and latest state remain cleanly aligned to Sangareddy and return to standby offline
    with coldchain_db.get_connection() as c:
        c.execute("DELETE FROM trip_waypoints WHERE trip_id = 'TRP-2026-041' AND seq > 14;")
        past_ms = int((time.time() - 400) * 1000)
        c.execute("""
            UPDATE device_latest_state 
            SET lat = 17.4390901, lng = 78.3652322, speed_kmh = 0.0, heading_deg = 92, 
                cargo_temp_c = NULL,
                recorded_at_ms = ?,
                address = 'Financial District / Gachibowli', sub_area = 'Hyderabad, Telangana' 
            WHERE device_id = 'GW-001';
        """, (past_ms,))
        c.commit()

    # 11. DB Diagnostics & Benchmark
    print("\n[TEST 11] Checking /api/v1/db/diagnostics & benchmark...")
    diag = await get_database_diagnostics()
    assert diag["total_telemetry_rows"] > 5000
    assert len(diag["benchmarks"]) == 3
    bench_res = await run_live_database_benchmark()
    assert len(bench_res["benchmarks"]) == 3
    print(f"   ✓ DB Diagnostics & Benchmark passed: {diag['total_telemetry_rows']} rows, speedup={diag['benchmarks'][0]['speedup_factor']}x")

    # 12. WebSocket Integration
    print("\n[TEST 12] Checking /ws/telemetry WebSocket Protocol...")
    ws = MockWebSocket()
    await manager.connect(ws)
    assert ws.accepted
    assert len(ws.sent_messages) == 1
    init_msg = ws.sent_messages[0]
    assert init_msg["type"] == "INITIAL_FLEET_STATE"
    assert len(init_msg["fleet"]) == 1
    print(f"   ✓ WebSocket INITIAL_FLEET_STATE received with {len(init_msg['fleet'])} vehicles")

    manager.set_client_device(ws, "GW-001")
    tick_res = coldchain_engine.step_tick("GW-001")
    await manager.broadcast(tick_res["tick"])
    assert len(ws.sent_messages) == 2
    tick_msg = ws.sent_messages[1]
    assert tick_msg["type"] == "TELEMETRY_TICK"
    assert tick_msg["tick"]["selected_packet"]["device_id"] == "GW-001"
    print("   ✓ WebSocket TELEMETRY_TICK routing verified for selected device GW-001")

    manager.disconnect(ws)
    print("   ✓ WebSocket disconnect verified")

    print("\n" + "=" * 60)
    print("🎉 ALL 12 PLATFORM SYNC VERIFICATION TESTS PASSED SUCCESSFULLY!")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(test_full_platform_sync())
