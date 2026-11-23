"""
==============================================================================
FILE: backend/services/geofence_service.py
PURPOSE:
Platform Service wrapper for the TracX Geofencing Subsystem.
==============================================================================
"""

from typing import Dict, Any, List, Optional
from ..geofencing.service import geofence_engine, GeofenceEngine
from ..geofencing.state_machine import GeofenceState


class GeofenceService:
    """Service facade exposing geofence operations to API routes and background tasks."""

    @classmethod
    def evaluate_telemetry(cls, telemetry: Dict[str, Any]) -> Dict[str, Any]:
        return geofence_engine.evaluate_telemetry(telemetry)

    @classmethod
    def create_geofence(cls, data: Dict[str, Any]) -> Dict[str, Any]:
        return geofence_engine.create_geofence(data)

    @classmethod
    def get_geofences(cls, device_id: Optional[str] = None, enabled_only: bool = False) -> List[Dict[str, Any]]:
        return geofence_engine.get_geofences(device_id=device_id, enabled_only=enabled_only)

    @classmethod
    def get_geofence(cls, geofence_id: int) -> Optional[Dict[str, Any]]:
        return geofence_engine.get_geofence(geofence_id)

    @classmethod
    def update_geofence(cls, geofence_id: int, updates: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        return geofence_engine.update_geofence(geofence_id, updates)

    @classmethod
    def delete_geofence(cls, geofence_id: int) -> bool:
        return geofence_engine.delete_geofence(geofence_id)

    @classmethod
    def get_events(
        cls,
        geofence_id: Optional[int] = None,
        device_id: Optional[str] = None,
        trip_id: Optional[str] = None,
        limit: int = 50
    ) -> List[Dict[str, Any]]:
        return geofence_engine.get_events(
            geofence_id=geofence_id,
            device_id=device_id,
            trip_id=trip_id,
            limit=limit
        )

    @classmethod
    def get_latest_status(cls, device_id: str) -> List[Dict[str, Any]]:
        return geofence_engine.get_latest_status(device_id)
