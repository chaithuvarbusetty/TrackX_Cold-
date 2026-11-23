"""
Domain Entity Model for Layer-1 Alerts.
"""

from dataclasses import dataclass
from datetime import datetime


@dataclass
class AlertEntity:
    alert_id: str
    device_id: str
    rule_name: str
    severity: str
    message: str
    timestamp: datetime
    acknowledged: bool = False
