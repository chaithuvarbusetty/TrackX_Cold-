import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';
import type {
  FleetTableRow,
  GeofenceRecord,
  TelemetryPoint,
  TripHalt,
  TripWaypoint,
  DailyTripLeg,
} from '../shared/types';
import { getVehicleCargoProfile, type VehicleBodyType } from '../utils/vehicleCargo';

interface LiveFleetMapProps {
  mode: 'overview' | 'live' | 'trip';
  fleetRows?: FleetTableRow[];
  selectedDeviceId?: string;
  onSelectDevice?: (deviceId: string) => void;
  liveHistory?: TelemetryPoint[];
  geofences?: GeofenceRecord[];
  tripWaypoints?: TripWaypoint[];
  tripHalts?: TripHalt[];
  dailyLegs?: DailyTripLeg[];
  replayIndex?: number;
  heightClass?: string;
  focusedVehicleName?: string;
  focusedCargoType?: string;
  focusedLabel?: string;
  focusedConnectivity?: string;
}

type MapStyleMode = 'street' | 'satellite' | 'osm';

class FallbackGridLayer extends L.GridLayer {
  createTile(): HTMLElement {
    const tile = document.createElement('canvas');
    const size = this.getTileSize();
    tile.width = size.x;
    tile.height = size.y;
    const ctx = tile.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#e8edf3';
      ctx.fillRect(0, 0, size.x, size.y);
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.25)';
      ctx.lineWidth = 1;
      ctx.strokeRect(0, 0, size.x, size.y);
    }
    return tile;
  }
}

function buildTopDownVehicleSvg(
  bodyType: VehicleBodyType,
  accentHex: string,
  statusColor: string,
  headingDeg: number
): string {
  if (bodyType === 'semi-reefer') {
    return `
      <svg width="26" height="26" viewBox="0 0 32 32" style="transform:rotate(${headingDeg}deg);transition:transform 250ms ease;" aria-hidden="true">
        <rect x="8.5" y="10.5" width="15" height="18" rx="2.2" fill="${accentHex}" stroke="#ffffff" stroke-width="1"/>
        <line x1="12" y1="13" x2="12" y2="26" stroke="#ffffff" stroke-width="1" stroke-opacity="0.5"/>
        <line x1="16" y1="13" x2="16" y2="26" stroke="#ffffff" stroke-width="1" stroke-opacity="0.5"/>
        <line x1="20" y1="13" x2="20" y2="26" stroke="#ffffff" stroke-width="1" stroke-opacity="0.5"/>
        <path d="M10 10.5 L11 4.5 C11.3 3.4 12.2 2.8 13.5 2.8 L18.5 2.8 C19.8 2.8 20.7 3.4 21 4.5 L22 10.5 Z" fill="#0f172a"/>
        <path d="M11.8 8.2 L12.4 5.2 L19.6 5.2 L20.2 8.2 Z" fill="#bfdbfe"/>
        <circle cx="12.5" cy="3.5" r="1" fill="#fef08a"/>
        <circle cx="19.5" cy="3.5" r="1" fill="#fef08a"/>
      </svg>
    `;
  }

  if (bodyType === 'sprinter-van') {
    return `
      <svg width="24" height="24" viewBox="0 0 32 32" style="transform:rotate(${headingDeg}deg);transition:transform 250ms ease;" aria-hidden="true">
        <path d="M10 9 C10 5 12 3 16 3 C20 3 22 5 22 9 L22 25 C22 26.8 20.8 28 19 28 L13 28 C11.2 28 10 26.8 10 25 Z" fill="${accentHex}" stroke="#ffffff" stroke-width="1"/>
        <path d="M11.6 9.5 C12 6.8 13.5 5.6 16 5.6 C18.5 5.6 20 6.8 20.4 9.5 Z" fill="#e0f2fe"/>
        <rect x="13" y="13.5" width="6" height="9" rx="1.5" fill="#ffffff" fill-opacity="0.3"/>
        <circle cx="12.2" cy="4.2" r="0.9" fill="#fef08a"/>
        <circle cx="19.8" cy="4.2" r="0.9" fill="#fef08a"/>
      </svg>
    `;
  }

  if (bodyType === 'cryo-carrier') {
    return `
      <svg width="25" height="25" viewBox="0 0 32 32" style="transform:rotate(${headingDeg}deg);transition:transform 250ms ease;" aria-hidden="true">
        <rect x="8.5" y="10" width="15" height="17" rx="3" fill="${accentHex}" stroke="#ffffff" stroke-width="1"/>
        <circle cx="16" cy="18.5" r="4.2" fill="#ffffff" fill-opacity="0.32" stroke="#ffffff" stroke-width="1"/>
        <path d="M10.5 10 L11.4 4.8 C11.7 3.8 12.6 3.2 13.8 3.2 L18.2 3.2 C19.4 3.2 20.3 3.8 20.6 4.8 L21.5 10 Z" fill="${statusColor}"/>
        <path d="M12.2 8.2 L12.7 5.5 L19.3 5.5 L19.8 8.2 Z" fill="#e0f2fe"/>
      </svg>
    `;
  }

  // box-truck
  return `
    <svg width="25" height="25" viewBox="0 0 32 32" style="transform:rotate(${headingDeg}deg);transition:transform 250ms ease;" aria-hidden="true">
      <rect x="9" y="10.5" width="14" height="16.5" rx="1.8" fill="${accentHex}" stroke="#ffffff" stroke-width="1"/>
      <rect x="11.5" y="13" width="9" height="11" rx="1" fill="#ffffff" fill-opacity="0.25"/>
      <path d="M10.2 10.5 L11.2 4.8 C11.5 3.8 12.4 3.2 13.6 3.2 L18.4 3.2 C19.6 3.2 20.5 3.8 20.8 4.8 L21.8 10.5 Z" fill="#1e293b"/>
      <path d="M12 8.4 L12.5 5.4 L19.5 5.4 L20 8.4 Z" fill="#e0f2fe"/>
    </svg>
  `;
}

/**
 * Renders distinct vehicle silhouettes and cargo item identification pills on the map.
 */
function createVehicleMarkerIcon(
  deviceId: string,
  vehicleName: string,
  cargoType: string,
  tempC: number | null,
  status: string,
  connectivity: string,
  headingDeg: number,
  selected: boolean
): L.DivIcon {
  const profile = getVehicleCargoProfile(vehicleName, cargoType);
  const statusColor =
    connectivity === 'OFFLINE'
      ? '#64748b'
      : status === 'EXCURSION'
        ? '#e11d48'
        : status === 'WARNING'
          ? '#d97706'
          : '#059669';

  const halo = selected
    ? 'box-shadow: 0 0 0 5px rgba(37, 99, 235, 0.28), 0 4px 12px rgba(15, 23, 42, 0.28);'
    : 'box-shadow: 0 2px 8px rgba(15, 23, 42, 0.22);';

  const tempLabel =
    tempC !== null && tempC !== undefined && !isNaN(tempC)
      ? ` · ${tempC.toFixed(1)}°C`
      : '';
  const svgHtml = buildTopDownVehicleSvg(
    profile.bodyType,
    profile.accentHex,
    statusColor,
    headingDeg
  );

  const isReal = deviceId === 'GW-001';
  const realTag = isReal && connectivity === 'ONLINE' ? '<span style="background:#0284c7;color:#fff;padding:0.5px 3.5px;border-radius:2px;font-size:8px;font-weight:bold;margin-right:2px;">LIVE</span>' : '';

  return L.divIcon({
    className: 'custom-vehicle-marker',
    iconSize: [120, 56],
    iconAnchor: [60, 22],
    html: `
      <div style="display:flex;flex-direction:column;align-items:center;pointer-events:auto;">
        <div style="width:38px;height:38px;border-radius:9999px;background:#ffffff;border:3px solid ${statusColor};display:flex;align-items:center;justify-content:center;${halo}">
          ${svgHtml}
        </div>
        <span style="margin-top:2px;display:inline-flex;align-items:center;gap:4px;padding:1.5px 6px;border-radius:4px;background:rgba(255,255,255,0.96);border:1px solid ${statusColor};color:#0f172a;font-family:IBM Plex Mono,monospace;font-size:9px;font-weight:700;white-space:nowrap;box-shadow:0 2px 6px rgba(15,23,42,0.18);">
          <span style="width:6px;height:6px;border-radius:9999px;background:${profile.accentHex};display:inline-block;"></span>
          ${realTag}${deviceId} · ${profile.cargoShortLabel}${tempLabel}
        </span>
      </div>
    `,
  });
}

export const LiveFleetMap: React.FC<LiveFleetMapProps> = ({
  mode,
  fleetRows = [],
  selectedDeviceId,
  onSelectDevice,
  liveHistory = [],
  geofences = [],
  tripWaypoints = [],
  tripHalts = [],
  dailyLegs = [],
  replayIndex = 0,
  heightClass = 'h-[360px]',
  focusedVehicleName = 'Refrigerated Carrier',
  focusedCargoType = 'Cold Cargo',
  focusedLabel = 'UNIT',
  focusedConnectivity,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const markersRef = useRef<Map<string, L.Marker>>(new Map());
  const overlayLayerRef = useRef<L.LayerGroup | null>(null);
  const hasCenteredRef = useRef(false);
  const hasFittedTripRef = useRef<string>('');
  const [mapStyle, setMapStyle] = useState<MapStyleMode>('street');

  const handleZoomIn = () => {
    mapRef.current?.zoomIn();
  };

  const handleZoomOut = () => {
    mapRef.current?.zoomOut();
  };

  const handleRegionalZoomOut = () => {
    const map = mapRef.current;
    if (!map) return;
    // Set regional corridor zoom (zoom 10) centered on Sangareddy & Hyderabad Western Logistics Corridor
    map.setView([17.58, 78.18], 10, { animate: true });
  };

  const handleFitRoute = () => {
    const map = mapRef.current;
    if (!map) return;
    if (mode === 'trip' && tripWaypoints.length > 0) {
      const allCoords = tripWaypoints.map((w) => [w.lat, w.lng] as [number, number]);
      const bounds = L.latLngBounds(allCoords);
      map.fitBounds(bounds, { padding: [55, 55], maxZoom: 11 });
    } else if (fleetRows.length > 0) {
      const bounds = L.latLngBounds(fleetRows.map((r) => [r.lat, r.lng]));
      map.fitBounds(bounds, { padding: [55, 55], maxZoom: 11 });
    }
  };

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: [17.4483, 78.415],
      zoom: 12,
      zoomControl: true,
      attributionControl: true,
    });

    new FallbackGridLayer({ zIndex: 1 }).addTo(map);

    const tile = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
      {
        maxZoom: 19,
        attribution: 'Tiles &copy; Esri - Street Map',
        zIndex: 2,
      }
    ).addTo(map);
    tileLayerRef.current = tile;

    const overlayGroup = L.layerGroup().addTo(map);
    overlayLayerRef.current = overlayGroup;
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      tileLayerRef.current = null;
      markersRef.current.clear();
      overlayLayerRef.current = null;
      hasCenteredRef.current = false;
      hasFittedTripRef.current = '';
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (tileLayerRef.current) {
      map.removeLayer(tileLayerRef.current);
      tileLayerRef.current = null;
    }

    let url =
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}';
    let attribution = 'Tiles &copy; Esri - Street Map';

    if (mapStyle === 'satellite') {
      url =
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
      attribution = 'Imagery &copy; Esri';
    } else if (mapStyle === 'osm') {
      url = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
      attribution = '&copy; OpenStreetMap contributors';
    }

    tileLayerRef.current = L.tileLayer(url, {
      maxZoom: 19,
      attribution,
      zIndex: 2,
    }).addTo(map);
  }, [mapStyle]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (mode === 'trip') {
      for (const m of markersRef.current.values()) {
        map.removeLayer(m);
      }
      markersRef.current.clear();
      return;
    }

    const activeRows =
      mode === 'live' && selectedDeviceId
        ? fleetRows.filter((r) => r.device_id === selectedDeviceId)
        : fleetRows;

    const seenIds = new Set<string>();
    for (const row of activeRows) {
      seenIds.add(row.device_id);
      const isSelected = row.device_id === selectedDeviceId;
      const existing = markersRef.current.get(row.device_id);
      const profile = getVehicleCargoProfile(row.vehicle_name, row.cargo_type);
      const icon = createVehicleMarkerIcon(
        row.device_id,
        row.vehicle_name,
        row.cargo_type,
        row.current_temp_c,
        row.status,
        row.connectivity,
        row.heading_deg,
        isSelected
      );

      const isReal = row.device_id === 'GW-001';
      const popupHtml = `
        <div style="font-family:DM Sans,sans-serif;min-width:215px;font-size:12px;">
          <div style="font-weight:700;color:#0f172a;display:flex;align-items:center;justify-content:space-between;">
            <span>${row.device_id} · ${row.vehicle_name}</span>
            ${isReal && row.connectivity === 'ONLINE' ? '<span style="background:#0284c7;color:#fff;padding:2px 5px;border-radius:3px;font-size:9px;font-weight:700;">LIVE HARDWARE</span>' : ''}
          </div>
          <div style="margin-top:3px;font-size:11px;font-weight:600;color:${profile.accentHex};">
            ${profile.vehicleClassLabel} · ${row.cargo_type}
          </div>
          <div style="margin-top:4px;color:#475569;font-size:11px;">${row.address || 'Financial District / Gachibowli, Hyderabad'}</div>
          ${isReal ? '<div style="margin-top:3px;color:#0284c7;font-size:10px;font-family:IBM Plex Mono,monospace;">IMEI: 860738070471994 · GPS Acc: ±20.4m</div>' : ''}
          <div style="margin-top:6px;display:flex;justify-content:space-between;font-family:IBM Plex Mono,monospace;">
            <span>Temp: ${row.current_temp_c !== null && row.current_temp_c !== undefined ? `<strong style="color:${row.status === 'EXCURSION' ? '#e11d48' : '#1d4ed8'}">${row.current_temp_c.toFixed(2)}°C</strong>` : '<strong style="color:#d97706">--.-°C (Probe Standby)</strong>'}</span>
            <span>${(row.speed_kmh ?? 0).toFixed(0)} km/h</span>
          </div>
          <div style="margin-top:4px;font-size:10px;color:#64748b;font-family:IBM Plex Mono,monospace;">
            Heading ${row.heading_deg}° · Door ${row.security} · 4G: ${row.network_rssi_dbm} dBm
          </div>
        </div>
      `;

      if (existing) {
        existing.setLatLng([row.lat, row.lng]);
        existing.setIcon(icon);
        existing.setPopupContent(popupHtml);
      } else {
        const marker = L.marker([row.lat, row.lng], { icon })
          .addTo(map)
          .bindPopup(popupHtml);
        marker.on('click', () => {
          onSelectDevice?.(row.device_id);
        });
        markersRef.current.set(row.device_id, marker);
      }
    }

    for (const [id, marker] of markersRef.current.entries()) {
      if (!seenIds.has(id)) {
        map.removeLayer(marker);
        markersRef.current.delete(id);
      }
    }

    if (mode === 'live' && activeRows.length === 1) {
      map.panTo([activeRows[0].lat, activeRows[0].lng], { animate: true, duration: 0.5 });
    } else if (!hasCenteredRef.current && activeRows.length > 0) {
      const bounds = L.latLngBounds(activeRows.map((r) => [r.lat, r.lng]));
      map.fitBounds(bounds, { padding: [55, 55], maxZoom: 11 });
      hasCenteredRef.current = true;
    }
  }, [fleetRows, mode, selectedDeviceId, onSelectDevice]);

  useEffect(() => {
    const map = mapRef.current;
    const group = overlayLayerRef.current;
    if (!map || !group) return;
    group.clearLayers();

    for (const gf of geofences) {
      if (!gf.enabled) continue;
      if (gf.geometry.type === 'CIRCLE' && gf.geometry.center && gf.geometry.radius_m) {
        L.circle([gf.geometry.center.lat, gf.geometry.center.lng], {
          radius: gf.geometry.radius_m,
          color: '#0284c7',
          weight: 2,
          fillColor: '#0284c7',
          fillOpacity: 0.1,
          dashArray: '5 5',
        })
          .bindTooltip(gf.name)
          .addTo(group);
      } else if (gf.geometry.type === 'POLYGON' && gf.geometry.coordinates) {
        L.polygon(gf.geometry.coordinates, {
          color: '#7c3aed',
          weight: 2,
          fillColor: '#7c3aed',
          fillOpacity: 0.12,
        })
          .bindTooltip(gf.name)
          .addTo(group);
      }
    }

    if (mode === 'live' && liveHistory.length > 1) {
      const coords = liveHistory.map((p) => [p.lat, p.lng] as [number, number]);
      L.polyline(coords, {
        color: '#2563eb',
        weight: 4,
        opacity: 0.85,
      }).addTo(group);
    }

    // Daily Cumulative Multi-Trip Route with Gap Connectors (for Live Tracking)
    if (mode !== 'trip' && dailyLegs && dailyLegs.length > 0) {
      const LEG_COLORS = ['#1d4ed8', '#059669', '#7c3aed', '#d97706', '#0891b2'];
      for (let i = 0; i < dailyLegs.length; i++) {
        const leg = dailyLegs[i];
        if (!leg.waypoints || leg.waypoints.length === 0) continue;
        const coords = leg.waypoints.map((w) => [w.lat, w.lng] as [number, number]);
        const legColor = LEG_COLORS[i % LEG_COLORS.length];

        // Layer 1: White casing
        L.polyline(coords, {
          color: '#ffffff',
          weight: 7,
          opacity: 0.95,
          lineCap: 'round',
          lineJoin: 'round',
        }).addTo(group);

        // Layer 2: Colored leg route
        L.polyline(coords, {
          color: legColor,
          weight: 4.5,
          opacity: 0.95,
          lineCap: 'round',
          lineJoin: 'round',
        })
          .bindTooltip(`Leg ${i + 1}: ${leg.origin} → ${leg.destination} (${leg.total_distance_km} km)`)
          .addTo(group);

        // Leg Start and End dots
        const legStart = leg.waypoints[0];
        const legEnd = leg.waypoints[leg.waypoints.length - 1];
        L.circleMarker([legStart.lat, legStart.lng], {
          radius: 5,
          color: '#ffffff',
          fillColor: legColor,
          fillOpacity: 1,
          weight: 2,
        })
          .bindTooltip(`Leg ${i + 1} Start: ${leg.origin}`)
          .addTo(group);

        L.circleMarker([legEnd.lat, legEnd.lng], {
          radius: 5,
          color: '#ffffff',
          fillColor: '#dc2626',
          fillOpacity: 1,
          weight: 2,
        })
          .bindTooltip(`Leg ${i + 1} End: ${leg.destination}`)
          .addTo(group);

        // If gap between this leg and next leg exists (> 60 meters), draw dashed connector line
        if (i < dailyLegs.length - 1) {
          const nextLeg = dailyLegs[i + 1];
          if (nextLeg.waypoints && nextLeg.waypoints.length > 0) {
            const nextStart = nextLeg.waypoints[0];
            const distM = Math.hypot(nextStart.lat - legEnd.lat, nextStart.lng - legEnd.lng) * 111000;
            if (distM > 60) {
              L.polyline([[legEnd.lat, legEnd.lng], [nextStart.lat, nextStart.lng]], {
                color: '#64748b',
                weight: 3,
                dashArray: '6, 8',
                opacity: 0.85,
              })
                .bindTooltip(`Transit Gap: ${leg.destination} → ${nextLeg.origin}`)
                .addTo(group);
            }
          }
        }
      }

      // Check gap between last leg end and current vehicle location:
      const lastLeg = dailyLegs[dailyLegs.length - 1];
      if (lastLeg.waypoints && lastLeg.waypoints.length > 0 && selectedDeviceId) {
        const selRow = fleetRows.find((r) => r.device_id === selectedDeviceId);
        if (selRow && selRow.lat != null && selRow.lng != null) {
          const lastPoint = lastLeg.waypoints[lastLeg.waypoints.length - 1];
          const distM = Math.hypot(selRow.lat - lastPoint.lat, selRow.lng - lastPoint.lng) * 111000;
          if (distM > 80) {
            L.polyline([[lastPoint.lat, lastPoint.lng], [selRow.lat, selRow.lng]], {
              color: '#94a3b8',
              weight: 2.5,
              dashArray: '4, 6',
              opacity: 0.75,
            })
              .bindTooltip(`Transit Gap to Current Location: ${selRow.address}`)
              .addTo(group);
          }
        }
      }
    }

    if (mode === 'trip' && tripWaypoints.length > 0) {
      const allCoords = tripWaypoints.map((w) => [w.lat, w.lng] as [number, number]);
      // Base / Planned full route: Clean solid slate line without dots
      L.polyline(allCoords, {
        color: '#94a3b8',
        weight: 4,
        opacity: 0.75,
        lineCap: 'round',
        lineJoin: 'round',
      }).addTo(group);

      const safeIdx = Math.min(tripWaypoints.length - 1, Math.max(0, replayIndex));
      const traveled = allCoords.slice(0, safeIdx + 1);
      if (traveled.length > 1) {
        // Layer 1: Underlay white casing border (7px) for high-contrast on any terrain
        L.polyline(traveled, {
          color: '#ffffff',
          weight: 7,
          opacity: 0.95,
          lineCap: 'round',
          lineJoin: 'round',
        }).addTo(group);

        // Layer 2: Traveled / Replay path in High-visibility Deep Royal Blue (#1d4ed8, 5px, solid)
        L.polyline(traveled, {
          color: '#1d4ed8',
          weight: 5,
          opacity: 1.0,
          lineCap: 'round',
          lineJoin: 'round',
        }).addTo(group);
      }

      const origin = tripWaypoints[0];
      const dest = tripWaypoints[tripWaypoints.length - 1];

      // Origin Pin (Point A - Green circle with white "A")
      L.marker([origin.lat, origin.lng], {
        icon: L.divIcon({
          className: 'trip-pin-marker',
          html: `<div style="background:#15803d;color:#ffffff;font-size:11px;font-weight:bold;width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;border:2px solid #ffffff;box-shadow:0 2px 5px rgba(0,0,0,0.3);">A</div>`,
          iconSize: [22, 22],
          iconAnchor: [11, 11],
        }),
      })
        .bindTooltip(`Trip Origin (Start Point A)`)
        .addTo(group);

      // Destination Pin (Point B - Red circle with white "B")
      L.marker([dest.lat, dest.lng], {
        icon: L.divIcon({
          className: 'trip-pin-marker',
          html: `<div style="background:#dc2626;color:#ffffff;font-size:11px;font-weight:bold;width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;border:2px solid #ffffff;box-shadow:0 2px 5px rgba(0,0,0,0.3);">B</div>`,
          iconSize: [22, 22],
          iconAnchor: [11, 11],
        }),
      })
        .bindTooltip(`Destination (Arrival Point B)`)
        .addTo(group);

      const currentWp = tripWaypoints[safeIdx];
      const wpTemp =
        currentWp.cargo_temp_c !== null &&
        currentWp.cargo_temp_c !== undefined &&
        !isNaN(Number(currentWp.cargo_temp_c))
          ? Number(currentWp.cargo_temp_c)
          : null;
      const wpStatus =
        wpTemp !== null
          ? wpTemp > 8
            ? 'EXCURSION'
            : wpTemp >= 7
              ? 'WARNING'
              : 'OPTIMAL'
          : 'OPTIMAL';

      const tripConnectivity = focusedConnectivity === 'ONLINE' ? 'ONLINE' : 'OFFLINE';
      L.marker([currentWp.lat, currentWp.lng], {
        icon: createVehicleMarkerIcon(
          focusedLabel,
          focusedVehicleName,
          focusedCargoType,
          wpTemp,
          wpStatus,
          tripConnectivity,
          currentWp.heading_deg,
          true
        ),
      }).addTo(group);

      for (const h of tripHalts) {
        L.circleMarker([h.lat, h.lng], {
          radius: 7,
          color: '#ffffff',
          fillColor: '#f59e0b',
          fillOpacity: 0.95,
          weight: 2,
        })
          .bindTooltip(`Halt: ${h.location_name} (${h.duration_minutes}m)`)
          .addTo(group);
      }

      const tripKey = `${tripWaypoints.length}_${tripWaypoints[0]?.lat}_${tripWaypoints[tripWaypoints.length - 1]?.lat}`;
      if (hasFittedTripRef.current !== tripKey) {
        const bounds = L.latLngBounds(allCoords);
        map.fitBounds(bounds, { padding: [55, 55], maxZoom: 11 });
        hasFittedTripRef.current = tripKey;
      }
    }
  }, [
    mode,
    geofences,
    liveHistory,
    tripWaypoints,
    tripHalts,
    dailyLegs,
    replayIndex,
    focusedLabel,
    focusedVehicleName,
    focusedCargoType,
    focusedConnectivity,
  ]);

  return (
    <div className={`relative w-full overflow-hidden rounded-xl border border-slate-300 ${heightClass}`}>
      <div ref={containerRef} className="h-full w-full" />

      <div className="absolute right-2.5 top-2.5 z-[500] flex flex-wrap items-center gap-2">
        {/* Quick Zoom & Corridor Controls */}
        <div className="flex items-center rounded-lg border border-slate-300 bg-white/95 p-0.5 text-[11px] font-semibold text-slate-700 shadow-md backdrop-blur">
          <button
            type="button"
            onClick={handleZoomIn}
            title="Zoom In (+)"
            className="flex items-center gap-0.5 rounded-md px-2 py-1 text-slate-700 hover:bg-slate-100 cursor-pointer"
          >
            <ZoomIn className="h-3 w-3" />
            <span>In</span>
          </button>
          <button
            type="button"
            onClick={handleZoomOut}
            title="Zoom Out (-)"
            className="flex items-center gap-0.5 rounded-md px-2 py-1 text-slate-700 hover:bg-slate-100 cursor-pointer"
          >
            <ZoomOut className="h-3 w-3" />
            <span>Out</span>
          </button>
          <div className="mx-1 h-3.5 w-[1px] bg-slate-200" />
          <button
            type="button"
            onClick={handleRegionalZoomOut}
            title="Regional Corridor Overview (Zoom Out to show Sangareddy to Hyderabad)"
            className="flex items-center gap-1 rounded-md px-2 py-1 text-blue-700 hover:bg-blue-50 font-bold cursor-pointer whitespace-nowrap"
          >
            <Maximize2 className="h-3 w-3" />
            <span>Regional View</span>
          </button>
          <button
            type="button"
            onClick={handleFitRoute}
            title="Fit Route Waypoints"
            className="rounded-md px-2 py-1 text-slate-600 hover:bg-slate-100 cursor-pointer whitespace-nowrap"
          >
            Fit Route
          </button>
        </div>

        {/* Map Layer Style */}
        <div
          role="group"
          aria-label="Map layer style"
          className="flex items-center rounded-lg border border-slate-300 bg-white/95 p-0.5 text-[11px] font-semibold text-slate-700 shadow-md backdrop-blur"
        >
          {(
            [
              ['street', 'Map'],
              ['satellite', 'Satellite'],
              ['osm', 'Street OSM'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setMapStyle(id)}
              className={`rounded-md px-2 py-1 transition-colors cursor-pointer ${
                mapStyle === id
                  ? 'bg-blue-600 text-white font-bold'
                  : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
