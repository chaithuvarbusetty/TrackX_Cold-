import * as THREE from 'three';
import { INDUSTRY_LIST, IndustryId } from '../../types/cargoguard';
import {
  createContactShadowTexture,
  createCrateLabelTexture,
  createDotStripingTexture,
  createLiveryTexture,
} from './textures';

export interface TruckRig {
  root: THREE.Group;
  cabGroup: THREE.Group;
  trailerGroup: THREE.Group;
  wheels: THREE.Group[];
  coolingFan: THREE.Group;
  leftDoorPivot: THREE.Group;
  rightDoorPivot: THREE.Group;
  cutawaySolidWall: THREE.Mesh;
  cutawayAcrylicPanel: THREE.Mesh;
  cargoGroups: Record<IndustryId, THREE.Group>;
  coldMistPoints: THREE.Points;
  coldMistMaterial: THREE.PointsMaterial;

  // Vehicle Torch (Headlight beams + SpotLight) & Brake Lights
  torchConeMeshes: THREE.Mesh[];
  torchConeMats: THREE.MeshBasicMaterial[];
  torchSpotLight: THREE.SpotLight | null;
  headlightMat: THREE.MeshStandardMaterial;
  taillightMat: THREE.MeshStandardMaterial;

  // Front IR Pre-Collision Sensor
  irBeamMesh: THREE.Mesh;
  irBeamMat: THREE.MeshBasicMaterial;
  irLedMat: THREE.MeshStandardMaterial;

  // IoT Hardware & Visual Indicator Materials
  nodeGroup: THREE.Group;
  nodeLedMat: THREE.MeshStandardMaterial;
  nodeTxRing: THREE.Mesh;
  gatewayGroup: THREE.Group;
  gatewayLedMat: THREE.MeshStandardMaterial;
  gatewayRxRing: THREE.Mesh;
  gatewayBeaconMat: THREE.MeshStandardMaterial;
  gatewayBeaconLight: THREE.PointLight;
  doorSensorLedMat: THREE.MeshStandardMaterial;
  interiorStripMat: THREE.MeshStandardMaterial;
  interiorLight: THREE.PointLight;
  reeferStatusMat: THREE.MeshStandardMaterial;
  gpsBeaconRing: THREE.Mesh;

  // Anchor points
  anchorNode: THREE.Object3D;
  anchorGateway: THREE.Object3D;
  anchorCargo: THREE.Object3D;
  anchorDoorSensor: THREE.Object3D;
  anchorIrSensor: THREE.Object3D;

  updateCargoVisuals: (industry: IndustryId) => void;
  dispose: () => void;
}

export function buildCargoTruck(
  maxAnisotropy: number,
  isSoftwareGl: boolean,
  options?: { cabColorHex?: number; enablePointLights?: boolean; enableIrAndTorch?: boolean },
): TruckRig {
  const cabColorHex = options?.cabColorHex ?? 0x0f2744;
  const enablePointLights = options?.enablePointLights ?? true;
  const enableIrAndTorch = options?.enableIrAndTorch ?? true;

  const disposables: Array<{ dispose: () => void }> = [];
  const track = <T extends { dispose: () => void }>(item: T): T => {
    disposables.push(item);
    return item;
  };

  const root = new THREE.Group();

  // --- Shared Calibrated PBR Materials ---
  const chassisSteelMat = track(
    new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.55, metalness: 0.72 }),
  );
  const brushedAluminumMat = track(
    new THREE.MeshStandardMaterial({ color: 0xcbd5e1, roughness: 0.28, metalness: 0.85 }),
  );
  const chromeMat = track(
    new THREE.MeshPhysicalMaterial({
      color: 0xe2e8f0,
      roughness: 0.12,
      metalness: 0.95,
      clearcoat: 0.6,
    }),
  );
  const cabPaintMat = track(
    new THREE.MeshPhysicalMaterial({
      color: cabColorHex,
      roughness: 0.25,
      metalness: 0.35,
      clearcoat: 0.85,
      clearcoatRoughness: 0.12,
    }),
  );
  const trailerWhiteMat = track(
    new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.42, metalness: 0.12 }),
  );
  const trailerInteriorMat = track(
    new THREE.MeshStandardMaterial({ color: 0xdbeafe, roughness: 0.52, metalness: 0.08 }),
  );
  const rubberMat = track(
    new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.88, metalness: 0.05 }),
  );
  const glassMat = track(
    new THREE.MeshPhysicalMaterial({
      color: 0x0f172a,
      roughness: 0.08,
      metalness: 0.1,
      clearcoat: 1.0,
      transparent: true,
      opacity: 0.82,
    }),
  );
  const headlightMat = track(
    new THREE.MeshStandardMaterial({
      color: 0xfef9c3,
      emissive: 0xfef08a,
      emissiveIntensity: 1.4,
      roughness: 0.2,
    }),
  );
  const taillightMat = track(
    new THREE.MeshStandardMaterial({
      color: 0x991b1b,
      emissive: 0xef4444,
      emissiveIntensity: 0.9,
      roughness: 0.3,
    }),
  );
  const amberMarkerMat = track(
    new THREE.MeshStandardMaterial({
      color: 0xd97706,
      emissive: 0xf59e0b,
      emissiveIntensity: 1.4,
      roughness: 0.25,
    }),
  );

  // Contact shadow grounding plane
  const shadowTex = track(createContactShadowTexture());
  const contactShadow = new THREE.Mesh(
    track(new THREE.PlaneGeometry(12.8, 4.8)),
    track(
      new THREE.MeshBasicMaterial({
        map: shadowTex,
        transparent: true,
        opacity: 0.62,
        depthWrite: false,
      }),
    ),
  );
  contactShadow.rotation.x = -Math.PI / 2;
  contactShadow.position.set(0.1, 0.035, 0);
  root.add(contactShadow);

  const gpsBeaconRing = new THREE.Mesh(
    track(new THREE.RingGeometry(3.2, 3.45, 48)),
    track(
      new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.32,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    ),
  );
  gpsBeaconRing.rotation.x = -Math.PI / 2;
  gpsBeaconRing.position.set(0, 0.055, 0);
  root.add(gpsBeaconRing);

  // --- 1. Chassis Frame ---
  const chassisGroup = new THREE.Group();
  root.add(chassisGroup);

  const railGeo = track(new THREE.BoxGeometry(10.0, 0.18, 0.12));
  [-0.52, 0.52].forEach((z) => {
    const rail = new THREE.Mesh(railGeo, chassisSteelMat);
    rail.position.set(0.05, 0.96, z);
    rail.castShadow = true;
    chassisGroup.add(rail);
  });

  const crossGeo = track(new THREE.BoxGeometry(0.14, 0.14, 1.04));
  for (let x = -4.6; x <= 4.6; x += 1.15) {
    const cross = new THREE.Mesh(crossGeo, chassisSteelMat);
    cross.position.set(x, 0.95, 0);
    chassisGroup.add(cross);
  }

  const rearGuardBar = new THREE.Mesh(
    track(new THREE.BoxGeometry(0.14, 0.14, 2.38)),
    brushedAluminumMat,
  );
  rearGuardBar.position.set(-5.02, 0.52, 0);
  chassisGroup.add(rearGuardBar);

  // --- 2. Wheels ---
  const wheels: THREE.Group[] = [];
  const wheelRadius = 0.52;
  const tireGeo = track(new THREE.CylinderGeometry(wheelRadius, wheelRadius, 0.3, 24));
  tireGeo.rotateX(Math.PI / 2);
  const rimGeo = track(new THREE.CylinderGeometry(0.28, 0.28, 0.31, 16));
  rimGeo.rotateX(Math.PI / 2);
  const hubGeo = track(new THREE.CylinderGeometry(0.11, 0.11, 0.34, 12));
  hubGeo.rotateX(Math.PI / 2);
  const lugGeo = track(new THREE.CylinderGeometry(0.022, 0.022, 0.33, 6));
  lugGeo.rotateX(Math.PI / 2);

  function createWheel(x: number, z: number, dual: boolean): THREE.Group {
    const wGroup = new THREE.Group();
    wGroup.position.set(x, wheelRadius, z);
    const offsets = dual ? [-0.17, 0.17] : [0];
    offsets.forEach((zOff) => {
      const tire = new THREE.Mesh(tireGeo, rubberMat);
      tire.position.z = zOff;
      tire.castShadow = true;
      wGroup.add(tire);

      const rim = new THREE.Mesh(rimGeo, brushedAluminumMat);
      rim.position.z = zOff;
      wGroup.add(rim);
    });
    wGroup.add(new THREE.Mesh(hubGeo, chromeMat));
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const lug = new THREE.Mesh(lugGeo, chassisSteelMat);
      lug.position.set(Math.cos(a) * 0.19, Math.sin(a) * 0.19, dual ? 0.17 : 0);
      wGroup.add(lug);
    }
    return wGroup;
  }

  const axlePositions: Array<{ x: number; dual: boolean }> = [
    { x: 4.25, dual: false },
    { x: 2.35, dual: true },
    { x: -3.45, dual: true },
    { x: -4.58, dual: true },
  ];
  const axleShaftGeo = track(new THREE.CylinderGeometry(0.08, 0.08, 2.2, 10));
  axleShaftGeo.rotateX(Math.PI / 2);

  axlePositions.forEach(({ x, dual }) => {
    const shaft = new THREE.Mesh(axleShaftGeo, chassisSteelMat);
    shaft.position.set(x, wheelRadius, 0);
    chassisGroup.add(shaft);
    const wLeft = createWheel(x, -1.04, dual);
    const wRight = createWheel(x, 1.04, dual);
    root.add(wLeft, wRight);
    wheels.push(wLeft, wRight);
  });

  // --- 3. Tractor Cab + Headlight Torches + Front IR Sensor ---
  const cabGroup = new THREE.Group();
  root.add(cabGroup);

  const cabBody = new THREE.Mesh(
    track(new THREE.BoxGeometry(1.65, 2.15, 2.34)),
    cabPaintMat,
  );
  cabBody.position.set(2.92, 2.12, 0);
  cabBody.castShadow = true;
  cabGroup.add(cabBody);

  const hoodShape = new THREE.Shape();
  hoodShape.moveTo(3.72, 1.06);
  hoodShape.lineTo(5.06, 1.06);
  hoodShape.lineTo(5.12, 1.82);
  hoodShape.quadraticCurveTo(5.06, 2.04, 4.78, 2.1);
  hoodShape.lineTo(3.72, 2.26);
  hoodShape.closePath();

  const hoodGeo = track(
    new THREE.ExtrudeGeometry(hoodShape, {
      depth: 2.1,
      bevelEnabled: true,
      bevelThickness: 0.07,
      bevelSize: 0.06,
      bevelSegments: 2,
    }),
  );
  hoodGeo.translate(0, 0, -1.05);
  const hoodMesh = new THREE.Mesh(hoodGeo, cabPaintMat);
  hoodMesh.castShadow = true;
  cabGroup.add(hoodMesh);

  const fairingShape = new THREE.Shape();
  fairingShape.moveTo(2.1, 3.19);
  fairingShape.lineTo(3.65, 3.19);
  fairingShape.quadraticCurveTo(3.15, 3.82, 2.1, 3.88);
  fairingShape.closePath();

  const fairingGeo = track(
    new THREE.ExtrudeGeometry(fairingShape, {
      depth: 2.14,
      bevelEnabled: true,
      bevelThickness: 0.04,
      bevelSize: 0.04,
      bevelSegments: 2,
    }),
  );
  fairingGeo.translate(0, 0, -1.07);
  const fairingMesh = new THREE.Mesh(fairingGeo, cabPaintMat);
  fairingMesh.castShadow = true;
  cabGroup.add(fairingMesh);

  const windshield = new THREE.Mesh(
    track(new THREE.BoxGeometry(0.08, 0.86, 2.12)),
    glassMat,
  );
  windshield.position.set(3.76, 2.68, 0);
  windshield.rotation.z = 0.22;
  cabGroup.add(windshield);

  [-1.18, 1.18].forEach((z) => {
    const sideWin = new THREE.Mesh(track(new THREE.BoxGeometry(0.95, 0.72, 0.04)), glassMat);
    sideWin.position.set(3.15, 2.66, z);
    cabGroup.add(sideWin);
  });

  const grilleFrame = new THREE.Mesh(
    track(new THREE.BoxGeometry(0.1, 0.78, 1.32)),
    chromeMat,
  );
  grilleFrame.position.set(5.16, 1.56, 0);
  cabGroup.add(grilleFrame);

  const grilleInner = new THREE.Mesh(
    track(new THREE.BoxGeometry(0.11, 0.68, 1.2)),
    chassisSteelMat,
  );
  grilleInner.position.set(5.17, 1.56, 0);
  cabGroup.add(grilleInner);

  for (let i = -2; i <= 2; i++) {
    const slat = new THREE.Mesh(track(new THREE.BoxGeometry(0.12, 0.04, 1.16)), chromeMat);
    slat.position.set(5.18, 1.56 + i * 0.11, 0);
    cabGroup.add(slat);
  }

  const bumper = new THREE.Mesh(
    track(new THREE.BoxGeometry(0.22, 0.28, 2.38)),
    chromeMat,
  );
  bumper.position.set(5.16, 0.84, 0);
  cabGroup.add(bumper);

  // Dual Headlights + Volumetric Torch Cones (Day vs Night visual difference!)
  const torchConeMeshes: THREE.Mesh[] = [];
  const torchConeMats: THREE.MeshBasicMaterial[] = [];
  const torchConeGeo = track(new THREE.ConeGeometry(2.3, 14.5, 22, 1, true));
  torchConeGeo.translate(0, -7.25, 0);
  torchConeGeo.rotateZ(Math.PI / 2); // cone tip at origin, opens along +X

  [-0.86, 0.86].forEach((z) => {
    const hl = new THREE.Mesh(track(new THREE.BoxGeometry(0.1, 0.18, 0.28)), headlightMat);
    hl.position.set(5.16, 1.24, z);
    cabGroup.add(hl);

    const marker = new THREE.Mesh(track(new THREE.BoxGeometry(0.1, 0.08, 0.18)), amberMarkerMat);
    marker.position.set(5.16, 1.38, z);
    cabGroup.add(marker);

    if (enableIrAndTorch) {
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
      const cone = new THREE.Mesh(torchConeGeo, coneMat);
      cone.position.set(5.22, 1.24, z);
      cone.rotation.z = -0.06; // angled slightly down onto asphalt
      cone.visible = false;
      cabGroup.add(cone);
      torchConeMeshes.push(cone);
      torchConeMats.push(coneMat);
    }
  });

  // Real SpotLight for Truck 01 Headlight Torch on Night Road
  let torchSpotLight: THREE.SpotLight | null = null;
  if (enablePointLights && !isSoftwareGl) {
    torchSpotLight = new THREE.SpotLight(0xfef3c7, 0.2, 42, Math.PI / 4.8, 0.65, 1.2);
    torchSpotLight.position.set(5.25, 1.32, 0);
    torchSpotLight.target.position.set(22, 0, 0);
    cabGroup.add(torchSpotLight);
    cabGroup.add(torchSpotLight.target);
  }

  // Front IR Pre-Collision Sensor Module on Bumper
  const irSensorBox = new THREE.Mesh(
    track(new THREE.BoxGeometry(0.14, 0.14, 0.32)),
    chassisSteelMat,
  );
  irSensorBox.position.set(5.26, 0.86, 0);
  cabGroup.add(irSensorBox);

  const irLedMat = track(
    new THREE.MeshStandardMaterial({
      color: 0x06b6d4,
      emissive: 0x06b6d4,
      emissiveIntensity: 1.6,
      roughness: 0.2,
    }),
  );
  const irLens = new THREE.Mesh(track(new THREE.SphereGeometry(0.05, 10, 10)), irLedMat);
  irLens.position.set(5.33, 0.86, 0);
  cabGroup.add(irLens);

  const irBeamGeo = track(new THREE.ConeGeometry(1.45, 11.5, 16, 1, true));
  irBeamGeo.translate(0, -5.75, 0);
  irBeamGeo.rotateZ(Math.PI / 2);
  const irBeamMat = track(
    new THREE.MeshBasicMaterial({
      color: 0x22d3ee,
      transparent: true,
      opacity: 0.08,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  const irBeamMesh = new THREE.Mesh(irBeamGeo, irBeamMat);
  irBeamMesh.position.set(5.34, 0.86, 0);
  irBeamMesh.visible = enableIrAndTorch;
  cabGroup.add(irBeamMesh);

  [-0.75, -0.38, 0, 0.38, 0.75].forEach((z) => {
    const cl = new THREE.Mesh(track(new THREE.BoxGeometry(0.1, 0.06, 0.12)), amberMarkerMat);
    cl.position.set(3.62, 3.23, z);
    cabGroup.add(cl);
  });

  [-1.34, 1.34].forEach((z) => {
    const sign = Math.sign(z);
    const mirrorHousing = new THREE.Mesh(
      track(new THREE.BoxGeometry(0.14, 0.42, 0.18)),
      chromeMat,
    );
    mirrorHousing.position.set(3.52, 2.58, z);
    cabGroup.add(mirrorHousing);

    const arm = new THREE.Mesh(
      track(new THREE.CylinderGeometry(0.025, 0.025, 0.26, 8)),
      chassisSteelMat,
    );
    arm.rotation.x = Math.PI / 2;
    arm.position.set(3.52, 2.66, z - sign * 0.12);
    cabGroup.add(arm);
  });

  [-1.02, 1.02].forEach((z) => {
    const tank = new THREE.Mesh(
      track(new THREE.CylinderGeometry(0.28, 0.28, 1.25, 14)),
      brushedAluminumMat,
    );
    tank.rotation.z = Math.PI / 2;
    tank.position.set(3.15, 0.74, z);
    cabGroup.add(tank);
  });

  const exhaust = new THREE.Mesh(
    track(new THREE.CylinderGeometry(0.07, 0.07, 2.4, 10)),
    chromeMat,
  );
  exhaust.position.set(2.16, 2.62, -1.16);
  cabGroup.add(exhaust);

  // --- 4. Refrigerated Trailer Box ---
  const trailerGroup = new THREE.Group();
  root.add(trailerGroup);

  const trLen = 7.2;
  const trCenterX = -1.5;
  const floorY = 1.24;
  const ceilY = 3.78;
  const trHeight = ceilY - floorY;
  const trMidY = (floorY + ceilY) * 0.5;

  const floorMesh = new THREE.Mesh(
    track(new THREE.BoxGeometry(trLen, 0.14, 2.5)),
    brushedAluminumMat,
  );
  floorMesh.position.set(trCenterX, 1.17, 0);
  floorMesh.castShadow = true;
  floorMesh.receiveShadow = true;
  trailerGroup.add(floorMesh);

  const innerFloor = new THREE.Mesh(
    track(new THREE.BoxGeometry(trLen - 0.14, 0.02, 2.28)),
    chassisSteelMat,
  );
  innerFloor.position.set(trCenterX, 1.25, 0);
  innerFloor.receiveShadow = true;
  trailerGroup.add(innerFloor);

  const roofMesh = new THREE.Mesh(
    track(new THREE.BoxGeometry(trLen, 0.14, 2.5)),
    trailerWhiteMat,
  );
  roofMesh.position.set(trCenterX, 3.85, 0);
  roofMesh.castShadow = true;
  trailerGroup.add(roofMesh);

  const interiorStripMat = track(
    new THREE.MeshStandardMaterial({
      color: 0xe0f2fe,
      emissive: 0x38bdf8,
      emissiveIntensity: 1.35,
      roughness: 0.2,
    }),
  );
  const ceilingStrip = new THREE.Mesh(
    track(new THREE.BoxGeometry(6.2, 0.04, 0.18)),
    interiorStripMat,
  );
  ceilingStrip.position.set(trCenterX, 3.76, 0);
  trailerGroup.add(ceilingStrip);

  const interiorLight = new THREE.PointLight(0x7dd3fc, enablePointLights ? 2.2 : 0, 8.5, 1.4);
  interiorLight.position.set(-1.3, 3.35, 0.2);
  if (enablePointLights) {
    trailerGroup.add(interiorLight);
  }

  const frontWall = new THREE.Mesh(
    track(new THREE.BoxGeometry(0.12, trHeight, 2.5)),
    trailerWhiteMat,
  );
  frontWall.position.set(2.04, trMidY, 0);
  frontWall.castShadow = true;
  trailerGroup.add(frontWall);

  const liveryTextures: Record<IndustryId, THREE.CanvasTexture> = {
    vaccines: track(createLiveryTexture(maxAnisotropy, 'vaccines')),
    food: track(createLiveryTexture(maxAnisotropy, 'food')),
    dairy: track(createLiveryTexture(maxAnisotropy, 'dairy')),
    blood: track(createLiveryTexture(maxAnisotropy, 'blood')),
    seafood: track(createLiveryTexture(maxAnisotropy, 'seafood')),
    chemical: track(createLiveryTexture(maxAnisotropy, 'chemical')),
  };

  const liveryMat = track(
    new THREE.MeshStandardMaterial({
      map: liveryTextures.vaccines,
      roughness: 0.4,
      metalness: 0.12,
    }),
  );

  const leftWall = new THREE.Mesh(
    track(new THREE.BoxGeometry(trLen, trHeight, 0.1)),
    [
      trailerWhiteMat,
      trailerWhiteMat,
      trailerWhiteMat,
      trailerWhiteMat,
      trailerInteriorMat,
      liveryMat,
    ],
  );
  leftWall.position.set(trCenterX, trMidY, -1.2);
  leftWall.castShadow = true;
  trailerGroup.add(leftWall);

  const rightFrameFront = new THREE.Mesh(
    track(new THREE.BoxGeometry(0.28, trHeight, 0.1)),
    brushedAluminumMat,
  );
  rightFrameFront.position.set(1.96, trMidY, 1.2);
  trailerGroup.add(rightFrameFront);

  const rightFrameRear = new THREE.Mesh(
    track(new THREE.BoxGeometry(0.28, trHeight, 0.1)),
    brushedAluminumMat,
  );
  rightFrameRear.position.set(-4.96, trMidY, 1.2);
  trailerGroup.add(rightFrameRear);

  const rightFrameBottom = new THREE.Mesh(
    track(new THREE.BoxGeometry(trLen - 0.56, 0.16, 0.1)),
    brushedAluminumMat,
  );
  rightFrameBottom.position.set(trCenterX, 1.32, 1.2);
  trailerGroup.add(rightFrameBottom);

  const rightFrameTop = new THREE.Mesh(
    track(new THREE.BoxGeometry(trLen - 0.56, 0.16, 0.1)),
    brushedAluminumMat,
  );
  rightFrameTop.position.set(trCenterX, 3.7, 1.2);
  trailerGroup.add(rightFrameTop);

  const dotTex = track(createDotStripingTexture(maxAnisotropy));
  const dotTapeMat = track(
    new THREE.MeshStandardMaterial({ map: dotTex, roughness: 0.35, metalness: 0.2 }),
  );
  const dotStripRight = new THREE.Mesh(
    track(new THREE.BoxGeometry(trLen - 0.1, 0.08, 0.02)),
    dotTapeMat,
  );
  dotStripRight.position.set(trCenterX, 1.16, 1.26);
  trailerGroup.add(dotStripRight);

  const cutawaySolidWall = new THREE.Mesh(
    track(new THREE.BoxGeometry(trLen - 0.56, trHeight - 0.32, 0.09)),
    [
      trailerWhiteMat,
      trailerWhiteMat,
      trailerWhiteMat,
      trailerWhiteMat,
      liveryMat,
      trailerInteriorMat,
    ],
  );
  cutawaySolidWall.position.set(trCenterX, trMidY, 1.2);
  cutawaySolidWall.castShadow = true;
  cutawaySolidWall.visible = false;
  trailerGroup.add(cutawaySolidWall);

  const cutawayAcrylicPanel = new THREE.Mesh(
    track(new THREE.PlaneGeometry(trLen - 0.58, trHeight - 0.34)),
    track(
      new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.045,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    ),
  );
  cutawayAcrylicPanel.position.set(trCenterX, trMidY, 1.22);
  cutawayAcrylicPanel.renderOrder = 4;
  trailerGroup.add(cutawayAcrylicPanel);

  // --- 5. Front Reefer Cooling Unit ---
  const reeferGroup = new THREE.Group();
  reeferGroup.position.set(2.36, 3.18, 0);
  trailerGroup.add(reeferGroup);

  const reeferBody = new THREE.Mesh(
    track(new THREE.BoxGeometry(0.56, 1.12, 1.65)),
    trailerWhiteMat,
  );
  reeferBody.castShadow = true;
  reeferGroup.add(reeferBody);

  const reeferGrille = new THREE.Mesh(
    track(new THREE.BoxGeometry(0.06, 0.68, 0.96)),
    chassisSteelMat,
  );
  reeferGrille.position.set(0.28, 0.05, 0);
  reeferGroup.add(reeferGrille);

  const coolingFan = new THREE.Group();
  coolingFan.position.set(0.32, 0.05, 0);
  reeferGroup.add(coolingFan);

  const fanHub = new THREE.Mesh(
    track(new THREE.CylinderGeometry(0.08, 0.08, 0.05, 12)),
    brushedAluminumMat,
  );
  fanHub.rotation.z = Math.PI / 2;
  coolingFan.add(fanHub);

  const bladeGeo = track(new THREE.BoxGeometry(0.02, 0.24, 0.07));
  for (let i = 0; i < 6; i++) {
    const blade = new THREE.Mesh(bladeGeo, brushedAluminumMat);
    const angle = (i / 6) * Math.PI * 2;
    blade.position.set(0, Math.cos(angle) * 0.16, Math.sin(angle) * 0.16);
    blade.rotation.x = angle;
    blade.rotation.y = 0.35;
    coolingFan.add(blade);
  }

  const reeferStatusMat = track(
    new THREE.MeshStandardMaterial({
      color: 0x0ea5e9,
      emissive: 0x38bdf8,
      emissiveIntensity: 1.6,
      roughness: 0.2,
    }),
  );
  const reeferLedBar = new THREE.Mesh(
    track(new THREE.BoxGeometry(0.06, 0.08, 1.35)),
    reeferStatusMat,
  );
  reeferLedBar.position.set(0.29, -0.4, 0);
  reeferGroup.add(reeferLedBar);

  // --- 6. Rear Doors & Magnetic Reed Tamper Sensor ---
  const doorHeight = trHeight - 0.04;
  const doorWidth = 1.2;

  const leftDoorPivot = new THREE.Group();
  leftDoorPivot.position.set(-5.08, trMidY, -1.2);
  trailerGroup.add(leftDoorPivot);

  const leftDoorPanel = new THREE.Mesh(
    track(new THREE.BoxGeometry(0.08, doorHeight, doorWidth)),
    trailerWhiteMat,
  );
  leftDoorPanel.position.set(0, 0, doorWidth * 0.5);
  leftDoorPanel.castShadow = true;
  leftDoorPivot.add(leftDoorPanel);

  const leftLockRod = new THREE.Mesh(
    track(new THREE.CylinderGeometry(0.022, 0.022, doorHeight - 0.2, 8)),
    chromeMat,
  );
  leftLockRod.position.set(-0.06, 0, doorWidth - 0.18);
  leftDoorPivot.add(leftLockRod);

  const leftTaillight = new THREE.Mesh(
    track(new THREE.BoxGeometry(0.05, 0.14, 0.32)),
    taillightMat,
  );
  leftTaillight.position.set(-0.05, -doorHeight * 0.42, 0.24);
  leftDoorPivot.add(leftTaillight);

  const rightDoorPivot = new THREE.Group();
  rightDoorPivot.position.set(-5.08, trMidY, 1.2);
  trailerGroup.add(rightDoorPivot);

  const rightDoorPanel = new THREE.Mesh(
    track(new THREE.BoxGeometry(0.08, doorHeight, doorWidth)),
    trailerWhiteMat,
  );
  rightDoorPanel.position.set(0, 0, -doorWidth * 0.5);
  rightDoorPanel.castShadow = true;
  rightDoorPivot.add(rightDoorPanel);

  const rightLockRod = new THREE.Mesh(
    track(new THREE.CylinderGeometry(0.022, 0.022, doorHeight - 0.2, 8)),
    chromeMat,
  );
  rightLockRod.position.set(-0.06, 0, -doorWidth + 0.18);
  rightDoorPivot.add(rightLockRod);

  const rightTaillight = new THREE.Mesh(
    track(new THREE.BoxGeometry(0.05, 0.14, 0.32)),
    taillightMat,
  );
  rightTaillight.position.set(-0.05, -doorHeight * 0.42, -0.24);
  rightDoorPivot.add(rightTaillight);

  const doorMagnetMesh = new THREE.Mesh(
    track(new THREE.BoxGeometry(0.06, 0.08, 0.14)),
    brushedAluminumMat,
  );
  doorMagnetMesh.position.set(0.06, doorHeight * 0.46, -doorWidth + 0.15);
  rightDoorPivot.add(doorMagnetMesh);

  const doorSensorGroup = new THREE.Group();
  doorSensorGroup.position.set(-4.95, 3.68, 0.15);
  trailerGroup.add(doorSensorGroup);

  const reedHousing = new THREE.Mesh(
    track(new THREE.BoxGeometry(0.14, 0.1, 0.18)),
    chassisSteelMat,
  );
  doorSensorGroup.add(reedHousing);

  const doorSensorLedMat = track(
    new THREE.MeshStandardMaterial({
      color: 0x10b981,
      emissive: 0x10b981,
      emissiveIntensity: 1.8,
      roughness: 0.2,
    }),
  );
  const reedLed = new THREE.Mesh(
    track(new THREE.SphereGeometry(0.04, 10, 10)),
    doorSensorLedMat,
  );
  reedLed.position.set(0.06, -0.05, 0.04);
  doorSensorGroup.add(reedLed);

  const wireCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-4.95, 3.68, 0.15),
    new THREE.Vector3(-4.85, 3.72, -0.92),
    new THREE.Vector3(0.55, 3.55, -0.92),
    new THREE.Vector3(0.65, 3.22, -0.92),
  ]);
  const wireMesh = new THREE.Mesh(
    track(new THREE.TubeGeometry(wireCurve, 28, 0.018, 6, false)),
    chassisSteelMat,
  );
  trailerGroup.add(wireMesh);

  // --- 7. 6 Industry Cargos ---
  const palletXs = [-3.85, -2.15, -0.45, 1.15];

  const palletWoodMat = track(
    new THREE.MeshStandardMaterial({ color: 0xb48a5a, roughness: 0.85, metalness: 0.02 }),
  );
  const palletBlueMat = track(
    new THREE.MeshStandardMaterial({ color: 0x1d4ed8, roughness: 0.65, metalness: 0.08 }),
  );
  const palletDarkMat = track(
    new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.7, metalness: 0.12 }),
  );

  function createPalletBase(mat: THREE.Material): THREE.Group {
    const pg = new THREE.Group();
    const topDeck = new THREE.Mesh(track(new THREE.BoxGeometry(1.32, 0.04, 1.56)), mat);
    topDeck.position.y = 0.12;
    pg.add(topDeck);
    [-0.54, 0, 0.54].forEach((x) => {
      const runner = new THREE.Mesh(track(new THREE.BoxGeometry(0.12, 0.1, 1.56)), mat);
      runner.position.set(x, 0.05, 0);
      pg.add(runner);
    });
    return pg;
  }

  const cargoGroups = {} as Record<IndustryId, THREE.Group>;
  const labelMats: Record<IndustryId, THREE.MeshStandardMaterial> = {} as Record<
    IndustryId,
    THREE.MeshStandardMaterial
  >;
  INDUSTRY_LIST.forEach((ind) => {
    labelMats[ind.id] = track(
      new THREE.MeshStandardMaterial({
        map: track(createCrateLabelTexture(maxAnisotropy, ind.id)),
        roughness: 0.4,
      }),
    );
    const cg = new THREE.Group();
    cg.position.set(0, 1.26, 0);
    cg.visible = ind.id === 'vaccines';
    trailerGroup.add(cg);
    cargoGroups[ind.id] = cg;
  });

  // 7.1 Vaccines
  {
    const cg = cargoGroups.vaccines;
    const boxMat = track(new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.38 }));
    const lidMat = track(new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.35 }));
    const glassVialMat = track(
      new THREE.MeshPhysicalMaterial({
        color: 0xbae6fd,
        roughness: 0.08,
        transparent: true,
        opacity: 0.75,
      }),
    );
    const capMat = track(new THREE.MeshStandardMaterial({ color: 0x2563eb, metalness: 0.7, roughness: 0.3 }));
    const vialGeo = track(new THREE.CylinderGeometry(0.036, 0.036, 0.18, 8));
    const capGeo = track(new THREE.CylinderGeometry(0.038, 0.038, 0.04, 8));

    palletXs.forEach((px, idx) => {
      const pallet = createPalletBase(palletBlueMat);
      pallet.position.set(px, 0, -0.05);
      cg.add(pallet);
      const rows = idx === 2 ? 1 : 2;
      for (let r = 0; r < rows; r++) {
        for (const cz of [-0.38, 0.38]) {
          const box = new THREE.Mesh(track(new THREE.BoxGeometry(1.1, 0.62, 0.68)), [
            boxMat,
            boxMat,
            lidMat,
            boxMat,
            labelMats.vaccines,
            boxMat,
          ]);
          box.position.set(px, 0.45 + r * 0.64, cz - 0.05);
          cg.add(box);
        }
      }
      if (idx === 2) {
        const tray = new THREE.Mesh(track(new THREE.BoxGeometry(1.06, 0.16, 0.64)), brushedAluminumMat);
        tray.position.set(px, 0.85, 0.33);
        cg.add(tray);
        for (let vx = -0.38; vx <= 0.38; vx += 0.15) {
          for (let vz = -0.2; vz <= 0.2; vz += 0.13) {
            const vial = new THREE.Mesh(vialGeo, glassVialMat);
            vial.position.set(px + vx, 1.02, 0.33 + vz);
            const cap = new THREE.Mesh(capGeo, capMat);
            cap.position.set(px + vx, 1.12, 0.33 + vz);
            cg.add(vial, cap);
          }
        }
      }
    });
  }

  // 7.2 Food & Beverage
  {
    const cg = cargoGroups.food;
    const cartonMat = track(new THREE.MeshStandardMaterial({ color: 0xfefce8, roughness: 0.4 }));
    const crateMat = track(new THREE.MeshStandardMaterial({ color: 0x15803d, roughness: 0.6 }));
    const appleMat = track(new THREE.MeshStandardMaterial({ color: 0xdc2626, roughness: 0.35 }));
    const orangeMat = track(new THREE.MeshStandardMaterial({ color: 0xf97316, roughness: 0.45 }));
    const greensMat = track(new THREE.MeshStandardMaterial({ color: 0x22c55e, roughness: 0.72 }));
    const fruitGeo = track(new THREE.SphereGeometry(0.075, 8, 8));

    palletXs.forEach((px, idx) => {
      const pallet = createPalletBase(palletWoodMat);
      pallet.position.set(px, 0, -0.05);
      cg.add(pallet);
      for (const cz of [-0.38, 0.38]) {
        const lower = new THREE.Mesh(track(new THREE.BoxGeometry(1.08, 0.56, 0.66)), [
          cartonMat,
          cartonMat,
          cartonMat,
          cartonMat,
          labelMats.food,
          cartonMat,
        ]);
        lower.position.set(px, 0.42, cz - 0.05);
        const upper = new THREE.Mesh(track(new THREE.BoxGeometry(1.06, 0.34, 0.64)), crateMat);
        upper.position.set(px, 0.89, cz - 0.05);
        cg.add(lower, upper);

        const pMat = idx % 3 === 0 ? appleMat : idx % 3 === 1 ? orangeMat : greensMat;
        for (let fx = -0.34; fx <= 0.34; fx += 0.17) {
          for (let fz = -0.18; fz <= 0.18; fz += 0.18) {
            const item = new THREE.Mesh(fruitGeo, pMat);
            item.position.set(px + fx, 1.1, cz - 0.05 + fz);
            cg.add(item);
          }
        }
      }
    });
  }

  // 7.3 Dairy
  {
    const cg = cargoGroups.dairy;
    const milkCrateMat = track(new THREE.MeshStandardMaterial({ color: 0x2563eb, roughness: 0.5 }));
    const whiteCartonMat = track(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35 }));
    const canGeo = track(new THREE.CylinderGeometry(0.14, 0.15, 0.52, 12));

    palletXs.forEach((px, idx) => {
      const pallet = createPalletBase(palletBlueMat);
      pallet.position.set(px, 0, -0.05);
      cg.add(pallet);
      for (const cz of [-0.38, 0.38]) {
        const baseBox = new THREE.Mesh(track(new THREE.BoxGeometry(1.08, 0.55, 0.66)), [
          whiteCartonMat,
          whiteCartonMat,
          milkCrateMat,
          whiteCartonMat,
          labelMats.dairy,
          whiteCartonMat,
        ]);
        baseBox.position.set(px, 0.42, cz - 0.05);
        cg.add(baseBox);

        if (idx === 2 || idx === 1) {
          for (const cx of [-0.3, 0, 0.3]) {
            const can = new THREE.Mesh(canGeo, chromeMat);
            can.position.set(px + cx, 0.96, cz - 0.05);
            cg.add(can);
          }
        } else {
          const topCrate = new THREE.Mesh(track(new THREE.BoxGeometry(1.06, 0.5, 0.64)), milkCrateMat);
          topCrate.position.set(px, 0.96, cz - 0.05);
          cg.add(topCrate);
        }
      }
    });
  }

  // 7.4 Blood Banks
  {
    const cg = cargoGroups.blood;
    const bioCoolerMat = track(new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.32 }));
    const crimsonLidMat = track(new THREE.MeshStandardMaterial({ color: 0xdc2626, roughness: 0.35 }));
    const bloodBagMat = track(new THREE.MeshStandardMaterial({ color: 0x991b1b, roughness: 0.25 }));

    palletXs.forEach((px, idx) => {
      const pallet = createPalletBase(palletDarkMat);
      pallet.position.set(px, 0, -0.05);
      cg.add(pallet);
      for (const cz of [-0.38, 0.38]) {
        const cooler = new THREE.Mesh(track(new THREE.BoxGeometry(1.08, 0.62, 0.66)), [
          bioCoolerMat,
          bioCoolerMat,
          crimsonLidMat,
          bioCoolerMat,
          labelMats.blood,
          bioCoolerMat,
        ]);
        cooler.position.set(px, 0.45, cz - 0.05);
        cg.add(cooler);

        if (idx !== 2) {
          const cooler2 = cooler.clone();
          cooler2.position.set(px, 1.09, cz - 0.05);
          cg.add(cooler2);
        } else if (cz > 0) {
          const tray = new THREE.Mesh(track(new THREE.BoxGeometry(1.02, 0.14, 0.6)), brushedAluminumMat);
          tray.position.set(px, 0.84, cz - 0.05);
          cg.add(tray);
          for (let bx = -0.34; bx <= 0.34; bx += 0.22) {
            const bag = new THREE.Mesh(track(new THREE.BoxGeometry(0.16, 0.08, 0.36)), bloodBagMat);
            bag.position.set(px + bx, 0.95, cz - 0.05);
            cg.add(bag);
          }
        }
      }
    });
  }

  // 7.5 Seafood & Meat
  {
    const cg = cargoGroups.seafood;
    const iceTubMat = track(new THREE.MeshStandardMaterial({ color: 0x0891b2, roughness: 0.45 }));
    const iceBedMat = track(new THREE.MeshStandardMaterial({ color: 0xe0f2fe, roughness: 0.22 }));
    const fishMat = track(new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.65, roughness: 0.25 }));
    const meatMat = track(new THREE.MeshStandardMaterial({ color: 0xb91c1c, roughness: 0.4 }));

    palletXs.forEach((px, idx) => {
      const pallet = createPalletBase(palletBlueMat);
      pallet.position.set(px, 0, -0.05);
      cg.add(pallet);
      for (const cz of [-0.38, 0.38]) {
        const tub = new THREE.Mesh(track(new THREE.BoxGeometry(1.1, 0.56, 0.66)), [
          iceTubMat,
          iceTubMat,
          iceBedMat,
          iceTubMat,
          labelMats.seafood,
          iceTubMat,
        ]);
        tub.position.set(px, 0.42, cz - 0.05);
        cg.add(tub);

        const openTub = new THREE.Mesh(track(new THREE.BoxGeometry(1.06, 0.3, 0.62)), iceTubMat);
        openTub.position.set(px, 0.86, cz - 0.05);
        cg.add(openTub);

        const mat = idx % 2 === 0 ? fishMat : meatMat;
        for (const fx of [-0.28, 0.05, 0.32]) {
          const item = new THREE.Mesh(track(new THREE.CapsuleGeometry(0.06, 0.24, 4, 8)), mat);
          item.rotation.z = Math.PI / 2;
          item.position.set(px + fx, 1.04, cz - 0.05);
          cg.add(item);
        }
      }
    });
  }

  // 7.6 Chemical & Lab
  {
    const cg = cargoGroups.chemical;
    const drumMat = track(new THREE.MeshStandardMaterial({ color: 0x6d28d9, roughness: 0.35, metalness: 0.55 }));
    const chemBoxMat = track(new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.4 }));
    const drumGeo = track(new THREE.CylinderGeometry(0.24, 0.24, 0.72, 14));

    palletXs.forEach((px, idx) => {
      const pallet = createPalletBase(palletDarkMat);
      pallet.position.set(px, 0, -0.05);
      cg.add(pallet);

      if (idx % 2 === 0) {
        for (const dx of [-0.32, 0.32]) {
          for (const dz of [-0.34, 0.34]) {
            const drum = new THREE.Mesh(drumGeo, drumMat);
            drum.position.set(px + dx, 0.5, dz - 0.05);
            cg.add(drum);
          }
        }
      } else {
        for (const cz of [-0.38, 0.38]) {
          const box = new THREE.Mesh(track(new THREE.BoxGeometry(1.08, 0.64, 0.66)), [
            chemBoxMat,
            chemBoxMat,
            drumMat,
            chemBoxMat,
            labelMats.chemical,
            chemBoxMat,
          ]);
          box.position.set(px, 0.46, cz - 0.05);
          cg.add(box);
        }
      }
    });
  }

  // Cold Vapor Mist
  const mistCount = 80;
  const mistPositions = new Float32Array(mistCount * 3);
  for (let i = 0; i < mistCount; i++) {
    mistPositions[i * 3] = -4.6 + Math.random() * 6.4;
    mistPositions[i * 3 + 1] = 1.5 + Math.random() * 2.1;
    mistPositions[i * 3 + 2] = -0.95 + Math.random() * 1.9;
  }
  const mistGeo = track(new THREE.BufferGeometry());
  mistGeo.setAttribute('position', new THREE.BufferAttribute(mistPositions, 3));
  const coldMistMaterial = track(
    new THREE.PointsMaterial({
      color: 0xbae6fd,
      size: 0.14,
      transparent: true,
      opacity: 0.36,
      depthWrite: false,
    }),
  );
  const coldMistPoints = new THREE.Points(mistGeo, coldMistMaterial);
  trailerGroup.add(coldMistPoints);

  // --- 8. Internal IoT Sensor Node ---
  const nodeGroup = new THREE.Group();
  nodeGroup.position.set(0.65, 3.16, -0.88);
  nodeGroup.rotation.y = 0.22;
  trailerGroup.add(nodeGroup);

  nodeGroup.add(
    new THREE.Mesh(
      track(new THREE.BoxGeometry(0.38, 0.44, 0.18)),
      track(new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.38, metalness: 0.45 })),
    ),
  );

  const nodeFaceplate = new THREE.Mesh(
    track(new THREE.BoxGeometry(0.32, 0.36, 0.03)),
    track(new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.3, metalness: 0.6 })),
  );
  nodeFaceplate.position.z = 0.09;
  nodeGroup.add(nodeFaceplate);

  const probeStem = new THREE.Mesh(
    track(new THREE.CylinderGeometry(0.018, 0.012, 0.26, 8)),
    chromeMat,
  );
  probeStem.position.set(-0.08, -0.32, 0.03);
  nodeGroup.add(probeStem);

  const nodeAntenna = new THREE.Mesh(
    track(new THREE.CylinderGeometry(0.016, 0.022, 0.34, 8)),
    chassisSteelMat,
  );
  nodeAntenna.position.set(0.11, 0.36, 0.02);
  nodeGroup.add(nodeAntenna);

  const nodeLedMat = track(
    new THREE.MeshStandardMaterial({
      color: 0x10b981,
      emissive: 0x10b981,
      emissiveIntensity: 2.2,
      roughness: 0.15,
    }),
  );
  const nodeLedDome = new THREE.Mesh(track(new THREE.SphereGeometry(0.055, 12, 12)), nodeLedMat);
  nodeLedDome.position.set(0, 0.08, 0.11);
  nodeGroup.add(nodeLedDome);

  const nodeTxRing = new THREE.Mesh(
    track(new THREE.RingGeometry(0.05, 0.085, 22)),
    track(
      new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.0,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    ),
  );
  nodeTxRing.position.set(0.11, 0.48, 0.02);
  nodeTxRing.rotation.x = Math.PI / 2;
  nodeGroup.add(nodeTxRing);

  // --- 9. External IoT Gateway ---
  const gatewayGroup = new THREE.Group();
  gatewayGroup.position.set(2.14, 3.48, 1.38);
  trailerGroup.add(gatewayGroup);

  const gwBracket = new THREE.Mesh(
    track(new THREE.BoxGeometry(0.28, 0.22, 0.16)),
    brushedAluminumMat,
  );
  gwBracket.position.set(0, 0, -0.1);
  gatewayGroup.add(gwBracket);

  gatewayGroup.add(
    new THREE.Mesh(
      track(new THREE.BoxGeometry(0.42, 0.34, 0.22)),
      track(new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.32, metalness: 0.78 })),
    ),
  );

  [-0.12, 0.12].forEach((xOff) => {
    const whip = new THREE.Mesh(
      track(new THREE.CylinderGeometry(0.015, 0.024, 0.62, 8)),
      chassisSteelMat,
    );
    whip.position.set(xOff, 0.46, 0);
    gatewayGroup.add(whip);
  });

  const gatewayLedMat = track(
    new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      emissive: 0x38bdf8,
      emissiveIntensity: 2.0,
      roughness: 0.2,
    }),
  );
  const gwLed = new THREE.Mesh(track(new THREE.SphereGeometry(0.045, 10, 10)), gatewayLedMat);
  gwLed.position.set(0.1, 0, 0.12);
  gatewayGroup.add(gwLed);

  const gatewayRxRing = new THREE.Mesh(
    track(new THREE.RingGeometry(0.18, 0.24, 24)),
    track(
      new THREE.MeshBasicMaterial({
        color: 0x10b981,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    ),
  );
  gatewayRxRing.position.set(0, 0.45, 0);
  gatewayRxRing.rotation.x = Math.PI / 2;
  gatewayGroup.add(gatewayRxRing);

  const gatewayBeaconMat = track(
    new THREE.MeshStandardMaterial({
      color: 0x64748b,
      emissive: 0x000000,
      emissiveIntensity: 0,
      roughness: 0.15,
    }),
  );
  const gwBeacon = new THREE.Mesh(
    track(new THREE.CylinderGeometry(0.06, 0.075, 0.13, 12)),
    gatewayBeaconMat,
  );
  gwBeacon.position.set(0, 0.23, 0);
  gatewayGroup.add(gwBeacon);

  const gatewayBeaconLight = new THREE.PointLight(0xef4444, 0, isSoftwareGl ? 5 : 9, 1.5);
  gatewayBeaconLight.position.set(0, 0.38, 0.15);
  if (enablePointLights) {
    gatewayGroup.add(gatewayBeaconLight);
  }

  // --- 10. Anchors ---
  const anchorNode = new THREE.Object3D();
  anchorNode.position.set(0.11, 0.52, 0.02);
  nodeGroup.add(anchorNode);

  const anchorGateway = new THREE.Object3D();
  anchorGateway.position.set(0, 0.72, 0);
  gatewayGroup.add(anchorGateway);

  const anchorCargo = new THREE.Object3D();
  anchorCargo.position.set(-0.45, 2.55, 0.35);
  trailerGroup.add(anchorCargo);

  const anchorDoorSensor = new THREE.Object3D();
  anchorDoorSensor.position.set(0, 0.08, 0);
  doorSensorGroup.add(anchorDoorSensor);

  const anchorIrSensor = new THREE.Object3D();
  anchorIrSensor.position.set(5.4, 1.15, 0);
  cabGroup.add(anchorIrSensor);

  function updateCargoVisuals(industry: IndustryId): void {
    INDUSTRY_LIST.forEach((ind) => {
      cargoGroups[ind.id].visible = ind.id === industry;
    });
    liveryMat.map = liveryTextures[industry];
    liveryMat.needsUpdate = true;
  }

  function dispose(): void {
    disposables.forEach((d) => d.dispose());
  }

  return {
    root,
    cabGroup,
    trailerGroup,
    wheels,
    coolingFan,
    leftDoorPivot,
    rightDoorPivot,
    cutawaySolidWall,
    cutawayAcrylicPanel,
    cargoGroups,
    coldMistPoints,
    coldMistMaterial,
    torchConeMeshes,
    torchConeMats,
    torchSpotLight,
    headlightMat,
    taillightMat,
    irBeamMesh,
    irBeamMat,
    irLedMat,
    nodeGroup,
    nodeLedMat,
    nodeTxRing,
    gatewayGroup,
    gatewayLedMat,
    gatewayRxRing,
    gatewayBeaconMat,
    gatewayBeaconLight,
    doorSensorLedMat,
    interiorStripMat,
    interiorLight,
    reeferStatusMat,
    gpsBeaconRing,
    anchorNode,
    anchorGateway,
    anchorCargo,
    anchorDoorSensor,
    anchorIrSensor,
    updateCargoVisuals,
    dispose,
  };
}
