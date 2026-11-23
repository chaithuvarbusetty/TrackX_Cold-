"""
Geographic coordinate utilities and distance computations.
"""

import math
from typing import Tuple, Optional


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate the great-circle distance between two points on the Earth in kilometers."""
    R = 6371.0  # Earth's radius in km
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat / 2) ** 2 +
         math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) *
         math.sin(dlon / 2) ** 2)
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c


def haversine_meters(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate the great-circle distance between two points on the Earth in meters."""
    return haversine_km(lat1, lon1, lat2, lon2) * 1000.0


def calculate_bearing(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate the compass bearing (azimuth in degrees) from point 1 to point 2."""
    lat1_r = math.radians(lat1)
    lat2_r = math.radians(lat2)
    diff_long_r = math.radians(lon2 - lon1)

    x = math.sin(diff_long_r) * math.cos(lat2_r)
    y = math.cos(lat1_r) * math.sin(lat2_r) - (math.sin(lat1_r) * math.cos(lat2_r) * math.cos(diff_long_r))

    initial_bearing = math.atan2(x, y)
    initial_bearing = math.degrees(initial_bearing)
    compass_bearing = (initial_bearing + 360.0) % 360.0
    return round(compass_bearing, 1)


def is_valid_coordinate(lat: Optional[float], lon: Optional[float]) -> bool:
    """Validates whether a latitude and longitude are within physical Earth bounds."""
    if lat is None or lon is None:
        return False
    if math.isnan(lat) or math.isnan(lon):
        return False
    # (0.0, 0.0) is Null Island (often emitted by uninitialized GPS chips)
    if abs(lat) < 0.0001 and abs(lon) < 0.0001:
        return False
    return -90.0 <= lat <= 90.0 and -180.0 <= lon <= 180.0
