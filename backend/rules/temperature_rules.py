"""
Deterministic temperature safety rules for Cold-Chain compliance.
"""

import uuid
from typing import List, Optional
from datetime import datetime
from ..models import RuleAlert


class TemperatureRules:
    """Evaluates cargo temperature against hard pharmaceutical/food limits."""

    @staticmethod
    def evaluate(
        cargo_temp_c: Optional[float],
        target_min_c: Optional[float],
        target_max_c: Optional[float],
        probe_connected: bool = True,
        timestamp: Optional[datetime] = None
    ) -> List[RuleAlert]:
        alerts: List[RuleAlert] = []
        now = timestamp or datetime.utcnow()

        if not probe_connected:
            alerts.append(RuleAlert(
                alert_id=str(uuid.uuid4())[:8],
                severity="WARNING",
                rule_name="PROBE_DISCONNECTED",
                message="External DS18B20 temperature probe disconnected or open-circuit!",
                timestamp=now
            ))
            return alerts

        if cargo_temp_c is None:
            return alerts

        # Upper Excursion
        if target_max_c is not None and cargo_temp_c > target_max_c:
            alerts.append(RuleAlert(
                alert_id=str(uuid.uuid4())[:8],
                severity="CRITICAL",
                rule_name="COLD_CHAIN_HIGH_EXCURSION",
                message=f"Cargo temperature {cargo_temp_c:.1f}°C exceeded maximum safety threshold {target_max_c:.1f}°C!",
                timestamp=now
            ))

        # Freeze Breach
        elif target_min_c is not None and cargo_temp_c < target_min_c:
            alerts.append(RuleAlert(
                alert_id=str(uuid.uuid4())[:8],
                severity="CRITICAL",
                rule_name="COLD_CHAIN_FREEZE_RISK",
                message=f"Cargo temperature {cargo_temp_c:.1f}°C dropped below minimum safety threshold {target_min_c:.1f}°C!",
                timestamp=now
            ))

        return alerts
