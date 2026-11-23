"""
Fleet and Vehicle Operational Health Scoring Service.
Computes a 100% deterministic, telemetry-grounded score (0-100)
based solely on actual signals received from hardware firmware:
1. Temperature Health (30%)
2. Gateway/Node Connectivity (20%)
3. GPS/Location Health (10%)
4. Network & Node Signal (10%)
5. Door & Tamper Security (10%)
6. Telemetry Data Quality (10%)
7. Movement / Kinematic Health (10%)

Does not assume unmeasured battery or IMU sensors.
Separates current operational health (now) from AI predictive risk (future).
"""

from typing import Dict, Any, List, Optional
from datetime import datetime


class FleetHealthService:
    """Calculates operational health scores grounded in live telematics."""

    @classmethod
    def calculate_vehicle_health(cls, vehicle_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Calculates 7-component operational health score for a single vehicle.
        vehicle_data expected keys:
        - temperature (float or None)
        - target_min (float, default 2.0)
        - target_max (float, default 8.0)
        - is_online (bool)
        - packet_age_sec (int)
        - node_connected (bool)
        - latitude (float or None)
        - longitude (float or None)
        - location_accuracy (float or None)
        - network_rssi (float or None)
        - node_rssi (float or None)
        - door_status (str: "SEALED", "OPEN", "UNKNOWN")
        - tamper (bool)
        - speed_kmh (float)
        """
        temp = vehicle_data.get("temperature")
        t_min = float(vehicle_data.get("target_min", 2.0))
        t_max = float(vehicle_data.get("target_max", 8.0))
        packet_age = int(vehicle_data.get("packet_age_sec", 999999))
        node_conn = bool(vehicle_data.get("node_connected", False))
        lat = vehicle_data.get("latitude")
        lng = vehicle_data.get("longitude")
        acc = vehicle_data.get("location_accuracy")
        net_rssi = vehicle_data.get("network_rssi")
        node_rssi = vehicle_data.get("node_rssi")
        door_status = str(vehicle_data.get("door_status") or "SEALED").upper()
        tamper = bool(vehicle_data.get("tamper", False))
        speed = float(vehicle_data.get("speed_kmh") or 0.0)

        # -------------------------------------------------------------
        # 1. Temperature Health (Weight: 30%)
        # -------------------------------------------------------------
        if temp is None:
            temp_score = 0.0
            temp_note = "Temperature sensor not reporting"
        else:
            t = float(temp)
            if t_min <= t <= t_max:
                temp_score = 100.0
                temp_note = f"Safe band ({t:.1f}°C in {t_min}-{t_max}°C)"
            elif (t_min - 1.0 <= t < t_min) or (t_max < t <= t_max + 1.0):
                temp_score = 80.0
                temp_note = f"Borderline threshold drift ({t:.1f}°C)"
            elif (t_min - 2.0 <= t < t_min - 1.0) or (t_max + 1.0 < t <= t_max + 2.0):
                temp_score = 50.0
                temp_note = f"Excursion alert ({t:.1f}°C)"
            else:
                temp_score = 0.0
                temp_note = f"Severe thermal excursion ({t:.1f}°C)"

        # -------------------------------------------------------------
        # 2. Gateway/Node Connectivity (Weight: 20%)
        # -------------------------------------------------------------
        if packet_age > 300:
            conn_score = 0.0
            conn_note = "Gateway offline (>5 min)"
        elif packet_age > 120:
            conn_score = 30.0
            conn_note = "Gateway packet delayed (<5 min)"
        else:
            if node_conn:
                conn_score = 100.0
                conn_note = "Gateway & Wireless Node paired and active"
            else:
                conn_score = 50.0
                conn_note = "Gateway online, but Node sensor disconnected"

        # -------------------------------------------------------------
        # 3. GPS / Location Health (Weight: 10%)
        # -------------------------------------------------------------
        if lat is None or lng is None:
            gps_score = 0.0
            gps_note = "No GNSS satellite fix (Indoor / Basement)"
        else:
            if acc is not None:
                acc_f = float(acc)
                if acc_f <= 10.0:
                    gps_score = 100.0
                    gps_note = f"High precision 3D fix (±{acc_f:.1f}m)"
                elif acc_f <= 30.0:
                    gps_score = 80.0
                    gps_note = f"Good GNSS fix (±{acc_f:.1f}m)"
                elif acc_f <= 50.0:
                    gps_score = 60.0
                    gps_note = f"Moderate GNSS fix (±{acc_f:.1f}m)"
                else:
                    gps_score = 30.0
                    gps_note = f"Degraded GNSS accuracy (>50m)"
            else:
                gps_score = 85.0
                gps_note = "Valid GNSS coordinates fixed"

        # -------------------------------------------------------------
        # 4. Network & Node Signal (Weight: 10%)
        # -------------------------------------------------------------
        def score_rssi(val: Optional[float], is_node: bool = False) -> float:
            if val is None:
                return 0.0 if is_node and not node_conn else 40.0
            v = float(val)
            if v >= -70.0:
                return 100.0
            elif v >= -85.0:
                return 80.0
            elif v >= -100.0:
                return 50.0
            else:
                return 20.0

        net_score = score_rssi(net_rssi, is_node=False)
        node_score = score_rssi(node_rssi, is_node=True)
        signal_score = (net_score + node_score) / 2.0
        signal_note = f"LTE: {net_rssi if net_rssi is not None else '--'} dBm, Node: {node_rssi if node_rssi is not None else '--'} dBm"

        # -------------------------------------------------------------
        # 5. Door & Tamper Security (Weight: 10%)
        # -------------------------------------------------------------
        if tamper:
            sec_score = 0.0
            sec_note = "Tamper switch open (Security breach!)"
        else:
            if door_status in ["SEALED", "CLOSED"]:
                sec_score = 100.0
                sec_note = "Enclosure sealed and secure"
            elif door_status == "OPEN":
                if speed >= 3.0:
                    sec_score = 30.0
                    sec_note = "Door OPEN while moving (Violation!)"
                else:
                    sec_score = 70.0
                    sec_note = "Door OPEN while stationary (Dock/Loading)"
            else:
                sec_score = 90.0
                sec_note = "Enclosure status normal"

        # -------------------------------------------------------------
        # 6. Telemetry Data Quality (Weight: 10%)
        # -------------------------------------------------------------
        if packet_age <= 60:
            quality_base = 100.0
        elif packet_age <= 120:
            quality_base = 80.0
        elif packet_age <= 300:
            quality_base = 50.0
        else:
            quality_base = 0.0

        penalty = 0.0
        if temp is None:
            penalty += 15.0
        if lat is None or lng is None:
            penalty += 10.0
        quality_score = max(0.0, quality_base - penalty)
        quality_note = f"Packet age: {packet_age}s"

        # -------------------------------------------------------------
        # 7. Movement / Trip Health (Weight: 10%)
        # -------------------------------------------------------------
        if speed < 0.0 or speed > 150.0:
            move_score = 20.0
            move_note = f"Abnormal kinematic speed ({speed:.1f} km/h)"
        else:
            move_score = 100.0
            move_note = f"Normal motion ({speed:.1f} km/h)" if speed >= 3.0 else "Stationary at stop"

        # -------------------------------------------------------------
        # Total Weighted Operational Health Score (0 - 100)
        # -------------------------------------------------------------
        total_score = (
            (temp_score * 0.30)
            + (conn_score * 0.20)
            + (gps_score * 0.10)
            + (signal_score * 0.10)
            + (sec_score * 0.10)
            + (quality_score * 0.10)
            + (move_score * 0.10)
        )
        total_score = round(max(0.0, min(100.0, total_score)), 1)

        # Rating label
        if total_score >= 90.0:
            rating = "Excellent"
            status_tier = "GOOD"
        elif total_score >= 75.0:
            rating = "Good"
            status_tier = "GOOD"
        elif total_score >= 60.0:
            rating = "Fair"
            status_tier = "FAIR"
        elif total_score >= 40.0:
            rating = "Poor"
            status_tier = "POOR"
        else:
            rating = "Critical"
            status_tier = "CRITICAL"

        return {
            "score": total_score,
            "rating": rating,
            "status_tier": status_tier,
            "components": {
                "temperature": round(temp_score, 1),
                "connectivity": round(conn_score, 1),
                "gps": round(gps_score, 1),
                "signal": round(signal_score, 1),
                "security": round(sec_score, 1),
                "data_quality": round(quality_score, 1),
                "movement": round(move_score, 1)
            },
            "notes": {
                "temperature": temp_note,
                "connectivity": conn_note,
                "gps": gps_note,
                "signal": signal_note,
                "security": sec_note,
                "data_quality": quality_note,
                "movement": move_note
            }
        }

    @classmethod
    def calculate_fleet_health(cls, vehicles_data: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Aggregates health across all vehicles in the fleet.
        Never hides critical vehicles behind the average.
        """
        if not vehicles_data:
            return {
                "overall_score": 100.0,
                "rating": "Good",
                "total_vehicles": 0,
                "distribution": {"good": 0, "fair": 0, "poor": 0, "critical": 0},
                "distribution_pct": {"good": 100, "fair": 0, "poor": 0, "critical": 0},
                "healthy_count": 0,
                "at_risk_count": 0,
                "critical_count": 0,
                "component_averages": {},
                "critical_vehicles": [],
                "at_risk_vehicles": []
            }

        scores: List[float] = []
        comp_sums = {
            "temperature": 0.0,
            "connectivity": 0.0,
            "gps": 0.0,
            "signal": 0.0,
            "security": 0.0,
            "data_quality": 0.0,
            "movement": 0.0
        }

        dist = {"good": 0, "fair": 0, "poor": 0, "critical": 0}
        critical_vehicles = []
        at_risk_vehicles = []

        for v in vehicles_data:
            dev_id = v.get("device_id", "Unknown")
            vh = cls.calculate_vehicle_health(v)
            s = vh["score"]
            scores.append(s)

            for comp, val in vh["components"].items():
                comp_sums[comp] += val

            tier = vh["status_tier"]
            if tier == "GOOD":
                dist["good"] += 1
            elif tier == "FAIR":
                dist["fair"] += 1
                at_risk_vehicles.append({
                    "device_id": dev_id,
                    "score": s,
                    "reason": vh["notes"]["temperature"] if vh["components"]["temperature"] < 80 else vh["notes"]["connectivity"]
                })
            elif tier == "POOR":
                dist["poor"] += 1
                at_risk_vehicles.append({
                    "device_id": dev_id,
                    "score": s,
                    "reason": vh["notes"]["temperature"] if vh["components"]["temperature"] < 60 else vh["notes"]["connectivity"]
                })
            else:
                dist["critical"] += 1
                critical_vehicles.append({
                    "device_id": dev_id,
                    "score": s,
                    "reason": vh["notes"]["temperature"] if vh["components"]["temperature"] < 50 else vh["notes"]["security"]
                })

        n = len(vehicles_data)
        avg_score = round(sum(scores) / n, 1)

        # Rating
        if avg_score >= 85.0:
            rating = "Excellent" if not critical_vehicles else "Good (Critical vehicle active)"
        elif avg_score >= 75.0:
            rating = "Good"
        elif avg_score >= 60.0:
            rating = "Fair"
        elif avg_score >= 40.0:
            rating = "Poor"
        else:
            rating = "Critical"

        dist_pct = {
            k: round((cnt / n) * 100) for k, cnt in dist.items()
        }

        comp_avgs = {
            k: round(val / n, 1) for k, val in comp_sums.items()
        }

        return {
            "overall_score": avg_score,
            "rating": rating,
            "total_vehicles": n,
            "distribution": dist,
            "distribution_pct": dist_pct,
            "healthy_count": dist["good"],
            "at_risk_count": dist["fair"] + dist["poor"],
            "critical_count": dist["critical"],
            "component_averages": comp_avgs,
            "critical_vehicles": critical_vehicles,
            "at_risk_vehicles": at_risk_vehicles
        }
