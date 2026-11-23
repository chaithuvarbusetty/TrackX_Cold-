"""
==============================================================================
FILE: backend/geofencing/service.py
PURPOSE:
Core Geofence Engine and Orchestration Service for TracX Platform.
Coordinates Geometry Boundary checks, State Machine Transitions, Rule Violations,
Database Persistence, and Notification Alerts.
==============================================================================
"""

import asyncio
import logging
from datetime import datetime
from typing import Dict, Any, List, Optional

from .evaluator import evaluate_geofence_boundary
from .state_machine import GeofenceStateMachineManager, GeofenceState
from .rules import GeofenceRuleEvaluator
from ..database.database import (
    db_save_geofence,
    db_get_geofences,
    db_get_geofence,
    db_update_geofence,
    db_delete_geofence,
    db_save_geofence_event,
    db_get_geofence_events,
)
from ..notifications import notifications

logger = logging.getLogger("tracx.geofencing")


class GeofenceEngine:
    """Singleton service managing geofence boundaries, state tracking, and evaluations."""

    def __init__(self):
        self.state_manager = GeofenceStateMachineManager()
        self.rule_evaluator = GeofenceRuleEvaluator(violation_cooldown_seconds=300)
        # In-memory latest status cache: device_id -> List[geofence_status_dict]
        self._latest_status: Dict[str, List[Dict[str, Any]]] = {}

    # -------------------------------------------------------------------------
    # TELEMETRY EVALUATION PIPELINE
    # -------------------------------------------------------------------------
    def evaluate_telemetry(self, telemetry: Dict[str, Any]) -> Dict[str, Any]:
        """
        Synchronously evaluates a telemetry reading against all configured geofences.
        Triggers state transitions, logs geofence events to DB, and fires alert tasks.
        """
        device_id = str(telemetry.get("device_id") or telemetry.get("gateway_id") or "")
        if not device_id:
            return {"evaluated_count": 0, "geofences": [], "events": []}

        lat = telemetry.get("latitude")
        lng = telemetry.get("longitude")
        if lat is None or lng is None or (lat == 0.0 and lng == 0.0):
            # No valid GPS fix to evaluate against boundaries
            return {
                "device_id": device_id,
                "evaluated_count": 0,
                "geofences": self._latest_status.get(device_id, []),
                "events": []
            }

        try:
            lat = float(lat)
            lng = float(lng)
        except (ValueError, TypeError):
            return {"evaluated_count": 0, "geofences": [], "events": []}

        acc = telemetry.get("accuracy_m")
        if acc is not None:
            try:
                acc = float(acc)
            except (ValueError, TypeError):
                acc = None

        # Fetch all active geofences configured for this device or fleet-wide ("ALL")
        all_geofences = db_get_geofences(enabled_only=True)
        relevant_geofences = [
            g for g in all_geofences
            if g.get("device_id") in [device_id, "ALL", "*"]
        ]

        evaluated_status: List[Dict[str, Any]] = []
        generated_events: List[Dict[str, Any]] = []
        now_str = datetime.utcnow().isoformat()

        for gf in relevant_geofences:
            gf_id = gf["id"]
            rules = gf.get("rules", {})
            dwell_seconds = rules.get("dwell_seconds", 300)

            # 1. Geometry Boundary Evaluation
            boundary_res = evaluate_geofence_boundary(
                latitude=lat,
                longitude=lng,
                geofence=gf
            )
            inside = boundary_res.get("inside", False)
            dist_to_boundary = boundary_res.get("distance_to_boundary_m", 0.0)
            dist_from_center = boundary_res.get("distance_from_center_m", 0.0)

            # 2. State Machine Update with Debounce & GPS Protection
            tracker = self.state_manager.get_tracker(device_id, gf_id)
            new_state, transition_event = tracker.update(
                inside_reading=inside,
                distance_to_boundary_m=dist_to_boundary,
                accuracy_m=acc,
                dwell_seconds=dwell_seconds,
                enter_confirmations=2,
                exit_confirmations=2
            )

            # 3. Rule Engine Evaluation (Transitions, Speed, Temp Violations)
            events = self.rule_evaluator.evaluate_geofence_rules(
                geofence=gf,
                telemetry=telemetry,
                tracker=tracker,
                transition_event=transition_event,
                evaluation_result=boundary_res
            )

            # 4. Event Persistence & Alert Dispatch
            for ev in events:
                try:
                    saved_event = db_save_geofence_event(ev)
                    generated_events.append(saved_event)

                    # Trigger alert via notifications asynchronously
                    severity = ev.get("severity", "INFO")
                    details = ev.get("details", {})
                    msg = details.get("message") or f"{ev['event_type']} in geofence {gf.get('name')}"
                    
                    try:
                        loop = asyncio.get_running_loop()
                        loop.create_task(notifications.dispatch_alert(
                            device_id=device_id,
                            alert_name=ev["event_type"],
                            message=msg,
                            severity=severity,
                            details={
                                "geofence_id": gf_id,
                                "geofence_name": gf.get("name"),
                                "event_type": ev["event_type"],
                                "latitude": lat,
                                "longitude": lng,
                                "temperature_c": ev.get("temperature_c"),
                                "speed_kmh": ev.get("speed_kmh"),
                                "distance_to_boundary_m": dist_to_boundary
                            }
                        ))
                    except RuntimeError:
                        # No running event loop in thread; schedule safely or skip
                        pass

                except Exception as e:
                    logger.error("Failed saving geofence event: %s", e)

            # 5. Compile live status report for this geofence
            status_item = {
                "geofence_id": gf_id,
                "name": gf.get("name"),
                "device_id": gf.get("device_id"),
                "geometry_type": gf.get("geometry", {}).get("type", "CIRCLE"),
                "state": new_state,
                "inside": inside,
                "distance_to_boundary_m": round(dist_to_boundary, 1),
                "distance_from_center_m": round(dist_from_center, 1),
                "last_evaluated": now_str
            }
            evaluated_status.append(status_item)

        # Cache live geofence status for quick dashboard lookups
        self._latest_status[device_id] = evaluated_status

        return {
            "device_id": device_id,
            "evaluated_count": len(relevant_geofences),
            "geofences": evaluated_status,
            "events": generated_events
        }

    # -------------------------------------------------------------------------
    # CRUD AND QUERY OPERATIONS
    # -------------------------------------------------------------------------
    def create_geofence(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Creates and stores a new Geofence configuration."""
        created = db_save_geofence(data)
        return created

    def get_geofences(self, device_id: Optional[str] = None, enabled_only: bool = False) -> List[Dict[str, Any]]:
        """Lists configured geofences."""
        return db_get_geofences(device_id=device_id, enabled_only=enabled_only)

    def get_geofence(self, geofence_id: int) -> Optional[Dict[str, Any]]:
        """Retrieves a single geofence definition."""
        return db_get_geofence(geofence_id)

    def update_geofence(self, geofence_id: int, updates: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Updates an existing geofence."""
        updated = db_update_geofence(geofence_id, updates)
        return updated

    def delete_geofence(self, geofence_id: int) -> bool:
        """Deletes a geofence and cleans up internal tracker states."""
        self.state_manager.remove_geofence(geofence_id)
        return db_delete_geofence(geofence_id)

    def get_events(
        self,
        geofence_id: Optional[int] = None,
        device_id: Optional[str] = None,
        trip_id: Optional[str] = None,
        limit: int = 50
    ) -> List[Dict[str, Any]]:
        """Queries geofence event audit log."""
        return db_get_geofence_events(
            geofence_id=geofence_id,
            device_id=device_id,
            trip_id=trip_id,
            limit=limit
        )

    def get_latest_status(self, device_id: str) -> List[Dict[str, Any]]:
        """Returns the most recent geofence states for a device."""
        return self._latest_status.get(device_id, [])


# Global engine singleton
geofence_engine = GeofenceEngine()
