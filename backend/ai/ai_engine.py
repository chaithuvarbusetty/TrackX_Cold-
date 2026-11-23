from datetime import datetime, timezone
from typing import Any, Dict

from ..schemas.telemetry import RawTelemetryPacket
from ..storage import store

from .temperature_prediction import TemperaturePredictor
from .anomaly_detection import GPSAnomalyDetector
from .risk_analysis import TamperRiskModel
from .health_score import HealthScoreModel
from .risk_fusion import AIRiskFusion
from .recommendations import AIRecommendations, DriverBehaviorModel, OperatorRecommendations


class AIEngine:
    """
    Central AI orchestration layer for TracX.

    Flow:

        Telemetry
            ↓
        Temperature Prediction
            ↓
        GPS Anomaly Detection
            ↓
        Tamper Detection
            ↓
        Device Health
            ↓
        Risk Fusion
            ↓
        Recommendations
    """

    @classmethod
    def evaluate(
        cls,
        packet: RawTelemetryPacket,
    ) -> Dict[str, Any]:

        device_id = packet.device_id

        # =========================================================
        # 1. LOAD TELEMETRY HISTORY
        # =========================================================

        history = store.get_history(
            device_id,
            limit=20,
        )

        previous_packets = [
            item.raw_telemetry
            for item in history
            if item.raw_telemetry is not None
        ]

        # =========================================================
        # 2. TEMPERATURE AI
        # =========================================================

        try:

            temp_ai = TemperaturePredictor.predict(
                packet,
                previous_packets,
            )

        except Exception as exc:

            temp_ai = None

            temperature_error = str(exc)

        else:

            temperature_error = None

        # =========================================================
        # 3. GPS AI
        # =========================================================

        try:

            gps_ai = GPSAnomalyDetector.detect(
                packet,
                previous_packets,
            )

        except Exception as exc:

            gps_ai = None

            gps_error = str(exc)

        else:

            gps_error = None

        # =========================================================
        # 4. TAMPER AI
        # =========================================================

        try:

            tamper_ai = TamperRiskModel.detect(
                current=packet,
                temperature_ai=temp_ai,
                gps_ai=gps_ai,
            )

        except Exception as exc:

            tamper_ai = None

            tamper_error = str(exc)

        else:

            tamper_error = None

        # =========================================================
        # 5. DEVICE HEALTH AI
        # =========================================================

        try:

            health_ai = HealthScoreModel.predict_device_health(
                current=packet,
                history=previous_packets,
            )

        except Exception as exc:

            health_ai = None

            health_error = str(exc)

        else:

            health_error = None

        # =========================================================
        # 6. RISK FUSION
        # =========================================================

        try:

            risk_fusion = AIRiskFusion.calculate(
                temperature_ai=temp_ai,
                gps_ai=gps_ai,
                tamper_ai=tamper_ai,
                health_ai=health_ai,
            )

        except Exception as exc:

            risk_fusion = {
                "overall_risk_score": 0,
                "risk_level": "UNKNOWN",
                "primary_risk": "AI_ERROR",
                "recommended_action": "AI analysis unavailable",
                "risk_sources": [],
            }

            risk_fusion_error = str(exc)

        else:

            risk_fusion_error = None

        # =========================================================
        # 7. AI RECOMMENDATIONS
        # =========================================================

        try:

            recommendations = AIRecommendations.generate(
                temperature_ai=temp_ai,
                gps_ai=gps_ai,
                tamper_ai=tamper_ai,
                health_ai=health_ai,
                risk_fusion=risk_fusion,
            )

        except Exception as exc:

            recommendations = [{
                "type": "SYSTEM",
                "priority": "HIGH",
                "title": "AI recommendation unavailable",
                "message": str(exc),
                "action": "Review AI service logs",
            }]

        # =========================================================
        # 8. BUILD FINAL RESPONSE
        # =========================================================

        tamper_data = (
            tamper_ai.model_dump()
            if tamper_ai is not None
            else None
        )

        try:
            driver_ai = DriverBehaviorModel.classify_driver_behavior(packet, previous_packets).model_dump()
        except Exception:
            driver_ai = None

        try:
            op_recs = OperatorRecommendations.generate_recommendations(packet, temp_ai)
        except Exception:
            op_recs = []

        result = {
            "device_id": device_id,

            "temperature_prediction": (
                temp_ai.model_dump()
                if temp_ai is not None
                else None
            ),

            "gps_intelligence": (
                gps_ai.model_dump()
                if gps_ai is not None
                else None
            ),

            "tamper_analysis": tamper_data,
            "tamper_fusion": tamper_data,

            "device_health": (
                health_ai.model_dump()
                if health_ai is not None
                else None
            ),

            "risk_fusion": risk_fusion,

            "recommendations": recommendations,
            "ai_recommendations": recommendations,
            "operator_recommendations": op_recs,
            "driver_behavior": driver_ai,

            "history_samples_used": len(
                previous_packets
            ),

            "model_version": "temperature-v2.0,gps-v2.0,tamper-v1.2,health-v2.0,risk-v2.0",
            "generated_at": datetime.now(timezone.utc).isoformat(),

            "ai_metadata": {
                "model_version": "tracx-ai-v2.0",
                "model_versions": {
                    "temperature": "temperature-v2.0",
                    "gps": "gps-v2.0",
                    "tamper": "tamper-v1.2",
                    "driver_behavior": "driver-imu-v2.0",
                    "device_health": "health-v2.0",
                    "risk_fusion": "risk-fusion-v2.0"
                },
                "generated_at": datetime.now(timezone.utc).isoformat()
            },

            "ai_status": "COMPLETED",
        }

        # =========================================================
        # 9. OPTIONAL ERROR INFORMATION
        # =========================================================

        errors = {}

        if temperature_error:
            errors["temperature"] = temperature_error

        if gps_error:
            errors["gps"] = gps_error

        if tamper_error:
            errors["tamper"] = tamper_error

        if health_error:
            errors["health"] = health_error

        if risk_fusion_error:
            errors["risk_fusion"] = risk_fusion_error

        if errors:

            result["ai_status"] = "PARTIAL"

            result["errors"] = errors

        return result
