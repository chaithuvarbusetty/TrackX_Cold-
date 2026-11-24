"""
==============================================================================
FILE: trips.py
PURPOSE:
Trip Analytics, Route Replays, and Journey Stoppage Routes for ColdChain CMS.
==============================================================================
"""

from typing import Optional, Dict, Any
from fastapi import APIRouter, HTTPException, Query, Body
from ...database.coldchain_db import coldchain_db

trips_router = APIRouter(tags=["Trips"])


@trips_router.get("/api/v1/trips")
async def list_trips(device_id: Optional[str] = Query(None)):
    """Retrieves all logged journeys or filtered by specific fleet vehicle."""
    trips = coldchain_db.get_trips(device_id=device_id)
    return {"trips": trips}


@trips_router.post("/api/v1/trips")
async def create_trip(payload: Dict[str, Any] = Body(...)):
    """Provisions and dispatches a brand new journey manifest for any vehicle."""
    if not payload.get("device_id"):
        raise HTTPException(status_code=400, detail="device_id is required")
    created = coldchain_db.create_trip(payload)
    return {"status": "ok", "trip": created}


@trips_router.put("/api/v1/trips/{trip_id}/complete")
async def complete_trip(trip_id: str):
    """Finalizes an ongoing journey manifest, computing total distance, duration, and MKT."""
    completed = coldchain_db.complete_trip(trip_id)
    if not completed:
        raise HTTPException(status_code=404, detail=f"Trip {trip_id} not found")
    return {"status": "ok", "trip": completed}


@trips_router.get("/api/v1/trips/details/{trip_id}")
async def get_trip_details(trip_id: str):
    """Retrieves comprehensive trip metadata, GPS breadcrumbs, and temperature halts."""
    details = coldchain_db.get_trip_details(trip_id)
    if not details:
        raise HTTPException(status_code=404, detail=f"Trip {trip_id} not found")
    return details


@trips_router.get("/api/v1/trips/daily/{device_id}")
async def get_daily_trips(device_id: str, date: Optional[str] = Query(None)):
    """Retrieves all trip journeys and waypoints for a device on a day to render multi-leg daily route map."""
    resolved_date = date if isinstance(date, str) else None
    legs = coldchain_db.get_daily_trips_for_device(device_id, resolved_date)
    return {"device_id": device_id, "legs": legs}
