"""
Trip Repository: Encapsulates SQL data access for trips, halts, and waypoints.
"""

from typing import List, Dict, Any, Optional
from ..database import (
    db_get_active_trip,
    db_create_trip,
    db_update_trip,
    db_get_vehicle_trips,
    db_get_trip_details,
    db_add_trip_halt,
    db_add_trip_waypoint
)


class TripRepository:
    """Data access repository for trips and waypoints in SQLite."""

    @staticmethod
    def get_active_trip(device_id: str) -> Optional[Dict[str, Any]]:
        return db_get_active_trip(device_id)

    @staticmethod
    def create(trip: Dict[str, Any]):
        return db_create_trip(trip)

    @staticmethod
    def update(trip_id: str, updates: Dict[str, Any]):
        return db_update_trip(trip_id, updates)

    @staticmethod
    def get_vehicle_trips(device_id: str, limit: int = 20) -> List[Dict[str, Any]]:
        return db_get_vehicle_trips(device_id, limit=limit)

    @staticmethod
    def get_trip_details(trip_id: str) -> Optional[Dict[str, Any]]:
        return db_get_trip_details(trip_id)

    @staticmethod
    def add_halt(halt: Dict[str, Any]):
        return db_add_trip_halt(halt)

    @staticmethod
    def add_waypoint(wp: Dict[str, Any]):
        return db_add_trip_waypoint(wp)
