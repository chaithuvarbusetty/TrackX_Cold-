"""
==============================================================================
FILE: backend/geofencing/geometry.py
PURPOSE:
Mathematical Geometry Engine for Geofencing:
Haversine spherical distance and Point-in-Boundary (Circle & Polygon) algorithms.
==============================================================================
"""

from math import radians, sin, cos, sqrt, atan2
from typing import Dict, Any, List

EARTH_RADIUS_M = 6_371_000.0


def haversine_distance_m(
    lat1: float,
    lng1: float,
    lat2: float,
    lng2: float
) -> float:
    """Calculates great-circle distance between two GPS coordinates in meters."""
    lat1_r = radians(lat1)
    lat2_r = radians(lat2)
    dlat = radians(lat2 - lat1)
    dlng = radians(lng2 - lng1)
    a = (
        sin(dlat / 2) ** 2
        + cos(lat1_r) * cos(lat2_r) * sin(dlng / 2) ** 2
    )
    c = 2 * atan2(sqrt(a), sqrt(1 - a))
    return EARTH_RADIUS_M * c


def point_inside_circle(
    latitude: float,
    longitude: float,
    center_lat: float,
    center_lng: float,
    radius_m: float
) -> Dict[str, Any]:
    """
    Evaluates whether a vehicle location is within a circular geofence boundary.
    Returns:
        inside: bool
        distance_from_center_m: float
        distance_to_boundary_m: float (distance to the perimeter edge)
    """
    distance = haversine_distance_m(latitude, longitude, center_lat, center_lng)
    inside = distance <= radius_m
    return {
        "inside": inside,
        "distance_from_center_m": round(distance, 2),
        "distance_to_boundary_m": round(abs(radius_m - distance), 2)
    }


def distance_to_segment_m(
    p_lat: float, p_lng: float,
    a_lat: float, a_lng: float,
    b_lat: float, b_lng: float
) -> float:
    """Computes minimum distance in meters from point P to line segment AB."""
    mean_lat_r = radians((a_lat + b_lat + p_lat) / 3.0)
    cos_lat = cos(mean_lat_r)
    m_per_deg_lat = 111_139.0
    m_per_deg_lng = 111_139.0 * cos_lat

    ax, ay = a_lng * m_per_deg_lng, a_lat * m_per_deg_lat
    bx, by = b_lng * m_per_deg_lng, b_lat * m_per_deg_lat
    px, py = p_lng * m_per_deg_lng, p_lat * m_per_deg_lat

    dx, dy = bx - ax, by - ay
    seg_len_sq = dx * dx + dy * dy

    if seg_len_sq < 1e-6:
        return sqrt((px - ax) ** 2 + (py - ay) ** 2)

    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / seg_len_sq))
    proj_x = ax + t * dx
    proj_y = ay + t * dy

    return sqrt((px - proj_x) ** 2 + (py - proj_y) ** 2)


def point_inside_polygon(
    latitude: float,
    longitude: float,
    polygon_coords: List[List[float]]
) -> Dict[str, Any]:
    """
    Ray-casting algorithm to test whether a coordinate is inside a polygon perimeter.
    Computes exact distance to nearest boundary edge segment and distance from centroid.
    polygon_coords: [[lat, lng], [lat, lng], ...]
    """
    if not polygon_coords or len(polygon_coords) < 3:
        return {"inside": False, "distance_from_center_m": 0.0, "distance_to_boundary_m": 0.0}

    inside = False
    n = len(polygon_coords)
    p1_lat, p1_lng = polygon_coords[0]

    for i in range(1, n + 1):
        p2_lat, p2_lng = polygon_coords[i % n]
        if min(p1_lat, p2_lat) < latitude <= max(p1_lat, p2_lat):
            if longitude <= max(p1_lng, p2_lng):
                if p1_lat != p2_lat:
                    xinters = (latitude - p1_lat) * (p2_lng - p1_lng) / (p2_lat - p1_lat) + p1_lng
                    if p1_lng == p2_lng or longitude <= xinters:
                        inside = not inside
        p1_lat, p1_lng = p2_lat, p2_lng

    # Distance to the closest boundary edge segment
    min_dist_to_edge = float("inf")
    for i in range(n):
        a = polygon_coords[i]
        b = polygon_coords[(i + 1) % n]
        dist_edge = distance_to_segment_m(latitude, longitude, a[0], a[1], b[0], b[1])
        if dist_edge < min_dist_to_edge:
            min_dist_to_edge = dist_edge

    # Centroid distance
    c_lat = sum(p[0] for p in polygon_coords) / n
    c_lng = sum(p[1] for p in polygon_coords) / n
    dist_from_center = haversine_distance_m(latitude, longitude, c_lat, c_lng)

    return {
        "inside": inside,
        "distance_from_center_m": round(dist_from_center, 2),
        "distance_to_boundary_m": round(min_dist_to_edge, 2)
    }


def point_inside_corridor(
    latitude: float,
    longitude: float,
    corridor_coords: List[List[float]],
    buffer_width_m: float
) -> Dict[str, Any]:
    """
    Evaluates whether a vehicle location is within a buffered route corridor polyline.
    corridor_coords: [[lat, lng], [lat, lng], ...] route centerline waypoints.
    buffer_width_m: allowed lateral deviation tolerance in meters (e.g. 500m).

    Returns:
        inside: bool (True if distance to closest centerline segment <= buffer_width_m)
        distance_from_center_m: float (perpendicular/minimum distance to route centerline)
        distance_to_boundary_m: float (distance remaining before breaching corridor boundary)
        closest_segment_index: int
    """
    if not corridor_coords or len(corridor_coords) < 2:
        return {
            "inside": False,
            "distance_from_center_m": 0.0,
            "distance_to_boundary_m": 0.0,
            "closest_segment_index": 0
        }

    min_dist_to_centerline = float("inf")
    closest_idx = 0

    for i in range(len(corridor_coords) - 1):
        a = corridor_coords[i]
        b = corridor_coords[i + 1]
        dist_seg = distance_to_segment_m(latitude, longitude, a[0], a[1], b[0], b[1])
        if dist_seg < min_dist_to_centerline:
            min_dist_to_centerline = dist_seg
            closest_idx = i

    inside = min_dist_to_centerline <= buffer_width_m
    dist_to_boundary = abs(buffer_width_m - min_dist_to_centerline)

    return {
        "inside": inside,
        "distance_from_center_m": round(min_dist_to_centerline, 2),
        "distance_to_boundary_m": round(dist_to_boundary, 2),
        "closest_segment_index": closest_idx
    }


def generate_corridor_polygon(
    route_coords: List[List[float]],
    buffer_width_m: float
) -> List[List[float]]:
    """
    Constructs a closed polygon boundary enclosing a route polyline with specified buffer width in meters.
    Generates parallel offsets along the left (forward) and right (reversed) sides of the polyline.
    route_coords: [[lat, lng], ...]
    Returns: [[lat, lng], ...] forming a closed perimeter polygon.
    """
    if not route_coords or len(route_coords) < 2:
        return []

    m_lat = 111_139.0
    left_points: List[List[float]] = []
    right_points: List[List[float]] = []

    n = len(route_coords)
    for i in range(n):
        lat, lng = route_coords[i]
        cos_lat = cos(radians(lat))
        m_lng = m_lat * cos_lat

        # Determine segment tangent vector
        if i == 0:
            d_lat = route_coords[1][0] - lat
            d_lng = route_coords[1][1] - lng
        elif i == n - 1:
            d_lat = lat - route_coords[n - 2][0]
            d_lng = lng - route_coords[n - 2][1]
        else:
            d_lat = route_coords[i + 1][0] - route_coords[i - 1][0]
            d_lng = route_coords[i + 1][1] - route_coords[i - 1][1]

        dx_m = d_lng * m_lng
        dy_m = d_lat * m_lat
        len_m = sqrt(dx_m * dx_m + dy_m * dy_m)

        if len_m < 1e-4:
            nx_m, ny_m = 0.0, 1.0
        else:
            nx_m = -dy_m / len_m
            ny_m = dx_m / len_m

        off_lat = (ny_m * buffer_width_m) / m_lat
        off_lng = (nx_m * buffer_width_m) / m_lng

        left_points.append([round(lat + off_lat, 6), round(lng + off_lng, 6)])
        right_points.append([round(lat - off_lat, 6), round(lng - off_lng, 6)])

    return left_points + list(reversed(right_points))


