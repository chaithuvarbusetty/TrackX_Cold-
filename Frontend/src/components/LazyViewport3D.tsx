import React, { Suspense } from 'react';
import type { Viewport3DProps } from './Viewport3D';
import { Box } from 'lucide-react';

const RealViewport3D = React.lazy(() => import('./Viewport3D'));

export const Viewport3DSkeleton: React.FC<{ heightClass?: string }> = ({
  heightClass = 'h-[400px]',
}) => (
  <div
    className={`w-full ${heightClass} flex flex-col items-center justify-center rounded-xl border border-slate-200 bg-slate-100 p-6 text-center text-slate-500 select-none animate-pulse`}
    role="status"
    aria-label="Loading 3D Digital Twin"
  >
    <Box className="h-9 w-9 text-blue-600 mb-2 animate-bounce" />
    <span className="font-mono text-xs font-semibold text-slate-700">
      Loading 3D Hardware Digital Twin...
    </span>
    <span className="mt-1 text-[11px] text-slate-400">
      Initializing WebGL shaders &amp; procedural textures
    </span>
  </div>
);

export const Viewport3D: React.FC<Viewport3DProps> = (props) => (
  <Suspense fallback={<Viewport3DSkeleton heightClass={props.heightClass} />}>
    <RealViewport3D {...props} />
  </Suspense>
);

export default Viewport3D;
