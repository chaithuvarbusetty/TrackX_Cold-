import type { GeofenceRecord, TemperatureForecast } from '../shared/types';

export interface RouteWaypointSeed {
  lat: number;
  lng: number;
  area: string;
  subArea: string;
  speedLimitKmh: number;
}

// Realistic Hyderabad Pharmaceutical Cold-Chain Corridors
export const HYDERABAD_CORRIDORS: RouteWaypointSeed[][] = [
  // Corridor 0: HITEC City Pharma Hub -> Medchal NH-44 Depot
  [
    { lat: 17.4483, lng: 78.3915, area: 'HITEC City Pharma Hub', subArea: 'Madhapur, Hyderabad', speedLimitKmh: 38 },
    { lat: 17.4725, lng: 78.4080, area: 'Kukatpally Junction', subArea: 'NH-65 Corridor, Hyderabad', speedLimitKmh: 46 },
    { lat: 17.4980, lng: 78.4310, area: 'Balanagar Industrial Park', subArea: 'North Corridor, Hyderabad', speedLimitKmh: 52 },
    { lat: 17.5320, lng: 78.4620, area: 'Kompally Cold Plaza', subArea: 'NH-44 Highway, Hyderabad', speedLimitKmh: 64 },
    { lat: 17.5840, lng: 78.4755, area: 'Kandlakoya Logistics Gate', subArea: 'NH-44 Express, Medchal', speedLimitKmh: 68 },
    { lat: 17.6297, lng: 78.4812, area: 'Medchal Cold Depot', subArea: 'Medchal District, Telangana', speedLimitKmh: 28 },
  ],
  // Corridor 1: Gachibowli Genome Valley -> Shamshabad Air Cargo Terminal
  [
    { lat: 17.4401, lng: 78.3489, area: 'Gachibowli Pharma Hub', subArea: 'Financial District, Hyderabad', speedLimitKmh: 40 },
    { lat: 17.4020, lng: 78.3660, area: 'Narsingi ORR Entry', subArea: 'Outer Ring Road, Hyderabad', speedLimitKmh: 72 },
    { lat: 17.3510, lng: 78.3890, area: 'Rajendranagar Bio-Park', subArea: 'ORR Exit 17, Hyderabad', speedLimitKmh: 76 },
    { lat: 17.2940, lng: 78.4120, area: 'Tondpally Cold Transit', subArea: 'Shamshabad Corridor', speedLimitKmh: 66 },
    { lat: 17.2403, lng: 78.4294, area: 'Shamshabad Cargo Terminal', subArea: 'RGIA Air Freight Hub', speedLimitKmh: 25 },
  ],
  // Corridor 2: Uppal Bio-Cluster -> Patancheru Vaccine Plant via ORR
  [
    { lat: 17.4065, lng: 78.5591, area: 'Uppal Bio-Cluster', subArea: 'East Logistics Zone, Hyderabad', speedLimitKmh: 42 },
    { lat: 17.4480, lng: 78.5220, area: 'Tarnaka Cold Exchange', subArea: 'Secunderabad Corridor', speedLimitKmh: 48 },
    { lat: 17.4790, lng: 78.4650, area: 'Bowenpally Cold Hub', subArea: 'NH-44 Junction', speedLimitKmh: 50 },
    { lat: 17.5080, lng: 78.3420, area: 'Miyapur Transit Point', subArea: 'NH-65 West, Hyderabad', speedLimitKmh: 54 },
    { lat: 17.5285, lng: 78.2640, area: 'Patancheru Vaccine Plant', subArea: 'Sangareddy Industrial Belt', speedLimitKmh: 30 },
  ],
];

export function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371e3;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dp = ((lat2 - lat1) * Math.PI) / 180;
  const dl = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dp / 2) * Math.sin(dp / 2) +
    Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Computes incremental trip distance using the 100m GPS jitter filter.
 * Displacements under 100m are ignored to eliminate stationary GNSS drift.
 */
export function filterAndAccumulateDistanceKm(
  prevLat: number,
  prevLng: number,
  nextLat: number,
  nextLng: number,
  currentDistanceKm: number
): { distanceKm: number; acceptedAnchor: boolean } {
  const meters = haversineMeters(prevLat, prevLng, nextLat, nextLng);
  if (meters >= 100 && meters < 20000) {
    return {
      distanceKm: Number((currentDistanceKm + meters / 1000).toFixed(3)),
      acceptedAnchor: true,
    };
  }
  return {
    distanceKm: currentDistanceKm,
    acceptedAnchor: false,
  };
}

export function computeBearingDegrees(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dl = ((lng2 - lng1) * Math.PI) / 180;
  const y = Math.sin(dl) * Math.cos(p2);
  const x =
    Math.cos(p1) * Math.sin(p2) -
    Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  const theta = Math.atan2(y, x);
  return Math.round(((theta * 180) / Math.PI + 360) % 360);
}

/**
 * Interpolates a vehicle position smoothly along a closed loop or ping-pong corridor.
 */
export function interpolateCorridorPosition(
  corridor: RouteWaypointSeed[],
  progress: number // 0..1 along route
): {
  lat: number;
  lng: number;
  headingDeg: number;
  targetSpeedKmh: number;
  area: string;
  subArea: string;
} {
  const n = corridor.length;
  if (n === 0) {
    return {
      lat: 17.4483,
      lng: 78.3915,
      headingDeg: 0,
      targetSpeedKmh: 0,
      area: 'Hyderabad Hub',
      subArea: 'Telangana',
    };
  }
  if (n === 1) {
    return {
      lat: corridor[0].lat,
      lng: corridor[0].lng,
      headingDeg: 0,
      targetSpeedKmh: corridor[0].speedLimitKmh,
      area: corridor[0].area,
      subArea: corridor[0].subArea,
    };
  }

  // Ping-pong smoothly so trucks return along the same highway corridor
  const normalized = progress % 2;
  const forward = normalized <= 1;
  const tTotal = (forward ? normalized : 2 - normalized) * (n - 1);
  const idx = Math.min(n - 2, Math.max(0, Math.floor(tTotal)));
  const frac = tTotal - idx;

  const a = forward ? corridor[idx] : corridor[idx + 1];
  const b = forward ? corridor[idx + 1] : corridor[idx];
  const localFrac = forward ? frac : 1 - frac;

  const lat = a.lat + (b.lat - a.lat) * localFrac;
  const lng = a.lng + (b.lng - a.lng) * localFrac;
  const headingDeg = computeBearingDegrees(a.lat, a.lng, b.lat, b.lng);
  const targetSpeedKmh =
    a.speedLimitKmh + (b.speedLimitKmh - a.speedLimitKmh) * localFrac;

  const nearest = localFrac < 0.5 ? a : b;
  return {
    lat: Number(lat.toFixed(6)),
    lng: Number(lng.toFixed(6)),
    headingDeg,
    targetSpeedKmh: Number(targetSpeedKmh.toFixed(1)),
    area: nearest.area,
    subArea: nearest.subArea,
  };
}

export function isPointInPolygon(
  lat: number,
  lng: number,
  polygon: [number, number][]
): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0];
    const yi = polygon[i][1];
    const xj = polygon[j][0];
    const yj = polygon[j][1];
    const intersect =
      yi > lng !== yj > lng &&
      lat < ((xj - xi) * (lng - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function evaluateGeofenceMembership(
  lat: number,
  lng: number,
  geofences: GeofenceRecord[]
): { inside: boolean; geofenceName: string | null } {
  for (const gf of geofences) {
    if (!gf.enabled) continue;
    const geom = gf.geometry;
    if (geom.type === 'CIRCLE' && geom.center && geom.radius_m) {
      const dist = haversineMeters(lat, lng, geom.center.lat, geom.center.lng);
      if (dist <= geom.radius_m) {
        return { inside: true, geofenceName: gf.name };
      }
    } else if (geom.type === 'POLYGON' && geom.coordinates) {
      if (isPointInPolygon(lat, lng, geom.coordinates)) {
        return { inside: true, geofenceName: gf.name };
      }
    } else if (geom.type === 'CORRIDOR' && geom.coordinates && geom.radius_m) {
      for (const [cLat, cLng] of geom.coordinates) {
        if (haversineMeters(lat, lng, cLat, cLng) <= geom.radius_m) {
          return { inside: true, geofenceName: gf.name };
        }
      }
    }
  }
  return { inside: false, geofenceName: null };
}

/**
 * Computes linear regression slope (°C/min) over recent thermal history
 * and forecasts +15m, +30m, +60m temperatures + excursion risk.
 * Enforces baseline requirement (>= 3 samples).
 */
export function computeThermalForecast(
  recentSamples: Array<{ recorded_at_ms: number; cargo_temp_c: number }>,
  targetMinC: number,
  targetMaxC: number
): TemperatureForecast {
  if (recentSamples.length === 0) {
    return {
      current_temp_c: 0,
      predicted_15m_c: null,
      predicted_30m_c: null,
      predicted_60m_c: null,
      rate_c_per_min: 0,
      excursion_risk_pct: 0,
      risk_level: 'LOW',
      baseline_ready: false,
      recommendation: 'Acquiring thermal baseline telemetry.',
    };
  }

  const ordered = [...recentSamples].sort(
    (a, b) => a.recorded_at_ms - b.recorded_at_ms
  );
  const current = ordered[ordered.length - 1].cargo_temp_c;

  if (ordered.length < 3) {
    return {
      current_temp_c: Number(current.toFixed(2)),
      predicted_15m_c: null,
      predicted_30m_c: null,
      predicted_60m_c: null,
      rate_c_per_min: 0,
      excursion_risk_pct: 0,
      risk_level: 'LOW',
      baseline_ready: false,
      recommendation: `Acquiring thermal baseline (${ordered.length}/3 packets).`,
    };
  }

  const t0 = ordered[0].recorded_at_ms;
  const xs = ordered.map((s) => (s.recorded_at_ms - t0) / 60000);
  const ys = ordered.map((s) => s.cargo_temp_c);

  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;

  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    num += dx * (ys[i] - meanY);
    den += dx * dx;
  }

  const spanMin = Math.max(0.05, xs[xs.length - 1] - xs[0]);
  const rawSlope = den > 1e-6 ? num / den : 0;
  // Require sustained multi-minute horizon or strong delta before projecting steep 60m excursion
  const totalDelta = Math.abs(ys[ys.length - 1] - ys[0]);
  const dampedSlope =
    spanMin < 1.0 && totalDelta < 0.35
      ? rawSlope * 0.12
      : rawSlope;
  const slope = Math.max(-0.45, Math.min(0.45, dampedSlope));

  // Damped thermal projection (cooling/warming equilibrates over 60m)
  const pred15 = Number((current + slope * 15 * 0.85).toFixed(2));
  const pred30 = Number((current + slope * 30 * 0.7).toFixed(2));
  const pred60 = Number((current + slope * 60 * 0.52).toFixed(2));

  let riskPct = 8;
  if (current > targetMaxC || current < targetMinC) {
    riskPct = 92;
  } else {
    const marginTop = targetMaxC - current;
    const marginBot = current - targetMinC;
    if (pred30 > targetMaxC || pred30 < targetMinC) {
      riskPct = 78;
    } else if (pred60 > targetMaxC || pred60 < targetMinC) {
      riskPct = 56;
    } else if (marginTop < 1.2 || marginBot < 0.8) {
      riskPct = 36;
    } else {
      riskPct = Math.max(4, Math.round(Math.abs(slope) * 180));
    }
  }

  const riskLevel =
    riskPct >= 70 ? 'HIGH' : riskPct >= 35 ? 'MODERATE' : 'LOW';

  let recommendation = 'Operating within GDP pharmaceutical cold-chain band (2.0–8.0°C).';
  if (current > targetMaxC) {
    recommendation = 'CRITICAL: Cargo temperature above threshold. Inspect refrigeration compressor and door seal immediately.';
  } else if (current < targetMinC) {
    recommendation = 'WARNING: Over-cooling risk near freezing boundary. Adjust evaporator thermostat setpoint.';
  } else if (riskLevel === 'HIGH') {
    recommendation = `Thermal drift (+${slope.toFixed(2)}°C/min) projected to breach ${targetMaxC}°C within 30m. Verify condenser airflow.`;
  } else if (riskLevel === 'MODERATE') {
    recommendation = 'Mild thermal warming trend observed. Monitor door dwell intervals at upcoming hub.';
  }

  return {
    current_temp_c: Number(current.toFixed(2)),
    predicted_15m_c: pred15,
    predicted_30m_c: pred30,
    predicted_60m_c: pred60,
    rate_c_per_min: Number(slope.toFixed(3)),
    excursion_risk_pct: riskPct,
    risk_level: riskLevel,
    baseline_ready: true,
    recommendation,
  };
}
