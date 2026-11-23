"""
AI Recommendations Module: Generates context-aware, prescriptive operator guidance
based on real cold-chain telemetry events (Node pairing, temperature trends, door status).
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional
from ..schemas.telemetry import RawTelemetryPacket
from ..schemas.ai import AIDriverBehavior, AIPredictiveTemperature


class AIRecommendations:
    """
    Structured cross-model AI prescriptive recommendations generator.
    """

    @classmethod
    def generate(
        cls,
        temperature_ai=None,
        gps_ai=None,
        tamper_ai=None,
        health_ai=None,
        risk_fusion: Dict[str, Any] | None = None,
    ) -> List[Dict[str, Any]]:

        recommendations: List[Dict[str, Any]] = []

        # =========================================================
        # 1. TEMPERATURE
        # =========================================================

        if temperature_ai is not None:

            risk_pct = float(
                getattr(
                    temperature_ai,
                    "excursion_risk_pct",
                    0
                ) or 0
            )

            risk_level = str(
                getattr(
                    temperature_ai,
                    "risk_level",
                    "LOW"
                )
            ).upper()

            predicted_15m = getattr(
                temperature_ai,
                "predicted_temp_15m_c",
                None
            )

            predicted_30m = getattr(
                temperature_ai,
                "predicted_temp_30m_c",
                None
            )

            if risk_pct >= 80:

                recommendations.append({
                    "type": "TEMPERATURE",
                    "priority": "CRITICAL",
                    "title": "Temperature excursion predicted",
                    "message": (
                        "Cargo temperature is likely to breach "
                        "the configured safe range."
                    ),
                    "action": (
                        "Inspect refrigeration system immediately."
                    ),
                    "risk_score": risk_pct,
                    "predicted_temp_15m_c": predicted_15m,
                    "predicted_temp_30m_c": predicted_30m,
                })

            elif risk_pct >= 60:

                recommendations.append({
                    "type": "TEMPERATURE",
                    "priority": "HIGH",
                    "title": "Temperature trend requires attention",
                    "message": (
                        "Temperature is trending toward the "
                        "configured safety limit."
                    ),
                    "action": (
                        "Monitor cargo temperature and refrigeration."
                    ),
                    "risk_score": risk_pct,
                    "predicted_temp_15m_c": predicted_15m,
                    "predicted_temp_30m_c": predicted_30m,
                })

            elif risk_pct >= 35:

                recommendations.append({
                    "type": "TEMPERATURE",
                    "priority": "MEDIUM",
                    "title": "Temperature trend detected",
                    "message": (
                        "Temperature movement requires monitoring."
                    ),
                    "action": (
                        "Continue monitoring the temperature trend."
                    ),
                    "risk_score": risk_pct,
                    "predicted_temp_15m_c": predicted_15m,
                    "predicted_temp_30m_c": predicted_30m,
                })

        # =========================================================
        # 2. GPS
        # =========================================================

        if gps_ai is not None:

            anomaly = bool(
                getattr(
                    gps_ai,
                    "anomaly_detected",
                    getattr(gps_ai, "kinematic_anomaly_detected", False)
                )
            )

            if anomaly:

                recommendations.append({
                    "type": "GPS",
                    "priority": "HIGH",
                    "title": "GPS anomaly detected",
                    "message": (
                        "The reported GPS movement is inconsistent "
                        "with recent telemetry."
                    ),
                    "action": (
                        "Verify GPS signal and device location."
                    ),
                })

        # =========================================================
        # 3. TAMPER
        # =========================================================

        if tamper_ai is not None:

            tamper_score = float(
                getattr(
                    tamper_ai,
                    "tamper_risk_score",
                    getattr(tamper_ai, "tamper_score", 0)
                ) or 0
            )

            if tamper_score >= 80:

                recommendations.append({
                    "type": "TAMPER",
                    "priority": "CRITICAL",
                    "title": "Critical tamper risk",
                    "message": (
                        "Suspicious physical access to the "
                        "cold-storage device may have occurred."
                    ),
                    "action": (
                        "Inspect the container and tamper switch immediately."
                    ),
                    "risk_score": tamper_score,
                })

            elif tamper_score >= 60:

                recommendations.append({
                    "type": "TAMPER",
                    "priority": "HIGH",
                    "title": "Tamper activity detected",
                    "message": (
                        "The device has detected suspicious "
                        "tamper-related activity."
                    ),
                    "action": (
                        "Verify container security."
                    ),
                    "risk_score": tamper_score,
                })

        # =========================================================
        # 4. DEVICE HEALTH
        # =========================================================

        if health_ai is not None:

            health_score = float(
                getattr(
                    health_ai,
                    "health_score_100",
                    getattr(health_ai, "overall_health_score_pct", 100)
                ) or 100
            )

            if health_score < 40:

                recommendations.append({
                    "type": "DEVICE_HEALTH",
                    "priority": "CRITICAL",
                    "title": "Device health is critical",
                    "message": (
                        "Multiple device health indicators "
                        "require immediate attention."
                    ),
                    "action": (
                        "Inspect device connectivity and sensors."
                    ),
                    "health_score": health_score,
                })

            elif health_score < 60:

                recommendations.append({
                    "type": "DEVICE_HEALTH",
                    "priority": "HIGH",
                    "title": "Device health degraded",
                    "message": (
                        "One or more device health indicators "
                        "are outside the normal range."
                    ),
                    "action": (
                        "Check device connectivity and sensors."
                    ),
                    "health_score": health_score,
                })

            elif health_score < 75:

                recommendations.append({
                    "type": "DEVICE_HEALTH",
                    "priority": "MEDIUM",
                    "title": "Device health requires monitoring",
                    "message": (
                        "Device health has declined from the "
                        "normal operating range."
                    ),
                    "action": (
                        "Monitor the device and inspect during "
                        "the next maintenance cycle."
                    ),
                    "health_score": health_score,
                })

        # =========================================================
        # 5. OVERALL RISK FUSION
        # =========================================================

        if risk_fusion:

            overall_score = float(
                risk_fusion.get(
                    "overall_risk_score",
                    0
                ) or 0
            )

            risk_level = str(
                risk_fusion.get(
                    "risk_level",
                    "LOW"
                )
            ).upper()

            primary_risk = risk_fusion.get(
                "primary_risk",
                "NONE"
            )

            if risk_level == "CRITICAL":

                recommendations.append({
                    "type": "OVERALL_RISK",
                    "priority": "CRITICAL",
                    "title": "Critical AI risk",
                    "message": (
                        f"AI detected critical risk related to "
                        f"{primary_risk.replace('_', ' ').lower()}."
                    ),
                    "action": risk_fusion.get(
                        "recommended_action",
                        "Immediate inspection required."
                    ),
                    "risk_score": overall_score,
                })

        # =========================================================
        # 6. REMOVE DUPLICATES
        # =========================================================

        unique = {}

        for recommendation in recommendations:

            key = (
                recommendation.get("type"),
                recommendation.get("title"),
            )

            unique[key] = recommendation

        recommendations = list(
            unique.values()
        )

        # =========================================================
        # 7. PRIORITY SORT
        # =========================================================

        priority_order = {
            "CRITICAL": 1,
            "HIGH": 2,
            "MEDIUM": 3,
            "LOW": 4,
        }

        recommendations.sort(
            key=lambda item: priority_order.get(
                item.get("priority", "LOW"),
                4
            )
        )

        # =========================================================
        # 8. NO ISSUE
        # =========================================================

        if not recommendations:

            recommendations.append({
                "type": "SYSTEM",
                "priority": "LOW",
                "title": "No immediate action required",
                "message": (
                    "AI analysis indicates normal operating conditions."
                ),
                "action": (
                    "Continue normal monitoring."
                ),
            })

        return recommendations


class OperatorRecommendations:
    """Generates prescriptive action guidance for fleet dispatchers and drivers."""

    @classmethod
    def generate_recommendations(
        cls, 
        current: RawTelemetryPacket,
        temp_ai: Optional[AIPredictiveTemperature] = None
    ) -> List[str]:
        recommendations = []

        # 1. Node connectivity recommendation
        has_temp = current.temperature.cargo_temp_c is not None if current.temperature else False
        probe_connected = current.temperature.probe_connected if current.temperature else False
        if not has_temp or not probe_connected:
            recommendations.append(
                "Sensor node NODE-001 is offline or unlinked. Inspect probe battery and wireless radio pairing."
            )

        # 2. Temperature trend recommendation
        if temp_ai and temp_ai.risk_level in ["HIGH_RISK_EARLY_WARNING", "BREACH_IMMINENT"]:
            recommendations.append(
                f"Elevated thermal risk! Warming at {temp_ai.rate_of_change_c_per_min:+.2f}°C/min. "
                "Inspect refrigeration unit thermostat and check door seals."
            )

        # 3. Enclosure & Door recommendation
        if not current.tamper_switch_closed:
            recommendations.append(
                "CRITICAL: Enclosure tamper microswitch breached! Verify physical cargo box security immediately."
            )

        # 4. GPS Signal recommendation
        has_gps = current.gps.lat is not None and current.gps.lng is not None if current.gps else False
        if not has_gps:
            recommendations.append(
                "GNSS fix acquiring (Cold start or indoor). Awaiting clear view of sky."
            )

        # 5. Cellular 4G signal recommendation
        if current.power_network and current.power_network.lte_csq_rssi < 10:
            recommendations.append(
                "Weak 4G cellular coverage (CSQ < 10). Transmission may experience buffering delays."
            )

        if not recommendations:
            recommendations.append(
                "All telemetry optimal. Cold-chain operating within compliant 2.0°C - 8.0°C band."
            )

        return recommendations


class DriverBehaviorModel:
    """
    Physical IMU-based driver behavior classifier.
    Computes real acceleration vectors, lateral dynamics, and jerk metrics.
    Returns UNKNOWN when physical IMU sensor hardware is absent or not transmitting.
    """
    @classmethod
    def classify_driver_behavior(
        cls, current: RawTelemetryPacket, history: List[RawTelemetryPacket]
    ) -> AIDriverBehavior:
        import math

        imu = current.imu
        if not imu or not getattr(imu, "available", False) or imu.accel_x_g is None:
            return AIDriverBehavior(
                behavior_class="UNKNOWN",
                jerk_magnitude_g_per_s=None,
                vector_g_magnitude=None,
                driver_safety_score_100=None,
                confidence_pct=0.0
            )

        ax = float(imu.accel_x_g or 0.0)
        ay = float(imu.accel_y_g or 0.0)
        az = float(imu.accel_z_g or 1.0)
        vector_g = round(math.sqrt(ax * ax + ay * ay + az * az), 3)

        # Calculate jerk (rate of change of acceleration vector)
        jerk = 0.0
        prev_imu_packet = None
        for p in reversed(history):
            if p.imu and getattr(p.imu, "available", False) and p.imu.accel_x_g is not None:
                prev_imu_packet = p
                break

        if prev_imu_packet and prev_imu_packet.timestamp:
            try:
                dt = max(0.1, (current.timestamp - prev_imu_packet.timestamp).total_seconds())
                pax = float(prev_imu_packet.imu.accel_x_g or 0.0)
                pay = float(prev_imu_packet.imu.accel_y_g or 0.0)
                paz = float(prev_imu_packet.imu.accel_z_g or 1.0)
                prev_vec = math.sqrt(pax * pax + pay * pay + paz * paz)
                jerk = round(abs(vector_g - prev_vec) / dt, 3)
            except Exception:
                jerk = 0.0

        # Classify based on physical telematics thresholds
        if getattr(imu, "shock_detected", False) or vector_g >= 3.0:
            b_class = "CRASH_ROLLOVER_IMPACT"
            score_deduction = 50
        elif ax <= -0.45:
            b_class = "HARSH_BRAKING"
            score_deduction = 15
        elif ax >= 0.40:
            b_class = "HARSH_ACCELERATION"
            score_deduction = 10
        elif abs(ay) >= 0.45:
            b_class = "AGGRESSIVE_CORNERING"
            score_deduction = 15
        elif abs(az - 1.0) >= 0.8:
            b_class = "ROAD_BUMP_SHOCK"
            score_deduction = 5
        else:
            b_class = "SMOOTH_NORMAL"
            score_deduction = 0

        # Compute dynamic driver safety score from recent IMU window
        harsh_events_count = 0
        valid_imu_packets = 1
        for p in history[-20:]:
            if p.imu and getattr(p.imu, "available", False) and p.imu.accel_x_g is not None:
                valid_imu_packets += 1
                p_ax = float(p.imu.accel_x_g or 0.0)
                p_ay = float(p.imu.accel_y_g or 0.0)
                if p_ax <= -0.45 or p_ax >= 0.40 or abs(p_ay) >= 0.45:
                    harsh_events_count += 1

        base_score = 100 - score_deduction - (harsh_events_count * 5)
        safety_score = max(0, min(100, base_score))

        confidence = 90.0 if valid_imu_packets >= 5 else 60.0

        return AIDriverBehavior(
            behavior_class=b_class,
            jerk_magnitude_g_per_s=jerk,
            vector_g_magnitude=vector_g,
            driver_safety_score_100=safety_score,
            confidence_pct=confidence
        )
