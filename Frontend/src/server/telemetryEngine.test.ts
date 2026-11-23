import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TelemetryDatabase } from './database';
import { TelemetryEngine } from './telemetryEngine';
import {
  computeThermalForecast,
  filterAndAccumulateDistanceKm,
  haversineMeters,
} from './geo';

describe('ColdChain SQLite Optimization & Physics Engine', () => {
  it('verifies covering index & materialized hot-state EXPLAIN QUERY PLAN eliminate full table scans', () => {
    const db = new TelemetryDatabase(':memory:');

    const unoptFleetPlan = db.getExplainPlan(
      'SELECT * FROM telemetry_logs WHERE +device_id = ? ORDER BY +recorded_at_ms DESC LIMIT 1',
      ['GW-001']
    );
    const optFleetPlan = db.getExplainPlan(
      `SELECT d.device_id, d.vehicle_name, s.cargo_temp_c
       FROM devices d JOIN device_latest_state s ON d.device_id = s.device_id
       ORDER BY d.device_id ASC`
    );

    assert.ok(
      unoptFleetPlan.some((line) => line.includes('SCAN telemetry_logs')),
      `Expected unoptimized query to SCAN telemetry_logs, got: ${unoptFleetPlan.join(' | ')}`
    );
    assert.ok(
      !optFleetPlan.some((line) => line.includes('telemetry_logs')),
      `Expected optimized fleet overview to avoid telemetry_logs entirely`
    );

    const optHistPlan = db.getExplainPlan(
      `SELECT recorded_at_ms, cargo_temp_c, speed_kmh, lat, lng
       FROM telemetry_logs
       WHERE device_id = ?
       ORDER BY recorded_at_ms DESC
       LIMIT 60`,
      ['GW-001']
    );
    assert.ok(
      optHistPlan.some((line) => line.includes('COVERING INDEX idx_telem_dev_ts_cov')),
      `Expected history query to use COVERING INDEX idx_telem_dev_ts_cov, got: ${optHistPlan.join(' | ')}`
    );

    const benchmarks = db.runLiveBenchmark();
    assert.equal(benchmarks.length, 3);
    for (const metric of benchmarks) {
      assert.ok(
        metric.optimized_ms <= metric.unoptimized_ms,
        `Expected ${metric.name} optimized (${metric.optimized_ms}ms) <= unoptimized (${metric.unoptimized_ms}ms)`
      );
      assert.ok(metric.rows_scanned_after < metric.rows_scanned_before);
    }
  });

  it('keeps materialized device_latest_state synchronized on telemetry tick & fault injection', () => {
    const db = new TelemetryDatabase(':memory:');
    const engine = new TelemetryEngine(db);

    const beforeOverview = db.getFleetOverview();
    const beforeGw1 = beforeOverview.fleet_table.find((r) => r.device_id === 'GW-001');
    assert.ok(beforeGw1);

    const tick = engine.stepTick('GW-001');
    assert.equal(tick.type, 'TELEMETRY_TICK');
    assert.ok(tick.tick?.selected_packet);
    assert.equal(tick.tick?.selected_packet?.device_id, 'GW-001');
    assert.equal(tick.tick?.selected_packet?.seq, beforeGw1.seq + 1);

    const faultRes = engine.performSimulationAction('GW-001', 'DOOR_BREACH');
    assert.ok(faultRes.alert);
    assert.equal(faultRes.alert?.alert_type, 'Door Breach');

    const afterGw1 = faultRes.overview.fleet_table.find((r) => r.device_id === 'GW-001');
    assert.equal(afterGw1?.security, 'OPEN');
    assert.equal(afterGw1?.tamper, true);
    assert.equal(afterGw1?.status, 'EXCURSION');

    const restored = engine.performSimulationAction('GW-001', 'RESTORE_NORMAL');
    const restoredGw1 = restored.overview.fleet_table.find((r) => r.device_id === 'GW-001');
    assert.equal(restoredGw1?.security, 'SEALED');
    assert.equal(restoredGw1?.tamper, false);
  });

  it('applies 100m GPS jitter noise filter to prevent stationary odometer inflation', () => {
    const baseLat = 17.4483;
    const baseLng = 78.3915;

    // ~25m drift should be ignored
    const smallDrift = filterAndAccumulateDistanceKm(
      baseLat,
      baseLng,
      baseLat + 0.0002,
      baseLng + 0.0001,
      12.5
    );
    assert.equal(smallDrift.acceptedAnchor, false);
    assert.equal(smallDrift.distanceKm, 12.5);

    // ~450m real displacement should accumulate
    const realMove = filterAndAccumulateDistanceKm(
      baseLat,
      baseLng,
      baseLat + 0.004,
      baseLng,
      12.5
    );
    assert.equal(realMove.acceptedAnchor, true);
    assert.ok(realMove.distanceKm > 12.8 && realMove.distanceKm < 13.1);
    assert.ok(haversineMeters(baseLat, baseLng, baseLat + 0.004, baseLng) > 400);
  });

  it('requires >= 3 thermal packets before producing AI temperature forecast', () => {
    const t0 = Date.now() - 180_000;
    const coldStart = computeThermalForecast(
      [
        { recorded_at_ms: t0, cargo_temp_c: 4.1 },
        { recorded_at_ms: t0 + 60_000, cargo_temp_c: 4.3 },
      ],
      2,
      8
    );
    assert.equal(coldStart.baseline_ready, false);
    assert.equal(coldStart.predicted_30m_c, null);

    const warming = computeThermalForecast(
      [
        { recorded_at_ms: t0, cargo_temp_c: 5.5 },
        { recorded_at_ms: t0 + 60_000, cargo_temp_c: 6.1 },
        { recorded_at_ms: t0 + 120_000, cargo_temp_c: 6.8 },
        { recorded_at_ms: t0 + 180_000, cargo_temp_c: 7.4 },
      ],
      2,
      8
    );
    assert.equal(warming.baseline_ready, true);
    assert.ok((warming.predicted_30m_c ?? 0) > 8.0);
    assert.equal(warming.risk_level, 'HIGH');
  });
});
