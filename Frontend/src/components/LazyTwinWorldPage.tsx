import React, { Suspense, lazy } from 'react';
import type { LiveDeviceTelemetry } from '../shared/useLiveTwinBridge';

const TwinWorldPage = lazy(() =>
  import('./TwinWorldPage').then((m) => ({ default: m.TwinWorldPage }))
);

interface LazyTwinWorldPageProps {
  liveDevice?: LiveDeviceTelemetry | null;
  onTriggerBackendAction?: (action: 'COMPRESSOR_FAULT' | 'DOOR_BREACH' | 'RESTORE_NORMAL') => void;
}

export const LazyTwinWorldPage: React.FC<LazyTwinWorldPageProps> = (props) => {
  return (
    <Suspense
      fallback={
        <div className="flex h-[calc(100vh-4rem)] w-full flex-col items-center justify-center bg-slate-950 text-slate-300">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-blue-500 border-t-transparent mb-4" />
          <div className="font-display text-base font-semibold text-white">Loading 3D Digital Twin City...</div>
          <div className="text-xs text-slate-500 mt-1">Initializing WebGL procedural world & physics engine</div>
        </div>
      }
    >
      <TwinWorldPage {...props} />
    </Suspense>
  );
};
