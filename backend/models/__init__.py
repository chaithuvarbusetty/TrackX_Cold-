"""
Domain entity models for database persistence.
Also re-exports Pydantic schemas for seamless backward compatibility.
"""

from .telemetry import TelemetryRecord
from .device import DeviceEntity
from .trip import TripEntity
from .alert import AlertEntity
from .ai_insight import AIInsightEntity

from ..schemas import (
    TelemetryRequest,
    GPSCoordinates,
    TemperatureReading,
    IMUData,
    PowerAndNetwork,
    RawTelemetryPacket,
    TemperatureTelemetryRequest,
    GPSTelemetryRequest,
    TamperTelemetryRequest,
    EnrichedTelemetryResponse,
    DeviceCreateRequest,
    DeviceUpdateRequest,
    DeviceResponse,
    RuleAlert,
    ChannelConfigRequest,
    ChannelTestRequest,
    TripSummaryResponse,
    TripHaltSchema,
    TripWaypointSchema,
    AIPredictiveTemperature,
    AIGpsIntelligence,
    AIDriverBehavior,
    AITamperFusion,
    AIPredictiveDeviceHealth
)

__all__ = [
    "TelemetryRecord",
    "DeviceEntity",
    "TripEntity",
    "AlertEntity",
    "AIInsightEntity",
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
    "AIPredictiveDeviceHealth"
]
