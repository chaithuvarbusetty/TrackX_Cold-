-- ==============================================================================
-- FILE: schema_postgres.sql
-- PURPOSE:
-- High-Performance PostgreSQL & TimescaleDB Schema for ColdChain CMS & Telemetry.
-- Optimized for high-throughput 1Hz IoT sensor writes, spatial indexing, and AI drift rollups.
-- ==============================================================================

-- 1. Enable extensions if available (TimescaleDB, PostGIS, pg_trgm)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. Master Devices Table
CREATE TABLE IF NOT EXISTS devices (
    device_id VARCHAR(64) PRIMARY KEY,
    node_id VARCHAR(64) NOT NULL,
    imei VARCHAR(32) NOT NULL,
    imsi VARCHAR(32) NOT NULL,
    vehicle_name VARCHAR(128) NOT NULL,
    cargo_type VARCHAR(64) NOT NULL,
    target_min_c DOUBLE PRECISION NOT NULL DEFAULT 2.0,
    target_max_c DOUBLE PRECISION NOT NULL DEFAULT 8.0,
    sampling_interval_sec INTEGER NOT NULL DEFAULT 2,
    route_id INTEGER NOT NULL DEFAULT 0,
    created_at_ms BIGINT NOT NULL
);

-- 3. High-Velocity Telemetry Time-Series Logs
CREATE TABLE IF NOT EXISTS telemetry_logs (
    id BIGSERIAL PRIMARY KEY,
    seq BIGINT NOT NULL,
    device_id VARCHAR(64) NOT NULL,
    node_id VARCHAR(64) NOT NULL,
    recorded_at_ms BIGINT NOT NULL,
    recorded_at_time TIMESTAMPTZ GENERATED ALWAYS AS (TO_TIMESTAMP(recorded_at_ms / 1000.0)) STORED,
    cargo_temp_c DOUBLE PRECISION,
    ambient_temp_c DOUBLE PRECISION NOT NULL,
    humidity_pct DOUBLE PRECISION NOT NULL,
    lat DOUBLE PRECISION NOT NULL,
    lng DOUBLE PRECISION NOT NULL,
    altitude_m DOUBLE PRECISION NOT NULL DEFAULT 542.0,
    speed_kmh DOUBLE PRECISION NOT NULL,
    heading_deg INTEGER NOT NULL,
    satellites INTEGER NOT NULL DEFAULT 12,
    location_accuracy_m DOUBLE PRECISION NOT NULL DEFAULT 2.8,
    network_rssi_dbm INTEGER NOT NULL,
    lte_csq INTEGER NOT NULL,
    node_rssi_dbm INTEGER,
    node_connected SMALLINT NOT NULL DEFAULT 1,
    door_status VARCHAR(32) NOT NULL DEFAULT 'SEALED',
    tamper SMALLINT NOT NULL DEFAULT 0,
    battery_pct DOUBLE PRECISION NOT NULL,
    compressor_active SMALLINT NOT NULL DEFAULT 1,
    distance_km DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    address TEXT NOT NULL DEFAULT '',
    sub_area VARCHAR(128) NOT NULL DEFAULT '',
    geofence_name VARCHAR(128),
    geofence_inside SMALLINT NOT NULL DEFAULT 0
);

-- Covering Indexes for Sub-millisecond Telemetry Retrieval
CREATE INDEX IF NOT EXISTS idx_telem_dev_ts_cov
    ON telemetry_logs (device_id, recorded_at_ms DESC, cargo_temp_c, speed_kmh, lat, lng);

CREATE INDEX IF NOT EXISTS idx_telem_dev_ts
    ON telemetry_logs (device_id, recorded_at_ms DESC);

CREATE INDEX IF NOT EXISTS idx_telem_dev_seq
    ON telemetry_logs (device_id, seq DESC);

CREATE INDEX IF NOT EXISTS idx_telem_ts
    ON telemetry_logs (recorded_at_ms DESC);

CREATE INDEX IF NOT EXISTS idx_telem_time
    ON telemetry_logs (recorded_at_time DESC);

-- 4. Materialized Real-time Fleet Hot State (1 row per device)
CREATE TABLE IF NOT EXISTS device_latest_state (
    device_id VARCHAR(64) PRIMARY KEY,
    seq BIGINT NOT NULL,
    recorded_at_ms BIGINT NOT NULL,
    cargo_temp_c DOUBLE PRECISION,
    ambient_temp_c DOUBLE PRECISION NOT NULL,
    humidity_pct DOUBLE PRECISION NOT NULL,
    lat DOUBLE PRECISION NOT NULL,
    lng DOUBLE PRECISION NOT NULL,
    altitude_m DOUBLE PRECISION NOT NULL,
    speed_kmh DOUBLE PRECISION NOT NULL,
    heading_deg INTEGER NOT NULL,
    satellites INTEGER NOT NULL,
    location_accuracy_m DOUBLE PRECISION NOT NULL,
    network_rssi_dbm INTEGER NOT NULL,
    lte_csq INTEGER NOT NULL,
    node_rssi_dbm INTEGER,
    node_connected SMALLINT NOT NULL,
    door_status VARCHAR(32) NOT NULL,
    tamper SMALLINT NOT NULL,
    battery_pct DOUBLE PRECISION NOT NULL,
    compressor_active SMALLINT NOT NULL,
    distance_km DOUBLE PRECISION NOT NULL,
    address TEXT NOT NULL,
    sub_area VARCHAR(128) NOT NULL,
    geofence_name VARCHAR(128),
    geofence_inside SMALLINT NOT NULL DEFAULT 0,
    predicted_temp_30m_c DOUBLE PRECISION,
    excursion_risk_pct DOUBLE PRECISION NOT NULL DEFAULT 0,
    health_score DOUBLE PRECISION NOT NULL DEFAULT 96,
    history_temps_json JSONB NOT NULL DEFAULT '[]'::jsonb
);

-- 5. Pre-Aggregated Hourly Temperature Rollups
CREATE TABLE IF NOT EXISTS temp_rollups_hourly (
    bucket_epoch_hr BIGINT PRIMARY KEY,
    label VARCHAR(32) NOT NULL,
    sum_temp DOUBLE PRECISION NOT NULL,
    min_temp DOUBLE PRECISION NOT NULL,
    max_temp DOUBLE PRECISION NOT NULL,
    readings_count INTEGER NOT NULL
);

-- 6. Fleet Trips Table
CREATE TABLE IF NOT EXISTS trips (
    trip_id VARCHAR(64) PRIMARY KEY,
    device_id VARCHAR(64) NOT NULL,
    origin VARCHAR(128) NOT NULL,
    destination VARCHAR(128) NOT NULL,
    start_time VARCHAR(64) NOT NULL,
    end_time VARCHAR(64),
    duration_minutes INTEGER NOT NULL,
    total_distance_km DOUBLE PRECISION NOT NULL,
    avg_speed_kmh DOUBLE PRECISION NOT NULL,
    max_speed_kmh DOUBLE PRECISION NOT NULL,
    min_temp_c DOUBLE PRECISION,
    max_temp_c DOUBLE PRECISION,
    mkt_temp_c DOUBLE PRECISION,
    halt_count INTEGER NOT NULL,
    excursion_flag SMALLINT NOT NULL DEFAULT 0,
    status VARCHAR(32) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_trips_device_start
    ON trips (device_id, start_time DESC);

CREATE INDEX IF NOT EXISTS idx_trips_dev_status_start
    ON trips (device_id, status, start_time DESC);

CREATE INDEX IF NOT EXISTS idx_trips_status
    ON trips (status);

-- 7. Trip Waypoints Table
CREATE TABLE IF NOT EXISTS trip_waypoints (
    id BIGSERIAL PRIMARY KEY,
    trip_id VARCHAR(64) NOT NULL REFERENCES trips(trip_id) ON DELETE CASCADE,
    seq INTEGER NOT NULL,
    lat DOUBLE PRECISION NOT NULL,
    lng DOUBLE PRECISION NOT NULL,
    speed_kmh DOUBLE PRECISION NOT NULL,
    heading_deg INTEGER NOT NULL,
    cargo_temp_c DOUBLE PRECISION,
    timestamp VARCHAR(64) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_trip_wp_trip_seq
    ON trip_waypoints (trip_id, seq ASC);

CREATE INDEX IF NOT EXISTS idx_trip_wp_trip_seq_desc
    ON trip_waypoints (trip_id, seq DESC);

-- 8. Trip Halts Table
CREATE TABLE IF NOT EXISTS trip_halts (
    id BIGSERIAL PRIMARY KEY,
    trip_id VARCHAR(64) NOT NULL REFERENCES trips(trip_id) ON DELETE CASCADE,
    lat DOUBLE PRECISION NOT NULL,
    lng DOUBLE PRECISION NOT NULL,
    duration_minutes INTEGER NOT NULL,
    start_time VARCHAR(64) NOT NULL,
    end_time VARCHAR(64) NOT NULL,
    start_temp_c DOUBLE PRECISION,
    end_temp_c DOUBLE PRECISION,
    location_name VARCHAR(128) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_trip_halts_trip
    ON trip_halts (trip_id);

-- 9. Geofences Master Table
CREATE TABLE IF NOT EXISTS geofences (
    id SERIAL PRIMARY KEY,
    name VARCHAR(128) NOT NULL,
    device_id VARCHAR(64) NOT NULL,
    geometry_json JSONB NOT NULL,
    rules_json JSONB NOT NULL,
    enabled SMALLINT NOT NULL DEFAULT 1,
    created_at_ms BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_geofences_enabled_dev
    ON geofences (enabled, device_id);

-- 10. Fleet Safety & Excursion Alerts Audit Trail
CREATE TABLE IF NOT EXISTS alerts (
    alert_id VARCHAR(64) PRIMARY KEY,
    device_id VARCHAR(64) NOT NULL,
    alert_type VARCHAR(64) NOT NULL,
    message TEXT NOT NULL,
    severity VARCHAR(32) NOT NULL,
    ai_analysis TEXT NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'Active',
    created_at_ms BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_alerts_status_ts
    ON alerts (status, created_at_ms DESC);

CREATE INDEX IF NOT EXISTS idx_alerts_status_sev
    ON alerts (status, severity);

CREATE INDEX IF NOT EXISTS idx_alerts_dev_status_ts
    ON alerts (device_id, status, created_at_ms DESC);

CREATE INDEX IF NOT EXISTS idx_alerts_device_ts
    ON alerts (device_id, created_at_ms DESC);

-- OPTIONAL: If TimescaleDB is installed, execute:
-- SELECT create_hypertable('telemetry_logs', 'recorded_at_time', if_not_exists => TRUE);
