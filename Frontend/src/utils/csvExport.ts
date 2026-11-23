import type { TelemetryPoint } from '../shared/types';

function escapeCsvCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export const TELEMETRY_CSV_HEADERS = [
  'seq',
  'device_id',
  'node_id',
  'timestamp',
  'cargo_temp_c',
  'ambient_temp_c',
  'humidity_pct',
  'lat',
  'lng',
  'speed_kmh',
  'heading_deg',
  'satellites',
  'location_accuracy_m',
  'network_rssi_dbm',
  'lte_csq',
  'node_rssi_dbm',
  'node_connected',
  'door_status',
  'tamper',
  'battery_pct',
  'compressor_active',
  'distance_km',
  'address',
  'sub_area',
  'geofence_name',
  'geofence_inside',
] as const;

export function buildTelemetryCsv(points: TelemetryPoint[]): string {
  const rows: string[] = [TELEMETRY_CSV_HEADERS.join(',')];
  for (const p of points) {
    rows.push(
      [
        p.seq,
        p.device_id,
        p.node_id,
        p.timestamp,
        p.cargo_temp_c != null ? p.cargo_temp_c.toFixed(2) : '',
        p.ambient_temp_c.toFixed(1),
        p.humidity_pct.toFixed(1),
        p.lat.toFixed(6),
        p.lng.toFixed(6),
        p.speed_kmh.toFixed(1),
        p.heading_deg,
        p.satellites,
        p.location_accuracy_m,
        p.network_rssi_dbm,
        p.lte_csq,
        p.node_rssi_dbm,
        p.node_connected,
        p.door_status,
        p.tamper,
        p.battery_pct,
        p.compressor_active,
        p.distance_km.toFixed(3),
        p.address,
        p.sub_area,
        p.geofence_name ?? '',
        p.geofence_inside,
      ]
        .map(escapeCsvCell)
        .join(',')
    );
  }
  return rows.join('\r\n');
}
