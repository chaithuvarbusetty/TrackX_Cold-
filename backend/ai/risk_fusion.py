from typing import Any, Dict, List, Optional


class AIRiskFusion:

    @classmethod
    def calculate(
        cls,
        temperature_ai=None,
        gps_ai=None,
        tamper_ai=None,
        health_ai=None,
    ) -> Dict[str, Any]:

        risks: List[Dict[str, Any]] = []

        # =========================================================
        # 1. TEMPERATURE RISK
        # =========================================================

        if temperature_ai is not None:

            temp_risk = float(
                getattr(
                    temperature_ai,
                    "excursion_risk_pct",
                    0
                ) or 0
            )

            temp_level = str(
                getattr(
                    temperature_ai,
                    "risk_level",
                    "LOW"
                )
            ).upper()

            if temp_risk > 0:

                risks.append({
                    "type": "TEMPERATURE_EXCURSION",
                    "score": temp_risk,
                    "level": temp_level,
                    "priority": 1,
                })

        # =========================================================
        # 2. GPS RISK
        # =========================================================

        if gps_ai is not None:

            gps_anomaly = bool(
                getattr(
                    gps_ai,
                    "anomaly_detected",
                    getattr(gps_ai, "kinematic_anomaly_detected", False)
                )
            )

            if gps_anomaly:

                gps_score = float(
                    getattr(
                        gps_ai,
                        "anomaly_score",
                        70
                    ) or 70
                )

                risks.append({
                    "type": "GPS_ANOMALY",
                    "score": min(gps_score, 100),
                    "level": "HIGH",
                    "priority": 2,
                })

        # =========================================================
        # 3. TAMPER RISK
        # =========================================================

        if tamper_ai is not None:

            tamper_score = float(
                getattr(
                    tamper_ai,
                    "tamper_risk_score",
                    getattr(tamper_ai, "tamper_score", 0)
                ) or 0
            )

            tamper_level = str(
                getattr(
                    tamper_ai,
                    "threat_level",
                    getattr(tamper_ai, "tamper_threat_level", "SECURE")
                )
            ).upper()

            if tamper_score > 0:

                risks.append({
                    "type": "TAMPER",
                    "score": min(tamper_score, 100),
                    "level": tamper_level,
                    "priority": 1,
                })

        # =========================================================
        # 4. DEVICE HEALTH RISK
        # =========================================================

        health_score = 100.0

        if health_ai is not None:

            health_score = float(
                getattr(
                    health_ai,
                    "health_score_100",
                    getattr(health_ai, "overall_health_score_pct", 100)
                ) or 100
            )

        device_risk = max(
            0,
            100 - health_score
        )

        if device_risk > 0:

            risks.append({
                "type": "DEVICE_HEALTH",
                "score": device_risk,
                "level": (
                    "CRITICAL"
                    if device_risk >= 60
                    else "HIGH"
                    if device_risk >= 40
                    else "MEDIUM"
                    if device_risk >= 20
                    else "LOW"
                ),
                "priority": 3,
            })

        sources_dict = {
            "temperature": round(temp_risk, 1) if 'temp_risk' in locals() else 0.0,
            "gps": round(gps_score, 1) if ('gps_anomaly' in locals() and gps_anomaly and 'gps_score' in locals()) else 0.0,
            "tamper": round(tamper_score, 1) if ('tamper_score' in locals() and tamper_score > 0) else 0.0,
            "health": round(device_risk, 1) if ('device_risk' in locals() and device_risk > 0) else 0.0,
        }

        # =========================================================
        # 5. NO RISK
        # =========================================================

        if not risks:

            return {
                "overall_risk_score": 0,
                "risk_level": "LOW",
                "primary_risk": "NONE",
                "recommended_action": "Continue normal monitoring",
                "risk_sources": sources_dict,
                "breakdown": sources_dict,
                "risk_events": [],
            }

        # =========================================================
        # 6. SELECT PRIMARY RISK
        # =========================================================

        # Priority is considered first.
        # Within the same priority, highest score wins.

        primary = sorted(
            risks,
            key=lambda x: (
                x["priority"],
                x["score"]
            ),
            reverse=False
        )[0]

        # Among high-priority risks, select highest score.
        high_priority = [
            r for r in risks
            if r["priority"] == primary["priority"]
        ]

        if high_priority:

            primary = max(
                high_priority,
                key=lambda x: x["score"]
            )

        # =========================================================
        # 7. OVERALL RISK SCORE
        # =========================================================

        # Risk fusion does NOT simply add scores.
        #
        # The highest individual risk forms the base.
        # Additional independent risks increase the final score.

        highest_score = max(
            r["score"]
            for r in risks
        )

        additional_risk = sum(
            r["score"] * 0.15
            for r in risks
            if r["score"] != highest_score
        )

        overall_score = min(
            100,
            round(
                highest_score + additional_risk,
                1
            )
        )

        # =========================================================
        # 8. OVERALL RISK LEVEL
        # =========================================================

        if overall_score >= 80:

            overall_level = "CRITICAL"

        elif overall_score >= 60:

            overall_level = "HIGH"

        elif overall_score >= 35:

            overall_level = "MEDIUM"

        else:

            overall_level = "LOW"

        # =========================================================
        # 9. RECOMMENDED ACTION
        # =========================================================

        actions = {

            "TEMPERATURE_EXCURSION":
                "Inspect refrigeration system and cargo temperature",

            "GPS_ANOMALY":
                "Verify GPS signal and device location",

            "TAMPER":
                "Inspect container security and tamper switch",

            "DEVICE_HEALTH":
                "Inspect device connectivity and sensors",

        }

        recommended_action = actions.get(
            primary["type"],
            "Inspect device"
        )

        # =========================================================
        # 10. RETURN FUSED RESULT
        # =========================================================

        return {
            "overall_risk_score": overall_score,

            "risk_level": overall_level,

            "primary_risk": primary["type"],

            "recommended_action": recommended_action,

            "risk_sources": sources_dict,

            "breakdown": sources_dict,

            "risk_events": risks,
        }
