"""
Pydantic Schemas for Trip Segmentation and Route Analytics.
"""

from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field


class TripHaltSchema(BaseModel):
    halt_id: str
    start_time: str
    end_time: Optional[str] = None
    duration_min: float
    lat: float
    lng: float
    temp_at_start: Optional[float] = None
    temp_at_end: Optional[float] = None


class TripWaypointSchema(BaseModel):
    timestamp: str
    lat: float
    lng: float
    speed_kmh: float
    temp_c: Optional[float] = None


class TripSummaryResponse(BaseModel):
    trip_id: str
    device_id: str
    start_time: str
    end_time: Optional[str] = None
    status: str
    distance_km: float
    duration_min: float
    max_speed_kmh: float
    avg_speed_kmh: float
    min_temp_c: Optional[float] = None
    max_temp_c: Optional[float] = None
    mkt_temp_c: Optional[float] = None
    excursion_count: int = 0
    halts: List[TripHaltSchema] = Field(default_factory=list)
