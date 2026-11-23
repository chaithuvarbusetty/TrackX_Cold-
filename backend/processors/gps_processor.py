"""
GPS Data Processor: Deterministic technical validation and sanitization of GNSS coordinates.
Answers: "What is technically or physically invalid in the raw GPS stream?"
"""

from typing import Dict, Any, Optional
from datetime import datetime
from ..utils.gps_utils import is_valid_coordinate, haversine_km
from ..utils.time_utils import elapsed_seconds
from ..core.constants import GPS_ACCURACY_THRESHOLD_M, MAX_FEASIBLE_SPEED_KMH


class GPSProcessor:
    """Evaluates coordinate validity, Null Island, accuracy, and technical physical bounds."""

    @staticmethod
    def process_coordinates(
        lat: Optional[float], 
        lon: Optional[float], 
        accuracy_m: Optional[float] = None,
        location_source: Optional[str] = None,
        prev_lat: Optional[float] = None,
        prev_lon: Optional[float] = None,
        prev_time: Optional[datetime] = None,
        curr_time: Optional[datetime] = None
    ) -> Dict[str, Any]:
        """
        Validates raw coordinates and rejects technical anomalies.
        """
        valid = is_valid_coordinate(lat, lon)
        
        if not valid:
            return {
                "is_valid": False,
                "latitude": None,
                "longitude": None,
                "fix_status": "NO_FIX",
                "accuracy_m": None,
                "accuracy_quality": "POOR",
                "location_source": location_source or "NONE",
                "is_technically_impossible_jump": False,
                "reason": "Missing, Null Island (0,0), or out-of-bounds coordinates"
            }

        # Check for physically impossible coordinate jumps (Deterministic Teleport Rejector)
        impossible_jump = False
        jump_reason = None
        if prev_lat is not None and prev_lon is not None and prev_time is not None and curr_time is not None:
            if is_valid_coordinate(prev_lat, prev_lon):
                dt_sec = max(1.0, elapsed_seconds(prev_time, curr_time))
                dist_km = haversine_km(prev_lat, prev_lon, float(lat), float(lon))
                jump_speed_kmh = dist_km / (dt_sec / 3600.0)
                
                if jump_speed_kmh > MAX_FEASIBLE_SPEED_KMH:
                    impossible_jump = True
                    jump_reason = f"Impossible GPS jump: {jump_speed_kmh:.1f} km/h across {dt_sec:.0f}s"

        # Check accuracy rating
        acc_quality = "HIGH"
        if accuracy_m is not None:
            if accuracy_m > GPS_ACCURACY_THRESHOLD_M:
                acc_quality = "POOR"
            elif accuracy_m > 20.0:
                acc_quality = "MODERATE"

        return {
            "is_valid": not impossible_jump,
            "latitude": float(lat),
            "longitude": float(lon),
            "fix_status": "3D_FIX" if not impossible_jump else "REJECTED_JUMP",
            "accuracy_m": accuracy_m,
            "accuracy_quality": acc_quality,
            "location_source": location_source or "GNSS",
            "is_technically_impossible_jump": impossible_jump,
            "reason": jump_reason
        }
