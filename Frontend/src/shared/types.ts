export type ModuleId =
  | 'live-tracking'
  | 'thermal-status'
  | 'vehicle-readings'
  | 'trips'
  | 'twin-world'
  | 'help';

export type OperationalState = 'IN_TRANSIT' | 'AT_STOP' | 'OFFLINE';
export type ConditionStatus = 'OPTIMAL' | 'WARNING' | 'EXCURSION';
export type AlertSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
export type AlertStatus = 'Active' | 'Acknowledged' | 'Resolved';

export interface DeviceRecord {
  device_id: string;
  node_id: string;
  imei: string;
  imsi: string;
  vehicle_name: string;
  cargo_type: string;
  target_min_c: number;
  target_max_c: number;
  sampling_interval_sec: number;
  route_id: number;
}

export interface TelemetryPoint {
  seq: number;
  device_id: string;
  node_id: string;
  recorded_at_ms: number;
  timestamp: string;
  cargo_temp_c: number | null;
  ambient_temp_c: number;
  humidity_pct: number;
  lat: number;
  lng: number;
  altitude_m: number;
  speed_kmh: number;
  heading_deg: number;
  satellites: number;
  location_accuracy_m: number;
  network_rssi_dbm: number;
  lte_csq: number;
  node_rssi_dbm: number | null;
  node_connected: boolean;
  door_status: 'SEALED' | 'OPEN';
  tamper: boolean;
  battery_pct: number;
  compressor_active: boolean;
  distance_km: number;
  address: string;
  sub_area: string;
  geofence_name: string | null;
  geofence_inside: boolean;
}

export interface TemperatureForecast {
  current_temp_c: number | null;
  predicted_15m_c: number | null;
  predicted_30m_c: number | null;
  predicted_60m_c: number | null;
  rate_c_per_min: number;
  excursion_risk_pct: number;
  risk_level: 'LOW' | 'MODERATE' | 'HIGH';
  baseline_ready: boolean;
  recommendation: string;
}

export interface FleetTableRow {
  device_id: string;
  node_id: string;
  vehicle_name: string;
  cargo_type: string;
  current_temp_c: number | null;
  ambient_temp_c: number;
  target_min_c: number;
  target_max_c: number;
  lat: number;
  lng: number;
  speed_kmh: number;
  heading_deg: number;
  network_rssi_dbm: number;
  node_connected?: boolean;
  node_rssi_dbm?: number | null;
  connectivity: 'ONLINE' | 'OFFLINE';
  operational_state: OperationalState;
  security: 'SEALED' | 'OPEN';
  tamper: boolean;
  status: ConditionStatus;
  health_score: number;
  health_rating: 'GOOD' | 'FAIR' | 'POOR' | 'CRITICAL';
  predicted_temp_30m_c: number | null;
  excursion_risk_pct: number;
  distance_km: number;
  address: string;
  geofence_name: string | null;
  last_seen_ms: number;
  last_seen_str: string;
  packet_age_sec: number;
  seq: number;
  compressor_active: boolean;
  history_temps: (number | null)[];
}

export interface AlertItem {
  alert_id: string;
  device_id: string;
  alert_type: string;
  message: string;
  severity: AlertSeverity;
  ai_analysis: string;
  status: AlertStatus;
  created_at_ms: number;
  time_str: string;
}

export interface TripSummary {
  trip_id: string;
  device_id: string;
  origin: string;
  destination: string;
  start_time: string;
  end_time: string | null;
  duration_minutes: number;
  total_distance_km: number;
  avg_speed_kmh: number;
  max_speed_kmh: number;
  min_temp_c: number;
  max_temp_c: number;
  mkt_temp_c: number;
  halt_count: number;
  excursion_flag: number;
  status: 'IN_PROGRESS' | 'COMPLETED' | 'DELAYED';
}

export interface TripWaypoint {
  lat: number;
  lng: number;
  speed_kmh: number;
  heading_deg: number;
  cargo_temp_c: number;
  timestamp: string;
}

export interface TripHalt {
  lat: number;
  lng: number;
  duration_minutes: number;
  start_time: string;
  end_time: string;
  start_temp_c: number;
  end_temp_c: number;
  location_name: string;
}

export interface TripDetails extends TripSummary {
  waypoints: TripWaypoint[];
  halts: TripHalt[];
}

export interface DailyTripLeg {
  trip_id: string;
  origin: string;
  destination: string;
  status: string;
  start_time: string;
  end_time: string | null;
  duration_minutes: number;
  total_distance_km: number;
  waypoints: TripWaypoint[];
  halts: TripHalt[];
}

export interface GeofenceRecord {
  id: number;
  name: string;
  device_id: string;
  geometry: {
    type: 'CIRCLE' | 'POLYGON' | 'CORRIDOR';
    center?: { lat: number; lng: number };
    radius_m?: number;
    coordinates?: [number, number][];
  };
  rules: {
    enter: boolean;
    exit: boolean;
    dwell: boolean;
    dwell_seconds: number;
    max_speed_kmh: number | null;
    temp_min_c: number;
    temp_max_c: number;
  };
  enabled: boolean;
}

export interface TempTrendPoint {
  label: string;
  avg_temp_c: number;
  min_temp_c: number;
  max_temp_c: number;
  readings_count: number;
}

export interface FleetOverviewPayload {
  kpis: {
    total_vehicles: number;
    in_transit: number;
    at_stop: number;
    offline: number;
    active_alerts: number;
    critical_alerts: number;
    fleet_health_score: number;
    fleet_health_rating: 'GOOD' | 'FAIR' | 'POOR' | 'CRITICAL';
  };
  fleet_health: {
    good: number;
    fair: number;
    poor: number;
    critical: number;
  };
  fleet_table: FleetTableRow[];
  trips_overview: {
    total: number;
    completed: number;
    in_progress: number;
    delayed: number;
    routes: TripSummary[];
  };
  temperature_trend_24h: TempTrendPoint[];
  recent_alerts: AlertItem[];
  query_latency_ms: number;
  total_db_rows: number;
}

export interface QueryPlanStep {
  id: number;
  parent: number;
  detail: string;
}

export interface QueryOptimizationMetric {
  name: string;
  description: string;
  unoptimized_ms: number;
  optimized_ms: number;
  speedup_factor: number;
  rows_scanned_before: number;
  rows_scanned_after: number;
  explain_before: string[];
  explain_after: string[];
}

export interface DbDiagnosticsPayload {
  engine: string;
  journal_mode: string;
  cache_size_kb: number;
  total_telemetry_rows: number;
  total_rollup_rows: number;
  total_trips: number;
  total_alerts: number;
  avg_dashboard_query_ms: number;
  indexes: Array<{ name: string; table: string; sql: string }>;
  benchmarks: QueryOptimizationMetric[];
  last_benchmarked_at: string;
}

export interface WsTelemetryMessage {
  type: 'INITIAL_FLEET_STATE' | 'TELEMETRY_TICK' | 'ALERT_NEW' | 'ALERT_UPDATED';
  server_ts_ms: number;
  query_latency_ms?: number;
  fleet?: FleetTableRow[];
  tick?: {
    updates: FleetTableRow[];
    selected_packet?: TelemetryPoint;
    trend_latest?: TempTrendPoint;
    kpis: FleetOverviewPayload['kpis'];
    fleet_health: FleetOverviewPayload['fleet_health'];
  };
  alert?: AlertItem;
}
