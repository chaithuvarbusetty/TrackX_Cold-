import React, { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, Box, Download, Navigation } from 'lucide-react';
import type {
  DailyTripLeg,
  FleetOverviewPayload,
  FleetTableRow,
  GeofenceRecord,
  ModuleId,
} from '../shared/types';
import { getVehicleCargoProfile, type VehicleBodyType } from '../utils/vehicleCargo';
import { LiveFleetMap } from './LiveFleetMap';
import { Viewport3D } from './LazyViewport3D';
import {
  CargoHeroBanner,
  SignalStrengthDisplay,
  VehicleCargoBadge,
  VehicleSilhouetteSvg,
} from './CargoShell';

interface LiveTrackingPageProps {
  overview: FleetOverviewPayload;
  selectedDeviceId: string;
  onSelectDevice: (deviceId: string) => void;
  onNavigateModule: (mod: ModuleId, openDetail?: boolean) => void;
  onExportCsv: (deviceId: string) => void;
  geofences: GeofenceRecord[];
}

const VEHICLE_SHAPE_LEGEND: Array<{
  bodyType: VehicleBodyType;
  shapeName: string;
  accentHex: string;
  purpose: string;
}> = [
    {
      bodyType: 'semi-reefer',
      shapeName: 'Heavy Reefer Semi',
      accentHex: '#2563eb',
      purpose: 'Long-haul bulk temperature-controlled shipments (mRNA Vaccines & Diagnostic Reagents)',
    },
    {
      bodyType: 'box-truck',
      shapeName: 'Reefer Box Truck',
      accentHex: '#0d9488',
      purpose: 'Regional urban depot distribution (Insulin & Biologics)',
    },
    {
      bodyType: 'sprinter-van',
      shapeName: 'Cold Sprinter Van',
      accentHex: '#0284c7',
      purpose: 'High-priority rapid clinical corridors (Monoclonal Antibodies, Pediatric Vaccines & Oncology)',
    },
    {
      bodyType: 'cryo-carrier',
      shapeName: 'Insulated Carrier',
      accentHex: '#0d9488',
      purpose: 'Dual-sealed continuous audit custody (Plasma Derivatives & Clinical Trial Samples)',
    },
  ];

export const LiveTrackingPage: React.FC<LiveTrackingPageProps> = ({
  overview,
  selectedDeviceId,
  onSelectDevice,
  onNavigateModule,
  onExportCsv,
  geofences,
}) => {
  const { kpis, fleet_table } = overview;
  const focused: FleetTableRow | undefined =
    fleet_table.find((r) => r.device_id === selectedDeviceId) ?? fleet_table[0];

  const [viewMode, setViewMode] = useState<'map' | '3d' | 'split'>('map');
  const [dailyLegs, setDailyLegs] = useState<DailyTripLeg[]>([]);

  const liveTelemetry = useMemo(() => {
    if (!focused) return undefined;
    const temp =
      focused.current_temp_c != null && !isNaN(Number(focused.current_temp_c))
        ? Number(focused.current_temp_c)
        : 29.0;
    const maxT = focused.target_max_c ?? 8.0;
    const minT = focused.target_min_c ?? 2.0;
    const tempBand =
      temp > maxT ? 'above_critical' : temp < minT ? 'below_critical' : 'optimal';
    const isAlert =
      focused.status === 'EXCURSION' || temp > maxT || focused.security === 'OPEN';
    return {
      callsign: focused.device_id,
      temperatureC: temp,
      tempBand: tempBand as 'optimal' | 'above_critical' | 'below_critical',
      doorState: (focused.security === 'OPEN' ? 'open' : 'closed') as 'open' | 'closed',
      compressorActive: focused.compressor_active ?? true,
      speedKmh: focused.speed_kmh != null ? Number(focused.speed_kmh) : 0,
      vehicleMoving: (focused.speed_kmh ?? 0) > 1.0,
      isAlertActive: isAlert,
      isDoorTampered: focused.security === 'OPEN',
      accentHex: 0x2563eb,
      cutawayEnabled: false,
    };
  }, [focused]);

  useEffect(() => {
    if (!selectedDeviceId) return;
    let cancelled = false;
    fetch(`/api/v1/trips/daily/${encodeURIComponent(selectedDeviceId)}`, {
      headers: { 'ngrok-skip-browser-warning': 'true' },
    })
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled && data.legs) {
          setDailyLegs(data.legs);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [selectedDeviceId]);

  return (
    <div className="space-y-6">
      <CargoHeroBanner moduleId="live-tracking">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
              Live Fleet Tracking
            </h1>
            <p className="mt-1.5 text-sm text-slate-600">
              Real-time GPS coordinates, distinct vehicle shapes with cargo item badges, chamber temperature, and 4G signal strength.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-6 border-t border-slate-200/80 pt-4 sm:grid-cols-4 lg:border-t-0 lg:pt-0">
            <div>
              <div className="text-xs font-medium text-slate-500">Active Fleet</div>
              <div className="mt-1 font-mono text-2xl font-bold text-slate-900 tabular-nums">
                {kpis.total_vehicles}
              </div>
            </div>
            <div>
              <div className="text-xs font-medium text-slate-500">In Transit</div>
              <div className="mt-1 font-mono text-2xl font-bold text-blue-600 tabular-nums">
                {kpis.in_transit}
              </div>
            </div>
            <div>
              <div className="text-xs font-medium text-slate-500">At stop</div>
              <div className="mt-1 font-mono text-2xl font-bold text-amber-600 tabular-nums">
                {kpis.at_stop}
              </div>
            </div>
            <div>
              <div className="text-xs font-medium text-slate-500">Offline</div>
              <div className="mt-1 font-mono text-2xl font-bold text-rose-600 tabular-nums">
                {kpis.offline}
              </div>
            </div>
          </div>
        </div>
      </CargoHeroBanner>

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-12 items-stretch">
        {/* Interactive Street & Satellite Map */}
        <div className="surface-panel rounded-xl p-5 xl:col-span-8 flex flex-col justify-between gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-base font-semibold text-slate-900">
                Corridor Map &amp; Vehicle Cargo Identification
              </h2>
              <p className="text-xs text-slate-500">
                Each marker shows vehicle body type, transported item, and live chamber temperature
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* View Toggle Buttons */}
              <div
                role="group"
                aria-label="Corridor visualization modes"
                className="flex items-center rounded-lg border border-slate-300 bg-slate-100 p-0.5 text-xs font-semibold"
              >
                <button
                  type="button"
                  onClick={() => setViewMode('map')}
                  aria-pressed={viewMode === 'map'}
                  className={`min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 rounded-md px-3 py-1.5 transition-colors cursor-pointer ${
                    viewMode === 'map'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  2D Map
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('3d')}
                  aria-pressed={viewMode === '3d'}
                  className={`min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 rounded-md px-3 py-1.5 transition-colors cursor-pointer ${
                    viewMode === '3d'
                      ? 'bg-white text-blue-700 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  3D Live Rig
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('split')}
                  aria-pressed={viewMode === 'split'}
                  className={`min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 rounded-md px-3 py-1.5 transition-colors cursor-pointer ${
                    viewMode === 'split'
                      ? 'bg-white text-blue-700 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Split View
                </button>
              </div>

              <div className="hidden sm:flex items-center gap-2 text-xs font-medium text-slate-600 pl-2">
                <span className="text-emerald-700">Optimal (&lt;7.0°C)</span>
                <span aria-hidden="true">·</span>
                <span className="text-amber-600">Warn (≥7.0°C)</span>
                <span aria-hidden="true">·</span>
                <span className="text-rose-600">Crit (&gt;8.0°C)</span>
              </div>
            </div>
          </div>

          {viewMode === 'map' && (
            <LiveFleetMap
              mode="overview"
              fleetRows={fleet_table}
              selectedDeviceId={selectedDeviceId}
              onSelectDevice={onSelectDevice}
              geofences={geofences}
              dailyLegs={dailyLegs}
              heightClass="h-[395px]"
            />
          )}

          {viewMode === '3d' && (
            <Viewport3D
              mode="live"
              telemetry={liveTelemetry}
              heightClass="h-[395px]"
            />
          )}

          {viewMode === 'split' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <LiveFleetMap
                mode="overview"
                fleetRows={fleet_table}
                selectedDeviceId={selectedDeviceId}
                onSelectDevice={onSelectDevice}
                geofences={geofences}
                dailyLegs={dailyLegs}
                heightClass="h-[395px]"
              />
              <Viewport3D
                mode="live"
                telemetry={liveTelemetry}
                heightClass="h-[395px]"
              />
            </div>
          )}

          {dailyLegs.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-2 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-slate-700">Today's Cumulative Traveled Path:</span>
                {dailyLegs.map((leg, idx) => (
                  <span
                    key={leg.trip_id}
                    className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 font-mono text-[11px] font-semibold text-white shadow-2xs"
                    style={{ backgroundColor: ['#1d4ed8', '#059669', '#7c3aed', '#d97706'][idx % 4] }}
                  >
                    Leg {idx + 1}: {leg.origin} → {leg.destination} ({Number(leg.total_distance_km).toFixed(1)} km)
                  </span>
                ))}
              </div>
              <div className="flex items-center gap-1.5 font-mono text-[11px] text-slate-500">
                <span className="inline-block w-4 border-b-2 border-dashed border-slate-500"></span>
                <span>Transit Gap / Off-Manifest</span>
              </div>
            </div>
          )}

          {focused && (
            <div className="flex flex-wrap items-center justify-between gap-4 border-t border-slate-900/10 pt-3.5 text-xs">
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="font-mono text-sm font-bold text-blue-700">
                    {focused.device_id}
                  </span>
                  <span className="font-semibold text-slate-900">
                    {focused.vehicle_name}
                  </span>
                  {focused.device_id === 'GW-001' && (
                    <span className="inline-flex items-center gap-1 rounded bg-cyan-100 px-2 py-0.5 text-[10px] font-bold text-cyan-800 border border-cyan-300 shadow-2xs">
                      <span className="h-1.5 w-1.5 rounded-full bg-cyan-500 animate-pulse"></span>
                      REAL PHYSICAL TRACKER (Quectel EC200U)
                    </span>
                  )}
                  <VehicleCargoBadge
                    vehicleName={focused.vehicle_name}
                    cargoType={focused.cargo_type}
                  />
                </div>
                <div className="flex flex-wrap items-center gap-3 font-mono text-[11px] text-slate-700 tabular-nums">
                  <span className="inline-flex items-center gap-1 text-slate-900 font-medium">
                    <Navigation className="h-3 w-3 text-blue-600" />
                    {focused.address || 'Financial District / Gachibowli, Hyderabad'}
                  </span>
                  <span>
                    {focused.lat ? focused.lat.toFixed(4) : '17.4391'}, {focused.lng ? focused.lng.toFixed(4) : '78.3652'}
                  </span>
                  <span>{focused.speed_kmh ? focused.speed_kmh.toFixed(1) : '0.0'} km/h</span>
                  <span>Door: {focused.security === 'OPEN' ? 'BREACH (OPEN)' : 'SEALED'}</span>
                  {focused.device_id === 'GW-001' && (
                    <span className="text-cyan-700 font-semibold">IMEI: 860738070471994 · GPS Acc: ±20.4m</span>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => onExportCsv(focused.device_id)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800 shadow-xs hover:bg-slate-50 cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Download className="h-3.5 w-3.5" /> Export CSV
                </button>
                <button
                  type="button"
                  onClick={() => onNavigateModule('thermal-status')}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800 shadow-xs hover:bg-slate-50 cursor-pointer whitespace-nowrap shrink-0"
                >
                  Thermal Status
                </button>
                <button
                  type="button"
                  onClick={() => onNavigateModule('vehicle-readings', true)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-700 cursor-pointer whitespace-nowrap shrink-0"
                >
                  Vehicle Status <ArrowUpRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Right: Active Vehicles Rail */}
        <div className="surface-panel rounded-xl p-5 xl:col-span-4 flex flex-col">
          <div className="mb-1.5 border-b border-slate-900/10 pb-2.5">
            <h2 className="font-display text-base font-semibold text-slate-900">
              Fleet Units, Cargo &amp; Signal
            </h2>
            <p className="text-xs text-slate-600">
              Click any vehicle to center map and identify transported cargo
            </p>
          </div>

          <div className="divide-y divide-slate-900/10 flex-1 overflow-y-auto">
            {fleet_table.map((row) => {
              const isSelected = row.device_id === selectedDeviceId;
              const isReal = row.device_id === 'GW-001';
              const hasTemp = row.current_temp_c !== null && row.current_temp_c !== undefined && !isNaN(row.current_temp_c);
              const tempVal = hasTemp ? row.current_temp_c : null;
              const tempColor =
                row.status === 'EXCURSION'
                  ? 'text-rose-700'
                  : row.status === 'WARNING'
                    ? 'text-amber-700'
                    : 'text-emerald-800';

              return (
                <button
                  key={row.device_id}
                  type="button"
                  onClick={() => onSelectDevice(row.device_id)}
                  className={`w-full px-3 py-2 text-left transition-colors cursor-pointer ${isSelected
                      ? 'bg-blue-50 border-l-3 border-l-blue-600'
                      : 'hover:bg-slate-100/70'
                    }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0 flex-1 overflow-hidden">
                      <span className="font-mono text-xs font-bold text-blue-800 shrink-0">
                        {row.device_id}
                      </span>
                      {isReal && row.connectivity === 'ONLINE' && (
                        <span className="inline-flex items-center gap-1 rounded bg-cyan-100 px-1 py-0.5 text-[9px] font-bold text-cyan-800 border border-cyan-300 shrink-0">
                          <span className="h-1.5 w-1.5 rounded-full bg-cyan-500 animate-pulse"></span>
                          LIVE
                        </span>
                      )}
                      <VehicleCargoBadge
                        vehicleName={row.vehicle_name}
                        cargoType={row.cargo_type}
                        compact
                      />
                    </div>
                    {hasTemp && tempVal !== null ? (
                      <span className={`font-mono text-sm font-bold tabular-nums shrink-0 ml-1 ${tempColor}`}>
                        {tempVal.toFixed(2)}°C
                      </span>
                    ) : (
                      <span className="font-mono text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded shrink-0 ml-1">
                        --.-°C
                      </span>
                    )}
                  </div>

                  <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-slate-700">
                    <div className="flex items-center gap-1.5 truncate max-w-[170px]">
                      <span className="truncate">{row.address || 'Awaiting GPS Fix'}</span>
                      {isReal && (
                        <span className={`text-[9px] font-mono px-1 rounded ${row.node_connected ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>
                          {row.node_connected ? 'Probe Linked' : 'Probe Null'}
                        </span>
                      )}
                    </div>
                    <SignalStrengthDisplay
                      rssiDbm={row.network_rssi_dbm}
                      offline={row.connectivity === 'OFFLINE'}
                    />
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* Compact Vehicle Shape & Transported Item Reference Table on First Page */}
      <section className="surface-panel rounded-xl p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-display text-base font-semibold text-slate-900">
              Vehicle Shape &amp; Transported Item Guide
            </h2>
            <p className="text-xs text-slate-600">
              Reference showing which vehicle silhouette is assigned to each cold-chain cargo item
            </p>
          </div>
        </div>

        <div className="overflow-x-auto border-t border-slate-900/10 pt-2">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-900/10 text-[11px] font-semibold text-slate-700">
                <th className="py-2 pr-4">Vehicle Shape</th>
                <th className="py-2 px-3">Items Transported</th>
                <th className="py-2 px-3">Usage Description</th>
                <th className="py-2 pl-3 text-right">Active Vehicles</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-900/10">
              {VEHICLE_SHAPE_LEGEND.filter((spec) =>
                fleet_table.some(
                  (r) => getVehicleCargoProfile(r.vehicle_name, r.cargo_type).bodyType === spec.bodyType
                )
              ).map((spec) => {
                const matchingRows = fleet_table.filter(
                  (r) => getVehicleCargoProfile(r.vehicle_name, r.cargo_type).bodyType === spec.bodyType
                );

                return (
                  <tr key={spec.bodyType} className="hover:bg-slate-50/80">
                    <td className="py-2.5 pr-4 whitespace-nowrap">
                      <div className="inline-flex items-center gap-2.5 font-semibold text-slate-900">
                        <span className="inline-flex h-8 w-11 items-center justify-center rounded-md border border-slate-200 bg-white shadow-2xs">
                          <VehicleSilhouetteSvg
                            bodyType={spec.bodyType}
                            accentHex={spec.accentHex}
                          />
                        </span>
                        <span>{spec.shapeName}</span>
                      </div>
                    </td>

                    <td className="py-2.5 px-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {matchingRows.map((row) => (
                          <VehicleCargoBadge
                            key={row.device_id}
                            vehicleName={row.vehicle_name}
                            cargoType={row.cargo_type}
                            compact
                          />
                        ))}
                      </div>
                    </td>

                    <td className="py-2.5 px-3 text-slate-700 max-w-md">
                      {spec.purpose}
                    </td>

                    <td className="py-2.5 pl-3 text-right">
                      <div className="inline-flex flex-wrap justify-end gap-1.5">
                        {matchingRows.map((row) => (
                          <button
                            key={row.device_id}
                            type="button"
                            onClick={() => onSelectDevice(row.device_id)}
                            className={`rounded border px-2 py-0.5 font-mono text-[11px] font-semibold cursor-pointer ${row.device_id === selectedDeviceId
                                ? 'border-blue-600 bg-blue-600 text-white'
                                : 'border-slate-300 bg-white text-blue-800 shadow-2xs hover:bg-slate-50'
                              }`}
                          >
                            {row.device_id}
                          </button>
                        ))}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
