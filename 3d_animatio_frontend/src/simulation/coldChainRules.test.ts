import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CARGO_PROFILES,
  COLD_CHAIN_ROUTES,
  HYDERABAD_INCIDENTS,
  computeRouteEtaMinutes,
  createInitialFleetState,
  createInitialTelemetryState,
  evaluateTelemetryAlerts,
  formatRssiQuality,
  getTargetSpeedKmh,
  getTemperatureBand,
  interpolatePathPoint,
  slicePathUpToProgress,
  stepRouteProgress,
  stepThermalSimulation,
  triggerDoorAction,
} from './coldChainRules';

test('getTemperatureBand detects below critical threshold accurately', () => {
  assert.equal(getTemperatureBand(1.9, 2.0, 8.0, 0.8), 'below_critical');
  assert.equal(getTemperatureBand(-1.5, 2.0, 8.0, 0.8), 'below_critical');
  assert.equal(getTemperatureBand(2.4, 2.0, 8.0, 0.8), 'near_low');
  assert.equal(getTemperatureBand(4.5, 2.0, 8.0, 0.8), 'optimal');
  assert.equal(getTemperatureBand(7.5, 2.0, 8.0, 0.8), 'near_high');
  assert.equal(getTemperatureBand(8.3, 2.0, 8.0, 0.8), 'above_critical');
});

test('evaluateTelemetryAlerts raises critical alert once when dropping below critical threshold', () => {
  const base = createInitialTelemetryState('biologics_2_8', 1000);
  const frozen = { ...base, temperatureC: 1.1 };

  const eval1 = evaluateTelemetryAlerts(frozen, [], 2000, 1);
  assert.equal(eval1.overallStatus, 'critical');
  assert.equal(eval1.isTempCritical, true);
  assert.deepEqual(eval1.activeConditions, ['temp_below_critical']);
  assert.equal(eval1.newAlerts.length, 1);
  assert.equal(eval1.newAlerts[0].type, 'temp_below_critical');
  assert.equal(eval1.newAlerts[0].severity, 'critical');

  const eval2 = evaluateTelemetryAlerts(frozen, eval1.activeConditions, 3000, 2);
  assert.equal(eval2.overallStatus, 'critical');
  assert.equal(eval2.newAlerts.length, 0);
});

test('door tamper triggers immediate critical notification while transit lock is armed', () => {
  const base = createInitialTelemetryState('biologics_2_8', 1000);
  const tampered = triggerDoorAction(base, 'tamper_open', 2000);

  assert.equal(tampered.doorState, 'tampered_open');
  assert.equal(tampered.transitArmed, true);

  const evalResult = evaluateTelemetryAlerts(tampered, [], 2500, 1);
  assert.equal(evalResult.overallStatus, 'critical');
  assert.equal(evalResult.isDoorTampered, true);
  assert.deepEqual(evalResult.activeConditions, ['door_tamper']);
  assert.equal(evalResult.newAlerts.length, 1);
  assert.equal(evalResult.newAlerts[0].type, 'door_tamper');
  assert.equal(evalResult.newAlerts[0].valueLabel, 'SEAL BROKEN');
});

test('authorized dock opening (disarmed) triggers warning status without tamper alert', () => {
  const base = createInitialTelemetryState('biologics_2_8', 1000);
  const authorized = triggerDoorAction(base, 'authorize_open', 2000);

  const evalResult = evaluateTelemetryAlerts(authorized, [], 2500, 1);
  assert.equal(evalResult.overallStatus, 'warning');
  assert.equal(evalResult.isDoorTampered, false);
  assert.equal(evalResult.newAlerts.length, 0);
});

test('stepThermalSimulation drives temperature below critical threshold during freeze_drop fault', () => {
  let state = createInitialTelemetryState('biologics_2_8', 1000);
  state = { ...state, faultMode: 'freeze_drop' };

  for (let i = 0; i < 6; i++) {
    state = stepThermalSimulation(state, 1.0, 2000 + i * 1000, i);
  }

  assert.ok(
    state.temperatureC < CARGO_PROFILES.biologics_2_8.minCriticalC,
    `Expected temp ${state.temperatureC} < ${CARGO_PROFILES.biologics_2_8.minCriticalC}`
  );
});

test('formatRssiQuality maps signal bands cleanly', () => {
  assert.equal(formatRssiQuality(-58).bars, 4);
  assert.equal(formatRssiQuality(-68).bars, 3);
  assert.equal(formatRssiQuality(-78).bars, 2);
  assert.equal(formatRssiQuality(-90).bars, 1);
});

test('traffic density modulates vehicle speed and freezes progress when parked', () => {
  assert.equal(getTargetSpeedKmh('light', true), 68);
  assert.equal(getTargetSpeedKmh('moderate', true), 46);
  assert.equal(getTargetSpeedKmh('heavy', true), 24);
  assert.equal(getTargetSpeedKmh('light', false), 0);

  const pausedProgress = stepRouteProgress(0.35, 0, 20, 1.0);
  assert.equal(pausedProgress, 0.35);

  const movingProgress = stepRouteProgress(0.35, 60, 20, 1.0);
  assert.ok(movingProgress > 0.35);
});

test('Hyderabad routes, fleet vehicles, and real-time path slicing work accurately', () => {
  const fleet = createInitialFleetState(1000);
  assert.equal(Object.keys(fleet).length, 3);
  assert.equal(fleet.veh_101.routeId, 'hyd_hitec');
  assert.equal(fleet.veh_204.routeId, 'hyd_genome');
  assert.equal(fleet.veh_309.routeId, 'hyd_gachibowli');

  const path = COLD_CHAIN_ROUTES.hyd_hitec.fallbackPath;
  const start = interpolatePathPoint(path, 0);
  const mid = interpolatePathPoint(path, 0.5);
  const end = interpolatePathPoint(path, 1);

  assert.ok(Math.abs(start.position.lat - path[0].lat) < 1e-6);
  assert.ok(Math.abs(end.position.lat - path[path.length - 1].lat) < 1e-6);
  assert.ok(mid.position.lat > path[0].lat && mid.position.lat < path[path.length - 1].lat);

  const traversed = slicePathUpToProgress(path, 0.5);
  assert.ok(traversed.length >= 2);
  assert.ok(Math.abs(traversed[traversed.length - 1].lat - mid.position.lat) < 1e-5);
  assert.ok(Math.abs(traversed[traversed.length - 1].lng - mid.position.lng) < 1e-5);

  assert.ok(HYDERABAD_INCIDENTS.some((i) => i.type === 'accident'));
  assert.ok(HYDERABAD_INCIDENTS.some((i) => i.type === 'police'));
});

test('computeRouteEtaMinutes slows ETA under heavy traffic', () => {
  const lightEta = computeRouteEtaMinutes(0.5, 20, 68, 24);
  const heavyEta = computeRouteEtaMinutes(0.5, 20, 24, 24);
  assert.ok(heavyEta > lightEta);
});
