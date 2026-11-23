"""
Domain Entity Model for Trips, Halts, and Route Segments.
"""

from dataclasses import dataclass, field
from typing import Optional, List, Dict, Any


@dataclass
class TripEntity:
    trip_id: str
    device_id: str
    start_time: str
    end_time: Optional[str] = None
    status: str = "IN_PROGRESS"
    distance_km: float = 0.0
    duration_min: float = 0.0
    max_speed_kmh: float = 0.0
    avg_speed_kmh: float = 0.0
    min_temp_c: Optional[float] = None
    max_temp_c: Optional[float] = None
    mkt_temp_c: Optional[float] = None
    excursion_count: int = 0
    halts: List[Dict[str, Any]] = field(default_factory=list)
