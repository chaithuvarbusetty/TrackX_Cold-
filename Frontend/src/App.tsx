import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AlertItem,
  AlertStatus,
  DbDiagnosticsPayload,
  DeviceRecord,
  FleetOverviewPayload,
  GeofenceRecord,
  ModuleId,
  TelemetryPoint,
  TemperatureForecast,
  WsTelemetryMessage,
} from './shared/types';
import type { SimulationActionType } from './server/telemetryEngine';
import { TopNavbar } from './components/TopNavbar';
import { OperationsDrawer } from './components/CargoShell';
import { LiveTrackingPage } from './components/LiveTrackingPage';
import { ThermalStatusPage } from './components/ThermalStatusPage';
import { VehicleReadingsPage } from './components/VehicleReadingsPage';
import { TripsPage } from './components/TripsPage';
import { HelpPage } from './components/HelpPage';
import { ErrorBoundary } from './components/ErrorBoundary';
import {
  PrivacyPolicyModal,
  TermsOfServiceModal,
  OperationsFooter,
} from './components/LegalModals';

function computeClientForecast(
  samples: Array<{ recorded_at_ms: number; cargo_temp_c: number }>,
  targetMinC = 2,
  targetMaxC = 8
): TemperatureForecast {
  const valid = (samples || []).filter(
    (s): s is TelemetryPoint & { cargo_temp_c: number } =>
      s.cargo_temp_c !== null && s.cargo_temp_c !== undefined && !isNaN(s.cargo_temp_c)
  );

  if (valid.length === 0) {
    return {
      current_temp_c: null,
      predicted_15m_c: null,
      predicted_30m_c: null,
      predicted_60m_c: null,
      rate_c_per_min: 0,
      excursion_risk_pct: 0,
      risk_level: 'LOW',
      baseline_ready: false,
      recommendation: 'Probe standby: Gateway active, awaiting digital sensor probe telemetry.',
    };
  }
  const ordered = [...valid].sort((a, b) => a.recorded_at_ms - b.recorded_at_ms);
  const current = ordered[ordered.length - 1].cargo_temp_c;
  if (ordered.length < 3) {
    return {
      current_temp_c: current,
      predicted_15m_c: null,
      predicted_30m_c: null,
      predicted_60m_c: null,
      rate_c_per_min: 0,
      excursion_risk_pct: 0,
      risk_level: 'LOW',
      baseline_ready: false,
      recommendation: `Acquiring thermal baseline (${ordered.length}/3 packets).`,
    };
  }

  const t0 = ordered[0].recorded_at_ms;
  const xs = ordered.map((s) => (s.recorded_at_ms - t0) / 60000);
  const ys = ordered.map((s) => s.cargo_temp_c);
  const meanX = xs.reduce((a, b) => a + b, 0) / xs.length;
  const meanY = ys.reduce((a, b) => a + b, 0) / ys.length;
  let num = 0;
  let den = 0;
  for (let i = 0; i < xs.length; i++) {
    const dx = xs[i] - meanX;
    num += dx * (ys[i] - meanY);
    den += dx * dx;
  }
  const spanMin = Math.max(0.05, xs[xs.length - 1] - xs[0]);
  const rawSlope = den > 1e-6 ? num / den : 0;
  const totalDelta = Math.abs(ys[ys.length - 1] - ys[0]);
  const dampedSlope = spanMin < 1.0 && totalDelta < 0.35 ? rawSlope * 0.12 : rawSlope;
  const slope = Math.max(-0.45, Math.min(0.45, dampedSlope));
  const pred15 = Number((current + slope * 15 * 0.85).toFixed(2));
  const pred30 = Number((current + slope * 30 * 0.7).toFixed(2));
  const pred60 = Number((current + slope * 60 * 0.52).toFixed(2));

  let riskPct = 8;
  if (current > targetMaxC || current < targetMinC) riskPct = 92;
  else if (pred30 > targetMaxC || pred30 < targetMinC) riskPct = 78;
  else if (pred60 > targetMaxC || pred60 < targetMinC) riskPct = 56;
  else if (targetMaxC - current < 1.2 || current - targetMinC < 0.8) riskPct = 36;
  else riskPct = Math.max(4, Math.round(Math.abs(slope) * 180));

  const riskLevel = riskPct >= 70 ? 'HIGH' : riskPct >= 35 ? 'MODERATE' : 'LOW';
  const recommendation =
    current > targetMaxC
      ? 'CRITICAL: Cargo temperature above threshold. Inspect refrigeration compressor and door seal immediately.'
      : riskLevel === 'HIGH'
        ? `Thermal drift (+${slope.toFixed(2)}°C/min) projected to breach ${targetMaxC}°C within 30m.`
        : riskLevel === 'MODERATE'
          ? 'Mild thermal warming trend observed. Monitor door dwell intervals.'
          : 'Operating within GDP pharmaceutical cold-chain band (2.0-8.0°C).';

  return {
    current_temp_c: Number(current.toFixed(2)),
    predicted_15m_c: pred15,
    predicted_30m_c: pred30,
    predicted_60m_c: pred60,
    rate_c_per_min: Number(slope.toFixed(3)),
    excursion_risk_pct: riskPct,
    risk_level: riskLevel,
    baseline_ready: true,
    recommendation,
  };
}

export default function App() {
  const [activeModule, setActiveModule] = useState<ModuleId>('live-tracking');
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('GW-001');
  const [overview, setOverview] = useState<FleetOverviewPayload | null>(null);
  const [devices, setDevices] = useState<DeviceRecord[]>([]);
  const [geofences, setGeofences] = useState<GeofenceRecord[]>([]);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [diagnostics, setDiagnostics] = useState<DbDiagnosticsPayload | null>(null);

  const [selectedHistory, setSelectedHistory] = useState<TelemetryPoint[]>([]);
  const [streamPaused, setStreamPaused] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [monitoringDetailOpen, setMonitoringDetailOpen] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [termsOpen, setTermsOpen] = useState(false);
  const [tripsResetKey, setTripsResetKey] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const wsRef = useRef<WebSocket | null>(null);
  const selectedDeviceRef = useRef(selectedDeviceId);
  selectedDeviceRef.current = selectedDeviceId;

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const loadInitialData = useCallback(async () => {
    const [ovRes, devRes, geoRes, alertRes, diagRes] = await Promise.all([
      fetch('/api/v1/fleet/overview').then((r) => r.json()),
      fetch('/api/v1/devices').then((r) => r.json()),
      fetch('/api/v1/geofences').then((r) => r.json()),
      fetch('/api/v1/alerts').then((r) => r.json()),
      fetch('/api/v1/db/diagnostics').then((r) => r.json()),
    ]);
    setOverview(ovRes);
    setDevices(devRes.devices ?? []);
    setGeofences(geoRes.geofences ?? []);
    setAlerts(alertRes.alerts ?? []);
    setDiagnostics(diagRes);
  }, []);

  const loadDeviceHistory = useCallback(async (devId: string) => {
    const res = await fetch(`/api/v1/telemetry/${encodeURIComponent(devId)}/latest`);
    if (!res.ok) return;
    const data = await res.json();
    setSelectedHistory(data.history ?? []);
  }, []);

  useEffect(() => {
    loadInitialData().catch(() => {});
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }, [loadInitialData]);

  useEffect(() => {
    loadDeviceHistory(selectedDeviceId).catch(() => {});
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({ type: 'SELECT_DEVICE', device_id: selectedDeviceId })
      );
    }
  }, [selectedDeviceId, loadDeviceHistory]);

  useEffect(() => {
    let closed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${proto}//${window.location.host}/ws/telemetry`);
      wsRef.current = ws;

      ws.onopen = () => {
        if (closed) return;
        ws.send(
          JSON.stringify({
            type: 'SELECT_DEVICE',
            device_id: selectedDeviceRef.current,
          })
        );
      };

      ws.onmessage = (ev) => {
        if (closed) return;
        try {
          const msg = JSON.parse(ev.data) as WsTelemetryMessage;
          if (msg.type === 'INITIAL_FLEET_STATE' && msg.fleet) {
            setOverview((prev) =>
              prev
                ? {
                    ...prev,
                    fleet_table: msg.fleet!,
                    query_latency_ms: msg.query_latency_ms ?? prev.query_latency_ms,
                  }
                : prev
            );
          } else if (msg.type === 'TELEMETRY_TICK' && msg.tick) {
            const tick = msg.tick;
            setNowMs(msg.server_ts_ms);
            setOverview((prev) => {
              if (!prev) return prev;
              const updatedTrend = [...prev.temperature_trend_24h];
              if (tick.trend_latest && updatedTrend.length > 0) {
                const last = updatedTrend[updatedTrend.length - 1];
                if (last.label === tick.trend_latest.label) {
                  updatedTrend[updatedTrend.length - 1] = tick.trend_latest;
                } else {
                  updatedTrend.push(tick.trend_latest);
                  if (updatedTrend.length > 24) updatedTrend.shift();
                }
              }
              return {
                ...prev,
                kpis: tick.kpis,
                fleet_health: tick.fleet_health,
                fleet_table: tick.updates,
                temperature_trend_24h: updatedTrend,
                query_latency_ms: msg.query_latency_ms ?? prev.query_latency_ms,
                total_db_rows: prev.total_db_rows + tick.updates.length,
              };
            });

            if (
              tick.selected_packet &&
              tick.selected_packet.device_id === selectedDeviceRef.current
            ) {
              const pkt = tick.selected_packet;
              setSelectedHistory((prev) => {
                const last = prev[prev.length - 1];
                if (last && last.seq === pkt.seq) return prev;
                return [...prev.slice(-59), pkt];
              });
            }
          } else if (msg.type === 'ALERT_NEW' && msg.alert) {
            const incoming = msg.alert;
            setAlerts((prev) => {
              if (prev.some((a) => a.alert_id === incoming.alert_id)) return prev;
              return [incoming, ...prev].slice(0, 100);
            });
            if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
              try {
                new Notification(`ColdChain [${incoming.device_id}]: ${incoming.alert_type}`, {
                  body: incoming.message,
                  icon: '/favicon.ico',
                  tag: incoming.alert_id,
                });
              } catch {
                // ignore
              }
            }
          } else if (msg.type === 'ALERT_UPDATED' && msg.alert) {
            const upd = msg.alert;
            setAlerts((prev) =>
              prev.map((a) => (a.alert_id === upd.alert_id ? upd : a))
            );
          }
        } catch {
          // Ignore malformed WS frame
        }
      };

      ws.onclose = () => {
        if (closed) return;
        reconnectTimer = setTimeout(connect, 1500);
      };
    };

    connect();
    return () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  }, []);

  const handleRegisterDevice = async (payload: {
    device_id: string;
    imei: string;
    vehicle_name: string;
    cargo_type: string;
    target_min_c: number;
    target_max_c: number;
    sampling_interval_sec: number;
  }) => {
    const res = await fetch('/api/v1/devices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await res.json();
    if (!res.ok) {
      throw new Error(body.error || 'Failed to register hardware');
    }
    setOverview(body.overview);
    setDevices((prev) => [...prev, body.device]);
    setSelectedDeviceId(body.device.device_id);
  };

  const handleSimulationAction = async (action: SimulationActionType) => {
    const res = await fetch('/api/v1/simulate/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_id: selectedDeviceId, action }),
    });
    if (!res.ok) return;
    const data = await res.json();
    setStreamPaused(Boolean(data.paused));
    if (data.overview) setOverview(data.overview);
    if (data.packet && data.packet.device_id === selectedDeviceId) {
      setSelectedHistory((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.seq === data.packet.seq) return prev;
        return [...prev.slice(-59), data.packet];
      });
    }
  };

  const handleUpdateAlertStatus = async (alertId: string, status: AlertStatus) => {
    const res = await fetch(`/api/v1/alerts/${encodeURIComponent(alertId)}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) return;
    const data = await res.json();
    if (data.alert) {
      const updated = data.alert as AlertItem;
      setAlerts((prev) =>
        prev.map((a) => (a.alert_id === updated.alert_id ? updated : a))
      );
      const ovRes = await fetch('/api/v1/fleet/overview').then((r) => r.json());
      setOverview(ovRes);
    }
  };

  const handleRefreshGeofences = async () => {
    const res = await fetch('/api/v1/geofences').then((r) => r.json());
    setGeofences(res.geofences ?? []);
  };

  const handleRunBenchmark = async () => {
    const res = await fetch('/api/v1/db/benchmark', { method: 'POST' });
    if (res.ok) {
      const diag = (await res.json()) as DbDiagnosticsPayload;
      setDiagnostics(diag);
    }
  };

  const handleExportCsv = useCallback(
    async (deviceId: string, fromMs?: number, toMs?: number) => {
      const params = new URLSearchParams({ limit: '1500' });
      if (typeof fromMs === 'number' && !Number.isNaN(fromMs)) {
        params.set('from_ms', String(fromMs));
      }
      if (typeof toMs === 'number' && !Number.isNaN(toMs)) {
        params.set('to_ms', String(toMs));
      }
      const res = await fetch(
        `/api/v1/telemetry/${encodeURIComponent(deviceId)}/export.csv?${params.toString()}`
      );
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      a.download = `coldchain-${deviceId}-telemetry-${stamp}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
    []
  );

  const handleNavigateModule = useCallback((mod: ModuleId, openDetail = false) => {
    setActiveModule(mod);
    if (mod === 'vehicle-readings') {
      setMonitoringDetailOpen(openDetail);
    }
    if (mod === 'trips') {
      setTripsResetKey((k) => k + 1);
    }
  }, []);

  const selectedDevice = useMemo(
    () => devices.find((d) => d.device_id === selectedDeviceId) ?? null,
    [devices, selectedDeviceId]
  );

  const activeForecast = useMemo(() => {
    const samples = selectedHistory
      .slice(-12)
      .filter((h): h is typeof h & { cargo_temp_c: number } => h.cargo_temp_c != null && !isNaN(Number(h.cargo_temp_c)))
      .map((h) => ({
        recorded_at_ms: h.recorded_at_ms,
        cargo_temp_c: Number(h.cargo_temp_c),
      }));
    return computeClientForecast(
      samples,
      selectedDevice?.target_min_c ?? 2,
      selectedDevice?.target_max_c ?? 8
    );
  }, [selectedHistory, selectedDevice]);

  return (
    <div className="relative min-h-screen bg-slate-100 text-slate-900">
      <div className="relative z-10 flex min-h-screen flex-col">
        <TopNavbar
          activeModule={activeModule}
          onSelectModule={(mod) => handleNavigateModule(mod, false)}
          activeAlertCount={overview?.kpis.active_alerts ?? 0}
          onOpenAlertsDrawer={() => setDrawerOpen(true)}
        />

        <main className="mx-auto w-full max-w-[1440px] flex-1 px-6 py-6">
          {!overview ? (
            <div className="surface-panel rounded-xl p-12 text-center text-sm text-slate-600">
              Loading fleet telemetry stream...
            </div>
          ) : (
            <>
              {activeModule === 'live-tracking' && (
                <LiveTrackingPage
                  overview={overview}
                  selectedDeviceId={selectedDeviceId}
                  onSelectDevice={setSelectedDeviceId}
                  onNavigateModule={handleNavigateModule}
                  onExportCsv={handleExportCsv}
                  geofences={geofences}
                />
              )}

              {activeModule === 'thermal-status' && (
                <ThermalStatusPage
                  overview={overview}
                  selectedDeviceId={selectedDeviceId}
                  onSelectDevice={setSelectedDeviceId}
                  onNavigateModule={handleNavigateModule}
                  onExportCsv={handleExportCsv}
                  forecast={activeForecast}
                />
              )}

              {activeModule === 'vehicle-readings' && (
                <VehicleReadingsPage
                  fleetRows={overview.fleet_table}
                  devices={devices}
                  selectedDeviceId={selectedDeviceId}
                  onSelectDevice={setSelectedDeviceId}
                  detailOpen={monitoringDetailOpen}
                  onDetailOpenChange={setMonitoringDetailOpen}
                  liveHistory={selectedHistory}
                  streamPaused={streamPaused}
                  onAction={handleSimulationAction}
                  onExportCsv={handleExportCsv}
                  onRegisterDevice={handleRegisterDevice}
                  nowMs={nowMs}
                />
              )}

              {activeModule === 'trips' && (
                <ErrorBoundary fallbackTitle="Trips & Journey Manifest View">
                  <TripsPage
                    key={tripsResetKey}
                    trips={overview.trips_overview.routes}
                    fleetRows={overview.fleet_table}
                    geofences={geofences}
                    onRefreshGeofences={handleRefreshGeofences}
                    onSelectDevice={setSelectedDeviceId}
                    onNavigateModule={handleNavigateModule}
                    onExportCsv={handleExportCsv}
                  />
                </ErrorBoundary>
              )}

              {activeModule === 'help' && (
                <HelpPage
                  fleetRows={overview.fleet_table}
                  onInspectVehicleThermal={(deviceId) => {
                    setSelectedDeviceId(deviceId);
                    setActiveModule('thermal-status');
                  }}
                  onNavigateModule={handleNavigateModule}
                />
              )}
            </>
          )}
        </main>

        <OperationsFooter
          onOpenPrivacy={() => setPrivacyOpen(true)}
          onOpenTerms={() => setTermsOpen(true)}
        />
      </div>

      <OperationsDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        alerts={alerts}
        fleetRows={overview?.fleet_table ?? []}
        diagnostics={diagnostics}
        onUpdateAlertStatus={handleUpdateAlertStatus}
        onFocusVehicle={(id) => {
          setSelectedDeviceId(id);
          setActiveModule('vehicle-readings');
          setMonitoringDetailOpen(true);
        }}
        onRunBenchmark={handleRunBenchmark}
      />

      <PrivacyPolicyModal
        open={privacyOpen}
        onClose={() => setPrivacyOpen(false)}
      />

      <TermsOfServiceModal
        open={termsOpen}
        onClose={() => setTermsOpen(false)}
      />
    </div>
  );
}
