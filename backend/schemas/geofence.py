"""
==============================================================================
FILE: backend/schemas/geofence.py
PURPOSE:
Pydantic Schemas for Geofencing Engine: Boundary Geometries (Circle/Polygon),
Rule Sets (Enter, Exit, Dwell, Speed, Temp), Schedules, and Audit Event Logs.
==============================================================================
"""

from typing import Optional, List, Literal, Dict, Any
from pydantic import BaseModel, Field


class GeofenceCenter(BaseModel):
    lat: float = Field(..., ge=-90, le=90, description="Latitude in decimal degrees")
    lng: float = Field(..., ge=-180, le=180, description="Longitude in decimal degrees")


class GeofenceGeometry(BaseModel):
    type: Literal["CIRCLE", "POLYGON", "CORRIDOR"] = "CIRCLE"
    center: Optional[GeofenceCenter] = None
    radius_m: Optional[float] = Field(default=None, description="Perimeter radius in meters for CIRCLE or corridor buffer width in meters for CORRIDOR")
    corridor_buffer_m: Optional[float] = Field(default=None, description="Corridor buffer width in meters")
    coordinates: Optional[List[List[float]]] = None  # [[lat, lng], [lat, lng], ...] for polygons or corridor polyline
    corridor_envelope: Optional[List[List[float]]] = None  # Closed polygon coordinates enclosing the buffered corridor


class TemperatureRule(BaseModel):
    enabled: bool = False
    min_c: Optional[float] = None
    max_c: Optional[float] = None


class GeofenceRules(BaseModel):
    enter: bool = True
    exit: bool = True
    dwell: bool = False
    dwell_seconds: int = Field(default=300, ge=1, description="Minimum stationary seconds inside to trigger dwell")
    max_speed_kmh: Optional[float] = None
    temperature: TemperatureRule = TemperatureRule()


class GeofenceSchedule(BaseModel):
    enabled: bool = False
    start: Optional[str] = None
    end: Optional[str] = None


class GeofenceCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    device_id: str
    geometry: GeofenceGeometry
    rules: GeofenceRules = GeofenceRules()
    schedule: GeofenceSchedule = GeofenceSchedule()
    enabled: bool = True


class CreateCorridorFromTripRequest(BaseModel):
    name: Optional[str] = None
    buffer_width_m: float = Field(default=500.0, ge=50, le=10000)
    device_id: Optional[str] = None
    max_speed_kmh: Optional[float] = None
    temp_min_c: Optional[float] = 2.0
    temp_max_c: Optional[float] = 8.0


class GeofenceUpdate(BaseModel):
    name: Optional[str] = None
    device_id: Optional[str] = None
    geometry: Optional[GeofenceGeometry] = None
    rules: Optional[GeofenceRules] = None
    schedule: Optional[GeofenceSchedule] = None
    enabled: Optional[bool] = None


class GeofenceResponse(BaseModel):
    id: int
    name: str
    device_id: str
    geometry: GeofenceGeometry
    rules: GeofenceRules
    schedule: GeofenceSchedule
    enabled: bool
    created_at: str
    updated_at: str


class GeofenceEventResponse(BaseModel):
    id: int
    geofence_id: Optional[int] = None
    geofence_name: Optional[str] = None
    device_id: str
    trip_id: Optional[str] = None
    event_type: str
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    accuracy_m: Optional[float] = None
    distance_to_boundary_m: Optional[float] = None
    temperature_c: Optional[float] = None
    speed_kmh: Optional[float] = None
    previous_state: Optional[str] = None
    new_state: Optional[str] = None
    severity: str = "INFO"
    timestamp: str
