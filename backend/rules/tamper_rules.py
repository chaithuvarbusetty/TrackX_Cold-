"""
Deterministic tamper microswitch rules.
"""

import uuid
from typing import List, Optional
from datetime import datetime
from ..models import RuleAlert


class TamperRules:
    """Evaluates enclosure microswitch and physical enclosure breaches."""

    @staticmethod
    def evaluate(
        tamper_switch_closed: bool,
        timestamp: Optional[datetime] = None
    ) -> List[RuleAlert]:
        alerts: List[RuleAlert] = []
        now = timestamp or datetime.utcnow()

        if not tamper_switch_closed:
            alerts.append(RuleAlert(
                alert_id=str(uuid.uuid4())[:8],
                severity="CRITICAL",
                rule_name="ENCLOSURE_TAMPER_OPEN",
                message="Device enclosure opened! Security tamper microswitch activated.",
                timestamp=now
            ))

        return alerts
