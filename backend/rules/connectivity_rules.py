"""
Deterministic connectivity rules for Gateway and Sensor Nodes.
"""

import uuid
from typing import List, Optional
from datetime import datetime
from ..models import RuleAlert
from ..core.constants import OFFLINE_TIMEOUT_SEC


class ConnectivityRules:
    """Evaluates telemetry freshness and node radio pairing status."""

    @staticmethod
    def evaluate(
        node_connected: bool,
        elapsed_since_last_packet_sec: float = 0.0,
        timestamp: Optional[datetime] = None
    ) -> List[RuleAlert]:
        alerts: List[RuleAlert] = []
        now = timestamp or datetime.utcnow()

        if elapsed_since_last_packet_sec > OFFLINE_TIMEOUT_SEC:
            alerts.append(RuleAlert(
                alert_id=str(uuid.uuid4())[:8],
                severity="WARNING",
                rule_name="GATEWAY_OFFLINE",
                message=f"No telemetry received for {elapsed_since_last_packet_sec:.0f} seconds. Device marked OFFLINE.",
                timestamp=now
            ))

        if not node_connected:
            alerts.append(RuleAlert(
                alert_id=str(uuid.uuid4())[:8],
                severity="INFO",
                rule_name="NODE_UNPAIRED",
                message="Wireless sensor node NODE-001 is offline or unlinked.",
                timestamp=now
            ))

        return alerts
