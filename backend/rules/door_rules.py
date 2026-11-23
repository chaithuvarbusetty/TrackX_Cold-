"""
Deterministic door state rules for cargo enclosure integrity.
"""

import uuid
from typing import List, Optional
from datetime import datetime
from ..models import RuleAlert


class DoorRules:
    """Evaluates door breaches, especially when transit is underway."""

    @staticmethod
    def evaluate(
        door_is_open: bool,
        vehicle_speed_kmh: float = 0.0,
        timestamp: Optional[datetime] = None
    ) -> List[RuleAlert]:
        alerts: List[RuleAlert] = []
        now = timestamp or datetime.utcnow()

        if door_is_open:
            if vehicle_speed_kmh > 10.0:
                alerts.append(RuleAlert(
                    alert_id=str(uuid.uuid4())[:8],
                    severity="CRITICAL",
                    rule_name="DOOR_OPEN_IN_TRANSIT",
                    message=f"Cargo door breached while vehicle is moving at {vehicle_speed_kmh:.1f} km/h!",
                    timestamp=now
                ))
            else:
                alerts.append(RuleAlert(
                    alert_id=str(uuid.uuid4())[:8],
                    severity="WARNING",
                    rule_name="CARGO_DOOR_OPEN",
                    message="Refrigerated container door opened.",
                    timestamp=now
                ))

        return alerts
