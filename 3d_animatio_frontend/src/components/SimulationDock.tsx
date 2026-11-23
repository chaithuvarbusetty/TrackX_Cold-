import {
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  Pause,
  Play,
  RotateCcw,
  ShieldAlert,
  Snowflake,
} from 'lucide-react';
import {
  CARGO_PROFILES,
  type CargoProfileId,
  type TelemetryState,
  type TrafficDensity,
} from '../simulation/coldChainRules';
import type { CameraPresetId } from '../three/ColdChainTruckScene';

interface SimulationDockProps {
  telemetry: TelemetryState;
  cutawayEnabled: boolean;
  cameraPreset: CameraPresetId;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onToggleCutaway: () => void;
  onToggleVehicleMoving: () => void;
  onSelectTrafficDensity: (density: TrafficDensity) => void;
  onSelectCamera: (preset: CameraPresetId) => void;
  onSelectProfile: (profileId: CargoProfileId) => void;
  onSetTemperature: (tempC: number) => void;
  onTriggerFreezeDrop: () => void;
  onTriggerDoorTamper: () => void;
  onRestoreNormal: () => void;
}

export function SimulationDock({
  telemetry,
  cutawayEnabled,
  cameraPreset,
  collapsed,
  onToggleCollapse,
  onToggleCutaway,
  onToggleVehicleMoving,
  onSelectTrafficDensity,
  onSelectCamera,
  onSelectProfile,
  onSetTemperature,
  onTriggerFreezeDrop,
  onTriggerDoorTamper,
  onRestoreNormal,
}: SimulationDockProps) {
  const sliderMin = Number((telemetry.minCriticalC - 6).toFixed(1));
  const sliderMax = Number((telemetry.maxCriticalC + 8).toFixed(1));

  return (
    <div className="pointer-events-none absolute bottom-2.5 left-1/2 -translate-x-1/2 z-20 w-[min(540px,96%)] flex flex-col items-center">
      {/* Collapse / Expand Handle */}
      <button
        type="button"
        onClick={onToggleCollapse}
        aria-expanded={!collapsed}
        aria-label={collapsed ? 'Show Simulation Controls' : 'Hide Simulation Controls'}
        className="pointer-events-auto mb-1 inline-flex items-center gap-1.5 rounded-t-lg border border-slate-700/80 px-3 py-1 text-[11px] font-medium text-slate-100 hover:text-white transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-sky-400"
        style={{ backgroundColor: 'rgba(15, 23, 42, 0.92)' }}
      >
        {collapsed ? (
          <>
            <ChevronUp className="w-3.5 h-3.5" />
            <span>Show Controls</span>
          </>
        ) : (
          <>
            <ChevronDown className="w-3.5 h-3.5" />
            <span>Hide Controls</span>
          </>
        )}
      </button>

      {!collapsed && (
        <div
          className="pointer-events-auto w-full rounded-xl border border-slate-700/80 px-3 py-2.5 text-slate-100 shadow-lg space-y-2"
          style={{ backgroundColor: 'rgba(15, 23, 42, 0.94)' }}
        >
          {/* Row 1: Vehicle Motion + Traffic Density + Cutaway + Profile */}
          <div className="flex flex-wrap items-center justify-between gap-1.5 pb-1.5 border-b border-slate-700/70">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={onToggleVehicleMoving}
                className={`inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold rounded-lg transition-colors whitespace-nowrap ${
                  telemetry.vehicleMoving
                    ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                    : 'bg-amber-600 hover:bg-amber-500 text-white'
                }`}
              >
                {telemetry.vehicleMoving ? (
                  <>
                    <Pause className="w-3 h-3" />
                    <span>Driving</span>
                  </>
                ) : (
                  <>
                    <Play className="w-3 h-3" />
                    <span>Paused</span>
                  </>
                )}
              </button>

              <label htmlFor="dock-traffic-select" className="sr-only">
                Road Traffic Density
              </label>
              <select
                id="dock-traffic-select"
                value={telemetry.trafficDensity}
                onChange={(e) => onSelectTrafficDensity(e.target.value as TrafficDensity)}
                className="rounded-lg bg-slate-800 border border-slate-600 px-1.5 py-1 text-[11px] font-medium text-slate-100 focus-visible:outline-2 focus-visible:outline-sky-400"
              >
                <option value="light">Light Traffic</option>
                <option value="moderate">Moderate Traffic</option>
                <option value="heavy">Heavy Traffic</option>
              </select>
            </div>

            <div className="flex items-center gap-1.5 max-w-full">
              <button
                type="button"
                onClick={onToggleCutaway}
                className={`inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-lg border transition-colors whitespace-nowrap ${
                  cutawayEnabled
                    ? 'bg-sky-600/20 border-sky-400/50 text-sky-200'
                    : 'bg-slate-800 border-slate-600 text-slate-200 hover:bg-slate-700'
                }`}
              >
                {cutawayEnabled ? (
                  <Eye className="w-3 h-3" />
                ) : (
                  <EyeOff className="w-3 h-3" />
                )}
                <span>{cutawayEnabled ? 'Cutaway' : 'Solid'}</span>
              </button>

              <label className="sr-only" htmlFor="cargo-profile-select">
                Cargo Cold-Chain Profile
              </label>
              <select
                id="cargo-profile-select"
                value={telemetry.profileId}
                onChange={(e) => onSelectProfile(e.target.value as CargoProfileId)}
                className="max-w-[168px] rounded-lg bg-slate-800 border border-slate-600 px-1.5 py-1 text-[11px] font-medium text-slate-100 focus-visible:outline-2 focus-visible:outline-sky-400"
              >
                {Object.values(CARGO_PROFILES).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Row 2: Camera Presets + Temp Slider */}
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-1 bg-slate-800/90 p-1 rounded-lg max-w-full">
              {(
                [
                  { id: 'overview', label: 'Overview' },
                  { id: 'node', label: 'Node CN-04' },
                  { id: 'cabin', label: 'Cabin GW-01' },
                  { id: 'doors', label: 'Rear Doors' },
                ] as const
              ).map((cam) => (
                <button
                  key={cam.id}
                  type="button"
                  onClick={() => onSelectCamera(cam.id)}
                  className={`flex-1 px-2 py-1 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap ${
                    cameraPreset === cam.id
                      ? 'bg-sky-600 text-white'
                      : 'text-slate-300 hover:text-white hover:bg-slate-700/70'
                  }`}
                >
                  {cam.label}
                </button>
              ))}
            </div>

            <div>
              <div className="flex items-center justify-between text-[11px] mb-1">
                <label
                  htmlFor="container-temp-slider"
                  className="font-medium text-slate-300"
                >
                  {telemetry.callsign} · CN-04 Temp
                </label>
                <span className="font-mono-tabular font-semibold text-white">
                  {telemetry.temperatureC.toFixed(1)}°C{' '}
                  <span className="text-slate-400 font-normal">
                    (&lt;{telemetry.minCriticalC.toFixed(1)}°C critical)
                  </span>
                </span>
              </div>
              <input
                id="container-temp-slider"
                type="range"
                min={sliderMin}
                max={sliderMax}
                step={0.2}
                value={telemetry.temperatureC}
                onChange={(e) => onSetTemperature(parseFloat(e.target.value))}
                className="w-full h-2 rounded-lg appearance-none cursor-pointer bg-slate-700 accent-sky-500"
              />
            </div>
          </div>

          {/* Row 3: Fault Simulation Triggers */}
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            <button
              type="button"
              onClick={onTriggerFreezeDrop}
              className="flex-1 inline-flex items-center justify-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-sky-600 hover:bg-sky-500 text-white transition-colors whitespace-nowrap"
            >
              <Snowflake className="w-3.5 h-3.5 shrink-0" />
              <span>Freeze (&lt;{telemetry.minCriticalC}°C)</span>
            </button>

            <button
              type="button"
              onClick={onTriggerDoorTamper}
              className="flex-1 inline-flex items-center justify-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-red-600 hover:bg-red-500 text-white transition-colors whitespace-nowrap"
            >
              <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
              <span>Door Tamper</span>
            </button>

            <button
              type="button"
              onClick={onRestoreNormal}
              className="inline-flex items-center justify-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-200 transition-colors whitespace-nowrap"
            >
              <RotateCcw className="w-3.5 h-3.5 shrink-0" />
              <span>Reset</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
