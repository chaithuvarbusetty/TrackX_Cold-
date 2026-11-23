"""
Status Processor: Evaluates physical enclosure, door state, and offline status.
"""

from typing import Dict, Any, Optional
from datetime import datetime
from ..utils.time_utils import elapsed_seconds
from ..core.constants import OFFLINE_TIMEOUT_SEC


class StatusProcessor:
    """Interprets device enclosure status and connectivity timeouts."""

    @staticmethod
    def process_door_and_tamper(door_status: Optional[str], tamper: Optional[bool]) -> Dict[str, Any]:
        """Classifies door and tamper switch status."""
        door_str = (door_status or "UNKNOWN").upper()
        is_sealed = door_str in ["CLOSED", "SEALED", "SECURE"]
        is_open = door_str in ["OPEN", "BREACHED", "UNLOCKED"]
        
        is_tampered = bool(tamper)

        return {
            "door_status": "SEALED" if is_sealed else ("OPEN" if is_open else "UNKNOWN"),
            "door_is_open": is_open,
            "tamper_detected": is_tampered,
            "enclosure_secure": is_sealed and not is_tampered
        }

    @staticmethod
    def evaluate_offline_timeout(last_received_time: Optional[datetime], timeout_sec: int = OFFLINE_TIMEOUT_SEC) -> Dict[str, Any]:
        """Determines if the device or node is offline based on packet arrival time."""
        if last_received_time is None:
            return {
                "is_offline": True,
                "elapsed_seconds": 999999.0,
                "status_label": "Offline"
            }

        elapsed = elapsed_seconds(last_received_time)
        is_offline = elapsed > timeout_sec

        return {
            "is_offline": is_offline,
            "elapsed_seconds": round(elapsed, 1),
            "status_label": "Offline" if is_offline else "Online"
        }
