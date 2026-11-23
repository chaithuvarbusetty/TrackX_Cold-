import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Clock,
  Download,
  MapPin,
  Pause,
  Play,
  Plus,
  Shield,
  Trash2,
  Truck,
} from 'lucide-react';
import type {
  FleetTableRow,
  GeofenceRecord,
  ModuleId,
  TripDetails,
  TripSummary,
} from '../shared/types';
import { LiveFleetMap } from './LiveFleetMap';
import { Viewport3D } from './LazyViewport3D';
import {
  CargoHeroBanner,
  SignalStrengthDisplay,
  VehicleCargoBadge,
} from './CargoShell';

function formatTripTime(isoStr?: string | null): string {
  if (!isoStr) return '--:--';
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) {
      const match = isoStr.match(/(\d{2}):(\d{2})/);
      return match ? `${match[1]}:${match[2]}` : isoStr.substring(11, 16);
    }
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
  } catch {
    return isoStr.substring(11, 16);
  }
}

interface TripsPageProps {
  trips: TripSummary[];
  fleetRows: FleetTableRow[];
  geofences: GeofenceRecord[];
  onRefreshGeofences: () => Promise<void>;
  onSelectDevice: (deviceId: string) => void;
  onNavigateModule: (mod: ModuleId, openDetail?: boolean) => void;
  onExportCsv: (deviceId: string) => void;
}

export const TripsPage: React.FC<TripsPageProps> = ({
  trips,
  fleetRows,
  geofences,
  onRefreshGeofences,
  onSelectDevice,
  onNavigateModule,
  onExportCsv,
}) => {
  // Initialize clickedDeviceId as null so navigating to Trips displays the Active Fleet table first
  const [clickedDeviceId, setClickedDeviceId] = useState<string | null>(null);
  const [deviceTrips, setDeviceTrips] = useState<TripSummary[]>([]);
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);
  const [loadingDeviceTrips, setLoadingDeviceTrips] = useState(false);

  const [tripDetails, setTripDetails] = useState<TripDetails | null>(null);
  const [loadingTrip, setLoadingTrip] = useState(false);
  const [subtab, setSubtab] = useState<'replay' | 'metrics' | 'geofences' | 'events'>('replay');
  const [tripViewMode, setTripViewMode] = useState<'map' | '3d' | 'split'>('map');

  const [replayIdx, setReplayIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speedMult, setSpeedMult] = useState<1 | 2 | 5 | 10>(2);

  // Geofence Form State
  const [gfName, setGfName] = useState('Balanagar Cold Waypoint');
  const [gfDevice, setGfDevice] = useState('ALL');
  const [gfLat, setGfLat] = useState('17.4980');
  const [gfLng, setGfLng] = useState('78.4310');
  const [gfRadius, setGfRadius] = useState('850');
  const [creatingGf, setCreatingGf] = useState(false);

  const selectedVehicle = clickedDeviceId
    ? fleetRows.find((r) => r.device_id === clickedDeviceId) ?? (fleetRows.length > 0 ? fleetRows[0] : null)
    : null;

  // 1. Fetch all trips for clicked vehicle
  useEffect(() => {
    if (!clickedDeviceId) {
      setDeviceTrips([]);
      setSelectedTripId(null);
      setTripDetails(null);
      return;
    }

    let cancelled = false;
    setLoadingDeviceTrips(true);
    fetch(`/api/v1/trips?device_id=${encodeURIComponent(clickedDeviceId)}`, {
      headers: { 'ngrok-skip-browser-warning': 'true' },
    })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const fetchedTrips: TripSummary[] = data.trips || [];
        setDeviceTrips(fetchedTrips);
        if (fetchedTrips.length > 0) {
          // Default to in-progress trip, or the latest trip
          const active = fetchedTrips.find((t) => t.status === 'IN_PROGRESS') || fetchedTrips[0];
          setSelectedTripId(active.trip_id);
        } else {
          // Fallback to overview trip prop if available
          const fallback = trips.find((t) => t.device_id === clickedDeviceId);
          if (fallback) {
            setDeviceTrips([fallback]);
            setSelectedTripId(fallback.trip_id);
          } else {
            setSelectedTripId(null);
            setTripDetails(null);
          }
        }
      })
      .catch(() => {
        if (!cancelled) {
          const fallback = trips.find((t) => t.device_id === clickedDeviceId);
          if (fallback) {
            setDeviceTrips([fallback]);
            setSelectedTripId(fallback.trip_id);
          }
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingDeviceTrips(false);
      });

    return () => {
      cancelled = true;
    };
  }, [clickedDeviceId, trips]);

  // 2. Fetch specific trip details (waypoints, halts, compliance) on selectedTripId change
  useEffect(() => {
    if (!selectedTripId) {
      setTripDetails(null);
      return;
    }

    let cancelled = false;
    setLoadingTrip(true);
    fetch(`/api/v1/trips/details/${encodeURIComponent(selectedTripId)}`, {
      headers: { 'ngrok-skip-browser-warning': 'true' },
    })
      .then((r) => r.json())
      .then((data: TripDetails) => {
        if (!cancelled) {
          setTripDetails(data);
          const isLive = data.status === 'IN_PROGRESS';
          setReplayIdx(isLive && data.waypoints && data.waypoints.length > 0 ? data.waypoints.length - 1 : 0);
          setPlaying(false);
        }
      })
      .catch(() => { })
      .finally(() => {
        if (!cancelled) setLoadingTrip(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedTripId]);

  const selectedTrip = selectedTripId
    ? deviceTrips.find((t) => t.trip_id === selectedTripId) || tripDetails || null
    : null;

  useEffect(() => {
    if (!playing || !tripDetails || tripDetails.waypoints.length === 0) return;
    const ms = Math.max(80, Math.round(600 / speedMult));
    const t = setInterval(() => {
      setReplayIdx((prev) => {
        if (prev >= tripDetails.waypoints.length - 1) {
          setPlaying(false);
          return prev;
        }
        return prev + 1;
      });
    }, ms);
    return () => clearInterval(t);
  }, [playing, speedMult, tripDetails]);

  const currentWp =
    tripDetails?.waypoints[
    Math.min((tripDetails.waypoints.length || 1) - 1, replayIdx)
    ] ?? null;

  const isHaltedAtWp = useMemo(() => {
    if (!currentWp || !tripDetails?.halts) return false;
    const wpIso = currentWp.timestamp;
    if (!wpIso) return false;
    const wpMs = new Date(wpIso).getTime();
    if (isNaN(wpMs)) return false;
    return tripDetails.halts.some((h) => {
      const startMs = h.start_time ? new Date(h.start_time).getTime() : 0;
      const endMs = h.end_time ? new Date(h.end_time).getTime() : Infinity;
      return wpMs >= startMs && wpMs <= endMs;
    });
  }, [currentWp, tripDetails?.halts]);

  const replayTelemetry = useMemo(() => {
    if (!selectedVehicle) return undefined;
    const rawTemp = currentWp?.cargo_temp_c;
    const temp =
      rawTemp !== null && rawTemp !== undefined && !isNaN(Number(rawTemp))
        ? Number(rawTemp)
        : selectedVehicle.current_temp_c != null
        ? Number(selectedVehicle.current_temp_c)
        : 29.0;
    const minT = selectedVehicle.target_min_c ?? 2.0;
    const maxT = selectedVehicle.target_max_c ?? 8.0;
    const tempBand =
      temp > maxT ? 'above_critical' : temp < minT ? 'below_critical' : 'optimal';
    const doorState: 'open' | 'closed' = isHaltedAtWp ? 'open' : 'closed';
    const speed = isHaltedAtWp
      ? 0
      : currentWp?.speed_kmh != null
      ? Number(currentWp.speed_kmh)
      : 0;
    const isAlert = temp > maxT || isHaltedAtWp;

    return {
      callsign: selectedVehicle.device_id,
      temperatureC: temp,
      tempBand: tempBand as 'optimal' | 'above_critical' | 'below_critical',
      doorState,
      compressorActive: true,
      speedKmh: speed,
      vehicleMoving: speed > 1.0,
      isAlertActive: isAlert,
      isDoorTampered: isHaltedAtWp,
      accentHex: 0x2563eb,
      cutawayEnabled: false,
      cameraPreset: 'overview' as const,
    };
  }, [selectedVehicle, currentWp, isHaltedAtWp]);

  async function handleCreateGeofence(e: React.FormEvent) {
    e.preventDefault();
    setCreatingGf(true);
    try {
      await fetch('/api/v1/geofences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: gfName.trim(),
          device_id: gfDevice,
          geometry: {
            type: 'CIRCLE',
            center: { lat: Number(gfLat), lng: Number(gfLng) },
            radius_m: Number(gfRadius),
          },
          rules: {
            enter: true,
            exit: true,
            dwell: true,
            dwell_seconds: 300,
            max_speed_kmh: 45,
            temp_min_c: 2,
            temp_max_c: 8,
          },
          enabled: true,
        }),
      });
      await onRefreshGeofences();
    } finally {
      setCreatingGf(false);
    }
  }

  async function handleDeleteGeofence(id: number) {
    await fetch(`/api/v1/geofences/${id}`, { method: 'DELETE' });
    await onRefreshGeofences();
  }

  const handleOpenVehicleTrip = (deviceId: string) => {
    onSelectDevice(deviceId);
    setClickedDeviceId(deviceId);
    setSubtab('replay');
  };

  return (
    <div className="space-y-6">
      <CargoHeroBanner moduleId="trips">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">
              {selectedVehicle
                ? `${selectedVehicle.device_id} Trip & Corridor Map`
                : 'Trips & Transport Vehicle Readings'}
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              {selectedVehicle
                ? `Full route manifest, chamber telemetry, halts, and live street map for ${selectedVehicle.vehicle_name}.`
                : 'Select any vehicle below to inspect its full route information, halts, metrics, and interactive corridor map.'}
            </p>
          </div>

          {selectedVehicle ? (
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs shadow-2xs">
                <Truck className="h-3.5 w-3.5 text-blue-600" />
                <span className="font-semibold text-slate-700">Vehicle:</span>
                <select
                  value={clickedDeviceId || ''}
                  onChange={(e) => {
                    setPlaying(false);
                    setClickedDeviceId(e.target.value);
                  }}
                  className="font-mono font-bold text-blue-700 bg-transparent outline-none cursor-pointer"
                >
                  {fleetRows.map((v) => (
                    <option key={v.device_id} value={v.device_id}>
                      {v.device_id} · {v.vehicle_name} ({v.connectivity === 'ONLINE' ? 'ONLINE' : 'OFFLINE'})
                    </option>
                  ))}
                </select>
              </div>

              <button
                type="button"
                onClick={() => {
                  setPlaying(false);
                  setClickedDeviceId(null);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 cursor-pointer whitespace-nowrap shrink-0"
              >
                <ArrowLeft className="h-3.5 w-3.5" /> Back to All Vehicles
              </button>
            </div>
          ) : (
            <span className="font-mono text-xs font-medium text-slate-500 tabular-nums">
              {fleetRows.length} vehicles · {trips.length} active manifests
            </span>
          )}
        </div>
      </CargoHeroBanner>

      {/* Initial View: ONLY Vehicle Readings Table */}
      {!selectedVehicle && (
        <section className="surface-panel rounded-xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-base font-semibold text-slate-900">
              Active Fleet Vehicle Readings
            </h2>
            <span className="text-xs text-slate-500">
              Click a vehicle row to view full trip map and route data
            </span>
          </div>

          <div className="overflow-x-auto border-t border-slate-200 pt-3">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-[11px] font-semibold text-slate-500 whitespace-nowrap">
                  <th className="py-2.5 pr-3 min-w-[150px]">Vehicle</th>
                  <th className="py-2.5 px-3 min-w-[130px]">Vehicle Status</th>
                  <th className="py-2.5 px-3 min-w-[120px]">Live Temperature</th>
                  <th className="py-2.5 px-3 min-w-[160px]">Location</th>
                  <th className="py-2.5 px-3 min-w-[160px]">What We Transporting</th>
                  <th className="py-2.5 px-3 min-w-[150px]">Signal Strength</th>
                  <th className="py-2.5 pl-3 text-right min-w-[110px]">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {fleetRows.map((row) => {
                  const trip = trips.find((t) => t.device_id === row.device_id);
                  const hasTemp = row.current_temp_c !== null && row.current_temp_c !== undefined && !isNaN(row.current_temp_c);
                  const isCritical =
                    row.status === 'EXCURSION' ||
                    (hasTemp && (row.current_temp_c! > row.target_max_c || row.current_temp_c! < row.target_min_c)) ||
                    row.security === 'OPEN';
                  const statusColor =
                    row.operational_state === 'OFFLINE'
                      ? 'text-slate-500'
                      : isCritical
                        ? 'text-rose-600'
                        : row.status === 'WARNING'
                          ? 'text-amber-600'
                          : 'text-emerald-700';

                  return (
                    <tr
                      key={row.device_id}
                      onClick={() => handleOpenVehicleTrip(row.device_id)}
                      className="cursor-pointer transition-colors hover:bg-blue-50/60"
                    >
                      <td className="py-3 pr-3 font-mono">
                        <span className="font-bold text-blue-700">{row.device_id}</span>
                      </td>

                      <td className="py-3 px-3 font-mono text-[11px]">
                        <div className={`font-bold ${statusColor}`}>
                          {row.operational_state.replace('_', ' ')} ·{' '}
                          {isCritical ? 'CRITICAL' : row.status}
                        </div>
                      </td>

                      <td className="py-3 px-3 font-mono tabular-nums">
                        <div className={`text-sm font-bold ${statusColor}`}>
                          {hasTemp ? `${row.current_temp_c!.toFixed(2)}°C` : '--.-°C (Standby)'}
                        </div>
                      </td>

                      <td className="py-3 px-3">
                        <div className="font-medium text-slate-900">{row.address}</div>
                        <div className="mt-0.5 font-mono text-[11px] text-slate-500">
                          {row.lat != null ? row.lat.toFixed(4) : '0.0000'}, {row.lng != null ? row.lng.toFixed(4) : '0.0000'}
                        </div>
                      </td>

                      <td className="py-3 px-3">
                        <VehicleCargoBadge
                          vehicleName={row.vehicle_name}
                          cargoType={row.cargo_type}
                          compact
                        />
                        <div className="mt-1 font-mono text-[11px] text-slate-500 tabular-nums">
                          Door {row.security} · {row.speed_kmh != null ? row.speed_kmh.toFixed(0) : '0'} km/h
                        </div>
                      </td>

                      <td className="py-3 px-3">
                        <SignalStrengthDisplay
                          rssiDbm={row.network_rssi_dbm}
                          offline={row.connectivity === 'OFFLINE'}
                        />
                      </td>

                      <td className="py-3 pl-3 text-right">
                        <span className="inline-flex items-center rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-700">
                          View Map &amp; Info
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Detail View: Shown ONLY after clicking a vehicle row */}
      {selectedVehicle && (
        <section className="surface-panel rounded-xl p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="font-mono text-lg font-bold text-blue-700">
                  {selectedVehicle.device_id}
                </span>
                <span className="font-display text-lg font-semibold text-slate-900">
                  {selectedVehicle.vehicle_name}
                </span>
                <VehicleCargoBadge
                  vehicleName={selectedVehicle.vehicle_name}
                  cargoType={selectedVehicle.cargo_type}
                />
                {selectedTrip && (
                  <span className="font-mono text-xs text-slate-500">
                    · {selectedTrip.trip_id}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-600">
                {selectedTrip
                  ? `${selectedTrip.origin} → ${selectedTrip.destination}`
                  : `Current location: ${selectedVehicle.address} (${selectedVehicle.lat != null ? selectedVehicle.lat.toFixed(4) : '17.6078'}, ${selectedVehicle.lng != null ? selectedVehicle.lng.toFixed(4) : '78.0791'})`}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => onExportCsv(selectedVehicle.device_id)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                <Download className="h-3.5 w-3.5" /> Export CSV
              </button>
              <button
                type="button"
                onClick={() => {
                  onSelectDevice(selectedVehicle.device_id);
                  onNavigateModule('vehicle-readings', true);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                Open {selectedVehicle.device_id} Status
              </button>

              {tripDetails && (
                <div className="flex items-center rounded-lg border border-slate-200 bg-slate-100 p-0.5 text-xs">
                  {(
                    [
                      ['replay', 'Route Map'],
                      ['metrics', 'Trip Metrics'],
                      ['geofences', 'Geofences'],
                      ['events', 'Halts & Events'],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setSubtab(id)}
                      className={`rounded-md px-3 py-1.5 font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${subtab === id
                          ? 'bg-blue-600 text-white shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                        }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Multi-Trip Manifest Selector & Trips Cards Strip */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-200 bg-linear-to-r from-blue-50/70 to-slate-50 p-3.5 text-xs shadow-xs">
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-semibold text-slate-800 flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5 text-blue-600" />
                  Select Trip Manifest:
                </span>

                {loadingDeviceTrips ? (
                  <span className="text-slate-500 font-medium animate-pulse">Loading journey manifests...</span>
                ) : deviceTrips.length === 0 ? (
                  <span className="text-slate-500">No past trip records found for this vehicle.</span>
                ) : (
                  <div className="relative">
                    <select
                      value={selectedTripId || ''}
                      onChange={(e) => {
                        setPlaying(false);
                        setSelectedTripId(e.target.value);
                      }}
                      aria-label="Select trip journey"
                      className="h-8.5 rounded-lg border border-blue-300 bg-white px-3 pr-8 text-xs font-semibold text-slate-900 shadow-xs cursor-pointer hover:border-blue-500 focus:border-blue-600 focus:outline-hidden"
                    >
                      {deviceTrips.map((t) => (
                        <option key={t.trip_id} value={t.trip_id}>
                          {t.trip_id} · {t.origin} → {t.destination} ({t.status === 'COMPLETED' ? 'COMPLETED' : t.status === 'IN_PROGRESS' ? (((selectedVehicle?.speed_kmh ?? 0) >= 2.0 && selectedVehicle?.connectivity === 'ONLINE') ? '● IN TRANSIT' : '● AT STOP') : t.status})
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2">
                <span className="rounded-md bg-blue-100/70 px-2.5 py-1 text-[11px] font-mono font-bold text-blue-800 border border-blue-200">
                  {deviceTrips.length} {deviceTrips.length === 1 ? 'Trip Available' : 'Trips Available'}
                </span>
                {selectedTrip && (
                  <span
                    className={`rounded-md px-2.5 py-1 text-[11px] font-mono font-bold ${selectedTrip.status === 'COMPLETED'
                        ? 'bg-slate-100 text-slate-700 border border-slate-300'
                        : selectedTrip.status === 'IN_PROGRESS'
                          ? (((selectedVehicle?.speed_kmh ?? 0) >= 2.0 && selectedVehicle?.connectivity === 'ONLINE')
                            ? 'bg-emerald-100 text-emerald-800 border border-emerald-300 animate-pulse'
                            : 'bg-amber-100 text-amber-800 border border-amber-300')
                          : selectedTrip.status === 'DELAYED'
                            ? 'bg-amber-100 text-amber-800 border border-amber-300'
                            : 'bg-slate-200 text-slate-700'
                      }`}
                  >
                    {selectedTrip.status === 'COMPLETED'
                      ? 'TRIP COMPLETED'
                      : selectedTrip.status === 'IN_PROGRESS'
                        ? (((selectedVehicle?.speed_kmh ?? 0) >= 2.0 && selectedVehicle?.connectivity === 'ONLINE')
                          ? '● LIVE IN TRANSIT'
                          : '● AT STOP / HALTED')
                        : selectedTrip.status}
                  </span>
                )}
              </div>
            </div>

            {/* If vehicle has multiple trips today, render individual trip cards */}
            {deviceTrips.length > 1 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                {deviceTrips.map((t, idx) => {
                  const isSel = t.trip_id === selectedTripId;
                  const isDone = t.status === 'COMPLETED';
                  const isLive = t.status === 'IN_PROGRESS';
                  return (
                    <div
                      key={t.trip_id}
                      onClick={() => {
                        setPlaying(false);
                        setSelectedTripId(t.trip_id);
                      }}
                      className={`surface-row rounded-xl p-3 text-xs cursor-pointer transition-all border ${isSel
                          ? 'border-blue-600 bg-blue-50/70 shadow-xs ring-1 ring-blue-600'
                          : 'border-slate-200 hover:border-blue-300 hover:bg-slate-50'
                        }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-mono font-bold text-blue-700">
                          Leg {idx + 1} · {t.trip_id}
                        </span>
                        <span
                          className={`rounded px-2 py-0.5 text-[10px] font-bold ${isDone
                              ? 'bg-slate-100 text-slate-700 border border-slate-300'
                              : isLive
                                ? 'bg-emerald-100 text-emerald-800 border border-emerald-300 animate-pulse'
                                : 'bg-amber-100 text-amber-800'
                            }`}
                        >
                          {isDone ? 'COMPLETED' : isLive ? '● LIVE' : t.status}
                        </span>
                      </div>
                      <div className="mt-1 font-semibold text-slate-900 truncate">
                        {t.origin} → {t.destination}
                      </div>
                      <div className="mt-1.5 flex items-center justify-between text-[11px] font-mono text-slate-500">
                        <span>{formatTripTime(t.start_time)} – {formatTripTime(t.end_time)}</span>
                        <span>{t.total_distance_km ? `${Number(t.total_distance_km).toFixed(1)} km` : ''} · {t.duration_minutes ? `${t.duration_minutes}m` : ''}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Trip Telemetry & Manifest Reading Summary Strip */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-5 text-xs">
            <div className="surface-row rounded-lg p-3">
              <div className="text-slate-500">
                {selectedTrip && selectedTrip.status === 'COMPLETED' ? 'Trip Temperature' : 'Live Temperature'}
              </div>
              <div className="mt-1 font-mono text-lg font-bold text-slate-900 tabular-nums">
                {selectedTrip && selectedTrip.status === 'COMPLETED' ? (
                  tripDetails?.mkt_temp_c !== null && tripDetails?.mkt_temp_c !== undefined
                    ? `${Number(tripDetails.mkt_temp_c).toFixed(2)}°C`
                    : '--.-°C (Standby)'
                ) : selectedVehicle.current_temp_c !== null && selectedVehicle.current_temp_c !== undefined ? (
                  `${selectedVehicle.current_temp_c.toFixed(2)}°C`
                ) : (
                  '--.-°C (Probe Standby)'
                )}
              </div>
            </div>

            <div className="surface-row rounded-lg p-3">
              <div className="text-slate-500">
                {selectedTrip && selectedTrip.status === 'COMPLETED' ? 'Trip Status / Security' : 'Status / Door'}
              </div>
              <div className="mt-1 font-mono text-sm font-bold text-slate-900">
                {selectedTrip && selectedTrip.status === 'COMPLETED'
                  ? 'COMPLETED · SEALED'
                  : `${selectedVehicle.connectivity === 'OFFLINE' ? 'AT STOP (Offline)' : selectedVehicle.status} · ${selectedVehicle.security}`}
              </div>
            </div>

            <div className="surface-row rounded-lg p-3">
              <div className="text-slate-500">
                {selectedTrip && selectedTrip.status === 'COMPLETED'
                  ? (subtab === 'replay' && (playing || replayIdx > 0) ? `Replay Speed (Wp ${replayIdx + 1})` : 'Trip Avg Speed')
                  : 'Speed'}
              </div>
              <div className="mt-1 font-mono text-lg font-bold text-slate-900 tabular-nums">
                {selectedTrip && selectedTrip.status === 'COMPLETED' ? (
                  subtab === 'replay' && (playing || replayIdx > 0) && currentWp ? (
                    `${Number(currentWp.speed_kmh ?? 0).toFixed(1)} km/h`
                  ) : (
                    <span>
                      {`${Number(tripDetails?.avg_speed_kmh ?? selectedTrip.avg_speed_kmh ?? 0).toFixed(1)} km/h`}
                      <span className="text-xs text-slate-500 font-normal ml-1.5">
                        (Max {Number(tripDetails?.max_speed_kmh ?? selectedTrip.max_speed_kmh ?? 0).toFixed(0)})
                      </span>
                    </span>
                  )
                ) : (
                  selectedVehicle.connectivity === 'OFFLINE' || (selectedVehicle.speed_kmh ?? 0) < 0.5
                    ? '0.0 km/h (Stopped)'
                    : `${(selectedVehicle.speed_kmh ?? 0).toFixed(1)} km/h`
                )}
              </div>
            </div>

            <div className="surface-row rounded-lg p-3">
              <div className="text-slate-500">
                {selectedTrip && selectedTrip.status === 'COMPLETED' ? 'Total Distance' : 'Distance / Halts'}
              </div>
              <div className="mt-1 font-mono text-lg font-bold text-slate-900 tabular-nums">
                {`${Number(tripDetails?.total_distance_km ?? selectedTrip?.total_distance_km ?? 0).toFixed(1)} km`}
                <span className="text-xs text-slate-500 font-normal ml-1.5">
                  ({tripDetails?.duration_minutes ?? selectedTrip?.duration_minutes ?? 0}m)
                </span>
              </div>
            </div>

            <div className="surface-row rounded-lg p-3">
              <div className="text-slate-500">Location</div>
              <div className="mt-1 font-mono text-sm font-bold text-slate-900 truncate" title={selectedTrip ? selectedTrip.destination : selectedVehicle.address}>
                {selectedTrip ? selectedTrip.destination : selectedVehicle.address}
              </div>
            </div>
          </div>

          {loadingTrip && (
            <div className="py-8 text-center text-xs text-slate-500">
              Loading route waypoints and corridor telemetry...
            </div>
          )}

          {/* Standby / No-Active-Trip Live Position Map */}
          {!loadingTrip && !tripDetails && (
            <div className="space-y-3">
              <LiveFleetMap
                mode="live"
                fleetRows={fleetRows}
                selectedDeviceId={selectedVehicle.device_id}
                geofences={geofences}
                heightClass="h-[400px]"
              />
              <p className="text-xs text-slate-500">
                This unit is currently assigned to standby corridor monitoring without an active scheduled trip manifest. Live GPS coordinates and geofence perimeter are displayed above.
              </p>
            </div>
          )}

          {/* Trip Map & Details */}
          {!loadingTrip && tripDetails && subtab === 'replay' && (
            <div className="space-y-4">
              {/* Trip Replay Visualization Mode Toggle */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-xs font-semibold text-slate-700">
                  Journey Route &amp; 3D Twin Synchronized Replay
                </div>
                <div
                  role="group"
                  aria-label="Trip replay visualization modes"
                  className="flex items-center rounded-lg border border-slate-300 bg-slate-100 p-0.5 text-xs font-semibold"
                >
                  <button
                    type="button"
                    onClick={() => setTripViewMode('map')}
                    aria-pressed={tripViewMode === 'map'}
                    className={`min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 rounded-md px-3 py-1.5 transition-colors cursor-pointer ${
                      tripViewMode === 'map'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    2D Route Map
                  </button>
                  <button
                    type="button"
                    onClick={() => setTripViewMode('3d')}
                    aria-pressed={tripViewMode === '3d'}
                    className={`min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 rounded-md px-3 py-1.5 transition-colors cursor-pointer ${
                      tripViewMode === '3d'
                        ? 'bg-white text-blue-700 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    3D Time Machine
                  </button>
                  <button
                    type="button"
                    onClick={() => setTripViewMode('split')}
                    aria-pressed={tripViewMode === 'split'}
                    className={`min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 rounded-md px-3 py-1.5 transition-colors cursor-pointer ${
                      tripViewMode === 'split'
                        ? 'bg-white text-blue-700 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Split View
                  </button>
                </div>
              </div>

              {tripViewMode === 'map' && (
                <LiveFleetMap
                  mode="trip"
                  tripWaypoints={tripDetails.waypoints}
                  tripHalts={tripDetails.halts}
                  geofences={geofences}
                  replayIndex={replayIdx}
                  heightClass="h-[400px]"
                  focusedLabel={selectedVehicle.device_id}
                  focusedVehicleName={selectedVehicle.vehicle_name}
                  focusedCargoType={selectedVehicle.cargo_type}
                  focusedConnectivity={selectedVehicle.connectivity}
                />
              )}

              {tripViewMode === '3d' && (
                <Viewport3D
                  mode="replay"
                  telemetry={replayTelemetry}
                  heightClass="h-[400px]"
                />
              )}

              {tripViewMode === 'split' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <LiveFleetMap
                    mode="trip"
                    tripWaypoints={tripDetails.waypoints}
                    tripHalts={tripDetails.halts}
                    geofences={geofences}
                    replayIndex={replayIdx}
                    heightClass="h-[400px]"
                    focusedLabel={selectedVehicle.device_id}
                    focusedVehicleName={selectedVehicle.vehicle_name}
                    focusedCargoType={selectedVehicle.cargo_type}
                    focusedConnectivity={selectedVehicle.connectivity}
                  />
                  <Viewport3D
                    mode="replay"
                    telemetry={replayTelemetry}
                    heightClass="h-[400px]"
                  />
                </div>
              )}

              <div className="surface-row rounded-lg p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        if (!playing && tripDetails && replayIdx >= tripDetails.waypoints.length - 1) {
                          setReplayIdx(0);
                        }
                        setPlaying((p) => !p);
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 font-semibold text-white hover:bg-blue-700 cursor-pointer whitespace-nowrap shrink-0"
                    >
                      {playing ? (
                        <>
                          <Pause className="h-3.5 w-3.5" /> Pause
                        </>
                      ) : (
                        <>
                          <Play className="h-3.5 w-3.5" /> Play Replay
                        </>
                      )}
                    </button>

                    <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-0.5 font-mono text-[11px]">
                      {([1, 2, 5, 10] as const).map((mult) => (
                        <button
                          key={mult}
                          type="button"
                          onClick={() => setSpeedMult(mult)}
                          className={`rounded px-2.5 py-1 cursor-pointer ${speedMult === mult
                              ? 'bg-blue-600 text-white font-semibold'
                              : 'text-slate-600 hover:text-slate-900'
                            }`}
                        >
                          {mult}x
                        </button>
                      ))}
                    </div>
                  </div>

                  {currentWp && (
                    <div className="flex items-center gap-5 font-mono text-xs tabular-nums">
                      <span className="text-blue-700 font-bold">
                        {currentWp.cargo_temp_c !== null && currentWp.cargo_temp_c !== undefined && !isNaN(Number(currentWp.cargo_temp_c))
                          ? `${Number(currentWp.cargo_temp_c).toFixed(2)}°C`
                          : '--.-°C (Standby)'}
                      </span>
                      <span className="text-slate-800">
                        {currentWp.speed_kmh != null ? `${Number(currentWp.speed_kmh).toFixed(0)} km/h` : '0 km/h'}
                      </span>
                      <span className="text-slate-500">
                        Waypoint {replayIdx + 1} / {tripDetails.waypoints.length}
                      </span>
                    </div>
                  )}
                </div>

                <input
                  type="range"
                  min={0}
                  max={Math.max(0, tripDetails.waypoints.length - 1)}
                  value={replayIdx}
                  onChange={(e) => {
                    setPlaying(false);
                    setReplayIdx(Number(e.target.value));
                  }}
                  aria-label="Trip replay timeline"
                  className="w-full accent-blue-600 cursor-pointer"
                />

                <div className="flex items-center justify-between text-[11px] font-mono text-slate-600 pt-1">
                  <span className="font-semibold text-slate-800 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                    Start: {formatTripTime(tripDetails.start_time || tripDetails.waypoints[0]?.timestamp)}
                  </span>
                  <span className="text-slate-500 font-medium">
                    {currentWp?.timestamp ? `Time: ${formatTripTime(currentWp.timestamp)}` : ''}
                  </span>
                  <span className="font-semibold text-slate-800 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                    End: {formatTripTime(tripDetails.end_time || tripDetails.waypoints[tripDetails.waypoints.length - 1]?.timestamp)}
                  </span>
                </div>
              </div>
            </div>
          )}

          {!loadingTrip && tripDetails && subtab === 'metrics' && (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 text-xs">
              {[
                ['Total Distance', `${Number(tripDetails.total_distance_km ?? 0).toFixed(1)} km`],
                ['Duration', `${tripDetails.duration_minutes ?? 0} mins`],
                ['Trip Start Time', formatTripTime(tripDetails.start_time || tripDetails.waypoints[0]?.timestamp)],
                ['Trip End Time', formatTripTime(tripDetails.end_time || tripDetails.waypoints[tripDetails.waypoints.length - 1]?.timestamp)],
                [
                  'Mean Kinetic Temp',
                  tripDetails.mkt_temp_c != null ? `${Number(tripDetails.mkt_temp_c).toFixed(2)}°C` : '--.-°C (Standby)',
                ],
                [
                  'Min / Max Temp',
                  tripDetails.min_temp_c != null && tripDetails.max_temp_c != null
                    ? `${Number(tripDetails.min_temp_c).toFixed(1)}° / ${Number(tripDetails.max_temp_c).toFixed(1)}°C`
                    : '--.-° / --.-°C (Standby)',
                ],
                [
                  'Avg / Max Speed',
                  `${Number(tripDetails.avg_speed_kmh ?? 0).toFixed(1)} / ${Number(tripDetails.max_speed_kmh ?? 0).toFixed(0)} km/h`,
                ],
                ['Detected Halts', `${tripDetails.halt_count ?? 0}`],
              ].map(([label, val]) => (
                <div key={label} className="surface-row rounded-lg p-4">
                  <div className="text-slate-500">{label}</div>
                  <div className="mt-1 font-mono text-xl font-bold text-slate-900 tabular-nums">
                    {val}
                  </div>
                </div>
              ))}
            </div>
          )}

          {!loadingTrip && tripDetails && subtab === 'geofences' && (
            <div className="space-y-4">
              <form
                onSubmit={handleCreateGeofence}
                className="surface-row grid grid-cols-1 gap-3 rounded-lg p-4 text-xs sm:grid-cols-5"
              >
                <input
                  required
                  value={gfName}
                  onChange={(e) => setGfName(e.target.value)}
                  placeholder="Zone Name"
                  className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-slate-900 sm:col-span-2"
                />
                <input
                  required
                  value={gfLat}
                  onChange={(e) => setGfLat(e.target.value)}
                  placeholder="Lat"
                  className="h-9 rounded-lg border border-slate-200 bg-white px-3 font-mono text-slate-900"
                />
                <input
                  required
                  value={gfLng}
                  onChange={(e) => setGfLng(e.target.value)}
                  placeholder="Lng"
                  className="h-9 rounded-lg border border-slate-200 bg-white px-3 font-mono text-slate-900"
                />
                <button
                  type="submit"
                  disabled={creatingGf}
                  className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-3 font-semibold text-white hover:bg-blue-700 cursor-pointer"
                >
                  <Plus className="h-3.5 w-3.5" /> Add Zone
                </button>
                <div className="sm:col-span-5 flex items-center gap-4 text-slate-600">
                  <span>Device Scope:</span>
                  <input
                    value={gfDevice}
                    onChange={(e) => setGfDevice(e.target.value)}
                    className="h-8 w-24 rounded border border-slate-200 bg-white px-2 font-mono text-slate-900"
                  />
                  <span>Radius (m):</span>
                  <input
                    type="number"
                    value={gfRadius}
                    onChange={(e) => setGfRadius(e.target.value)}
                    className="h-8 w-24 rounded border border-slate-200 bg-white px-2 font-mono text-slate-900"
                  />
                </div>
              </form>

              <div className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
                {geofences.map((gf) => (
                  <div
                    key={gf.id}
                    className="flex items-center justify-between px-4 py-3 text-xs"
                  >
                    <div className="flex items-center gap-3">
                      <Shield className="h-4 w-4 text-blue-600" />
                      <div>
                        <div className="font-medium text-slate-900">{gf.name}</div>
                        <div className="font-mono text-[11px] text-slate-500">
                          {gf.geometry.type} · Scope: {gf.device_id}
                          {gf.geometry.radius_m ? ` · ${gf.geometry.radius_m}m` : ''}
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDeleteGeofence(gf.id)}
                      aria-label={`Delete geofence ${gf.name}`}
                      className="rounded p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 cursor-pointer"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!loadingTrip && tripDetails && subtab === 'events' && (
            <div className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white text-xs">
              {tripDetails.halts.length === 0 ? (
                <div className="p-5 text-slate-500">
                  No unscheduled halts detected on this corridor manifest.
                </div>
              ) : (
                tripDetails.halts.map((h, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between px-4 py-3"
                  >
                    <div className="flex items-center gap-3">
                      <MapPin className="h-4 w-4 text-amber-600 shrink-0" />
                      <div>
                        <div className="font-medium text-slate-900">{h.location_name}</div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-2 font-mono text-[11px] text-slate-500">
                          <span className="font-semibold text-amber-800 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">
                            Halt: {formatTripTime(h.start_time)} – {formatTripTime(h.end_time)}
                          </span>
                          <span>Duration: {h.duration_minutes} mins</span>
                          {h.lat != null && h.lng != null && (
                            <span>({Number(h.lat).toFixed(4)}, {Number(h.lng).toFixed(4)})</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="font-mono font-semibold text-slate-800 tabular-nums">
                      {h.start_temp_c != null && h.end_temp_c != null
                        ? `${Number(h.start_temp_c).toFixed(1)}°C → ${Number(h.end_temp_c).toFixed(1)}°C`
                        : '--.-°C'}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
};
