"""
Unified schemas export for API request & response validation.
"""

from .telemetry import (
    TelemetryRequest,
    GPSCoordinates,
    TemperatureReading,
    IMUData,
    PowerAndNetwork,
    RawTelemetryPacket,
    TemperatureTelemetryRequest,
    GPSTelemetryRequest,
    TamperTelemetryRequest,
    EnrichedTelemetryResponse
)
from .device import (
    DeviceCreateRequest,
    DeviceUpdateRequest,
    DeviceResponse
)
from .alert import (
    RuleAlert,
    ChannelConfigRequest,
    ChannelTestRequest
)
from .trip import (
    TripSummaryResponse,
    TripHaltSchema,
    TripWaypointSchema
)
from .ai import (
    AIPredictiveTemperature,
    AIGpsIntelligence,
    AIDriverBehavior,
    AITamperFusion,
    AIPredictiveDeviceHealth
)
from .geofence import (
    GeofenceCenter,
    GeofenceGeometry,
    GeofenceRules,
    GeofenceSchedule,
    GeofenceCreate,
    GeofenceUpdate,
    GeofenceResponse,
    GeofenceEventResponse
)

__all__ = [
    "TelemetryRequest",
    "GPSCoordinates",
    "TemperatureReading",
    "IMUData",
    "PowerAndNetwork",
    "RawTelemetryPacket",
    "TemperatureTelemetryRequest",
    "GPSTelemetryRequest",
    "TamperTelemetryRequest",
    "EnrichedTelemetryResponse",
    "DeviceCreateRequest",
    "DeviceUpdateRequest",
    "DeviceResponse",
    "RuleAlert",
    "ChannelConfigRequest",
    "ChannelTestRequest",
    "TripSummaryResponse",
    "TripHaltSchema",
    "TripWaypointSchema",
    "AIPredictiveTemperature",
    "AIGpsIntelligence",
    "AIDriverBehavior",
    "AITamperFusion",
    "AIPredictiveDeviceHealth",
    "GeofenceCenter",
    "GeofenceGeometry",
    "GeofenceRules",
    "GeofenceSchedule",
    "GeofenceCreate",
    "GeofenceUpdate",
    "GeofenceResponse",
    "GeofenceEventResponse"
]
