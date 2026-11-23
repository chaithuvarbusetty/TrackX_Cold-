"""
AI Model #3: Cold-Chain Tamper / Theft Detection.

Combines available telemetry signals to identify:

1. Tamper switch opening
2. Tamper while vehicle is stationary
3. Tamper while vehicle is moving
4. Tamper + temperature change
5. Tamper + GPS anomaly
6. Suspicious cargo access
7. Possible theft/breach

Important:
---------
This model only uses signals actually available from the hardware.
It does not assume an IMU exists.
"""

from __future__ import annotations

from typing import List

from ..models import (
    RawTelemetryPacket,
    AIPredictiveTemperature,
    AITamperFusion,
)


class TamperRiskModel:
    """
    Explainable tamper and theft-risk detection.
    """

    # ---------------------------------------------------------
    # Configuration
    # ---------------------------------------------------------

    STATIONARY_SPEED_KMH = 2.0

    MOVING_SPEED_KMH = 5.0

    TEMPERATURE_RISE_RATE = 0.05

    GPS_ANOMALY_SCORE = 20

    MAX_SCORE = 100

    # ---------------------------------------------------------
    # MAIN METHOD
    # ---------------------------------------------------------

    @classmethod
    def detect(
        cls,
        current: RawTelemetryPacket,
        temperature_ai: AIPredictiveTemperature,
        gps_ai=None,
    ) -> AITamperFusion:

        score = 0

        signals: List[str] = []

        # -----------------------------------------------------
        # Current vehicle movement
        # -----------------------------------------------------

        speed = 0.0

        if current.gps:

            speed = float(
                current.gps.speed_kmh or 0.0
            )

        is_stationary = (
            speed < cls.STATIONARY_SPEED_KMH
        )

        is_moving = (
            speed >= cls.MOVING_SPEED_KMH
        )

        # -----------------------------------------------------
        # Tamper switch state
        # -----------------------------------------------------

        tamper_open = (
            not current.tamper_switch_closed
        )

        # =====================================================
        # CASE 1: TAMPER SWITCH CLOSED
        # =====================================================

        if not tamper_open:

            # -------------------------------------------------
            # GPS anomaly without tamper
            # -------------------------------------------------

            if (
                gps_ai is not None
                and gps_ai.kinematic_anomaly_detected
            ):

                score += cls.GPS_ANOMALY_SCORE

                signals.append(
                    "GPS kinematic anomaly detected."
                )

            # -------------------------------------------------
            # No tamper signal
            # -------------------------------------------------

            if score == 0:

                return cls._secure_response()

            return cls._build_response(
                score=score,
                signals=signals,
            )

        # =====================================================
        # CASE 2: TAMPER SWITCH OPEN
        # =====================================================

        score += 60

        signals.append(
            "Tamper switch is open."
        )

        # =====================================================
        # CASE 3: TAMPER + VEHICLE STATIONARY
        # =====================================================

        if is_stationary:

            score += 15

            signals.append(
                "Tamper switch opened while "
                "vehicle is stationary."
            )

        # =====================================================
        # CASE 4: TAMPER + VEHICLE MOVING
        # =====================================================

        elif is_moving:

            score += 20

            signals.append(
                "Tamper switch opened while "
                "vehicle is moving."
            )

        # =====================================================
        # CASE 5: TAMPER + TEMPERATURE RISE
        # =====================================================

        temperature_rising = (
            temperature_ai.rate_of_change_c_per_min
            > cls.TEMPERATURE_RISE_RATE
        )

        if temperature_rising:

            score += 15

            signals.append(
                "Cargo temperature is increasing "
                "while tamper switch is open."
            )

        # =====================================================
        # CASE 6: TAMPER + GPS ANOMALY
        # =====================================================

        if (
            gps_ai is not None
            and gps_ai.kinematic_anomaly_detected
        ):

            score += 15

            signals.append(
                "GPS anomaly detected while "
                "tamper switch is open."
            )

        # =====================================================
        # CAP SCORE
        # =====================================================

        score = min(
            score,
            cls.MAX_SCORE,
        )

        return cls._build_response(
            score=score,
            signals=signals,
        )

    # =========================================================
    # SECURE RESPONSE
    # =========================================================

    @staticmethod
    def _secure_response():

        return AITamperFusion(

            tamper_score=0.0,

            threat_level="SECURE",

            contributing_signals=[
                "Tamper switch is closed."
            ],

            recommended_action=(
                "No security action required. "
                "Continue normal monitoring."
            ),
        )

    # =========================================================
    # BUILD RESPONSE
    # =========================================================

    @classmethod
    def _build_response(
        cls,
        score: float,
        signals: List[str],
    ):

        # -----------------------------------------------------
        # Determine threat level
        # -----------------------------------------------------

        if score >= 85:

            threat_level = (
                "CRITICAL_THEFT_BREACH"
            )

            action = (
                "CRITICAL: Investigate cargo "
                "compartment immediately. "
                "Verify vehicle location and "
                "contact the operator."
            )

        elif score >= 65:

            threat_level = (
                "HIGH_TAMPER_RISK"
            )

            action = (
                "High tamper risk detected. "
                "Verify cargo compartment "
                "and device installation."
            )

        elif score >= 40:

            threat_level = (
                "SUSPICIOUS_ACTIVITY"
            )

            action = (
                "Suspicious activity detected. "
                "Monitor vehicle and cargo status."
            )

        else:

            threat_level = (
                "SECURE"
            )

            action = (
                "No immediate security action required."
            )

        return AITamperFusion(
            is_tampered=tamper_open,

            tamper_score=round(
                score,
                1,
            ),

            tamper_score_pct=round(
                score,
                1,
            ),

            threat_level=threat_level,

            contributing_signals=signals,

            recommended_action=action,
        )


# Backward compatibility aliases
RiskAnalysisModel = TamperRiskModel
TamperRiskModel.fuse_tamper_signals = TamperRiskModel.detect
