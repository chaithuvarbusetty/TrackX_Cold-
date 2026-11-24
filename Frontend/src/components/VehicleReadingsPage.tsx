import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Download,
  Edit2,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Search,
  Trash2,
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
import { Viewport3D } from './LazyViewport3D';

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
  onUpdateDevice?: (
    deviceId: string,
    payload: {
      vehicle_name?: string;
      cargo_type?: string;
      target_min_c?: number;
      target_max_c?: number;
      sampling_interval_sec?: number;
      imei?: string;
    }
  ) => Promise<void>;
  onDeleteDevice?: (deviceId: string) => Promise<void>;
  nowMs: number;
}

function toDatetimeLocalValue(ms: number): string {
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 16);
}

function cleanVehicleName(name: string | undefined, deviceId: string): string {
  if (!name || !name.trim()) return deviceId;
  return name.trim();
}

function computeSensorDiagnosis(row: FleetTableRow) {
  if (row.connectivity === 'OFFLINE') return { label: 'Unit Offline', status: 'offline' };
  if (!row.node_connected || row.current_temp_c === null) return { label: 'Probe Standby', status: 'standby' };
  if (row.network_rssi_dbm < -92) return { label: 'Cellular Jitter', status: 'warning' };
  return { label: 'Signal Fidelity 99%', status: 'optimal' };
}

function computeDoorDwellBudget(row: FleetTableRow): string | null {
  if (row.security !== 'OPEN') return null;
  const amb = row.ambient_temp_c ?? 30.0;
  const current = row.current_temp_c ?? 4.0;
  const maxT = row.target_max_c ?? 8.0;
  const tempDiff = Math.max(0.5, maxT - current);
  const heatGainRate = Math.max(0.35, (amb - current) * 0.04);
  const safeMins = Math.max(0.5, Math.round((tempDiff / heatGainRate) * 10) / 10);
  return `${safeMins}m safe window before >${maxT.toFixed(1)}°C`;
}

function computeCompressorHealth(row: FleetTableRow): string {
  if (!row.compressor_active) return 'Standby';
  if (row.status === 'EXCURSION') return 'Cooling Heavy Load';
  if (row.status === 'WARNING') return 'High Load (Duty 88%)';
  return 'Cooling ON';
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
  onUpdateDevice,
  onDeleteDevice,
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
  const [newId, setNewId] = useState('GW-002');
  const [newImei, setNewImei] = useState('');
  const [newName, setNewName] = useState('Pharma Cold Carrier');
  const [newCargo, setNewCargo] = useState('mRNA Vaccines (2-8°C)');
  const [newMin, setNewMin] = useState('2.0');
  const [newMax, setNewMax] = useState('8.0');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Edit device modal state
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editTargetId, setEditTargetId] = useState('');
  const [editName, setEditName] = useState('');
  const [editCargo, setEditCargo] = useState('');
  const [editMin, setEditMin] = useState('2.0');
  const [editMax, setEditMax] = useState('8.0');
  const [editImei, setEditImei] = useState('');
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const selectedRow =
    fleetRows.find((r) => r.device_id === selectedDeviceId) ?? fleetRows[0];
  const selectedDevice =
    devices.find((d) => d.device_id === selectedDeviceId) ?? null;

  const openEditModalFor = (devId: string) => {
    const row = fleetRows.find((r) => r.device_id === devId) || selectedRow;
    const dev = devices.find((d) => d.device_id === devId) || selectedDevice;
    setEditTargetId(devId);
    setEditName(row?.vehicle_name || dev?.vehicle_name || devId);
    setEditCargo(row?.cargo_type || dev?.cargo_type || 'mRNA Vaccines (2–8°C)');
    setEditMin(String(row?.target_min_c ?? dev?.target_min_c ?? 2.0));
    setEditMax(String(row?.target_max_c ?? dev?.target_max_c ?? 8.0));
    setEditImei(dev?.imei || '');
    setConfirmDelete(false);
    setIsDeleting(false);
    setEditError(null);
    setEditModalOpen(true);
  };

  async function handleSubmitEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!onUpdateDevice) return;
    setEditSubmitting(true);
    setEditError(null);
    try {
      await onUpdateDevice(editTargetId, {
        vehicle_name: editName.trim(),
        cargo_type: editCargo.trim(),
        target_min_c: Number(editMin),
        target_max_c: Number(editMax),
        imei: editImei.trim(),
      });
      setEditModalOpen(false);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Failed to update vehicle');
    } finally {
      setEditSubmitting(false);
    }
  }

  async function handleDelete(deviceId: string) {
    if (!onDeleteDevice) return;
    setIsDeleting(true);
    setEditError(null);
    try {
      await onDeleteDevice(deviceId);
      setEditModalOpen(false);
      if (detailOpen && selectedDeviceId === deviceId) {
        onDetailOpenChange(false);
      }
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Failed to delete vehicle');
    } finally {
      setIsDeleting(false);
    }
  }

  const filteredFleet = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return fleetRows;
    return fleetRows.filter(
      (r) =>
        r.device_id.toLowerCase().includes(q) ||
        r.vehicle_name.toLowerCase().includes(q) ||
        r.cargo_type.toLowerCase().includes(q) ||
        (r.address || '').toLowerCase().includes(q)
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

  const diagnosticTelemetry = useMemo(() => {
    if (!selectedRow) return undefined;
    const rawTemp = selectedRow.current_temp_c;
    const hasValidTemp =
      rawTemp !== null && rawTemp !== undefined && !isNaN(Number(rawTemp));
    const temp = hasValidTemp ? Number(rawTemp) : null;
    const minT = selectedRow.target_min_c ?? 2.0;
    const maxT = selectedRow.target_max_c ?? 8.0;
    const tempBand =
      temp == null
        ? 'optimal'
        : temp > maxT
          ? 'above_critical'
          : temp < minT
            ? 'below_critical'
            : 'optimal';
    const isAlert =
      selectedRow.status === 'EXCURSION' ||
      (temp != null && (temp > maxT || temp < minT)) ||
      selectedRow.security === 'OPEN';
    const speed =
      selectedRow.speed_kmh != null && !isNaN(Number(selectedRow.speed_kmh))
        ? Number(selectedRow.speed_kmh)
        : 0;
    return {
      callsign: selectedRow.device_id,
      temperatureC: temp,
      tempBand: tempBand as 'optimal' | 'above_critical' | 'below_critical',
      doorState: (selectedRow.security === 'OPEN' ? 'open' : 'closed') as 'open' | 'closed',
      compressorActive: selectedRow.compressor_active ?? true,
      speedKmh: speed,
      vehicleMoving: speed > 1.0,
      isAlertActive: isAlert,
      isDoorTampered: selectedRow.security === 'OPEN',
      accentHex: 0x2563eb,
      cutawayEnabled: false,
      cameraPreset: 'doors' as const,
    };
  }, [selectedRow]);

  const historicalSummary = useMemo(() => {
    if (activeRecords.length === 0) return 'No telemetry packets recorded in this time window.';
    const validTemps = activeRecords
      .map((r) => r.cargo_temp_c)
      .filter((t): t is number => t !== null && t !== undefined && !isNaN(t));
    const openDoors = activeRecords.filter((r) => r.door_status === 'OPEN').length;
    const avgTemp =
      validTemps.length > 0
        ? (validTemps.reduce((a, b) => a + b, 0) / validTemps.length).toFixed(1)
        : null;
    const excursions = validTemps.filter(
      (t) =>
        t > (selectedRow?.target_max_c ?? 8.0) ||
        t < (selectedRow?.target_min_c ?? 2.0)
    ).length;

    if (avgTemp === null) {
      return `Window Audit (${activeRecords.length} packets): Probe standby · 0 thermal excursion alarms.`;
    }
    return `AI Window Audit: Maintained ${avgTemp}°C mean · ${openDoors} door open events · ${excursions} excursion points over ${activeRecords.length} packets.`;
  }, [activeRecords, selectedRow]);

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
                        <div className="flex items-center justify-between gap-1.5">
                          <div className="flex items-center gap-1.5 font-mono font-bold text-blue-700">
                            <span>{row.device_id}</span>
                            {row.device_id === 'GW-001' && row.connectivity === 'ONLINE' && (
                              <span className="rounded bg-cyan-100 px-1.5 py-0.5 text-[9px] font-bold text-cyan-800 border border-cyan-300">
                                LIVE IOT
                              </span>
                            )}
                          </div>
                          {onUpdateDevice && (
                            <button
                              type="button"
                              title={`Edit ${row.device_id} parameters`}
                              onClick={(e) => {
                                e.stopPropagation();
                                openEditModalFor(row.device_id);
                              }}
                              className="rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-blue-600 transition-colors cursor-pointer"
                            >
                              <Edit2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                        <div className="text-slate-900 font-semibold">{cleanVehicleName(row.vehicle_name, row.device_id)}</div>
                        <div className="text-[10px] font-mono text-slate-500">
                          IMEI: {devices.find((d) => d.device_id === row.device_id)?.imei || (row.device_id === 'GW-001' ? '860738070471994' : 'Awaiting Registration')}
                        </div>
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
                          vehicleName={cleanVehicleName(row.vehicle_name, row.device_id)}
                          cargoType={row.cargo_type}
                        />
                        <div className="mt-1 font-mono text-[11px] text-slate-500 tabular-nums">
                          Band {row.target_min_c.toFixed(1)}–{row.target_max_c.toFixed(1)}°C
                        </div>
                      </td>
                      <td className="py-3 px-3 font-mono tabular-nums">
                        <div className={`text-sm font-bold ${row.current_temp_c !== null && row.current_temp_c !== undefined ? tempCls : 'text-slate-600'}`}>
                          {row.current_temp_c !== null && row.current_temp_c !== undefined
                            ? `${row.current_temp_c.toFixed(2)}°C`
                            : '--.-°C'}
                        </div>
                        {row.ambient_temp_c != null ? (
                          <div className="text-[11px] text-slate-500">
                            Amb {row.ambient_temp_c.toFixed(1)}°C
                          </div>
                        ) : (
                          <div className="text-[10px] text-slate-400">
                            (Standby)
                          </div>
                        )}
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
                          <span className="block text-[9px] text-slate-400 font-sans">
                            {computeSensorDiagnosis(row).label}
                          </span>
                        </div>
                      </td>
                      <td className="py-3 px-3 font-mono text-[11px]">
                        <div className={row.security === 'OPEN' ? 'text-rose-700 font-bold' : (row.security === 'Standby' ? 'text-slate-500' : 'text-emerald-700 font-semibold')}>
                          {row.security}
                          {row.security === 'OPEN' && (
                            <span className="block text-[10px] font-normal text-rose-600 font-sans">
                              {computeDoorDwellBudget(row)}
                            </span>
                          )}
                        </div>
                        <div className="text-slate-600 text-[10px]">
                          {row.last_seen_ms === 0 ? 'Standby' : computeCompressorHealth(row)}
                        </div>
                      </td>
                      <td className="py-3 px-3">
                        <div className="font-medium text-slate-900 max-w-[170px] truncate" title={row.address || 'Awaiting GPS Fix'}>
                          {row.address || 'Awaiting GPS Fix'}
                        </div>
                        <div className="font-mono text-[11px] text-slate-500 tabular-nums">
                          {row.last_seen_ms === 0 || row.lat === null || row.lat === undefined ? '-- km/h' : `${row.speed_kmh.toFixed(1)} km/h`}
                        </div>
                      </td>
                      <td className="py-3 pl-3 pr-3 text-right font-mono text-[11px] text-slate-600 tabular-nums">
                        <div>{row.last_seen_ms === 0 ? 'Never' : formatRelativeAge(row.last_seen_ms, nowMs)}</div>
                        <div className="text-slate-400">{row.seq === 0 ? '--' : `SEQ #${row.seq}`}</div>
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
          <section className="surface-panel rounded-xl p-5 sm:p-6 space-y-5">
            <div className="flex flex-col gap-4 border-b border-slate-200 pb-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="space-y-1.5 min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 sm:gap-2.5">
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
                    vehicleName={cleanVehicleName(selectedRow.vehicle_name, selectedRow.device_id)}
                    cargoType={selectedRow.cargo_type}
                  />
                  {onUpdateDevice && (
                    <button
                      type="button"
                      onClick={() => openEditModalFor(selectedRow.device_id)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 hover:border-blue-400 hover:text-blue-600 cursor-pointer shadow-2xs transition-colors shrink-0"
                    >
                      <Edit2 className="h-3 w-3" /> Edit Device
                    </button>
                  )}
                </div>
                <div className="text-xs text-slate-500 flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-semibold text-slate-700">{cleanVehicleName(selectedRow.vehicle_name, selectedRow.device_id)}</span>
                  <span>·</span>
                  <span className="font-mono text-slate-600">IMEI {selectedDevice?.imei || (selectedRow.device_id === 'GW-001' ? '860738070471994' : 'Awaiting Registration')}</span>
                  <span>·</span>
                  <span className="text-slate-600">{selectedRow.address || 'Awaiting GPS Fix'}</span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                <div className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-semibold ${
                  selectedRow.connectivity === 'ONLINE'
                    ? 'bg-cyan-50 border-cyan-200 text-cyan-800'
                    : 'bg-slate-100 border-slate-300 text-slate-700'
                }`}>
                  <span className={`h-2 w-2 rounded-full ${selectedRow.connectivity === 'ONLINE' ? 'bg-cyan-500 animate-pulse' : 'bg-slate-400'}`}></span>
                  {selectedRow.connectivity === 'ONLINE'
                    ? 'Live Physical Hardware: Active Telemetry'
                    : 'Physical Hardware: Standby / Offline'}
                </div>

                <button
                  type="button"
                  disabled={busyAction !== null}
                  title="Pause live telemetry updates to inspect readings steadily without auto-refresh"
                  onClick={() =>
                    handleSim(streamPaused ? 'RESUME_STREAM' : 'PAUSE_STREAM')
                  }
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white cursor-pointer whitespace-nowrap shadow-xs transition-colors ${
                    streamPaused ? 'bg-amber-600 hover:bg-amber-700' : 'bg-blue-600 hover:bg-blue-700'
                  }`}
                >
                  {streamPaused ? (
                    <>
                      <Play className="h-3.5 w-3.5" /> Resume Stream
                    </>
                  ) : (
                    <>
                      <Pause className="h-3.5 w-3.5" /> Pause Stream
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
                      : 'text-slate-600'
                  }`}
                >
                  {selectedRow.current_temp_c !== null && selectedRow.current_temp_c !== undefined
                    ? `${selectedRow.current_temp_c.toFixed(2)}°C`
                    : '--.-°C'}
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
                {selectedRow.security === 'OPEN' && (
                  <div className="mt-0.5 text-[10px] text-rose-600 font-sans">
                    {computeDoorDwellBudget(selectedRow)}
                  </div>
                )}
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
                  <span className="text-[10px] text-slate-400 font-sans">
                    {computeSensorDiagnosis(selectedRow).label}
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

            {/* Hardware Diagnostic & Action Twin */}
            <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="font-display text-sm font-bold text-slate-900">
                    Hardware Diagnostic &amp; Action Twin ({selectedRow.device_id})
                  </h3>
                  <p className="text-xs text-slate-500">
                    Real-time physical telemetry twin responding to compressor, door breach, and sensor simulation controls
                  </p>
                </div>
                <span className="font-mono text-xs font-semibold text-blue-700">
                  Diagnostic Mode · Rear Doors Preset
                </span>
              </div>

              <Viewport3D
                mode="diagnostic"
                telemetry={diagnosticTelemetry}
                heightClass="h-[360px]"
                onHardwareAction={(act) => handleSim(act as SimulationActionType)}
                onDoorClick={() => handleSim('DOOR_BREACH')}
              />
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
                <p className="text-xs text-blue-700 font-medium mt-0.5">
                  {historicalSummary}
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
                            {p.ambient_temp_c != null ? `${p.ambient_temp_c.toFixed(1)}°C` : '--'} · {p.humidity_pct != null ? `${p.humidity_pct.toFixed(0)}%` : '--'}
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
                            {p.speed_kmh != null ? `${p.speed_kmh.toFixed(1)} km/h` : '0.0 km/h'}
                          </td>
                          <td className="py-2.5 px-3 font-sans text-slate-700 max-w-[210px] truncate" title={p.address || 'Awaiting GPS Fix'}>
                            {p.address || 'Awaiting GPS Fix'}
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

      {/* Edit Hardware Modal */}
      {editModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
          aria-label={`Edit ${editTargetId} Configuration`}
        >
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div>
                <h3 className="font-display text-base font-bold text-slate-900">
                  Edit Vehicle Configuration
                </h3>
                <p className="text-[11px] font-mono text-blue-700">Target Callsign: {editTargetId}</p>
              </div>
              <button
                type="button"
                onClick={() => setEditModalOpen(false)}
                aria-label="Close edit modal"
                className="text-slate-400 hover:text-slate-900 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSubmitEdit} className="mt-4 space-y-3 text-xs">
              {editError && (
                <div className="rounded-lg border border-rose-300 bg-rose-50 p-2.5 text-rose-700">
                  {editError}
                </div>
              )}

              <div>
                <label className="mb-1 block text-slate-600 font-medium">Vehicle Name / Carrier Plate</label>
                <input
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-slate-900"
                />
              </div>

              <div>
                <label className="mb-1 block text-slate-600 font-medium">Cargo Classification</label>
                <input
                  required
                  value={editCargo}
                  onChange={(e) => setEditCargo(e.target.value)}
                  className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-slate-900"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-slate-600 font-medium">Min Temp Threshold (°C)</label>
                  <input
                    type="number"
                    step="0.1"
                    required
                    value={editMin}
                    onChange={(e) => setEditMin(e.target.value)}
                    className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 font-mono text-slate-900"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-slate-600 font-medium">Max Temp Threshold (°C)</label>
                  <input
                    type="number"
                    step="0.1"
                    required
                    value={editMax}
                    onChange={(e) => setEditMax(e.target.value)}
                    className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 font-mono text-slate-900"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-slate-600 font-medium">Hardware IMEI Serial</label>
                <input
                  required
                  value={editImei}
                  onChange={(e) => setEditImei(e.target.value)}
                  className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 font-mono text-slate-900"
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
                {onDeleteDevice ? (
                  confirmDelete ? (
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-semibold text-rose-700">Delete vehicle?</span>
                      <button
                        type="button"
                        onClick={() => handleDelete(editTargetId)}
                        disabled={isDeleting}
                        className="rounded-md bg-rose-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-rose-700 cursor-pointer disabled:opacity-50"
                      >
                        {isDeleting ? 'Deleting...' : 'Yes, Delete'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(false)}
                        className="rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(true)}
                      className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-50 hover:text-rose-700 cursor-pointer transition-colors"
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Delete Vehicle
                    </button>
                  )
                ) : (
                  <div />
                )}

                <div className="flex items-center gap-2 ml-auto">
                  <button
                    type="button"
                    onClick={() => setEditModalOpen(false)}
                    className="rounded-lg border border-slate-200 px-3.5 py-2 font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={editSubmitting}
                    className="rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-700 disabled:opacity-50 cursor-pointer"
                  >
                    {editSubmitting ? 'Saving Changes...' : 'Save Configuration'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
