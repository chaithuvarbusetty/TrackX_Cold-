"""
==============================================================================
FILE: backend/geofencing/evaluator.py
PURPOSE:
Evaluates incoming telemetry coordinates against active Geofence boundary definitions.
==============================================================================
"""

from typing import Dict, Any
from .geometry import point_inside_circle, point_inside_polygon, point_inside_corridor


def evaluate_geofence_boundary(
    latitude: float,
    longitude: float,
    geofence: Dict[str, Any]
) -> Dict[str, Any]:
    """
    Evaluates whether (latitude, longitude) is inside the given geofence.
    Supports CIRCLE, POLYGON, and CORRIDOR geometry types.
    """
    geom = geofence.get("geometry", {})
    geom_type = (geom.get("type") or "CIRCLE").upper()

    if geom_type == "CIRCLE":
        center = geom.get("center") or {}
        center_lat = center.get("lat")
        center_lng = center.get("lng")
        radius_m = float(geom.get("radius_m") or 500.0)

        if center_lat is None or center_lng is None:
            return {
                "inside": False,
                "distance_from_center_m": 0.0,
                "distance_to_boundary_m": 0.0
            }

        return point_inside_circle(
            latitude=latitude,
            longitude=longitude,
            center_lat=float(center_lat),
            center_lng=float(center_lng),
            radius_m=radius_m
        )

    elif geom_type == "POLYGON":
        coords = geom.get("coordinates") or []
        return point_inside_polygon(
            latitude=latitude,
            longitude=longitude,
            polygon_coords=coords
        )

    elif geom_type == "CORRIDOR":
        coords = geom.get("coordinates") or []
        buffer_width_m = float(geom.get("radius_m") or geom.get("corridor_buffer_m") or 500.0)
        return point_inside_corridor(
            latitude=latitude,
            longitude=longitude,
            corridor_coords=coords,
            buffer_width_m=buffer_width_m
        )

    return {
        "inside": False,
        "distance_from_center_m": 0.0,
        "distance_to_boundary_m": 0.0
    }
