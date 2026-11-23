from datetime import datetime, timezone
from typing import Any, Dict, List

from ..schemas.telemetry import RawTelemetryPacket
from ..schemas.ai import AIPredictiveDeviceHealth


class HealthScoreModel:
    """
    AI-based predictive device health evaluation.

    Health is calculated from real telemetry only.
    Missing battery / IMU / signal values are NOT replaced
    with fabricated values.
    """

    @classmethod
    def predict_device_health(
        cls,
        current: RawTelemetryPacket,
        history: List[RawTelemetryPacket],
    ) -> AIPredictiveDeviceHealth:

        score = 100.0
        risk_factors: List[str] = []
        recommendations: List[str] = []

        # ---------------------------------------------------------
        # 1. TELEMETRY FRESHNESS
        # ---------------------------------------------------------

        freshness_penalty = 0

        try:
            now = datetime.now(timezone.utc)

            timestamp = current.timestamp

            if timestamp.tzinfo is None:
                timestamp = timestamp.replace(tzinfo=timezone.utc)

            age_seconds = max(
                0,
                (now - timestamp).total_seconds()
            )

            if age_seconds > 300:
                freshness_penalty = 20
                risk_factors.append(
                    "Telemetry is older than 5 minutes"
                )
                recommendations.append(
                    "Check gateway connectivity and telemetry transmission"
                )

            elif age_seconds > 120:
                freshness_penalty = 10
                risk_factors.append(
                    "Telemetry freshness is degraded"
                )

        except Exception:
            pass

        score -= freshness_penalty

        # ---------------------------------------------------------
        # 2. NETWORK HEALTH
        # ---------------------------------------------------------

        network_penalty = 0

        power = current.power_network

        if power is not None:

            rssi = power.lte_csq_rssi

            if rssi is not None:

                if rssi < 8:
                    network_penalty = 15
                    risk_factors.append(
                        "Very weak cellular signal"
                    )
                    recommendations.append(
                        "Check antenna, SIM connectivity and network coverage"
                    )

                elif rssi < 14:
                    network_penalty = 8
                    risk_factors.append(
                        "Weak cellular signal"
                    )

        score -= network_penalty

        # ---------------------------------------------------------
        # 3. NODE / SENSOR CONNECTIVITY
        # ---------------------------------------------------------

        node_penalty = 0

        imu_avail = getattr(current.imu, "available", True) if current.imu else False
        if not imu_avail:
            node_penalty += 5
            risk_factors.append(
                "IMU telemetry is unavailable"
            )

        probe_connected = current.temperature.probe_connected if current.temperature else False
        if not probe_connected:
            node_penalty += 15
            risk_factors.append(
                "Temperature probe is disconnected"
            )
            recommendations.append(
                "Inspect temperature sensor connection"
            )

        score -= node_penalty

        # ---------------------------------------------------------
        # 4. GPS HEALTH
        # ---------------------------------------------------------

        gps_penalty = 0

        gps = current.gps

        if gps is None or gps.lat is None or gps.lng is None:
            gps_penalty += 10
            risk_factors.append(
                "GPS position unavailable"
            )

        if gps is not None and gps.fix_status == "NO_FIX":
            gps_penalty += 5

        score -= gps_penalty

        # ---------------------------------------------------------
        # 5. SECURITY / TAMPER
        # ---------------------------------------------------------

        security_penalty = 0

        if not current.tamper_switch_closed:
            security_penalty = 25

            risk_factors.append(
                "Tamper switch is open"
            )

            recommendations.append(
                "Inspect the gateway enclosure immediately"
            )

        score -= security_penalty

        # ---------------------------------------------------------
        # 6. TEMPERATURE SENSOR HEALTH
        # ---------------------------------------------------------

        temperature_penalty = 0

        cargo_temp = current.temperature.cargo_temp_c if current.temperature else None
        if cargo_temp is None:
            temperature_penalty += 15

            risk_factors.append(
                "Cargo temperature data unavailable"
            )

            recommendations.append(
                "Check temperature probe connectivity"
            )

        score -= temperature_penalty

        # ---------------------------------------------------------
        # 7. HISTORY BASED RELIABILITY
        # ---------------------------------------------------------

        history_factor = 0

        if len(history) >= 10:

            missing_temperature = sum(
                1
                for packet in history
                if packet.temperature is None or packet.temperature.cargo_temp_c is None
            )

            missing_gps = sum(
                1
                for packet in history
                if packet.gps is None
                or packet.gps.lat is None
                or packet.gps.lng is None
            )

            temperature_missing_ratio = (
                missing_temperature / len(history)
            )

            gps_missing_ratio = (
                missing_gps / len(history)
            )

            if temperature_missing_ratio > 0.30:
                history_factor += 5
                risk_factors.append(
                    "Frequent temperature data gaps detected"
                )

            if gps_missing_ratio > 0.40:
                history_factor += 5
                risk_factors.append(
                    "Frequent GPS data gaps detected"
                )

        score -= history_factor

        # ---------------------------------------------------------
        # FINAL SCORE
        # ---------------------------------------------------------

        score = max(
            0.0,
            min(100.0, round(score, 1))
        )

        # ---------------------------------------------------------
        # HEALTH STATUS
        # ---------------------------------------------------------

        if score >= 90:

            status = "HEALTHY"

        elif score >= 75:

            status = "GOOD"

        elif score >= 60:

            status = "WARNING"

        elif score >= 40:

            status = "DEGRADED"

        else:

            status = "CRITICAL"

        # ---------------------------------------------------------
        # GENERAL RECOMMENDATION
        # ---------------------------------------------------------

        if not recommendations:

            if status == "HEALTHY":
                recommendations.append(
                    "Device operating normally"
                )

            elif status == "GOOD":
                recommendations.append(
                    "Continue normal monitoring"
                )

            elif status == "WARNING":
                recommendations.append(
                    "Monitor device telemetry closely"
                )

            elif status == "DEGRADED":
                recommendations.append(
                    "Inspect device connectivity and sensors"
                )

            else:
                recommendations.append(
                    "Immediate device inspection required"
                )

        # ---------------------------------------------------------
        # 8. BATTERY FAILURE RISK & HEALTH
        # ---------------------------------------------------------
        battery_failure_risk = "Not Available"
        power = current.power_network
        if power and power.battery_pct is not None:
            bp = power.battery_pct
            if bp <= 15:
                battery_failure_risk = "CRITICAL"
                risk_factors.append("Backup battery critically depleted")
                recommendations.append("Recharge or replace internal backup battery immediately")
            elif bp <= 25:
                battery_failure_risk = "ELEVATED"
                risk_factors.append("Backup battery low (<25%)")
            else:
                # Check discharge rate across history
                historical_bats = [
                    p.power_network.battery_pct 
                    for p in history 
                    if p.power_network and p.power_network.battery_pct is not None
                ]
                if len(historical_bats) >= 5 and (historical_bats[0] - bp) > 15:
                    battery_failure_risk = "RAPID_DISCHARGE"
                    risk_factors.append("Abnormal battery discharge velocity detected")
                else:
                    battery_failure_risk = "LOW"

        # Remove duplicate values
        risk_factors = list(dict.fromkeys(risk_factors))
        recommendations = list(dict.fromkeys(recommendations))

        # ---------------------------------------------------------
        # CONFIDENCE (STRICTLY EVIDENCE-PROPORTIONAL)
        # ---------------------------------------------------------

        if len(history) >= 20:
            confidence = 92.0
        elif len(history) >= 6:
            confidence = 70.0
        elif len(history) >= 3:
            confidence = 35.0
        else:
            confidence = 0.0

        # ---------------------------------------------------------
        # RETURN
        # ---------------------------------------------------------

        return AIPredictiveDeviceHealth(
            health_score_100=score,
            health_status=status,
            predicted_failure_risk=battery_failure_risk,
            battery_failure_risk=battery_failure_risk,
            risk_factors=risk_factors,
            recommendations=recommendations,
            confidence_pct=confidence,
        )
