"""
Backward compatibility proxy for AIEngine.
Points to the modular backend.ai package.
"""

from .ai.ai_engine import AIEngine
from .ai.temperature_prediction import TemperaturePredictor
from .ai.anomaly_detection import AnomalyDetector
from .ai.recommendations import DriverBehaviorModel, OperatorRecommendations, AIRecommendations
from .ai.risk_analysis import RiskAnalysisModel
from .ai.health_score import HealthScoreModel
from .ai.risk_fusion import AIRiskFusion
from .utils.gps_utils import haversine_km

__all__ = [
    "AIEngine",
    "TemperaturePredictor",
    "AnomalyDetector",
    "DriverBehaviorModel",
    "OperatorRecommendations",
    "AIRecommendations",
    "RiskAnalysisModel",
    "HealthScoreModel",
    "AIRiskFusion",
    "haversine_km"
]
