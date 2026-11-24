import React, { useEffect, useRef, useState, useMemo } from 'react';
import {
  ColdChainTruckScene,
  type CameraPresetId,
  type DoorState,
  type SceneVisualState,
  type TemperatureBand,
  type TrafficDensity,
} from '../three/ColdChainTruckScene';
import {
  AlertTriangle,
  Box,
  DoorOpen,
  Eye,
  EyeOff,
  Info,
  Radio,
  RotateCcw,
  Volume2,
  VolumeX,
  X,
  Zap,
} from 'lucide-react';
import { isAudioMuted, setAudioMuted, playAlertTone } from '../utils/soundAlerts';

export type Viewport3DMode = 'live' | 'thermal' | 'diagnostic' | 'replay';

export interface Viewport3DTelemetryInput {
  callsign?: string;
  temperatureC?: number | null;
  tempBand?: TemperatureBand;
  doorState?: DoorState;
  compressorActive?: boolean;
  speedKmh?: number | null;
  vehicleMoving?: boolean;
  isAlertActive?: boolean;
  isDoorTampered?: boolean;
  accentHex?: number;
  cutawayEnabled?: boolean;
  cameraPreset?: CameraPresetId;
  trafficDensity?: TrafficDensity;
}

export interface Viewport3DProps {
  mode?: Viewport3DMode;
  visualState?: SceneVisualState;
  telemetry?: Viewport3DTelemetryInput;
  heightClass?: string;
  showControls?: boolean;
  onDoorClick?: () => void;
  onSelectFocus?: (preset: CameraPresetId) => void;
  onHardwareAction?: (action: 'DOOR_BREACH' | 'COMPRESSOR_FAULT' | 'RESTORE_NORMAL') => void;
  className?: string;
  showCutawayToggle?: boolean;
}

export const Viewport3D: React.FC<Viewport3DProps> = ({
  mode = 'live',
  visualState,
  telemetry,
  heightClass = 'h-[400px]',
  showControls = true,
  onDoorClick,
  onSelectFocus,
  onHardwareAction,
  className = '',
  showCutawayToggle = true,
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const sceneControllerRef = useRef<ColdChainTruckScene | null>(null);
  const callbacksRef = useRef({ onDoorClick, onSelectFocus });
  const [webglError, setWebglError] = useState(false);
  const [xrayOpen, setXrayOpen] = useState(false);

  // Compute unified scene visual state with zero-NaN guarantees
  const effectiveVisualState: SceneVisualState = useMemo(() => {
    if (visualState) return visualState;
    const t = telemetry || {};
    const rawTemp = t.temperatureC;
    const hasValidTemp = rawTemp !== null && rawTemp !== undefined && !isNaN(Number(rawTemp));
    const temp = hasValidTemp ? Number(rawTemp) : null;
    const tempBand = t.tempBand || (temp == null ? 'optimal' : temp > 8.0 ? 'above_critical' : temp < 2.0 ? 'below_critical' : 'optimal');
    const isAlert = t.isAlertActive ?? ((temp != null && (temp > 8.0 || temp < 2.0)) || t.doorState === 'open');
    const speed = t.speedKmh != null && !isNaN(Number(t.speedKmh)) ? Number(t.speedKmh) : 0;
    const moving = t.vehicleMoving ?? (speed > 1.0);
    return {
      callsign: t.callsign || 'GW-001',
      accentHex: t.accentHex ?? 0x2563eb,
      temperatureC: temp,
      tempBand,
      doorState: t.doorState || 'closed',
      compressorActive: t.compressorActive ?? true,
      cutawayEnabled: t.cutawayEnabled ?? (mode === 'thermal'),
      isAlertActive: isAlert,
      isDoorTampered: t.isDoorTampered ?? (t.doorState === 'open'),
      cameraPreset: t.cameraPreset || (mode === 'thermal' ? 'node' : mode === 'diagnostic' ? 'doors' : 'overview'),
      vehicleMoving: moving,
      speedKmh: speed,
      trafficDensity: t.trafficDensity || 'moderate',
    };
  }, [visualState, telemetry, mode]);

  const [activePreset, setActivePreset] = useState<CameraPresetId>(
    effectiveVisualState.cameraPreset || (mode === 'thermal' ? 'node' : mode === 'diagnostic' ? 'doors' : 'overview')
  );
  const [cutaway, setCutaway] = useState(mode === 'thermal' || effectiveVisualState.cutawayEnabled);
  const [muted, setMuted] = useState(isAudioMuted());

  callbacksRef.current = { onDoorClick, onSelectFocus };

  // Set mode-specific initial preset
  useEffect(() => {
    if (mode === 'thermal') {
      setActivePreset('node');
      setCutaway(true);
    } else if (mode === 'diagnostic') {
      setActivePreset('doors');
    }
  }, [mode]);

  // Audio alerts on state transitions
  const prevAlertRef = useRef(effectiveVisualState.isAlertActive);
  useEffect(() => {
    if (!prevAlertRef.current && effectiveVisualState.isAlertActive) {
      playAlertTone(effectiveVisualState.isDoorTampered ? 'door_tamper' : 'temp_critical');
    } else if (prevAlertRef.current && !effectiveVisualState.isAlertActive) {
      playAlertTone('resolved');
    }
    prevAlertRef.current = effectiveVisualState.isAlertActive;
  }, [effectiveVisualState.isAlertActive, effectiveVisualState.isDoorTampered]);

  // Scene initialization & lifecycle
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    let controller: ColdChainTruckScene | null = null;
    try {
      controller = new ColdChainTruckScene(
        container,
        {
          ...effectiveVisualState,
          cameraPreset: activePreset,
          cutawayEnabled: cutaway,
        },
        {
          onDoorClick: () => {
            callbacksRef.current.onDoorClick?.();
          },
          onSelectFocus: (preset) => {
            setActivePreset(preset);
            callbacksRef.current.onSelectFocus?.(preset);
          },
          onWebGLError: () => setWebglError(true),
        }
      );
      sceneControllerRef.current = controller;
    } catch {
      setWebglError(true);
      return;
    }

    // Auto-pause loop when document is hidden to conserve GPU/CPU
    const onVisibilityChange = () => {
      if (document.hidden) {
        sceneControllerRef.current?.pause();
      } else {
        sceneControllerRef.current?.resume();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    // Auto-pause when canvas is scrolled offscreen
    let io: IntersectionObserver | null = null;
    if (typeof IntersectionObserver !== 'undefined') {
      io = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) {
            sceneControllerRef.current?.resume();
          } else {
            sceneControllerRef.current?.pause();
          }
        },
        { threshold: 0.05 }
      );
      io.observe(container);
    }

    // Responsive Resize Observer
    const ro =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => {
            if (!container || !sceneControllerRef.current) return;
          })
        : null;

    if (ro) ro.observe(container);

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      io?.disconnect();
      ro?.disconnect();
      controller?.dispose();
      sceneControllerRef.current = null;
    };
  }, []);

  // Sync state changes with Three.js scene controller
  useEffect(() => {
    if (sceneControllerRef.current) {
      sceneControllerRef.current.updateVisualState({
        ...effectiveVisualState,
        cameraPreset: activePreset,
        cutawayEnabled: cutaway,
      });
    }
  }, [effectiveVisualState, activePreset, cutaway]);

  const handleCameraChange = (preset: CameraPresetId) => {
    setActivePreset(preset);
    sceneControllerRef.current?.focusCameraPreset(preset);
    onSelectFocus?.(preset);
  };

  const handleToggleSound = () => {
    const next = !muted;
    setMuted(next);
    setAudioMuted(next);
  };

  // Close X-Ray on Escape
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && xrayOpen) {
        setXrayOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [xrayOpen]);

  if (webglError) {
    return (
      <div
        className={`w-full ${heightClass} flex flex-col items-center justify-center rounded-xl border border-slate-200 bg-slate-100 p-6 text-center text-slate-800 ${className}`}
        data-testid="webgl-fallback"
        role="region"
        aria-label="3D Hardware Context Unavailable"
      >
        <Box className="h-10 w-10 text-blue-600 mb-2 animate-pulse" />
        <h3 className="font-display text-base font-bold text-slate-900">
          3D Hardware Context Unavailable - Live Telemetry Active
        </h3>
        <p className="mt-1 text-xs text-slate-600 max-w-sm">
          Live sensor telemetry, cellular GPS coordinates, and temperature alerts remain active in 2D mode.
        </p>
      </div>
    );
  }

  const tempDisplay =
    effectiveVisualState.temperatureC != null && !isNaN(effectiveVisualState.temperatureC)
      ? `${effectiveVisualState.temperatureC.toFixed(1)}°C`
      : '--.-°C';

  return (
    <div
      className={`relative w-full ${heightClass} overflow-hidden rounded-xl border border-slate-300 bg-[#e7edf3] select-none ${className}`}
      role="img"
      aria-label={`3D Digital Twin: ${effectiveVisualState.callsign}, status ${effectiveVisualState.tempBand}, temp ${tempDisplay}, door ${effectiveVisualState.doorState}, speed ${effectiveVisualState.speedKmh} km/h`}
      style={{ touchAction: 'pan-y' }}
    >
      {/* WebGL Canvas Container */}
      <div ref={mountRef} className="w-full h-full cursor-grab active:cursor-grabbing" />

      {/* Top HUD: Hardware status bar */}
      <div className="pointer-events-none absolute top-3 left-3 right-3 z-10 flex flex-wrap items-center justify-between gap-2 text-xs">
        <div
          className="pointer-events-auto flex flex-wrap items-center gap-2 rounded-lg border border-slate-300/80 bg-white/95 px-3 py-1.5 shadow-2xs backdrop-blur-xs font-mono"
        >
          <span className="font-bold text-blue-700">{effectiveVisualState.callsign}</span>
          <span className="text-slate-300">·</span>
          <span className={`font-bold ${effectiveVisualState.isAlertActive ? 'text-rose-600' : 'text-emerald-700'}`}>
            {tempDisplay}
          </span>
          <span className="text-slate-300">·</span>
          <span className="text-slate-700 font-semibold">
            {effectiveVisualState.vehicleMoving ? `${effectiveVisualState.speedKmh.toFixed(0)} km/h` : 'PARKED'}
          </span>
          <span className="text-slate-300">·</span>
          <span className={effectiveVisualState.doorState === 'open' ? 'text-rose-600 font-bold' : 'text-slate-600'}>
            Door {effectiveVisualState.doorState.toUpperCase()}
          </span>
        </div>

        {/* Action Controls Toolbar: Touch targets >= 44x44px on mobile */}
        <div className="pointer-events-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleToggleSound}
            aria-label={muted ? 'Unmute Audio Alarms' : 'Mute Audio Alarms'}
            className="flex h-11 w-11 sm:h-9 sm:w-9 items-center justify-center rounded-lg border border-slate-300 bg-white/95 text-slate-700 shadow-2xs hover:bg-slate-50 cursor-pointer focus-visible:outline-2 focus-visible:outline-blue-600"
          >
            {muted ? <VolumeX className="h-4 w-4 text-slate-400" /> : <Volume2 className="h-4 w-4 text-blue-600" />}
          </button>

          {showCutawayToggle && (
            <button
              type="button"
              onClick={() => setCutaway((c) => !c)}
              aria-label={cutaway ? 'Solid Exterior View' : 'Cutaway Cargo View'}
              className={`flex h-11 sm:h-9 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold shadow-2xs cursor-pointer transition-colors focus-visible:outline-2 focus-visible:outline-blue-600 ${
                cutaway
                  ? 'border-blue-400 bg-blue-50 text-blue-700'
                  : 'border-slate-300 bg-white/95 text-slate-700 hover:bg-slate-50'
              }`}
            >
              {cutaway ? <Eye className="h-4 w-4 sm:h-3.5 sm:w-3.5" /> : <EyeOff className="h-4 w-4 sm:h-3.5 sm:w-3.5" />}
              <span className="hidden sm:inline">{cutaway ? 'Cutaway ON' : 'Cutaway OFF'}</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setXrayOpen(true)}
            aria-label="Inspect Hardware X-Ray Diagnostics"
            className="flex h-11 sm:h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white/95 px-2.5 text-xs font-semibold text-slate-800 shadow-2xs hover:bg-slate-50 cursor-pointer focus-visible:outline-2 focus-visible:outline-blue-600"
          >
            <Info className="h-4 w-4 sm:h-3.5 sm:w-3.5 text-blue-600" />
            <span className="hidden sm:inline">X-Ray Spec</span>
          </button>
        </div>
      </div>

      {/* Mode-specific Quick Simulation Bar */}
      {mode === 'diagnostic' && onHardwareAction && (
        <div className="pointer-events-auto absolute top-14 left-3 z-10 flex flex-wrap items-center gap-1.5 rounded-lg border border-slate-300/80 bg-white/95 p-1 shadow-sm backdrop-blur-xs text-[11px] font-semibold">
          <button
            type="button"
            onClick={() => onHardwareAction('DOOR_BREACH')}
            className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-rose-700 hover:bg-rose-50 cursor-pointer min-h-[36px]"
          >
            <DoorOpen className="h-3.5 w-3.5" /> Breach Door
          </button>
          <button
            type="button"
            onClick={() => onHardwareAction('COMPRESSOR_FAULT')}
            className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-amber-800 hover:bg-amber-50 cursor-pointer min-h-[36px]"
          >
            <Zap className="h-3.5 w-3.5" /> Fault Comp
          </button>
          <button
            type="button"
            onClick={() => onHardwareAction('RESTORE_NORMAL')}
            className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-emerald-800 hover:bg-emerald-50 cursor-pointer min-h-[36px]"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Restore
          </button>
        </div>
      )}

      {/* Excursion Alarm Banner */}
      {effectiveVisualState.isAlertActive && (
        <div className="pointer-events-none absolute top-14 right-3 z-10 flex items-center justify-end max-w-sm">
          <div className="flex items-center gap-2 rounded-lg bg-rose-600/95 px-3 py-1.5 text-xs font-bold text-white shadow-md backdrop-blur-xs border border-rose-400/50 animate-pulse">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>
              {effectiveVisualState.isDoorTampered && effectiveVisualState.tempBand === 'above_critical'
                ? `DOOR OPEN & THERMAL EXCURSION (${tempDisplay})`
                : effectiveVisualState.isDoorTampered
                ? 'DOOR TAMPER BREACH DETECTED'
                : `TEMPERATURE EXCURSION (${tempDisplay})`}
            </span>
          </div>
        </div>
      )}

      {/* Bottom Floating Camera Presets Dock */}
      {showControls && (
        <div className="pointer-events-auto absolute bottom-2.5 left-1/2 -translate-x-1/2 z-10 flex flex-nowrap items-center justify-center gap-1 rounded-xl border border-slate-300/80 bg-white/95 p-1 shadow-md backdrop-blur-xs text-[10px] sm:text-[11px] font-semibold text-slate-700 max-w-[96%] overflow-x-auto">
          {(
            [
              ['overview', 'Overview'],
              ['node', 'Cargo & Node'],
              ['cabin', 'Cabin Gateway'],
              ['doors', 'Rear Doors'],
            ] as const
          ).map(([preset, label]) => (
            <button
              key={preset}
              type="button"
              onClick={() => handleCameraChange(preset)}
              className={`shrink-0 px-2.5 py-1 rounded-lg transition-colors cursor-pointer whitespace-nowrap focus-visible:outline-2 focus-visible:outline-blue-600 ${
                activePreset === preset
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'hover:bg-slate-100 text-slate-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Hardware X-Ray Diagnostic Modal (Zero Battery Lines per specification) */}
      {xrayOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="xray-title"
          className="absolute inset-0 z-30 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs"
        >
          <div className="w-full max-w-md rounded-xl border border-slate-300 bg-white p-5 shadow-xl text-xs space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div className="flex items-center gap-2">
                <Radio className="h-4 w-4 text-blue-600" />
                <h3 id="xray-title" className="font-display text-sm font-bold text-slate-900">
                  {effectiveVisualState.callsign} Hardware Diagnostics
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setXrayOpen(false)}
                aria-label="Close diagnostic sheet"
                className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 cursor-pointer min-h-[44px] min-w-[44px] flex items-center justify-center sm:min-h-0 sm:min-w-0 sm:p-1"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2.5 font-mono">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                <div className="text-[10px] text-slate-500 font-sans">Gateway Telematics</div>
                <div className="mt-0.5 font-bold text-slate-900">Quectel BG95-M3</div>
                <div className="text-[10px] text-emerald-700 font-semibold">● ONLINE (TLS 1.3)</div>
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                <div className="text-[10px] text-slate-500 font-sans">Cellular Modem</div>
                <div className="mt-0.5 font-bold text-slate-900">4G LTE-M / NB-IoT</div>
                <div className="text-[10px] text-slate-600">-75 dBm (GOOD)</div>
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                <div className="text-[10px] text-slate-500 font-sans">GNSS Navigation</div>
                <div className="mt-0.5 font-bold text-slate-900">GPS / GLONASS</div>
                <div className="text-[10px] text-blue-700 font-semibold">14 Satellites Locked</div>
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                <div className="text-[10px] text-slate-500 font-sans">Cargo Chamber Sensor</div>
                <div className="mt-0.5 font-bold text-slate-900">DS18B20 Digital Probe</div>
                <div className="text-[10px] text-slate-600">GDP Band: 2.0°C – 8.0°C</div>
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 col-span-2">
                <div className="text-[10px] text-slate-500 font-sans">Hardware Identifiers</div>
                <div className="mt-0.5 flex justify-between text-[11px]">
                  <span className="text-slate-600">IMEI:</span>
                  <span className="font-bold text-slate-800">860738070471994</span>
                </div>
                <div className="mt-0.5 flex justify-between text-[11px]">
                  <span className="text-slate-600">Door Sensor:</span>
                  <span className={`font-bold ${effectiveVisualState.doorState === 'open' ? 'text-rose-600' : 'text-emerald-700'}`}>
                    Magnetic Reed Switch ({effectiveVisualState.doorState.toUpperCase()})
                  </span>
                </div>
              </div>
            </div>

            <div className="pt-1 flex justify-end">
              <button
                type="button"
                onClick={() => setXrayOpen(false)}
                className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 cursor-pointer min-h-[44px] sm:min-h-0"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Viewport3D;
