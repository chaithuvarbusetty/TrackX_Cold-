"""
==============================================================================
FILE: storage.py
PURPOSE:
Provides an in-memory high-throughput time-series store and ring buffer.

KEY RESPONSIBILITIES:
1. Maintains recent historical telemetry packets for each vehicle (needed by AI models
   to compute rates of change, slopes, and historical baselines).
2. Stores the latest real-time state for rapid dashboard rendering.
3. Keeps an active ring buffer of Layer-1 safety alerts.
4. Tracks running driver safety score metrics.
==============================================================================
"""

from typing import Dict, List, Optional, Deque
from collections import deque
from datetime import datetime, timezone
import logging
from .models import RawTelemetryPacket, RuleAlert, EnrichedTelemetryResponse
from .database import (
    db_save_latest_device_state,
    db_get_latest_device_state,
    db_get_all_latest_device_states
)

logger = logging.getLogger("tracx.storage")


class TelemetryStore:
    """
    Thread-safe in-memory time-series cache and ring buffer.
    In production deployments, this sits alongside PostgreSQL / TimescaleDB and Redis.
    """

    def __init__(self, max_history_per_device: int = 500):
        # Maximum number of past sensor readings kept in RAM per vehicle
        self.max_history = max_history_per_device

        # Maps device_id -> deque of EnrichedTelemetryResponse
        self.history: Dict[str, Deque[EnrichedTelemetryResponse]] = {}

        # Maps device_id -> latest instantaneous state
        self.latest_state: Dict[str, EnrichedTelemetryResponse] = {}

        # Global ring buffer of recent alerts across the entire fleet (max 200 items)
        self.alerts: Deque[RuleAlert] = deque(maxlen=200)

        # Driver safety score accumulator: device_id -> rolling list of scores
        self.driver_scores: Dict[str, List[int]] = {}

        # Raw payload as received directly from Quectel EC200U firmware
        self.raw_firmware_payloads: Dict[str, dict] = {}

        # Exact UTC timestamps when packets were received by the server
        self.last_received_times: Dict[str, datetime] = {}

        # Rich human-readable location context: device_id -> dict
        self.location_contexts: Dict[str, dict] = {}

    def restore_from_db(self):
        """Restores persisted latest state snapshots and raw payloads from SQLite on startup."""
        try:
            records = db_get_all_latest_device_states()
            for rec in records:
                dev_id = rec["device_id"]
                if rec.get("updated_at"):
                    try:
                        self.last_received_times[dev_id] = datetime.fromisoformat(rec["updated_at"].replace("Z", "+00:00"))
                    except Exception:
                        pass
                if rec.get("raw_payload"):
                    self.raw_firmware_payloads[dev_id] = rec["raw_payload"]
                if rec.get("latest_telemetry"):
                    try:
                        enriched = EnrichedTelemetryResponse.model_validate(rec["latest_telemetry"])
                        self.latest_state[dev_id] = enriched
                        if dev_id not in self.history:
                            self.history[dev_id] = deque(maxlen=self.max_history)
                        self.history[dev_id].append(enriched)
                    except Exception as e:
                        pass
        except Exception as e:
            print(f"Warning restoring telemetry from database: {e}")

    def insert(self, enriched: EnrichedTelemetryResponse):
        """
        Inserts a new enriched telemetry packet into the vehicle's time-series history
        and updates active state and alert queues.
        """
        device_id = enriched.device_id
        self.last_received_times[device_id] = datetime.now(timezone.utc)
        if device_id not in self.history:
            self.history[device_id] = deque(maxlen=self.max_history)
        if device_id not in self.driver_scores:
            self.driver_scores[device_id] = []

        # Append to historical ring buffer
        self.history[device_id].append(enriched)

        # Update latest instantaneous snapshot
        self.latest_state[device_id] = enriched

        # Store any newly triggered Layer-1 safety alerts
        for alert in enriched.layer1_deterministic_alerts:
            self.alerts.appendleft(alert)

        # Record driver safety index for rolling average computation
        driver_ai = enriched.layer2_ai_intelligence.get("driver_behavior", {})
        score = driver_ai.get("driver_safety_score_100")
        if score is not None:
            self.driver_scores[device_id].append(score)
            if len(self.driver_scores[device_id]) > 50:
                self.driver_scores[device_id].pop(0)

        # Persist to database state table
        try:
            raw_p = self.raw_firmware_payloads.get(device_id)
            db_save_latest_device_state(device_id, enriched.model_dump(mode="json"), raw_p)
        except Exception as exc:
            logger.warning("Failed to persist latest state for %s: %s", device_id, exc)

    def get_latest(self, device_id: str) -> Optional[EnrichedTelemetryResponse]:
        """Returns the most recent telemetry packet for a specific device."""
        if device_id in self.latest_state:
            return self.latest_state[device_id]
        
        # Fallback to persistent SQLite state
        db_rec = db_get_latest_device_state(device_id)
        if db_rec and db_rec.get("latest_telemetry"):
            try:
                enriched = EnrichedTelemetryResponse.model_validate(db_rec["latest_telemetry"])
                self.latest_state[device_id] = enriched
                if db_rec.get("raw_payload"):
                    self.raw_firmware_payloads[device_id] = db_rec["raw_payload"]
                return enriched
            except Exception:
                pass
        return None

    def get_all_latest(self) -> List[EnrichedTelemetryResponse]:
        """Returns the latest telemetry packet for all active fleet vehicles."""
        return list(self.latest_state.values())

    def get_history(self, device_id: str, limit: int = 100) -> List[EnrichedTelemetryResponse]:
        """Returns chronological historical telemetry for charting and regression analysis."""
        if device_id not in self.history:
            return []
        items = list(self.history[device_id])
        return items[-limit:]

    def get_recent_alerts(self, limit: int = 50) -> List[RuleAlert]:
        """Returns the most recent alerts across the fleet."""
        return list(self.alerts)[:limit]

    def get_average_driver_score(self, device_id: str) -> int:
        """Calculates rolling average driver safety index for a vehicle."""
        scores = self.driver_scores.get(device_id, [])
        if not scores:
            return 95  # Baseline score for clean drivers
        return int(sum(scores) / len(scores))

    def set_raw_payload(self, device_id: str, payload: dict):
        """Stores the exact unmodified JSON payload from firmware."""
        self.raw_firmware_payloads[device_id] = payload
        self.last_received_times[device_id] = datetime.now(timezone.utc)
        try:
            curr_enriched = self.latest_state.get(device_id)
            en_dict = curr_enriched.model_dump(mode="json") if curr_enriched else {}
            db_save_latest_device_state(device_id, en_dict, payload)
        except Exception as exc:
            logger.warning("Failed to persist latest device state for %s: %s", device_id, exc)

    def get_raw_payload(self, device_id: str) -> Optional[dict]:
        """Retrieves latest raw payload received from firmware."""
        if device_id in self.raw_firmware_payloads:
            return self.raw_firmware_payloads[device_id]
        
        db_rec = db_get_latest_device_state(device_id)
        if db_rec and db_rec.get("raw_payload"):
            self.raw_firmware_payloads[device_id] = db_rec["raw_payload"]
            return db_rec["raw_payload"]
        return None

    def get_last_received_time(self, device_id: str) -> Optional[datetime]:
        """Retrieves the exact UTC timestamp when a packet was received for this device."""
        if device_id in self.last_received_times:
            return self.last_received_times[device_id]
        db_rec = db_get_latest_device_state(device_id)
        if db_rec and db_rec.get("updated_at"):
            try:
                rx = datetime.fromisoformat(db_rec["updated_at"].replace("Z", "+00:00"))
                self.last_received_times[device_id] = rx
                return rx
            except Exception:
                pass
        return None

    def set_location_context(self, device_id: str, location_context: dict):
        """Stores rich human-readable location context."""
        self.location_contexts[device_id] = location_context

    def get_location_context(self, device_id: str) -> Optional[dict]:
        """Retrieves rich human-readable location context."""
        return self.location_contexts.get(device_id)

    def clear_all(self):
        """Clears all in-memory telemetry, latest state snapshots, driver scores, and alerts."""
        self.history.clear()
        self.latest_state.clear()
        self.alerts.clear()
        self.driver_scores.clear()
        self.raw_firmware_payloads.clear()
        self.location_contexts.clear()


# Global singleton instance for use throughout the backend
store = TelemetryStore()
