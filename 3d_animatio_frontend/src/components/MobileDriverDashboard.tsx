import {
  AlertOctagon,
  BatteryCharging,
  CheckCircle2,
  DoorClosed,
  DoorOpen,
  Lock,
  LockOpen,
  Radio,
  ShieldAlert,
  Snowflake,
  Thermometer,
  Volume2,
  VolumeX,
} from 'lucide-react';
import {
  CARGO_PROFILES,
  COLD_CHAIN_ROUTES,
  formatRssiQuality,
  type ColdChainAlert,
  type TelemetryEvaluation,
  type TelemetryState,
} from '../simulation/coldChainRules';

interface MobileDriverDashboardProps {
  telemetry: TelemetryState;
  evaluation: TelemetryEvaluation;
  alerts: ColdChainAlert[];
  soundMuted: boolean;
  onToggleSound: () => void;
  onAcknowledgeAlert: (id: string) => void;
  onAcknowledgeAll: () => void;
  onCloseAndSealDoor: () => void;
  onToggleTransitArm: () => void;
  onTriggerFreezeDrop?: () => void;
  onTriggerDoorTamper?: () => void;
  onRestoreNormal?: () => void;
  compactControls?: boolean;
}

function formatTime(tsMs: number): string {
  const d = new Date(tsMs);
  return d.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function MobileDriverDashboard({
  telemetry,
  evaluation,
  alerts,
  soundMuted,
  onToggleSound,
  onAcknowledgeAlert,
  onAcknowledgeAll,
  onCloseAndSealDoor,
  onToggleTransitArm,
  onTriggerFreezeDrop,
  onTriggerDoorTamper,
  onRestoreNormal,
  compactControls = false,
}: MobileDriverDashboardProps) {
  const profile = CARGO_PROFILES[telemetry.profileId];
  const activeRoute = COLD_CHAIN_ROUTES[telemetry.routeId];
  const rssi = formatRssiQuality(telemetry.gatewayRssiDbm);
  const vehicleAlerts = alerts.filter(
    (a) => !a.vehicleId || a.vehicleId === telemetry.vehicleId
  );
  const unacknowledged = vehicleAlerts.filter((a) => !a.acknowledged);

  // Gauge normalized position (with visual margin outside min..max)
  const gaugeMin = telemetry.minCriticalC - 4;
  const gaugeMax = telemetry.maxCriticalC + 4;
  const markerPct = Math.max(
    2,
    Math.min(
      98,
      ((telemetry.temperatureC - gaugeMin) / (gaugeMax - gaugeMin)) * 100
    )
  );
  const safeStartPct =
    ((telemetry.minCriticalC - gaugeMin) / (gaugeMax - gaugeMin)) * 100;
  const safeWidthPct =
    ((telemetry.maxCriticalC - telemetry.minCriticalC) / (gaugeMax - gaugeMin)) *
    100;

  const isBelow = evaluation.tempBand === 'below_critical';
  const isAbove = evaluation.tempBand === 'above_critical';

  return (
    <div
      className="flex flex-col h-full bg-slate-950 text-slate-100 select-none"
      data-testid="mobile-driver-dashboard"
      data-alert-status={evaluation.overallStatus}
    >
      {/* Driver Cabin Mobile App Header */}
      <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-slate-800 shrink-0 bg-slate-900/90">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Radio className="w-4 h-4 text-sky-400 shrink-0" />
            <h2 className="font-display text-sm font-bold text-white truncate">
              {telemetry.callsign} · Driver Terminal
            </h2>
          </div>
          <p className="text-[11px] text-slate-400 truncate mt-0.5">
            GW-01 · {telemetry.speedKmh} km/h · {activeRoute.highwayLabel}
          </p>
          <p className="text-[10px] text-slate-500 truncate">
            {profile.cargoSummary}
          </p>
        </div>

        <button
          type="button"
          onClick={onToggleSound}
          aria-label={soundMuted ? 'Unmute alert chime' : 'Mute alert chime'}
          className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 transition-colors shrink-0"
        >
          {soundMuted ? (
            <VolumeX className="w-4 h-4 text-slate-400" />
          ) : (
            <Volume2 className="w-4 h-4 text-sky-400" />
          )}
        </button>
      </div>

      {/* Scrollable Mobile Content */}
      <div className="flex-1 overflow-y-auto thin-scroll p-4 space-y-4">
        {/* IMMEDIATE REAL-TIME DRIVER NOTIFICATION BANNER */}
        {(evaluation.isTempCritical || evaluation.isDoorTampered) && (
          <div
            role="alert"
            data-testid="driver-critical-banner"
            className="rounded-2xl border border-red-400/60 bg-red-950/90 p-3.5 shadow-lg"
          >
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-xl bg-red-600 text-white shrink-0">
                {evaluation.isDoorTampered ? (
                  <ShieldAlert className="w-5 h-5" />
                ) : isBelow ? (
                  <Snowflake className="w-5 h-5" />
                ) : (
                  <AlertOctagon className="w-5 h-5" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold tracking-wide text-red-200 uppercase">
                    Immediate Driver Notification
                  </span>
                  <span className="font-mono-tabular text-[11px] text-red-300">
                    LIVE
                  </span>
                </div>

                {evaluation.isDoorTampered && (
                  <div className="mt-1.5">
                    <p className="text-sm font-bold text-white">
                      Door Tamper Detected — Rear Bay Unsealed
                    </p>
                    <p className="text-xs text-red-200 mt-0.5 leading-relaxed">
                      Reed sensor DR-01 opened unexpectedly while transit lock is armed. Pull over safely and verify cargo seal.
                    </p>
                  </div>
                )}

                {evaluation.isTempCritical && (
                  <div className={evaluation.isDoorTampered ? 'mt-2.5 pt-2.5 border-t border-red-800/80' : 'mt-1.5'}>
                    <p className="text-sm font-bold text-white">
                      {isBelow
                        ? 'Critical Low Temperature Excursion'
                        : 'Critical High Temperature Excursion'}
                    </p>
                    <p className="text-xs text-red-200 mt-0.5 leading-relaxed">
                      Node CN-04 reads{' '}
                      <span className="font-mono-tabular font-bold text-white">
                        {telemetry.temperatureC.toFixed(1)}°C
                      </span>{' '}
                      ({isBelow
                        ? `below ${telemetry.minCriticalC.toFixed(1)}°C min threshold`
                        : `above ${telemetry.maxCriticalC.toFixed(1)}°C max threshold`}
                      ).
                    </p>
                  </div>
                )}

                <div className="mt-3 flex flex-wrap gap-2">
                  {unacknowledged.length > 0 && (
                    <button
                      type="button"
                      onClick={onAcknowledgeAll}
                      className="min-h-[44px] flex-1 px-3.5 py-2 rounded-xl bg-white text-red-950 font-semibold text-xs hover:bg-red-50 transition-colors whitespace-nowrap"
                    >
                      Acknowledge Alert ({unacknowledged.length})
                    </button>
                  )}
                  {evaluation.isDoorTampered && (
                    <button
                      type="button"
                      onClick={onCloseAndSealDoor}
                      className="min-h-[44px] px-3.5 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white font-semibold text-xs transition-colors whitespace-nowrap"
                    >
                      Close & Reseal Door
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Primary Card: Real-Time Container Temperature & Critical Threshold Gauge */}
        <section className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-medium text-slate-300">
              <Thermometer className="w-4 h-4 text-sky-400" />
              <span>Container Cargo Temp</span>
            </div>
            <span
              data-testid="temp-band-label"
              className={`text-xs font-semibold ${
                isBelow || isAbove
                  ? 'text-red-400'
                  : evaluation.tempBand === 'near_low' ||
                    evaluation.tempBand === 'near_high'
                  ? 'text-amber-400'
                  : 'text-emerald-400'
              }`}
            >
              {isBelow
                ? 'BELOW CRITICAL MIN'
                : isAbove
                ? 'ABOVE CRITICAL MAX'
                : evaluation.tempBand === 'near_low' ||
                  evaluation.tempBand === 'near_high'
                ? 'NEAR THRESHOLD'
                : 'WITHIN SPEC'}
            </span>
          </div>

          <div className="mt-3 flex items-baseline justify-between gap-3">
            <div
              data-testid="driver-temp-readout"
              className={`font-mono-tabular text-4xl font-bold tracking-tight ${
                isBelow
                  ? 'text-sky-300'
                  : isAbove
                  ? 'text-red-400'
                  : 'text-white'
              }`}
            >
              {telemetry.temperatureC.toFixed(1)}°C
            </div>

            <div className="text-right text-xs text-slate-400 space-y-0.5">
              <div className="font-mono-tabular">
                Target {telemetry.targetTempC.toFixed(1)}°C
              </div>
              <div className="font-mono-tabular">
                Humidity {telemetry.humidityPct.toFixed(0)}% ·{' '}
                {telemetry.compressorActive ? 'Cooling ON' : 'Cooling OFF'}
              </div>
            </div>
          </div>

          {/* Threshold Range Bar */}
          <div className="mt-4">
            <div className="relative h-3 rounded-full bg-slate-800 overflow-hidden">
              {/* Safe optimal zone */}
              <div
                className="absolute top-0 bottom-0 bg-emerald-500/35 border-x border-emerald-400/60"
                style={{
                  left: `${safeStartPct}%`,
                  width: `${safeWidthPct}%`,
                }}
              />
              {/* Live temperature marker */}
              <div
                className={`absolute top-0 bottom-0 w-1.5 rounded-full transition-transform duration-150 ${
                  evaluation.isTempCritical
                    ? 'bg-red-400'
                    : 'bg-sky-300'
                }`}
                style={{ left: `calc(${markerPct}% - 3px)` }}
              />
            </div>
            <div className="mt-1.5 flex items-center justify-between text-[11px] font-mono-tabular text-slate-400">
              <span>Min Critical {telemetry.minCriticalC.toFixed(1)}°C</span>
              <span>Max {telemetry.maxCriticalC.toFixed(1)}°C</span>
            </div>
          </div>
        </section>

        {/* Door Tamper & Security Lock Card */}
        <section className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-medium text-slate-300">
              {telemetry.doorState === 'closed_sealed' ? (
                <DoorClosed className="w-4 h-4 text-emerald-400" />
              ) : (
                <DoorOpen className="w-4 h-4 text-red-400" />
              )}
              <span>Rear Door Seal (Reed DR-01)</span>
            </div>
            <span
              data-testid="driver-door-status"
              className={`text-xs font-semibold ${
                telemetry.doorState === 'tampered_open' ||
                evaluation.isDoorTampered
                  ? 'text-red-400'
                  : telemetry.doorState === 'open_authorized'
                  ? 'text-amber-400'
                  : 'text-emerald-400'
              }`}
            >
              {telemetry.doorState === 'closed_sealed'
                ? 'CLOSED · SEALED'
                : evaluation.isDoorTampered
                ? 'TAMPERED OPEN'
                : 'AUTHORIZED OPEN'}
            </span>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={onToggleTransitArm}
              className={`min-h-[44px] flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition-colors ${
                telemetry.transitArmed
                  ? 'bg-slate-800 border-slate-700 text-slate-100 hover:bg-slate-750'
                  : 'bg-amber-500/15 border-amber-500/40 text-amber-200'
              }`}
            >
              {telemetry.transitArmed ? (
                <>
                  <Lock className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Lock Armed</span>
                </>
              ) : (
                <>
                  <LockOpen className="w-3.5 h-3.5 text-amber-400" />
                  <span>Dock Disarmed</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={onCloseAndSealDoor}
              disabled={telemetry.doorState === 'closed_sealed'}
              className={`min-h-[44px] flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition-colors ${
                telemetry.doorState === 'closed_sealed'
                  ? 'bg-slate-800/60 text-slate-500 cursor-not-allowed border border-slate-800'
                  : 'bg-sky-600 hover:bg-sky-500 text-white'
              }`}
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Reseal Bay</span>
            </button>
          </div>
        </section>

        {/* Node -> Cabin Gateway Link Telemetry */}
        <section className="rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-slate-300">
              Node CN-04 → Gateway GW-01
            </span>
            <span className="font-mono-tabular text-sky-300 font-semibold">
              {telemetry.gatewayRssiDbm} dBm · {rssi.label}
            </span>
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400 font-mono-tabular">
            <span className="inline-flex items-center gap-1.5">
              <BatteryCharging className="w-3.5 h-3.5 text-emerald-400" />
              Node Battery {telemetry.nodeBatteryPct}%
            </span>
            <span>Packet 1.0 Hz · BLE/LoRa</span>
          </div>
        </section>

        {/* Optional Quick Test Controls when rendered in standalone Mobile Tab */}
        {compactControls && onTriggerFreezeDrop && onTriggerDoorTamper && onRestoreNormal && (
          <section className="rounded-2xl border border-slate-800 bg-slate-900 p-4 space-y-2.5">
            <h3 className="text-xs font-semibold text-slate-300">
              Test Driver Alerts
            </h3>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={onTriggerFreezeDrop}
                className="min-h-[44px] px-3 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold"
              >
                Drop &lt; {telemetry.minCriticalC}°C
              </button>
              <button
                type="button"
                onClick={onTriggerDoorTamper}
                className="min-h-[44px] px-3 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-semibold"
              >
                Tamper Door
              </button>
            </div>
            <button
              type="button"
              onClick={onRestoreNormal}
              className="w-full min-h-[44px] px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-medium"
            >
              Restore Normal Transit
            </button>
          </section>
        )}

        {/* Driver Notification & Incident Log */}
        <section className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-semibold text-slate-200">
              Driver Notification Feed
            </h3>
            <span className="font-mono-tabular text-[11px] text-slate-400">
              {vehicleAlerts.length} {vehicleAlerts.length === 1 ? 'event' : 'events'}
            </span>
          </div>

          {vehicleAlerts.length === 0 ? (
            <div className="py-5 text-center text-xs text-slate-400">
              <CheckCircle2 className="w-5 h-5 text-emerald-400 mx-auto mb-1.5" />
              <span>No active alerts · Cold-chain integrity nominal</span>
            </div>
          ) : (
            <ul className="space-y-2.5" data-testid="driver-alert-log">
              {vehicleAlerts.map((alert) => (
                <li
                  key={alert.id}
                  className={`rounded-xl border p-3 ${
                    alert.acknowledged
                      ? 'border-slate-800 bg-slate-950/60'
                      : 'border-red-500/45 bg-red-950/40'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-white">
                        {alert.title}
                      </p>
                      <p className="text-[11px] text-slate-300 mt-0.5 leading-relaxed">
                        {alert.message}
                      </p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] font-mono-tabular text-slate-400">
                        <span>{formatTime(alert.timestampMs)}</span>
                        <span aria-hidden="true">·</span>
                        <span className="text-slate-300">{alert.valueLabel}</span>
                      </div>
                    </div>

                    {!alert.acknowledged ? (
                      <button
                        type="button"
                        onClick={() => onAcknowledgeAlert(alert.id)}
                        className="min-h-[36px] px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-600 text-[11px] font-semibold text-white shrink-0"
                      >
                        Ack
                      </button>
                    ) : (
                      <span className="text-[11px] text-emerald-400 font-medium shrink-0">
                        Acked
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
