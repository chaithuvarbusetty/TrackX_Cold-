"""
Pydantic Schemas for Telemetry Ingestion and Responses.
Accurately mirrors physical Quectel EC200U 4G Gateway and NODE-001 sensor packets.
"""

from typing import Optional, Dict, Any, Literal, List
from pydantic import BaseModel, Field
from datetime import datetime, timezone


class TelemetryRequest(BaseModel):
    """
    Direct representation of the JSON packet transmitted by the Quectel EC200U Gateway.
    """
    gateway_id: str = Field(..., description="Unique Gateway Hardware ID (e.g. 'GW-001')")
    node_id: Optional[str] = Field("NODE-001", description="Wireless sensor probe ID")
    temperature: Optional[float] = Field(None, description="Cargo temperature in Celsius (°C)")
    latitude: Optional[float] = Field(None, description="GNSS Latitude")
    longitude: Optional[float] = Field(None, description="GNSS Longitude")
    altitude: Optional[float] = Field(None, description="Altitude in meters")
    location_accuracy: Optional[float] = Field(None, description="Horizontal accuracy (HDOP in meters)")
    location_source: Optional[str] = Field("NONE", description="'GNSS', 'CELL_TOWER', or 'NONE'")
    network_rssi: Optional[int] = Field(None, description="Cellular signal in dBm (e.g. -73)")
    node_rssi: Optional[int] = Field(None, description="Sensor node wireless signal in dBm")
    node_connected: bool = Field(False, description="True if sensor node is currently paired")
    door_status: Optional[str] = Field("UNKNOWN", description="'SEALED', 'OPEN', or 'UNKNOWN'")
    tamper: bool = Field(False, description="True if enclosure microswitch is tripped")
    gateway_imei: Optional[str] = Field(None, description="15-digit Cellular Module IMEI")
    gateway_imsi: Optional[str] = Field(None, description="SIM Card IMSI")
    timestamp: Optional[Any] = Field(None, description="Timestamp of transmission")


class GPSCoordinates(BaseModel):
    lat: Optional[float] = Field(None, description="Latitude in decimal degrees")
    lng: Optional[float] = Field(None, description="Longitude in decimal degrees")
    speed_kmh: Optional[float] = Field(None, description="Vehicle ground speed (km/h)")
    heading_deg: Optional[float] = Field(None, description="Bearing (0 to 360 degrees)")
    altitude_m: Optional[float] = Field(None, description="Altitude in meters")
    satellites_count: Optional[int] = Field(None, description="Satellites in view")
    fix_status: Literal["NO_FIX", "2D_FIX", "3D_FIX", "DGPS_FIX"] = "NO_FIX"


class TemperatureReading(BaseModel):
    cargo_temp_c: Optional[float] = Field(None, description="Cargo compartment temperature (°C)")
    ambient_temp_c: Optional[float] = Field(None, description="Ambient temperature (°C)")
    target_min_c: Optional[float] = Field(None, description="Lower cold chain threshold (°C)")
    target_max_c: Optional[float] = Field(None, description="Upper cold chain threshold (°C)")
    probe_connected: bool = Field(True, description="Hardware integrity check")


class IMUData(BaseModel):
    available: bool = Field(False, description="Hardware availability flag")
    accel_x_g: Optional[float] = Field(None, description="Longitudinal acceleration (g)")
    accel_y_g: Optional[float] = Field(None, description="Lateral acceleration (g)")
    accel_z_g: Optional[float] = Field(None, description="Vertical acceleration (g)")
    gyro_x_dps: Optional[float] = Field(None, description="Roll rate (deg/s)")
    gyro_y_dps: Optional[float] = Field(None, description="Pitch rate (deg/s)")
    gyro_z_dps: Optional[float] = Field(None, description="Yaw rate (deg/s)")
    shock_detected: bool = Field(False, description="Hardware shock interrupt")


class PowerAndNetwork(BaseModel):
    battery_pct: Optional[int] = Field(None, ge=0, le=100)
    battery_voltage_v: Optional[float] = Field(None)
    external_power_connected: Optional[bool] = Field(None)
    lte_csq_rssi: Optional[int] = Field(None, ge=0, le=31)
    network_rat: str = Field("4G Cat-1 (EC200U)")
    offline_buffered_packets: int = Field(0)


class RawTelemetryPacket(BaseModel):
    device_id: str = Field(..., description="Unique hardware identifier (e.g. GW-001)")
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    gps: GPSCoordinates = Field(default_factory=GPSCoordinates)
    temperature: TemperatureReading
    imu: IMUData = Field(default_factory=IMUData)
    tamper_switch_closed: bool = Field(True)
    power_network: Optional[PowerAndNetwork] = None


class TemperatureTelemetryRequest(BaseModel):
    device_id: str
    cargo_temp_c: Optional[float] = None
    temp_c: Optional[float] = None
    ambient_temp_c: Optional[float] = 28.5
    probe_connected: Optional[bool] = True

    def get_temperature(self) -> float:
        if self.cargo_temp_c is not None:
            return self.cargo_temp_c
        if self.temp_c is not None:
            return self.temp_c
        return 4.0


class GPSTelemetryRequest(BaseModel):
    device_id: str
    lat: float
    lng: float
    speed_kmh: Optional[float] = None
    heading_deg: Optional[float] = None
    altitude_m: Optional[float] = 500.0
    satellites_count: Optional[int] = 8
    fix_status: Optional[str] = "3D_FIX"


class TamperTelemetryRequest(BaseModel):
    device_id: str
    door_closed: Optional[bool] = None
    tamper_switch_closed: Optional[bool] = None

    def is_closed(self) -> bool:
        if self.door_closed is not None:
            return self.door_closed
        if self.tamper_switch_closed is not None:
            return self.tamper_switch_closed
        return True


class EnrichedTelemetryResponse(BaseModel):
    device_id: str
    timestamp: datetime
    raw_telemetry: RawTelemetryPacket
    layer1_deterministic_alerts: List[Any]
    layer2_ai_intelligence: Dict[str, Any]
