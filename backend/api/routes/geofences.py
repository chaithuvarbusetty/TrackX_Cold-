"""
==============================================================================
FILE: geofences.py
PURPOSE:
Geofence Perimeter Definition and Boundary Management Routes for ColdChain CMS.
==============================================================================
"""

from typing import Dict, Any
from fastapi import APIRouter, HTTPException, status
from ...database.coldchain_db import coldchain_db
from ...services.coldchain_engine import coldchain_engine

geofences_router = APIRouter(tags=["Geofences"])


@geofences_router.get("/api/v1/geofences")
async def list_geofences():
    """Lists all configured circular and polygonal geofence perimeters."""
    return {"geofences": coldchain_db.get_geofences()}


@geofences_router.post("/api/v1/geofences", status_code=status.HTTP_201_CREATED)
async def create_geofence(payload: Dict[str, Any]):
    """Creates a new spatial boundary rule with temperature and dwell thresholds."""
    if not payload.get("name") or not payload.get("geometry"):
        raise HTTPException(status_code=400, detail="name and geometry are required")
    geofence = coldchain_db.create_geofence(payload)
    coldchain_engine.refresh_geofences()
    return {"geofence": geofence}


@geofences_router.delete("/api/v1/geofences/{geofence_id}")
async def delete_geofence(geofence_id: int):
    """Deletes an active geofence perimeter."""
    deleted = coldchain_db.delete_geofence(geofence_id)
    coldchain_engine.refresh_geofences()
    return {"deleted": deleted}
