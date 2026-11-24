"""
==============================================================================
FILE: devices.py
PURPOSE:
Fleet Overview and Device Management REST API Routes for ColdChain CMS.
Provides indexed overview KPIs, device registration, and fleet hardware lists.
==============================================================================
"""

import time
from typing import List, Dict, Any, Optional
from fastapi import APIRouter, HTTPException, status, Request
from fastapi.responses import JSONResponse

from ...database.coldchain_db import coldchain_db
from ...services.coldchain_engine import coldchain_engine
from ..websocket import manager

devices_router = APIRouter(tags=["Devices & Fleet"])


@devices_router.get("/api/v1/fleet/overview")
async def get_fleet_overview():
    """Returns indexed fleet summary, active vehicles table, and 24h temperature trend."""
    overview = coldchain_db.get_fleet_overview()
    return overview


@devices_router.get("/api/v1/devices")
async def list_devices():
    """Lists all registered devices matching frontend expectations."""
    return {"devices": coldchain_db.get_devices()}


@devices_router.post("/api/v1/devices", status_code=status.HTTP_201_CREATED)
async def register_new_device(request: Request):
    """Registers a new vehicle hardware tracker and updates materialized hot state."""
    try:
        payload = await request.json()
    except Exception:
        payload = {}

    device_id = payload.get("device_id")
    vehicle_name = payload.get("vehicle_name")
    cargo_type = payload.get("cargo_type")

    if not device_id or not vehicle_name or not cargo_type:
        raise HTTPException(
            status_code=400,
            detail="device_id, vehicle_name, and cargo_type are required"
        )

    try:
        created = coldchain_db.register_device(payload)
        coldchain_engine.sync_devices()
        overview = coldchain_db.get_fleet_overview()

        await manager.broadcast({
            "type": "INITIAL_FLEET_STATE",
            "server_ts_ms": int(time.time() * 1000),
            "query_latency_ms": overview.get("query_latency_ms", 0.1),
            "fleet": overview.get("fleet_table", [])
        })

        return {"device": created, "overview": overview}
    except Exception as e:
        raise HTTPException(status_code=409, detail=str(e))


@devices_router.get("/api/v1/devices/{device_id}")
async def get_device_by_id(device_id: str):
    dev = coldchain_db.get_device(device_id)
    if not dev:
        raise HTTPException(status_code=404, detail=f"Device {device_id} not found")
    return dev


@devices_router.put("/api/v1/devices/{device_id}")
async def update_device_by_id(device_id: str, request: Request):
    """Updates vehicle metadata (name, cargo, min/max thresholds, IMEI) and broadcasts state."""
    try:
        payload = await request.json()
    except Exception:
        payload = {}

    target_min = payload.get("target_min_c")
    target_max = payload.get("target_max_c")
    if target_min is not None and target_max is not None:
        try:
            if float(target_min) >= float(target_max):
                raise HTTPException(
                    status_code=400,
                    detail="Target minimum temperature must be strictly less than target maximum temperature"
                )
        except ValueError:
            pass

    updated = coldchain_db.update_device(device_id, payload)
    if not updated:
        raise HTTPException(status_code=404, detail=f"Device {device_id} not found")

    coldchain_engine.sync_devices()
    overview = coldchain_db.get_fleet_overview()

    await manager.broadcast({
        "type": "INITIAL_FLEET_STATE",
        "server_ts_ms": int(time.time() * 1000),
        "query_latency_ms": overview.get("query_latency_ms", 0.1),
        "fleet": overview.get("fleet_table", [])
    })

    return {"device": updated, "overview": overview}


@devices_router.delete("/api/v1/devices/{device_id}")
async def delete_device(device_id: str):
    ok = coldchain_db.delete_device(device_id)
    if not ok:
        raise HTTPException(status_code=404, detail=f"Device {device_id} not found")
    coldchain_engine.sync_devices()
    overview = coldchain_db.get_fleet_overview()

    await manager.broadcast({
        "type": "INITIAL_FLEET_STATE",
        "server_ts_ms": int(time.time() * 1000),
        "query_latency_ms": overview.get("query_latency_ms", 0.1),
        "fleet": overview.get("fleet_table", [])
    })

    return {"deleted": True, "device_id": device_id, "message": f"Device {device_id} removed", "overview": overview}
