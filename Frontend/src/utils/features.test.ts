import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildTelemetryCsv } from './csvExport';
import {
  TRANSPORT_THERMAL_STANDARDS,
  evaluateVehicleThermalFlow,
} from './thermalFlow';
import { getVehicleCargoProfile } from './vehicleCargo';
import type { FleetTableRow, TelemetryPoint } from '../shared/types';

function makeFleetRow(overrides: Partial<FleetTableRow>): FleetTableRow {
  return {
    device_id: 'GW-001',
    node_id: 'NODE-001',
    vehicle_name: 'Pharma Reefer',
    cargo_type: 'mRNA Vaccines (2–8°C)',
    current_temp_c: 4.5,
    ambient_temp_c: 30,
    target_min_c: 2.0,
    target_max_c: 8.0,
    lat: 17.4483,
    lng: 78.3915,
    speed_kmh: 44,
    heading_deg: 90,
    network_rssi_dbm: -74,
    connectivity: 'ONLINE',
    operational_state: 'IN_TRANSIT',
    security: 'SEALED',
    tamper: false,
    status: 'OPTIMAL',
    health_score: 96,
    health_rating: 'GOOD',
    predicted_temp_30m_c: 4.6,
    excursion_risk_pct: 8,
    distance_km: 120,
    address: 'HITEC City, Hyderabad',
    geofence_name: null,
    last_seen_ms: Date.now(),
    last_seen_str: 'Just now',
    packet_age_sec: 1,
    seq: 100,
    compressor_active: true,
    history_temps: [4.4, 4.5, 4.5],
    ...overrides,
  };
}

describe('Telemetry CSV Export & Thermal Flowchart Evaluator', () => {
  it('formats telemetry history to RFC-4180 CSV with escaped address fields', () => {
    const sample: TelemetryPoint = {
      seq: 42,
      device_id: 'GW-001',
      node_id: 'NODE-001',
      recorded_at_ms: 1700000000000,
      timestamp: '2026-11-18T12:00:00.000Z',
      cargo_temp_c: 4.35,
      ambient_temp_c: 30.2,
      humidity_pct: 55.1,
      lat: 17.448312,
      lng: 78.391544,
      altitude_m: 542,
      speed_kmh: 48.2,
      heading_deg: 90,
      satellites: 12,
      location_accuracy_m: 2.8,
      network_rssi_dbm: -74,
      lte_csq: 19,
      node_rssi_dbm: -64,
      node_connected: true,
      door_status: 'SEALED',
      tamper: false,
      battery_pct: 94,
      compressor_active: true,
      distance_km: 124.512,
      address: 'HITEC City, Hub',
      sub_area: 'Madhapur, "West" Zone',
      geofence_name: 'Hyderabad Hub',
      geofence_inside: true,
    };

    const csv = buildTelemetryCsv([sample]);
    const lines = csv.split('\r\n');
    assert.equal(lines.length, 2);
    assert.ok(lines[0].startsWith('seq,device_id,node_id,timestamp,cargo_temp_c'));
    assert.ok(lines[1].includes('"HITEC City, Hub"'));
    assert.ok(lines[1].includes('"Madhapur, ""West"" Zone"'));
    assert.ok(lines[1].includes('4.35'));
  });

  it('classifies per-vehicle thermal flowchart stages accurately across Optimal, Warning, Critical, and Offline', () => {
    const optimal = evaluateVehicleThermalFlow(makeFleetRow({ current_temp_c: 4.5 }));
    assert.equal(optimal.stage, 'OPTIMAL');

    const warningHigh = evaluateVehicleThermalFlow(makeFleetRow({ current_temp_c: 7.3 }));
    assert.equal(warningHigh.stage, 'WARNING');

    const warningRisk = evaluateVehicleThermalFlow(
      makeFleetRow({ current_temp_c: 5.8, excursion_risk_pct: 48 })
    );
    assert.equal(warningRisk.stage, 'WARNING');

    const criticalTemp = evaluateVehicleThermalFlow(makeFleetRow({ current_temp_c: 8.6 }));
    assert.equal(criticalTemp.stage, 'CRITICAL');

    const criticalDoor = evaluateVehicleThermalFlow(
      makeFleetRow({ current_temp_c: 4.5, security: 'OPEN', tamper: true })
    );
    assert.equal(criticalDoor.stage, 'CRITICAL');

    const offline = evaluateVehicleThermalFlow(
      makeFleetRow({ connectivity: 'OFFLINE', packet_age_sec: 420 })
    );
    assert.equal(offline.stage, 'OFFLINE');

    assert.ok(TRANSPORT_THERMAL_STANDARDS.length >= 8);
  });

  it('distinguishes vehicle body silhouettes and transported cargo items clearly', () => {
    const semi = getVehicleCargoProfile('Pharma Reefer TS-09-UA-4102', 'mRNA Vaccines (2–8°C)');
    const van = getVehicleCargoProfile('CryoVan TS-07-EC-1904', 'Monoclonal Antibodies');
    const carrier = getVehicleCargoProfile('MedLine Carrier TS-08-FG-3318', 'Plasma Derivatives');
    const box = getVehicleCargoProfile('BioCold Box TS-08-BD-2291', 'Insulin & Biologics');

    assert.equal(semi.bodyType, 'semi-reefer');
    assert.equal(semi.cargoShortLabel, 'mRNA Vaccines');
    assert.equal(van.bodyType, 'sprinter-van');
    assert.equal(van.cargoShortLabel, 'mAb Antibodies');
    assert.equal(carrier.bodyType, 'cryo-carrier');
    assert.equal(carrier.cargoShortLabel, 'Plasma');
    assert.equal(box.bodyType, 'box-truck');
    assert.equal(box.cargoShortLabel, 'Insulin');
    assert.notEqual(semi.accentHex, van.accentHex);
  });
});
