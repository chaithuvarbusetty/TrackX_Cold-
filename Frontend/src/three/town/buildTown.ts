import * as THREE from 'three';
import { LoadingSubStage, RoadVehicleType, TruckRouteId } from '../../types/cargoguard';
import { createRoadTexture, createZoneSignTexture } from './textures';

export interface TrafficVehicle {
  id: string;
  vehicleType: RoadVehicleType;
  label: string;
  lengthM: number;
  root: THREE.Group;
  wheels: THREE.Mesh[];
  curve: THREE.Curve<THREE.Vector3>;
  progress: number;
  speed: number;
  laneOffset: number;
  torchConeMeshes: THREE.Mesh[];
  torchCones: THREE.MeshBasicMaterial[];
  brakeMat?: THREE.MeshStandardMaterial;
  zoneLabel: string;
  lat: number;
  lng: number;
}

export interface AnimatedWorker {
  root: THREE.Group;
  leftLeg: THREE.Group;
  rightLeg: THREE.Group;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  carriedBox: THREE.Mesh;
  startPos: THREE.Vector3;
  endPos: THREE.Vector3;
  phaseOffset: number;
  cycleSpeed: number;
}

export interface TownWorld {
  root: THREE.Group;
  truckRoutes: Record<TruckRouteId, THREE.CurvePath<THREE.Vector3>>;
  truckRouteLengths: Record<TruckRouteId, number>;
  routeGeoPaths: Record<TruckRouteId, Array<{ lat: number; lng: number }>>;
  routeVisualLines: Record<TruckRouteId, THREE.Line>;
  destinationStops: Record<TruckRouteId, { bridgeT: number; hospitalT: number; orrT: number }>;
  trafficVehicles: TrafficVehicle[];
  leadCar: TrafficVehicle;
  satelliteGroup: THREE.Group;
  setActiveRouteHighlight: (routeId: TruckRouteId) => void;
  setTimeOfDayVisuals: (nightFactor: number) => void;
  update: (
    delta: number,
    elapsed: number,
    leadCarStopped: boolean,
    t1State: {
      x: number;
      z: number;
      fwdX: number;
      fwdZ: number;
      loadingActive: boolean;
      subStage: LoadingSubStage;
      phaseProgress: number;
    },
  ) => void;
  dispose: () => void;
}

export function worldToGps(x: number, z: number): { lat: number; lng: number; zoneLabel: string } {
  const baseLat = 17.4326;
  const baseLng = 78.3820;

  let zoneLabel = 'ORR Cold-Chain Corridor';
  if (x >= -46 && x <= -20 && z >= 28.5 && z <= 46) {
    zoneLabel = 'Cold Godown 01 · Pull-Through Loading Bay';
  } else if (x < -44 && z >= 12) {
    zoneLabel = 'ORR Service Road · West';
  } else if (x < -48 && z >= -30 && z < 12) {
    zoneLabel = 'West Forest Reserve Hwy';
  } else if (x >= 26 && x <= 56 && z >= -4 && z <= 12) {
    zoneLabel = 'Riverview Mini Bridge';
  } else if (x >= 28 && x <= 54 && z <= -48) {
    zoneLabel = 'North Causeway Bridge';
  } else if (x >= 56 && x <= 66 && z >= -26 && z <= 28) {
    zoneLabel = 'East Riverside Corridor';
  } else if (x > 2 && x < 24 && z >= 18 && z <= 32) {
    zoneLabel = 'Metro Bio-Hospital Ave';
  } else if (x >= -20 && x <= 2 && z >= 18 && z <= 30) {
    zoneLabel = 'City Bus Stand Blvd';
  } else if (z < -48) {
    zoneLabel = 'North Market & Dairy Pkwy';
  } else if (z < -24 && z >= -40) {
    zoneLabel = 'North Pharma Expressway';
  } else if (z >= 44) {
    zoneLabel = 'South Hospital Blood Corridor';
  } else if (x >= 68) {
    zoneLabel = 'East Harbor Seafood Bypass';
  } else if (x > -32 && x < 18 && z > -24 && z < 16) {
    zoneLabel = 'Midtown Downtown Ave';
  }

  return {
    lat: Number((baseLat - z * 0.00016).toFixed(5)),
    lng: Number((baseLng + x * 0.00018).toFixed(5)),
    zoneLabel,
  };
}

function buildCurvedRoadRibbon(
  curve: THREE.Curve<THREE.Vector3>,
  width: number,
  segments: number,
  yOffset: number,
  uvRepeatPerMeter: number,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const totalLen = curve.getLength();
  const halfW = width * 0.5;
  const pt = new THREE.Vector3();
  const tan = new THREE.Vector3();
  const side = new THREE.Vector3();

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    curve.getPointAt(t, pt);
    curve.getTangentAt(t, tan);
    tan.y = 0;
    if (tan.lengthSq() < 1e-6) tan.set(1, 0, 0);
    tan.normalize();
    side.set(-tan.z, 0, tan.x);

    const lx = pt.x - side.x * halfW;
    const lz = pt.z - side.z * halfW;
    const rx = pt.x + side.x * halfW;
    const rz = pt.z + side.z * halfW;
    const py = pt.y + yOffset;

    positions.push(lx, py, lz, rx, py, rz);
    normals.push(0, 1, 0, 0, 1, 0);

    const u = t * totalLen * uvRepeatPerMeter;
    uvs.push(u, 0, u, 1);

    if (i < segments) {
      const base = i * 2;
      indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

function findClosestT(curve: THREE.Curve<THREE.Vector3>, targetX: number, targetZ: number): number {
  const samples = 450;
  let bestT = 0;
  let bestDistSq = Infinity;
  const p = new THREE.Vector3();
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    curve.getPointAt(t, p);
    const dx = p.x - targetX;
    const dz = p.z - targetZ;
    const d2 = dx * dx + dz * dz;
    if (d2 < bestDistSq) {
      bestDistSq = d2;
      bestT = t;
    }
  }
  return bestT;
}

export function buildMiniTown(maxAnisotropy: number): TownWorld {
  const disposables: Array<{ dispose: () => void }> = [];
  const track = <T extends { dispose: () => void }>(item: T): T => {
    disposables.push(item);
    return item;
  };

  const root = new THREE.Group();

  // --- 1. Terrain Base ---
  const terrainMat = track(
    new THREE.MeshStandardMaterial({ color: 0x182b38, roughness: 0.94, metalness: 0.02 }),
  );
  const terrain = new THREE.Mesh(track(new THREE.PlaneGeometry(360, 360)), terrainMat);
  terrain.rotation.x = -Math.PI / 2;
  terrain.position.y = -0.08;
  terrain.receiveShadow = true;
  root.add(terrain);

  const padMat = track(
    new THREE.MeshStandardMaterial({ color: 0x2a3648, roughness: 0.85, metalness: 0.05 }),
  );
  const addApronPad = (x: number, z: number, w: number, d: number) => {
    const pad = new THREE.Mesh(track(new THREE.BoxGeometry(w, 0.06, d)), padMat);
    pad.position.set(x, -0.03, z);
    pad.receiveShadow = true;
    root.add(pad);
  };
  addApronPad(-36, 38.5, 38, 19); // Cold Godowns 1 & 2 + Dedicated Pull-Through Loading Bay
  addApronPad(10, 35, 22, 13); // Metro Bio-Hospital
  addApronPad(18, -45, 26, 13); // Harbor Fresh Market
  addApronPad(-26, -45, 22, 13); // ChemLab Park
  addApronPad(-8, 18.2, 16, 6.4); // City Bus Stand
  addApronPad(79, 0, 11, 22); // East Coastal Seafood Pier

  // --- 2. Scenic Town River & Lake Channel (Flows N-S at x = 31..51) ---
  const lakeWaterMat = track(
    new THREE.MeshPhysicalMaterial({
      color: 0x0b658c,
      roughness: 0.14,
      metalness: 0.18,
      clearcoat: 0.9,
      clearcoatRoughness: 0.1,
    }),
  );
  const riverChannel = new THREE.Mesh(track(new THREE.PlaneGeometry(20, 220)), lakeWaterMat);
  riverChannel.rotation.x = -Math.PI / 2;
  riverChannel.position.set(41, -0.02, 0);
  riverChannel.receiveShadow = true;
  root.add(riverChannel);

  const lakeBasin = new THREE.Mesh(track(new THREE.CircleGeometry(18, 32)), lakeWaterMat);
  lakeBasin.rotation.x = -Math.PI / 2;
  lakeBasin.scale.set(1.05, 1.35, 1);
  lakeBasin.position.set(41, -0.015, 4);
  lakeBasin.receiveShadow = true;
  root.add(lakeBasin);

  const shoreMat = track(new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.85 }));
  const westBank = new THREE.Mesh(track(new THREE.BoxGeometry(1.1, 0.36, 128)), shoreMat);
  westBank.position.set(30.4, 0.08, -12);
  const eastBank = new THREE.Mesh(track(new THREE.BoxGeometry(1.1, 0.36, 128)), shoreMat);
  eastBank.position.set(51.6, 0.08, -12);
  root.add(westBank, eastBank);

  // --- 3. Selectable Truck Routes (Starting in Dedicated Off-Road Godown Bay) + Collision-Free Town Loops ---
  // TRUCK ROUTE 1: Off-Road Godown Bay (z=31.4) -> ORR Service Rd -> West Forest -> North Hwy -> Mini Bridge -> Hospital -> Godown Entry
  const truckRoute1 = new THREE.CurvePath<THREE.Vector3>();
  truckRoute1.add(new THREE.LineCurve3(new THREE.Vector3(-35, 0, 33.6), new THREE.Vector3(-45, 0, 33.6)));
  truckRoute1.add(
    new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(-45, 0, 33.6),
      new THREE.Vector3(-58, 0, 33.6),
      new THREE.Vector3(-58, 0, 19),
    ),
  );
  truckRoute1.add(new THREE.LineCurve3(new THREE.Vector3(-58, 0, 19), new THREE.Vector3(-58, 0, -21)));
  truckRoute1.add(
    new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(-58, 0, -21),
      new THREE.Vector3(-58, 0, -31),
      new THREE.Vector3(-48, 0, -31),
    ),
  );
  truckRoute1.add(new THREE.LineCurve3(new THREE.Vector3(-48, 0, -31), new THREE.Vector3(14, 0, -31)));
  truckRoute1.add(
    new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(14, 0, -31),
      new THREE.Vector3(22, 0, -31),
      new THREE.Vector3(22, 0, -22),
    ),
  );
  truckRoute1.add(new THREE.LineCurve3(new THREE.Vector3(22, 0, -22), new THREE.Vector3(22, 0, -4)));
  truckRoute1.add(
    new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(22, 0, -4),
      new THREE.Vector3(22, 0, 4),
      new THREE.Vector3(27, 0, 4),
    ),
  );
  // Arched Mini Bridge over River/Lake
  truckRoute1.add(
    new THREE.CatmullRomCurve3(
      [
        new THREE.Vector3(27, 0, 4),
        new THREE.Vector3(32, 0.9, 4),
        new THREE.Vector3(41, 1.85, 4),
        new THREE.Vector3(50, 0.9, 4),
        new THREE.Vector3(55, 0, 4),
      ],
      false,
      'centripetal',
      0.5,
    ),
  );
  truckRoute1.add(
    new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(55, 0, 4),
      new THREE.Vector3(60, 0, 4),
      new THREE.Vector3(60, 0, 12),
    ),
  );
  truckRoute1.add(new THREE.LineCurve3(new THREE.Vector3(60, 0, 12), new THREE.Vector3(60, 0, 18)));
  truckRoute1.add(
    new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(60, 0, 18),
      new THREE.Vector3(60, 0, 25),
      new THREE.Vector3(52, 0, 25),
    ),
  );
  truckRoute1.add(new THREE.LineCurve3(new THREE.Vector3(52, 0, 25), new THREE.Vector3(-12, 0, 25)));
  truckRoute1.add(
    new THREE.CubicBezierCurve3(
      new THREE.Vector3(-12, 0, 25),
      new THREE.Vector3(-18, 0, 25),
      new THREE.Vector3(-18, 0, 33.6),
      new THREE.Vector3(-24, 0, 33.6),
    ),
  );
  truckRoute1.add(new THREE.LineCurve3(new THREE.Vector3(-24, 0, 33.6), new THREE.Vector3(-35, 0, 33.6)));
  truckRoute1.updateArcLengths();

  // TRUCK ROUTE 2 (Midtown Express): Off-Road Godown Bay -> ORR Service -> Midtown Ave (z=11) -> Mini Bridge -> Hospital -> Bay
  const truckRoute2 = new THREE.CurvePath<THREE.Vector3>();
  truckRoute2.add(new THREE.LineCurve3(new THREE.Vector3(-35, 0, 33.6), new THREE.Vector3(-45, 0, 33.6)));
  truckRoute2.add(
    new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(-45, 0, 33.6),
      new THREE.Vector3(-56, 0, 33.6),
      new THREE.Vector3(-56, 0, 20),
    ),
  );
  truckRoute2.add(
    new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(-56, 0, 20),
      new THREE.Vector3(-56, 0, 11),
      new THREE.Vector3(-47, 0, 11),
    ),
  );
  truckRoute2.add(new THREE.LineCurve3(new THREE.Vector3(-47, 0, 11), new THREE.Vector3(16, 0, 11)));
  truckRoute2.add(
    new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(16, 0, 11),
      new THREE.Vector3(22, 0, 11),
      new THREE.Vector3(22, 0, 7),
    ),
  );
  truckRoute2.add(
    new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(22, 0, 7),
      new THREE.Vector3(22, 0, 4),
      new THREE.Vector3(27, 0, 4),
    ),
  );
  truckRoute2.add(
    new THREE.CatmullRomCurve3(
      [
        new THREE.Vector3(27, 0, 4),
        new THREE.Vector3(32, 0.9, 4),
        new THREE.Vector3(41, 1.85, 4),
        new THREE.Vector3(50, 0.9, 4),
        new THREE.Vector3(55, 0, 4),
      ],
      false,
      'centripetal',
      0.5,
    ),
  );
  truckRoute2.add(
    new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(55, 0, 4),
      new THREE.Vector3(60, 0, 4),
      new THREE.Vector3(60, 0, 12),
    ),
  );
  truckRoute2.add(new THREE.LineCurve3(new THREE.Vector3(60, 0, 12), new THREE.Vector3(60, 0, 18)));
  truckRoute2.add(
    new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(60, 0, 18),
      new THREE.Vector3(60, 0, 25),
      new THREE.Vector3(52, 0, 25),
    ),
  );
  truckRoute2.add(new THREE.LineCurve3(new THREE.Vector3(52, 0, 25), new THREE.Vector3(-12, 0, 25)));
  truckRoute2.add(
    new THREE.CubicBezierCurve3(
      new THREE.Vector3(-12, 0, 25),
      new THREE.Vector3(-18, 0, 25),
      new THREE.Vector3(-18, 0, 33.6),
      new THREE.Vector3(-24, 0, 33.6),
    ),
  );
  truckRoute2.add(new THREE.LineCurve3(new THREE.Vector3(-24, 0, 33.6), new THREE.Vector3(-35, 0, 33.6)));
  truckRoute2.updateArcLengths();

  // TRUCK ROUTE 3 (North Market & Harbor Loop): Godown Bay -> Forest -> North Market Pkwy -> Causeway -> East Harbor -> Hospital -> Bay
  const truckRoute3 = new THREE.CurvePath<THREE.Vector3>();
  truckRoute3.add(new THREE.LineCurve3(new THREE.Vector3(-35, 0, 33.6), new THREE.Vector3(-45, 0, 33.6)));
  truckRoute3.add(
    new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(-45, 0, 33.6),
      new THREE.Vector3(-58, 0, 33.6),
      new THREE.Vector3(-58, 0, 19),
    ),
  );
  truckRoute3.add(new THREE.LineCurve3(new THREE.Vector3(-58, 0, 19), new THREE.Vector3(-58, 0, -45)));
  truckRoute3.add(
    new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(-58, 0, -45),
      new THREE.Vector3(-58, 0, -55),
      new THREE.Vector3(-46, 0, -55),
    ),
  );
  truckRoute3.add(new THREE.LineCurve3(new THREE.Vector3(-46, 0, -55), new THREE.Vector3(62, 0, -55)));
  truckRoute3.add(
    new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(62, 0, -55),
      new THREE.Vector3(71, 0, -55),
      new THREE.Vector3(71, 0, -45),
    ),
  );
  truckRoute3.add(new THREE.LineCurve3(new THREE.Vector3(71, 0, -45), new THREE.Vector3(71, 0, 16)));
  truckRoute3.add(
    new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(71, 0, 16),
      new THREE.Vector3(71, 0, 25),
      new THREE.Vector3(60, 0, 25),
    ),
  );
  truckRoute3.add(new THREE.LineCurve3(new THREE.Vector3(60, 0, 25), new THREE.Vector3(-12, 0, 25)));
  truckRoute3.add(
    new THREE.CubicBezierCurve3(
      new THREE.Vector3(-12, 0, 25),
      new THREE.Vector3(-18, 0, 25),
      new THREE.Vector3(-18, 0, 33.6),
      new THREE.Vector3(-24, 0, 33.6),
    ),
  );
  truckRoute3.add(new THREE.LineCurve3(new THREE.Vector3(-24, 0, 33.6), new THREE.Vector3(-35, 0, 33.6)));
  truckRoute3.updateArcLengths();

  // Main Public ORR Traffic Loop (Strictly stays on main ORR z=25 — NEVER enters the Godown Loading Bay!)
  const orrTrafficLoop = new THREE.CurvePath<THREE.Vector3>();
  orrTrafficLoop.add(new THREE.LineCurve3(new THREE.Vector3(-24, 0, 25), new THREE.Vector3(-48, 0, 25)));
  orrTrafficLoop.add(
    new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(-48, 0, 25),
      new THREE.Vector3(-58, 0, 25),
      new THREE.Vector3(-58, 0, 15),
    ),
  );
  orrTrafficLoop.add(new THREE.LineCurve3(new THREE.Vector3(-58, 0, 15), new THREE.Vector3(-58, 0, -21)));
  orrTrafficLoop.add(
    new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(-58, 0, -21),
      new THREE.Vector3(-58, 0, -31),
      new THREE.Vector3(-48, 0, -31),
    ),
  );
  orrTrafficLoop.add(new THREE.LineCurve3(new THREE.Vector3(-48, 0, -31), new THREE.Vector3(14, 0, -31)));
  orrTrafficLoop.add(
    new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(14, 0, -31),
      new THREE.Vector3(22, 0, -31),
      new THREE.Vector3(22, 0, -22),
    ),
  );
  orrTrafficLoop.add(new THREE.LineCurve3(new THREE.Vector3(22, 0, -22), new THREE.Vector3(22, 0, -4)));
  orrTrafficLoop.add(
    new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(22, 0, -4),
      new THREE.Vector3(22, 0, 4),
      new THREE.Vector3(27, 0, 4),
    ),
  );
  orrTrafficLoop.add(
    new THREE.CatmullRomCurve3(
      [
        new THREE.Vector3(27, 0, 4),
        new THREE.Vector3(32, 0.9, 4),
        new THREE.Vector3(41, 1.85, 4),
        new THREE.Vector3(50, 0.9, 4),
        new THREE.Vector3(55, 0, 4),
      ],
      false,
      'centripetal',
      0.5,
    ),
  );
  orrTrafficLoop.add(
    new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(55, 0, 4),
      new THREE.Vector3(60, 0, 4),
      new THREE.Vector3(60, 0, 12),
    ),
  );
  orrTrafficLoop.add(new THREE.LineCurve3(new THREE.Vector3(60, 0, 12), new THREE.Vector3(60, 0, 18)));
  orrTrafficLoop.add(
    new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(60, 0, 18),
      new THREE.Vector3(60, 0, 25),
      new THREE.Vector3(52, 0, 25),
    ),
  );
  orrTrafficLoop.add(new THREE.LineCurve3(new THREE.Vector3(52, 0, 25), new THREE.Vector3(-24, 0, 25)));
  orrTrafficLoop.updateArcLengths();

  // Loop 2 (Midtown Service Loop: x: -29..13, z: -20..11) — runs opposite lane (-2.25) with 4.5m clearance!
  const loopMidtown = new THREE.CurvePath<THREE.Vector3>();
  loopMidtown.add(new THREE.LineCurve3(new THREE.Vector3(-22, 0, 11), new THREE.Vector3(6, 0, 11)));
  loopMidtown.add(
    new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(6, 0, 11),
      new THREE.Vector3(13, 0, 11),
      new THREE.Vector3(13, 0, 4),
    ),
  );
  loopMidtown.add(new THREE.LineCurve3(new THREE.Vector3(13, 0, 4), new THREE.Vector3(13, 0, -13)));
  loopMidtown.add(
    new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(13, 0, -13),
      new THREE.Vector3(13, 0, -20),
      new THREE.Vector3(6, 0, -20),
    ),
  );
  loopMidtown.add(new THREE.LineCurve3(new THREE.Vector3(6, 0, -20), new THREE.Vector3(-22, 0, -20)));
  loopMidtown.add(
    new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(-22, 0, -20),
      new THREE.Vector3(-29, 0, -20),
      new THREE.Vector3(-29, 0, -13),
    ),
  );
  loopMidtown.add(new THREE.LineCurve3(new THREE.Vector3(-29, 0, -13), new THREE.Vector3(-29, 0, 4)));
  loopMidtown.add(
    new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(-29, 0, 4),
      new THREE.Vector3(-29, 0, 11),
      new THREE.Vector3(-22, 0, 11),
    ),
  );
  loopMidtown.updateArcLengths();

  // Loop 3 (North Market & Dairy Pkwy: x: -38..28, z: -66..-55)
  const loopNorth = new THREE.CurvePath<THREE.Vector3>();
  loopNorth.add(new THREE.LineCurve3(new THREE.Vector3(-32, 0, -55), new THREE.Vector3(22, 0, -55)));
  loopNorth.add(
    new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(22, 0, -55),
      new THREE.Vector3(28, 0, -55),
      new THREE.Vector3(28, 0, -60.5),
    ),
  );
  loopNorth.add(
    new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(28, 0, -60.5),
      new THREE.Vector3(28, 0, -66),
      new THREE.Vector3(22, 0, -66),
    ),
  );
  loopNorth.add(new THREE.LineCurve3(new THREE.Vector3(22, 0, -66), new THREE.Vector3(-32, 0, -66)));
  loopNorth.add(
    new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(-32, 0, -66),
      new THREE.Vector3(-38, 0, -66),
      new THREE.Vector3(-38, 0, -60.5),
    ),
  );
  loopNorth.add(
    new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(-38, 0, -60.5),
      new THREE.Vector3(-38, 0, -55),
      new THREE.Vector3(-32, 0, -55),
    ),
  );
  loopNorth.updateArcLengths();

  // Loop 4 (South Hospital Medical Loop: x: -18..26, z: 48..60)
  const loopSouth = new THREE.CurvePath<THREE.Vector3>();
  loopSouth.add(new THREE.LineCurve3(new THREE.Vector3(-12, 0, 48), new THREE.Vector3(20, 0, 48)));
  loopSouth.add(
    new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(20, 0, 48),
      new THREE.Vector3(26, 0, 48),
      new THREE.Vector3(26, 0, 54),
    ),
  );
  loopSouth.add(
    new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(26, 0, 54),
      new THREE.Vector3(26, 0, 60),
      new THREE.Vector3(20, 0, 60),
    ),
  );
  loopSouth.add(new THREE.LineCurve3(new THREE.Vector3(20, 0, 60), new THREE.Vector3(-12, 0, 60)));
  loopSouth.add(
    new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(-12, 0, 60),
      new THREE.Vector3(-18, 0, 60),
      new THREE.Vector3(-18, 0, 54),
    ),
  );
  loopSouth.add(
    new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(-18, 0, 54),
      new THREE.Vector3(-18, 0, 48),
      new THREE.Vector3(-12, 0, 48),
    ),
  );
  loopSouth.updateArcLengths();

  // Loop 5 (East Coastal Harbor Loop: x: 71..88, z: -26..24) — runs strictly on EAST lane (x=73.25) when along x=71!
  const loopEast = new THREE.CurvePath<THREE.Vector3>();
  loopEast.add(new THREE.LineCurve3(new THREE.Vector3(71, 0, 18), new THREE.Vector3(71, 0, -20)));
  loopEast.add(
    new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(71, 0, -20),
      new THREE.Vector3(71, 0, -26),
      new THREE.Vector3(79.5, 0, -26),
    ),
  );
  loopEast.add(
    new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(79.5, 0, -26),
      new THREE.Vector3(88, 0, -26),
      new THREE.Vector3(88, 0, -20),
    ),
  );
  loopEast.add(new THREE.LineCurve3(new THREE.Vector3(88, 0, -20), new THREE.Vector3(88, 0, 18)));
  loopEast.add(
    new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(88, 0, 18),
      new THREE.Vector3(88, 0, 24),
      new THREE.Vector3(79.5, 0, 24),
    ),
  );
  loopEast.add(
    new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(79.5, 0, 24),
      new THREE.Vector3(71, 0, 24),
      new THREE.Vector3(71, 0, 18),
    ),
  );
  loopEast.updateArcLengths();

  const roadTex = track(createRoadTexture(maxAnisotropy));
  const roadMat = track(
    new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.84, metalness: 0.06 }),
  );

  // Render clean 9m wide two-lane asphalt ribbons so lanes never touch or collide
  const roadRibbons: Array<{ curve: THREE.CurvePath<THREE.Vector3>; width: number; segs: number; y: number }> = [
    { curve: orrTrafficLoop, width: 9.0, segs: 320, y: 0.02 },
    { curve: truckRoute1, width: 7.4, segs: 320, y: 0.017 },
    { curve: truckRoute2, width: 8.6, segs: 280, y: 0.016 },
    { curve: truckRoute3, width: 8.8, segs: 300, y: 0.015 },
    { curve: loopMidtown, width: 8.4, segs: 160, y: 0.018 },
    { curve: loopNorth, width: 8.4, segs: 140, y: 0.018 },
    { curve: loopSouth, width: 7.2, segs: 140, y: 0.018 },
    { curve: loopEast, width: 8.4, segs: 140, y: 0.018 },
  ];
  roadRibbons.forEach(({ curve, width, segs, y }) => {
    const mesh = new THREE.Mesh(
      track(buildCurvedRoadRibbon(curve, width, segs, y, 1 / 14)),
      roadMat,
    );
    mesh.receiveShadow = true;
    root.add(mesh);
  });

  // Mini Bridge Piers & Steel Arch Railings (x = 27..55, z = 4 over river)
  const bridgeConcreteMat = track(
    new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.6, metalness: 0.15 }),
  );
  const bridgeSteelMat = track(
    new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.35, metalness: 0.65 }),
  );

  for (const bx of [33, 41, 49]) {
    const pier = new THREE.Mesh(track(new THREE.BoxGeometry(1.4, 2.2, 8.2)), bridgeConcreteMat);
    pier.position.set(bx, 0.72, 4);
    pier.castShadow = true;
    root.add(pier);
  }

  [-4.3, 4.3].forEach((zOff) => {
    const archCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(28, 0.6, 4 + zOff),
      new THREE.Vector3(34, 3.6, 4 + zOff),
      new THREE.Vector3(41, 5.1, 4 + zOff),
      new THREE.Vector3(48, 3.6, 4 + zOff),
      new THREE.Vector3(54, 0.6, 4 + zOff),
    ]);
    const archMesh = new THREE.Mesh(
      track(new THREE.TubeGeometry(archCurve, 28, 0.28, 8, false)),
      bridgeSteelMat,
    );
    archMesh.castShadow = true;
    root.add(archMesh);

    const railCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(27, 0.7, 4 + zOff),
      new THREE.Vector3(32, 1.6, 4 + zOff),
      new THREE.Vector3(41, 2.55, 4 + zOff),
      new THREE.Vector3(50, 1.6, 4 + zOff),
      new THREE.Vector3(55, 0.7, 4 + zOff),
    ]);
    const railMesh = new THREE.Mesh(
      track(new THREE.TubeGeometry(railCurve, 24, 0.12, 6, false)),
      bridgeConcreteMat,
    );
    root.add(railMesh);
  });

  // North Causeway Bridge Barriers over North River (x = 30..52, z = -55)
  [-3.8, 3.8].forEach((zOff) => {
    const barrier = new THREE.Mesh(track(new THREE.BoxGeometry(22, 0.65, 0.32)), bridgeConcreteMat);
    barrier.position.set(41, 0.32, -55 + zOff);
    root.add(barrier);
  });

  const truckRoutes: Record<TruckRouteId, THREE.CurvePath<THREE.Vector3>> = {
    orr_forest_bridge: truckRoute1,
    midtown_express: truckRoute2,
    north_harbor_loop: truckRoute3,
  };
  const truckRouteLengths: Record<TruckRouteId, number> = {
    orr_forest_bridge: truckRoute1.getLength(),
    midtown_express: truckRoute2.getLength(),
    north_harbor_loop: truckRoute3.getLength(),
  };

  const routeColors: Record<TruckRouteId, number> = {
    orr_forest_bridge: 0x38bdf8,
    midtown_express: 0x10b981,
    north_harbor_loop: 0xf59e0b,
  };

  const routeGeoPaths = {} as Record<TruckRouteId, Array<{ lat: number; lng: number }>>;
  const routeVisualLines = {} as Record<TruckRouteId, THREE.Line>;

  (['orr_forest_bridge', 'midtown_express', 'north_harbor_loop'] as TruckRouteId[]).forEach((rid) => {
    const curve = truckRoutes[rid];
    const pts = curve.getPoints(180);
    const linePts = pts.map((p) => new THREE.Vector3(p.x, p.y + 0.065, p.z));
    const mat = track(
      new THREE.LineBasicMaterial({
        color: routeColors[rid],
        transparent: true,
        opacity: rid === 'orr_forest_bridge' ? 0.48 : 0.14,
      }),
    );
    const line = new THREE.Line(track(new THREE.BufferGeometry().setFromPoints(linePts)), mat);
    root.add(line);
    routeVisualLines[rid] = line;
    routeGeoPaths[rid] = pts.map((p) => {
      const g = worldToGps(p.x, p.z);
      return { lat: g.lat, lng: g.lng };
    });
  });

  const destinationStops: Record<TruckRouteId, { bridgeT: number; hospitalT: number; orrT: number }> = {
    orr_forest_bridge: {
      orrT: findClosestT(truckRoute1, -46, 25),
      bridgeT: findClosestT(truckRoute1, 41, 4),
      hospitalT: findClosestT(truckRoute1, 10, 25),
    },
    midtown_express: {
      orrT: findClosestT(truckRoute2, -46, 25),
      bridgeT: findClosestT(truckRoute2, 41, 4),
      hospitalT: findClosestT(truckRoute2, 10, 25),
    },
    north_harbor_loop: {
      orrT: findClosestT(truckRoute3, -46, 25),
      bridgeT: findClosestT(truckRoute3, 41, -55),
      hospitalT: findClosestT(truckRoute3, 10, 25),
    },
  };

  // --- 4. Godowns 01 & 02 + Side-Apron + Retractable Gantry Loading Bridge (Off Main Road!) ---
  const wallSlateMat = track(new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.6 }));
  const wallWhiteMat = track(new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.45 }));
  const roofMetalMat = track(
    new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.45, metalness: 0.55 }),
  );
  const accentBlueMat = track(new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.35 }));
  const accentRedMat = track(new THREE.MeshStandardMaterial({ color: 0xdc2626, roughness: 0.35 }));
  const accentGreenMat = track(new THREE.MeshStandardMaterial({ color: 0x059669, roughness: 0.4 }));
  const accentVioletMat = track(new THREE.MeshStandardMaterial({ color: 0x7c3aed, roughness: 0.4 }));
  const accentCyanMat = track(new THREE.MeshStandardMaterial({ color: 0x0891b2, roughness: 0.4 }));

  const godownGroup = new THREE.Group();
  godownGroup.position.set(-36, 0, 42.5);
  root.add(godownGroup);

  const gdBack = new THREE.Mesh(track(new THREE.BoxGeometry(28, 7.2, 1.2)), wallSlateMat);
  gdBack.position.set(0, 3.6, 5.2);
  gdBack.castShadow = true;
  godownGroup.add(gdBack);

  [-13.4, 0, 13.4].forEach((x) => {
    const sideW = new THREE.Mesh(track(new THREE.BoxGeometry(1.1, 7.2, 11.6)), wallSlateMat);
    sideW.position.set(x, 3.6, 0);
    sideW.castShadow = true;
    godownGroup.add(sideW);
  });

  const gdRoof = new THREE.Mesh(track(new THREE.BoxGeometry(29.2, 0.6, 13.4)), roofMetalMat);
  gdRoof.position.set(0, 7.4, -0.4);
  gdRoof.castShadow = true;
  godownGroup.add(gdRoof);

  const godownSign = new THREE.Mesh(
    track(new THREE.BoxGeometry(16.0, 2.2, 0.25)),
    track(
      new THREE.MeshStandardMaterial({
        map: track(
          createZoneSignTexture(
            maxAnisotropy,
            'COLD GODOWNS 01 & 02',
            'PULL-THROUGH LOADING BAY · CRYO-HUB',
            '#0284c7',
          ),
        ),
        roughness: 0.4,
      }),
    ),
  );
  godownSign.position.set(0, 6.2, -6.9);
  godownSign.rotation.y = Math.PI;
  godownGroup.add(godownSign);

  const crateWhiteMat = track(new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.4 }));
  const crateWoodMat = track(new THREE.MeshStandardMaterial({ color: 0xb48a5a, roughness: 0.85 }));
  const vaxCrateGeo = track(new THREE.BoxGeometry(1.15, 0.85, 0.95));

  for (let gx = -11.0; gx <= 11.0; gx += 2.3) {
    if (Math.abs(gx) < 1.2) continue;
    for (const gz of [2.8, 0.4, -2.4]) {
      const stackH = gz > 0 ? 3 : 2;
      for (let h = 0; h < stackH; h++) {
        const mat =
          gx < 0
            ? h % 2 === 0
              ? crateWhiteMat
              : accentBlueMat
            : h % 2 === 0
              ? crateWoodMat
              : accentGreenMat;
        const box = new THREE.Mesh(vaxCrateGeo, mat);
        box.position.set(gx, 0.45 + h * 0.88, gz);
        box.castShadow = true;
        godownGroup.add(box);
      }
    }
  }

  // Raised Side Loading Apron along front of Godown 01 (z = 35.8, clear of the z = 31.4 pull-through bay!)
  const dockGroup = new THREE.Group();
  dockGroup.position.set(-34, 0, 35.8);
  root.add(dockGroup);

  const dockDeck = new THREE.Mesh(track(new THREE.BoxGeometry(20, 1.22, 3.6)), bridgeConcreteMat);
  dockDeck.position.set(0, 0.61, 0);
  dockDeck.receiveShadow = true;
  dockDeck.castShadow = true;
  dockGroup.add(dockDeck);

  const safetyMat = track(new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.4 }));
  const dockStripe = new THREE.Mesh(track(new THREE.BoxGeometry(20.02, 0.06, 0.24)), safetyMat);
  dockStripe.position.set(0, 1.22, -1.7);
  dockGroup.add(dockStripe);

  const bayBeaconMat = track(
    new THREE.MeshStandardMaterial({
      color: 0xf59e0b,
      emissive: 0xf59e0b,
      emissiveIntensity: 1.4,
    }),
  );
  const bayBeacon = new THREE.Mesh(track(new THREE.SphereGeometry(0.24, 12, 12)), bayBeaconMat);
  bayBeacon.position.set(6.2, 2.1, -1.6);
  dockGroup.add(bayBeacon);

  for (let s = 0; s < 4; s++) {
    const step = new THREE.Mesh(track(new THREE.BoxGeometry(1.5, 0.28, 0.52)), bridgeConcreteMat);
    step.position.set(-10.8, 1.05 - s * 0.28, 0.2 + s * 0.5);
    dockGroup.add(step);
  }

  // Retractable Gantry Loading Bridge (Slides from Godown Apron onto rear of TRUCK-01 at x=-28.4, z=31.4, retracts completely clear when doors lock!)
  const gantryBridge = new THREE.Group();
  gantryBridge.position.set(-28.4, 1.22, 34.4);
  root.add(gantryBridge);

  const gantryDeck = new THREE.Mesh(
    track(new THREE.BoxGeometry(2.6, 0.08, 3.6)),
    track(new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.35, metalness: 0.55 })),
  );
  gantryDeck.position.set(0, 0.04, -1.2);
  gantryBridge.add(gantryDeck);

  [-1.25, 1.25].forEach((gx) => {
    const rail = new THREE.Mesh(track(new THREE.BoxGeometry(0.08, 0.75, 3.4)), safetyMat);
    rail.position.set(gx, 0.44, -1.2);
    gantryBridge.add(rail);
  });

  // Roller-conveyor slats on the bridge leading into TRUCK-01's open rear sill
  for (let rz = -2.7; rz <= 0.3; rz += 0.45) {
    const roller = new THREE.Mesh(
      track(new THREE.CylinderGeometry(0.06, 0.06, 1.8, 8)),
      bridgeConcreteMat,
    );
    roller.rotation.z = Math.PI / 2;
    roller.position.set(0, 0.1, rz);
    gantryBridge.add(roller);
  }

  // Godown Forklift (operates inside warehouse yard z = 39)
  const forklift = new THREE.Group();
  forklift.position.set(-40, 0, 39.2);
  root.add(forklift);
  const fkBody = new THREE.Mesh(
    track(new THREE.BoxGeometry(1.7, 1.15, 1.05)),
    track(new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.45 })),
  );
  fkBody.position.y = 0.72;
  forklift.add(fkBody);
  const fkMast = new THREE.Mesh(track(new THREE.BoxGeometry(0.14, 2.2, 0.85)), roofMetalMat);
  fkMast.position.set(0.92, 1.25, 0);
  forklift.add(fkMast);
  const fkLoad = new THREE.Mesh(track(new THREE.BoxGeometry(0.9, 0.75, 0.85)), accentBlueMat);
  fkLoad.position.set(1.42, 0.78, 0);
  forklift.add(fkLoad);

  // --- 5. Metro Bio-Hospital & Blood Bank (x = 10, z = 36) ---
  const hospGroup = new THREE.Group();
  hospGroup.position.set(10, 0, 36);
  root.add(hospGroup);
  const hospMain = new THREE.Mesh(track(new THREE.BoxGeometry(16, 10.5, 10)), wallWhiteMat);
  hospMain.position.set(0, 5.25, 0);
  hospMain.castShadow = true;
  hospGroup.add(hospMain);
  const crossV = new THREE.Mesh(track(new THREE.BoxGeometry(0.9, 2.8, 0.3)), accentRedMat);
  crossV.position.set(4.5, 7.5, -5.15);
  const crossH = new THREE.Mesh(track(new THREE.BoxGeometry(2.8, 0.9, 0.3)), accentRedMat);
  crossH.position.set(4.5, 7.5, -5.15);
  hospGroup.add(crossV, crossH);
  const hospSign = new THREE.Mesh(
    track(new THREE.BoxGeometry(11.5, 2.0, 0.25)),
    track(
      new THREE.MeshStandardMaterial({
        map: track(
          createZoneSignTexture(
            maxAnisotropy,
            'METRO BIO-HOSPITAL',
            'VACCINE & BLOOD BANK RECEIVING BAY',
            '#dc2626',
          ),
        ),
        roughness: 0.4,
      }),
    ),
  );
  hospSign.position.set(-1.5, 8.6, -5.15);
  hospSign.rotation.y = Math.PI;
  hospGroup.add(hospSign);

  // --- 6. Harbor Fresh Food & Dairy Market (x = 18, z = -45) ---
  const marketGroup = new THREE.Group();
  marketGroup.position.set(18, 0, -45);
  root.add(marketGroup);
  const mktBody = new THREE.Mesh(track(new THREE.BoxGeometry(18, 6.4, 9.5)), wallWhiteMat);
  mktBody.position.set(0, 3.2, 0);
  mktBody.castShadow = true;
  marketGroup.add(mktBody);
  const mktRoof = new THREE.Mesh(track(new THREE.BoxGeometry(19, 0.8, 10.4)), accentGreenMat);
  mktRoof.position.set(0, 6.8, 0);
  marketGroup.add(mktRoof);
  const mktSign = new THREE.Mesh(
    track(new THREE.BoxGeometry(12.5, 2.0, 0.25)),
    track(
      new THREE.MeshStandardMaterial({
        map: track(
          createZoneSignTexture(
            maxAnisotropy,
            'HARBOR FRESH MARKET',
            'FOOD & DAIRY DISTRIBUTION HUB',
            '#059669',
          ),
        ),
        roughness: 0.4,
      }),
    ),
  );
  mktSign.position.set(0, 5.1, 4.9);
  marketGroup.add(mktSign);

  // --- 7. ChemLab Research Park (x = -26, z = -45) ---
  const labGroup = new THREE.Group();
  labGroup.position.set(-26, 0, -45);
  root.add(labGroup);
  const labBody = new THREE.Mesh(track(new THREE.BoxGeometry(15, 7.6, 9.5)), wallSlateMat);
  labBody.position.set(0, 3.8, 0);
  labBody.castShadow = true;
  labGroup.add(labBody);
  const labStripe = new THREE.Mesh(track(new THREE.BoxGeometry(15.2, 0.65, 9.7)), accentVioletMat);
  labStripe.position.set(0, 6.4, 0);
  labGroup.add(labStripe);
  const siloMat = track(
    new THREE.MeshStandardMaterial({ color: 0xcbd5e1, metalness: 0.8, roughness: 0.25 }),
  );
  [-5.2, -3.2].forEach((sx) => {
    const silo = new THREE.Mesh(track(new THREE.CylinderGeometry(0.85, 0.85, 6.5, 14)), siloMat);
    silo.position.set(sx, 3.25, 5.9);
    labGroup.add(silo);
  });
  const labSign = new THREE.Mesh(
    track(new THREE.BoxGeometry(11.5, 2.0, 0.25)),
    track(
      new THREE.MeshStandardMaterial({
        map: track(
          createZoneSignTexture(
            maxAnisotropy,
            'CHEMLAB RESEARCH PARK',
            'CRYO-REAGENTS & LAB LOGISTICS',
            '#7c3aed',
          ),
        ),
        roughness: 0.4,
      }),
    ),
  );
  labSign.position.set(2.0, 4.9, 4.9);
  labGroup.add(labSign);

  // --- 7B. East Coastal Seafood Pier Depot (x = 78.5, z = 0) ---
  const pierGroup = new THREE.Group();
  pierGroup.position.set(78.5, 0, 0);
  root.add(pierGroup);
  const pierBody = new THREE.Mesh(track(new THREE.BoxGeometry(7.2, 5.4, 15)), wallSlateMat);
  pierBody.position.set(0, 2.7, 0);
  pierBody.castShadow = true;
  pierGroup.add(pierBody);
  const pierRoof = new THREE.Mesh(track(new THREE.BoxGeometry(7.8, 0.7, 15.6)), accentCyanMat);
  pierRoof.position.set(0, 5.7, 0);
  pierGroup.add(pierRoof);
  const pierSign = new THREE.Mesh(
    track(new THREE.BoxGeometry(0.25, 1.8, 10.5)),
    track(
      new THREE.MeshStandardMaterial({
        map: track(
          createZoneSignTexture(
            maxAnisotropy,
            'COASTAL SEAFOOD PIER',
            'FLASH-CHILL FISH & MEAT HUB',
            '#0891b2',
          ),
        ),
        roughness: 0.4,
      }),
    ),
  );
  pierSign.position.set(-3.75, 4.2, 0);
  pierSign.rotation.y = -Math.PI / 2;
  pierGroup.add(pierSign);

  // --- 8. City Bus Stand & Transit Shelter (x = -8, z = 18.2) ---
  const busStandGroup = new THREE.Group();
  busStandGroup.position.set(-8, 0, 18.2);
  root.add(busStandGroup);

  const shelterBack = new THREE.Mesh(track(new THREE.BoxGeometry(11, 2.8, 0.2)), wallSlateMat);
  shelterBack.position.set(0, 1.4, -1.4);
  busStandGroup.add(shelterBack);

  const shelterGlass = new THREE.Mesh(
    track(new THREE.BoxGeometry(10.6, 2.2, 0.08)),
    track(
      new THREE.MeshPhysicalMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.28,
        roughness: 0.1,
      }),
    ),
  );
  shelterGlass.position.set(0, 1.3, -1.25);
  busStandGroup.add(shelterGlass);

  const shelterRoof = new THREE.Mesh(track(new THREE.BoxGeometry(12.2, 0.28, 3.4)), accentBlueMat);
  shelterRoof.position.set(0, 2.95, 0);
  shelterRoof.castShadow = true;
  busStandGroup.add(shelterRoof);

  const busSign = new THREE.Mesh(
    track(new THREE.BoxGeometry(6.8, 0.9, 0.18)),
    track(
      new THREE.MeshStandardMaterial({
        map: track(
          createZoneSignTexture(maxAnisotropy, 'CITY BUS STAND', 'TRANSIT TERMINAL BAY', '#f59e0b'),
        ),
      }),
    ),
  );
  busSign.position.set(0, 3.55, 0);
  busStandGroup.add(busSign);

  // --- 9. Mini-City Buildings (Clear of ALL road paths including Midtown z=11!) ---
  const cityBuildingMat = track(
    new THREE.MeshStandardMaterial({ color: 0x243244, roughness: 0.65, metalness: 0.2 }),
  );
  const windowEmissiveMat = track(
    new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      emissive: 0xfef08a,
      emissiveIntensity: 0.0,
      roughness: 0.2,
    }),
  );

  const cityBuildings = [
    { x: -16, z: 1.5, w: 6.8, h: 12.5, d: 6.0 },
    { x: -16, z: -9, w: 6.8, h: 9.5, d: 6.0 },
    { x: 5.5, z: -1.5, w: 6.2, h: 15.5, d: 6.0 },
    { x: 5.5, z: -11, w: 5.8, h: 10.2, d: 5.4 },
    { x: -42, z: -4, w: 6.4, h: 8.8, d: 7.4 },
    { x: -42, z: 3.5, w: 6.0, h: 7.2, d: 4.8 }, // shifted north clear of z=11 express lane
  ];

  cityBuildings.forEach((b) => {
    const bMesh = new THREE.Mesh(track(new THREE.BoxGeometry(b.w, b.h, b.d)), cityBuildingMat);
    bMesh.position.set(b.x, b.h * 0.5, b.z);
    bMesh.castShadow = true;
    bMesh.receiveShadow = true;
    root.add(bMesh);

    const floors = Math.floor(b.h / 2.2);
    for (let f = 1; f < floors; f++) {
      const band = new THREE.Mesh(
        track(new THREE.BoxGeometry(b.w + 0.08, 0.55, b.d + 0.08)),
        windowEmissiveMat,
      );
      band.position.set(b.x, f * 2.1, b.z);
      root.add(band);
    }
  });

  // --- 10. Dense West Forest Reserve Flanking West Forest Highway ---
  const forestTreeCoords: Array<[number, number, number]> = [];
  for (let i = 0; i < 72; i++) {
    const fx = -65 - Math.random() * 34;
    const fz = -48 + Math.random() * 88;
    forestTreeCoords.push([fx, fz, 1.05 + Math.random() * 0.8]);
  }
  for (let fz = -23; fz <= 5; fz += 4.5) {
    forestTreeCoords.push([-50.5 - Math.random() * 1.4, fz, 1.0 + Math.random() * 0.45]);
  }
  const scatterTrees: Array<[number, number, number]> = [
    [-16, 40, 1.2],
    [28, 36, 1.1],
    [68, -32, 1.2],
    [68, 30, 1.15],
    [24, 16, 0.95],
  ];
  const allTrees = [...forestTreeCoords, ...scatterTrees];

  const trunkInst = new THREE.InstancedMesh(
    track(new THREE.CylinderGeometry(0.24, 0.34, 2.0, 7)),
    track(new THREE.MeshStandardMaterial({ color: 0x4a2f1d, roughness: 0.92 })),
    allTrees.length,
  );
  const foliageInst = new THREE.InstancedMesh(
    track(new THREE.ConeGeometry(1.75, 4.8, 7)),
    track(new THREE.MeshStandardMaterial({ color: 0x166534, roughness: 0.86 })),
    allTrees.length,
  );
  const _dummy = new THREE.Object3D();
  const _tint = new THREE.Color();

  allTrees.forEach(([tx, tz, s], i) => {
    _dummy.position.set(tx, 1.0 * s, tz);
    _dummy.scale.setScalar(s);
    _dummy.updateMatrix();
    trunkInst.setMatrixAt(i, _dummy.matrix);

    _dummy.position.set(tx, 3.5 * s, tz);
    _dummy.scale.setScalar(s);
    _dummy.updateMatrix();
    foliageInst.setMatrixAt(i, _dummy.matrix);

    _tint.setHSL(0.38 + (i % 5) * 0.015, 0.5, 0.22 + (i % 4) * 0.03);
    foliageInst.setColorAt(i, _tint);
  });
  if (foliageInst.instanceColor) foliageInst.instanceColor.needsUpdate = true;
  trunkInst.computeBoundingSphere();
  foliageInst.computeBoundingSphere();
  root.add(trunkInst, foliageInst);

  // --- 11. Streetlights (OFF in Day, ON at Night) ---
  const streetLampMat = track(
    new THREE.MeshStandardMaterial({
      color: 0xfef3c7,
      emissive: 0xfde68a,
      emissiveIntensity: 0.0,
      roughness: 0.2,
    }),
  );
  const poleMat = track(
    new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.7, roughness: 0.4 }),
  );
  const lampPts = [
    [-26, 20],
    [-12, 20],
    [4, 20],
    [29, 9],
    [53, 9],
    [55, -14],
    [16, -26],
    [-16, -26],
    [-52, -8],
    [4, 54],
    [78.5, 16],
  ];
  const poleGeo = track(new THREE.CylinderGeometry(0.1, 0.14, 6.2, 8));
  const bulbGeo = track(new THREE.SphereGeometry(0.32, 10, 10));
  lampPts.forEach(([lx, lz]) => {
    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.position.set(lx, 3.1, lz);
    const bulb = new THREE.Mesh(bulbGeo, streetLampMat);
    bulb.position.set(lx, 6.25, lz);
    root.add(pole, bulb);
  });

  // --- 12. Clear, Visible Delivery Boys (Interior-Entry Crew + Town Hubs) ---
  const workers: AnimatedWorker[] = [];
  const vestOrangeMat = track(new THREE.MeshStandardMaterial({ color: 0xf97316, roughness: 0.45 }));
  const vestCyanMat = track(new THREE.MeshStandardMaterial({ color: 0x06b6d4, roughness: 0.45 }));
  const vestYellowMat = track(new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.45 }));
  const pantsMat = track(new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.8 }));
  const skinMat = track(new THREE.MeshStandardMaterial({ color: 0xf1c27d, roughness: 0.6 }));
  const capMat = track(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35 }));

  function createDeliveryBoy(
    startPos: THREE.Vector3,
    endPos: THREE.Vector3,
    boxColorHex: number,
    vestMat: THREE.Material,
    phaseOffset: number,
    cycleSpeed: number,
    scale = 1.25,
  ): AnimatedWorker {
    const wRoot = new THREE.Group();
    wRoot.scale.setScalar(scale);
    root.add(wRoot);

    const torso = new THREE.Mesh(track(new THREE.BoxGeometry(0.52, 0.64, 0.32)), vestMat);
    torso.position.y = 1.12;
    torso.castShadow = true;
    wRoot.add(torso);

    const head = new THREE.Mesh(track(new THREE.SphereGeometry(0.18, 12, 12)), skinMat);
    head.position.y = 1.62;
    wRoot.add(head);

    const cap = new THREE.Mesh(
      track(new THREE.SphereGeometry(0.2, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55)),
      capMat,
    );
    cap.position.y = 1.65;
    wRoot.add(cap);

    const legGeo = track(new THREE.BoxGeometry(0.18, 0.74, 0.2));
    const leftLeg = new THREE.Group();
    leftLeg.position.set(-0.14, 0.78, 0);
    const lLegMesh = new THREE.Mesh(legGeo, pantsMat);
    lLegMesh.position.y = -0.37;
    leftLeg.add(lLegMesh);
    wRoot.add(leftLeg);

    const rightLeg = new THREE.Group();
    rightLeg.position.set(0.14, 0.78, 0);
    const rLegMesh = new THREE.Mesh(legGeo, pantsMat);
    rLegMesh.position.y = -0.37;
    rightLeg.add(rLegMesh);
    wRoot.add(rightLeg);

    const armGeo = track(new THREE.BoxGeometry(0.15, 0.54, 0.16));
    const leftArm = new THREE.Group();
    leftArm.position.set(-0.34, 1.34, 0);
    const lArmMesh = new THREE.Mesh(armGeo, vestMat);
    lArmMesh.position.set(0, -0.18, 0.16);
    lArmMesh.rotation.x = -0.9;
    leftArm.add(lArmMesh);
    wRoot.add(leftArm);

    const rightArm = new THREE.Group();
    rightArm.position.set(0.34, 1.34, 0);
    const rArmMesh = new THREE.Mesh(armGeo, vestMat);
    rArmMesh.position.set(0, -0.18, 0.16);
    rArmMesh.rotation.x = -0.9;
    rightArm.add(rArmMesh);
    wRoot.add(rightArm);

    const carriedBox = new THREE.Mesh(
      track(new THREE.BoxGeometry(0.56, 0.42, 0.48)),
      track(new THREE.MeshStandardMaterial({ color: boxColorHex, roughness: 0.35 })),
    );
    carriedBox.position.set(0, 1.12, 0.44);
    carriedBox.castShadow = true;
    wRoot.add(carriedBox);

    return {
      root: wRoot,
      leftLeg,
      rightLeg,
      leftArm,
      rightArm,
      carriedBox,
      startPos,
      endPos,
      phaseOffset,
      cycleSpeed,
    };
  }

  // Dock Loaders start on Godown Apron (z=35.5), cross the Gantry Bridge onto rear sill (-28.6, 31.4), and step INSIDE TRUCK-01 (-33.0, 31.4)
  const dockLoader1 = createDeliveryBoy(
    new THREE.Vector3(-28.0, 1.24, 35.6),
    new THREE.Vector3(-33.4, 1.26, 30.9),
    0x38bdf8,
    vestOrangeMat,
    0,
    1,
    1.18,
  );
  const dockLoader2 = createDeliveryBoy(
    new THREE.Vector3(-29.0, 1.24, 35.6),
    new THREE.Vector3(-32.8, 1.26, 31.9),
    0xf8fafc,
    vestYellowMat,
    0.15,
    1,
    1.18,
  );

  workers.push(
    createDeliveryBoy(
      new THREE.Vector3(-42, 0, 38.2),
      new THREE.Vector3(-42, 0, 36.2),
      0x38bdf8,
      vestCyanMat,
      0.0,
      0.28,
    ),
    createDeliveryBoy(
      new THREE.Vector3(10, 0, 29),
      new THREE.Vector3(10, 0, 32),
      0xdc2626,
      vestCyanMat,
      0.2,
      0.28,
    ),
    createDeliveryBoy(
      new THREE.Vector3(18, 0, -37),
      new THREE.Vector3(18, 0, -40.5),
      0x10b981,
      vestOrangeMat,
      0.7,
      0.27,
    ),
    createDeliveryBoy(
      new THREE.Vector3(74.8, 0, -2),
      new THREE.Vector3(72.5, 0, -2),
      0x0891b2,
      vestYellowMat,
      0.4,
      0.26,
    ),
  );

  // --- 13. Diverse Road Vehicles on 5 Distinct Paths (Zero Stacking / Zero Collisions!) ---
  const trafficVehicles: TrafficVehicle[] = [];
  const carWheelGeo = track(new THREE.CylinderGeometry(0.34, 0.34, 0.22, 14));
  carWheelGeo.rotateX(Math.PI / 2);
  const carTireMat = track(new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.85 }));
  const carGlassMat = track(
    new THREE.MeshPhysicalMaterial({ color: 0x0f172a, roughness: 0.1, clearcoat: 0.9 }),
  );
  const carTorchGeo = track(new THREE.ConeGeometry(1.4, 9.5, 14, 1, true));
  carTorchGeo.translate(0, -4.75, 0);
  carTorchGeo.rotateZ(Math.PI / 2);

  function createTrafficVehicle(
    id: string,
    vehicleType: RoadVehicleType,
    label: string,
    bodyColorHex: number,
    curve: THREE.Curve<THREE.Vector3>,
    progress: number,
    speed: number,
    laneOffset: number,
  ): TrafficVehicle {
    const cg = new THREE.Group();
    root.add(cg);

    const bodyMat = track(
      new THREE.MeshPhysicalMaterial({
        color: bodyColorHex,
        roughness: 0.28,
        metalness: 0.28,
        clearcoat: 0.8,
      }),
    );

    let lengthM = 4.2;
    let frontX = 2.1;
    let rearX = -2.1;
    let wheelXs = [-1.25, 1.25];
    let halfZ = 0.92;

    if (vehicleType === 'city_bus') {
      lengthM = 8.0;
      frontX = 3.9;
      rearX = -3.9;
      wheelXs = [-2.4, 2.4];
      halfZ = 1.05;

      const hull = new THREE.Mesh(track(new THREE.BoxGeometry(7.8, 2.25, 2.15)), bodyMat);
      hull.position.y = 1.45;
      hull.castShadow = true;
      cg.add(hull);

      const stripe = new THREE.Mesh(
        track(new THREE.BoxGeometry(7.84, 0.26, 2.18)),
        accentBlueMat,
      );
      stripe.position.y = 1.15;
      cg.add(stripe);

      const winBand = new THREE.Mesh(track(new THREE.BoxGeometry(7.4, 0.82, 2.19)), carGlassMat);
      winBand.position.set(0.15, 1.92, 0);
      cg.add(winBand);

      [-1.5, 1.4].forEach((ax) => {
        const acPod = new THREE.Mesh(track(new THREE.BoxGeometry(1.4, 0.22, 1.2)), wallWhiteMat);
        acPod.position.set(ax, 2.68, 0);
        cg.add(acPod);
      });
    } else if (vehicleType === 'ambulance') {
      lengthM = 5.0;
      frontX = 2.45;
      rearX = -2.45;
      wheelXs = [-1.5, 1.5];

      const cab = new THREE.Mesh(track(new THREE.BoxGeometry(1.5, 1.35, 1.85)), wallWhiteMat);
      cab.position.set(1.65, 1.0, 0);
      cab.castShadow = true;
      cg.add(cab);

      const medBox = new THREE.Mesh(track(new THREE.BoxGeometry(3.2, 1.82, 1.95)), wallWhiteMat);
      medBox.position.set(-0.7, 1.24, 0);
      medBox.castShadow = true;
      cg.add(medBox);

      const medStripe = new THREE.Mesh(
        track(new THREE.BoxGeometry(3.22, 0.22, 1.98)),
        accentRedMat,
      );
      medStripe.position.set(-0.7, 0.85, 0);
      cg.add(medStripe);

      const lightbarRed = new THREE.Mesh(
        track(new THREE.BoxGeometry(0.24, 0.16, 0.52)),
        accentRedMat,
      );
      lightbarRed.position.set(1.55, 1.76, -0.32);
      const lightbarBlue = new THREE.Mesh(
        track(new THREE.BoxGeometry(0.24, 0.16, 0.52)),
        accentBlueMat,
      );
      lightbarBlue.position.set(1.55, 1.76, 0.32);
      cg.add(lightbarRed, lightbarBlue);

      const wind = new THREE.Mesh(track(new THREE.BoxGeometry(0.1, 0.58, 1.65)), carGlassMat);
      wind.position.set(2.38, 1.35, 0);
      cg.add(wind);
    } else if (vehicleType === 'pickup') {
      lengthM = 4.8;
      frontX = 2.35;
      rearX = -2.35;
      wheelXs = [-1.45, 1.45];

      const bed = new THREE.Mesh(track(new THREE.BoxGeometry(4.6, 0.62, 1.84)), bodyMat);
      bed.position.y = 0.72;
      bed.castShadow = true;
      cg.add(bed);

      const cab = new THREE.Mesh(track(new THREE.BoxGeometry(1.65, 0.78, 1.72)), bodyMat);
      cab.position.set(0.75, 1.4, 0);
      cab.castShadow = true;
      cg.add(cab);

      const cabGlass = new THREE.Mesh(track(new THREE.BoxGeometry(1.7, 0.52, 1.56)), carGlassMat);
      cabGlass.position.set(0.75, 1.45, 0);
      cg.add(cabGlass);

      const crate = new THREE.Mesh(track(new THREE.BoxGeometry(1.3, 0.65, 1.25)), crateWoodMat);
      crate.position.set(-1.15, 1.28, 0);
      cg.add(crate);
    } else if (vehicleType === 'suv') {
      lengthM = 4.4;
      frontX = 2.15;
      rearX = -2.15;
      wheelXs = [-1.35, 1.35];

      const body = new THREE.Mesh(track(new THREE.BoxGeometry(4.3, 0.85, 1.88)), bodyMat);
      body.position.y = 0.82;
      body.castShadow = true;
      cg.add(body);

      const top = new THREE.Mesh(track(new THREE.BoxGeometry(2.65, 0.72, 1.68)), carGlassMat);
      top.position.set(-0.35, 1.56, 0);
      cg.add(top);

      const spare = new THREE.Mesh(track(new THREE.CylinderGeometry(0.32, 0.32, 0.2, 12)), carTireMat);
      spare.rotation.z = Math.PI / 2;
      spare.position.set(-2.2, 0.95, 0);
      cg.add(spare);
    } else if (vehicleType === 'delivery_van') {
      lengthM = 4.6;
      frontX = 2.28;
      rearX = -2.28;
      wheelXs = [-1.4, 1.4];

      const box = new THREE.Mesh(track(new THREE.BoxGeometry(4.5, 1.58, 1.84)), bodyMat);
      box.position.y = 1.14;
      box.castShadow = true;
      cg.add(box);

      const wind = new THREE.Mesh(track(new THREE.BoxGeometry(0.12, 0.62, 1.6)), carGlassMat);
      wind.position.set(2.22, 1.42, 0);
      cg.add(wind);
    } else {
      // Sedan
      const chassis = new THREE.Mesh(track(new THREE.BoxGeometry(4.1, 0.72, 1.82)), bodyMat);
      chassis.position.y = 0.68;
      chassis.castShadow = true;
      cg.add(chassis);

      const cabin = new THREE.Mesh(track(new THREE.BoxGeometry(2.1, 0.58, 1.56)), carGlassMat);
      cabin.position.set(-0.15, 1.3, 0);
      cg.add(cabin);
    }

    const brakeMat = track(
      new THREE.MeshStandardMaterial({
        color: 0x991b1b,
        emissive: 0xef4444,
        emissiveIntensity: 0.4,
      }),
    );
    const rearBar = new THREE.Mesh(track(new THREE.BoxGeometry(0.08, 0.18, 1.5)), brakeMat);
    rearBar.position.set(rearX, 0.78, 0);
    cg.add(rearBar);

    const torchConeMeshes: THREE.Mesh[] = [];
    const torchCones: THREE.MeshBasicMaterial[] = [];
    for (const z of [-0.62, 0.62]) {
      const coneMat = track(
        new THREE.MeshBasicMaterial({
          color: 0xfef3c7,
          transparent: true,
          opacity: 0.0,
          side: THREE.DoubleSide,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      const cone = new THREE.Mesh(carTorchGeo, coneMat);
      cone.position.set(frontX, 0.72, z);
      cone.rotation.z = -0.05;
      cone.visible = false;
      cg.add(cone);
      torchConeMeshes.push(cone);
      torchCones.push(coneMat);
    }

    const wheels: THREE.Mesh[] = [];
    for (const x of wheelXs) {
      for (const z of [-halfZ, halfZ]) {
        const w = new THREE.Mesh(carWheelGeo, carTireMat);
        w.position.set(x, 0.34, z);
        cg.add(w);
        wheels.push(w);
      }
    }

    return {
      id,
      vehicleType,
      label,
      lengthM,
      root: cg,
      wheels,
      curve,
      progress,
      speed,
      laneOffset,
      torchConeMeshes,
      torchCones,
      brakeMat,
      zoneLabel: 'Town Road',
      lat: 17.4326,
      lng: 78.3820,
    };
  }

  // Lead Sedan on Main ORR / Forest Loop (NEVER enters Godown Bay; triggers TRUCK-01 IR=ON when ahead!)
  const leadCar = createTrafficVehicle(
    'veh-lead',
    'sedan',
    'Sedan (Lead)',
    0xf43f5e,
    orrTrafficLoop,
    0.14,
    0.032,
    2.25,
  );
  trafficVehicles.push(leadCar);

  // Path 1 Opposite Lane (-2.25, negative speed -> 4.5m lateral clearance from TRUCK-01 & stays clear of Godown Bay!)
  trafficVehicles.push(
    createTrafficVehicle('veh-amb-1', 'ambulance', 'Metro Ambulance', 0xf8fafc, orrTrafficLoop, 0.28, -0.028, -2.25),
    createTrafficVehicle('veh-suv-1', 'suv', '4x4 Patrol SUV', 0x0ea5e9, orrTrafficLoop, 0.60, -0.028, -2.25),
    createTrafficVehicle('veh-pkp-1', 'pickup', 'Cargo Pickup', 0xf59e0b, orrTrafficLoop, 0.88, -0.028, -2.25),
  );

  // Path 2: Midtown Downtown Loop (City Bus, Sedan, Delivery Van on opposite lane -2.25 -> 4.5m clear of Route 2!)
  trafficVehicles.push(
    createTrafficVehicle('veh-bus-2', 'city_bus', 'City Transit Bus', 0xf59e0b, loopMidtown, 0.14, -0.024, -2.25),
    createTrafficVehicle('veh-sed-2', 'sedan', 'Midtown Taxi', 0x10b981, loopMidtown, 0.48, -0.029, -2.25),
    createTrafficVehicle('veh-van-2', 'delivery_van', 'Courier Van', 0x6366f1, loopMidtown, 0.80, -0.029, -2.25),
  );

  // Path 3: North Market & Dairy Pkwy (Pickup, Delivery Van on opposite lane -2.25 -> 4.5m clear of Route 3!)
  trafficVehicles.push(
    createTrafficVehicle('veh-pkp-3', 'pickup', 'Dairy Farm Pickup', 0x3b82f6, loopNorth, 0.18, -0.031, -2.25),
    createTrafficVehicle('veh-van-3', 'delivery_van', 'Market Van', 0xeab308, loopNorth, 0.65, -0.031, -2.25),
  );

  // Path 4: South Hospital Medical Perimeter (Ambulance, SUV)
  trafficVehicles.push(
    createTrafficVehicle('veh-amb-4', 'ambulance', 'Emergency Unit 02', 0xf8fafc, loopSouth, 0.22, -0.031, -1.6),
    createTrafficVehicle('veh-suv-4', 'suv', 'Medical SUV', 0xdc2626, loopSouth, 0.72, -0.031, -1.6),
  );

  // Path 5: East Coastal Harbor Bypass (Pickup, Courier Van on EAST lane -2.25 -> 4.5m clear of Route 3!)
  trafficVehicles.push(
    createTrafficVehicle('veh-pkp-5', 'pickup', 'Harbor Pickup', 0x0891b2, loopEast, 0.28, 0.032, -2.25),
    createTrafficVehicle('veh-van-5', 'delivery_van', 'Seafood Express Van', 0x06b6d4, loopEast, 0.75, 0.032, -2.25),
  );

  // --- 14. Orbiting GPS Telemetry Satellite ---
  const satelliteGroup = new THREE.Group();
  satelliteGroup.position.set(0, 38, 0);
  root.add(satelliteGroup);
  satelliteGroup.add(new THREE.Mesh(track(new THREE.BoxGeometry(2.2, 1.2, 1.2)), siloMat));
  const solarMat = track(
    new THREE.MeshStandardMaterial({
      color: 0x1d4ed8,
      emissive: 0x0284c7,
      emissiveIntensity: 0.35,
      metalness: 0.6,
      roughness: 0.2,
    }),
  );
  [-3.2, 3.2].forEach((sx) => {
    const panel = new THREE.Mesh(track(new THREE.BoxGeometry(3.6, 0.08, 1.4)), solarMat);
    panel.position.x = sx;
    satelliteGroup.add(panel);
  });

  function setActiveRouteHighlight(routeId: TruckRouteId): void {
    (['orr_forest_bridge', 'midtown_express', 'north_harbor_loop'] as TruckRouteId[]).forEach((rid) => {
      const mat = routeVisualLines[rid].material as THREE.LineBasicMaterial;
      mat.opacity = rid === routeId ? 0.56 : 0.12;
    });
  }

  function setTimeOfDayVisuals(nightFactor: number): void {
    const torchOn = nightFactor > 0.05;
    windowEmissiveMat.emissiveIntensity = THREE.MathUtils.lerp(0.0, 1.65, nightFactor);
    streetLampMat.emissiveIntensity = torchOn ? THREE.MathUtils.lerp(0.0, 2.6, nightFactor) : 0.0;
    const torchOpacity = torchOn ? THREE.MathUtils.lerp(0.0, 0.26, nightFactor) : 0.0;
    for (let i = 0; i < trafficVehicles.length; i++) {
      const v = trafficVehicles[i];
      for (let j = 0; j < v.torchCones.length; j++) {
        v.torchConeMeshes[j].visible = torchOn;
        v.torchCones[j].opacity = torchOpacity;
      }
    }
  }

  const _pt = new THREE.Vector3();
  const _tan = new THREE.Vector3();
  const _side = new THREE.Vector3();

  // Initialize exact world positions for all traffic vehicles before frame 1
  for (let i = 0; i < trafficVehicles.length; i++) {
    const v = trafficVehicles[i];
    v.curve.getPointAt(v.progress, _pt);
    v.curve.getTangentAt(v.progress, _tan);
    const dirSign = v.speed >= 0 ? 1 : -1;
    _tan.y = 0;
    if (_tan.lengthSq() < 1e-6) _tan.set(1, 0, 0);
    _tan.normalize();
    _side.set(-_tan.z, 0, _tan.x);
    v.root.position.set(_pt.x + _side.x * v.laneOffset, _pt.y + 0.02, _pt.z + _side.z * v.laneOffset);
    v.root.rotation.y = Math.atan2(-_tan.z * dirSign, _tan.x * dirSign);
  }

  function update(
    delta: number,
    elapsed: number,
    leadCarStopped: boolean,
    t1State: {
      x: number;
      z: number;
      fwdX: number;
      fwdZ: number;
      loadingActive: boolean;
      subStage: LoadingSubStage;
      phaseProgress: number;
    },
  ): void {
    forklift.position.x = -38 + Math.sin(elapsed * 0.65) * 6.5;
    forklift.rotation.y = Math.cos(elapsed * 0.65) >= 0 ? 0 : Math.PI;

    // Retractable Gantry Loading Bridge & Waypoint Crew during TRUCK-01's Loading Sequence
    const showBridge =
      t1State.loadingActive &&
      (t1State.subStage === 'opening_door' || t1State.subStage === 'loading_inside');
    gantryBridge.position.z = THREE.MathUtils.damp(
      gantryBridge.position.z,
      showBridge ? 32.6 : 34.8,
      7.5,
      delta,
    );
    bayBeaconMat.color.setHex(t1State.loadingActive ? 0xf59e0b : 0x10b981);
    bayBeaconMat.emissive.setHex(t1State.loadingActive ? 0xf59e0b : 0x10b981);

    // 2-step L-path: Godown Apron (-28, 35.6) -> Rear Gantry Threshold (-28.8, 31.4) -> Inside Cargo Bay (-33.2, 31.4)
    [dockLoader1, dockLoader2].forEach((loader, idx) => {
      const entryZ = idx === 0 ? 31.0 : 31.8;
      const thresholdPos = new THREE.Vector3(-28.6, 1.24, entryZ);
      if (t1State.loadingActive && t1State.subStage === 'loading_inside') {
        const offset = idx * 0.14;
        const p = THREE.MathUtils.clamp((t1State.phaseProgress - offset) / 0.86, 0, 1);
        const goingInside = p < 0.52;
        const localT = goingInside ? p / 0.52 : (p - 0.52) / 0.48;
        const smooth = localT * localT * (3 - 2 * localT);

        if (goingInside) {
          if (smooth < 0.45) {
            const legT = smooth / 0.45;
            loader.root.position.lerpVectors(loader.startPos, thresholdPos, legT);
            loader.root.lookAt(thresholdPos.x, thresholdPos.y, thresholdPos.z);
          } else {
            const legT = (smooth - 0.45) / 0.55;
            loader.root.position.lerpVectors(thresholdPos, loader.endPos, legT);
            loader.root.lookAt(loader.endPos.x, loader.endPos.y, loader.endPos.z);
          }
          loader.carriedBox.visible = true;
        } else {
          if (smooth < 0.55) {
            const legT = smooth / 0.55;
            loader.root.position.lerpVectors(loader.endPos, thresholdPos, legT);
            loader.root.lookAt(thresholdPos.x, thresholdPos.y, thresholdPos.z);
          } else {
            const legT = (smooth - 0.55) / 0.45;
            loader.root.position.lerpVectors(thresholdPos, loader.startPos, legT);
            loader.root.lookAt(loader.startPos.x, loader.startPos.y, loader.startPos.z);
          }
          loader.carriedBox.visible = false;
        }
        const walkPhase = p > 0.02 && p < 0.98 ? Math.sin(elapsed * 9.5 + idx * 1.3) * 0.55 : 0;
        loader.leftLeg.rotation.x = walkPhase;
        loader.rightLeg.rotation.x = -walkPhase;
        loader.leftArm.rotation.x = goingInside ? 0 : -walkPhase * 0.4;
        loader.rightArm.rotation.x = goingInside ? 0 : walkPhase * 0.4;
      } else {
        loader.root.position.copy(loader.startPos);
        loader.root.lookAt(thresholdPos.x, loader.startPos.y, thresholdPos.z);
        loader.carriedBox.visible = t1State.loadingActive && t1State.subStage === 'opening_door';
        loader.leftLeg.rotation.x = 0;
        loader.rightLeg.rotation.x = 0;
        loader.leftArm.rotation.x = 0;
        loader.rightArm.rotation.x = 0;
      }
    });

    for (let i = 0; i < workers.length; i++) {
      const w = workers[i];
      const raw = (elapsed * w.cycleSpeed + w.phaseOffset) % 1;
      const goingToTruck = raw < 0.5;
      const t = goingToTruck ? raw * 2 : (raw - 0.5) * 2;
      const smoothT = t * t * (3 - 2 * t);

      if (goingToTruck) {
        w.root.position.lerpVectors(w.startPos, w.endPos, smoothT);
        w.root.lookAt(w.endPos.x, w.endPos.y, w.endPos.z);
        w.carriedBox.visible = true;
      } else {
        w.root.position.lerpVectors(w.endPos, w.startPos, smoothT);
        w.root.lookAt(w.startPos.x, w.startPos.y, w.startPos.z);
        w.carriedBox.visible = false;
      }

      const stride = Math.sin(elapsed * 7.5 + i * 1.4) * 0.55;
      w.leftLeg.rotation.x = stride;
      w.rightLeg.rotation.x = -stride;
      w.leftArm.rotation.x = goingToTruck ? 0 : -stride * 0.4;
      w.rightArm.rotation.x = goingToTruck ? 0 : stride * 0.4;
    }

    // Update road traffic with STRICT multi-point proximity collision prevention (Zero dashing or clipping!)
    for (let i = 0; i < trafficVehicles.length; i++) {
      const v = trafficVehicles[i];
      const isLead = v === leadCar;
      let effectiveSpeed = isLead && leadCarStopped ? 0 : v.speed;

      v.curve.getTangentAt(v.progress, _tan);
      const dirSign = v.speed >= 0 ? 1 : -1;
      _tan.y = 0;
      if (_tan.lengthSq() < 1e-6) _tan.set(1, 0, 0);
      _tan.normalize();
      const myFwdX = _tan.x * dirSign;
      const myFwdZ = _tan.z * dirSign;
      const mySideX = -myFwdZ;
      const mySideZ = myFwdX;

      let yielding = false;

      // 1) Check forward clearance against TRUCK-01's rear, center, and front cab points (10.6m span)
      for (const tOff of [-4.4, 0, 4.4]) {
        const tx = t1State.x + t1State.fwdX * tOff;
        const tz = t1State.z + t1State.fwdZ * tOff;
        const dxT = tx - v.root.position.x;
        const dzT = tz - v.root.position.z;
        const aheadT = dxT * myFwdX + dzT * myFwdZ;
        const latT = Math.abs(dxT * mySideX + dzT * mySideZ);
        if (aheadT > 0.2 && aheadT < v.lengthM * 0.5 + 8.0 && latT < 3.4) {
          yielding = true;
          break;
        }
      }

      // 2) Check forward clearance against ALL other traffic vehicles (same path & crossings)
      if (!yielding) {
        for (let j = 0; j < trafficVehicles.length; j++) {
          if (i === j) continue;
          const other = trafficVehicles[j];
          const dxO = other.root.position.x - v.root.position.x;
          const dzO = other.root.position.z - v.root.position.z;
          const distOSq = dxO * dxO + dzO * dzO;
          const minCarSep = (v.lengthM + other.lengthM) * 0.5 + 5.2;
          if (distOSq < minCarSep * minCarSep) {
            const aheadO = dxO * myFwdX + dzO * myFwdZ;
            const latO = Math.abs(dxO * mySideX + dzO * mySideZ);
            if (aheadO > 0.4 && latO < 3.2) {
              yielding = true;
              break;
            }
          }
        }
      }

      if (yielding) {
        effectiveSpeed = 0;
      }

      v.progress = (v.progress + effectiveSpeed * delta + 1) % 1;
      v.curve.getPointAt(v.progress, _pt);
      v.curve.getTangentAt(v.progress, _tan);

      const horizLen = Math.hypot(_tan.x, _tan.z) || 1;
      const pitch = Math.atan2(_tan.y * dirSign, horizLen);

      _tan.y = 0;
      if (_tan.lengthSq() < 1e-6) _tan.set(1, 0, 0);
      _tan.normalize();
      _side.set(-_tan.z, 0, _tan.x);

      v.root.position.set(
        _pt.x + _side.x * v.laneOffset,
        _pt.y + 0.02,
        _pt.z + _side.z * v.laneOffset,
      );
      v.root.rotation.order = 'YXZ';
      v.root.rotation.y = Math.atan2(-_tan.z * dirSign, _tan.x * dirSign);
      v.root.rotation.z = pitch;

      const gps = worldToGps(v.root.position.x, v.root.position.z);
      v.lat = gps.lat;
      v.lng = gps.lng;
      v.zoneLabel = gps.zoneLabel;

      if (v.brakeMat) {
        v.brakeMat.emissiveIntensity = (isLead && leadCarStopped) || yielding ? 3.2 : 0.4;
      }

      const wheelRot = (Math.abs(effectiveSpeed) * 140 * delta) / 0.34;
      for (let wi = 0; wi < v.wheels.length; wi++) {
        v.wheels[wi].rotation.z -= wheelRot;
      }
    }

    lakeWaterMat.roughness = 0.12 + Math.sin(elapsed * 2.2) * 0.03;

    satelliteGroup.position.x = Math.cos(elapsed * 0.14) * 32;
    satelliteGroup.position.z = Math.sin(elapsed * 0.14) * 26;
    satelliteGroup.rotation.y = -elapsed * 0.14;
  }

  function dispose(): void {
    disposables.forEach((d) => d.dispose());
  }

  return {
    root,
    truckRoutes,
    truckRouteLengths,
    routeGeoPaths,
    routeVisualLines,
    destinationStops,
    trafficVehicles,
    leadCar,
    satelliteGroup,
    setActiveRouteHighlight,
    setTimeOfDayVisuals,
    update,
    dispose,
  };
}
