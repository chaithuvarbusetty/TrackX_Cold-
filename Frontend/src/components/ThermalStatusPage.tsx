import React, { useMemo } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  ShieldAlert,
  WifiOff,
} from 'lucide-react';
import type {
  FleetOverviewPayload,
  FleetTableRow,
  ModuleId,
  TemperatureForecast,
} from '../shared/types';
import { evaluateVehicleThermalFlow } from '../utils/thermalFlow';
import { CargoHeroBanner, VehicleCargoBadge } from './CargoShell';
import { AiForecastChart, Temp24hChart } from './RealtimeCharts';
import { Viewport3D } from './LazyViewport3D';

interface ThermalStatusPageProps {
  overview: FleetOverviewPayload;
  selectedDeviceId: string;
  onSelectDevice: (deviceId: string) => void;
  onNavigateModule: (mod: ModuleId, openDetail?: boolean) => void;
  onExportCsv: (deviceId: string) => void;
  forecast: TemperatureForecast;
}

export const ThermalStatusPage: React.FC<ThermalStatusPageProps> = ({
  overview,
  selectedDeviceId,
  onSelectDevice,
  onNavigateModule,
  onExportCsv,
  forecast,
}) => {
  const { fleet_table, temperature_trend_24h, total_db_rows } = overview;
  const activeIdx = Math.max(
    0,
    fleet_table.findIndex((r) => r.device_id === selectedDeviceId)
  );
  const currentRow: FleetTableRow | undefined =
    fleet_table[activeIdx] ?? fleet_table[0];

  if (!currentRow) {
    return (
      <div className="surface-panel rounded-xl p-8 text-center text-sm text-slate-600">
        No fleet units available for thermal evaluation.
      </div>
    );
  }

  const evalResult = evaluateVehicleThermalFlow(currentRow);
  const stage = evalResult.stage;

  const thermalTelemetry = useMemo(() => {
    const rawTemp = currentRow.current_temp_c;
    const temp =
      rawTemp !== null && rawTemp !== undefined && !isNaN(Number(rawTemp))
        ? Number(rawTemp)
        : 29.0;
    const minT = evalResult.criticalLowC ?? 2.0;
    const maxT = evalResult.criticalHighC ?? 8.0;
    const tempBand =
      temp > maxT ? 'above_critical' : temp < minT ? 'below_critical' : 'optimal';
    const isAlert =
      stage === 'CRITICAL' ||
      temp > maxT ||
      temp < minT ||
      currentRow.security === 'OPEN';
    return {
      callsign: currentRow.device_id,
      temperatureC: temp,
      tempBand: tempBand as 'optimal' | 'above_critical' | 'below_critical',
      doorState: (currentRow.security === 'OPEN' ? 'open' : 'closed') as 'open' | 'closed',
      compressorActive: currentRow.compressor_active ?? true,
      speedKmh: currentRow.speed_kmh != null ? Number(currentRow.speed_kmh) : 0,
      vehicleMoving: (currentRow.speed_kmh ?? 0) > 1.0,
      isAlertActive: isAlert,
      isDoorTampered: currentRow.security === 'OPEN',
      accentHex: 0x0d9488,
      cutawayEnabled: true,
      cameraPreset: 'node' as const,
    };
  }, [currentRow, evalResult, stage]);

  const warningOrCriticalUnits = fleet_table.filter((r) => {
    const ev = evaluateVehicleThermalFlow(r);
    return ev.stage === 'WARNING' || ev.stage === 'CRITICAL';
  });

  const handlePrev = () => {
    const nextIdx = (activeIdx - 1 + fleet_table.length) % fleet_table.length;
    onSelectDevice(fleet_table[nextIdx].device_id);
  };

  const handleNext = () => {
    const nextIdx = (activeIdx + 1) % fleet_table.length;
    onSelectDevice(fleet_table[nextIdx].device_id);
  };

  return (
    <div className="space-y-6">
      <CargoHeroBanner moduleId="thermal-status">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">
                Vehicle Thermal Status
              </h1>
              <span className="font-mono text-xs font-medium text-slate-500 tabular-nums">
                Page {activeIdx + 1} of {fleet_table.length}
              </span>
            </div>
            <p className="mt-1 text-sm text-slate-600">
              Individual thermal decision flowchart per vehicle to isolate chamber warnings, critical excursions, and compressor performance.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {warningOrCriticalUnits.length > 0 && (
              <button
                type="button"
                onClick={() => onSelectDevice(warningOrCriticalUnits[0].device_id)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-2 text-xs font-semibold text-amber-800 hover:bg-amber-100 cursor-pointer whitespace-nowrap shrink-0"
              >
                <AlertTriangle className="h-3.5 w-3.5" />
                Focus Warning ({warningOrCriticalUnits.length})
              </button>
            )}
            <button
              type="button"
              onClick={handlePrev}
              aria-label="Previous vehicle page"
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer whitespace-nowrap shrink-0"
            >
              <ChevronLeft className="h-3.5 w-3.5" /> Prev
            </button>
            <button
              type="button"
              onClick={handleNext}
              aria-label="Next vehicle page"
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer whitespace-nowrap shrink-0"
            >
              Next <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Vehicle Page Selector Strip */}
        <div
          role="tablist"
          aria-label="Vehicle thermal status pages"
          className={`mt-5 grid grid-cols-1 gap-3 ${fleet_table.length === 1 ? 'sm:grid-cols-1 max-w-sm' : fleet_table.length === 2 ? 'sm:grid-cols-2 max-w-2xl' : 'sm:grid-cols-3'}`}
        >
          {fleet_table.map((row, idx) => {
            const ev = evaluateVehicleThermalFlow(row);
            const isSelected = row.device_id === currentRow.device_id;
            const isReal = row.device_id === 'GW-001';
            const hasTemp = row.current_temp_c !== null && row.current_temp_c !== undefined && !isNaN(row.current_temp_c);
            const stageColor =
              ev.stage === 'CRITICAL'
                ? 'text-rose-600'
                : ev.stage === 'WARNING'
                  ? 'text-amber-600'
                  : ev.stage === 'OFFLINE'
                    ? 'text-slate-500'
                    : 'text-emerald-700';

            return (
              <button
                key={row.device_id}
                type="button"
                role="tab"
                aria-selected={isSelected}
                onClick={() => onSelectDevice(row.device_id)}
                className={`rounded-lg border px-3.5 py-3 text-left transition-colors cursor-pointer ${
                  isSelected
                    ? 'border-blue-600 bg-blue-50/90 shadow-xs'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                <div className="flex items-center justify-between font-mono text-[11px]">
                  <div className="flex items-center gap-1.5">
                    <span className="font-bold text-slate-900">{row.device_id}</span>
                    {isReal && row.connectivity === 'ONLINE' && (
                      <span className="rounded bg-cyan-100 px-1 py-0.2 text-[9px] font-bold text-cyan-800 border border-cyan-300">
                        LIVE IOT
                      </span>
                    )}
                  </div>
                  <span className="text-slate-400">Unit {idx + 1} of {fleet_table.length}</span>
                </div>
                <div className="mt-1 font-mono text-base font-bold text-slate-900 tabular-nums">
                  {hasTemp ? `${row.current_temp_c!.toFixed(2)}°C` : '--.-°C (Standby)'}
                </div>
                <div className={`mt-1 font-mono text-[11px] font-semibold ${stageColor}`}>
                  {isReal && !hasTemp ? 'PROBE STANDBY (NULL)' : ev.stage}
                </div>
              </button>
            );
          })}
        </div>
      </CargoHeroBanner>

      {/* Main Flowchart Canvas */}
      <section className="surface-panel rounded-xl p-6 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-mono text-lg font-bold text-blue-700">
                {currentRow.device_id}
              </span>
              <span className="font-display text-lg font-semibold text-slate-900">
                {currentRow.vehicle_name}
              </span>
              <VehicleCargoBadge
                vehicleName={currentRow.vehicle_name}
                cargoType={currentRow.cargo_type}
                compact
              />
              <span
                className={`font-mono text-xs font-bold ${
                  stage === 'CRITICAL'
                    ? 'text-rose-600'
                    : stage === 'WARNING'
                      ? 'text-amber-600'
                      : stage === 'OFFLINE'
                        ? 'text-slate-500'
                        : 'text-emerald-700'
                }`}
              >
                Status: {stage}
              </span>
            </div>
            <p className="text-xs text-slate-600">{evalResult.reason}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onExportCsv(currentRow.device_id)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer whitespace-nowrap shrink-0"
            >
              <Download className="h-3.5 w-3.5" /> Export {currentRow.device_id} CSV
            </button>
            <button
              type="button"
              onClick={() => onNavigateModule('help')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer whitespace-nowrap shrink-0"
            >
              Material Temp Standards
            </button>
            <button
              type="button"
              onClick={() => onNavigateModule('vehicle-readings', true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-700 cursor-pointer whitespace-nowrap shrink-0"
            >
              Open {currentRow.device_id} Status
            </button>
          </div>
        </div>

        {/* 3-Step Horizontal Input Pipeline */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-11 items-center">
          <div className="surface-row rounded-lg p-4 lg:col-span-3">
            <div className="text-xs font-semibold text-blue-700">
              1. Cargo Transport Target
            </div>
            <div className="mt-1.5">
              <VehicleCargoBadge
                vehicleName={currentRow.vehicle_name}
                cargoType={currentRow.cargo_type}
              />
            </div>
            <div className="mt-3 flex items-center justify-between font-mono text-xs tabular-nums border-t border-slate-200 pt-2.5">
              <div>
                <div className="text-[11px] text-slate-500">Maintain</div>
                <div className="font-semibold text-emerald-700">
                  {evalResult.criticalLowC.toFixed(1)}–{evalResult.criticalHighC.toFixed(1)}°C
                </div>
              </div>
              <div className="text-right">
                <div className="text-[11px] text-slate-500">Warn At</div>
                <div className="font-semibold text-amber-600">
                  ≥{evalResult.warningHighC.toFixed(1)}°C
                </div>
              </div>
            </div>
          </div>

          <div className="hidden lg:flex justify-center lg:col-span-1">
            <svg width="44" height="24" viewBox="0 0 44 24" aria-hidden="true">
              <line x1="2" y1="12" x2="36" y2="12" stroke="#2563eb" strokeWidth="2" />
              <polygon points="35,7 43,12 35,17" fill="#2563eb" />
            </svg>
          </div>

          <div className="surface-row rounded-lg p-4 lg:col-span-3">
            <div className="text-xs font-semibold text-blue-700">
              2. Live Chamber Reading
            </div>
            <div className="mt-1 flex items-baseline gap-2.5 font-mono tabular-nums">
              <span className="text-2xl font-bold text-slate-900">
                {currentRow.current_temp_c !== null && currentRow.current_temp_c !== undefined
                  ? `${currentRow.current_temp_c.toFixed(2)}°C`
                  : '--.-°C'}
              </span>
              {currentRow.current_temp_c === null ? (
                <span className="text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded">
                  Probe Standby / Unlinked
                </span>
              ) : (
                <span className="text-xs text-slate-500">
                  {forecast.rate_c_per_min >= 0 ? '+' : ''}
                  {forecast.rate_c_per_min.toFixed(3)}°/min
                </span>
              )}
            </div>
            <div className="mt-3 flex items-center justify-between font-mono text-xs text-slate-600 border-t border-slate-200 pt-2.5">
              <span>Door: {currentRow.security}</span>
              <span>Cooling: {currentRow.compressor_active ? 'Active' : 'Standby'}</span>
            </div>
          </div>

          <div className="hidden lg:flex justify-center lg:col-span-1">
            <svg width="44" height="24" viewBox="0 0 44 24" aria-hidden="true">
              <line x1="2" y1="12" x2="36" y2="12" stroke="#2563eb" strokeWidth="2" />
              <polygon points="35,7 43,12 35,17" fill="#2563eb" />
            </svg>
          </div>

          <div className="surface-row rounded-lg p-4 lg:col-span-3">
            <div className="text-xs font-semibold text-blue-700">
              3. Threshold Decision Gate
            </div>
            <div className="mt-1 text-sm font-semibold text-slate-900">
              Limits, Drift &amp; Seal Check
            </div>
            <div className="mt-3 space-y-1 font-mono text-xs tabular-nums border-t border-slate-200 pt-2.5">
              <div className="flex justify-between">
                <span className="text-slate-500">Critical Limits</span>
                <span className="font-semibold text-rose-600">
                  &lt;{evalResult.criticalLowC.toFixed(1)}° or &gt;{evalResult.criticalHighC.toFixed(1)}°
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">+30m Forecast</span>
                <span className="font-semibold text-blue-700">
                  {forecast.predicted_30m_c !== null
                    ? `${forecast.predicted_30m_c.toFixed(2)}°C`
                    : 'Calibrating'}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Flowchart Branch Lines */}
        <div className="hidden lg:block px-12">
          <svg viewBox="0 0 900 44" className="h-11 w-full" aria-hidden="true">
            <line x1="450" y1="0" x2="450" y2="16" stroke="#94a3b8" strokeWidth="2" />
            <line x1="150" y1="16" x2="750" y2="16" stroke="#cbd5e1" strokeWidth="2" />

            <line
              x1="150"
              y1="16"
              x2="150"
              y2="40"
              stroke={stage === 'OPTIMAL' ? '#059669' : '#cbd5e1'}
              strokeWidth={stage === 'OPTIMAL' ? '3' : '1.5'}
            />
            <polygon
              points="145,35 150,43 155,35"
              fill={stage === 'OPTIMAL' ? '#059669' : '#cbd5e1'}
            />

            <line
              x1="450"
              y1="16"
              x2="450"
              y2="40"
              stroke={stage === 'WARNING' ? '#d97706' : '#cbd5e1'}
              strokeWidth={stage === 'WARNING' ? '3' : '1.5'}
            />
            <polygon
              points="445,35 450,43 455,35"
              fill={stage === 'WARNING' ? '#d97706' : '#cbd5e1'}
            />

            <line
              x1="750"
              y1="16"
              x2="750"
              y2="40"
              stroke={stage === 'CRITICAL' || stage === 'OFFLINE' ? '#e11d48' : '#cbd5e1'}
              strokeWidth={stage === 'CRITICAL' || stage === 'OFFLINE' ? '3' : '1.5'}
            />
            <polygon
              points="745,35 750,43 755,35"
              fill={stage === 'CRITICAL' || stage === 'OFFLINE' ? '#e11d48' : '#cbd5e1'}
            />
          </svg>
        </div>

        {/* 3 Outcome Path Cards */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div
            className={`rounded-lg border p-4 transition-opacity ${
              stage === 'OPTIMAL'
                ? 'border-emerald-400 bg-emerald-50/90'
                : 'border-slate-200 bg-slate-50 opacity-55'
            }`}
          >
            <div className="flex items-center justify-between text-xs font-bold text-emerald-700">
              <span className="inline-flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4" /> Optimal Transport
              </span>
              {stage === 'OPTIMAL' && <span>ACTIVE</span>}
            </div>
            <div className="mt-2 font-mono text-xs text-slate-800 tabular-nums">
              {evalResult.warningLowC.toFixed(1)}°C – {evalResult.warningHighC.toFixed(1)}°C · Door Sealed
            </div>
            <p className="mt-1.5 text-xs text-slate-600">
              {stage === 'OPTIMAL'
                ? evalResult.mitigation
                : 'Chamber remains well inside GDP temperature band.'}
            </p>
          </div>

          <div
            className={`rounded-lg border p-4 transition-opacity ${
              stage === 'WARNING'
                ? 'border-amber-400 bg-amber-50/95'
                : 'border-slate-200 bg-slate-50 opacity-55'
            }`}
          >
            <div className="flex items-center justify-between text-xs font-bold text-amber-700">
              <span className="inline-flex items-center gap-1.5">
                <AlertTriangle className="h-4 w-4" /> Thermal Warning
              </span>
              {stage === 'WARNING' && <span>ACTIVE</span>}
            </div>
            <div className="mt-2 font-mono text-xs text-slate-800 tabular-nums">
              ≤{evalResult.warningLowC.toFixed(1)}°C or ≥{evalResult.warningHighC.toFixed(1)}°C · Drift Alert
            </div>
            <p className="mt-1.5 text-xs text-slate-600">
              {stage === 'WARNING'
                ? evalResult.mitigation
                : 'Pre-breach drift detected prior to critical threshold.'}
            </p>
          </div>

          <div
            className={`rounded-lg border p-4 transition-opacity ${
              stage === 'CRITICAL' || stage === 'OFFLINE'
                ? 'border-rose-400 bg-rose-50/95'
                : 'border-slate-200 bg-slate-50 opacity-55'
            }`}
          >
            <div className="flex items-center justify-between text-xs font-bold text-rose-700">
              <span className="inline-flex items-center gap-1.5">
                {stage === 'OFFLINE' ? (
                  <WifiOff className="h-4 w-4" />
                ) : (
                  <ShieldAlert className="h-4 w-4" />
                )}
                {stage === 'OFFLINE' ? 'Signal Offline' : 'Critical Excursion'}
              </span>
              {(stage === 'CRITICAL' || stage === 'OFFLINE') && <span>ACTIVE</span>}
            </div>
            <div className="mt-2 font-mono text-xs text-slate-800 tabular-nums">
              &lt;{evalResult.criticalLowC.toFixed(1)}°C or &gt;{evalResult.criticalHighC.toFixed(1)}°C · Door Open
            </div>
            <p className="mt-1.5 text-xs text-slate-600">
              {stage === 'CRITICAL' || stage === 'OFFLINE'
                ? evalResult.mitigation
                : 'Immediate alert escalation and CSV audit preservation.'}
            </p>
          </div>
        </div>

        {/* 3D Cutaway Chamber & Sensor Probe Node Twin */}
        <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-display text-sm font-bold text-slate-900">
                Chamber Internal Cutaway &amp; Telemetry Node Twin ({currentRow.device_id})
              </h3>
              <p className="text-xs text-slate-500">
                Direct view into refrigerated hold with real-time temperature illumination and wireless node beacon
              </p>
            </div>
            <span className="font-mono text-xs font-semibold text-blue-700">
              Cutaway Mode Active · Node Preset
            </span>
          </div>

          <Viewport3D
            mode="thermal"
            telemetry={thermalTelemetry}
            heightClass="h-[360px]"
            showCutawayToggle={true}
          />
        </div>
      </section>

      {/* Bottom Row: 24h Thermal Envelope + AI Forecast */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="surface-panel rounded-xl p-5 lg:col-span-7">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="font-display text-base font-semibold text-slate-900">
                24-Hour Fleet Thermal Envelope
              </h2>
              <p className="text-xs text-slate-500">
                Aggregated across {total_db_rows.toLocaleString()} stored telemetry packets
              </p>
            </div>
            <span className="font-mono text-xs font-semibold text-emerald-700">
              2.0–8.0°C Band
            </span>
          </div>
          <Temp24hChart data={temperature_trend_24h} />
        </div>

        <div className="surface-panel rounded-xl p-5 lg:col-span-5 flex flex-col justify-between">
          <div>
            <div className="mb-2 flex items-center justify-between">
              <div>
                <h2 className="font-display text-base font-semibold text-slate-900">
                  Predictive Excursion Horizon
                </h2>
                <p className="text-xs text-slate-500">
                  Projection for {currentRow.device_id}
                </p>
              </div>
              <span
                className={`font-mono text-xs font-bold ${
                  forecast.risk_level === 'HIGH'
                    ? 'text-rose-600'
                    : forecast.risk_level === 'MODERATE'
                      ? 'text-amber-600'
                      : 'text-emerald-700'
                }`}
              >
                {forecast.risk_level} ({forecast.excursion_risk_pct}%)
              </span>
            </div>
            <AiForecastChart
              recentTemps={(currentRow.history_temps || []).filter((t): t is number => t !== null && !isNaN(t))}
              forecast={forecast}
              targetMaxC={currentRow.target_max_c}
            />
          </div>

          <div className="mt-3 grid grid-cols-3 gap-4 border-t border-slate-200 pt-3 font-mono text-xs tabular-nums">
            <div>
              <div className="text-[11px] text-slate-500">+15 min</div>
              <div className="font-bold text-slate-900">
                {forecast.predicted_15m_c !== null ? `${forecast.predicted_15m_c.toFixed(2)}°C` : '--'}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-slate-500">+30 min</div>
              <div className="font-bold text-blue-700">
                {forecast.predicted_30m_c !== null ? `${forecast.predicted_30m_c.toFixed(2)}°C` : '--'}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-slate-500">Slope</div>
              <div className="font-bold text-slate-900">
                {forecast.rate_c_per_min >= 0 ? '+' : ''}
                {forecast.rate_c_per_min.toFixed(3)}°/m
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};
