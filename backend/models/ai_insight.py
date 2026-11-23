"""
Domain Entity Model for AI Insights and Predictions.
"""

from dataclasses import dataclass, field
from typing import Optional, List, Dict, Any


@dataclass
class AIInsightEntity:
    device_id: str
    timestamp: str
    temperature_prediction: Dict[str, Any]
    gps_intelligence: Dict[str, Any]
    driver_behavior: Dict[str, Any]
    tamper_fusion: Dict[str, Any]
    device_health: Dict[str, Any]
