"""
==============================================================================
FILE: trips.py
PURPOSE:
Trip Analytics, Route Replays, and Journey Stoppage Routes for ColdChain CMS.
==============================================================================
"""

from typing import Optional
from fastapi import APIRouter, HTTPException, Query
from ...database.coldchain_db import coldchain_db

trips_router = APIRouter(tags=["Trips"])


@trips_router.get("/api/v1/trips")
async def list_trips(device_id: Optional[str] = Query(None)):
    """Retrieves all logged journeys or filtered by specific fleet vehicle."""
    trips = coldchain_db.get_trips(device_id=device_id)
    return {"trips": trips}


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
    legs = coldchain_db.get_daily_trips_for_device(device_id, date)
    return {"device_id": device_id, "legs": legs}
