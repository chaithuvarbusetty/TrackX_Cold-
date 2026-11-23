import { performance } from 'node:perf_hooks';
import type {
  AlertItem,
  AlertSeverity,
  DeviceRecord,
  FleetOverviewPayload,
  GeofenceRecord,
  TelemetryPoint,
  TempTrendPoint,
  TemperatureForecast,
  WsTelemetryMessage,
} from '../shared/types';
import { TelemetryDatabase } from './database';
import {
  HYDERABAD_CORRIDORS,
  computeThermalForecast,
  evaluateGeofenceMembership,
  filterAndAccumulateDistanceKm,
  interpolateCorridorPosition,
} from './geo';

export type SimulationActionType =
  | 'DOOR_BREACH'
  | 'COMPRESSOR_FAULT'
  | 'SIGNAL_DROP'
  | 'RESTORE_NORMAL'
  | 'PAUSE_STREAM'
  | 'RESUME_STREAM';

interface DeviceSimState {
  device: DeviceRecord;
  seq: number;
  progress: number;
  cargoTemp: number;
  ambientTemp: number;
  humidity: number;
  doorStatus: 'SEALED' | 'OPEN';
  tamper: boolean;
  compressorActive: boolean;
  faultMode: 'NONE' | 'DOOR_BREACH' | 'COMPRESSOR_FAULT' | 'SIGNAL_DROP';
  warningShowcase: boolean;
  stopped: boolean;
  distanceKm: number;
  anchorLat: number;
  anchorLng: number;
  batteryPct: number;
  recentSamples: Array<{ recorded_at_ms: number; cargo_temp_c: number }>;
  lastPacket: TelemetryPoint | null;
}

export class TelemetryEngine {
  private readonly db: TelemetryDatabase;
  private states = new Map<string, DeviceSimState>();
  private geofences: GeofenceRecord[] = [];
  private paused = false;
  private lastAlertTime = new Map<string, number>();
  private timer: NodeJS.Timeout | null = null;
  private listeners = new Set<(msg: WsTelemetryMessage) => void>();
  private alertSeq = 1000;

  constructor(db: TelemetryDatabase) {
    this.db = db;
    this.syncDevicesFromDb();
    this.refreshGeofences();
  }

  public isPaused(): boolean {
    return this.paused;
  }

  public syncDevicesFromDb(): void {
    const devices = this.db.getDevices();
    const fleetRows = this.db.getFleetRows();
    const rowById = new Map(fleetRows.map((r) => [r.device_id, r]));

    for (let i = 0; i < devices.length; i++) {
      const dev = devices[i];
      if (this.states.has(dev.device_id)) {
        this.states.get(dev.device_id)!.device = dev;
        continue;
      }

      const row = rowById.get(dev.device_id);
      const history = this.db.getDeviceTelemetryHistory(dev.device_id, 15);
      const latest = history[history.length - 1] ?? null;
      const isReserveOffline = dev.device_id === 'GW-008';
      const isWarningUnit = dev.device_id === 'GW-003';
      const isStopped = dev.device_id === 'GW-005' || dev.device_id === 'GW-007';

      this.states.set(dev.device_id, {
        device: dev,
        seq: row?.seq ?? 1,
        progress: (i * 0.27) % 2,
        cargoTemp: isWarningUnit ? Math.max(7.15, row?.current_temp_c ?? 7.3) : (row?.current_temp_c ?? 4.4),
        ambientTemp: row?.ambient_temp_c ?? 30.2,
        humidity: latest?.humidity_pct ?? 54,
        doorStatus: 'SEALED',
        tamper: false,
        compressorActive: row?.compressor_active ?? true,
        faultMode: isReserveOffline ? 'SIGNAL_DROP' : 'NONE',
        warningShowcase: isWarningUnit,
        stopped: isStopped,
        distanceKm: row?.distance_km ?? 0,
        anchorLat: row?.lat ?? 17.4483,
        anchorLng: row?.lng ?? 78.3915,
        batteryPct: latest?.battery_pct ?? 94,
        recentSamples: history
          .filter((h) => h.cargo_temp_c != null)
          .map((h) => ({
            recorded_at_ms: h.recorded_at_ms,
            cargo_temp_c: h.cargo_temp_c as number,
          })),
        lastPacket: latest,
      });
    }
  }

  public refreshGeofences(): void {
    this.geofences = this.db.getGeofences();
  }

  public subscribe(listener: (msg: WsTelemetryMessage) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public broadcast(msg: WsTelemetryMessage): void {
    for (const listener of this.listeners) {
      try {
        listener(msg);
      } catch {
        // Ignore disconnected listener errors
      }
    }
  }

  public start(intervalMs = 1000): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      if (this.paused) return;
      this.stepTick();
    }, intervalMs);
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  public getLatestPacket(deviceId: string): TelemetryPoint | null {
    const state = this.states.get(deviceId);
    if (state?.lastPacket) return state.lastPacket;
    const hist = this.db.getDeviceTelemetryHistory(deviceId, 1);
    return hist[hist.length - 1] ?? null;
  }

  public getDeviceForecast(deviceId: string): TemperatureForecast {
    const state = this.states.get(deviceId);
    if (!state) {
      return computeThermalForecast([], 2, 8);
    }
    return computeThermalForecast(
      state.recentSamples,
      state.device.target_min_c,
      state.device.target_max_c
    );
  }

  public stepTick(selectedDeviceId?: string): WsTelemetryMessage {
    const nowMs = Date.now();
    const emittedAlerts: AlertItem[] = [];

    for (const state of this.states.values()) {
      if (state.faultMode === 'SIGNAL_DROP') {
        continue;
      }

      const dev = state.device;
      const corridor =
        HYDERABAD_CORRIDORS[dev.route_id % HYDERABAD_CORRIDORS.length];

      // Advance vehicle along corridor unless stopped or door breached
      if (!state.stopped && state.doorStatus !== 'OPEN') {
        state.progress = (state.progress + 0.0085) % 2;
      }

      const pos = interpolateCorridorPosition(corridor, state.progress);
      const speedKmh =
        state.stopped || state.doorStatus === 'OPEN'
          ? 0
          : Number(
              Math.max(
                8,
                pos.targetSpeedKmh + Math.sin(state.seq * 0.35) * 3.8
              ).toFixed(1)
            );

      // Update thermal physics based on fault mode & compressor state
      if (state.faultMode === 'DOOR_BREACH') {
        state.doorStatus = 'OPEN';
        state.tamper = true;
        state.compressorActive = true;
        state.cargoTemp = Math.min(
          13.2,
          state.cargoTemp + 0.24 + Math.random() * 0.1
        );
      } else if (state.faultMode === 'COMPRESSOR_FAULT') {
        state.compressorActive = false;
        state.cargoTemp = Math.min(
          14.0,
          state.cargoTemp + 0.19 + Math.random() * 0.08
        );
      } else if (state.warningShowcase) {
        state.doorStatus = 'SEALED';
        state.tamper = false;
        state.compressorActive = true;
        const nextTemp = 7.28 + Math.sin(state.seq * 0.2) * 0.22 + (Math.random() - 0.5) * 0.04;
        state.cargoTemp = Math.max(7.05, Math.min(7.75, nextTemp));
      } else {
        state.doorStatus = 'SEALED';
        state.tamper = false;
        if (state.cargoTemp > 4.9) {
          state.compressorActive = true;
        } else if (state.cargoTemp < 3.9) {
          state.compressorActive = false;
        }
        const targetCool = state.compressorActive ? -0.004 : 0.003;
        const jitter = (Math.random() - 0.5) * 0.006;
        const nextTemp = state.cargoTemp + targetCool + jitter;
        state.cargoTemp = Math.max(2.6, Math.min(7.8, nextTemp));
      }

      state.cargoTemp = Number(state.cargoTemp.toFixed(2));
      state.ambientTemp = Number(
        (29.8 + Math.sin(state.seq * 0.05) * 1.4).toFixed(1)
      );
      state.humidity = Number(
        Math.max(42, Math.min(78, 53 + Math.sin(state.seq * 0.08) * 4 + (state.doorStatus === 'OPEN' ? 11 : 0))).toFixed(1)
      );

      // 100m GPS jitter noise filter for accurate odometer accumulation
      const distRes = filterAndAccumulateDistanceKm(
        state.anchorLat,
        state.anchorLng,
        pos.lat,
        pos.lng,
        state.distanceKm
      );
      state.distanceKm = distRes.distanceKm;
      if (distRes.acceptedAnchor) {
        state.anchorLat = pos.lat;
        state.anchorLng = pos.lng;
      }

      const geoCheck = evaluateGeofenceMembership(
        pos.lat,
        pos.lng,
        this.geofences
      );

      state.seq += 1;
      const rssi = -70 - (state.seq % 17);
      const csq = Math.max(10, Math.min(31, Math.round((rssi + 113) / 2)));

      const packet: TelemetryPoint = {
        seq: state.seq,
        device_id: dev.device_id,
        node_id: dev.node_id,
        recorded_at_ms: nowMs,
        timestamp: new Date(nowMs).toISOString(),
        cargo_temp_c: state.cargoTemp,
        ambient_temp_c: state.ambientTemp,
        humidity_pct: state.humidity,
        lat: pos.lat,
        lng: pos.lng,
        altitude_m: 542,
        speed_kmh: speedKmh,
        heading_deg: pos.headingDeg,
        satellites: 11 + (state.seq % 4),
        location_accuracy_m: 2.8,
        network_rssi_dbm: rssi,
        lte_csq: csq,
        node_rssi_dbm: -63 - (state.seq % 9),
        node_connected: true,
        door_status: state.doorStatus,
        tamper: state.tamper,
        battery_pct: Number(Math.max(72, state.batteryPct - 0.002).toFixed(1)),
        compressor_active: state.compressorActive,
        distance_km: state.distanceKm,
        address: pos.area,
        sub_area: pos.subArea,
        geofence_name: geoCheck.geofenceName,
        geofence_inside: geoCheck.inside,
      };

      state.lastPacket = packet;
      state.recentSamples.push({
        recorded_at_ms: nowMs,
        cargo_temp_c: state.cargoTemp,
      });
      if (state.recentSamples.length > 20) {
        state.recentSamples.shift();
      }

      const forecast = computeThermalForecast(
        state.recentSamples,
        dev.target_min_c,
        dev.target_max_c
      );

      let healthScore = 96;
      if (state.cargoTemp > dev.target_max_c || state.cargoTemp < dev.target_min_c) {
        healthScore -= 38;
      } else if (state.cargoTemp > dev.target_max_c - 0.8) {
        healthScore -= 18;
      }
      if (state.doorStatus === 'OPEN') healthScore -= 24;
      if (state.tamper) healthScore -= 14;
      if (!state.compressorActive && state.cargoTemp > 5.5) healthScore -= 15;
      healthScore = Math.max(18, Math.min(100, healthScore));

      this.db.recordTelemetryPoint(packet, {
        predicted_temp_30m_c: forecast.predicted_30m_c,
        excursion_risk_pct: forecast.excursion_risk_pct,
        health_score: healthScore,
        history_temps: state.recentSamples.slice(-12).map((s) => s.cargo_temp_c),
      });

      // Evaluate automated alerts (debounced 45s per device+type)
      if (state.doorStatus === 'OPEN') {
        const alert = this.maybeCreateAlert(
          dev.device_id,
          'Door Breach',
          `Unauthorized rear-door open detected on ${dev.vehicle_name} at ${pos.area}.`,
          'CRITICAL',
          'Immediate thermal ingress detected (+0.25°C/min). Verify seal integrity and driver manifest.',
          nowMs
        );
        if (alert) emittedAlerts.push(alert);
      } else if (state.cargoTemp > dev.target_max_c) {
        const alert = this.maybeCreateAlert(
          dev.device_id,
          'Temperature Excursion',
          `Cargo temperature ${state.cargoTemp.toFixed(1)}°C exceeded upper threshold (${dev.target_max_c.toFixed(1)}°C).`,
          'CRITICAL',
          state.compressorActive
            ? 'Compressor running at load; thermal gain exceeds cooling capacity.'
            : 'Compressor unit offline while chamber warming above GDP safe band.',
          nowMs
        );
        if (alert) emittedAlerts.push(alert);
      }
    }

    const qStart = performance.now();
    const overview = this.db.getFleetOverview();
    const qEnd = performance.now();
    const queryLatencyMs = Number((qEnd - qStart).toFixed(3));

    const targetPacket = selectedDeviceId
      ? this.getLatestPacket(selectedDeviceId) ?? undefined
      : undefined;

    const latestTrend: TempTrendPoint | undefined =
      overview.temperature_trend_24h[overview.temperature_trend_24h.length - 1];

    const tickMsg: WsTelemetryMessage = {
      type: 'TELEMETRY_TICK',
      server_ts_ms: nowMs,
      query_latency_ms: queryLatencyMs,
      tick: {
        updates: overview.fleet_table,
        selected_packet: targetPacket,
        trend_latest: latestTrend,
        kpis: overview.kpis,
        fleet_health: overview.fleet_health,
      },
    };

    this.broadcast(tickMsg);
    for (const alert of emittedAlerts) {
      this.broadcast({
        type: 'ALERT_NEW',
        server_ts_ms: nowMs,
        alert,
      });
    }

    return tickMsg;
  }

  public performSimulationAction(
    deviceId: string,
    action: SimulationActionType
  ): {
    paused: boolean;
    overview: FleetOverviewPayload;
    alert: AlertItem | null;
    packet: TelemetryPoint | null;
  } {
    if (action === 'PAUSE_STREAM') {
      this.paused = true;
      return {
        paused: this.paused,
        overview: this.db.getFleetOverview(),
        alert: null,
        packet: this.getLatestPacket(deviceId),
      };
    }

    if (action === 'RESUME_STREAM') {
      this.paused = false;
      this.stepTick(deviceId);
      return {
        paused: this.paused,
        overview: this.db.getFleetOverview(),
        alert: null,
        packet: this.getLatestPacket(deviceId),
      };
    }

    this.syncDevicesFromDb();
    const state = this.states.get(deviceId);
    if (!state) {
      throw new Error(`Device ${deviceId} not found`);
    }

    const nowMs = Date.now();
    let createdAlert: AlertItem | null = null;

    if (action === 'DOOR_BREACH') {
      state.faultMode = 'DOOR_BREACH';
      state.doorStatus = 'OPEN';
      state.tamper = true;
      state.cargoTemp = Number(Math.max(state.cargoTemp + 1.1, 7.2).toFixed(2));
      createdAlert = this.forceCreateAlert(
        deviceId,
        'Door Breach',
        `Seal broken on ${state.device.vehicle_name}; cargo temp rising (${state.cargoTemp.toFixed(1)}°C).`,
        'CRITICAL',
        'Optical door reed switch triggered outside authorized depot window.',
        nowMs
      );
      this.stepTick(deviceId);
    } else if (action === 'COMPRESSOR_FAULT') {
      state.faultMode = 'COMPRESSOR_FAULT';
      state.compressorActive = false;
      state.cargoTemp = Number(Math.max(state.cargoTemp + 1.4, 8.3).toFixed(2));
      createdAlert = this.forceCreateAlert(
        deviceId,
        'Compressor Fault',
        `Reefer compressor current drop on ${state.device.vehicle_name}; temp at ${state.cargoTemp.toFixed(1)}°C.`,
        'HIGH',
        'Evaporator relay disabled; chamber rising toward critical pharma threshold.',
        nowMs
      );
      this.stepTick(deviceId);
    } else if (action === 'SIGNAL_DROP') {
      state.faultMode = 'SIGNAL_DROP';
      const staleMs = nowMs - 315_000;
      const base = state.lastPacket;
      const stalePacket: TelemetryPoint = {
        seq: state.seq,
        device_id: state.device.device_id,
        node_id: state.device.node_id,
        recorded_at_ms: staleMs,
        timestamp: new Date(staleMs).toISOString(),
        cargo_temp_c: state.cargoTemp,
        ambient_temp_c: state.ambientTemp,
        humidity_pct: state.humidity,
        lat: base?.lat ?? state.anchorLat,
        lng: base?.lng ?? state.anchorLng,
        altitude_m: 542,
        speed_kmh: 0,
        heading_deg: base?.heading_deg ?? 0,
        satellites: 3,
        location_accuracy_m: 48,
        network_rssi_dbm: -111,
        lte_csq: 2,
        node_rssi_dbm: -96,
        node_connected: false,
        door_status: state.doorStatus,
        tamper: state.tamper,
        battery_pct: state.batteryPct,
        compressor_active: state.compressorActive,
        distance_km: state.distanceKm,
        address: base?.address ?? 'ORR Corridor',
        sub_area: base?.sub_area ?? 'Hyderabad',
        geofence_name: base?.geofence_name ?? null,
        geofence_inside: base?.geofence_inside ?? false,
      };
      state.lastPacket = stalePacket;
      this.db.recordTelemetryPoint(stalePacket, {
        predicted_temp_30m_c: Number((state.cargoTemp + 0.9).toFixed(2)),
        excursion_risk_pct: 68,
        health_score: 44,
        history_temps: state.recentSamples.slice(-12).map((s) => s.cargo_temp_c),
      });
      createdAlert = this.forceCreateAlert(
        deviceId,
        'Node Offline',
        `Cellular & BLE gateway signal lost on ${state.device.vehicle_name} (-111 dBm).`,
        'CRITICAL',
        'Packet age exceeded 300s watchdog limit; fallback local flash buffering active.',
        nowMs
      );
      const overviewAfterDrop = this.db.getFleetOverview();
      this.broadcast({
        type: 'TELEMETRY_TICK',
        server_ts_ms: nowMs,
        query_latency_ms: overviewAfterDrop.query_latency_ms,
        tick: {
          updates: overviewAfterDrop.fleet_table,
          selected_packet: stalePacket,
          trend_latest:
            overviewAfterDrop.temperature_trend_24h[
              overviewAfterDrop.temperature_trend_24h.length - 1
            ],
          kpis: overviewAfterDrop.kpis,
          fleet_health: overviewAfterDrop.fleet_health,
        },
      });
    } else if (action === 'RESTORE_NORMAL') {
      state.faultMode = 'NONE';
      state.warningShowcase = false;
      state.doorStatus = 'SEALED';
      state.tamper = false;
      state.compressorActive = true;
      state.stopped = false;
      state.cargoTemp = 4.4;
      this.stepTick(deviceId);
    }

    if (createdAlert) {
      this.broadcast({
        type: 'ALERT_NEW',
        server_ts_ms: nowMs,
        alert: createdAlert,
      });
    }

    return {
      paused: this.paused,
      overview: this.db.getFleetOverview(),
      alert: createdAlert,
      packet: this.getLatestPacket(deviceId),
    };
  }

  private maybeCreateAlert(
    deviceId: string,
    alertType: string,
    message: string,
    severity: AlertSeverity,
    aiAnalysis: string,
    nowMs: number
  ): AlertItem | null {
    const key = `${deviceId}:${alertType}`;
    const last = this.lastAlertTime.get(key) ?? 0;
    if (nowMs - last < 45_000) return null;
    return this.forceCreateAlert(deviceId, alertType, message, severity, aiAnalysis, nowMs);
  }

  private forceCreateAlert(
    deviceId: string,
    alertType: string,
    message: string,
    severity: AlertSeverity,
    aiAnalysis: string,
    nowMs: number
  ): AlertItem {
    const key = `${deviceId}:${alertType}`;
    this.lastAlertTime.set(key, nowMs);
    this.alertSeq += 1;
    return this.db.insertAlert({
      alert_id: `ALT-${nowMs.toString().slice(-4)}-${this.alertSeq}`,
      device_id: deviceId,
      alert_type: alertType,
      message,
      severity,
      ai_analysis: aiAnalysis,
      status: 'Active',
      created_at_ms: nowMs,
    });
  }
}
