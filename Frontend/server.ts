import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer as createViteServer } from 'vite';
import { TelemetryDatabase } from './src/server/database';
import { TelemetryEngine, type SimulationActionType } from './src/server/telemetryEngine';
import type { AlertStatus, WsTelemetryMessage } from './src/shared/types';
import { buildTelemetryCsv } from './src/utils/csvExport';

async function bootstrap() {
  const app = express();
  app.use(express.json());

  const db = new TelemetryDatabase();
  const engine = new TelemetryEngine(db);
  let activeSelectedDevice = 'GW-001';

  // --- REST API v1 ---
  app.get('/api/v1/health', (_req, res) => {
    res.json({
      status: 'ok',
      engine: 'sqlite-wal',
      paused: engine.isPaused(),
      ts: Date.now(),
    });
  });

  app.get('/api/v1/fleet/overview', (_req, res) => {
    const overview = db.getFleetOverview();
    res.json(overview);
  });

  app.get('/api/v1/devices', (_req, res) => {
    res.json({ devices: db.getDevices() });
  });

  app.post('/api/v1/devices', (req, res) => {
    try {
      const {
        device_id,
        imei,
        vehicle_name,
        cargo_type,
        target_min_c = 2.0,
        target_max_c = 8.0,
        sampling_interval_sec = 2,
      } = req.body ?? {};

      if (!device_id || !vehicle_name || !cargo_type) {
        res.status(400).json({ error: 'device_id, vehicle_name, and cargo_type are required' });
        return;
      }

      const created = db.registerDevice({
        device_id: String(device_id).trim(),
        imei: imei ? String(imei) : undefined,
        vehicle_name: String(vehicle_name).trim(),
        cargo_type: String(cargo_type).trim(),
        target_min_c: Number(target_min_c),
        target_max_c: Number(target_max_c),
        sampling_interval_sec: Number(sampling_interval_sec),
      });

      engine.syncDevicesFromDb();
      const overview = db.getFleetOverview();
      engine.broadcast({
        type: 'INITIAL_FLEET_STATE',
        server_ts_ms: Date.now(),
        query_latency_ms: overview.query_latency_ms,
        fleet: overview.fleet_table,
      });

      res.status(201).json({ device: created, overview });
    } catch (err) {
      res.status(409).json({
        error: err instanceof Error ? err.message : 'Unable to register device',
      });
    }
  });

  app.get('/api/v1/telemetry/:deviceId/latest', (req, res) => {
    const { deviceId } = req.params;
    activeSelectedDevice = deviceId;
    const packet = engine.getLatestPacket(deviceId);
    if (!packet) {
      res.status(404).json({ error: 'Device telemetry not found' });
      return;
    }
    const forecast = engine.getDeviceForecast(deviceId);
    const history = db.getDeviceTelemetryHistory(deviceId, 60);
    const devices = db.getDevices();
    const device = devices.find((d) => d.device_id === deviceId) ?? null;

    res.json({
      device,
      packet,
      forecast,
      history,
    });
  });

  app.get('/api/v1/telemetry/:deviceId/history', (req, res) => {
    const { deviceId } = req.params;
    const limit = Math.min(2000, Math.max(10, Number(req.query.limit) || 120));
    const fromMs = req.query.from_ms ? Number(req.query.from_ms) : undefined;
    const toMs = req.query.to_ms ? Number(req.query.to_ms) : undefined;
    const history = db.getDeviceTelemetryHistory(deviceId, limit, fromMs, toMs);
    res.json({ device_id: deviceId, count: history.length, history });
  });

  app.get('/api/v1/telemetry/:deviceId/export.csv', (req, res) => {
    const { deviceId } = req.params;
    const limit = Math.min(2000, Math.max(10, Number(req.query.limit) || 1500));
    const fromMs = req.query.from_ms ? Number(req.query.from_ms) : undefined;
    const toMs = req.query.to_ms ? Number(req.query.to_ms) : undefined;
    const history = db.getDeviceTelemetryHistory(deviceId, limit, fromMs, toMs);
    if (history.length === 0) {
      res.status(404).json({ error: 'No telemetry history found for device in selected range' });
      return;
    }
    const csv = buildTelemetryCsv(history);
    const safeId = deviceId.replace(/[^a-zA-Z0-9_-]/g, '_');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="coldchain-${safeId}-telemetry.csv"`
    );
    res.send(csv);
  });

  app.get('/api/v1/trips', (req, res) => {
    const deviceId =
      typeof req.query.device_id === 'string' && req.query.device_id !== 'ALL'
        ? req.query.device_id
        : undefined;
    res.json({ trips: db.getTrips(deviceId) });
  });

  app.get('/api/v1/trips/details/:tripId', (req, res) => {
    const details = db.getTripDetails(req.params.tripId);
    if (!details) {
      res.status(404).json({ error: 'Trip not found' });
      return;
    }
    res.json(details);
  });

  app.get('/api/v1/geofences', (_req, res) => {
    res.json({ geofences: db.getGeofences() });
  });

  app.post('/api/v1/geofences', (req, res) => {
    const { name, device_id, geometry, rules, enabled = true } = req.body ?? {};
    if (!name || !geometry) {
      res.status(400).json({ error: 'name and geometry are required' });
      return;
    }
    const geofence = db.createGeofence({
      name: String(name),
      device_id: String(device_id || 'ALL'),
      geometry,
      rules: rules ?? {
        enter: true,
        exit: true,
        dwell: true,
        dwell_seconds: 300,
        max_speed_kmh: 40,
        temp_min_c: 2,
        temp_max_c: 8,
      },
      enabled: Boolean(enabled),
    });
    engine.refreshGeofences();
    res.status(201).json({ geofence });
  });

  app.delete('/api/v1/geofences/:id', (req, res) => {
    const ok = db.deleteGeofence(Number(req.params.id));
    engine.refreshGeofences();
    res.json({ deleted: ok });
  });

  app.get('/api/v1/alerts', (req, res) => {
    const alerts = db.getAlerts({
      deviceId: typeof req.query.device_id === 'string' ? req.query.device_id : undefined,
      alertType: typeof req.query.alert_type === 'string' ? req.query.alert_type : undefined,
      status: typeof req.query.status === 'string' ? req.query.status : undefined,
    });
    res.json({ alerts });
  });

  app.post('/api/v1/alerts/:alertId/status', (req, res) => {
    const status = req.body?.status as AlertStatus;
    if (!['Active', 'Acknowledged', 'Resolved'].includes(status)) {
      res.status(400).json({ error: 'Invalid status' });
      return;
    }
    const updated = db.updateAlertStatus(req.params.alertId, status);
    if (!updated) {
      res.status(404).json({ error: 'Alert not found' });
      return;
    }
    engine.broadcast({
      type: 'ALERT_UPDATED',
      server_ts_ms: Date.now(),
      alert: updated,
    });
    res.json({ alert: updated });
  });

  app.post('/api/v1/simulate/action', (req, res) => {
    try {
      const deviceId = String(req.body?.device_id || activeSelectedDevice);
      const action = String(req.body?.action) as SimulationActionType;
      const result = engine.performSimulationAction(deviceId, action);
      res.json(result);
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Simulation error',
      });
    }
  });

  app.get('/api/v1/db/diagnostics', (_req, res) => {
    res.json(db.getDiagnostics());
  });

  app.post('/api/v1/db/benchmark', (_req, res) => {
    db.runLiveBenchmark();
    res.json(db.getDiagnostics());
  });

  // --- HTTP & WebSocket Server ---
  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws/telemetry' });

  const clientSelectedDevice = new Map<WebSocket, string>();

  wss.on('connection', (ws) => {
    clientSelectedDevice.set(ws, activeSelectedDevice);

    const overview = db.getFleetOverview();
    const initMsg: WsTelemetryMessage = {
      type: 'INITIAL_FLEET_STATE',
      server_ts_ms: Date.now(),
      query_latency_ms: overview.query_latency_ms,
      fleet: overview.fleet_table,
    };
    ws.send(JSON.stringify(initMsg));

    ws.on('message', (raw) => {
      try {
        const parsed = JSON.parse(raw.toString()) as {
          type?: string;
          device_id?: string;
        };
        if (parsed.type === 'SELECT_DEVICE' && parsed.device_id) {
          clientSelectedDevice.set(ws, parsed.device_id);
          activeSelectedDevice = parsed.device_id;
        }
      } catch {
        // Ignore malformed client frames
      }
    });

    ws.on('close', () => {
      clientSelectedDevice.delete(ws);
    });
  });

  engine.subscribe((msg) => {
    for (const client of wss.clients) {
      if (client.readyState !== WebSocket.OPEN) continue;
      if (msg.type === 'TELEMETRY_TICK' && msg.tick) {
        const devId = clientSelectedDevice.get(client) ?? activeSelectedDevice;
        const devPacket = engine.getLatestPacket(devId) ?? undefined;
        const personalized: WsTelemetryMessage = {
          ...msg,
          tick: {
            ...msg.tick,
            selected_packet: devPacket,
          },
        };
        client.send(JSON.stringify(personalized));
      } else {
        client.send(JSON.stringify(msg));
      }
    }
  });

  // Execute one immediate tick so materialized hot-state has fresh timestamps on boot
  engine.stepTick(activeSelectedDevice);

  // Start 1Hz real-time telemetry simulation loop
  engine.start(1000);

  // --- Vite / Static Frontend Serving ---
  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexHtml = path.join(distDir, 'index.html');
      if (fs.existsSync(indexHtml)) {
        res.sendFile(indexHtml);
      } else {
        res.status(404).send('Build output missing');
      }
    });
  }

  const port = Number(process.env.PORT) || 3000;
  server.listen(port, '0.0.0.0', () => {
    console.log(`ColdChain CMS listening on http://0.0.0.0:${port}`);
  });
}

bootstrap().catch((err) => {
  console.error('Fatal server error:', err);
  process.exit(1);
});
