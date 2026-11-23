"""
Deterministic Rule Engine Orchestrator.
Dispatches evaluations across temperature, door, tamper, and connectivity rules.
"""

import uuid
from typing import List
from datetime import datetime, timezone

from ..models import RawTelemetryPacket, RuleAlert
from .temperature_rules import TemperatureRules
from .door_rules import DoorRules
from .tamper_rules import TamperRules
from .connectivity_rules import ConnectivityRules


class DeterministicRuleEngine:
    """
    Evaluates raw IoT telemetry packets against standard cold-chain, vehicle safety,
    and device integrity rules.
    """

    @staticmethod
    def evaluate(packet: RawTelemetryPacket) -> List[RuleAlert]:
        """
        Takes a single raw sensor packet from the vehicle and evaluates all hard limit rules.
        Returns a list of triggered RuleAlert objects.
        """
        alerts: List[RuleAlert] = []
        now = packet.timestamp or datetime.now(timezone.utc)

        # 1. Temperature Rules
        temp_alerts = TemperatureRules.evaluate(
            cargo_temp_c=packet.temperature.cargo_temp_c,
            target_min_c=packet.temperature.target_min_c,
            target_max_c=packet.temperature.target_max_c,
            probe_connected=packet.temperature.probe_connected,
            timestamp=now
        )
        alerts.extend(temp_alerts)

        # 2. Tamper Rules
        tamper_alerts = TamperRules.evaluate(
            tamper_switch_closed=packet.tamper_switch_closed,
            timestamp=now
        )
        alerts.extend(tamper_alerts)

        # 3. Crash / IMU Shock
        if (
            packet.imu
            and getattr(packet.imu, "available", False)
            and packet.imu.accel_x_g is not None
            and packet.imu.accel_y_g is not None
            and packet.imu.accel_z_g is not None
        ):
            total_g = (
                packet.imu.accel_x_g**2 + 
                packet.imu.accel_y_g**2 + 
                packet.imu.accel_z_g**2
            )**0.5

            if total_g > 3.2 or getattr(packet.imu, "shock_detected", False):
                alerts.append(RuleAlert(
                    alert_id=str(uuid.uuid4())[:8],
                    severity="CRITICAL",
                    rule_name="CRASH_IMPACT_DETECTED",
                    message=f"Severe vehicle impact detected: {total_g:.2f}g peak acceleration!",
                    timestamp=now
                ))
        elif packet.imu and getattr(packet.imu, "shock_detected", False):
            alerts.append(RuleAlert(
                alert_id=str(uuid.uuid4())[:8],
                severity="CRITICAL",
                rule_name="CRASH_IMPACT_DETECTED",
                message="Severe vehicle impact detected: Shock sensor triggered!",
                timestamp=now
            ))

        # 4. Power & Battery Rules
        if packet.power_network:
            if packet.power_network.external_power_connected is False:
                alerts.append(RuleAlert(
                    alert_id=str(uuid.uuid4())[:8],
                    severity="WARNING",
                    rule_name="VEHICLE_POWER_DISCONNECTED",
                    message="Main vehicle 12V/24V power disconnected. Switched to internal Li-ion battery.",
                    timestamp=now
                ))

            if packet.power_network.battery_pct is not None and packet.power_network.battery_pct <= 15:
                alerts.append(RuleAlert(
                    alert_id=str(uuid.uuid4())[:8],
                    severity="WARNING",
                    rule_name="LOW_BATTERY_WARNING",
                    message=(
                        f"Device backup battery critically low ({packet.power_network.battery_pct}%). "
                        "Shutdown imminent."
                    ),
                    timestamp=now
                ))

        return alerts
