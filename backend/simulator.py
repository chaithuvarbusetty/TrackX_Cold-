"""
==============================================================================
FILE: simulator.py
PURPOSE:
Autonomous IoT Fleet & Anomaly Simulator.

WHY WE NEED A SIMULATOR:
Before mounting physical hardware on refrigerated trucks, we need to test
the software, WebSockets, AI models, and dashboard under realistic road conditions.
This module simulates:
1. Multi-vehicle movement along actual geographic road routes (Hyderabad Logistics Corridors).
2. Dynamic sensor telemetry (GNSS speed/heading, DS18B20 temperatures, IMU 3-axis noise).
3. Interactive fault injection on demand (e.g. door opened -> warming spike,
   enclosure tamper, harsh braking, GPS tunnel outage, and GPS spoofing).
==============================================================================
"""

import asyncio
import random
import math
from datetime import datetime
from typing import Dict, List, Optional
from .models import (
    RawTelemetryPacket,
    GPSCoordinates,
    TemperatureReading,
    IMUData,
    PowerAndNetwork,
    EnrichedTelemetryResponse
)
from .rule_engine import DeterministicRuleEngine
from .ai_engine import AIEngine
from .storage import store
from .database import db_save_telemetry
from .trip_engine import trip_engine

# ============================================================================
# REAL-WORLD ROAD WAYPOINTS (Latitude, Longitude)
# ============================================================================

# Route 1: Pharma Corridor (HITEC City -> Jeedimetla Pharma Zone -> Medchal Cold Storage)
ROUTE_PHARMA_1 = [
    (17.4435, 78.3772),  # HITEC City Hub
    (17.4478, 78.3850),
    (17.4520, 78.3965),
    (17.4610, 78.4120),  # Kukatpally Junction
    (17.4750, 78.4350),  # Balanagar Industrial Area
    (17.4920, 78.4650),  # Jeedimetla Pharma Zone
    (17.5150, 78.4950),  # Medchal Cold Storage
    (17.5400, 78.5200),  # Outer Ring Road
    (17.5150, 78.4950),
    (17.4750, 78.4350),
    (17.4435, 78.3772)
]

# Route 2: Dairy & Frozen Foods (Central Hyderabad -> Uppal Depot -> Ghatkesar)
ROUTE_DAIRY_2 = [
    (17.3850, 78.4867),  # Central Hyderabad
    (17.3980, 78.5120),  # Uppal Depot
    (17.4120, 78.5450),  # Ghatkesar
    (17.3980, 78.5120),
    (17.3850, 78.4867)
]

# Route 3: Seafood Cargo (Old City Base -> Shamshabad -> RGIA Cargo Terminal)
ROUTE_SEAFOOD_3 = [
    (17.3616, 78.4747),  # Old City Cargo Base
    (17.3200, 78.4500),  # Shamshabad Airport Road
    (17.2403, 78.4294),  # RGIA Cargo Terminal
    (17.3200, 78.4500),
    (17.3616, 78.4747)
]


class VehicleSimulationState:
    """
    Maintains the physical kinematics, environmental thermodynamics,
    and sensor state of a single virtual fleet vehicle.
    """

    def __init__(self, device_id: str, name: str, route: List[tuple], base_temp: float, min_temp: float, max_temp: float):
        self.device_id = device_id
        self.name = name
        self.route = route
        self.current_idx = 0
        self.step_progress = 0.0  # 0.0 to 1.0 interpolation between waypoints
        
        # Telemetry State variables
        self.temp = base_temp
        self.base_temp = base_temp
        self.min_temp = min_temp
        self.max_temp = max_temp
        self.ambient_temp = 31.0
        self.tamper_switch_closed = True
        self.gps_fix = "3D_FIX"
        self.satellites = 10
        self.speed = 45.0
        self.heading = 45.0
        self.battery_pct = 92
        self.battery_v = 4.05
        self.external_pwr = True
        self.csq = 26
        self.probe_connected = True
        
        # Fault Injection Flags (Triggered by user in dashboard)
        self.forced_temp_trend = 0.0  # Rate of temperature rise (°C per step)
        self.forced_harsh_event: Optional[str] = None
        self.forced_gps_loss = False
        self.forced_gps_jump = False
        self.offline_buffered_pkts = 0

    def get_current_location(self) -> tuple:
        """Calculates current interpolated GPS coordinate along the road route."""
        if self.forced_gps_jump:
            # Teleport 1000km away to test GPS Spoofing / Teleport Anomaly Filter
            return (28.6139, 77.2090)

        p1 = self.route[self.current_idx]
        p2 = self.route[(self.current_idx + 1) % len(self.route)]
        lat = p1[0] + (p2[0] - p1[0]) * self.step_progress
        lng = p1[1] + (p2[1] - p1[1]) * self.step_progress
        return (lat, lng)

    def advance_step(self):
        """Advances vehicle simulation by one discrete time step."""
        # 1. Progress along road waypoints
        self.step_progress += 0.04
        if self.step_progress >= 1.0:
            self.step_progress = 0.0
            self.current_idx = (self.current_idx + 1) % len(self.route)

        # 2. Update heading angle in degrees (compass direction)
        p1 = self.route[self.current_idx]
        p2 = self.route[(self.current_idx + 1) % len(self.route)]
        dy = p2[0] - p1[0]
        dx = (p2[1] - p1[1]) * math.cos(math.radians(p1[0]))
        self.heading = round((math.degrees(math.atan2(dx, dy)) + 360) % 360, 1)

        # 3. Realistic speed oscillation
        self.speed = max(0.0, round(45.0 + random.uniform(-6.0, 8.0), 1))

        # 4. Temperature Thermodynamics
        if self.forced_temp_trend != 0.0:
            self.temp += self.forced_temp_trend
        else:
            # Normal small thermal oscillation around target baseline
            self.temp += random.uniform(-0.04, 0.04)
            self.temp = self.temp * 0.95 + self.base_temp * 0.05
        
        self.temp = round(self.temp, 2)

        # 5. Battery discharge simulation when unplugged from 12V
        if not self.external_pwr:
            self.battery_pct = max(5, self.battery_pct - 1)
            self.battery_v = round(3.4 + (self.battery_pct / 100.0) * 0.7, 2)
        else:
            self.battery_v = 4.10

    def generate_packet(self) -> RawTelemetryPacket:
        """Constructs a validated RawTelemetryPacket reflecting current sensor states."""
        lat, lng = self.get_current_location()

        fix = "NO_FIX" if self.forced_gps_loss else self.gps_fix
        sats = 0 if self.forced_gps_loss else self.satellites

        # Normal IMU gravity baseline
        ax, ay, az = 0.02, 0.01, 1.0
        gx, gy, gz = 0.0, 0.0, 0.0
        shock = False

        # Apply any active harsh driving simulation
        if self.forced_harsh_event == "HARSH_BRAKE":
            ax = -0.65
            self.speed = max(0.0, self.speed - 25.0)
            self.forced_harsh_event = None
        elif self.forced_harsh_event == "HARSH_ACCELERATION":
            ax = 0.48
            self.forced_harsh_event = None
        elif self.forced_harsh_event == "AGGRESSIVE_CORNER":
            ay = 0.55
            gz = 45.0
            self.forced_harsh_event = None
        elif self.forced_harsh_event == "CRASH_IMPACT":
            ax, ay, az = 2.4, 1.8, 3.5
            shock = True
            self.forced_harsh_event = None
        else:
            # Road vibration noise
            ax += random.uniform(-0.04, 0.04)
            ay += random.uniform(-0.04, 0.04)
            az += random.uniform(-0.08, 0.08)

        packet = RawTelemetryPacket(
            device_id=self.device_id,
            timestamp=datetime.utcnow(),
            gps=GPSCoordinates(
                lat=round(lat, 6),
                lng=round(lng, 6),
                speed_kmh=self.speed,
                heading_deg=self.heading,
                altitude_m=540.0 + random.uniform(-3, 3),
                satellites_count=sats,
                fix_status=fix
            ),
            temperature=TemperatureReading(
                cargo_temp_c=self.temp,
                ambient_temp_c=self.ambient_temp,
                target_min_c=self.min_temp,
                target_max_c=self.max_temp,
                probe_connected=self.probe_connected
            ),
            imu=IMUData(
                accel_x_g=round(ax, 2),
                accel_y_g=round(ay, 2),
                accel_z_g=round(az, 2),
                gyro_x_dps=round(gx, 1),
                gyro_y_dps=round(gy, 1),
                gyro_z_dps=round(gz, 1),
                shock_detected=shock
            ),
            tamper_switch_closed=self.tamper_switch_closed,
            power_network=PowerAndNetwork(
                battery_pct=self.battery_pct,
                battery_voltage_v=self.battery_v,
                external_power_connected=self.external_pwr,
                lte_csq_rssi=self.csq,
                network_rat="4G Cat-1",
                offline_buffered_packets=self.offline_buffered_pkts
            )
        )
        return packet


class FleetSimulatorManager:
    """
    Manages the multi-vehicle simulation event loop and dispatches updates to WebSockets.
    """

    def __init__(self):
        # Instantiate 3 diverse cold-chain fleet vehicles
        self.vehicles: Dict[str, VehicleSimulationState] = {
            "TRX-1001": VehicleSimulationState(
                device_id="TRX-1001",
                name="Vaccine Express (Pharma Cold-Van)",
                route=ROUTE_PHARMA_1,
                base_temp=4.5,
                min_temp=2.0,
                max_temp=8.0
            ),
            "TRX-1002": VehicleSimulationState(
                device_id="TRX-1002",
                name="Dairy & Ice Cream Reefer",
                route=ROUTE_DAIRY_2,
                base_temp=-18.0,
                min_temp=-22.0,
                max_temp=-14.0
            ),
            "TRX-1003": VehicleSimulationState(
                device_id="TRX-1003",
                name="Seafood & Fresh Cargo",
                route=ROUTE_SEAFOOD_3,
                base_temp=3.2,
                min_temp=1.0,
                max_temp=6.0
            )
        }
        self.is_running = False
        self.broadcast_callbacks = []

    def register_callback(self, cb):
        """Registers WebSocket broadcast callback."""
        self.broadcast_callbacks.append(cb)

    async def step_and_broadcast(self):
        """Runs one simulation cycle across all vehicles and evaluates AI & Rules."""
        for device_id, vehicle in self.vehicles.items():
            vehicle.advance_step()
            raw_pkt = vehicle.generate_packet()

            # Process trip segmentation, halts, and waypoints
            try:
                trip_engine.process_telemetry(raw_pkt)
            except Exception:
                pass

            # 1. Evaluate Layer-1 Deterministic Rules
            layer1_alerts = DeterministicRuleEngine.evaluate(raw_pkt)

            # 2. Evaluate Layer-2 AI Intelligence Engine
            ai_intelligence = AIEngine.evaluate(raw_pkt)

            # 3. Assemble Enriched Response
            enriched = EnrichedTelemetryResponse(
                device_id=device_id,
                timestamp=raw_pkt.timestamp,
                raw_telemetry=raw_pkt,
                layer1_deterministic_alerts=layer1_alerts,
                layer2_ai_intelligence=ai_intelligence
            )

            # 4. Save to in-memory store and SQLite database
            store.insert(enriched)
            try:
                db_save_telemetry(enriched.model_dump(mode="json"))
            except Exception:
                pass

            # 5. Broadcast to active web browsers via WebSocket
            for cb in self.broadcast_callbacks:
                try:
                    await cb(enriched.model_dump(mode="json"))
                except Exception:
                    pass

    async def run_loop(self):
        """Continuous background task that steps simulation every 2.5 seconds."""
        self.is_running = True
        while self.is_running:
            await self.step_and_broadcast()
            await asyncio.sleep(2.5)

    def pause(self):
        """Pauses autonomous simulation so only real firmware telemetry is ingested."""
        self.is_running = False

    def resume(self):
        """Resumes autonomous simulation."""
        self.is_running = True

    # ------------------------------------------------------------------------
    # Fault Injection Methods (Invoked from UI buttons)
    # ------------------------------------------------------------------------
    def trigger_door_open_temp_spike(self, device_id: str):
        if device_id in self.vehicles:
            self.vehicles[device_id].forced_temp_trend = 0.25

    def trigger_tamper(self, device_id: str):
        if device_id in self.vehicles:
            self.vehicles[device_id].tamper_switch_closed = False

    def trigger_harsh_event(self, device_id: str, event_type: str):
        if device_id in self.vehicles:
            self.vehicles[device_id].forced_harsh_event = event_type

    def trigger_gps_tunnel_loss(self, device_id: str, enabled: bool = True):
        if device_id in self.vehicles:
            self.vehicles[device_id].forced_gps_loss = enabled

    def trigger_gps_spoof_jump(self, device_id: str, enabled: bool = True):
        if device_id in self.vehicles:
            self.vehicles[device_id].forced_gps_jump = enabled

    def trigger_power_loss(self, device_id: str):
        if device_id in self.vehicles:
            v = self.vehicles[device_id]
            v.external_pwr = False
            v.battery_pct = 14

    def reset_vehicle(self, device_id: str):
        if device_id in self.vehicles:
            v = self.vehicles[device_id]
            v.temp = v.base_temp
            v.forced_temp_trend = 0.0
            v.forced_harsh_event = None
            v.forced_gps_loss = False
            v.forced_gps_jump = False
            v.tamper_switch_closed = True
            v.external_pwr = True
            v.battery_pct = 92
            v.probe_connected = True


# Global singleton simulator instance
simulator = FleetSimulatorManager()
