import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bell,
  Box,
  MapPin,
  RotateCcw,
  SlidersHorizontal,
  Smartphone,
} from 'lucide-react';
import {
  CARGO_PROFILES,
  COLD_CHAIN_ROUTES,
  createInitialFleetState,
  createInitialTelemetryState,
  evaluateTelemetryAlerts,
  getTargetSpeedKmh,
  stepThermalSimulation,
  triggerDoorAction,
  type AlertType,
  type CargoProfileId,
  type ColdChainAlert,
  type RouteId,
  type TelemetryState,
  type TrafficDensity,
  type VehicleId,
} from './simulation/coldChainRules';
import type { CameraPresetId, SceneVisualState } from './three/ColdChainTruckScene';
import { Viewport3D } from './components/Viewport3D';
import { SimulationDock } from './components/SimulationDock';
import { MobileDriverDashboard } from './components/MobileDriverDashboard';
import { RouteMapPanel } from './components/RouteMapPanel';
import { playAlertTone } from './utils/soundAlerts';

type MobileTab = 'driver' | 'twin' | 'map' | 'controls';

const VEHICLE_IDS: VehicleId[] = ['veh_101', 'veh_204', 'veh_309'];

export default function App() {
  const [fleet, setFleet] = useState<Record<VehicleId, TelemetryState>>(() =>
    createInitialFleetState()
  );
  const [selectedVehicleId, setSelectedVehicleId] = useState<VehicleId>('veh_101');
  const [alerts, setAlerts] = useState<ColdChainAlert[]>([]);
  const [cutawayEnabled, setCutawayEnabled] = useState(true);
  const [cameraPreset, setCameraPreset] = useState<CameraPresetId>('overview');
  const [dockCollapsed, setDockCollapsed] = useState(false);
  const [soundMuted, setSoundMuted] = useState(false);
  const [mobileTab, setMobileTab] = useState<MobileTab>('driver');
  const [activeConditionsByVehicle, setActiveConditionsByVehicle] = useState<
    Record<VehicleId, AlertType[]>
  >({
    veh_101: [],
    veh_204: [],
    veh_309: [],
  });
  const [mapsQuotaExceeded, setMapsQuotaExceeded] = useState(false);

  const activeConditionsRef = useRef<Record<VehicleId, AlertType[]>>({
    veh_101: [],
    veh_204: [],
    veh_309: [],
  });
  const soundMutedRef = useRef(soundMuted);
  soundMutedRef.current = soundMuted;

  const alertSeqRef = useRef(1);
  const tickCountRef = useRef(0);

  const telemetry = fleet[selectedVehicleId];
  const fleetList = useMemo(
    () => VEHICLE_IDS.map((id) => fleet[id]),
    [fleet]
  );

  // Listen to Case A Google Maps Platform quota events at top-level App scope
  useEffect(() => {
    const onQuotaExceeded = () => setMapsQuotaExceeded(true);
    window.addEventListener('gmp-quota-exceeded', onQuotaExceeded);
    return () => window.removeEventListener('gmp-quota-exceeded', onQuotaExceeded);
  }, []);

  const evaluateFleetStep = useCallback(
    (nextFleet: Record<VehicleId, TelemetryState>, nowMs: number) => {
      const generatedAlerts: ColdChainAlert[] = [];
      const nextConditions: Record<VehicleId, AlertType[]> = {
        veh_101: activeConditionsRef.current.veh_101,
        veh_204: activeConditionsRef.current.veh_204,
        veh_309: activeConditionsRef.current.veh_309,
      };

      for (const vid of VEHICLE_IDS) {
        const evalRes = evaluateTelemetryAlerts(
          nextFleet[vid],
          activeConditionsRef.current[vid],
          nowMs,
          alertSeqRef.current
        );
        if (evalRes.newAlerts.length > 0) {
          alertSeqRef.current += evalRes.newAlerts.length;
          generatedAlerts.push(...evalRes.newAlerts);
        }
        nextConditions[vid] = evalRes.activeConditions;
      }

      if (generatedAlerts.length > 0) {
        setAlerts((prev) => [...generatedAlerts, ...prev].slice(0, 50));
        if (!soundMutedRef.current) {
          const hasTamper = generatedAlerts.some((a) => a.type === 'door_tamper');
          playAlertTone(hasTamper ? 'door_tamper' : 'temp_critical');
        }
      }

      activeConditionsRef.current = nextConditions;
      setActiveConditionsByVehicle(nextConditions);
    },
    []
  );

  // Real-time 1 Hz simulation tick advancing ALL 3 Hyderabad transport vehicles simultaneously
  useEffect(() => {
    const intervalId = window.setInterval(() => {
      tickCountRef.current += 1;
      const nowMs = Date.now();
      setFleet((prevFleet) => {
        const nextFleet: Record<VehicleId, TelemetryState> = {
          veh_101: stepThermalSimulation(prevFleet.veh_101, 1.0, nowMs, tickCountRef.current),
          veh_204: stepThermalSimulation(prevFleet.veh_204, 1.0, nowMs, tickCountRef.current + 3),
          veh_309: stepThermalSimulation(prevFleet.veh_309, 1.0, nowMs, tickCountRef.current + 7),
        };
        evaluateFleetStep(nextFleet, nowMs);
        return nextFleet;
      });
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [evaluateFleetStep]);

  // Keyboard shortcut 'H' to toggle 3D control dock
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        e.key.toLowerCase() === 'h' &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLSelectElement)
      ) {
        setDockCollapsed((c) => !c);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const evaluation = useMemo(
    () =>
      evaluateTelemetryAlerts(
        telemetry,
        activeConditionsByVehicle[selectedVehicleId] ?? [],
        telemetry.timestampMs,
        alertSeqRef.current
      ),
    [telemetry, activeConditionsByVehicle, selectedVehicleId]
  );

  const applySelectedTelemetryUpdate = useCallback(
    (updater: (prev: TelemetryState) => TelemetryState) => {
      const nowMs = Date.now();
      setFleet((prevFleet) => {
        const updatedVehicle = updater(prevFleet[selectedVehicleId]);
        const nextFleet = {
          ...prevFleet,
          [selectedVehicleId]: updatedVehicle,
        };
        evaluateFleetStep(nextFleet, nowMs);
        return nextFleet;
      });
    },
    [selectedVehicleId, evaluateFleetStep]
  );

  const handleSetTemperature = useCallback(
    (tempC: number) => {
      applySelectedTelemetryUpdate((prev) => ({
        ...prev,
        faultMode:
          tempC < prev.minCriticalC
            ? 'freeze_drop'
            : tempC > prev.maxCriticalC
            ? 'cooling_loss'
            : 'normal',
        temperatureC: Number(tempC.toFixed(1)),
        timestampMs: Date.now(),
      }));
    },
    [applySelectedTelemetryUpdate]
  );

  const handleTriggerFreezeDrop = useCallback(() => {
    applySelectedTelemetryUpdate((prev) => ({
      ...prev,
      faultMode: 'freeze_drop',
      temperatureC: Number((prev.minCriticalC - 1.4).toFixed(1)),
      timestampMs: Date.now(),
    }));
  }, [applySelectedTelemetryUpdate]);

  const handleTriggerDoorTamper = useCallback(() => {
    applySelectedTelemetryUpdate((prev) =>
      triggerDoorAction(prev, 'tamper_open', Date.now())
    );
  }, [applySelectedTelemetryUpdate]);

  const handleCloseAndSealDoor = useCallback(() => {
    applySelectedTelemetryUpdate((prev) =>
      triggerDoorAction(prev, 'close_and_seal', Date.now())
    );
    if (!soundMutedRef.current) {
      playAlertTone('resolved');
    }
  }, [applySelectedTelemetryUpdate]);

  const handleToggleTransitArm = useCallback(() => {
    applySelectedTelemetryUpdate((prev) => ({
      ...prev,
      transitArmed: !prev.transitArmed,
      doorState:
        !prev.transitArmed && prev.doorState === 'open_authorized'
          ? 'tampered_open'
          : prev.transitArmed && prev.doorState === 'tampered_open'
          ? 'open_authorized'
          : prev.doorState,
      timestampMs: Date.now(),
    }));
  }, [applySelectedTelemetryUpdate]);

  const handleToggleVehicleMoving = useCallback(() => {
    applySelectedTelemetryUpdate((prev) => {
      const nextMoving = !prev.vehicleMoving;
      return {
        ...prev,
        vehicleMoving: nextMoving,
        speedKmh: getTargetSpeedKmh(prev.trafficDensity, nextMoving),
        timestampMs: Date.now(),
      };
    });
  }, [applySelectedTelemetryUpdate]);

  const handleSelectTrafficDensity = useCallback(
    (density: TrafficDensity) => {
      applySelectedTelemetryUpdate((prev) => ({
        ...prev,
        trafficDensity: density,
        speedKmh: getTargetSpeedKmh(density, prev.vehicleMoving),
        timestampMs: Date.now(),
      }));
    },
    [applySelectedTelemetryUpdate]
  );

  const handleSelectRoute = useCallback(
    (routeId: RouteId) => {
      applySelectedTelemetryUpdate((prev) => ({
        ...prev,
        routeId,
        routeProgress: 0.08,
        timestampMs: Date.now(),
      }));
    },
    [applySelectedTelemetryUpdate]
  );

  const handleRestoreNormal = useCallback(() => {
    applySelectedTelemetryUpdate((prev) => {
      const profile = CARGO_PROFILES[prev.profileId];
      return {
        ...prev,
        faultMode: 'normal',
        temperatureC: profile.targetTempC,
        doorState: 'closed_sealed',
        transitArmed: true,
        humidityPct: 48.0,
        compressorActive: true,
        vehicleMoving: true,
        speedKmh: getTargetSpeedKmh(prev.trafficDensity, true),
        timestampMs: Date.now(),
      };
    });
    if (!soundMutedRef.current) {
      playAlertTone('resolved');
    }
  }, [applySelectedTelemetryUpdate]);

  const handleSelectProfile = useCallback(
    (profileId: CargoProfileId) => {
      activeConditionsRef.current = {
        ...activeConditionsRef.current,
        [selectedVehicleId]: [],
      };
      setActiveConditionsByVehicle((prev) => ({
        ...prev,
        [selectedVehicleId]: [],
      }));
      setFleet((prevFleet) => {
        const cur = prevFleet[selectedVehicleId];
        return {
          ...prevFleet,
          [selectedVehicleId]: {
            ...createInitialTelemetryState(
              profileId,
              Date.now(),
              cur.routeId,
              selectedVehicleId
            ),
            routeProgress: cur.routeProgress,
            trafficDensity: cur.trafficDensity,
            vehicleMoving: cur.vehicleMoving,
            speedKmh: getTargetSpeedKmh(cur.trafficDensity, cur.vehicleMoving),
          },
        };
      });
    },
    [selectedVehicleId]
  );

  const handleDoorClickIn3D = useCallback(() => {
    applySelectedTelemetryUpdate((prev) => {
      if (prev.doorState === 'closed_sealed') {
        return triggerDoorAction(
          prev,
          prev.transitArmed ? 'tamper_open' : 'authorize_open',
          Date.now()
        );
      }
      return triggerDoorAction(prev, 'close_and_seal', Date.now());
    });
  }, [applySelectedTelemetryUpdate]);

  const handleAcknowledgeAlert = useCallback((id: string) => {
    setAlerts((prev) =>
      prev.map((a) => (a.id === id ? { ...a, acknowledged: true } : a))
    );
  }, []);

  const handleAcknowledgeAll = useCallback(() => {
    setAlerts((prev) =>
      prev.map((a) =>
        !a.vehicleId || a.vehicleId === selectedVehicleId
          ? { ...a, acknowledged: true }
          : a
      )
    );
  }, [selectedVehicleId]);

  const visualState: SceneVisualState = useMemo(
    () => ({
      callsign: telemetry.callsign,
      accentHex: telemetry.accentHex,
      temperatureC: telemetry.temperatureC,
      tempBand: evaluation.tempBand,
      doorState: telemetry.doorState,
      compressorActive: telemetry.compressorActive,
      cutawayEnabled,
      isAlertActive: evaluation.overallStatus === 'critical',
      isDoorTampered: evaluation.isDoorTampered,
      cameraPreset,
      vehicleMoving: telemetry.vehicleMoving,
      speedKmh: telemetry.speedKmh,
      trafficDensity: telemetry.trafficDensity,
    }),
    [
      telemetry.callsign,
      telemetry.accentHex,
      telemetry.temperatureC,
      telemetry.doorState,
      telemetry.compressorActive,
      telemetry.vehicleMoving,
      telemetry.speedKmh,
      telemetry.trafficDensity,
      evaluation.tempBand,
      evaluation.overallStatus,
      evaluation.isDoorTampered,
      cutawayEnabled,
      cameraPreset,
    ]
  );

  const unackedCount = alerts.filter((a) => !a.acknowledged).length;

  return (
    <div
      className="h-screen w-screen flex flex-col overflow-hidden bg-slate-100 text-slate-900"
      data-app-status={evaluation.overallStatus}
    >
      {/* Google Maps Platform Case A Quota Notice Banner */}
      {mapsQuotaExceeded && (
        <div className="bg-amber-50 border-b border-amber-200 text-amber-900 px-4 py-2 text-xs md:text-sm text-center sticky top-0 z-50 shadow-sm shrink-0">
          <span>
            Google Maps Platform quota reached. If you are the app owner, visit{' '}
            <a
              href="https://developers.google.com/maps/ai/ai-studio?utm_campaign=gmp_mcp_codeassist_v1_aistudio#quota_exceeded_errors"
              target="_blank"
              rel="noopener noreferrer"
              className="underline font-semibold text-amber-950 hover:text-amber-800"
            >
              maps developer site
            </a>{' '}
            for instructions to update your account.
          </span>
        </div>
      )}

      {/* Desktop Top Bar: Brand "Cold Chain", Fleet Selector, 3D Camera Presets, Primary Reset */}
      <header className="hidden lg:flex items-center justify-between gap-4 px-5 h-13 bg-white border-b border-slate-200 shrink-0">
        <div className="flex items-center gap-4 min-w-0">
          <a
            href="#top"
            onClick={(e) => {
              e.preventDefault();
              setCameraPreset('overview');
            }}
            className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
          >
            Cold Chain
          </a>

          {/* Quick Fleet Vehicle Switcher */}
          <div
            className="flex items-center gap-1 rounded-lg bg-slate-100 p-0.5 border border-slate-200"
            role="group"
            aria-label="Select Hyderabad Transport Vehicle"
          >
            {fleetList.map((veh) => {
              const active = veh.vehicleId === selectedVehicleId;
              return (
                <button
                  key={veh.vehicleId}
                  type="button"
                  data-testid={`header-fleet-btn-${veh.vehicleId}`}
                  onClick={() => setSelectedVehicleId(veh.vehicleId)}
                  className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold transition-colors whitespace-nowrap ${
                    active
                      ? 'bg-slate-900 text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-950 hover:bg-white'
                  }`}
                >
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: veh.accentColor }}
                  />
                  <span>{veh.callsign.slice(-6)}</span>
                </button>
              );
            })}
          </div>
        </div>

        <nav
          aria-label="3D Camera Views"
          className="flex items-center gap-5 text-sm font-medium"
        >
          {(
            [
              { id: 'overview', label: 'Overview' },
              { id: 'node', label: 'Container Node' },
              { id: 'cabin', label: 'Cabin Gateway' },
              { id: 'doors', label: 'Rear Doors' },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setCameraPreset(item.id)}
              className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                cameraPreset === item.id
                  ? 'border-sky-600 text-slate-950 font-semibold'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={handleRestoreNormal}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset Transit</span>
          </button>
        </div>
      </header>

      {/* Compact Mobile Top Bar (< 1024px) */}
      <header className="flex lg:hidden items-center justify-between px-4 h-12 bg-slate-950 text-white border-b border-slate-800 shrink-0">
        <span className="font-display text-base font-bold tracking-tight whitespace-nowrap shrink-0">
          Cold Chain
        </span>
        <div className="flex items-center gap-2 text-xs font-mono-tabular">
          <span className="text-slate-300 font-semibold">
            {telemetry.callsign.slice(-6)}
          </span>
          <span aria-hidden="true" className="text-slate-600">
            ·
          </span>
          <span
            className={
              evaluation.overallStatus === 'critical'
                ? 'text-red-400 font-bold'
                : 'text-sky-300 font-semibold'
            }
          >
            {telemetry.temperatureC.toFixed(1)}°C
          </span>
          <span aria-hidden="true" className="text-slate-600">
            ·
          </span>
          <span
            className={
              evaluation.isDoorTampered
                ? 'text-red-400 font-bold'
                : 'text-emerald-400'
            }
          >
            {evaluation.isDoorTampered ? 'TAMPER' : 'SEALED'}
          </span>
        </div>
      </header>

      {/* 3-Part Split Main Content Area */}
      <main className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden">
        {/* PART 1 (Major): Live Hyderabad Route, Real-Time Path, Incidents & Traffic Map */}
        <section
          aria-label="Live Route and Traffic Map"
          data-testid="panel-route-map"
          className={`${
            mobileTab === 'map' ? 'flex' : 'hidden'
          } lg:flex flex-1 relative min-h-0 min-w-0 border-b lg:border-b-0 lg:border-r border-slate-200`}
        >
          <RouteMapPanel
            telemetry={telemetry}
            fleet={fleetList}
            selectedVehicleId={selectedVehicleId}
            evaluation={evaluation}
            onSelectVehicle={setSelectedVehicleId}
            onSelectRoute={handleSelectRoute}
          />
        </section>

        {/* PART 2 (Major): 3x Moving Cold-Storage Rig in 5x Hyderabad Traffic & 10x City */}
        <section
          aria-label="3D Moving Cold-Storage Vehicle"
          data-testid="panel-3d-vehicle"
          className={`${
            mobileTab === 'twin' ? 'flex' : 'hidden'
          } lg:flex flex-1 relative min-h-0 min-w-0`}
        >
          <Viewport3D
            visualState={visualState}
            onDoorClick={handleDoorClickIn3D}
            onSelectFocus={(preset) => setCameraPreset(preset)}
          />

          <SimulationDock
            telemetry={telemetry}
            cutawayEnabled={cutawayEnabled}
            cameraPreset={cameraPreset}
            collapsed={dockCollapsed}
            onToggleCollapse={() => setDockCollapsed((c) => !c)}
            onToggleCutaway={() => setCutawayEnabled((v) => !v)}
            onToggleVehicleMoving={handleToggleVehicleMoving}
            onSelectTrafficDensity={handleSelectTrafficDensity}
            onSelectCamera={(preset) => setCameraPreset(preset)}
            onSelectProfile={handleSelectProfile}
            onSetTemperature={handleSetTemperature}
            onTriggerFreezeDrop={handleTriggerFreezeDrop}
            onTriggerDoorTamper={handleTriggerDoorTamper}
            onRestoreNormal={handleRestoreNormal}
          />
        </section>

        {/* PART 3 (Compact): Mobile Driver Cabin Alert Dashboard */}
        <aside
          aria-label="Driver Cabin Mobile Companion"
          data-testid="panel-driver-terminal"
          className="hidden lg:flex w-[325px] xl:w-[345px] shrink-0 bg-slate-900 border-l border-slate-200 p-3 items-center justify-center overflow-hidden"
        >
          <div className="w-full h-full max-h-[820px] rounded-[24px] border-[3px] border-slate-700 bg-slate-950 overflow-hidden shadow-2xl flex flex-col">
            <MobileDriverDashboard
              telemetry={telemetry}
              evaluation={evaluation}
              alerts={alerts}
              soundMuted={soundMuted}
              onToggleSound={() => setSoundMuted((m) => !m)}
              onAcknowledgeAlert={handleAcknowledgeAlert}
              onAcknowledgeAll={handleAcknowledgeAll}
              onCloseAndSealDoor={handleCloseAndSealDoor}
              onToggleTransitArm={handleToggleTransitArm}
            />
          </div>
        </aside>

        {/* Mobile Driver App Tab (< 1024px) */}
        {mobileTab === 'driver' && (
          <section className="flex-1 min-h-0 lg:hidden overflow-hidden">
            <MobileDriverDashboard
              telemetry={telemetry}
              evaluation={evaluation}
              alerts={alerts}
              soundMuted={soundMuted}
              onToggleSound={() => setSoundMuted((m) => !m)}
              onAcknowledgeAlert={handleAcknowledgeAlert}
              onAcknowledgeAll={handleAcknowledgeAll}
              onCloseAndSealDoor={handleCloseAndSealDoor}
              onToggleTransitArm={handleToggleTransitArm}
              onTriggerFreezeDrop={handleTriggerFreezeDrop}
              onTriggerDoorTamper={handleTriggerDoorTamper}
              onRestoreNormal={handleRestoreNormal}
              compactControls
            />
          </section>
        )}

        {/* Mobile Simulation Controls Tab (< 1024px) */}
        {mobileTab === 'controls' && (
          <section className="flex-1 min-h-0 lg:hidden overflow-y-auto bg-slate-950 text-slate-100 p-4 space-y-4">
            <h2 className="font-display text-base font-bold text-white">
              Cold Chain Fleet &amp; Simulation
            </h2>

            <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4 space-y-3">
              <label
                htmlFor="mobile-vehicle-select"
                className="block text-xs font-medium text-slate-300"
              >
                Active Transport Vehicle
              </label>
              <select
                id="mobile-vehicle-select"
                value={selectedVehicleId}
                onChange={(e) => setSelectedVehicleId(e.target.value as VehicleId)}
                className="w-full min-h-[44px] rounded-xl bg-slate-800 border border-slate-700 px-3 text-sm text-white"
              >
                {fleetList.map((v) => (
                  <option key={v.vehicleId} value={v.vehicleId}>
                    {v.callsign} · {v.vehicleLabel}
                  </option>
                ))}
              </select>

              <div className="flex items-center justify-between gap-2 pt-1">
                <span className="text-xs font-medium text-slate-300">
                  Vehicle Motion &amp; Traffic
                </span>
                <button
                  type="button"
                  onClick={handleToggleVehicleMoving}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${
                    telemetry.vehicleMoving
                      ? 'bg-emerald-600 text-white'
                      : 'bg-amber-600 text-white'
                  }`}
                >
                  {telemetry.vehicleMoving ? 'Driving' : 'Paused'}
                </button>
              </div>

              <label
                htmlFor="mobile-route-select"
                className="block text-xs font-medium text-slate-300"
              >
                Hyderabad Route Corridor
              </label>
              <select
                id="mobile-route-select"
                value={telemetry.routeId}
                onChange={(e) => handleSelectRoute(e.target.value as RouteId)}
                className="w-full min-h-[44px] rounded-xl bg-slate-800 border border-slate-700 px-3 text-sm text-white"
              >
                {Object.values(COLD_CHAIN_ROUTES).map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>

              <label
                htmlFor="mobile-traffic-select"
                className="block text-xs font-medium text-slate-300"
              >
                Road Traffic Density
              </label>
              <select
                id="mobile-traffic-select"
                value={telemetry.trafficDensity}
                onChange={(e) =>
                  handleSelectTrafficDensity(e.target.value as TrafficDensity)
                }
                className="w-full min-h-[44px] rounded-xl bg-slate-800 border border-slate-700 px-3 text-sm text-white"
              >
                <option value="light">Light Traffic (68 km/h)</option>
                <option value="moderate">Moderate Traffic (46 km/h)</option>
                <option value="heavy">Heavy Congestion (24 km/h)</option>
              </select>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4 space-y-3">
              <label
                htmlFor="mobile-profile-select"
                className="block text-xs font-medium text-slate-300"
              >
                Medical Cargo Profile
              </label>
              <select
                id="mobile-profile-select"
                value={telemetry.profileId}
                onChange={(e) =>
                  handleSelectProfile(e.target.value as CargoProfileId)
                }
                className="w-full min-h-[44px] rounded-xl bg-slate-800 border border-slate-700 px-3 text-sm text-white"
              >
                {Object.values(CARGO_PROFILES).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4 space-y-3">
              <div className="flex items-center justify-between text-xs">
                <label
                  htmlFor="mobile-temp-slider"
                  className="font-medium text-slate-300"
                >
                  Container Temperature
                </label>
                <span className="font-mono-tabular font-bold text-white">
                  {telemetry.temperatureC.toFixed(1)}°C
                </span>
              </div>
              <input
                id="mobile-temp-slider"
                type="range"
                min={Number((telemetry.minCriticalC - 6).toFixed(1))}
                max={Number((telemetry.maxCriticalC + 8).toFixed(1))}
                step={0.2}
                value={telemetry.temperatureC}
                onChange={(e) => handleSetTemperature(parseFloat(e.target.value))}
                className="w-full h-3 rounded-lg appearance-none bg-slate-700 accent-sky-500"
              />
              <div className="grid grid-cols-1 gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={handleTriggerFreezeDrop}
                  className="min-h-[48px] rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-sm font-semibold"
                >
                  Simulate Freeze Below {telemetry.minCriticalC.toFixed(1)}°C
                </button>
                <button
                  type="button"
                  onClick={handleTriggerDoorTamper}
                  className="min-h-[48px] rounded-xl bg-red-600 hover:bg-red-500 text-white text-sm font-semibold"
                >
                  Trigger Rear Door Tamper
                </button>
                <button
                  type="button"
                  onClick={handleRestoreNormal}
                  className="min-h-[48px] rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-100 text-sm font-medium"
                >
                  Restore Normal Transit
                </button>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4 space-y-3">
              <span className="block text-xs font-medium text-slate-300">
                3D Inspection Camera
              </span>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    { id: 'overview', label: 'Overview' },
                    { id: 'node', label: 'Container Node' },
                    { id: 'cabin', label: 'Cabin Gateway' },
                    { id: 'doors', label: 'Rear Doors' },
                  ] as const
                ).map((cam) => (
                  <button
                    key={cam.id}
                    type="button"
                    onClick={() => {
                      setCameraPreset(cam.id);
                      setMobileTab('twin');
                    }}
                    className={`min-h-[44px] rounded-xl text-xs font-semibold border ${
                      cameraPreset === cam.id
                        ? 'bg-sky-600 border-sky-500 text-white'
                        : 'bg-slate-800 border-slate-700 text-slate-200'
                    }`}
                  >
                    {cam.label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => {
                  setCutawayEnabled((v) => !v);
                  setMobileTab('twin');
                }}
                className="w-full min-h-[44px] rounded-xl bg-slate-800 border border-slate-700 text-xs font-semibold text-sky-300"
              >
                {cutawayEnabled ? 'Switch to Solid Wall' : 'Switch to Cutaway View'}
              </button>
            </div>
          </section>
        )}
      </main>

      {/* Mobile Bottom Thumb-Zone Tab Bar */}
      <nav
        aria-label="Mobile Navigation"
        className="lg:hidden grid grid-cols-4 h-14 bg-slate-950 border-t border-slate-800 shrink-0"
      >
        <button
          type="button"
          onClick={() => setMobileTab('driver')}
          className={`flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium relative ${
            mobileTab === 'driver' ? 'text-sky-400' : 'text-slate-400'
          }`}
        >
          <div className="relative">
            <Smartphone className="w-5 h-5" />
            {unackedCount > 0 && (
              <Bell className="w-3 h-3 text-red-400 absolute -top-1 -right-2" />
            )}
          </div>
          <span>Driver App</span>
        </button>

        <button
          type="button"
          onClick={() => setMobileTab('map')}
          className={`flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${
            mobileTab === 'map' ? 'text-sky-400' : 'text-slate-400'
          }`}
        >
          <MapPin className="w-5 h-5" />
          <span>Route Map</span>
        </button>

        <button
          type="button"
          onClick={() => setMobileTab('twin')}
          className={`flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${
            mobileTab === 'twin' ? 'text-sky-400' : 'text-slate-400'
          }`}
        >
          <Box className="w-5 h-5" />
          <span>3D Vehicle</span>
        </button>

        <button
          type="button"
          onClick={() => setMobileTab('controls')}
          className={`flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${
            mobileTab === 'controls' ? 'text-sky-400' : 'text-slate-400'
          }`}
        >
          <SlidersHorizontal className="w-5 h-5" />
          <span>Simulate</span>
        </button>
      </nav>
    </div>
  );
}
