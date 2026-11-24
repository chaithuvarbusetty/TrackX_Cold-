export type IndustryId =
  | 'vaccines'
  | 'food'
  | 'dairy'
  | 'blood'
  | 'seafood'
  | 'chemical';

export type TruckRouteId = 'orr_forest_bridge' | 'midtown_express' | 'north_harbor_loop';

export type RoadVehicleType = 'sedan' | 'suv' | 'city_bus' | 'pickup' | 'ambulance' | 'delivery_van';

export type WallMode = 'cutaway' | 'solid';

export type TimeOfDay = 'day' | 'night';

export type LoadingSubStage = 'opening_door' | 'loading_inside' | 'locking_door' | 'complete';

export type CameraPreset =
  | 'follow_truck'
  | 'interior'
  | 'fpv_dashcam'
  | 'gateway'
  | 'godown'
  | 'forest'
  | 'bridge'
  | 'bus_stand'
  | 'city';

export type MissionPhase = 'loading_godown' | 'in_transit' | 'unloading_dest';

export interface IndustryProfile {
  id: IndustryId;
  index: number;
  label: string;
  shortLabel: string;
  cargoDescription: string;
  originName: string;
  destinationName: string;
  recommendedRoute: TruckRouteId;
  nominalTemp: number;
  minSafeTemp: number;
  maxSafeTemp: number;
  accentHex: string;
  liveryColor: string;
}

export const INDUSTRY_PROFILES: Record<IndustryId, IndustryProfile> = {
  vaccines: {
    id: 'vaccines',
    index: 1,
    label: 'Vaccines & Pharmaceutical',
    shortLabel: '1. Vaccines & Pharma',
    cargoDescription: 'mRNA Cryo-Vials & Biologics',
    originName: 'Cold Godown 01',
    destinationName: 'Metro Bio-Hospital',
    recommendedRoute: 'orr_forest_bridge',
    nominalTemp: 3.8,
    minSafeTemp: 2.0,
    maxSafeTemp: 8.0,
    accentHex: '#0284c7',
    liveryColor: '#0284c7',
  },
  food: {
    id: 'food',
    index: 2,
    label: 'Food & Beverage Industry',
    shortLabel: '2. Food & Beverage',
    cargoDescription: 'Chilled Produce & Beverages',
    originName: 'Cold Godown 01',
    destinationName: 'Harbor Fresh Market',
    recommendedRoute: 'midtown_express',
    nominalTemp: 2.4,
    minSafeTemp: 0.0,
    maxSafeTemp: 4.5,
    accentHex: '#059669',
    liveryColor: '#059669',
  },
  dairy: {
    id: 'dairy',
    index: 3,
    label: 'Dairy Industry',
    shortLabel: '3. Dairy Industry',
    cargoDescription: 'Pasteurized Milk & Cheese Tanks',
    originName: 'Cold Godown 01',
    destinationName: 'Harbor Fresh Market',
    recommendedRoute: 'north_harbor_loop',
    nominalTemp: 2.1,
    minSafeTemp: 1.0,
    maxSafeTemp: 4.0,
    accentHex: '#2563eb',
    liveryColor: '#2563eb',
  },
  blood: {
    id: 'blood',
    index: 4,
    label: 'Blood Banks & Medical Supplies',
    shortLabel: '4. Blood Banks',
    cargoDescription: 'Whole Blood & Plasma Coolers',
    originName: 'Cold Godown 01',
    destinationName: 'Metro Bio-Hospital',
    recommendedRoute: 'midtown_express',
    nominalTemp: 3.4,
    minSafeTemp: 2.0,
    maxSafeTemp: 6.0,
    accentHex: '#dc2626',
    liveryColor: '#dc2626',
  },
  seafood: {
    id: 'seafood',
    index: 5,
    label: 'Seafood & Meat Transportation',
    shortLabel: '5. Seafood & Meat',
    cargoDescription: 'Flash-Chilled Catch & Prime Cuts',
    originName: 'Cold Godown 01',
    destinationName: 'Coastal Seafood Pier',
    recommendedRoute: 'north_harbor_loop',
    nominalTemp: -1.2,
    minSafeTemp: -3.0,
    maxSafeTemp: 2.0,
    accentHex: '#0891b2',
    liveryColor: '#0891b2',
  },
  chemical: {
    id: 'chemical',
    index: 6,
    label: 'Chemical & Laboratory Industry',
    shortLabel: '6. Chemical & Lab',
    cargoDescription: 'Temperature-Sensitive Reagents',
    originName: 'Cold Godown 01',
    destinationName: 'ChemLab Research Park',
    recommendedRoute: 'orr_forest_bridge',
    nominalTemp: 3.0,
    minSafeTemp: 1.5,
    maxSafeTemp: 5.0,
    accentHex: '#7c3aed',
    liveryColor: '#7c3aed',
  },
};

export const INDUSTRY_LIST: IndustryProfile[] = Object.values(INDUSTRY_PROFILES);

export interface TruckRouteConfig {
  id: TruckRouteId;
  label: string;
  shortLabel: string;
  description: string;
  color: string;
}

export const TRUCK_ROUTE_CONFIGS: TruckRouteConfig[] = [
  {
    id: 'orr_forest_bridge',
    label: 'ORR Service Rd -> West Forest -> Mini Bridge',
    shortLabel: 'ORR & Forest -> Bridge',
    description: 'Godown -> ORR Service Rd -> Forest Hwy -> North Exp -> Mini Bridge -> Hospital',
    color: '#38bdf8',
  },
  {
    id: 'midtown_express',
    label: 'Midtown Downtown Ave -> Mini Bridge',
    shortLabel: 'Midtown -> Bridge',
    description: 'Godown -> ORR Service -> Midtown Blocks -> Mini Bridge -> Hospital',
    color: '#10b981',
  },
  {
    id: 'north_harbor_loop',
    label: 'North Market & Dairy Pkwy -> East Harbor',
    shortLabel: 'North Pkwy -> Harbor',
    description: 'Godown -> Forest Hwy -> North Dairy Pkwy -> East Harbor Bypass -> Hospital',
    color: '#f59e0b',
  },
];

export interface PhoneAlertMessage {
  id: number;
  timestamp: string;
  kind: 'temp_high' | 'door_tamper' | 'ir_collision';
  title: string;
  body: string;
  location: string;
}

export interface TelemetryPacket {
  id: number;
  timestamp: string;
  nodeId: string;
  gatewayId: string;
  temperature: number;
  doorTamper: boolean;
  doorLocked: boolean;
  irObstacleDistM: number | null;
  irCollisionAlert: boolean;
  tempAlert: boolean;
  doorAlert: boolean;
  industry: IndustryId;
  routeId: TruckRouteId;
  lat: number;
  lng: number;
  zoneLabel: string;
  speedKmh: number;
  phase: MissionPhase;
}

export interface TrafficGpsMarker {
  id: string;
  vehicleType: RoadVehicleType;
  label: string;
  lat: number;
  lng: number;
  zoneLabel: string;
}

export interface GpsSnapshot {
  truck: {
    id: string;
    label: string;
    x: number;
    z: number;
    headingDeg: number;
    lat: number;
    lng: number;
    zoneLabel: string;
    speedKmh: number;
    phase: MissionPhase;
    progress: number;
    alert: boolean;
    industry: IndustryId;
    routeId: TruckRouteId;
  };
  traffic: TrafficGpsMarker[];
  routeGeoPaths: Record<TruckRouteId, Array<{ lat: number; lng: number }>>;
}

export interface ProjectedAnchor {
  id: 'node' | 'gateway' | 'cargo' | 'door' | 'ir';
  x: number;
  y: number;
  visible: boolean;
}

export interface AnchorMap {
  node: ProjectedAnchor;
  gateway: ProjectedAnchor;
  cargo: ProjectedAnchor;
  door: ProjectedAnchor;
  ir: ProjectedAnchor;
}
