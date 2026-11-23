"""
==============================================================================
FILE: backend/geofencing/state_machine.py
PURPOSE:
Geofence State Machine with GNSS Accuracy Protection and Debounced State Transitions.
Prevents boundary jitter, false alerts, and noisy GPS flips.
==============================================================================
"""

import time
from typing import Dict, Any, Optional, Tuple


class GeofenceState:
    UNKNOWN = "UNKNOWN"
    OUTSIDE = "OUTSIDE"
    ENTER_CANDIDATE = "ENTER_CANDIDATE"
    INSIDE = "INSIDE"
    DWELL = "DWELL"
    EXIT_CANDIDATE = "EXIT_CANDIDATE"
    GPS_UNRELIABLE = "GPS_UNRELIABLE"


class DeviceGeofenceTracker:
    """Tracks state and confirmation counts for a single (device_id, geofence_id) pair."""

    def __init__(self, device_id: str, geofence_id: int):
        self.device_id = device_id
        self.geofence_id = geofence_id
        self.current_state = GeofenceState.UNKNOWN
        self.previous_state = GeofenceState.UNKNOWN
        self.entered_at: Optional[float] = None  # epoch timestamp
        self.dwell_triggered = False
        self.enter_candidate_count = 0
        self.exit_candidate_count = 0
        self.last_seen_time = time.time()

    def update(
        self,
        inside_reading: bool,
        distance_to_boundary_m: float,
        accuracy_m: Optional[float] = None,
        dwell_seconds: int = 300,
        enter_confirmations: int = 2,
        exit_confirmations: int = 2
    ) -> Tuple[str, Optional[str]]:
        """
        Processes a new location sample and returns (new_state, transition_event).
        transition_event is one of: "ENTER", "EXIT", "DWELL", None.
        """
        now = time.time()
        self.last_seen_time = now
        transition_event = None

        # GPS Accuracy Check: If sensor uncertainty exceeds distance to the boundary,
        # flag as GPS_UNRELIABLE to avoid jitter-induced alert spam.
        if accuracy_m is not None and accuracy_m > 0:
            if accuracy_m > distance_to_boundary_m and distance_to_boundary_m < 50.0:
                # Close to edge and accuracy is poor
                prev = self.current_state
                self.previous_state = prev
                self.current_state = GeofenceState.GPS_UNRELIABLE
                return self.current_state, None

        # 1. Vehicle is reported INSIDE
        if inside_reading:
            self.exit_candidate_count = 0  # reset exit debounce

            if self.current_state in [GeofenceState.UNKNOWN, GeofenceState.OUTSIDE]:
                self.enter_candidate_count += 1
                if self.enter_candidate_count >= enter_confirmations:
                    self.previous_state = self.current_state
                    self.current_state = GeofenceState.INSIDE
                    self.entered_at = now
                    self.dwell_triggered = False
                    transition_event = "ENTER"
                else:
                    self.previous_state = self.current_state
                    self.current_state = GeofenceState.ENTER_CANDIDATE

            elif self.current_state == GeofenceState.ENTER_CANDIDATE:
                self.enter_candidate_count += 1
                if self.enter_candidate_count >= enter_confirmations:
                    self.previous_state = GeofenceState.OUTSIDE
                    self.current_state = GeofenceState.INSIDE
                    self.entered_at = now
                    self.dwell_triggered = False
                    transition_event = "ENTER"

            elif self.current_state in [GeofenceState.INSIDE, GeofenceState.DWELL]:
                # Check for Dwell threshold
                if not self.dwell_triggered and self.entered_at:
                    elapsed = now - self.entered_at
                    if elapsed >= dwell_seconds:
                        self.dwell_triggered = True
                        self.previous_state = self.current_state
                        self.current_state = GeofenceState.DWELL
                        transition_event = "DWELL"

        # 2. Vehicle is reported OUTSIDE
        else:
            self.enter_candidate_count = 0  # reset enter debounce

            if self.current_state in [GeofenceState.INSIDE, GeofenceState.DWELL]:
                self.exit_candidate_count += 1
                if self.exit_candidate_count >= exit_confirmations:
                    self.previous_state = self.current_state
                    self.current_state = GeofenceState.OUTSIDE
                    self.entered_at = None
                    self.dwell_triggered = False
                    transition_event = "EXIT"
                else:
                    self.previous_state = self.current_state
                    self.current_state = GeofenceState.EXIT_CANDIDATE

            elif self.current_state == GeofenceState.EXIT_CANDIDATE:
                self.exit_candidate_count += 1
                if self.exit_candidate_count >= exit_confirmations:
                    self.previous_state = GeofenceState.INSIDE
                    self.current_state = GeofenceState.OUTSIDE
                    self.entered_at = None
                    self.dwell_triggered = False
                    transition_event = "EXIT"

            elif self.current_state == GeofenceState.UNKNOWN:
                self.previous_state = GeofenceState.UNKNOWN
                self.current_state = GeofenceState.OUTSIDE

        return self.current_state, transition_event


class GeofenceStateMachineManager:
    """Manages active state machines across all (device, geofence) combinations."""

    def __init__(self):
        self._trackers: Dict[Tuple[str, int], DeviceGeofenceTracker] = {}

    def get_tracker(self, device_id: str, geofence_id: int) -> DeviceGeofenceTracker:
        key = (device_id, geofence_id)
        if key not in self._trackers:
            self._trackers[key] = DeviceGeofenceTracker(device_id, geofence_id)
        return self._trackers[key]

    def remove_tracker(self, device_id: str, geofence_id: int):
        self._trackers.pop((device_id, geofence_id), None)

    def remove_geofence(self, geofence_id: int):
        keys_to_remove = [k for k in self._trackers if k[1] == geofence_id]
        for k in keys_to_remove:
            self._trackers.pop(k, None)


# Singleton instance
state_machine_manager = GeofenceStateMachineManager()
