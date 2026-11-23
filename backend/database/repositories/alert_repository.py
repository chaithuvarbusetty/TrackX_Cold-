"""
Alert Repository: Encapsulates SQL data access for Layer-1 alerts and incidents.
"""

from typing import List, Dict, Any, Optional
from ..storage import store


class AlertRepository:
    """Data access repository for safety alerts."""

    @staticmethod
    def get_recent(limit: int = 50) -> List[Dict[str, Any]]:
        return store.get_recent_alerts(limit=limit)

    @staticmethod
    def add(alert_data: Dict[str, Any]):
        return store.add_alert(alert_data)
