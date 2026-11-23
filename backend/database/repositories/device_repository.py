"""
Device Repository: Encapsulates SQL data access for physical tracking hardware.
"""

from typing import List, Dict, Any, Optional
from ..database import (
    db_add_device,
    db_get_device,
    db_get_all_devices,
    db_partial_update_device,
    db_delete_device
)


class DeviceRepository:
    """Data access repository for Device records in SQLite."""

    @staticmethod
    def get_by_id(device_id: str) -> Optional[Dict[str, Any]]:
        return db_get_device(device_id)

    @staticmethod
    def get_all() -> List[Dict[str, Any]]:
        return db_get_all_devices()

    @staticmethod
    def add(device_data: Dict[str, Any]) -> Dict[str, Any]:
        return db_add_device(device_data)

    @staticmethod
    def update(device_id: str, updates: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        return db_partial_update_device(device_id, updates)

    @staticmethod
    def delete(device_id: str) -> bool:
        return db_delete_device(device_id)
