"""
Constants and operational thresholds for TracX / Smart CCMS Platform.
"""

# Cold-Chain Standard Temperature Bands (°C)
DEFAULT_TARGET_MIN_C = 2.0
DEFAULT_TARGET_MAX_C = 8.0
CRITICAL_HIGH_TEMP_C = 15.0
CRITICAL_LOW_TEMP_C = -5.0

# Telemetry & Connectivity Timeouts (seconds)
TELEMETRY_INTERVAL_SEC = 30
OFFLINE_TIMEOUT_SEC = 300  # 5 minutes without payload marks device & node offline

# GPS & Speed Thresholds
MAX_FEASIBLE_SPEED_KMH = 140.0
STATIONARY_SPEED_THRESHOLD_KMH = 3.0
GPS_ACCURACY_THRESHOLD_M = 50.0

# Cellular Signal (dBm) Quality Bands
RSSI_EXCELLENT_DBM = -70
RSSI_GOOD_DBM = -85
RSSI_FAIR_DBM = -100

# Device Identifiers
DEFAULT_GATEWAY_ID = "GW-001"
DEFAULT_NODE_ID = "NODE-001"

# Google Maps Platform Configuration
import os
GOOGLE_MAPS_API_KEY = os.getenv("GOOGLE_MAPS_API_KEY", "AIzaSyBcyIuM7dsjxwOd1HjLHbUZmCTvsDdji_k")

