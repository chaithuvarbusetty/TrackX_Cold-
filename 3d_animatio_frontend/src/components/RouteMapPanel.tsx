/// <reference types="@types/google.maps" />
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  APIProvider,
  AdvancedMarker,
  Map as GoogleMap,
  Pin,
  useMap,
  useMapsLibrary,
} from '@vis.gl/react-google-maps';
import {
  AlertTriangle,
  MapPin,
  Navigation,
  Route as RouteIcon,
  Shield,
  TrafficCone,
  Truck,
} from 'lucide-react';
import {
  COLD_CHAIN_ROUTES,
  HYDERABAD_INCIDENTS,
  computeRouteEtaMinutes,
  evaluateTelemetryAlerts,
  interpolatePathPoint,
  slicePathUpToProgress,
  type LatLngPoint,
  type RouteId,
  type TelemetryEvaluation,
  type TelemetryState,
  type VehicleId,
} from '../simulation/coldChainRules';

const MAPS_API_KEY = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined) ?? '';

interface RouteMapPanelProps {
  telemetry: TelemetryState;
  fleet: TelemetryState[];
  selectedVehicleId: VehicleId;
  evaluation: TelemetryEvaluation;
  onSelectVehicle: (vehicleId: VehicleId) => void;
  onSelectRoute: (routeId: RouteId) => void;
}

interface ComputedRouteStats {
  distanceKm: number;
  durationMin: number;
  path: LatLngPoint[];
  viewport?: google.maps.LatLngBounds;
}

function isQuotaError(err: unknown): boolean {
  const msg = String(err ?? '').toUpperCase();
  return (
    msg.includes('RESOURCE_EXHAUSTED') ||
    msg.includes('OVER_QUERY_LIMIT') ||
    msg.includes('QUOTA') ||
    msg.includes('429')
  );
}

function TrafficOverlay({ enabled }: { enabled: boolean }) {
  const map = useMap();
  const layerRef = useRef<google.maps.TrafficLayer | null>(null);

  useEffect(() => {
    if (!map || typeof google === 'undefined' || !google.maps?.TrafficLayer) return;
    if (!layerRef.current) {
      layerRef.current = new google.maps.TrafficLayer();
    }
    layerRef.current.setMap(enabled ? map : null);

    return () => {
      layerRef.current?.setMap(null);
    };
  }, [map, enabled]);

  return null;
}

/**
 * Resolves all Hyderabad corridors via Google Maps Routes API (with fallback),
 * fits bounds when the selected vehicle/route changes, and renders BOTH the
 * full planned corridor polyline AND the selected vehicle's real-time traversed path.
 */
function MultiVehicleRouteLayers({
  activeRouteId,
  activePath,
  traversedPath,
  accentColor,
  isCritical,
  onRouteCached,
}: {
  activeRouteId: RouteId;
  activePath: LatLngPoint[];
  traversedPath: LatLngPoint[];
  accentColor: string;
  isCritical: boolean;
  onRouteCached: (routeId: RouteId, stats: ComputedRouteStats) => void;
}) {
  const map = useMap();
  const routesLib = useMapsLibrary('routes');
  const plannedPolyRef = useRef<google.maps.Polyline | null>(null);
  const livePolyRef = useRef<google.maps.Polyline | null>(null);
  const resolvedIdsRef = useRef<Record<string, boolean>>({});
  const fittedRouteRef = useRef<string>('');

  // Compute and cache all 3 Hyderabad corridors once routes library is ready
  useEffect(() => {
    if (!map || !routesLib?.Route) return;
    let cancelled = false;

    const allRoutes = Object.values(COLD_CHAIN_ROUTES);
    for (const r of allRoutes) {
      if (resolvedIdsRef.current[r.id]) continue;
      resolvedIdsRef.current[r.id] = true;

      const request = {
        origin: r.origin,
        destination: r.destination,
        travelMode: 'DRIVING',
        fields: ['path', 'distanceMeters', 'durationMillis', 'viewport', 'legs'],
      };

      (routesLib.Route as unknown as {
        computeRoutes: (req: typeof request) => Promise<{
          routes?: Array<{
            path?: Array<google.maps.LatLng | LatLngPoint>;
            distanceMeters?: number;
            durationMillis?: number;
            viewport?: google.maps.LatLngBounds;
            createPolylines?: () => google.maps.Polyline[];
          }>;
        }>;
      })
        .computeRoutes(request)
        .then((response) => {
          if (cancelled) return;
          const primaryRoute = response?.routes?.[0];
          if (!primaryRoute) return;

          const extractedPath: LatLngPoint[] = [];
          if (Array.isArray(primaryRoute.path) && primaryRoute.path.length >= 2) {
            for (const pt of primaryRoute.path) {
              const lat =
                typeof (pt as google.maps.LatLng).lat === 'function'
                  ? (pt as google.maps.LatLng).lat()
                  : (pt as LatLngPoint).lat;
              const lng =
                typeof (pt as google.maps.LatLng).lng === 'function'
                  ? (pt as google.maps.LatLng).lng()
                  : (pt as LatLngPoint).lng;
              extractedPath.push({ lat, lng });
            }
          } else if (typeof primaryRoute.createPolylines === 'function') {
            const created = primaryRoute.createPolylines();
            created.forEach((poly) => {
              const mvcPath = poly.getPath();
              if (mvcPath) {
                for (let i = 0; i < mvcPath.getLength(); i++) {
                  const pt = mvcPath.getAt(i);
                  extractedPath.push({ lat: pt.lat(), lng: pt.lng() });
                }
              }
              poly.setMap(null);
            });
          }

          const path = extractedPath.length >= 2 ? extractedPath : r.fallbackPath;
          const distanceKm =
            typeof primaryRoute.distanceMeters === 'number' && primaryRoute.distanceMeters > 0
              ? Number((primaryRoute.distanceMeters / 1000).toFixed(1))
              : r.distanceKm;
          const durationMin =
            typeof primaryRoute.durationMillis === 'number' && primaryRoute.durationMillis > 0
              ? Math.max(1, Math.round(primaryRoute.durationMillis / 60000))
              : r.baseDurationMin;

          onRouteCached(r.id, {
            distanceKm,
            durationMin,
            path,
            viewport: primaryRoute.viewport,
          });
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          if (isQuotaError(err)) {
            window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
          }
        });
    }

    return () => {
      cancelled = true;
    };
  }, [map, routesLib, onRouteCached]);

  // Fit map bounds whenever user switches route OR road-snapped path finishes resolving
  useEffect(() => {
    if (!map || typeof google === 'undefined' || !google.maps) return;
    const fitKey = `${activeRouteId}:${activePath.length > 15 ? 'road' : 'init'}`;
    if (fittedRouteRef.current === fitKey) return;
    fittedRouteRef.current = fitKey;

    const bounds = new google.maps.LatLngBounds();
    for (const pt of activePath) {
      bounds.extend(pt);
    }
    map.fitBounds(bounds, 52);
  }, [map, activeRouteId, activePath]);

  // Draw / update planned corridor + real-time traversed path polylines
  useEffect(() => {
    if (!map || typeof google === 'undefined' || !google.maps?.Polyline) return;

    if (!plannedPolyRef.current) {
      plannedPolyRef.current = new google.maps.Polyline({
        geodesic: true,
        strokeColor: '#475569',
        strokeOpacity: 0.38,
        strokeWeight: 5,
        zIndex: 10,
        map,
      });
    }
    plannedPolyRef.current.setPath(activePath);

    if (!livePolyRef.current) {
      livePolyRef.current = new google.maps.Polyline({
        geodesic: true,
        strokeOpacity: 0.96,
        strokeWeight: 6,
        zIndex: 25,
        map,
      });
    }
    livePolyRef.current.setOptions({
      strokeColor: isCritical ? '#dc2626' : accentColor,
    });
    livePolyRef.current.setPath(traversedPath);
  }, [map, activePath, traversedPath, accentColor, isCritical]);

  useEffect(() => {
    return () => {
      plannedPolyRef.current?.setMap(null);
      livePolyRef.current?.setMap(null);
    };
  }, []);

  return null;
}

export function RouteMapPanel({
  telemetry,
  fleet,
  selectedVehicleId,
  evaluation,
  onSelectVehicle,
  onSelectRoute,
}: RouteMapPanelProps) {
  const activeRoute = COLD_CHAIN_ROUTES[telemetry.routeId];
  const [trafficLayerEnabled, setTrafficLayerEnabled] = useState(true);
  const [mapLoadFailed, setMapLoadFailed] = useState(false);

  const [routesById, setRoutesById] = useState<Record<RouteId, ComputedRouteStats>>(() => ({
    hyd_hitec: {
      distanceKm: COLD_CHAIN_ROUTES.hyd_hitec.distanceKm,
      durationMin: COLD_CHAIN_ROUTES.hyd_hitec.baseDurationMin,
      path: COLD_CHAIN_ROUTES.hyd_hitec.fallbackPath,
    },
    hyd_genome: {
      distanceKm: COLD_CHAIN_ROUTES.hyd_genome.distanceKm,
      durationMin: COLD_CHAIN_ROUTES.hyd_genome.baseDurationMin,
      path: COLD_CHAIN_ROUTES.hyd_genome.fallbackPath,
    },
    hyd_gachibowli: {
      distanceKm: COLD_CHAIN_ROUTES.hyd_gachibowli.distanceKm,
      durationMin: COLD_CHAIN_ROUTES.hyd_gachibowli.baseDurationMin,
      path: COLD_CHAIN_ROUTES.hyd_gachibowli.fallbackPath,
    },
  }));

  useEffect(() => {
    const onQuota = () => setMapLoadFailed(true);
    window.addEventListener('gmp-quota-exceeded', onQuota);
    return () => window.removeEventListener('gmp-quota-exceeded', onQuota);
  }, []);

  const handleRouteCached = (routeId: RouteId, stats: ComputedRouteStats) => {
    setRoutesById((prev) => ({
      ...prev,
      [routeId]: stats,
    }));
  };

  const activeStats = routesById[telemetry.routeId];

  const traversedPath = useMemo(
    () => slicePathUpToProgress(activeStats.path, telemetry.routeProgress),
    [activeStats.path, telemetry.routeProgress]
  );

  const fleetPositions = useMemo(
    () =>
      fleet.map((veh) => {
        const stats = routesById[veh.routeId];
        const point = interpolatePathPoint(stats.path, veh.routeProgress);
        const evalRes = evaluateTelemetryAlerts(veh, [], veh.timestampMs);
        return {
          vehicle: veh,
          position: point.position,
          isCritical: evalRes.overallStatus === 'critical',
        };
      }),
    [fleet, routesById]
  );

  const activeIncidents = useMemo(
    () => HYDERABAD_INCIDENTS.filter((inc) => inc.routeId === telemetry.routeId),
    [telemetry.routeId]
  );

  const etaMin = computeRouteEtaMinutes(
    1 - telemetry.routeProgress,
    activeStats.distanceKm,
    telemetry.speedKmh,
    activeStats.durationMin
  );

  const isCritical = evaluation.overallStatus === 'critical';

  return (
    <div
      className="relative w-full h-full flex flex-col bg-slate-200 overflow-hidden"
      data-testid="route-map-panel"
    >
      {/* Top Fleet Selector + Hyderabad Route + Traffic Layer Bar */}
      <div className="z-20 bg-white/95 border-b border-slate-200 px-3 py-2 flex flex-wrap items-center justify-between gap-2 shrink-0">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <div className="flex items-center gap-1.5">
            <Truck className="w-4 h-4 text-sky-700 shrink-0" />
            <label htmlFor="fleet-vehicle-select" className="sr-only">
              Select Transport Vehicle
            </label>
            <select
              id="fleet-vehicle-select"
              data-testid="fleet-vehicle-select"
              value={selectedVehicleId}
              onChange={(e) => onSelectVehicle(e.target.value as VehicleId)}
              className="rounded-lg border border-slate-300 bg-slate-900 px-2 py-1 text-xs font-semibold text-white focus-visible:outline-2 focus-visible:outline-sky-600"
            >
              {fleet.map((v) => (
                <option key={v.vehicleId} value={v.vehicleId}>
                  {v.callsign} ({v.temperatureC.toFixed(1)}°C)
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1.5 min-w-0">
            <RouteIcon className="w-3.5 h-3.5 text-slate-500 shrink-0" />
            <label htmlFor="route-corridor-select" className="sr-only">
              Hyderabad Delivery Corridor
            </label>
            <select
              id="route-corridor-select"
              value={telemetry.routeId}
              onChange={(e) => onSelectRoute(e.target.value as RouteId)}
              className="max-w-[205px] sm:max-w-[235px] rounded-lg border border-slate-300 bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-900 focus-visible:outline-2 focus-visible:outline-sky-600"
            >
              {Object.values(COLD_CHAIN_ROUTES).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setTrafficLayerEnabled((v) => !v)}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors whitespace-nowrap ${
              trafficLayerEnabled
                ? 'bg-amber-50 border-amber-300 text-amber-900'
                : 'bg-slate-100 border-slate-300 text-slate-700 hover:bg-slate-200'
            }`}
          >
            <TrafficCone className="w-3.5 h-3.5" />
            <span>{trafficLayerEnabled ? 'Traffic On' : 'Traffic Off'}</span>
          </button>
        </div>
      </div>

      {/* Main Interactive Hyderabad Google Map */}
      <div className="relative flex-1 min-h-[260px] w-full">
        {MAPS_API_KEY && !mapLoadFailed ? (
          <APIProvider
            apiKey={MAPS_API_KEY}
            libraries={['routes', 'marker']}
            onError={() => setMapLoadFailed(true)}
          >
            <GoogleMap
              mapId="DEMO_MAP_ID"
              defaultCenter={{ lat: 17.385, lng: 78.4867 }}
              defaultZoom={11}
              gestureHandling="greedy"
              disableDefaultUI={false}
              streetViewControl={false}
              mapTypeControl={false}
              fullscreenControl={false}
              internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
              className="w-full h-full"
            >
              <TrafficOverlay enabled={trafficLayerEnabled} />
              <MultiVehicleRouteLayers
                activeRouteId={telemetry.routeId}
                activePath={activeStats.path}
                traversedPath={traversedPath}
                accentColor={telemetry.accentColor}
                isCritical={isCritical}
                onRouteCached={handleRouteCached}
              />

              {/* Origin Cold-Storage Hub Pin */}
              <AdvancedMarker
                position={activeRoute.origin}
                title={`Origin: ${activeRoute.originName}`}
              >
                <Pin
                  background="#0284c7"
                  borderColor="#075985"
                  glyphColor="#ffffff"
                  scale={0.85}
                />
              </AdvancedMarker>

              {/* Destination Hospital Pin */}
              <AdvancedMarker
                position={activeRoute.destination}
                title={`Destination: ${activeRoute.destinationName}`}
              >
                <Pin
                  background="#059669"
                  borderColor="#065f46"
                  glyphColor="#ffffff"
                  scale={0.85}
                />
              </AdvancedMarker>

              {/* Nearby Hyderabad Road Accidents & Traffic Police Checkposts */}
              {HYDERABAD_INCIDENTS.map((inc) => {
                const isOnActive = inc.routeId === telemetry.routeId;
                return (
                  <AdvancedMarker
                    key={inc.id}
                    position={inc.position}
                    title={`${inc.title}: ${inc.detail}`}
                    zIndex={isOnActive ? 45 : 20}
                  >
                    <div
                      data-testid={`incident-pin-${inc.type}`}
                      className={`flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold shadow-md border ${
                        inc.type === 'accident'
                          ? 'bg-amber-500 text-slate-950 border-amber-200'
                          : 'bg-blue-900 text-white border-blue-300'
                      } ${isOnActive ? 'opacity-100' : 'opacity-70'}`}
                    >
                      {inc.type === 'accident' ? (
                        <AlertTriangle className="w-3 h-3 shrink-0" />
                      ) : (
                        <Shield className="w-3 h-3 shrink-0" />
                      )}
                      <span>{inc.type === 'accident' ? 'Accident' : 'Police'}</span>
                    </div>
                  </AdvancedMarker>
                );
              })}

              {/* All 3 Live Moving Cold-Chain Fleet Vehicles (Clickable!) */}
              {fleetPositions.map(({ vehicle, position, isCritical: vehCrit }) => {
                const isSelected = vehicle.vehicleId === selectedVehicleId;
                return (
                  <AdvancedMarker
                    key={vehicle.vehicleId}
                    position={position}
                    title={`${vehicle.callsign} · ${vehicle.vehicleLabel} · ${vehicle.speedKmh} km/h`}
                    zIndex={isSelected ? 80 : 50}
                    onClick={() => onSelectVehicle(vehicle.vehicleId)}
                  >
                    <div
                      data-testid={`map-fleet-marker-${vehicle.vehicleId}`}
                      className={`cursor-pointer flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-bold text-white shadow-lg border transition-transform ${
                        isSelected ? 'scale-110 ring-2 ring-white' : 'opacity-90 hover:opacity-100'
                      } ${
                        vehCrit
                          ? 'bg-red-600 border-red-200'
                          : isSelected
                          ? 'bg-slate-950 border-sky-400'
                          : 'bg-slate-800 border-slate-500'
                      }`}
                    >
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: vehicle.accentColor }}
                      />
                      <Truck className="w-3 h-3 shrink-0" />
                      <span>{vehicle.callsign.slice(-3)}</span>
                      <span className="font-mono-tabular">
                        {vehicle.temperatureC.toFixed(1)}°C
                      </span>
                    </div>
                  </AdvancedMarker>
                );
              })}
            </GoogleMap>
          </APIProvider>
        ) : (
          <CorridorFallbackMap
            route={activeRoute}
            traversedPath={traversedPath}
            fleetPositions={fleetPositions}
            selectedVehicleId={selectedVehicleId}
            incidents={activeIncidents}
            isCritical={isCritical}
            onSelectVehicle={onSelectVehicle}
          />
        )}

        {/* Bottom Hyderabad Route, Real-Time Path & Nearby Incident Strip */}
        <div
          className="pointer-events-none absolute bottom-3 left-3 right-3 z-10 rounded-xl border border-slate-300/90 px-3 py-2 text-xs text-slate-800 shadow-sm"
          style={{ backgroundColor: 'rgba(255, 255, 255, 0.94)' }}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <Navigation className="w-3.5 h-3.5 text-sky-700 shrink-0" />
              <span className="font-semibold text-slate-900 truncate">
                {telemetry.callsign} · {activeRoute.highwayLabel}
              </span>
              <span aria-hidden="true" className="text-slate-400">
                ·
              </span>
              <span className="text-[11px] font-semibold text-amber-800">
                {activeIncidents.filter((i) => i.type === 'accident').length} Accident ·{' '}
                {activeIncidents.filter((i) => i.type === 'police').length} Police
              </span>
            </div>

            <div className="flex items-center gap-2.5 font-mono-tabular text-slate-700 shrink-0">
              <span>
                <strong className="text-slate-950">{telemetry.speedKmh}</strong> km/h
              </span>
              <span aria-hidden="true" className="text-slate-300">
                |
              </span>
              <span>
                <strong className="text-slate-950">{activeStats.distanceKm}</strong> km
              </span>
              <span aria-hidden="true" className="text-slate-300">
                |
              </span>
              <span>
                ETA <strong className="text-slate-950">{etaMin}m</strong>
              </span>
              <span aria-hidden="true" className="text-slate-300">
                |
              </span>
              <span className="text-sky-700 font-semibold">
                {Math.round(telemetry.routeProgress * 100)}%
              </span>
            </div>
          </div>

          <div className="mt-1.5 h-1.5 w-full rounded-full bg-slate-200 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{
                width: `${Math.max(4, Math.round(telemetry.routeProgress * 100))}%`,
                backgroundColor: isCritical ? '#dc2626' : telemetry.accentColor,
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function CorridorFallbackMap({
  route,
  traversedPath,
  fleetPositions,
  selectedVehicleId,
  incidents,
  isCritical,
  onSelectVehicle,
}: {
  route: (typeof COLD_CHAIN_ROUTES)[RouteId];
  traversedPath: LatLngPoint[];
  fleetPositions: Array<{
    vehicle: TelemetryState;
    position: LatLngPoint;
    isCritical: boolean;
  }>;
  selectedVehicleId: VehicleId;
  incidents: typeof HYDERABAD_INCIDENTS;
  isCritical: boolean;
  onSelectVehicle: (vehicleId: VehicleId) => void;
}) {
  const pts = route.fallbackPath;
  const lats = pts.map((p) => p.lat);
  const lngs = pts.map((p) => p.lng);
  const minLat = Math.min(...lats) - 0.015;
  const maxLat = Math.max(...lats) + 0.015;
  const minLng = Math.min(...lngs) - 0.015;
  const maxLng = Math.max(...lngs) + 0.015;

  const project = (pt: LatLngPoint) => {
    const x = 40 + ((pt.lng - minLng) / Math.max(1e-5, maxLng - minLng)) * 320;
    const y = 260 - ((pt.lat - minLat) / Math.max(1e-5, maxLat - minLat)) * 200;
    return { x, y };
  };

  const plannedPoints = pts
    .map((p) => {
      const xy = project(p);
      return `${xy.x.toFixed(1)},${xy.y.toFixed(1)}`;
    })
    .join(' ');

  const livePoints = traversedPath
    .map((p) => {
      const xy = project(p);
      return `${xy.x.toFixed(1)},${xy.y.toFixed(1)}`;
    })
    .join(' ');

  const startXy = project(route.origin);
  const endXy = project(route.destination);

  return (
    <div
      className="w-full h-full bg-slate-100 flex flex-col items-center justify-center p-4"
      data-testid="route-map-fallback"
    >
      <svg
        viewBox="0 0 400 300"
        className="w-full h-full max-h-[520px] rounded-xl border border-slate-300 bg-[#edf2f7]"
        aria-label={`Hyderabad Route map for ${route.name}`}
      >
        <g stroke="#cbd5e1" strokeWidth="1" opacity="0.6">
          {[60, 120, 180, 240].map((y) => (
            <line key={`h-${y}`} x1="0" y1={y} x2="400" y2={y} />
          ))}
          {[80, 160, 240, 320].map((x) => (
            <line key={`v-${x}`} x1={x} y1="0" x2={x} y2="300" />
          ))}
        </g>

        {/* Planned Full Route */}
        <polyline
          points={plannedPoints}
          fill="none"
          stroke="#94a3b8"
          strokeWidth="5"
          strokeDasharray="6 4"
          strokeLinecap="round"
        />

        {/* Real-Time Vehicle Traversed Path */}
        <polyline
          points={livePoints}
          fill="none"
          stroke={isCritical ? '#dc2626' : '#0284c7'}
          strokeWidth="6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        <circle cx={startXy.x} cy={startXy.y} r="7" fill="#0284c7" stroke="#ffffff" strokeWidth="2" />
        <text x={startXy.x + 10} y={startXy.y + 4} fontSize="9.5" fontWeight="600" fill="#0f172a">
          {route.originName}
        </text>

        <circle cx={endXy.x} cy={endXy.y} r="7" fill="#059669" stroke="#ffffff" strokeWidth="2" />
        <text x={endXy.x - 10} y={endXy.y - 10} fontSize="9.5" fontWeight="600" fill="#0f172a" textAnchor="end">
          {route.destinationName}
        </text>

        {incidents.map((inc) => {
          const ixy = project(inc.position);
          return (
            <g key={inc.id} transform={`translate(${ixy.x}, ${ixy.y})`}>
              <rect
                x="-8"
                y="-8"
                width="16"
                height="16"
                rx="4"
                fill={inc.type === 'accident' ? '#f59e0b' : '#1e3a8a'}
                stroke="#ffffff"
                strokeWidth="1.5"
              />
              <text
                y="3.5"
                textAnchor="middle"
                fontSize="9"
                fontWeight="700"
                fill={inc.type === 'accident' ? '#0f172a' : '#ffffff'}
              >
                {inc.type === 'accident' ? '!' : 'P'}
              </text>
            </g>
          );
        })}

        {fleetPositions
          .filter((fp) => fp.vehicle.routeId === route.id)
          .map(({ vehicle, position, isCritical: vehCrit }) => {
            const txy = project(position);
            const isSel = vehicle.vehicleId === selectedVehicleId;
            return (
              <g
                key={vehicle.vehicleId}
                transform={`translate(${txy.x}, ${txy.y})`}
                onClick={() => onSelectVehicle(vehicle.vehicleId)}
                style={{ cursor: 'pointer' }}
              >
                <circle
                  r={isSel ? 12 : 9}
                  fill={vehCrit ? '#dc2626' : '#0f172a'}
                  stroke={isSel ? '#38bdf8' : '#ffffff'}
                  strokeWidth={isSel ? 3 : 2}
                />
                <text
                  y="3"
                  textAnchor="middle"
                  fontSize="8"
                  fontWeight="700"
                  fill="#ffffff"
                  fontFamily="monospace"
                >
                  {vehicle.temperatureC.toFixed(0)}°
                </text>
              </g>
            );
          })}
      </svg>

      <div className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-600">
        <MapPin className="w-3.5 h-3.5 text-sky-700" />
        <span>
          Hyderabad Corridor: {route.originName} → {route.destinationName}
        </span>
      </div>
    </div>
  );
}
