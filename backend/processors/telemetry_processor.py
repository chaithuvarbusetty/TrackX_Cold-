"""
Telemetry Processor: Orchestrates GPS, Speed, Signal, and Status processors.
"""

from typing import Dict, Any, Optional
from datetime import datetime
from .gps_processor import GPSProcessor
from .speed_calculator import SpeedCalculator
from .signal_processor import SignalProcessor
from .status_processor import StatusProcessor
from ..utils.time_utils import parse_timestamp, utc_now


class TelemetryProcessor:
    """Consolidates sensor data into a structured, validated telemetry model."""

    @staticmethod
    def process_incoming_payload(
        payload: Dict[str, Any],
        prev_point: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Parses and enhances incoming raw hardware payload.
        """
        device_id = payload.get("gateway_id") or payload.get("device_id") or "GW-001"
        node_id = payload.get("node_id") or "NODE-001"
        ts = parse_timestamp(payload.get("timestamp"))

        # 1. Process Coordinates
        gps_result = GPSProcessor.process_coordinates(
            lat=payload.get("latitude"),
            lon=payload.get("longitude"),
            accuracy_m=payload.get("location_accuracy"),
            location_source=payload.get("location_source")
        )

        # 2. Process Speed
        prev_lat = prev_point.get("latitude") if prev_point else None
        prev_lon = prev_point.get("longitude") if prev_point else None
        prev_time = prev_point.get("timestamp") if prev_point else None
        fallback_speed = prev_point.get("speed") if prev_point else None

        speed_result = SpeedCalculator.calculate_speed(
            prev_lat=prev_lat,
            prev_lon=prev_lon,
            prev_time=prev_time,
            curr_lat=gps_result["latitude"],
            curr_lon=gps_result["longitude"],
            curr_time=ts,
            fallback_speed=fallback_speed
        )

        # 3. Process Signals
        network_rssi = payload.get("network_rssi")
        node_rssi = payload.get("node_rssi")
        node_connected = bool(payload.get("node_connected", False))

        signal_result = SignalProcessor.process_cellular_rssi(network_rssi)
        node_signal_result = SignalProcessor.process_node_rssi(node_rssi, node_connected)

        # 4. Process Status
        status_result = StatusProcessor.process_door_and_tamper(
            door_status=payload.get("door_status"),
            tamper=payload.get("tamper")
        )

        # Temperature
        temperature = payload.get("temperature")
        if temperature is not None:
            try:
                temperature = float(temperature)
            except (ValueError, TypeError):
                temperature = None

        return {
            "device_id": device_id,
            "node_id": node_id,
            "timestamp": ts,
            "temperature": temperature,
            "gps": gps_result,
            "speed": speed_result,
            "cellular": signal_result,
            "node_signal": node_signal_result,
            "node_connected": node_connected,
            "status": status_result,
            "raw_payload": payload
        }
