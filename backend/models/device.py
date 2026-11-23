"""
Domain Entity Model for Devices.
Represents physical tracking hardware in SQLite database.
"""

from dataclasses import dataclass
from typing import Optional


@dataclass
class DeviceEntity:
    device_id: str
    vehicle_name: str
    cargo_type: str
    target_min_c: float = 2.0
    target_max_c: float = 8.0
    sampling_interval_sec: int = 30
    is_active: bool = True
    imei: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
