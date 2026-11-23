import { useEffect, useRef, useState } from 'react';
import {
  ColdChainTruckScene,
  type CameraPresetId,
  type SceneVisualState,
} from '../three/ColdChainTruckScene';
import { AlertTriangle, Box } from 'lucide-react';

interface Viewport3DProps {
  visualState: SceneVisualState;
  onDoorClick: () => void;
  onSelectFocus: (preset: CameraPresetId) => void;
}

export function Viewport3D({
  visualState,
  onDoorClick,
  onSelectFocus,
}: Viewport3DProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const sceneControllerRef = useRef<ColdChainTruckScene | null>(null);
  const callbacksRef = useRef({ onDoorClick, onSelectFocus });
  const initialStateRef = useRef(visualState);
  const [webglError, setWebglError] = useState(false);

  callbacksRef.current = { onDoorClick, onSelectFocus };

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const controller = new ColdChainTruckScene(container, initialStateRef.current, {
      onDoorClick: () => callbacksRef.current.onDoorClick(),
      onSelectFocus: (preset) => callbacksRef.current.onSelectFocus(preset),
      onWebGLError: () => setWebglError(true),
    });
    sceneControllerRef.current = controller;

    return () => {
      controller.dispose();
      sceneControllerRef.current = null;
    };
  }, []);

  useEffect(() => {
    sceneControllerRef.current?.updateVisualState(visualState);
  }, [visualState]);

  if (webglError) {
    return (
      <div
        className="w-full h-full flex flex-col items-center justify-center bg-slate-200 text-slate-800 p-6 text-center"
        data-testid="webgl-fallback"
      >
        <Box className="w-10 h-10 text-sky-700 mb-3" />
        <h2 className="font-display text-lg font-semibold">3D Hardware Context Unavailable</h2>
        <p className="text-sm text-slate-600 max-w-md mt-1">
          Live sensor telemetry and driver cabin alerts remain active on the dashboard.
        </p>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full overflow-hidden bg-[#e7edf3]">
      {/* Isolated WebGL mount container */}
      <div ref={mountRef} className="w-full h-full cursor-grab active:cursor-grabbing" />

      {/* Top HUD Bar: Responsive flex container prevents overlap on narrow or mobile panels */}
      <div className="pointer-events-none absolute top-3 left-3 right-3 z-10 flex flex-wrap items-start justify-between gap-2">
        <div
          className="rounded-lg px-3 py-1.5 text-xs text-slate-700 border border-slate-300/80"
          style={{ backgroundColor: 'rgba(248, 250, 252, 0.92)' }}
        >
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-medium">
            <span className="text-slate-900 font-semibold">
              {visualState.callsign} · 3× Rig
            </span>
            <span aria-hidden="true" className="text-slate-400">·</span>
            <span className="font-mono-tabular text-sky-700 font-semibold">
              {visualState.vehicleMoving ? `${visualState.speedKmh} km/h` : 'PARKED'}
            </span>
            <span aria-hidden="true" className="text-slate-400">·</span>
            <span className="capitalize">Hyderabad {visualState.trafficDensity} traffic</span>
          </div>
        </div>

        {/* On-canvas alert indicator when critical event occurs */}
        {visualState.isAlertActive && (
          <div
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold text-white border border-red-400/50"
            style={{ backgroundColor: 'rgba(185, 28, 28, 0.94)' }}
          >
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>
              {visualState.isDoorTampered &&
              (visualState.tempBand === 'below_critical' ||
                visualState.tempBand === 'above_critical')
                ? `Door Tamper · Temp ${visualState.temperatureC.toFixed(1)}°C`
                : visualState.isDoorTampered
                ? 'Door Tamper Active'
                : visualState.tempBand === 'below_critical'
                ? `Freeze Excursion (${visualState.temperatureC.toFixed(1)}°C)`
                : `High Temp Excursion (${visualState.temperatureC.toFixed(1)}°C)`}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
