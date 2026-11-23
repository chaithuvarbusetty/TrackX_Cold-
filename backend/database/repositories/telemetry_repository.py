"""
Telemetry Repository: Encapsulates SQL data access for telemetry time-series records.
"""

from typing import List, Dict, Any, Optional
from ..database import (
    db_save_telemetry,
    db_save_latest_device_state,
    db_get_latest_device_state,
    db_get_all_latest_device_states,
    db_clear_all_telemetry_and_trips
)


class TelemetryRepository:
    """Data access repository for telemetry events in SQLite."""

    @staticmethod
    def save(enriched_data: Dict[str, Any]):
        return db_save_telemetry(enriched_data)

    @staticmethod
    def save_latest_state(device_id: str, latest_telemetry: Dict[str, Any], raw_payload: Optional[Dict[str, Any]] = None):
        return db_save_latest_device_state(device_id, latest_telemetry, raw_payload)

    @staticmethod
    def get_latest_state(device_id: str) -> Optional[Dict[str, Any]]:
        return db_get_latest_device_state(device_id)

    @staticmethod
    def get_all_latest_states() -> List[Dict[str, Any]]:
        return db_get_all_latest_device_states()

    @staticmethod
    def clear_all():
        return db_clear_all_telemetry_and_trips()
