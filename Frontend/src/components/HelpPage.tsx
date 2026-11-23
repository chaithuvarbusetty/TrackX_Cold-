import React, { useMemo, useState } from 'react';
import { ArrowRight, Search } from 'lucide-react';
import type { FleetTableRow, ModuleId } from '../shared/types';
import {
  TRANSPORT_THERMAL_STANDARDS,
  evaluateVehicleThermalFlow,
} from '../utils/thermalFlow';
import { CargoHeroBanner, VehicleCargoBadge } from './CargoShell';

interface HelpPageProps {
  fleetRows: FleetTableRow[];
  onInspectVehicleThermal: (deviceId: string) => void;
  onNavigateModule: (mod: ModuleId, openDetail?: boolean) => void;
}

const SYSTEM_PILLARS = [
  {
    title: '01. Continuous Real-Time Custody',
    summary:
      'Monitors every refrigerated vehicle at 1-second resolution over persistent WebSockets backed by indexed SQLite WAL storage, keeping dashboard reads under 3ms.',
  },
  {
    title: '02. Early Warning & Thermal Flowchart',
    summary:
      'Evaluates chamber temperature, door seal integrity, and predictive 30-minute drift per vehicle so operators catch warming or freeze risks before cargo spoils.',
  },
  {
    title: '03. Anytime Audit & Signal Telemetry',
    summary:
      'Retrieve historical sensor packets from any past timestamp, inspect 4G cellular signal strength (dBm / CSQ), and export RFC-4180 CSV custody logs for QA sign-off.',
  },
];

const TRANSPORT_LIFECYCLE = [
  {
    phase: 'Pre-Cool & Loading',
    maintain: '2.0°C - 5.0°C',
    warning: '≥ 6.0°C',
    critical: '< 2.0°C or > 8.0°C',
    detail: 'Pre-chill trailer 30 minutes prior to loading; keep bay door dwell ≤ 90 seconds.',
  },
  {
    phase: 'Active Highway Transit',
    maintain: '2.0°C - 8.0°C',
    warning: '≤ 2.6°C or ≥ 7.0°C',
    critical: '< 2.0°C or > 8.0°C',
    detail: 'Hold steady 4.0-5.0°C setpoint; trigger immediate alert on unscheduled seal break.',
  },
  {
    phase: 'Hub Checkpoint Dwell',
    maintain: '2.0°C - 7.5°C',
    warning: '≥ 6.8°C',
    critical: '> 8.0°C or Door > 90s',
    detail: 'Verify auxiliary compressor stays engaged while engine idles at hub stops.',
  },
  {
    phase: 'Unload & CSV Audit',
    maintain: '2.0°C - 8.0°C',
    warning: 'MKT > 6.5°C',
    critical: 'Cumulative Breach > 15m',
    detail: 'Download vehicle CSV telemetry history for WHO GDP / 21 CFR Part 11 release.',
  },
];

export const HelpPage: React.FC<HelpPageProps> = ({
  fleetRows,
  onInspectVehicleThermal,
  onNavigateModule,
}) => {
  const [materialSearch, setMaterialSearch] = useState('');

  const filteredStandards = useMemo(() => {
    const q = materialSearch.trim().toLowerCase();
    if (!q) return TRANSPORT_THERMAL_STANDARDS;
    return TRANSPORT_THERMAL_STANDARDS.filter(
      (s) =>
        s.cargo_class.toLowerCase().includes(q) ||
        s.protocol_note.toLowerCase().includes(q)
    );
  }, [materialSearch]);

  return (
    <div className="space-y-6">
      <CargoHeroBanner moduleId="help">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-5">
          <div className="max-w-3xl">
            <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
              System Purpose &amp; Cargo Temperature Guide
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              ColdChain Operations protects temperature-sensitive pharmaceuticals, biologics, vaccines, and clinical trial samples throughout road transport. Use this guide to understand system workflows and verify exact temperature bands required for every transported material.
            </p>
          </div>

          <button
            type="button"
            onClick={() => onNavigateModule('live-tracking')}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 cursor-pointer whitespace-nowrap shrink-0"
          >
            Return to Live Tracking <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-6 md:grid-cols-3">
          {SYSTEM_PILLARS.map((item) => (
            <div key={item.title} className="space-y-1.5">
              <h2 className="font-display text-sm font-semibold text-slate-900">
                {item.title}
              </h2>
              <p className="text-xs leading-relaxed text-slate-600">{item.summary}</p>
            </div>
          ))}
        </div>
      </CargoHeroBanner>

      {/* What Material Receives What Temperature */}
      <section className="surface-panel rounded-xl p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-lg font-semibold text-slate-900">
              Material Temperature Standards &amp; Critical Thresholds
            </h2>
            <p className="text-xs text-slate-500">
              Required whole-transport temperature range, warning pre-alerts, and critical excursion limits by cargo material
            </p>
          </div>

          <div className="relative min-w-[230px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={materialSearch}
              onChange={(e) => setMaterialSearch(e.target.value)}
              placeholder="Search material (e.g. mRNA, Insulin)..."
              className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-xs text-slate-900 placeholder:text-slate-400 outline-none focus:border-blue-600"
            />
          </div>
        </div>

        <div className="overflow-x-auto border-t border-slate-200 pt-3">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-[11px] font-semibold text-slate-500">
                <th className="py-2.5 pr-3">Material Transported</th>
                <th className="py-2.5 px-3">Required Temperature</th>
                <th className="py-2.5 px-3">Ideal Setpoint</th>
                <th className="py-2.5 px-3">Warning Threshold</th>
                <th className="py-2.5 px-3">Critical Breach Temp</th>
                <th className="py-2.5 px-3">Door &amp; Budget</th>
                <th className="py-2.5 pl-3 text-right">Active Vehicles</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {filteredStandards.map((std) => {
                const assigned = fleetRows.filter(
                  (r) => r.cargo_type === std.cargo_class
                );

                return (
                  <tr key={std.id} className="hover:bg-slate-50">
                    <td className="py-3 pr-3">
                      <VehicleCargoBadge
                        vehicleName={assigned[0]?.vehicle_name ?? ''}
                        cargoType={std.cargo_class}
                      />
                      <div className="mt-1 text-[11px] text-slate-500 max-w-xs">
                        {std.protocol_note}
                      </div>
                    </td>
                    <td className="py-3 px-3 font-mono font-semibold text-emerald-700 tabular-nums">
                      {std.maintain_min_c.toFixed(1)}°C – {std.maintain_max_c.toFixed(1)}°C
                    </td>
                    <td className="py-3 px-3 font-mono font-medium text-blue-700 tabular-nums">
                      {std.ideal_setpoint_c}
                    </td>
                    <td className="py-3 px-3 font-mono font-medium text-amber-600 tabular-nums">
                      ≤{std.warning_low_c.toFixed(1)}° / ≥{std.warning_high_c.toFixed(1)}°C
                    </td>
                    <td className="py-3 px-3 font-mono font-semibold text-rose-600 tabular-nums">
                      &lt;{std.critical_low_c.toFixed(1)}° / &gt;{std.critical_high_c.toFixed(1)}°C
                    </td>
                    <td className="py-3 px-3 font-mono text-[11px] text-slate-600 tabular-nums">
                      <div>Door ≤ {std.max_door_open_sec}s</div>
                      <div className="text-slate-400">Budget {std.excursion_budget_min}m</div>
                    </td>
                    <td className="py-3 pl-3 text-right">
                      {assigned.length === 0 ? (
                        <span className="text-slate-400">None assigned</span>
                      ) : (
                        <div className="flex flex-col items-end gap-1">
                          {assigned.map((u) => {
                            const ev = evaluateVehicleThermalFlow(u);
                            const btnCls =
                              ev.stage === 'CRITICAL'
                                ? 'border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100'
                                : ev.stage === 'WARNING'
                                  ? 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100'
                                  : ev.stage === 'OFFLINE'
                                    ? 'border-slate-200 bg-slate-100 text-slate-600 hover:bg-slate-200'
                                    : 'border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100';

                            return (
                              <button
                                key={u.device_id}
                                type="button"
                                onClick={() => onInspectVehicleThermal(u.device_id)}
                                className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 font-mono text-[11px] font-semibold cursor-pointer tabular-nums ${btnCls}`}
                              >
                                <span>{u.device_id}</span>
                                <span>{u.current_temp_c !== null && u.current_temp_c !== undefined ? `${u.current_temp_c.toFixed(2)}°C` : '--.-°C'}</span>
                                <span>({ev.stage})</span>
                                <ArrowRight className="h-3 w-3" />
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Stage-by-Stage Transport Compliance */}
      <section className="surface-panel rounded-xl p-6 space-y-4">
        <h2 className="font-display text-lg font-semibold text-slate-900">
          Stage-by-Stage Transport Compliance &amp; Signal Guide
        </h2>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4 text-xs">
          {TRANSPORT_LIFECYCLE.map((step) => (
            <div key={step.phase} className="surface-row rounded-lg p-4 space-y-2.5">
              <div className="font-display text-sm font-semibold text-blue-700">
                {step.phase}
              </div>
              <div className="space-y-1 font-mono text-[11px] tabular-nums">
                <div className="flex justify-between">
                  <span className="text-slate-500">Maintain</span>
                  <span className="text-emerald-700 font-semibold">{step.maintain}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Warning</span>
                  <span className="text-amber-600 font-semibold">{step.warning}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Critical</span>
                  <span className="text-rose-600 font-semibold">{step.critical}</span>
                </div>
              </div>
              <p className="border-t border-slate-200 pt-2 text-slate-600">
                {step.detail}
              </p>
            </div>
          ))}
        </div>

        <div className="border-t border-slate-200 pt-4 flex flex-wrap items-center justify-between gap-4 text-xs text-slate-600">
          <div>
            <span className="font-semibold text-slate-900">Signal Strength Scale:</span>{' '}
            Excellent (≥ -70 dBm) · Good (-71 to -82 dBm) · Fair (-83 to -92 dBm) · Weak (&lt; -92 dBm)
          </div>
          <div className="font-mono text-slate-500">
            Data retention: SQLite WAL indexed archive accessible anytime
          </div>
        </div>
      </section>
    </div>
  );
};
