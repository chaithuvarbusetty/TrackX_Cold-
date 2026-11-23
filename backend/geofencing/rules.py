"""
==============================================================================
FILE: backend/geofencing/rules.py
PURPOSE:
Rule Evaluation Engine for TracX Geofencing.
Evaluates Enter, Exit, Dwell, Speed Limits, and Cold-Chain Temperature Violations.
==============================================================================
"""

import time
from typing import Dict, Any, List, Optional
from .state_machine import GeofenceState, DeviceGeofenceTracker


class GeofenceRuleEvaluator:
    """
    Evaluates rule violations based on state machine transitions and telemetry metrics.
    Includes alert throttling to avoid duplicate event flooding.
    """

    def __init__(self, violation_cooldown_seconds: int = 300):
        self.cooldown_seconds = violation_cooldown_seconds
        # Cooldown tracker: (device_id, geofence_id, rule_type) -> last_fired_epoch
        self._last_alert_times: Dict[tuple, float] = {}

    def _can_fire(self, key: tuple) -> bool:
        now = time.time()
        last = self._last_alert_times.get(key, 0)
        if (now - last) >= self.cooldown_seconds:
            self._last_alert_times[key] = now
            return True
        return False

    def evaluate_geofence_rules(
        self,
        geofence: Dict[str, Any],
        telemetry: Dict[str, Any],
        tracker: DeviceGeofenceTracker,
        transition_event: Optional[str],
        evaluation_result: Dict[str, Any]
    ) -> List[Dict[str, Any]]:
        """
        Evaluates geofence configured rules against current telemetry & state.
        Returns a list of event dictionaries to be saved and broadcast.
        """
        events: List[Dict[str, Any]] = []
        now_ts = telemetry.get("timestamp") or time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        device_id = tracker.device_id
        geofence_id = tracker.geofence_id
        rules = geofence.get("rules", {})
        
        lat = telemetry.get("latitude")
        lng = telemetry.get("longitude")
        acc = telemetry.get("accuracy_m")
        dist = evaluation_result.get("distance_to_boundary_m", 0.0)
        temp_c = telemetry.get("temperature") if telemetry.get("temperature") is not None else telemetry.get("cargo_temp_c")
        speed_kmh = telemetry.get("speed_kmh") if telemetry.get("speed_kmh") is not None else telemetry.get("speed")
        trip_id = telemetry.get("trip_id")

        # Base event dictionary builder
        def make_event(event_type: str, severity: str, details: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
            ev = {
                "geofence_id": geofence_id,
                "device_id": device_id,
                "trip_id": trip_id,
                "event_type": event_type,
                "latitude": lat,
                "longitude": lng,
                "accuracy_m": acc,
                "distance_to_boundary_m": dist,
                "temperature_c": temp_c,
                "speed_kmh": speed_kmh,
                "previous_state": tracker.previous_state,
                "new_state": tracker.current_state,
                "severity": severity,
                "timestamp": now_ts,
                "details": details or {}
            }
            return ev

        # ------------------------------------------------------------------
        # 1. TRANSITION EVENTS (ENTER / EXIT / DWELL / ROUTE_DEVIATION)
        # ------------------------------------------------------------------
        geom_type = (geofence.get("geometry", {}).get("type") or "CIRCLE").upper()

        if transition_event == "ENTER" and rules.get("enter", True):
            if geom_type == "CORRIDOR":
                events.append(make_event("CORRIDOR_ENTRY", "INFO", {
                    "zone_name": geofence.get("name"),
                    "message": f"Vehicle {device_id} entered route corridor '{geofence.get('name')}'"
                }))
            else:
                events.append(make_event("GEOFENCE_ENTER", "INFO", {
                    "zone_name": geofence.get("name"),
                    "message": f"Vehicle {device_id} entered geofence '{geofence.get('name')}'"
                }))

        elif transition_event == "EXIT" and rules.get("exit", True):
            if geom_type == "CORRIDOR":
                sev = "CRITICAL" if dist > 1000 else "WARNING"
                events.append(make_event("ROUTE_DEVIATION", sev, {
                    "zone_name": geofence.get("name"),
                    "deviation_m": dist,
                    "message": f"Vehicle {device_id} deviated from route corridor '{geofence.get('name')}' by {round(dist, 1)}m"
                }))
            else:
                events.append(make_event("GEOFENCE_EXIT", "INFO", {
                    "zone_name": geofence.get("name"),
                    "message": f"Vehicle {device_id} exited geofence '{geofence.get('name')}'"
                }))

        elif transition_event == "DWELL" and rules.get("dwell", False):
            events.append(make_event("GEOFENCE_DWELL", "INFO", {
                "zone_name": geofence.get("name"),
                "dwell_seconds": rules.get("dwell_seconds", 300),
                "message": f"Vehicle {device_id} has dwelled in geofence '{geofence.get('name')}' for {rules.get('dwell_seconds', 300)}s"
            }))

        # ------------------------------------------------------------------
        # 2. CONTINUOUS IN-ZONE RULES (SPEED & COLD-CHAIN TEMPERATURE)
        # Only evaluate while confirmed INSIDE or DWELL
        # ------------------------------------------------------------------
        if tracker.current_state in [GeofenceState.INSIDE, GeofenceState.DWELL]:
            # Speed Violation Check
            max_speed = rules.get("max_speed_kmh")
            if max_speed is not None and speed_kmh is not None and speed_kmh > 0:
                if float(speed_kmh) > float(max_speed):
                    key = (device_id, geofence_id, "SPEED_VIOLATION")
                    if self._can_fire(key):
                        events.append(make_event("SPEED_VIOLATION", "WARNING", {
                            "zone_name": geofence.get("name"),
                            "speed_kmh": speed_kmh,
                            "allowed_max_kmh": max_speed,
                            "message": f"Vehicle speed {speed_kmh} km/h exceeded limit {max_speed} km/h in '{geofence.get('name')}'"
                        }))

            # Cold-Chain Temperature Violation Check
            temp_rule = rules.get("temperature", {})
            if temp_rule.get("enabled", False) and temp_c is not None:
                min_c = temp_rule.get("min_c")
                max_c = temp_rule.get("max_c")
                temp_val = float(temp_c)

                violation = False
                reason = ""
                if min_c is not None and temp_val < float(min_c):
                    violation = True
                    reason = f"Temperature {temp_val:.1f}°C below minimum threshold {min_c}°C"
                elif max_c is not None and temp_val > float(max_c):
                    violation = True
                    reason = f"Temperature {temp_val:.1f}°C exceeded maximum threshold {max_c}°C"

                if violation:
                    key = (device_id, geofence_id, "TEMPERATURE_VIOLATION")
                    if self._can_fire(key):
                        events.append(make_event("TEMPERATURE_VIOLATION", "CRITICAL", {
                            "zone_name": geofence.get("name"),
                            "temperature_c": temp_val,
                            "allowed_min_c": min_c,
                            "allowed_max_c": max_c,
                            "message": f"Cold-chain excursion in '{geofence.get('name')}': {reason}"
                        }))

        return events
