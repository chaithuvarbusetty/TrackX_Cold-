"""
Domain Entity Model for Telemetry Records.
Represents time-series telemetry records persisted in SQLite database.
"""

from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional, Dict, Any


@dataclass
class TelemetryRecord:
    device_id: str
    timestamp: datetime
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    altitude_m: Optional[float] = None
    speed_kmh: float = 0.0
    heading_deg: float = 0.0
    cargo_temp_c: Optional[float] = None
    ambient_temp_c: Optional[float] = None
    door_status: str = "UNKNOWN"
    tamper: bool = False
    network_rssi: Optional[int] = None
    node_rssi: Optional[int] = None
    node_connected: bool = False
    is_excursion: bool = False
    raw_payload: Optional[Dict[str, Any]] = None
