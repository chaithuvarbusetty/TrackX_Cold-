"""
Pydantic Schemas for Device Management & Fleet Configuration.
"""

from typing import Optional
from pydantic import BaseModel, Field


class DeviceCreateRequest(BaseModel):
    device_id: str = Field(..., description="Unique hardware ID (e.g. GW-001)")
    imei: Optional[str] = Field(None, description="15-digit Cellular Module IMEI")
    vehicle_name: str = Field(..., description="Vehicle name or label")
    cargo_type: str = Field("Vaccines / Pharmaceuticals", description="Cargo classification")
    target_min_c: float = Field(2.0, description="Minimum cold chain threshold (°C)")
    target_max_c: float = Field(8.0, description="Maximum cold chain threshold (°C)")
    sampling_interval_sec: int = Field(30, ge=1, le=3600, description="Telemetry interval in seconds")
    is_active: bool = Field(True)


class DeviceUpdateRequest(BaseModel):
    vehicle_name: Optional[str] = None
    cargo_type: Optional[str] = None
    target_min_c: Optional[float] = None
    target_max_c: Optional[float] = None
    sampling_interval_sec: Optional[int] = None
    is_active: Optional[bool] = None


class DeviceResponse(BaseModel):
    device_id: str
    imei: Optional[str]
    vehicle_name: str
    cargo_type: str
    target_min_c: float
    target_max_c: float
    sampling_interval_sec: int
    is_active: bool
    created_at: str
    updated_at: str
