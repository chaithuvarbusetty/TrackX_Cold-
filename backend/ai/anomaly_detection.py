"""
AI Model #2: GPS / Route Anomaly Detection.

Detects:

1. GPS signal loss
2. Invalid GPS coordinates
3. Impossible vehicle speed
4. GPS position jumps
5. Timestamp problems
6. Sudden movement inconsistencies
7. Dead-reckoning position when GPS is unavailable

The model uses actual telemetry timestamps.
"""

from __future__ import annotations

from typing import List, Optional, Tuple
from math import radians, sin, cos, sqrt, atan2

from ..models import (
    RawTelemetryPacket,
    AIGpsIntelligence,
)


class GPSAnomalyDetector:
    """
    GPS intelligence and kinematic anomaly detection.
    """

    # ---------------------------------------------------------
    # Configuration
    # ---------------------------------------------------------

    MAX_REASONABLE_SPEED_KMH = 140.0

    MAX_GPS_JUMP_SPEED_KMH = 160.0

    MIN_VALID_LATITUDE = -90.0
    MAX_VALID_LATITUDE = 90.0

    MIN_VALID_LONGITUDE = -180.0
    MAX_VALID_LONGITUDE = 180.0

    GPS_CONFIDENCE_GOOD = 0.90
    GPS_CONFIDENCE_WARNING = 0.55
    GPS_CONFIDENCE_BAD = 0.20

    EARTH_RADIUS_KM = 6371.0088

    # ---------------------------------------------------------
    # MAIN METHOD
    # ---------------------------------------------------------

    @classmethod
    def detect(
        cls,
        current: RawTelemetryPacket,
        history: List[RawTelemetryPacket],
    ) -> AIGpsIntelligence:
        result = cls._detect_core(current, history)
        if current.gps is not None:
            result.speed_kmh = current.gps.speed_kmh
            result.heading_deg = current.gps.heading_deg
            result.satellites_count = current.gps.satellites_count
            result.fix_status = current.gps.fix_status
        return result

    @classmethod
    def _detect_core(
        cls,
        current: RawTelemetryPacket,
        history: List[RawTelemetryPacket],
    ) -> AIGpsIntelligence:

        # -----------------------------------------------------
        # 1. Validate current GPS
        # -----------------------------------------------------

        if not cls._valid_coordinates(current):

            return cls._handle_gps_loss(
                current=current,
                history=history,
            )

        # -----------------------------------------------------
        # 2. Find previous valid GPS packet
        # -----------------------------------------------------

        previous = cls._find_previous_valid_packet(
            history
        )

        # -----------------------------------------------------
        # No previous GPS point
        # -----------------------------------------------------

        if previous is None:

            return cls._first_gps_point(
                current
            )

        # -----------------------------------------------------
        # 3. Validate timestamps
        # -----------------------------------------------------

        time_difference = (
            current.timestamp
            - previous.timestamp
        ).total_seconds()

        if time_difference <= 0:

            return cls._timestamp_anomaly(
                current
            )

        # -----------------------------------------------------
        # 4. Calculate distance
        # -----------------------------------------------------

        distance_km = cls._calculate_distance(
            previous.gps.lat,
            previous.gps.lng,
            current.gps.lat,
            current.gps.lng,
        )

        # -----------------------------------------------------
        # 5. Calculate actual movement speed
        # -----------------------------------------------------

        calculated_speed = (
            distance_km
            / (time_difference / 3600.0)
        )

        # -----------------------------------------------------
        # 6. Get reported device speed
        # -----------------------------------------------------

        reported_speed = float(
            current.gps.speed_kmh or 0.0
        )

        # -----------------------------------------------------
        # 7. Detect GPS jump
        # -----------------------------------------------------

        if (
            calculated_speed
            > cls.MAX_GPS_JUMP_SPEED_KMH
        ):

            return cls._gps_jump_response(
                current=current,
                previous=previous,
                distance_km=distance_km,
                calculated_speed=calculated_speed,
                time_difference=time_difference,
            )

        # -----------------------------------------------------
        # 8. Detect impossible reported speed
        # -----------------------------------------------------

        if (
            reported_speed
            > cls.MAX_REASONABLE_SPEED_KMH
        ):

            return cls._speed_anomaly_response(
                current=current,
                reported_speed=reported_speed,
                calculated_speed=calculated_speed,
            )

        # -----------------------------------------------------
        # 9. Compare reported and calculated speed
        # -----------------------------------------------------

        speed_difference = abs(
            reported_speed
            - calculated_speed
        )

        speed_mismatch = (
            reported_speed > 5.0
            and calculated_speed > 5.0
            and speed_difference
            > max(
                25.0,
                reported_speed * 0.50,
            )
        )

        if speed_mismatch:

            return cls._speed_mismatch_response(
                current=current,
                reported_speed=reported_speed,
                calculated_speed=calculated_speed,
            )

        # -----------------------------------------------------
        # 10. Normal GPS
        # -----------------------------------------------------

        return cls._normal_gps_response(
            current=current,
            calculated_speed=calculated_speed,
            distance_km=distance_km,
            time_difference=time_difference,
        )

    # =========================================================
    # VALIDATE GPS
    # =========================================================

    @classmethod
    def _valid_coordinates(
        cls,
        packet: RawTelemetryPacket,
    ) -> bool:

        if packet.gps is None:
            return False

        latitude = packet.gps.lat
        longitude = packet.gps.lng

        if latitude is None:
            return False

        if longitude is None:
            return False

        if not (
            cls.MIN_VALID_LATITUDE
            <= latitude
            <= cls.MAX_VALID_LATITUDE
        ):
            return False

        if not (
            cls.MIN_VALID_LONGITUDE
            <= longitude
            <= cls.MAX_VALID_LONGITUDE
        ):
            return False

        # -----------------------------------------------------
        # Reject obvious zero coordinates.
        # -----------------------------------------------------

        if latitude == 0.0 and longitude == 0.0:
            return False

        return True

    # =========================================================
    # FIND PREVIOUS VALID GPS
    # =========================================================

    @classmethod
    def _find_previous_valid_packet(
        cls,
        history: List[RawTelemetryPacket],
    ) -> Optional[RawTelemetryPacket]:

        for packet in reversed(history):

            if cls._valid_coordinates(packet):

                return packet

        return None

    # =========================================================
    # GPS LOSS
    # =========================================================

    @classmethod
    def _handle_gps_loss(
        cls,
        current: RawTelemetryPacket,
        history: List[RawTelemetryPacket],
    ) -> AIGpsIntelligence:

        previous = cls._find_previous_valid_packet(
            history
        )

        # -----------------------------------------------------
        # No previous position available
        # -----------------------------------------------------

        if previous is None:

            return AIGpsIntelligence(

                is_valid_kinematic=False,

                kinematic_anomaly_detected=False,

                reason=(
                    "GPS position unavailable and "
                    "no previous valid position exists."
                ),

                tracking_mode="SIGNAL_LOST",

                dead_reckoning_lat=None,

                dead_reckoning_lng=None,

                confidence=0.0,
            )

        # -----------------------------------------------------
        # Time since last valid GPS
        # -----------------------------------------------------

        elapsed_seconds = max(
            0.0,
            (
                current.timestamp
                - previous.timestamp
            ).total_seconds(),
        )

        # -----------------------------------------------------
        # Last known speed
        # -----------------------------------------------------

        speed_kmh = float(
            previous.gps.speed_kmh or 0.0
        )

        heading = float(
            previous.gps.heading_deg or 0.0
        )

        # -----------------------------------------------------
        # Dead reckoning
        # -----------------------------------------------------

        projected_lat, projected_lng = (
            cls._project_position(
                latitude=previous.gps.lat,
                longitude=previous.gps.lng,
                speed_kmh=speed_kmh,
                heading_deg=heading,
                elapsed_seconds=elapsed_seconds,
            )
        )

        # -----------------------------------------------------
        # Confidence decreases with time.
        # -----------------------------------------------------

        confidence = max(
            cls.GPS_CONFIDENCE_BAD,
            0.85
            - (
                elapsed_seconds
                / 600.0
            ),
        )

        return AIGpsIntelligence(

            is_valid_kinematic=True,

            kinematic_anomaly_detected=False,

            reason=(
                "GPS fix unavailable. "
                "Last valid position projected using "
                "last known speed and heading."
            ),

            tracking_mode="DEAD_RECKONING_ACTIVE",

            dead_reckoning_lat=round(
                projected_lat,
                6,
            ),

            dead_reckoning_lng=round(
                projected_lng,
                6,
            ),

            confidence=round(
                confidence,
                2,
            ),
        )

    # =========================================================
    # FIRST GPS POINT
    # =========================================================

    @classmethod
    def _first_gps_point(
        cls,
        current: RawTelemetryPacket,
    ) -> AIGpsIntelligence:

        return AIGpsIntelligence(

            is_valid_kinematic=True,

            kinematic_anomaly_detected=False,

            reason=(
                "First valid GPS position received. "
                "Waiting for another position to calculate movement."
            ),

            tracking_mode="GNSS_LOCKED",

            dead_reckoning_lat=current.gps.lat,

            dead_reckoning_lng=current.gps.lng,

            confidence=0.65,
        )

    # =========================================================
    # TIMESTAMP ANOMALY
    # =========================================================

    @classmethod
    def _timestamp_anomaly(
        cls,
        current: RawTelemetryPacket,
    ) -> AIGpsIntelligence:

        return AIGpsIntelligence(

            is_valid_kinematic=False,

            kinematic_anomaly_detected=True,

            reason=(
                "Current GPS telemetry timestamp is "
                "not newer than the previous telemetry timestamp."
            ),

            tracking_mode="GNSS_LOCKED",

            dead_reckoning_lat=current.gps.lat,

            dead_reckoning_lng=current.gps.lng,

            confidence=0.20,
        )

    # =========================================================
    # GPS JUMP
    # =========================================================

    @classmethod
    def _gps_jump_response(
        cls,
        current: RawTelemetryPacket,
        previous: RawTelemetryPacket,
        distance_km: float,
        calculated_speed: float,
        time_difference: float,
    ) -> AIGpsIntelligence:

        return AIGpsIntelligence(

            is_valid_kinematic=False,

            kinematic_anomaly_detected=True,

            reason=(
                f"GPS position jump detected. "
                f"Device moved approximately "
                f"{distance_km:.2f} km in "
                f"{time_difference:.1f} seconds, "
                f"requiring approximately "
                f"{calculated_speed:.1f} km/h."
            ),

            tracking_mode="GNSS_LOCKED",

            dead_reckoning_lat=previous.gps.lat,

            dead_reckoning_lng=previous.gps.lng,

            confidence=0.15,
        )

    # =========================================================
    # SPEED ANOMALY
    # =========================================================

    @classmethod
    def _speed_anomaly_response(
        cls,
        current: RawTelemetryPacket,
        reported_speed: float,
        calculated_speed: float,
    ) -> AIGpsIntelligence:

        return AIGpsIntelligence(

            is_valid_kinematic=False,

            kinematic_anomaly_detected=True,

            reason=(
                f"Reported vehicle speed "
                f"{reported_speed:.1f} km/h exceeds "
                f"the configured maximum of "
                f"{cls.MAX_REASONABLE_SPEED_KMH:.1f} km/h."
            ),

            tracking_mode="GNSS_LOCKED",

            dead_reckoning_lat=current.gps.lat,

            dead_reckoning_lng=current.gps.lng,

            confidence=0.25,
        )

    # =========================================================
    # SPEED MISMATCH
    # =========================================================

    @classmethod
    def _speed_mismatch_response(
        cls,
        current: RawTelemetryPacket,
        reported_speed: float,
        calculated_speed: float,
    ) -> AIGpsIntelligence:

        return AIGpsIntelligence(

            is_valid_kinematic=False,

            kinematic_anomaly_detected=True,

            reason=(
                f"GPS speed mismatch detected. "
                f"Device reported "
                f"{reported_speed:.1f} km/h but "
                f"GPS coordinates imply approximately "
                f"{calculated_speed:.1f} km/h."
            ),

            tracking_mode="GNSS_LOCKED",

            dead_reckoning_lat=current.gps.lat,

            dead_reckoning_lng=current.gps.lng,

            confidence=0.35,
        )

    # =========================================================
    # NORMAL GPS
    # =========================================================

    @classmethod
    def _normal_gps_response(
        cls,
        current: RawTelemetryPacket,
        calculated_speed: float,
        distance_km: float,
        time_difference: float,
    ) -> AIGpsIntelligence:

        return AIGpsIntelligence(

            is_valid_kinematic=True,

            kinematic_anomaly_detected=False,

            reason=(
                f"GPS movement is kinematically plausible. "
                f"Moved {distance_km:.3f} km in "
                f"{time_difference:.1f} seconds."
            ),

            tracking_mode="GNSS_LOCKED",

            dead_reckoning_lat=current.gps.lat,

            dead_reckoning_lng=current.gps.lng,

            confidence=cls.GPS_CONFIDENCE_GOOD,
        )

    # =========================================================
    # HAVERSINE DISTANCE
    # =========================================================

    @classmethod
    def _calculate_distance(
        cls,
        lat1: float,
        lon1: float,
        lat2: float,
        lon2: float,
    ) -> float:

        """
        Calculate great-circle distance between
        two GPS coordinates.

        Returns distance in kilometres.
        """

        lat1_rad = radians(lat1)
        lat2_rad = radians(lat2)

        delta_lat = radians(
            lat2 - lat1
        )

        delta_lon = radians(
            lon2 - lon1
        )

        a = (
            sin(delta_lat / 2) ** 2
            +
            cos(lat1_rad)
            * cos(lat2_rad)
            * sin(delta_lon / 2) ** 2
        )

        c = 2 * atan2(
            sqrt(a),
            sqrt(1 - a),
        )

        return (
            cls.EARTH_RADIUS_KM
            * c
        )

    # =========================================================
    # DEAD-RECKONING POSITION
    # =========================================================

    @classmethod
    def _project_position(
        cls,
        latitude: float,
        longitude: float,
        speed_kmh: float,
        heading_deg: float,
        elapsed_seconds: float,
    ) -> Tuple[float, float]:

        """
        Project the last valid GPS position using:

            last position
            +
            last known speed
            +
            last known heading
            +
            elapsed time
        """

        # -----------------------------------------------------
        # Distance travelled
        # -----------------------------------------------------

        distance_km = (
            speed_kmh
            * elapsed_seconds
            / 3600.0
        )

        # -----------------------------------------------------
        # Convert distance to angular distance
        # -----------------------------------------------------

        angular_distance = (
            distance_km
            / cls.EARTH_RADIUS_KM
        )

        heading_rad = radians(
            heading_deg
        )

        latitude_rad = radians(
            latitude
        )

        longitude_rad = radians(
            longitude
        )

        # -----------------------------------------------------
        # Project latitude
        # -----------------------------------------------------

        new_latitude = (
            latitude_rad
            +
            angular_distance
            * cos(heading_rad)
        )

        # -----------------------------------------------------
        # Project longitude
        # -----------------------------------------------------

        denominator = cos(
            new_latitude
        )

        if abs(denominator) < 1e-10:

            new_longitude = longitude_rad

        else:

            new_longitude = (
                longitude_rad
                +
                (
                    angular_distance
                    * sin(heading_rad)
                    / denominator
                )
            )

        return (
            new_latitude * 180.0 / 3.141592653589793,
            new_longitude * 180.0 / 3.141592653589793,
        )


# Backward compatibility aliases for orchestrator engine
AnomalyDetector = GPSAnomalyDetector
GPSAnomalyDetector.filter_gps_kinematics = GPSAnomalyDetector.detect
