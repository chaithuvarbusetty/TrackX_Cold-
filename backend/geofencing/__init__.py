"""
==============================================================================
TracX Geofencing Subsystem
Telemetry-driven spatial boundary evaluation, state tracking, and rule engines.
==============================================================================
"""

from .geometry import haversine_distance_m, point_inside_circle, point_inside_polygon
from .evaluator import evaluate_geofence_boundary
from .state_machine import GeofenceState, DeviceGeofenceTracker, GeofenceStateMachineManager
from .rules import GeofenceRuleEvaluator
from .service import GeofenceEngine, geofence_engine

__all__ = [
    "haversine_distance_m",
    "point_inside_circle",
    "point_inside_polygon",
    "evaluate_geofence_boundary",
    "GeofenceState",
    "DeviceGeofenceTracker",
    "GeofenceStateMachineManager",
    "GeofenceRuleEvaluator",
    "GeofenceEngine",
    "geofence_engine",
]
