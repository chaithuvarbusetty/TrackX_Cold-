"""
Proxy module re-exporting TripEngine and trip_engine from backend.services.trip_service.
Maintains 100% backward compatibility for all existing imports.
"""

from .services.trip_service import TripEngine, trip_engine

__all__ = ["TripEngine", "trip_engine"]
