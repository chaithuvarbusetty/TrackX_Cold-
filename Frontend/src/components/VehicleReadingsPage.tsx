import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Download,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Search,
  Unlock,
  WifiOff,
  X,
  Zap,
} from 'lucide-react';
import type {
  DeviceRecord,
  FleetTableRow,
  TelemetryPoint,
} from '../shared/types';
import type { SimulationActionType } from '../server/telemetryEngine';
import { formatRelativeAge } from '../utils/formatters';
import { evaluateVehicleThermalFlow } from '../utils/thermalFlow';
import {
  CargoHeroBanner,
  SignalStrengthDisplay,
  VehicleCargoBadge,
} from './CargoShell';
import { LiveOscilloscopeChart, MiniSparkline } from './RealtimeCharts';

interface VehicleReadingsPageProps {
  fleetRows: FleetTableRow[];
  devices: DeviceRecord[];
  selectedDeviceId: string;
  onSelectDevice: (deviceId: string) => void;
  detailOpen: boolean;
  onDetailOpenChange: (open: boolean) => void;
  liveHistory: TelemetryPoint[];
  streamPaused: boolean;
  onAction: (action: SimulationActionType) => Promise<void>;
  onExportCsv: (deviceId: string, fromMs?: number, toMs?: number) => void;
  onRegisterDevice: (payload: {
    device_id: string;
    imei: string;
    vehicle_name: string;
    cargo_type: string;
    target_min_c: number;
    target_max_c: number;
    sampling_interval_sec: number;
  }) => Promise<void>;
  nowMs: number;
}

function toDatetimeLocalValue(ms: number): string {
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 16);
}

type PresetWindow = 'live' | '1h' | '6h' | '24h' | 'all' | 'custom';

export const VehicleReadingsPage: React.FC<VehicleReadingsPageProps> = ({
  fleetRows,
  devices,
  selectedDeviceId,
  onSelectDevice,
  detailOpen,
  onDetailOpenChange,
  liveHistory,
  streamPaused,
  onAction,
  onExportCsv,
  onRegisterDevice,
  nowMs,
}) => {
  const [search, setSearch] = useState('');
  const [preset, setPreset] = useState<PresetWindow>('live');
  const [fromInput, setFromInput] = useState(() =>
    toDatetimeLocalValue(Date.now() - 3600 * 1000)
  );
  const [toInput, setToInput] = useState(() => toDatetimeLocalValue(Date.now()));
  const [queriedHistory, setQueriedHistory] = useState<TelemetryPoint[] | null>(null);
  const [loadingWindow, setLoadingWindow] = useState(false);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [pageIdx, setPageIdx] = useState(0);
  const [busyAction, setBusyAction] = useState<SimulationActionType | null>(null);

  // Register device modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [newId, setNewId] = useState('GW-009');
  const [newImei, setNewImei] = useState('860738070479901');
  const [newName, setNewName] = useState('BioCarrier TS-09-UX-5510');
  const [newCargo, setNewCargo] = useState('mRNA Vaccines (2-8°C)');
  const [newMin, setNewMin] = useState('2.0');
  const [newMax, setNewMax] = useState('8.0');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const selectedRow =
    fleetRows.find((r) => r.device_id === selectedDeviceId) ?? fleetRows[0];
  const selectedDevice =
    devices.find((d) => d.device_id === selectedDeviceId) ?? null;

  const filteredFleet = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return fleetRows;
    return fleetRows.filter(
      (r) =>
        r.device_id.toLowerCase().includes(q) ||
        r.vehicle_name.toLowerCase().includes(q) ||
        r.cargo_type.toLowerCase().includes(q) ||
        r.address.toLowerCase().includes(q)
    );
  }, [fleetRows, search]);

  const fetchWindowData = useCallback(
    async (devId: string, mode: PresetWindow, customFrom?: string, customTo?: string) => {
      if (mode === 'live') {
        setQueriedHistory(null);
        setQueryError(null);
        setPageIdx(0);
        return;
      }

      setLoadingWindow(true);
      setQueryError(null);
      try {
        const params = new URLSearchParams({ limit: '1500' });
        const now = Date.now();
        if (mode === '1h') params.set('from_ms', String(now - 3600 * 1000));
        else if (mode === '6h') params.set('from_ms', String(now - 6 * 3600 * 1000));
        else if (mode === '24h') params.set('from_ms', String(now - 24 * 3600 * 1000));
        else if (mode === 'custom') {
          if (customFrom) params.set('from_ms', String(new Date(customFrom).getTime()));
          if (customTo) params.set('to_ms', String(new Date(customTo).getTime()));
        }

        const res = await fetch(
          `/api/v1/telemetry/${encodeURIComponent(devId)}/history?${params.toString()}`
        );
        if (!res.ok) throw new Error('Unable to load historical telemetry window');
        const body = (await res.json()) as { history: TelemetryPoint[] };
        setQueriedHistory(body.history ?? []);
        setPageIdx(0);
      } catch (err) {
        setQueryError(err instanceof Error ? err.message : 'Query failed');
      } finally {
        setLoadingWindow(false);
      }
    },
    []
  );

  useEffect(() => {
    if (!detailOpen) return;
    fetchWindowData(selectedDeviceId, preset, fromInput, toInput).catch(() => {});
  }, [detailOpen, selectedDeviceId, preset, fetchWindowData]);

  const activeRecords = useMemo(() => {
    const src = preset === 'live' ? liveHistory : queriedHistory ?? [];
    return [...src].reverse();
  }, [preset, liveHistory, queriedHistory]);

  const pageSize = 15;
  const totalPages = Math.max(1, Math.ceil(activeRecords.length / pageSize));
  const safePage = Math.min(pageIdx, totalPages - 1);
  const pagedRecords = activeRecords.slice(
    safePage * pageSize,
    safePage * pageSize + pageSize
  );

  const activeRangeMs = useMemo(() => {
    const now = Date.now();
    if (preset === '1h') return { fromMs: now - 3600 * 1000, toMs: undefined };
    if (preset === '6h') return { fromMs: now - 6 * 3600 * 1000, toMs: undefined };
    if (preset === '24h') return { fromMs: now - 24 * 3600 * 1000, toMs: undefined };
    if (preset === 'custom') {
      return {
        fromMs: fromInput ? new Date(fromInput).getTime() : undefined,
        toMs: toInput ? new Date(toInput).getTime() : undefined,
      };
    }
    return { fromMs: undefined, toMs: undefined };
  }, [preset, fromInput, toInput]);

  const handleSim = async (action: SimulationActionType) => {
    setBusyAction(action);
    try {
      await onAction(action);
    } finally {
      setBusyAction(null);
    }
  };

  async function handleSubmitRegister(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setFormError(null);
    try {
      await onRegisterDevice({
        device_id: newId.trim(),
        imei: newImei.trim(),
        vehicle_name: newName.trim(),
        cargo_type: newCargo.trim(),
        target_min_c: Number(newMin),
        target_max_c: Number(newMax),
        sampling_interval_sec: 2,
      });
      setModalOpen(false);
      setNewId(`GW-0${fleetRows.length + 2}`);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to register hardware');
    } finally {
      setSubmitting(false);
    }
  }

  const selectedStage = selectedRow
    ? evaluateVehicleThermalFlow(selectedRow).stage
    : 'OPTIMAL';

  return (
    <div className="space-y-6">
      {/* Page Header: Renamed cleanly to Vehicle Monitoring */}
      <CargoHeroBanner moduleId="vehicle-readings">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">
              {detailOpen && selectedRow
                ? `${selectedRow.device_id} Status`
                : 'Vehicle Monitoring'}
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              {detailOpen && selectedRow
                ? `Live telemetry stream, hardware controls, and anytime historical archive for ${selectedRow.vehicle_name}.`
                : 'Color-coded fleet status rows, transported cargo items, and cellular signal strength. Click any vehicle to inspect its full Status & Anytime Archive.'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {detailOpen ? (
              <button
                type="button"
                onClick={() => onDetailOpenChange(false)}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 text-xs font-semibold text-slate-800 hover:bg-slate-50 cursor-pointer whitespace-nowrap shrink-0"
              >
                <ArrowLeft className="h-3.5 w-3.5" /> Back to Vehicle Monitoring
              </button>
            ) : (
              <>
                <div className="relative min-w-[220px]">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Filter vehicle, cargo, location..."
                    className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-xs text-slate-900 placeholder:text-slate-400 outline-none focus:border-blue-600"
                  />
                </div>

                <button
                  type="button"
                  onClick={() => setModalOpen(true)}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 text-xs font-semibold text-white hover:bg-blue-700 cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Plus className="h-4 w-4" /> Register Device
                </button>
              </>
            )}
          </div>
        </div>
      </CargoHeroBanner>

      {/* VIEW 1: Color-Coded Vehicle Status Table */}
      {!detailOpen && (
        <section className="surface-panel rounded-xl p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-display text-base font-semibold text-slate-900">
              All Fleet Vehicles ({filteredFleet.length})
            </h2>
            <div className="flex flex-wrap items-center gap-4 text-[11px] font-semibold">
              <span className="inline-flex items-center gap-1.5 text-rose-700">
                <span className="h-2.5 w-2.5 rounded-xs bg-rose-600" /> Critical Row
              </span>
              <span className="inline-flex items-center gap-1.5 text-amber-700">
                <span className="h-2.5 w-2.5 rounded-xs bg-amber-500" /> Warning Row
              </span>
              <span className="inline-flex items-center gap-1.5 text-emerald-700">
                <span className="h-2.5 w-2.5 rounded-xs bg-emerald-600" /> Optimal Row
              </span>
              <span className="inline-flex items-center gap-1.5 text-slate-600">
                <span className="h-2.5 w-2.5 rounded-xs bg-slate-400" /> Offline Row
              </span>
            </div>
          </div>

          <div className="overflow-x-auto border-t border-slate-200 pt-3">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-[11px] font-semibold text-slate-500">
                  <th className="py-2.5 pl-3 pr-3">Vehicle</th>
                  <th className="py-2.5 px-3">Vehicle Status</th>
                  <th className="py-2.5 px-3">Transporting</th>
                  <th className="py-2.5 px-3">Live Temp</th>
                  <th className="py-2.5 px-3">Trend</th>
                  <th className="py-2.5 px-3">Signal Strength</th>
                  <th className="py-2.5 px-3">Door / Cooling</th>
                  <th className="py-2.5 px-3">Location &amp; Speed</th>
                  <th className="py-2.5 pl-3 pr-3 text-right">Last Reading</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {filteredFleet.map((row) => {
                  const flowEval = evaluateVehicleThermalFlow(row);
                  const stage = flowEval.stage;

                  // Distinct translucent row coloration based on vehicle thermal/operational status
                  const rowTint =
                    stage === 'CRITICAL'
                      ? 'bg-rose-500/20 hover:bg-rose-500/30 border-l-4 border-l-rose-600'
                      : stage === 'WARNING'
                        ? 'bg-amber-400/20 hover:bg-amber-400/30 border-l-4 border-l-amber-500'
                        : stage === 'OFFLINE'
                          ? 'bg-slate-400/20 hover:bg-slate-400/30 border-l-4 border-l-slate-500'
                          : 'bg-emerald-500/10 hover:bg-emerald-500/20 border-l-4 border-l-emerald-600';

                  const statusBadgeCls =
                    stage === 'CRITICAL'
                      ? 'bg-rose-600 text-white'
                      : stage === 'WARNING'
                        ? 'bg-amber-500 text-white'
                        : stage === 'OFFLINE'
                          ? 'bg-slate-500 text-white'
                          : 'bg-emerald-600 text-white';

                  const tempCls =
                    stage === 'CRITICAL'
                      ? 'text-rose-700'
                      : stage === 'WARNING'
                        ? 'text-amber-700'
                        : stage === 'OFFLINE'
                          ? 'text-slate-600'
                          : 'text-emerald-700';

                  return (
                    <tr
                      key={row.device_id}
                      data-status={stage}
                      onClick={() => {
                        onSelectDevice(row.device_id);
                        onDetailOpenChange(true);
                      }}
                      className={`cursor-pointer transition-colors ${rowTint}`}
                    >
                      <td className="py-3 pl-3 pr-3">
                        <div className="flex items-center gap-1.5 font-mono font-bold text-blue-700">
                          <span>{row.device_id}</span>
                          {row.device_id === 'GW-001' && row.connectivity === 'ONLINE' && (
                            <span className="rounded bg-cyan-100 px-1.5 py-0.5 text-[9px] font-bold text-cyan-800 border border-cyan-300">
                              LIVE IOT
                            </span>
                          )}
                        </div>
                        <div className="text-slate-900 font-semibold">{row.vehicle_name}</div>
                        {row.device_id === 'GW-001' && (
                          <div className="text-[10px] font-mono text-cyan-700">IMEI: 860738070471994</div>
                        )}
                      </td>
                      <td className="py-3 px-3">
                        <span
                          className={`inline-block rounded px-2 py-0.5 font-mono text-[10px] font-bold tracking-wide ${statusBadgeCls}`}
                        >
                          {stage}
                        </span>
                        <div className="mt-1 font-mono text-[10px] text-slate-600">
                          {row.operational_state.replace('_', ' ')}
                        </div>
                      </td>
                      <td className="py-3 px-3">
                        <VehicleCargoBadge
                          vehicleName={row.vehicle_name}
                          cargoType={row.cargo_type}
                        />
                        <div className="mt-1 font-mono text-[11px] text-slate-500 tabular-nums">
                          Band {row.target_min_c.toFixed(1)}–{row.target_max_c.toFixed(1)}°C
                        </div>
                      </td>
                      <td className="py-3 px-3 font-mono tabular-nums">
                        <div className={`text-sm font-bold ${row.current_temp_c !== null && row.current_temp_c !== undefined ? tempCls : 'text-amber-700'}`}>
                          {row.current_temp_c !== null && row.current_temp_c !== undefined
                            ? `${row.current_temp_c.toFixed(2)}°C`
                            : '--.-°C (Standby)'}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          Amb {row.ambient_temp_c.toFixed(1)}°C
                        </div>
                      </td>
                      <td className="py-3 px-3">
                        <MiniSparkline
                          values={row.history_temps}
                          color={
                            stage === 'CRITICAL'
                              ? '#e11d48'
                              : stage === 'WARNING'
                                ? '#d97706'
                                : '#059669'
                          }
                        />
                      </td>
                      <td className="py-3 px-3">
                        <SignalStrengthDisplay
                          rssiDbm={row.network_rssi_dbm}
                          offline={row.connectivity === 'OFFLINE'}
                        />
                        <div className="mt-0.5 text-[10px] font-mono">
                          {row.node_connected ? (
                            <span className="text-emerald-700 font-medium">● Probe Linked</span>
                          ) : (
                            <span className="text-slate-500 font-medium">○ Probe Standby</span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-3 font-mono text-[11px]">
                        <div className={row.security === 'OPEN' ? 'text-rose-700 font-bold' : 'text-emerald-700 font-semibold'}>
                          {row.security}
                        </div>
                        <div className="text-slate-600">
                          {row.compressor_active ? 'Cooling ON' : 'Standby'}
                        </div>
                      </td>
                      <td className="py-3 px-3">
                        <div className="font-medium text-slate-900">{row.address}</div>
                        <div className="font-mono text-[11px] text-slate-500 tabular-nums">
                          {row.speed_kmh.toFixed(1)} km/h
                        </div>
                      </td>
                      <td className="py-3 pl-3 pr-3 text-right font-mono text-[11px] text-slate-600 tabular-nums">
                        <div>{formatRelativeAge(row.last_seen_ms, nowMs)}</div>
                        <div className="text-slate-400">SEQ #{row.seq}</div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* VIEW 2: New Page When Clicking a Vehicle -> "<DEVICE_ID> Status" + Anytime Archive */}
      {detailOpen && selectedRow && (
        <>
          <section className="surface-panel rounded-xl p-6 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-3">
                  <h2 className="font-display text-lg font-bold text-slate-900">
                    {selectedRow.device_id} Status
                  </h2>
                  <span
                    className={`rounded px-2 py-0.5 font-mono text-[11px] font-bold ${
                      selectedStage === 'CRITICAL'
                        ? 'bg-rose-600 text-white'
                        : selectedStage === 'WARNING'
                          ? 'bg-amber-500 text-white'
                          : selectedStage === 'OFFLINE'
                            ? 'bg-slate-500 text-white'
                            : 'bg-emerald-600 text-white'
                    }`}
                  >
                    {selectedStage}
                  </span>
                  <VehicleCargoBadge
                    vehicleName={selectedRow.vehicle_name}
                    cargoType={selectedRow.cargo_type}
                  />
                </div>
                <p className="text-xs text-slate-500">
                  {selectedRow.vehicle_name} · IMEI {selectedDevice?.imei ?? '860738070471994'} · {selectedRow.address}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {selectedRow.device_id === 'GW-001' ? (
                  <div className={`flex items-center gap-2 rounded-lg border px-3.5 py-1.5 text-xs font-semibold ${
                    selectedRow.connectivity === 'ONLINE'
                      ? 'bg-cyan-50 border-cyan-200 text-cyan-800'
                      : 'bg-slate-100 border-slate-300 text-slate-700'
                  }`}>
                    <span className={`h-2 w-2 rounded-full ${selectedRow.connectivity === 'ONLINE' ? 'bg-cyan-500 animate-pulse' : 'bg-slate-400'}`}></span>
                    {selectedRow.connectivity === 'ONLINE'
                      ? 'Live Physical Hardware Unit: Active Telemetry Stream'
                      : 'Physical Hardware Unit: Standby / Offline'}
                  </div>
                ) : (
                  <>
                    <button
                      type="button"
                      disabled={busyAction !== null}
                      onClick={() => handleSim('DOOR_BREACH')}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-rose-300 bg-rose-50 px-2.5 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-100 cursor-pointer whitespace-nowrap shrink-0"
                    >
                      <Unlock className="h-3.5 w-3.5" /> Door Breach
                    </button>
                    <button
                      type="button"
                      disabled={busyAction !== null}
                      onClick={() => handleSim('COMPRESSOR_FAULT')}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100 cursor-pointer whitespace-nowrap shrink-0"
                    >
                      <Zap className="h-3.5 w-3.5" /> Compressor Fault
                    </button>
                    <button
                      type="button"
                      disabled={busyAction !== null}
                      onClick={() => handleSim('SIGNAL_DROP')}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer whitespace-nowrap shrink-0"
                    >
                      <WifiOff className="h-3.5 w-3.5" /> Drop Signal
                    </button>
                    <button
                      type="button"
                      disabled={busyAction !== null}
                      onClick={() => handleSim('RESTORE_NORMAL')}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-800 hover:bg-emerald-100 cursor-pointer whitespace-nowrap shrink-0"
                    >
                      <RotateCcw className="h-3.5 w-3.5" /> Restore Normal
                    </button>
                  </>
                )}
                <button
                  type="button"
                  disabled={busyAction !== null}
                  onClick={() =>
                    handleSim(streamPaused ? 'RESUME_STREAM' : 'PAUSE_STREAM')
                  }
                  className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 cursor-pointer whitespace-nowrap shrink-0"
                >
                  {streamPaused ? (
                    <>
                      <Play className="h-3.5 w-3.5" /> Resume
                    </>
                  ) : (
                    <>
                      <Pause className="h-3.5 w-3.5" /> Pause
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Live Vehicle Status Metrics Row */}
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-5 text-xs">
              <div className="surface-row rounded-lg p-3">
                <div className="text-slate-500">Chamber Temp</div>
                <div
                  className={`mt-1 font-mono text-xl font-bold tabular-nums ${
                    selectedRow.current_temp_c !== null && selectedRow.current_temp_c !== undefined
                      ? selectedStage === 'CRITICAL'
                        ? 'text-rose-600'
                        : selectedStage === 'WARNING'
                          ? 'text-amber-600'
                          : 'text-emerald-700'
                      : 'text-amber-700'
                  }`}
                >
                  {selectedRow.current_temp_c !== null && selectedRow.current_temp_c !== undefined
                    ? `${selectedRow.current_temp_c.toFixed(2)}°C`
                    : '--.-°C (Standby)'}
                </div>
              </div>
              <div className="surface-row rounded-lg p-3">
                <div className="text-slate-500">Target Band</div>
                <div className="mt-1 font-mono text-base font-semibold text-slate-900 tabular-nums">
                  {selectedRow.target_min_c.toFixed(1)}-{selectedRow.target_max_c.toFixed(1)}°C
                </div>
              </div>
              <div className="surface-row rounded-lg p-3">
                <div className="text-slate-500">Door &amp; Compressor</div>
                <div className="mt-1 font-mono text-sm font-semibold text-slate-900">
                  {selectedRow.security} · {selectedRow.compressor_active ? 'ON' : 'OFF'}
                </div>
              </div>
              <div className="surface-row rounded-lg p-3">
                <div className="text-slate-500">Signal &amp; Sensor Link</div>
                <div className="mt-1.5 flex flex-col gap-1">
                  <SignalStrengthDisplay
                    rssiDbm={selectedRow.network_rssi_dbm}
                    offline={selectedRow.connectivity === 'OFFLINE'}
                  />
                  <span className={`text-[11px] font-mono font-medium ${selectedRow.node_connected ? 'text-emerald-700' : 'text-slate-500'}`}>
                    {selectedRow.node_connected ? '● BLE Probe Linked' : '○ BLE Probe Standby (Null)'}
                  </span>
                </div>
              </div>
              <div className="surface-row rounded-lg p-3">
                <div className="text-slate-500">Live Speed</div>
                <div className="mt-1 font-mono text-xl font-bold text-slate-900 tabular-nums">
                  {selectedRow.speed_kmh.toFixed(1)} km/h
                </div>
              </div>
            </div>

            <LiveOscilloscopeChart
              history={liveHistory}
              targetMaxC={selectedRow.target_max_c}
            />
          </section>

          {/* Anytime Historical Archive */}
          <section className="surface-panel rounded-xl p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
              <div>
                <h2 className="font-display text-lg font-semibold text-slate-900">
                  Anytime Historical Data Explorer ({selectedDeviceId})
                </h2>
                <p className="text-xs text-slate-500">
                  Query SQLite WAL telemetry history for any time window and export offline audit CSVs
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {(
                  [
                    ['live', 'Live 15m'],
                    ['1h', 'Last 1h'],
                    ['6h', 'Last 6h'],
                    ['24h', 'Last 24h'],
                    ['all', 'All History'],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setPreset(id)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                      preset === id
                        ? 'bg-blue-600 text-white'
                        : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    {label}
                  </button>
                ))}

                <button
                  type="button"
                  onClick={() =>
                    onExportCsv(
                      selectedDeviceId,
                      activeRangeMs.fromMs,
                      activeRangeMs.toMs
                    )
                  }
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50 cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Download className="h-3.5 w-3.5" /> Export Window CSV
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-end gap-3 text-xs">
              <div>
                <label htmlFor="anytime-from" className="mb-1 block text-slate-600 font-medium">
                  From Date &amp; Time
                </label>
                <input
                  id="anytime-from"
                  type="datetime-local"
                  value={fromInput}
                  onChange={(e) => setFromInput(e.target.value)}
                  className="h-9 rounded-lg border border-slate-200 bg-white px-3 font-mono text-xs text-slate-900"
                />
              </div>
              <div>
                <label htmlFor="anytime-to" className="mb-1 block text-slate-600 font-medium">
                  To Date &amp; Time
                </label>
                <input
                  id="anytime-to"
                  type="datetime-local"
                  value={toInput}
                  onChange={(e) => setToInput(e.target.value)}
                  className="h-9 rounded-lg border border-slate-200 bg-white px-3 font-mono text-xs text-slate-900"
                />
              </div>
              <button
                type="button"
                onClick={() => {
                  setPreset('custom');
                  fetchWindowData(selectedDeviceId, 'custom', fromInput, toInput);
                }}
                className="h-9 rounded-lg bg-blue-600 px-4 font-semibold text-white hover:bg-blue-700 cursor-pointer whitespace-nowrap shrink-0"
              >
                Query Anytime Data
              </button>

              <span className="ml-auto font-mono text-xs text-slate-500 tabular-nums">
                {loadingWindow
                  ? 'Loading indexed telemetry...'
                  : `${activeRecords.length} packets loaded`}
              </span>
            </div>

            {queryError && (
              <div className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                {queryError}
              </div>
            )}

            <div className="overflow-x-auto border-t border-slate-200 pt-3">
              {pagedRecords.length === 0 ? (
                <div className="py-10 text-center text-sm text-slate-500">
                  No telemetry packets recorded in the selected time range. Try selecting &ldquo;Last 24h&rdquo; or &ldquo;All History&rdquo;.
                </div>
              ) : (
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-[11px] font-semibold text-slate-500">
                      <th className="py-2 pr-3">Timestamp</th>
                      <th className="py-2 px-3">SEQ</th>
                      <th className="py-2 px-3">Chamber Temp</th>
                      <th className="py-2 px-3">Ambient / RH</th>
                      <th className="py-2 px-3">Signal Strength</th>
                      <th className="py-2 px-3">Speed</th>
                      <th className="py-2 px-3">Location</th>
                      <th className="py-2 pl-3 text-right">Door / Reefer</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 font-mono tabular-nums">
                    {pagedRecords.map((p) => {
                      const hasTemp = p.cargo_temp_c !== null && p.cargo_temp_c !== undefined && !isNaN(p.cargo_temp_c);
                      const isRowCritical =
                        hasTemp
                          ? (p.cargo_temp_c! > (selectedRow?.target_max_c ?? 8) ||
                             p.cargo_temp_c! < (selectedRow?.target_min_c ?? 2) ||
                             p.door_status === 'OPEN')
                          : p.door_status === 'OPEN';
                      return (
                        <tr
                          key={`${p.seq}-${p.recorded_at_ms}`}
                          className={
                            isRowCritical
                              ? 'bg-rose-50/90 hover:bg-rose-100/70'
                              : 'hover:bg-slate-50'
                          }
                        >
                          <td className="py-2.5 pr-3 text-slate-700">
                            {new Date(p.recorded_at_ms).toLocaleString()}
                          </td>
                          <td className="py-2.5 px-3 text-slate-500">#{p.seq}</td>
                          <td
                            className={`py-2.5 px-3 font-bold ${
                              !hasTemp
                                ? 'text-slate-400 font-mono'
                                : isRowCritical
                                  ? 'text-rose-600'
                                  : p.cargo_temp_c! >= (selectedRow?.target_max_c ?? 8) - 1.0
                                    ? 'text-amber-600'
                                    : 'text-emerald-700'
                            }`}
                          >
                            {hasTemp ? `${p.cargo_temp_c!.toFixed(2)}°C` : '--.-°C'}
                          </td>
                          <td className="py-2.5 px-3 text-slate-700">
                            {p.ambient_temp_c.toFixed(1)}°C · {p.humidity_pct.toFixed(0)}%
                          </td>
                          <td className="py-2.5 px-3">
                            <SignalStrengthDisplay
                              rssiDbm={p.network_rssi_dbm}
                              csq={p.lte_csq}
                              offline={false}
                            />
                            <div className="text-[10px] font-mono mt-0.5">
                              {p.node_connected ? (
                                <span className="text-emerald-700 font-medium">● Probe Linked</span>
                              ) : (
                                <span className="text-slate-400 font-medium">○ Probe Null</span>
                              )}
                            </div>
                          </td>
                          <td className="py-2.5 px-3 text-slate-700">
                            {p.speed_kmh.toFixed(1)} km/h
                          </td>
                          <td className="py-2.5 px-3 font-sans text-slate-700 max-w-[210px] truncate">
                            {p.address}
                          </td>
                          <td className="py-2.5 pl-3 text-right text-slate-700">
                            {p.door_status} · {p.compressor_active ? 'ON' : 'OFF'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            <div className="flex items-center justify-between border-t border-slate-200 pt-3 text-xs text-slate-500">
              <span className="font-mono tabular-nums">
                Page {safePage + 1} of {totalPages}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={safePage === 0}
                  onClick={() => setPageIdx((p) => Math.max(0, p - 1))}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-slate-700 hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
                >
                  <ChevronLeft className="h-3.5 w-3.5" /> Prev
                </button>
                <button
                  type="button"
                  disabled={safePage >= totalPages - 1}
                  onClick={() => setPageIdx((p) => Math.min(totalPages - 1, p + 1))}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-slate-700 hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
                >
                  Next <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </section>
        </>
      )}

      {/* Register Hardware Modal */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
          aria-label="Register Gateway Device"
        >
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="font-display text-base font-bold text-slate-900">
                Register Cold-Chain Gateway Device
              </h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                aria-label="Close registration modal"
                className="text-slate-400 hover:text-slate-900 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSubmitRegister} className="mt-4 space-y-3 text-xs">
              {formError && (
                <div className="rounded-lg border border-rose-300 bg-rose-50 p-2.5 text-rose-700">
                  {formError}
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-slate-600 font-medium">Gateway ID</label>
                  <input
                    required
                    value={newId}
                    onChange={(e) => setNewId(e.target.value)}
                    className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 font-mono text-slate-900"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-slate-600 font-medium">IMEI</label>
                  <input
                    required
                    value={newImei}
                    onChange={(e) => setNewImei(e.target.value)}
                    className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 font-mono text-slate-900"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-slate-600 font-medium">Vehicle Name / Plate</label>
                <input
                  required
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-slate-900"
                />
              </div>

              <div>
                <label className="mb-1 block text-slate-600 font-medium">Cargo Classification</label>
                <input
                  required
                  value={newCargo}
                  onChange={(e) => setNewCargo(e.target.value)}
                  className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-slate-900"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-slate-600 font-medium">Min Temp (°C)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={newMin}
                    onChange={(e) => setNewMin(e.target.value)}
                    className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 font-mono text-slate-900"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-slate-600 font-medium">Max Temp (°C)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={newMax}
                    onChange={(e) => setNewMax(e.target.value)}
                    className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 font-mono text-slate-900"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="rounded-lg border border-slate-200 px-3.5 py-2 font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-700 disabled:opacity-50 cursor-pointer"
                >
                  {submitting ? 'Provisioning...' : 'Provision Unit'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
