export type CargoProfileId = 'biologics_2_8' | 'cryo_minus20' | 'ultra_cold_minus70';

export interface CargoProfile {
  id: CargoProfileId;
  name: string;
  cargoSummary: string;
  targetTempC: number;
  minCriticalC: number;
  maxCriticalC: number;
  nearMarginC: number;
}

export const CARGO_PROFILES: Record<CargoProfileId, CargoProfile> = {
  biologics_2_8: {
    id: 'biologics_2_8',
    name: 'Vaccines & Biologics (2°C – 8°C)',
    cargoSummary: 'mRNA Vaccines · Insulin · Monoclonal Antibodies',
    targetTempC: 4.5,
    minCriticalC: 2.0,
    maxCriticalC: 8.0,
    nearMarginC: 0.8,
  },
  cryo_minus20: {
    id: 'cryo_minus20',
    name: 'Frozen Plasma (-25°C – -15°C)',
    cargoSummary: 'Fresh Frozen Plasma · Viral Vector Vials',
    targetTempC: -20.0,
    minCriticalC: -25.0,
    maxCriticalC: -15.0,
    nearMarginC: 1.5,
  },
  ultra_cold_minus70: {
    id: 'ultra_cold_minus70',
    name: 'Ultra-Low Cryo (-80°C – -60°C)',
    cargoSummary: 'Cell Therapy · Cryopreserved Specimens',
    targetTempC: -70.0,
    minCriticalC: -80.0,
    maxCriticalC: -60.0,
    nearMarginC: 2.5,
  },
};

export type DoorState = 'closed_sealed' | 'open_authorized' | 'tampered_open';

export type SimulationFaultMode = 'normal' | 'freeze_drop' | 'cooling_loss';

export type TemperatureBand =
  | 'below_critical'
  | 'near_low'
  | 'optimal'
  | 'near_high'
  | 'above_critical';

export type AlertType = 'temp_below_critical' | 'temp_above_critical' | 'door_tamper';

export type AlertSeverity = 'critical' | 'warning';

export interface ColdChainAlert {
  id: string;
  vehicleId?: VehicleId;
  callsign?: string;
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  message: string;
  source: string;
  valueLabel: string;
  timestampMs: number;
  acknowledged: boolean;
}

export type TrafficDensity = 'light' | 'moderate' | 'heavy';

export type RouteId = 'hyd_hitec' | 'hyd_genome' | 'hyd_gachibowli';

export type VehicleId = 'veh_101' | 'veh_204' | 'veh_309';

export interface LatLngPoint {
  lat: number;
  lng: number;
}

export interface ColdChainRoute {
  id: RouteId;
  name: string;
  originName: string;
  destinationName: string;
  highwayLabel: string;
  origin: LatLngPoint;
  destination: LatLngPoint;
  fallbackPath: LatLngPoint[];
  distanceKm: number;
  baseDurationMin: number;
}

export interface RoadIncident {
  id: string;
  routeId: RouteId;
  type: 'accident' | 'police';
  title: string;
  detail: string;
  position: LatLngPoint;
}

export const COLD_CHAIN_ROUTES: Record<RouteId, ColdChainRoute> = {
  hyd_hitec: {
    id: 'hyd_hitec',
    name: 'RGIA Pharma Hub → Apollo Jubilee Hills',
    originName: 'RGIA Pharma Cargo Hub, Shamshabad',
    destinationName: 'Apollo Hospitals, Jubilee Hills',
    highwayLabel: 'PVNR Expy · Jubilee Hills Rd',
    origin: { lat: 17.2403, lng: 78.4294 },
    destination: { lat: 17.4156, lng: 78.4126 },
    fallbackPath: [
      { lat: 17.2403, lng: 78.4294 },
      { lat: 17.2785, lng: 78.4222 },
      { lat: 17.3198, lng: 78.4316 },
      { lat: 17.3586, lng: 78.4368 },
      { lat: 17.3924, lng: 78.4425 },
      { lat: 17.4078, lng: 78.4298 },
      { lat: 17.4156, lng: 78.4126 },
    ],
    distanceKm: 32.4,
    baseDurationMin: 44,
  },
  hyd_genome: {
    id: 'hyd_genome',
    name: 'Genome Valley → Yashoda Somajiguda',
    originName: 'Genome Valley Biotech Park',
    destinationName: 'Yashoda Hospitals, Somajiguda',
    highwayLabel: 'ORR · NH-44 Begumpet',
    origin: { lat: 17.5964, lng: 78.5877 },
    destination: { lat: 17.4241, lng: 78.4586 },
    fallbackPath: [
      { lat: 17.5964, lng: 78.5877 },
      { lat: 17.5582, lng: 78.5542 },
      { lat: 17.5175, lng: 78.5194 },
      { lat: 17.4812, lng: 78.4962 },
      { lat: 17.4488, lng: 78.4745 },
      { lat: 17.4342, lng: 78.4642 },
      { lat: 17.4241, lng: 78.4586 },
    ],
    distanceKm: 36.8,
    baseDurationMin: 52,
  },
  hyd_gachibowli: {
    id: 'hyd_gachibowli',
    name: 'Gachibowli Hub → NIMS Panjagutta',
    originName: 'Gachibowli Biopharma Hub',
    destinationName: 'NIMS Hospital, Panjagutta',
    highwayLabel: 'HITEC Flyover · Banjara Hills',
    origin: { lat: 17.4401, lng: 78.3489 },
    destination: { lat: 17.4222, lng: 78.4519 },
    fallbackPath: [
      { lat: 17.4401, lng: 78.3489 },
      { lat: 17.4468, lng: 78.3745 },
      { lat: 17.4394, lng: 78.3962 },
      { lat: 17.4285, lng: 78.4168 },
      { lat: 17.4208, lng: 78.4355 },
      { lat: 17.4222, lng: 78.4519 },
    ],
    distanceKm: 16.5,
    baseDurationMin: 34,
  },
};

export const HYDERABAD_INCIDENTS: RoadIncident[] = [
  {
    id: 'inc-pvnr-acc',
    routeId: 'hyd_hitec',
    type: 'accident',
    title: 'Minor Collision · PVNR Exit Ramp',
    detail: '2-wheeler & sedan fender bender near Attapur Pillar 118. Slow merge.',
    position: { lat: 17.3672, lng: 78.4384 },
  },
  {
    id: 'inc-pvnr-pol',
    routeId: 'hyd_hitec',
    type: 'police',
    title: 'Hyderabad Traffic Police Patrol',
    detail: 'Cyberabad Traffic Interceptor stationed near Mehdipatnam Junction.',
    position: { lat: 17.3945, lng: 78.4402 },
  },
  {
    id: 'inc-gv-acc',
    routeId: 'hyd_genome',
    type: 'accident',
    title: 'Auto-Rickshaw Breakdown · Bowenpally',
    detail: '3-wheeler stalled in left lane near Bowenpally X-Road.',
    position: { lat: 17.4725, lng: 78.4878 },
  },
  {
    id: 'inc-gv-pol',
    routeId: 'hyd_genome',
    type: 'police',
    title: 'Traffic Police Checkpost · Begumpet',
    detail: 'Police patrol unit clearing corridor toward Somajiguda.',
    position: { lat: 17.4418, lng: 78.4694 },
  },
  {
    id: 'inc-gac-acc',
    routeId: 'hyd_gachibowli',
    type: 'accident',
    title: 'Traffic Incident · Jubilee Checkpost',
    detail: 'Lane restriction after 2-car scrape; traffic diversion active.',
    position: { lat: 17.4292, lng: 78.4142 },
  },
  {
    id: 'inc-gac-pol',
    routeId: 'hyd_gachibowli',
    type: 'police',
    title: 'Hyderabad Traffic Police · HITEC',
    detail: 'Patrol vehicle stationed near Mindspace Cyber Towers.',
    position: { lat: 17.4426, lng: 78.3812 },
  },
];

export interface FleetVehicleSpec {
  id: VehicleId;
  callsign: string;
  label: string;
  defaultProfileId: CargoProfileId;
  defaultRouteId: RouteId;
  initialProgress: number;
  accentColor: string;
  accentHex: number;
}

export const FLEET_VEHICLE_SPECS: Record<VehicleId, FleetVehicleSpec> = {
  veh_101: {
    id: 'veh_101',
    callsign: 'TS-09-CC-101',
    label: 'Cryo Heavy Rig #1',
    defaultProfileId: 'biologics_2_8',
    defaultRouteId: 'hyd_hitec',
    initialProgress: 0.24,
    accentColor: '#0284c7',
    accentHex: 0x0284c7,
  },
  veh_204: {
    id: 'veh_204',
    callsign: 'TS-07-CC-204',
    label: 'Ultra-Low Carrier #2',
    defaultProfileId: 'ultra_cold_minus70',
    defaultRouteId: 'hyd_genome',
    initialProgress: 0.45,
    accentColor: '#0d9488',
    accentHex: 0x0d9488,
  },
  veh_309: {
    id: 'veh_309',
    callsign: 'TS-08-CC-309',
    label: 'Biopharma Express #3',
    defaultProfileId: 'cryo_minus20',
    defaultRouteId: 'hyd_gachibowli',
    initialProgress: 0.32,
    accentColor: '#4f46e5',
    accentHex: 0x4f46e5,
  },
};

export interface TelemetryState {
  vehicleId: VehicleId;
  callsign: string;
  vehicleLabel: string;
  accentColor: string;
  accentHex: number;
  profileId: CargoProfileId;
  temperatureC: number;
  targetTempC: number;
  minCriticalC: number;
  maxCriticalC: number;
  nearMarginC: number;
  humidityPct: number;
  doorState: DoorState;
  transitArmed: boolean;
  faultMode: SimulationFaultMode;
  nodeBatteryPct: number;
  gatewayRssiDbm: number;
  compressorActive: boolean;
  ambientTempC: number;
  speedKmh: number;
  vehicleMoving: boolean;
  trafficDensity: TrafficDensity;
  routeId: RouteId;
  routeProgress: number;
  timestampMs: number;
}

export interface TelemetryEvaluation {
  overallStatus: 'normal' | 'warning' | 'critical';
  tempBand: TemperatureBand;
  activeConditions: AlertType[];
  isTempCritical: boolean;
  isDoorTampered: boolean;
  newAlerts: ColdChainAlert[];
}

export function getTemperatureBand(
  temperatureC: number,
  minCriticalC: number,
  maxCriticalC: number,
  nearMarginC = 0.8
): TemperatureBand {
  if (temperatureC < minCriticalC) return 'below_critical';
  if (temperatureC > maxCriticalC) return 'above_critical';
  if (temperatureC <= minCriticalC + nearMarginC) return 'near_low';
  if (temperatureC >= maxCriticalC - nearMarginC) return 'near_high';
  return 'optimal';
}

export function formatRssiQuality(rssiDbm: number): { label: string; bars: 1 | 2 | 3 | 4 } {
  if (rssiDbm >= -60) return { label: 'Strong', bars: 4 };
  if (rssiDbm >= -72) return { label: 'Good', bars: 3 };
  if (rssiDbm >= -84) return { label: 'Fair', bars: 2 };
  return { label: 'Weak', bars: 1 };
}

export function evaluateTelemetryAlerts(
  current: TelemetryState,
  activePreviousConditions: AlertType[],
  nowMs: number,
  alertSeqStart = 1
): TelemetryEvaluation {
  const tempBand = getTemperatureBand(
    current.temperatureC,
    current.minCriticalC,
    current.maxCriticalC,
    current.nearMarginC
  );

  const activeConditions: AlertType[] = [];
  const newAlerts: ColdChainAlert[] = [];
  let seq = alertSeqStart;

  if (tempBand === 'below_critical') {
    activeConditions.push('temp_below_critical');
    if (!activePreviousConditions.includes('temp_below_critical')) {
      newAlerts.push({
        id: `alt-${nowMs}-${seq++}`,
        vehicleId: current.vehicleId,
        callsign: current.callsign,
        type: 'temp_below_critical',
        severity: 'critical',
        title: `Critical Low Temp · ${current.callsign}`,
        message: `Container temperature (${current.temperatureC.toFixed(1)}°C) dropped below critical threshold (${current.minCriticalC.toFixed(1)}°C). Freeze risk to cargo.`,
        source: 'Container Node CN-04 → Gateway GW-01',
        valueLabel: `${current.temperatureC.toFixed(1)}°C < ${current.minCriticalC.toFixed(1)}°C`,
        timestampMs: nowMs,
        acknowledged: false,
      });
    }
  } else if (tempBand === 'above_critical') {
    activeConditions.push('temp_above_critical');
    if (!activePreviousConditions.includes('temp_above_critical')) {
      newAlerts.push({
        id: `alt-${nowMs}-${seq++}`,
        vehicleId: current.vehicleId,
        callsign: current.callsign,
        type: 'temp_above_critical',
        severity: 'critical',
        title: `Critical High Temp · ${current.callsign}`,
        message: `Container temperature (${current.temperatureC.toFixed(1)}°C) exceeded upper limit (${current.maxCriticalC.toFixed(1)}°C).`,
        source: 'Container Node CN-04 → Gateway GW-01',
        valueLabel: `${current.temperatureC.toFixed(1)}°C > ${current.maxCriticalC.toFixed(1)}°C`,
        timestampMs: nowMs,
        acknowledged: false,
      });
    }
  }

  const isDoorTampered =
    current.doorState === 'tampered_open' ||
    (current.doorState === 'open_authorized' && current.transitArmed);

  if (isDoorTampered) {
    activeConditions.push('door_tamper');
    if (!activePreviousConditions.includes('door_tamper')) {
      newAlerts.push({
        id: `alt-${nowMs}-${seq++}`,
        vehicleId: current.vehicleId,
        callsign: current.callsign,
        type: 'door_tamper',
        severity: 'critical',
        title: `Door Tamper Detected · ${current.callsign}`,
        message:
          'Rear cold-storage container door opened unexpectedly while transit lock is armed. Immediate driver inspection required.',
        source: 'Reed Sensor DR-01 → Cabin Gateway GW-01',
        valueLabel: 'SEAL BROKEN',
        timestampMs: nowMs,
        acknowledged: false,
      });
    }
  }

  const isTempCritical = tempBand === 'below_critical' || tempBand === 'above_critical';
  let overallStatus: 'normal' | 'warning' | 'critical' = 'normal';

  if (isTempCritical || isDoorTampered) {
    overallStatus = 'critical';
  } else if (
    tempBand === 'near_low' ||
    tempBand === 'near_high' ||
    current.doorState === 'open_authorized'
  ) {
    overallStatus = 'warning';
  }

  return {
    overallStatus,
    tempBand,
    activeConditions,
    isTempCritical,
    isDoorTampered,
    newAlerts,
  };
}

export function getTargetSpeedKmh(
  trafficDensity: TrafficDensity,
  vehicleMoving: boolean
): number {
  if (!vehicleMoving) return 0;
  if (trafficDensity === 'light') return 68;
  if (trafficDensity === 'moderate') return 46;
  return 24;
}

export function stepRouteProgress(
  progress: number,
  speedKmh: number,
  distanceKm: number,
  dtSec: number,
  playbackScale = 36
): number {
  if (speedKmh <= 0 || distanceKm <= 0 || dtSec <= 0) {
    return Math.max(0, Math.min(1, progress));
  }
  const kmPerSec = speedKmh / 3600;
  const deltaFraction = (kmPerSec * dtSec * playbackScale) / distanceKm;
  const next = progress + deltaFraction;
  return next >= 1 ? next - Math.floor(next) : next;
}

export function interpolatePathPoint(
  path: LatLngPoint[],
  progress: number
): { position: LatLngPoint; headingDeg: number } {
  if (path.length === 0) {
    return { position: { lat: 17.385, lng: 78.4867 }, headingDeg: 0 };
  }
  if (path.length === 1) {
    return { position: path[0], headingDeg: 0 };
  }

  const clamped = Math.max(0, Math.min(1, progress));
  const segLengths: number[] = [];
  let totalLen = 0;

  for (let i = 0; i < path.length - 1; i++) {
    const dLat = path[i + 1].lat - path[i].lat;
    const dLng = path[i + 1].lng - path[i].lng;
    const len = Math.hypot(dLat, dLng);
    segLengths.push(len);
    totalLen += len;
  }

  if (totalLen <= 0) {
    return { position: path[0], headingDeg: 0 };
  }

  const targetDist = clamped * totalLen;
  let accum = 0;

  for (let i = 0; i < segLengths.length; i++) {
    const segLen = segLengths[i];
    if (accum + segLen >= targetDist || i === segLengths.length - 1) {
      const localT = segLen > 0 ? Math.max(0, Math.min(1, (targetDist - accum) / segLen)) : 0;
      const a = path[i];
      const b = path[i + 1];
      const lat = a.lat + (b.lat - a.lat) * localT;
      const lng = a.lng + (b.lng - a.lng) * localT;
      const dLat = b.lat - a.lat;
      const dLng = b.lng - a.lng;
      const headingDeg = (Math.atan2(dLng, dLat) * 180) / Math.PI;
      return { position: { lat, lng }, headingDeg };
    }
    accum += segLen;
  }

  return { position: path[path.length - 1], headingDeg: 0 };
}

/**
 * Slices a route polyline from origin up to the vehicle's current normalized progress [0..1]
 * so the real-time traversed path renders smoothly behind the moving truck.
 */
export function slicePathUpToProgress(
  path: LatLngPoint[],
  progress: number
): LatLngPoint[] {
  if (path.length === 0) return [];
  if (path.length === 1) return [path[0]];

  const clamped = Math.max(0, Math.min(1, progress));
  const segLengths: number[] = [];
  let totalLen = 0;

  for (let i = 0; i < path.length - 1; i++) {
    const len = Math.hypot(path[i + 1].lat - path[i].lat, path[i + 1].lng - path[i].lng);
    segLengths.push(len);
    totalLen += len;
  }

  if (totalLen <= 0 || clamped <= 0) return [path[0]];
  if (clamped >= 1) return [...path];

  const targetDist = clamped * totalLen;
  const sliced: LatLngPoint[] = [path[0]];
  let accum = 0;

  for (let i = 0; i < segLengths.length; i++) {
    const segLen = segLengths[i];
    if (accum + segLen < targetDist) {
      sliced.push(path[i + 1]);
      accum += segLen;
    } else {
      const localT = segLen > 0 ? Math.max(0, Math.min(1, (targetDist - accum) / segLen)) : 0;
      const a = path[i];
      const b = path[i + 1];
      sliced.push({
        lat: a.lat + (b.lat - a.lat) * localT,
        lng: a.lng + (b.lng - a.lng) * localT,
      });
      break;
    }
  }

  return sliced;
}

export function computeRouteEtaMinutes(
  remainingFraction: number,
  distanceKm: number,
  speedKmh: number,
  baseDurationMin: number
): number {
  const frac = Math.max(0, Math.min(1, remainingFraction));
  if (speedKmh <= 1) {
    return Math.max(1, Math.round(baseDurationMin * frac * 1.4));
  }
  const mins = (distanceKm * frac * 60) / speedKmh;
  return Math.max(1, Math.round(mins));
}

export function stepThermalSimulation(
  state: TelemetryState,
  dtSec: number,
  nowMs: number,
  jitterSeed = 0
): TelemetryState {
  const clampedDt = Math.max(0, Math.min(dtSec, 2));
  const isDoorOpen = state.doorState !== 'closed_sealed';

  let desiredTemp = state.targetTempC;
  let rate = 0.35;

  if (state.faultMode === 'freeze_drop') {
    desiredTemp = state.minCriticalC - 2.6;
    rate = 0.95;
  } else if (state.faultMode === 'cooling_loss') {
    desiredTemp = state.ambientTempC;
    rate = 0.45;
  }

  if (isDoorOpen && state.faultMode !== 'freeze_drop') {
    desiredTemp = Math.max(desiredTemp, state.ambientTempC - 4);
    rate = Math.max(rate, 0.55);
  }

  const alpha = 1 - Math.exp(-rate * clampedDt);
  const microRipple = Math.sin(jitterSeed * 0.7) * 0.03;
  const nextTemp =
    state.temperatureC + (desiredTemp - state.temperatureC) * alpha + microRipple * clampedDt;

  const targetHumidity = isDoorOpen ? 76 : 52;
  const nextHumidity =
    state.humidityPct + (targetHumidity - state.humidityPct) * (1 - Math.exp(-0.5 * clampedDt));

  const rssiBase = isDoorOpen ? -64 : -59;
  const nextRssi = Math.round(rssiBase + Math.sin(jitterSeed * 1.1) * 2);

  const baseSpeed = getTargetSpeedKmh(state.trafficDensity, state.vehicleMoving);
  const speedJitter = state.vehicleMoving ? Math.round(Math.sin(jitterSeed * 0.6) * 2) : 0;
  const nextSpeed = Math.max(0, baseSpeed + speedJitter);
  const route = COLD_CHAIN_ROUTES[state.routeId];
  const nextProgress = stepRouteProgress(
    state.routeProgress,
    nextSpeed,
    route.distanceKm,
    clampedDt
  );

  return {
    ...state,
    temperatureC: Number(nextTemp.toFixed(2)),
    humidityPct: Number(Math.max(20, Math.min(95, nextHumidity)).toFixed(1)),
    gatewayRssiDbm: nextRssi,
    compressorActive: state.faultMode !== 'cooling_loss',
    speedKmh: nextSpeed,
    routeProgress: Number(nextProgress.toFixed(4)),
    timestampMs: nowMs,
  };
}

export function triggerDoorAction(
  state: TelemetryState,
  action: 'tamper_open' | 'authorize_open' | 'close_and_seal',
  nowMs: number
): TelemetryState {
  if (action === 'tamper_open') {
    return {
      ...state,
      transitArmed: true,
      doorState: 'tampered_open',
      timestampMs: nowMs,
    };
  }
  if (action === 'authorize_open') {
    return {
      ...state,
      transitArmed: false,
      doorState: 'open_authorized',
      timestampMs: nowMs,
    };
  }
  return {
    ...state,
    transitArmed: true,
    doorState: 'closed_sealed',
    timestampMs: nowMs,
  };
}

export function createInitialTelemetryState(
  profileId?: CargoProfileId,
  nowMs = Date.now(),
  routeId?: RouteId,
  vehicleId: VehicleId = 'veh_101'
): TelemetryState {
  const spec = FLEET_VEHICLE_SPECS[vehicleId];
  const resolvedProfileId = profileId ?? spec.defaultProfileId;
  const resolvedRouteId = routeId ?? spec.defaultRouteId;
  const profile = CARGO_PROFILES[resolvedProfileId];

  return {
    vehicleId,
    callsign: spec.callsign,
    vehicleLabel: spec.label,
    accentColor: spec.accentColor,
    accentHex: spec.accentHex,
    profileId: resolvedProfileId,
    temperatureC: profile.targetTempC,
    targetTempC: profile.targetTempC,
    minCriticalC: profile.minCriticalC,
    maxCriticalC: profile.maxCriticalC,
    nearMarginC: profile.nearMarginC,
    humidityPct: 50.0,
    doorState: 'closed_sealed',
    transitArmed: true,
    faultMode: 'normal',
    nodeBatteryPct: 96,
    gatewayRssiDbm: -59,
    compressorActive: true,
    ambientTempC: 33.0,
    speedKmh: 46,
    vehicleMoving: true,
    trafficDensity: 'heavy',
    routeId: resolvedRouteId,
    routeProgress: spec.initialProgress,
    timestampMs: nowMs,
  };
}

export function createInitialFleetState(
  nowMs = Date.now()
): Record<VehicleId, TelemetryState> {
  return {
    veh_101: createInitialTelemetryState(undefined, nowMs, undefined, 'veh_101'),
    veh_204: createInitialTelemetryState(undefined, nowMs, undefined, 'veh_204'),
    veh_309: createInitialTelemetryState(undefined, nowMs, undefined, 'veh_309'),
  };
}
