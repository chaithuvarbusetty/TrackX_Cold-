"""
Pydantic Schemas for Layer-2 AI Intelligence Outputs.
Reflects predictions grounded in real cold-chain telematics.
"""

from typing import Optional, Literal, List
from pydantic import BaseModel, Field


class AIPredictiveTemperature(BaseModel):
    current_temp_c: Optional[float] = None
    rate_of_change_c_per_min: float = 0.0
    predicted_temp_15m_c: Optional[float] = None
    predicted_temp_30m_c: Optional[float] = None
    predicted_temp_60m_c: Optional[float] = None
    excursion_risk_pct: float = Field(0.0, ge=0.0, le=100.0)
    risk_level: Literal["LOW_NORMAL", "MODERATE_WATCH", "HIGH_RISK_EARLY_WARNING", "BREACH_IMMINENT"] = "LOW_NORMAL"
    estimated_time_to_breach_min: Optional[float] = None
    ai_recommendation: str = "EC200U Gateway connected. Awaiting sensor node telemetry."
    confidence_pct: Optional[float] = 100.0
    possible_cause: Optional[str] = "Awaiting wireless sensor node reading"
    action_summary: Optional[str] = "Gateway online. Sensor node awaiting transmission."


class AIGpsIntelligence(BaseModel):
    is_valid_kinematic: bool
    kinematic_anomaly_detected: bool
    anomaly_detected: Optional[bool] = None
    anomaly_score: Optional[float] = None
    anomaly_reason: Optional[str] = None
    reason: Optional[str] = None
    tracking_mode: Literal["GNSS_LOCKED", "DEAD_RECKONING_ACTIVE", "SIGNAL_LOST", "NO_FIX"] = "GNSS_LOCKED"
    dead_reckoning_lat: Optional[float] = None
    dead_reckoning_lng: Optional[float] = None
    position_confidence_pct: Optional[float] = 95.0
    confidence: Optional[float] = None
    speed_kmh: Optional[float] = None
    heading_deg: Optional[float] = None
    satellites_count: Optional[int] = None
    fix_status: Optional[str] = None

    def __init__(self, **data):
        super().__init__(**data)
        if self.anomaly_detected is None:
            self.anomaly_detected = self.kinematic_anomaly_detected
        if self.anomaly_score is None:
            self.anomaly_score = 70.0 if self.kinematic_anomaly_detected else 0.0

        if self.anomaly_reason is None and self.reason is not None:
            self.anomaly_reason = self.reason
        elif self.reason is None and self.anomaly_reason is not None:
            self.reason = self.anomaly_reason
        if self.confidence is not None:
            if self.position_confidence_pct is None or self.position_confidence_pct == 95.0:
                self.position_confidence_pct = round(self.confidence * 100.0, 1) if self.confidence <= 1.0 else round(self.confidence, 1)
        elif self.position_confidence_pct is not None and self.confidence is None:
            self.confidence = round(self.position_confidence_pct / 100.0, 2)



class AIDriverBehavior(BaseModel):
    behavior_class: Literal[
        "UNKNOWN",
        "SMOOTH_NORMAL", 
        "HARSH_ACCELERATION", 
        "HARSH_BRAKING", 
        "AGGRESSIVE_CORNERING", 
        "ROAD_BUMP_SHOCK", 
        "CRASH_ROLLOVER_IMPACT"
    ] = "UNKNOWN"
    jerk_magnitude_g_per_s: Optional[float] = None
    vector_g_magnitude: Optional[float] = None
    driver_safety_score_100: Optional[int] = None
    confidence_pct: Optional[float] = None


class AITamperFusion(BaseModel):
    is_tampered: bool = False
    tamper_score_pct: float = 0.0
    tamper_threat_level: Optional[str] = "SECURE"
    fusion_threat_score_pct: Optional[float] = 0.0
    correlated_factors: List[str] = Field(default_factory=list)
    tamper_score: Optional[float] = 0.0
    tamper_risk_score: Optional[float] = 0.0
    threat_level: Optional[str] = "SECURE"
    contributing_signals: List[str] = Field(default_factory=list)
    recommended_action: Optional[str] = None

    def __init__(self, **data):
        super().__init__(**data)
        if "tamper_score" in data and ("fusion_threat_score_pct" not in data or self.fusion_threat_score_pct == 0.0):
            self.fusion_threat_score_pct = float(self.tamper_score)
        elif "fusion_threat_score_pct" in data and ("tamper_score" not in data or self.tamper_score == 0.0):
            self.tamper_score = float(self.fusion_threat_score_pct)

        if self.tamper_risk_score == 0.0 or self.tamper_risk_score is None:
            self.tamper_risk_score = self.tamper_score

        if "threat_level" in data and ("tamper_threat_level" not in data or self.tamper_threat_level == "SECURE"):
            self.tamper_threat_level = self.threat_level
        elif "tamper_threat_level" in data and ("threat_level" not in data or self.threat_level == "SECURE"):
            self.threat_level = self.tamper_threat_level

        if self.tamper_score_pct == 0.0 and self.fusion_threat_score_pct:
            self.tamper_score_pct = float(self.fusion_threat_score_pct)

        if self.contributing_signals and not self.correlated_factors:
            self.correlated_factors = list(self.contributing_signals)
        elif self.correlated_factors and not self.contributing_signals:
            self.contributing_signals = list(self.correlated_factors)



class AIPredictiveDeviceHealth(BaseModel):
    overall_health_score_pct: Optional[int] = 100
    health_score_100: Optional[float] = 100.0
    health_status: Optional[str] = "HEALTHY"
    predicted_failure_risk: Optional[str] = "Not Available"
    battery_failure_risk: Optional[str] = "Not Available"
    connectivity_health: str = "4G LTE Active"
    node_health: str = "Sensor Node Paired & Active"
    health_factors: List[str] = Field(default_factory=list)
    risk_factors: List[str] = Field(default_factory=list)
    recommendations: List[str] = Field(default_factory=list)
    confidence_pct: Optional[float] = 0.0

    def __init__(self, **data):
        super().__init__(**data)
        if "health_score_100" in data and ("overall_health_score_pct" not in data or self.overall_health_score_pct == 100):
            self.overall_health_score_pct = int(round(float(self.health_score_100)))
        elif "overall_health_score_pct" in data and ("health_score_100" not in data or self.health_score_100 == 100.0):
            self.health_score_100 = float(self.overall_health_score_pct)

        if self.risk_factors and not self.health_factors:
            self.health_factors = list(self.risk_factors)
        elif self.health_factors and not self.risk_factors:
            self.risk_factors = list(self.health_factors)

        if any("probe" in f.lower() or "temperature" in f.lower() for f in (self.risk_factors or self.health_factors)):
            self.node_health = "Node Offline / Probe Awaiting Transmission"

        if "predicted_failure_risk" not in data and self.health_status:
            status_map = {
                "HEALTHY": "NEGLIGIBLE",
                "GOOD": "LOW",
                "WARNING": "ELEVATED",
                "DEGRADED": "CRITICAL",
                "CRITICAL": "CRITICAL"
            }
            if self.health_status in status_map:
                self.predicted_failure_risk = status_map[self.health_status]

