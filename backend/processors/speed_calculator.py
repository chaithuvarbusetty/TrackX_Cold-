"""
Speed Calculator: Computes velocity and movement status from successive GNSS points.
Firmware does not need to compute speed; the backend derives it automatically.
"""

from typing import Dict, Any, Optional
from datetime import datetime
from ..utils.gps_utils import haversine_km, haversine_meters, calculate_bearing, is_valid_coordinate
from ..utils.time_utils import elapsed_seconds
from ..core.constants import MAX_FEASIBLE_SPEED_KMH, STATIONARY_SPEED_THRESHOLD_KMH


class SpeedCalculator:
    """Calculates ground speed and movement status between two GPS points."""

    @staticmethod
    def calculate_speed(
        prev_lat: Optional[float],
        prev_lon: Optional[float],
        prev_time: Optional[datetime],
        curr_lat: Optional[float],
        curr_lon: Optional[float],
        curr_time: Optional[datetime],
        fallback_speed: Optional[float] = None
    ) -> Dict[str, Any]:
        """
        Derives speed in km/h from Haversine displacement and time difference.
        """
        if not is_valid_coordinate(curr_lat, curr_lon):
            return {
                "speed": 0.0,
                "speed_unit": "km/h",
                "speed_source": "INVALID_GPS",
                "movement_status": "UNKNOWN",
                "distance_meters": 0.0,
                "delta_time_seconds": 0.0,
                "bearing_deg": None
            }

        # If we have no valid previous point, use fallback or 0.0
        if not is_valid_coordinate(prev_lat, prev_lon) or prev_time is None or curr_time is None:
            speed = float(fallback_speed or 0.0)
            return {
                "speed": round(speed, 1),
                "speed_unit": "km/h",
                "speed_source": "FALLBACK" if fallback_speed is not None else "INITIAL_POINT",
                "movement_status": "MOVING" if speed > STATIONARY_SPEED_THRESHOLD_KMH else "STATIONARY",
                "distance_meters": 0.0,
                "delta_time_seconds": 0.0,
                "bearing_deg": None
            }

        # Calculate delta time
        dt_sec = elapsed_seconds(prev_time, curr_time)
        if dt_sec < 1.0:
            # Sub-second packet, retain previous speed or return 0
            return {
                "speed": round(float(fallback_speed or 0.0), 1),
                "speed_unit": "km/h",
                "speed_source": "SUB_SECOND_DELTA",
                "movement_status": "MOVING" if (fallback_speed or 0.0) > STATIONARY_SPEED_THRESHOLD_KMH else "STATIONARY",
                "distance_meters": 0.0,
                "delta_time_seconds": round(dt_sec, 2),
                "bearing_deg": None
            }

        # Compute displacement
        dist_km = haversine_km(prev_lat, prev_lon, curr_lat, curr_lon)
        dist_m = dist_km * 1000.0

        # Speed = distance (km) / time (hours)
        hours = dt_sec / 3600.0
        calculated_speed_kmh = dist_km / hours if hours > 0 else 0.0

        # Anomaly check: if computed speed exceeds physical feasibility (e.g. GPS multipath glitch)
        if calculated_speed_kmh > MAX_FEASIBLE_SPEED_KMH:
            return {
                "speed": 0.0,
                "speed_unit": "km/h",
                "speed_source": "REJECTED_GPS_JUMP",
                "movement_status": "STATIONARY",
                "distance_meters": round(dist_m, 1),
                "delta_time_seconds": round(dt_sec, 1),
                "bearing_deg": None
            }

        # Jitter filter: displacement < 8m in 30s is normal GPS noise while stationary
        if dist_m < 8.0 and calculated_speed_kmh < STATIONARY_SPEED_THRESHOLD_KMH:
            return {
                "speed": 0.0,
                "speed_unit": "km/h",
                "speed_source": "GPS_CALCULATED",
                "movement_status": "STATIONARY",
                "distance_meters": round(dist_m, 1),
                "delta_time_seconds": round(dt_sec, 1),
                "bearing_deg": None
            }

        bearing = calculate_bearing(prev_lat, prev_lon, curr_lat, curr_lon)
        return {
            "speed": round(calculated_speed_kmh, 1),
            "speed_unit": "km/h",
            "speed_source": "GPS_CALCULATED",
            "movement_status": "MOVING" if calculated_speed_kmh >= STATIONARY_SPEED_THRESHOLD_KMH else "STATIONARY",
            "distance_meters": round(dist_m, 1),
            "delta_time_seconds": round(dt_sec, 1),
            "bearing_deg": bearing
        }
