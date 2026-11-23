import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import fs from 'node:fs';
import {
  HYDERABAD_CORRIDORS,
  computeThermalForecast,
  interpolateCorridorPosition,
} from './geo';
import type {
  AlertItem,
  AlertSeverity,
  AlertStatus,
  DbDiagnosticsPayload,
  DeviceRecord,
  FleetOverviewPayload,
  FleetTableRow,
  GeofenceRecord,
  QueryOptimizationMetric,
  TelemetryPoint,
  TempTrendPoint,
  TripDetails,
  TripHalt,
  TripSummary,
  TripWaypoint,
} from '../shared/types';

export class TelemetryDatabase {
  public readonly db: DatabaseSync;
  private stmts: Record<string, StatementSync> = {};
  private lastBenchmarks: QueryOptimizationMetric[] = [];
  private lastBenchmarkedAt: string = new Date().toISOString();
  private recentQueryLatenciesMs: number[] = [];
  private totalTelemetryRows = 0;

  constructor(dbPath?: string) {
    const resolvedPath =
      dbPath ?? path.resolve(process.cwd(), 'data', 'coldchain.sqlite');
    if (resolvedPath !== ':memory:') {
      fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
    }
    this.db = new DatabaseSync(resolvedPath);
    this.configurePragmas();
    this.createSchema();
    this.prepareStatements();
    this.seedIfEmpty();
    this.totalTelemetryRows = (
      this.db.prepare('SELECT COUNT(*) AS cnt FROM telemetry_logs').get() as {
        cnt: number;
      }
    ).cnt;
    this.lastBenchmarks = this.runLiveBenchmark();
  }

  private configurePragmas() {
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA cache_size = -64000;
      PRAGMA temp_store = MEMORY;
      PRAGMA foreign_keys = ON;
    `);
  }

  private createSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS devices (
        device_id TEXT PRIMARY KEY,
        node_id TEXT NOT NULL,
        imei TEXT NOT NULL,
        imsi TEXT NOT NULL,
        vehicle_name TEXT NOT NULL,
        cargo_type TEXT NOT NULL,
        target_min_c REAL NOT NULL DEFAULT 2.0,
        target_max_c REAL NOT NULL DEFAULT 8.0,
        sampling_interval_sec INTEGER NOT NULL DEFAULT 2,
        route_id INTEGER NOT NULL DEFAULT 0,
        created_at_ms INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS telemetry_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        seq INTEGER NOT NULL,
        device_id TEXT NOT NULL,
        node_id TEXT NOT NULL,
        recorded_at_ms INTEGER NOT NULL,
        cargo_temp_c REAL NOT NULL,
        ambient_temp_c REAL NOT NULL,
        humidity_pct REAL NOT NULL,
        lat REAL NOT NULL,
        lng REAL NOT NULL,
        altitude_m REAL NOT NULL,
        speed_kmh REAL NOT NULL,
        heading_deg INTEGER NOT NULL,
        satellites INTEGER NOT NULL,
        location_accuracy_m REAL NOT NULL,
        network_rssi_dbm INTEGER NOT NULL,
        lte_csq INTEGER NOT NULL,
        node_rssi_dbm INTEGER NOT NULL,
        node_connected INTEGER NOT NULL,
        door_status TEXT NOT NULL,
        tamper INTEGER NOT NULL,
        battery_pct REAL NOT NULL,
        compressor_active INTEGER NOT NULL,
        distance_km REAL NOT NULL,
        address TEXT NOT NULL,
        sub_area TEXT NOT NULL,
        geofence_name TEXT,
        geofence_inside INTEGER NOT NULL DEFAULT 0
      );

      -- Covering composite index for per-device time-series history & forecasts
      CREATE INDEX IF NOT EXISTS idx_telem_dev_ts_cov
        ON telemetry_logs (device_id, recorded_at_ms DESC, cargo_temp_c, speed_kmh, lat, lng);

      -- Time-range index for retention & diagnostic scans
      CREATE INDEX IF NOT EXISTS idx_telem_ts
        ON telemetry_logs (recorded_at_ms DESC);

      -- Materialized hot-state table: eliminates N+1 latest-row scans on fleet overview
      CREATE TABLE IF NOT EXISTS device_latest_state (
        device_id TEXT PRIMARY KEY,
        seq INTEGER NOT NULL,
        recorded_at_ms INTEGER NOT NULL,
        cargo_temp_c REAL NOT NULL,
        ambient_temp_c REAL NOT NULL,
        humidity_pct REAL NOT NULL,
        lat REAL NOT NULL,
        lng REAL NOT NULL,
        altitude_m REAL NOT NULL,
        speed_kmh REAL NOT NULL,
        heading_deg INTEGER NOT NULL,
        satellites INTEGER NOT NULL,
        location_accuracy_m REAL NOT NULL,
        network_rssi_dbm INTEGER NOT NULL,
        lte_csq INTEGER NOT NULL,
        node_rssi_dbm INTEGER NOT NULL,
        node_connected INTEGER NOT NULL,
        door_status TEXT NOT NULL,
        tamper INTEGER NOT NULL,
        battery_pct REAL NOT NULL,
        compressor_active INTEGER NOT NULL,
        distance_km REAL NOT NULL,
        address TEXT NOT NULL,
        sub_area TEXT NOT NULL,
        geofence_name TEXT,
        geofence_inside INTEGER NOT NULL DEFAULT 0,
        predicted_temp_30m_c REAL,
        excursion_risk_pct REAL NOT NULL DEFAULT 0,
        health_score REAL NOT NULL DEFAULT 96,
        history_temps_json TEXT NOT NULL DEFAULT '[]'
      );

      -- Pre-aggregated 24-hour bucket rollup table (avoids scanning 12k+ rows per dashboard paint)
      CREATE TABLE IF NOT EXISTS temp_rollups_hourly (
        bucket_epoch_hr INTEGER PRIMARY KEY,
        label TEXT NOT NULL,
        sum_temp REAL NOT NULL,
        min_temp REAL NOT NULL,
        max_temp REAL NOT NULL,
        readings_count INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS trips (
        trip_id TEXT PRIMARY KEY,
        device_id TEXT NOT NULL,
        origin TEXT NOT NULL,
        destination TEXT NOT NULL,
        start_time TEXT NOT NULL,
        end_time TEXT,
        duration_minutes INTEGER NOT NULL,
        total_distance_km REAL NOT NULL,
        avg_speed_kmh REAL NOT NULL,
        max_speed_kmh REAL NOT NULL,
        min_temp_c REAL NOT NULL,
        max_temp_c REAL NOT NULL,
        mkt_temp_c REAL NOT NULL,
        halt_count INTEGER NOT NULL,
        excursion_flag INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_trips_device_start
        ON trips (device_id, start_time DESC);

      CREATE TABLE IF NOT EXISTS trip_waypoints (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        trip_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        lat REAL NOT NULL,
        lng REAL NOT NULL,
        speed_kmh REAL NOT NULL,
        heading_deg INTEGER NOT NULL,
        cargo_temp_c REAL NOT NULL,
        timestamp TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_trip_wp_trip_seq
        ON trip_waypoints (trip_id, seq ASC);

      CREATE TABLE IF NOT EXISTS trip_halts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        trip_id TEXT NOT NULL,
        lat REAL NOT NULL,
        lng REAL NOT NULL,
        duration_minutes INTEGER NOT NULL,
        start_time TEXT NOT NULL,
        end_time TEXT NOT NULL,
        start_temp_c REAL NOT NULL,
        end_temp_c REAL NOT NULL,
        location_name TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_trip_halts_trip
        ON trip_halts (trip_id);

      CREATE TABLE IF NOT EXISTS geofences (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        device_id TEXT NOT NULL,
        geometry_json TEXT NOT NULL,
        rules_json TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at_ms INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS alerts (
        alert_id TEXT PRIMARY KEY,
        device_id TEXT NOT NULL,
        alert_type TEXT NOT NULL,
        message TEXT NOT NULL,
        severity TEXT NOT NULL,
        ai_analysis TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'Active',
        created_at_ms INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_alerts_status_ts
        ON alerts (status, created_at_ms DESC);

      CREATE INDEX IF NOT EXISTS idx_alerts_device_ts
        ON alerts (device_id, created_at_ms DESC);
    `);
  }

  private prepareStatements() {
    this.stmts.insertTelemetry = this.db.prepare(`
      INSERT INTO telemetry_logs (
        seq, device_id, node_id, recorded_at_ms, cargo_temp_c, ambient_temp_c,
        humidity_pct, lat, lng, altitude_m, speed_kmh, heading_deg, satellites,
        location_accuracy_m, network_rssi_dbm, lte_csq, node_rssi_dbm,
        node_connected, door_status, tamper, battery_pct, compressor_active,
        distance_km, address, sub_area, geofence_name, geofence_inside
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.stmts.upsertLatestState = this.db.prepare(`
      INSERT INTO device_latest_state (
        device_id, seq, recorded_at_ms, cargo_temp_c, ambient_temp_c, humidity_pct,
        lat, lng, altitude_m, speed_kmh, heading_deg, satellites, location_accuracy_m,
        network_rssi_dbm, lte_csq, node_rssi_dbm, node_connected, door_status, tamper,
        battery_pct, compressor_active, distance_km, address, sub_area,
        geofence_name, geofence_inside, predicted_temp_30m_c, excursion_risk_pct,
        health_score, history_temps_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(device_id) DO UPDATE SET
        seq = excluded.seq,
        recorded_at_ms = excluded.recorded_at_ms,
        cargo_temp_c = excluded.cargo_temp_c,
        ambient_temp_c = excluded.ambient_temp_c,
        humidity_pct = excluded.humidity_pct,
        lat = excluded.lat,
        lng = excluded.lng,
        altitude_m = excluded.altitude_m,
        speed_kmh = excluded.speed_kmh,
        heading_deg = excluded.heading_deg,
        satellites = excluded.satellites,
        location_accuracy_m = excluded.location_accuracy_m,
        network_rssi_dbm = excluded.network_rssi_dbm,
        lte_csq = excluded.lte_csq,
        node_rssi_dbm = excluded.node_rssi_dbm,
        node_connected = excluded.node_connected,
        door_status = excluded.door_status,
        tamper = excluded.tamper,
        battery_pct = excluded.battery_pct,
        compressor_active = excluded.compressor_active,
        distance_km = excluded.distance_km,
        address = excluded.address,
        sub_area = excluded.sub_area,
        geofence_name = excluded.geofence_name,
        geofence_inside = excluded.geofence_inside,
        predicted_temp_30m_c = excluded.predicted_temp_30m_c,
        excursion_risk_pct = excluded.excursion_risk_pct,
        health_score = excluded.health_score,
        history_temps_json = excluded.history_temps_json
    `);

    this.stmts.upsertHourlyRollup = this.db.prepare(`
      INSERT INTO temp_rollups_hourly (bucket_epoch_hr, label, sum_temp, min_temp, max_temp, readings_count)
      VALUES (?, ?, ?, ?, ?, 1)
      ON CONFLICT(bucket_epoch_hr) DO UPDATE SET
        sum_temp = temp_rollups_hourly.sum_temp + excluded.sum_temp,
        min_temp = MIN(temp_rollups_hourly.min_temp, excluded.min_temp),
        max_temp = MAX(temp_rollups_hourly.max_temp, excluded.max_temp),
        readings_count = temp_rollups_hourly.readings_count + 1
    `);

    this.stmts.getOverviewFleet = this.db.prepare(`
      SELECT
        d.device_id, d.node_id, d.vehicle_name, d.cargo_type, d.target_min_c, d.target_max_c,
        s.seq, s.recorded_at_ms, s.cargo_temp_c, s.ambient_temp_c, s.lat, s.lng,
        s.speed_kmh, s.heading_deg, s.network_rssi_dbm, s.door_status, s.tamper,
        s.compressor_active, s.distance_km, s.address, s.geofence_name,
        s.predicted_temp_30m_c, s.excursion_risk_pct, s.health_score, s.history_temps_json
      FROM devices d
      JOIN device_latest_state s ON d.device_id = s.device_id
      ORDER BY d.device_id ASC
    `);

    this.stmts.getDeviceHistory = this.db.prepare(`
      SELECT
        seq, device_id, node_id, recorded_at_ms, cargo_temp_c, ambient_temp_c, humidity_pct,
        lat, lng, altitude_m, speed_kmh, heading_deg, satellites, location_accuracy_m,
        network_rssi_dbm, lte_csq, node_rssi_dbm, node_connected, door_status, tamper,
        battery_pct, compressor_active, distance_km, address, sub_area, geofence_name, geofence_inside
      FROM telemetry_logs
      WHERE device_id = ?
      ORDER BY recorded_at_ms DESC
      LIMIT ?
    `);

    this.stmts.getRecentThermalSamples = this.db.prepare(`
      SELECT recorded_at_ms, cargo_temp_c
      FROM telemetry_logs
      WHERE device_id = ?
      ORDER BY recorded_at_ms DESC
      LIMIT 12
    `);

    this.stmts.getRollups24h = this.db.prepare(`
      SELECT bucket_epoch_hr, label, sum_temp, min_temp, max_temp, readings_count
      FROM temp_rollups_hourly
      ORDER BY bucket_epoch_hr DESC
      LIMIT 24
    `);

    this.stmts.getAlertsCount = this.db.prepare(`
      SELECT
        SUM(CASE WHEN status = 'Active' THEN 1 ELSE 0 END) AS active_count,
        SUM(CASE WHEN status = 'Active' AND severity = 'CRITICAL' THEN 1 ELSE 0 END) AS critical_count
      FROM alerts
    `);

    this.stmts.getRecentAlerts = this.db.prepare(`
      SELECT alert_id, device_id, alert_type, message, severity, ai_analysis, status, created_at_ms
      FROM alerts
      ORDER BY created_at_ms DESC
      LIMIT ?
    `);

    this.stmts.getTripsSummary = this.db.prepare(`
      SELECT * FROM trips ORDER BY start_time DESC LIMIT ?
    `);

    this.stmts.insertAlert = this.db.prepare(`
      INSERT OR IGNORE INTO alerts (
        alert_id, device_id, alert_type, message, severity, ai_analysis, status, created_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.stmts.updateAlertStatus = this.db.prepare(`
      UPDATE alerts SET status = ? WHERE alert_id = ?
    `);
  }

  private seedIfEmpty() {
    const countRow = this.db
      .prepare('SELECT COUNT(*) AS cnt FROM devices')
      .get() as { cnt: number };
    if (countRow.cnt > 0) return;

    const nowMs = Date.now();

    const seedDevices: Array<{
      device_id: string;
      node_id: string;
      imei: string;
      imsi: string;
      vehicle_name: string;
      cargo_type: string;
      target_min_c: number;
      target_max_c: number;
      route_id: number;
      base_temp: number;
      stopped?: boolean;
      offline?: boolean;
      warning?: boolean;
    }> = [
      {
        device_id: 'GW-001',
        node_id: 'NODE-001',
        imei: '860738070471994',
        imsi: '404493400059511',
        vehicle_name: 'Pharma Reefer TS-09-UA-4102',
        cargo_type: 'mRNA Vaccines (2–8°C)',
        target_min_c: 2.0,
        target_max_c: 8.0,
        route_id: 0,
        base_temp: 4.3,
      },
      {
        device_id: 'GW-002',
        node_id: 'NODE-002',
        imei: '860738070472108',
        imsi: '404493400059512',
        vehicle_name: 'BioCold Express TS-09-UB-8831',
        cargo_type: 'Insulin & Biologics',
        target_min_c: 2.0,
        target_max_c: 8.0,
        route_id: 1,
        base_temp: 5.1,
      },
      {
        device_id: 'GW-003',
        node_id: 'NODE-003',
        imei: '860738070472245',
        imsi: '404493400059513',
        vehicle_name: 'CryoVan TS-07-EC-1904',
        cargo_type: 'Monoclonal Antibodies',
        target_min_c: 2.0,
        target_max_c: 8.0,
        route_id: 2,
        base_temp: 7.4,
        warning: true,
      },
      {
        device_id: 'GW-004',
        node_id: 'NODE-004',
        imei: '860738070472399',
        imsi: '404493400059514',
        vehicle_name: 'MedLine Carrier TS-08-FA-7720',
        cargo_type: 'Plasma Derivatives',
        target_min_c: 2.0,
        target_max_c: 8.0,
        route_id: 0,
        base_temp: 3.8,
      },
      {
        device_id: 'GW-005',
        node_id: 'NODE-005',
        imei: '860738070472512',
        imsi: '404493400059515',
        vehicle_name: 'ColdHaul Heavy TS-09-UC-3319',
        cargo_type: 'Diagnostic Reagents',
        target_min_c: 2.0,
        target_max_c: 8.0,
        route_id: 1,
        base_temp: 4.9,
        stopped: true,
      },
      {
        device_id: 'GW-006',
        node_id: 'NODE-006',
        imei: '860738070472688',
        imsi: '404493400059516',
        vehicle_name: 'VaxFleet Unit TS-10-AB-6140',
        cargo_type: 'Pediatric Vaccines',
        target_min_c: 2.0,
        target_max_c: 8.0,
        route_id: 2,
        base_temp: 4.1,
      },
      {
        device_id: 'GW-007',
        node_id: 'NODE-007',
        imei: '860738070472741',
        imsi: '404493400059517',
        vehicle_name: 'BioCargo Sprinter TS-09-UD-9022',
        cargo_type: 'Oncology Infusions',
        target_min_c: 2.0,
        target_max_c: 8.0,
        route_id: 0,
        base_temp: 5.6,
        stopped: true,
      },
      {
        device_id: 'GW-008',
        node_id: 'NODE-008',
        imei: '860738070472890',
        imsi: '404493400059518',
        vehicle_name: 'Reserve Reefer TS-07-GH-2041',
        cargo_type: 'Clinical Trial Samples',
        target_min_c: 2.0,
        target_max_c: 8.0,
        route_id: 1,
        base_temp: 6.2,
        offline: true,
      },
    ];

    const insertDev = this.db.prepare(`
      INSERT INTO devices (
        device_id, node_id, imei, imsi, vehicle_name, cargo_type,
        target_min_c, target_max_c, sampling_interval_sec, route_id, created_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertTrip = this.db.prepare(`
      INSERT INTO trips (
        trip_id, device_id, origin, destination, start_time, end_time,
        duration_minutes, total_distance_km, avg_speed_kmh, max_speed_kmh,
        min_temp_c, max_temp_c, mkt_temp_c, halt_count, excursion_flag, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertWp = this.db.prepare(`
      INSERT INTO trip_waypoints (
        trip_id, seq, lat, lng, speed_kmh, heading_deg, cargo_temp_c, timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertHalt = this.db.prepare(`
      INSERT INTO trip_halts (
        trip_id, lat, lng, duration_minutes, start_time, end_time,
        start_temp_c, end_temp_c, location_name
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertGeo = this.db.prepare(`
      INSERT INTO geofences (name, device_id, geometry_json, rules_json, enabled, created_at_ms)
      VALUES (?, ?, ?, ?, 1, ?)
    `);

    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const dev of seedDevices) {
        insertDev.run(
          dev.device_id,
          dev.node_id,
          dev.imei,
          dev.imsi,
          dev.vehicle_name,
          dev.cargo_type,
          dev.target_min_c,
          dev.target_max_c,
          2,
          dev.route_id,
          nowMs - 86_400_000
        );
      }

      // Seed 24h high-volume telemetry: 1,500 points per device = 12,000 rows
      // Gives real scale for SQLite index vs full-scan latency demonstrations.
      const pointsPerDevice = 1500;
      const stepMs = Math.floor((24 * 3600 * 1000) / pointsPerDevice);
      const hourlyBuckets = new Map<
        number,
        { label: string; sum: number; min: number; max: number; count: number }
      >();

      for (let dIdx = 0; dIdx < seedDevices.length; dIdx++) {
        const dev = seedDevices[dIdx];
        const corridor = HYDERABAD_CORRIDORS[dev.route_id];
        let cumDist = 18.4 + dIdx * 7.2;
        const recentTemps: number[] = [];

        for (let i = 0; i < pointsPerDevice; i++) {
          const offsetFromEnd = pointsPerDevice - 1 - i;
          // Make GW-008 offline (last packet 14 min ago)
          const extraAgeMs = dev.offline ? 14 * 60 * 1000 : 0;
          const tsMs = nowMs - offsetFromEnd * stepMs - extraAgeMs;

          const progress = ((i * 0.012 + dIdx * 0.27) % 2);
          const pos = interpolateCorridorPosition(corridor, progress);

          const cycleWave = Math.sin(i * 0.14 + dIdx) * 0.65;
          const trendBias = dev.warning ? 0.55 * Math.sin(i * 0.05) + 0.45 : 0;
          const cargoTemp = Number((dev.base_temp + cycleWave + trendBias).toFixed(2));
          const ambientTemp = Number((29.5 + Math.sin(i * 0.02) * 3.8).toFixed(1));
          const speed = dev.stopped && i > pointsPerDevice - 20
            ? 0
            : Number(Math.max(0, pos.targetSpeedKmh + Math.cos(i * 0.2) * 4.2).toFixed(1));

          if (speed > 2) {
            cumDist = Number((cumDist + (speed * (stepMs / 3600000)) * 0.35).toFixed(2));
          }

          const rssi = -72 - ((i + dIdx * 3) % 19);
          const csq = Math.max(8, Math.min(31, Math.round((rssi + 113) / 2)));

          this.stmts.insertTelemetry.run(
            i + 1,
            dev.device_id,
            dev.node_id,
            tsMs,
            cargoTemp,
            ambientTemp,
            52 + ((i + dIdx) % 12),
            pos.lat,
            pos.lng,
            542,
            speed,
            pos.headingDeg,
            11 + (i % 4),
            3.2,
            rssi,
            csq,
            -64 - (i % 10),
            1,
            'SEALED',
            0,
            Math.max(76, 98 - (i % 18)),
            cargoTemp > 4.6 ? 1 : 0,
            cumDist,
            pos.area,
            pos.subArea,
            i % 120 < 15 ? 'Hyderabad Cold Hub' : null,
            i % 120 < 15 ? 1 : 0
          );

          const hrBucket = Math.floor(tsMs / 3600000);
          const dt = new Date(hrBucket * 3600000);
          const label = `${String(dt.getHours()).padStart(2, '0')}:00`;
          const b = hourlyBuckets.get(hrBucket) ?? {
            label,
            sum: 0,
            min: cargoTemp,
            max: cargoTemp,
            count: 0,
          };
          b.sum += cargoTemp;
          b.min = Math.min(b.min, cargoTemp);
          b.max = Math.max(b.max, cargoTemp);
          b.count += 1;
          hourlyBuckets.set(hrBucket, b);

          if (i >= pointsPerDevice - 12) {
            recentTemps.push(cargoTemp);
          }

          if (i === pointsPerDevice - 1) {
            const forecast = computeThermalForecast(
              recentTemps.map((t, idx) => ({
                recorded_at_ms: tsMs - (recentTemps.length - 1 - idx) * stepMs,
                cargo_temp_c: t,
              })),
              dev.target_min_c,
              dev.target_max_c
            );
            const healthScore = dev.offline ? 48 : dev.warning ? 74 : 96 - (dIdx % 4);

            this.stmts.upsertLatestState.run(
              dev.device_id,
              i + 1,
              tsMs,
              cargoTemp,
              ambientTemp,
              54,
              pos.lat,
              pos.lng,
              542,
              speed,
              pos.headingDeg,
              12,
              3.1,
              rssi,
              csq,
              -66,
              1,
              'SEALED',
              0,
              92,
              cargoTemp > 4.6 ? 1 : 0,
              cumDist,
              pos.area,
              pos.subArea,
              'Hyderabad Pharma Hub',
              0,
              forecast.predicted_30m_c,
              forecast.excursion_risk_pct,
              healthScore,
              JSON.stringify(recentTemps)
            );
          }
        }
      }

      const insertRollupExact = this.db.prepare(`
        INSERT OR REPLACE INTO temp_rollups_hourly (
          bucket_epoch_hr, label, sum_temp, min_temp, max_temp, readings_count
        ) VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (const [hr, b] of hourlyBuckets.entries()) {
        insertRollupExact.run(hr, b.label, b.sum, b.min, b.max, b.count);
      }

      // Seed Geofences
      insertGeo.run(
        'HITEC City Pharma Hub',
        'ALL',
        JSON.stringify({ type: 'CIRCLE', center: { lat: 17.4483, lng: 78.3915 }, radius_m: 800 }),
        JSON.stringify({ enter: true, exit: true, dwell: true, dwell_seconds: 300, max_speed_kmh: 35, temp_min_c: 2, temp_max_c: 8 }),
        nowMs - 86400000
      );
      insertGeo.run(
        'Medchal Cold Depot',
        'GW-001',
        JSON.stringify({ type: 'CIRCLE', center: { lat: 17.6297, lng: 78.4812 }, radius_m: 1000 }),
        JSON.stringify({ enter: true, exit: true, dwell: true, dwell_seconds: 300, max_speed_kmh: 25, temp_min_c: 2, temp_max_c: 8 }),
        nowMs - 86400000
      );
      insertGeo.run(
        'Shamshabad Air Cargo Zone',
        'GW-002',
        JSON.stringify({
          type: 'POLYGON',
          coordinates: [
            [17.2435, 78.4265],
            [17.2442, 78.4335],
            [17.2372, 78.4342],
            [17.2368, 78.4268],
          ],
        }),
        JSON.stringify({ enter: true, exit: true, dwell: true, dwell_seconds: 300, max_speed_kmh: 30, temp_min_c: 2, temp_max_c: 8 }),
        nowMs - 86400000
      );

      // Seed Trips + Waypoints + Halts
      const tripConfigs = [
        {
          trip_id: 'TRP-2026-041',
          device_id: 'GW-001',
          route_id: 0,
          origin: 'HITEC City Pharma Hub',
          destination: 'Medchal Cold Depot',
          status: 'IN_PROGRESS',
          distance: 28.4,
          duration: 46,
          excursion: 0,
        },
        {
          trip_id: 'TRP-2026-040',
          device_id: 'GW-002',
          route_id: 1,
          origin: 'Gachibowli Pharma Hub',
          destination: 'Shamshabad Cargo Terminal',
          status: 'IN_PROGRESS',
          distance: 31.2,
          duration: 42,
          excursion: 0,
        },
        {
          trip_id: 'TRP-2026-039',
          device_id: 'GW-003',
          route_id: 2,
          origin: 'Uppal Bio-Cluster',
          destination: 'Patancheru Vaccine Plant',
          status: 'DELAYED',
          distance: 44.8,
          duration: 78,
          excursion: 1,
        },
        {
          trip_id: 'TRP-2026-038',
          device_id: 'GW-004',
          route_id: 0,
          origin: 'HITEC City Pharma Hub',
          destination: 'Medchal Cold Depot',
          status: 'COMPLETED',
          distance: 27.9,
          duration: 41,
          excursion: 0,
        },
        {
          trip_id: 'TRP-2026-037',
          device_id: 'GW-006',
          route_id: 2,
          origin: 'Uppal Bio-Cluster',
          destination: 'Patancheru Vaccine Plant',
          status: 'COMPLETED',
          distance: 43.5,
          duration: 64,
          excursion: 0,
        },
      ];

      tripConfigs.forEach((tc, tIdx) => {
        const startMs = nowMs - (tIdx * 3 + 1) * 3600 * 1000;
        const endMs = tc.status === 'COMPLETED' ? startMs + tc.duration * 60000 : null;
        insertTrip.run(
          tc.trip_id,
          tc.device_id,
          tc.origin,
          tc.destination,
          new Date(startMs).toISOString(),
          endMs ? new Date(endMs).toISOString() : null,
          tc.duration,
          tc.distance,
          39.4,
          68.2,
          tc.excursion ? 4.8 : 3.4,
          tc.excursion ? 8.6 : 5.9,
          tc.excursion ? 6.4 : 4.5,
          tIdx % 2 === 0 ? 1 : 0,
          tc.excursion,
          tc.status
        );

        const corridor = HYDERABAD_CORRIDORS[tc.route_id];
        const totalWps = 36;
        for (let w = 0; w < totalWps; w++) {
          const p = w / (totalWps - 1);
          const pos = interpolateCorridorPosition(corridor, p);
          const wTs = new Date(startMs + p * tc.duration * 60000).toISOString();
          const temp = Number((4.1 + Math.sin(w * 0.35) * 0.8 + (tc.excursion && w > 18 ? 3.2 : 0)).toFixed(2));
          insertWp.run(
            tc.trip_id,
            w + 1,
            pos.lat,
            pos.lng,
            pos.targetSpeedKmh,
            pos.headingDeg,
            temp,
            wTs
          );
        }

        if (tIdx % 2 === 0) {
          const midPt = corridor[Math.floor(corridor.length / 2)];
          insertHalt.run(
            tc.trip_id,
            midPt.lat,
            midPt.lng,
            7,
            new Date(startMs + 18 * 60000).toISOString(),
            new Date(startMs + 25 * 60000).toISOString(),
            4.3,
            4.9,
            midPt.area
          );
        }
      });

      // Seed realistic initial Alerts
      const seedAlerts: Array<{
        id: string;
        dev: string;
        type: string;
        msg: string;
        sev: AlertSeverity;
        ai: string;
        status: AlertStatus;
        ageMin: number;
      }> = [
        {
          id: 'ALT-9001',
          dev: 'GW-003',
          type: 'Temperature Drift',
          msg: 'Cargo chamber approaching 8.0°C upper GDP limit (7.6°C, +0.18°C/min).',
          sev: 'HIGH',
          ai: 'Thermal slope predicts upper-band excursion in 14 min if condenser fan stays below 80%.',
          status: 'Active',
          ageMin: 4,
        },
        {
          id: 'ALT-9002',
          dev: 'GW-008',
          type: 'Node Offline',
          msg: 'Heartbeat timeout (>300s) on Reserve Reefer TS-07-GH-2041.',
          sev: 'CRITICAL',
          ai: 'Last known LTE CSQ dropped to -108 dBm near ORR Exit 14 prior to silence.',
          status: 'Active',
          ageMin: 14,
        },
        {
          id: 'ALT-9003',
          dev: 'GW-005',
          type: 'Stationary Dwell',
          msg: 'Vehicle stationary at Rajendranagar Bio-Park > 10 minutes.',
          sev: 'MEDIUM',
          ai: 'Geofence dwell threshold exceeded; cargo thermal mass stable at 4.9°C.',
          status: 'Active',
          ageMin: 22,
        },
        {
          id: 'ALT-9004',
          dev: 'GW-001',
          type: 'Geofence Exit',
          msg: 'Departed HITEC City Pharma Hub perimeter cleanly.',
          sev: 'LOW',
          ai: 'Scheduled dispatch verified against TRP-2026-041 manifest.',
          status: 'Acknowledged',
          ageMin: 48,
        },
      ];

      for (const a of seedAlerts) {
        this.stmts.insertAlert.run(
          a.id,
          a.dev,
          a.type,
          a.msg,
          a.sev,
          a.ai,
          a.status,
          nowMs - a.ageMin * 60000
        );
      }

      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  public recordTelemetryPoint(
    point: TelemetryPoint,
    forecast: { predicted_temp_30m_c: number | null; excursion_risk_pct: number; health_score: number; history_temps: number[] }
  ): void {
    const hrBucket = Math.floor(point.recorded_at_ms / 3600000);
    const dt = new Date(hrBucket * 3600000);
    const label = `${String(dt.getHours()).padStart(2, '0')}:00`;

    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.stmts.insertTelemetry.run(
        point.seq,
        point.device_id,
        point.node_id,
        point.recorded_at_ms,
        point.cargo_temp_c,
        point.ambient_temp_c,
        point.humidity_pct,
        point.lat,
        point.lng,
        point.altitude_m,
        point.speed_kmh,
        point.heading_deg,
        point.satellites,
        point.location_accuracy_m,
        point.network_rssi_dbm,
        point.lte_csq,
        point.node_rssi_dbm,
        point.node_connected ? 1 : 0,
        point.door_status,
        point.tamper ? 1 : 0,
        point.battery_pct,
        point.compressor_active ? 1 : 0,
        point.distance_km,
        point.address,
        point.sub_area,
        point.geofence_name,
        point.geofence_inside ? 1 : 0
      );

      this.stmts.upsertLatestState.run(
        point.device_id,
        point.seq,
        point.recorded_at_ms,
        point.cargo_temp_c,
        point.ambient_temp_c,
        point.humidity_pct,
        point.lat,
        point.lng,
        point.altitude_m,
        point.speed_kmh,
        point.heading_deg,
        point.satellites,
        point.location_accuracy_m,
        point.network_rssi_dbm,
        point.lte_csq,
        point.node_rssi_dbm,
        point.node_connected ? 1 : 0,
        point.door_status,
        point.tamper ? 1 : 0,
        point.battery_pct,
        point.compressor_active ? 1 : 0,
        point.distance_km,
        point.address,
        point.sub_area,
        point.geofence_name,
        point.geofence_inside ? 1 : 0,
        forecast.predicted_temp_30m_c,
        forecast.excursion_risk_pct,
        forecast.health_score,
        JSON.stringify(forecast.history_temps)
      );

      this.stmts.upsertHourlyRollup.run(
        hrBucket,
        label,
        point.cargo_temp_c,
        point.cargo_temp_c,
        point.cargo_temp_c
      );

      this.db.exec('COMMIT');
      this.totalTelemetryRows += 1;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  public getDevices(): DeviceRecord[] {
    return this.db
      .prepare(
        `SELECT device_id, node_id, imei, imsi, vehicle_name, cargo_type,
                target_min_c, target_max_c, sampling_interval_sec, route_id
         FROM devices ORDER BY device_id ASC`
      )
      .all() as unknown as DeviceRecord[];
  }

  public registerDevice(input: {
    device_id: string;
    imei?: string;
    vehicle_name: string;
    cargo_type: string;
    target_min_c: number;
    target_max_c: number;
    sampling_interval_sec: number;
  }): DeviceRecord {
    const nowMs = Date.now();
    const num = Math.floor(100 + Math.random() * 899);
    const nodeId = `NODE-${num}`;
    const imei = input.imei?.trim() || `86073807047${num}1`;
    const imsi = `404493400059${num}`;
    const routeId = 0;

    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db
        .prepare(
          `INSERT INTO devices (
            device_id, node_id, imei, imsi, vehicle_name, cargo_type,
            target_min_c, target_max_c, sampling_interval_sec, route_id, created_at_ms
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          input.device_id,
          nodeId,
          imei,
          imsi,
          input.vehicle_name,
          input.cargo_type,
          input.target_min_c,
          input.target_max_c,
          input.sampling_interval_sec,
          routeId,
          nowMs
        );

      this.stmts.upsertLatestState.run(
        input.device_id,
        1,
        nowMs,
        4.4,
        29.8,
        54,
        17.4483,
        78.3915,
        542,
        36.0,
        90,
        12,
        3.1,
        -76,
        18,
        -66,
        1,
        'SEALED',
        0,
        98,
        1,
        0.0,
        'HITEC City Pharma Hub',
        'Madhapur, Hyderabad',
        'HITEC City Pharma Hub',
        1,
        4.5,
        8,
        97,
        JSON.stringify([4.4, 4.4, 4.4])
      );

      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }

    return {
      device_id: input.device_id,
      node_id: nodeId,
      imei,
      imsi,
      vehicle_name: input.vehicle_name,
      cargo_type: input.cargo_type,
      target_min_c: input.target_min_c,
      target_max_c: input.target_max_c,
      sampling_interval_sec: input.sampling_interval_sec,
      route_id: routeId,
    };
  }

  public getFleetRows(): FleetTableRow[] {
    const nowMs = Date.now();
    const rawRows = this.stmts.getOverviewFleet.all() as Array<Record<string, unknown>>;

    return rawRows.map((r) => {
      const lastSeenMs = Number(r.recorded_at_ms);
      const ageSec = Math.max(0, Math.floor((nowMs - lastSeenMs) / 1000));
      const isOnline = ageSec <= 300;
      const speed = Number(r.speed_kmh);
      const operationalState = !isOnline
        ? 'OFFLINE'
        : speed >= 2
          ? 'IN_TRANSIT'
          : 'AT_STOP';

      const temp = Number(r.cargo_temp_c);
      const minC = Number(r.target_min_c);
      const maxC = Number(r.target_max_c);
      const door = String(r.door_status) === 'OPEN' ? 'OPEN' : 'SEALED';
      const tamper = Boolean(r.tamper);

      let status: FleetTableRow['status'] = 'OPTIMAL';
      if (temp > maxC || temp < minC || door === 'OPEN' || tamper) {
        status = 'EXCURSION';
      } else if (temp >= maxC - 1.0 || temp <= minC + 0.5 || !isOnline) {
        status = 'WARNING';
      }

      const healthScore = Number(r.health_score);
      const healthRating =
        healthScore >= 85
          ? 'GOOD'
          : healthScore >= 65
            ? 'FAIR'
            : healthScore >= 45
              ? 'POOR'
              : 'CRITICAL';

      let historyTemps: number[] = [];
      try {
        historyTemps = JSON.parse(String(r.history_temps_json || '[]'));
      } catch {
        historyTemps = [temp];
      }

      return {
        device_id: String(r.device_id),
        node_id: String(r.node_id),
        vehicle_name: String(r.vehicle_name),
        cargo_type: String(r.cargo_type),
        current_temp_c: temp,
        ambient_temp_c: Number(r.ambient_temp_c),
        target_min_c: minC,
        target_max_c: maxC,
        lat: Number(r.lat),
        lng: Number(r.lng),
        speed_kmh: speed,
        heading_deg: Number(r.heading_deg),
        network_rssi_dbm: Number(r.network_rssi_dbm),
        connectivity: isOnline ? 'ONLINE' : 'OFFLINE',
        operational_state: operationalState,
        security: door,
        tamper,
        status,
        health_score: healthScore,
        health_rating: healthRating,
        predicted_temp_30m_c:
          r.predicted_temp_30m_c !== null ? Number(r.predicted_temp_30m_c) : null,
        excursion_risk_pct: Number(r.excursion_risk_pct),
        distance_km: Number(r.distance_km),
        address: String(r.address),
        geofence_name: r.geofence_name ? String(r.geofence_name) : null,
        last_seen_ms: lastSeenMs,
        last_seen_str: formatRelativeSeconds(ageSec),
        packet_age_sec: ageSec,
        seq: Number(r.seq),
        compressor_active: Boolean(r.compressor_active),
        history_temps: historyTemps,
      };
    });
  }

  public getFleetOverview(): FleetOverviewPayload {
    const tStart = performance.now();

    const fleetRows = this.getFleetRows();
    const alertCounts = this.stmts.getAlertsCount.get() as {
      active_count: number | null;
      critical_count: number | null;
    };
    const recentAlertsRaw = this.stmts.getRecentAlerts.all(10) as Array<
      Record<string, unknown>
    >;
    const trips = this.stmts.getTripsSummary.all(8) as unknown as TripSummary[];
    const rollupsRaw = this.stmts.getRollups24h.all() as Array<{
      bucket_epoch_hr: number;
      label: string;
      sum_temp: number;
      min_temp: number;
      max_temp: number;
      readings_count: number;
    }>;

    const totalRowCount = this.totalTelemetryRows;

    const tEnd = performance.now();
    const queryLatencyMs = Number((tEnd - tStart).toFixed(3));
    this.trackQueryLatency(queryLatencyMs);

    const totalVehicles = fleetRows.length;
    const inTransit = fleetRows.filter((r) => r.operational_state === 'IN_TRANSIT').length;
    const atStop = fleetRows.filter((r) => r.operational_state === 'AT_STOP').length;
    const offline = fleetRows.filter((r) => r.operational_state === 'OFFLINE').length;

    const healthBuckets = {
      good: fleetRows.filter((r) => r.health_rating === 'GOOD').length,
      fair: fleetRows.filter((r) => r.health_rating === 'FAIR').length,
      poor: fleetRows.filter((r) => r.health_rating === 'POOR').length,
      critical: fleetRows.filter((r) => r.health_rating === 'CRITICAL').length,
    };

    const avgHealth =
      totalVehicles > 0
        ? Math.round(
            fleetRows.reduce((sum, r) => sum + r.health_score, 0) / totalVehicles
          )
        : 100;

    const fleetHealthRating =
      avgHealth >= 85
        ? 'GOOD'
        : avgHealth >= 65
          ? 'FAIR'
          : avgHealth >= 45
            ? 'POOR'
            : 'CRITICAL';

    const trend: TempTrendPoint[] = [...rollupsRaw]
      .reverse()
      .map((b) => ({
        label: b.label,
        avg_temp_c: Number((b.sum_temp / Math.max(1, b.readings_count)).toFixed(2)),
        min_temp_c: Number(b.min_temp.toFixed(2)),
        max_temp_c: Number(b.max_temp.toFixed(2)),
        readings_count: b.readings_count,
      }));

    const recentAlerts: AlertItem[] = recentAlertsRaw.map((a) => ({
      alert_id: String(a.alert_id),
      device_id: String(a.device_id),
      alert_type: String(a.alert_type),
      message: String(a.message),
      severity: String(a.severity) as AlertSeverity,
      ai_analysis: String(a.ai_analysis),
      status: String(a.status) as AlertStatus,
      created_at_ms: Number(a.created_at_ms),
      time_str: new Date(Number(a.created_at_ms)).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }),
    }));

    return {
      kpis: {
        total_vehicles: totalVehicles,
        in_transit: inTransit,
        at_stop: atStop,
        offline,
        active_alerts: Number(alertCounts?.active_count ?? 0),
        critical_alerts: Number(alertCounts?.critical_count ?? 0),
        fleet_health_score: avgHealth,
        fleet_health_rating: fleetHealthRating,
      },
      fleet_health: healthBuckets,
      fleet_table: fleetRows,
      trips_overview: {
        total: trips.length,
        completed: trips.filter((t) => t.status === 'COMPLETED').length,
        in_progress: trips.filter((t) => t.status === 'IN_PROGRESS').length,
        delayed: trips.filter((t) => t.status === 'DELAYED').length,
        routes: trips,
      },
      temperature_trend_24h: trend,
      recent_alerts: recentAlerts,
      query_latency_ms: queryLatencyMs,
      total_db_rows: totalRowCount,
    };
  }

  public getDeviceTelemetryHistory(
    deviceId: string,
    limit = 60,
    fromMs?: number,
    toMs?: number
  ): TelemetryPoint[] {
    const tStart = performance.now();
    let rows: Array<Record<string, unknown>>;
    if (typeof fromMs === 'number' && !Number.isNaN(fromMs) && typeof toMs === 'number' && !Number.isNaN(toMs)) {
      rows = this.db
        .prepare(
          `SELECT
            seq, device_id, node_id, recorded_at_ms, cargo_temp_c, ambient_temp_c, humidity_pct,
            lat, lng, altitude_m, speed_kmh, heading_deg, satellites, location_accuracy_m,
            network_rssi_dbm, lte_csq, node_rssi_dbm, node_connected, door_status, tamper,
            battery_pct, compressor_active, distance_km, address, sub_area, geofence_name, geofence_inside
          FROM telemetry_logs
          WHERE device_id = ? AND recorded_at_ms >= ? AND recorded_at_ms <= ?
          ORDER BY recorded_at_ms DESC
          LIMIT ?`
        )
        .all(deviceId, fromMs, toMs, limit) as Array<Record<string, unknown>>;
    } else if (typeof fromMs === 'number' && !Number.isNaN(fromMs)) {
      rows = this.db
        .prepare(
          `SELECT
            seq, device_id, node_id, recorded_at_ms, cargo_temp_c, ambient_temp_c, humidity_pct,
            lat, lng, altitude_m, speed_kmh, heading_deg, satellites, location_accuracy_m,
            network_rssi_dbm, lte_csq, node_rssi_dbm, node_connected, door_status, tamper,
            battery_pct, compressor_active, distance_km, address, sub_area, geofence_name, geofence_inside
          FROM telemetry_logs
          WHERE device_id = ? AND recorded_at_ms >= ?
          ORDER BY recorded_at_ms DESC
          LIMIT ?`
        )
        .all(deviceId, fromMs, limit) as Array<Record<string, unknown>>;
    } else {
      rows = this.stmts.getDeviceHistory.all(deviceId, limit) as Array<
        Record<string, unknown>
      >;
    }
    const tEnd = performance.now();
    this.trackQueryLatency(Number((tEnd - tStart).toFixed(3)));

    return rows.reverse().map((r) => ({
      seq: Number(r.seq),
      device_id: String(r.device_id),
      node_id: String(r.node_id),
      recorded_at_ms: Number(r.recorded_at_ms),
      timestamp: new Date(Number(r.recorded_at_ms)).toISOString(),
      cargo_temp_c: Number(r.cargo_temp_c),
      ambient_temp_c: Number(r.ambient_temp_c),
      humidity_pct: Number(r.humidity_pct),
      lat: Number(r.lat),
      lng: Number(r.lng),
      altitude_m: Number(r.altitude_m),
      speed_kmh: Number(r.speed_kmh),
      heading_deg: Number(r.heading_deg),
      satellites: Number(r.satellites),
      location_accuracy_m: Number(r.location_accuracy_m),
      network_rssi_dbm: Number(r.network_rssi_dbm),
      lte_csq: Number(r.lte_csq),
      node_rssi_dbm: Number(r.node_rssi_dbm),
      node_connected: Boolean(r.node_connected),
      door_status: String(r.door_status) === 'OPEN' ? 'OPEN' : 'SEALED',
      tamper: Boolean(r.tamper),
      battery_pct: Number(r.battery_pct),
      compressor_active: Boolean(r.compressor_active),
      distance_km: Number(r.distance_km),
      address: String(r.address),
      sub_area: String(r.sub_area),
      geofence_name: r.geofence_name ? String(r.geofence_name) : null,
      geofence_inside: Boolean(r.geofence_inside),
    }));
  }

  public getRecentThermalSamples(deviceId: string) {
    return this.stmts.getRecentThermalSamples.all(deviceId) as Array<{
      recorded_at_ms: number;
      cargo_temp_c: number;
    }>;
  }

  public getTrips(deviceId?: string): TripSummary[] {
    if (deviceId) {
      return this.db
        .prepare('SELECT * FROM trips WHERE device_id = ? ORDER BY start_time DESC')
        .all(deviceId) as unknown as TripSummary[];
    }
    return this.db
      .prepare('SELECT * FROM trips ORDER BY start_time DESC')
      .all() as unknown as TripSummary[];
  }

  public getTripDetails(tripId: string): TripDetails | null {
    const trip = this.db
      .prepare('SELECT * FROM trips WHERE trip_id = ?')
      .get(tripId) as unknown as TripSummary | undefined;
    if (!trip) return null;

    const waypoints = this.db
      .prepare(
        'SELECT lat, lng, speed_kmh, heading_deg, cargo_temp_c, timestamp FROM trip_waypoints WHERE trip_id = ? ORDER BY seq ASC'
      )
      .all(tripId) as unknown as TripWaypoint[];

    const halts = this.db
      .prepare(
        'SELECT lat, lng, duration_minutes, start_time, end_time, start_temp_c, end_temp_c, location_name FROM trip_halts WHERE trip_id = ?'
      )
      .all(tripId) as unknown as TripHalt[];

    return {
      ...trip,
      waypoints,
      halts,
    };
  }

  public getGeofences(): GeofenceRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM geofences ORDER BY id DESC')
      .all() as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: Number(r.id),
      name: String(r.name),
      device_id: String(r.device_id),
      geometry: JSON.parse(String(r.geometry_json)),
      rules: JSON.parse(String(r.rules_json)),
      enabled: Boolean(r.enabled),
    }));
  }

  public createGeofence(payload: Omit<GeofenceRecord, 'id'>): GeofenceRecord {
    const res = this.db
      .prepare(
        'INSERT INTO geofences (name, device_id, geometry_json, rules_json, enabled, created_at_ms) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(
        payload.name,
        payload.device_id,
        JSON.stringify(payload.geometry),
        JSON.stringify(payload.rules),
        payload.enabled ? 1 : 0,
        Date.now()
      );
    return {
      id: Number(res.lastInsertRowid),
      ...payload,
    };
  }

  public deleteGeofence(id: number): boolean {
    const res = this.db.prepare('DELETE FROM geofences WHERE id = ?').run(id);
    return res.changes > 0;
  }

  public getAlerts(filters?: {
    deviceId?: string;
    alertType?: string;
    status?: string;
  }): AlertItem[] {
    const clauses: string[] = [];
    const params: string[] = [];
    if (filters?.deviceId && filters.deviceId !== 'ALL') {
      clauses.push('device_id = ?');
      params.push(filters.deviceId);
    }
    if (filters?.alertType && filters.alertType !== 'ALL') {
      clauses.push('alert_type LIKE ?');
      params.push(`%${filters.alertType}%`);
    }
    if (filters?.status && filters.status !== 'ALL') {
      clauses.push('status = ?');
      params.push(filters.status);
    }

    const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.db
      .prepare(
        `SELECT alert_id, device_id, alert_type, message, severity, ai_analysis, status, created_at_ms
         FROM alerts ${whereSql} ORDER BY created_at_ms DESC LIMIT 100`
      )
      .all(...params) as Array<Record<string, unknown>>;

    return rows.map((a) => ({
      alert_id: String(a.alert_id),
      device_id: String(a.device_id),
      alert_type: String(a.alert_type),
      message: String(a.message),
      severity: String(a.severity) as AlertSeverity,
      ai_analysis: String(a.ai_analysis),
      status: String(a.status) as AlertStatus,
      created_at_ms: Number(a.created_at_ms),
      time_str: new Date(Number(a.created_at_ms)).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }),
    }));
  }

  public insertAlert(alert: Omit<AlertItem, 'time_str'>): AlertItem {
    this.stmts.insertAlert.run(
      alert.alert_id,
      alert.device_id,
      alert.alert_type,
      alert.message,
      alert.severity,
      alert.ai_analysis,
      alert.status,
      alert.created_at_ms
    );
    return {
      ...alert,
      time_str: new Date(alert.created_at_ms).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }),
    };
  }

  public updateAlertStatus(alertId: string, status: AlertStatus): AlertItem | null {
    const res = this.stmts.updateAlertStatus.run(status, alertId);
    if (res.changes === 0) return null;
    const row = this.db
      .prepare(
        'SELECT alert_id, device_id, alert_type, message, severity, ai_analysis, status, created_at_ms FROM alerts WHERE alert_id = ?'
      )
      .get(alertId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      alert_id: String(row.alert_id),
      device_id: String(row.device_id),
      alert_type: String(row.alert_type),
      message: String(row.message),
      severity: String(row.severity) as AlertSeverity,
      ai_analysis: String(row.ai_analysis),
      status: String(row.status) as AlertStatus,
      created_at_ms: Number(row.created_at_ms),
      time_str: new Date(Number(row.created_at_ms)).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }),
    };
  }

  public getExplainPlan(sql: string, params: Array<string | number> = []): string[] {
    const rows = this.db
      .prepare(`EXPLAIN QUERY PLAN ${sql}`)
      .all(...params) as Array<{ detail: string }>;
    return rows.map((r) => r.detail);
  }

  /**
   * Executes real SQLite queries comparing unoptimized patterns (N+1 full table scans,
   * raw 24h GROUP BY aggregations, unindexed time-series lookups) against our
   * optimized schema (materialized hot-state table, pre-aggregated rollups, covering composite index).
   */
  public runLiveBenchmark(): QueryOptimizationMetric[] {
    const totalRows = (
      this.db.prepare('SELECT COUNT(*) AS cnt FROM telemetry_logs').get() as {
        cnt: number;
      }
    ).cnt;

    const devices = this.getDevices();

    // 1. Fleet Overview Hot State: N+1 Full-Scan vs Single Materialized Join
    const unoptFleetSql =
      'SELECT * FROM telemetry_logs WHERE +device_id = ? ORDER BY +recorded_at_ms DESC LIMIT 1';
    const optFleetSql = `
      SELECT d.device_id, d.vehicle_name, s.cargo_temp_c, s.speed_kmh, s.recorded_at_ms
      FROM devices d
      JOIN device_latest_state s ON d.device_id = s.device_id
      ORDER BY d.device_id ASC
    `;

    const u1Start = performance.now();
    const unoptStmt = this.db.prepare(unoptFleetSql);
    for (const dev of devices) {
      unoptStmt.get(dev.device_id);
    }
    const u1Ms = Math.max(0.05, Number((performance.now() - u1Start).toFixed(3)));

    const o1Start = performance.now();
    this.stmts.getOverviewFleet.all();
    const o1Ms = Math.max(0.01, Number((performance.now() - o1Start).toFixed(3)));

    // 2. 24-Hour Fleet Temperature Aggregation: Full Raw Table GROUP BY vs Pre-Aggregated Rollup
    const cutoff24h = Date.now() - 24 * 3600 * 1000;
    const unopt24hSql = `
      SELECT CAST(recorded_at_ms / 3600000 AS INTEGER) AS hr,
             AVG(cargo_temp_c), MIN(cargo_temp_c), MAX(cargo_temp_c), COUNT(*)
      FROM telemetry_logs
      WHERE +recorded_at_ms >= ?
      GROUP BY hr
      ORDER BY hr DESC
    `;
    const opt24hSql = `
      SELECT bucket_epoch_hr, label, sum_temp, min_temp, max_temp, readings_count
      FROM temp_rollups_hourly
      ORDER BY bucket_epoch_hr DESC
      LIMIT 24
    `;

    const u2Start = performance.now();
    this.db.prepare(unopt24hSql).all(cutoff24h);
    const u2Ms = Math.max(0.05, Number((performance.now() - u2Start).toFixed(3)));

    const o2Start = performance.now();
    this.stmts.getRollups24h.all();
    const o2Ms = Math.max(0.01, Number((performance.now() - o2Start).toFixed(3)));

    // 3. Device Thermal Window (60-Point Forecast & Chart): Full Scan vs Covering Composite Index
    const unoptHistSql = `
      SELECT recorded_at_ms, cargo_temp_c, speed_kmh, lat, lng
      FROM telemetry_logs
      WHERE +device_id = ?
      ORDER BY +recorded_at_ms DESC
      LIMIT 60
    `;
    const optHistSql = `
      SELECT recorded_at_ms, cargo_temp_c, speed_kmh, lat, lng
      FROM telemetry_logs
      WHERE device_id = ?
      ORDER BY recorded_at_ms DESC
      LIMIT 60
    `;

    const u3Start = performance.now();
    this.db.prepare(unoptHistSql).all('GW-001');
    const u3Ms = Math.max(0.05, Number((performance.now() - u3Start).toFixed(3)));

    const o3Start = performance.now();
    this.db.prepare(optHistSql).all('GW-001');
    const o3Ms = Math.max(0.01, Number((performance.now() - o3Start).toFixed(3)));

    const metrics: QueryOptimizationMetric[] = [
      {
        name: 'Fleet Overview Snapshot (N+1 Elimination)',
        description:
          'Replaced 8 per-device latest-telemetry scans with a single indexed join against the materialized device_latest_state table.',
        unoptimized_ms: u1Ms,
        optimized_ms: o1Ms,
        speedup_factor: Number((u1Ms / o1Ms).toFixed(1)),
        rows_scanned_before: totalRows * devices.length,
        rows_scanned_after: devices.length,
        explain_before: this.getExplainPlan(unoptFleetSql, ['GW-001']),
        explain_after: this.getExplainPlan(optFleetSql),
      },
      {
        name: '24-Hour Thermal Trend Rollup',
        description:
          'Replaced full 24h raw-telemetry GROUP BY aggregation with O(24) reads from temp_rollups_hourly updated atomically on ingest.',
        unoptimized_ms: u2Ms,
        optimized_ms: o2Ms,
        speedup_factor: Number((u2Ms / o2Ms).toFixed(1)),
        rows_scanned_before: totalRows,
        rows_scanned_after: 24,
        explain_before: this.getExplainPlan(unopt24hSql, [cutoff24h]),
        explain_after: this.getExplainPlan(opt24hSql),
      },
      {
        name: 'Device Time-Series Window (Covering Index)',
        description:
          'Added composite covering index (device_id, recorded_at_ms DESC, cargo_temp_c, speed_kmh, lat, lng) to satisfy history & AI forecast purely from index B-tree.',
        unoptimized_ms: u3Ms,
        optimized_ms: o3Ms,
        speedup_factor: Number((u3Ms / o3Ms).toFixed(1)),
        rows_scanned_before: totalRows,
        rows_scanned_after: 60,
        explain_before: this.getExplainPlan(unoptHistSql, ['GW-001']),
        explain_after: this.getExplainPlan(optHistSql, ['GW-001']),
      },
    ];

    this.lastBenchmarks = metrics;
    this.lastBenchmarkedAt = new Date().toISOString();
    return metrics;
  }

  public getDiagnostics(): DbDiagnosticsPayload {
    const journalRow = this.db.prepare('PRAGMA journal_mode').get() as {
      journal_mode: string;
    };
    const telemCount = (
      this.db.prepare('SELECT COUNT(*) AS cnt FROM telemetry_logs').get() as {
        cnt: number;
      }
    ).cnt;
    const rollupCount = (
      this.db.prepare('SELECT COUNT(*) AS cnt FROM temp_rollups_hourly').get() as {
        cnt: number;
      }
    ).cnt;
    const tripCount = (
      this.db.prepare('SELECT COUNT(*) AS cnt FROM trips').get() as {
        cnt: number;
      }
    ).cnt;
    const alertCount = (
      this.db.prepare('SELECT COUNT(*) AS cnt FROM alerts').get() as {
        cnt: number;
      }
    ).cnt;

    const indexes = this.db
      .prepare(
        `SELECT name, tbl_name AS "table", sql
         FROM sqlite_master
         WHERE type = 'index' AND sql IS NOT NULL
         ORDER BY tbl_name, name`
      )
      .all() as Array<{ name: string; table: string; sql: string }>;

    const avgLatency =
      this.recentQueryLatenciesMs.length > 0
        ? Number(
            (
              this.recentQueryLatenciesMs.reduce((a, b) => a + b, 0) /
              this.recentQueryLatenciesMs.length
            ).toFixed(3)
          )
        : 0.18;

    return {
      engine: 'SQLite 3 (node:sqlite WAL)',
      journal_mode: String(journalRow.journal_mode || 'wal').toUpperCase(),
      cache_size_kb: 64000,
      total_telemetry_rows: telemCount,
      total_rollup_rows: rollupCount,
      total_trips: tripCount,
      total_alerts: alertCount,
      avg_dashboard_query_ms: avgLatency,
      indexes,
      benchmarks: this.lastBenchmarks,
      last_benchmarked_at: this.lastBenchmarkedAt,
    };
  }

  private trackQueryLatency(ms: number) {
    this.recentQueryLatenciesMs.push(ms);
    if (this.recentQueryLatenciesMs.length > 40) {
      this.recentQueryLatenciesMs.shift();
    }
  }
}

export function formatRelativeSeconds(ageSec: number): string {
  if (ageSec < 3) return 'Just now';
  if (ageSec < 60) return `${ageSec}s ago`;
  if (ageSec < 3600) return `${Math.floor(ageSec / 60)}m ago`;
  return `${Math.floor(ageSec / 3600)}h ago`;
}
