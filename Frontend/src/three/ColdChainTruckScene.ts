import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  createAsphaltTexture,
  createBuildingFacadeTexture,
  createContactShadowTexture,
  createContainerWallTexture,
  createGatewayScreenTexture,
  createHighwayGantryTexture,
  createPharmaCrateTexture,
} from './proceduralTextures';
export type DoorState = 'open' | 'closed' | 'open_authorized' | 'closed_sealed';
export type TemperatureBand = 'optimal' | 'warning' | 'above_critical' | 'below_critical';
export type TrafficDensity = 'low' | 'moderate' | 'heavy';

export type CameraPresetId = 'overview' | 'node' | 'cabin' | 'doors';

export interface SceneVisualState {
  callsign: string;
  accentHex: number;
  temperatureC: number | null;
  tempBand: TemperatureBand;
  doorState: DoorState;
  compressorActive: boolean;
  cutawayEnabled: boolean;
  isAlertActive: boolean;
  isDoorTampered: boolean;
  cameraPreset: CameraPresetId;
  vehicleMoving: boolean;
  speedKmh: number;
  trafficDensity: TrafficDensity;
}

export interface SceneCallbacks {
  onDoorClick: () => void;
  onSelectFocus: (preset: CameraPresetId) => void;
  onWebGLReady?: (info: { isSoftwareGl: boolean }) => void;
  onWebGLError?: () => void;
}

interface CameraPreset {
  position: THREE.Vector3;
  target: THREE.Vector3;
}

// 3x larger than the prior 5x rig (= 15x unit rig) for bold presence in panoramic view
const TRUCK_SCALE = 15;
const HERO_WHEEL_WORLD_RADIUS = 0.48 * TRUCK_SCALE; // 7.2 units
// 10x expanded panoramic world & scrolling city loop
const ROAD_LOOP_SPAN = 1800;
const ROAD_HALF_SPAN = ROAD_LOOP_SPAN / 2;

const CAMERA_PRESETS: Record<CameraPresetId, CameraPreset> = {
  overview: {
    position: new THREE.Vector3(128, 162, 425),
    target: new THREE.Vector3(-15, 34, -55),
  },
  node: {
    position: new THREE.Vector3(27, 36, 66),
    target: new THREE.Vector3(13.5, 30, -5.25),
  },
  cabin: {
    position: new THREE.Vector3(-84, 36, 63),
    target: new THREE.Vector3(-39.75, 27, 0.75),
  },
  doors: {
    position: new THREE.Vector3(132, 39, 60),
    target: new THREE.Vector3(61.5, 24, 0),
  },
};

interface TrafficVehicleRuntime {
  group: THREE.Group;
  wheels: THREE.Group[];
  brakeLightMat: THREE.MeshStandardMaterial;
  laneZ: number;
  cruiseKmh: number;
  wheelRadius: number;
  x: number;
  minTrafficTier: 0 | 1 | 2;
}

// Reusable scratch math objects (zero GC in render loop)
const _scratchVec = new THREE.Vector3();
const _scratchColor = new THREE.Color();
const _normalLinkColor = new THREE.Color(0x0ea5e9);
const _warnLinkColor = new THREE.Color(0xf59e0b);
const _alertLinkColor = new THREE.Color(0xef4444);
const _emeraldLed = new THREE.Color(0x10b981);
const _iceBlueGlow = new THREE.Color(0xbae6fd);
const _freezeBlueGlow = new THREE.Color(0x38bdf8);
const _heatRedGlow = new THREE.Color(0xf87171);

function detectSoftwareGl(): boolean {
  try {
    const probeCanvas = document.createElement('canvas');
    const gl = probeCanvas.getContext('webgl2');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param) || '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return true;
  }
}

export class ColdChainTruckScene {
  private container: HTMLElement;
  private callbacks: SceneCallbacks;
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private controls!: OrbitControls;
  private isSoftwareGl = false;

  private frameId = 0;
  private disposed = false;
  private isPaused = false;
  private lastTickMs = 0;
  private elapsedSec = 0;
  private frameCount = 0;
  private fpsTimer = 0;
  private isQualitySteppedDown = false;

  private visualState: SceneVisualState;
  private cameraTransitionActive = false;
  private targetCamPos = new THREE.Vector3().copy(CAMERA_PRESETS.overview.position);
  private targetLookAt = new THREE.Vector3().copy(CAMERA_PRESETS.overview.target);

  // Hero 3x/15x Truck references
  private truckGroup!: THREE.Group;
  private cabAccentMat!: THREE.MeshStandardMaterial;
  private heroWheels: THREE.Group[] = [];
  private leftDoorPivot!: THREE.Group;
  private rightDoorPivot!: THREE.Group;
  private currentDoorAngle = 0;

  private cutawayWallMesh!: THREE.Mesh;
  private cutawayGlassMesh!: THREE.Mesh;
  private coolingFanGroup!: THREE.Group;
  private cargoInteriorLight!: THREE.PointLight;
  private cargoThermalOverlayMat!: THREE.MeshBasicMaterial;

  private nodeLedMat!: THREE.MeshStandardMaterial;
  private nodeHaloMat!: THREE.MeshBasicMaterial;
  private gatewayBeaconMat!: THREE.MeshStandardMaterial;
  private doorSensorLedMat!: THREE.MeshStandardMaterial;
  private gatewayScreen!: ReturnType<typeof createGatewayScreenTexture>;
  private lastDrawnTemp: number | null = NaN;
  private lastDrawnCritical = false;
  private lastDrawnTampered = false;
  private lastDrawnCallsign = '';

  private rfCurve!: THREE.CatmullRomCurve3;
  private rfTubeMat!: THREE.MeshStandardMaterial;
  private rfPulseMeshes: THREE.Mesh[] = [];
  private rfPulseMat!: THREE.MeshBasicMaterial;

  // Moving Hyderabad expressway, buildings, accidents, police & 5x traffic
  private asphaltTex!: THREE.CanvasTexture;
  private scrollingProps: THREE.Object3D[] = [];
  private trafficVehicles: TrafficVehicleRuntime[] = [];
  private policeRedMats: THREE.MeshStandardMaterial[] = [];
  private policeBlueMats: THREE.MeshStandardMaterial[] = [];
  private hazardLightMats: THREE.MeshStandardMaterial[] = [];

  // Shared traffic vehicle materials
  private sharedTireMat!: THREE.MeshStandardMaterial;
  private sharedRimMat!: THREE.MeshStandardMaterial;
  private sharedCabinGlassMat!: THREE.MeshStandardMaterial;
  private sharedHeadLightMat!: THREE.MeshStandardMaterial;

  // Raycasting
  private raycaster = new THREE.Raycaster();
  private pointerVec = new THREE.Vector2();
  private interactables: THREE.Object3D[] = [];
  private pointerDownPos = { x: 0, y: 0 };

  // Disposable asset tracking
  private geometries: THREE.BufferGeometry[] = [];
  private materials: THREE.Material[] = [];
  private textures: THREE.Texture[] = [];
  private resizeObserver: ResizeObserver | null = null;

  constructor(
    container: HTMLElement,
    initialState: SceneVisualState,
    callbacks: SceneCallbacks
  ) {
    this.container = container;
    this.visualState = { ...initialState };
    this.callbacks = callbacks;
    this.init();
  }

  private trackGeo<T extends THREE.BufferGeometry>(geo: T): T {
    this.geometries.push(geo);
    return geo;
  }

  private trackMat<T extends THREE.Material>(mat: T): T {
    this.materials.push(mat);
    return mat;
  }

  private trackTex<T extends THREE.Texture>(tex: T): T {
    this.textures.push(tex);
    return tex;
  }

  private init(): void {
    this.isSoftwareGl = detectSoftwareGl();

    try {
      this.renderer = new THREE.WebGLRenderer({
        antialias: !this.isSoftwareGl,
        powerPreference: 'high-performance',
        preserveDrawingBuffer: true,
      });
    } catch {
      this.callbacks.onWebGLError?.();
      return;
    }

    const width = Math.max(this.container.clientWidth, 260);
    const height = Math.max(this.container.clientHeight, 240);

    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.setPixelRatio(
      this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, (typeof navigator !== "undefined" && /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent)) ? 1.5 : 2.0)
    );
    this.renderer.setSize(width, height);
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.renderer.domElement.setAttribute('data-testid', 'coldchain-canvas');
    this.renderer.domElement.setAttribute('role', 'img');
    this.renderer.domElement.setAttribute('aria-label', `TracX 3D Digital Twin - ${this.visualState.callsign}`);
    this.renderer.domElement.style.touchAction = 'none';

    this.container.appendChild(this.renderer.domElement);


    this.scene = new THREE.Scene();
    const skyColor = 0xe3ecf4;
    this.scene.background = new THREE.Color(skyColor);
    this.scene.fog = new THREE.Fog(skyColor, 580, 1780);

    const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
    const roomEnv = new RoomEnvironment();
    this.scene.environment = pmremGenerator.fromScene(roomEnv, 0.04).texture;
    roomEnv.dispose();
    pmremGenerator.dispose();

    this.camera = new THREE.PerspectiveCamera(48, width / height, 1.5, 2800);
    this.camera.position.copy(CAMERA_PRESETS.overview.position);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = !this.isSoftwareGl;
    this.controls.dampingFactor = 0.07;
    this.controls.target.copy(CAMERA_PRESETS.overview.target);
    this.controls.minDistance = 40;
    this.controls.maxDistance = 680;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.04;
    this.controls.minPolarAngle = 0.12;
    this.controls.update();

    this.controls.addEventListener('start', () => {
      this.cameraTransitionActive = false;
    });

    this.initSharedTrafficMaterials();
    this.setupLighting();
    this.buildHyderabadEnvironment();
    this.buildTruck();
    this.buildTrafficFleet();
    this.buildAccidentsAndPoliceCheckposts();
    this.applyVisualStateToScene(0);

    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
    }

    this.bindEvents();
    this.callbacks.onWebGLReady?.({ isSoftwareGl: this.isSoftwareGl });
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.lastTickMs = performance.now();
    this.tick();
  }

  private initSharedTrafficMaterials(): void {
    this.sharedTireMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x1e293b,
        roughness: 0.88,
        metalness: 0.05,
      })
    );
    this.sharedRimMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xcbd5e1,
        roughness: 0.25,
        metalness: 0.85,
      })
    );
    this.sharedCabinGlassMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x1e293b,
        roughness: 0.14,
        metalness: 0.4,
      })
    );
    this.sharedHeadLightMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xfef9c3,
        emissive: 0xfef08a,
        emissiveIntensity: 0.9,
      })
    );
  }

  private setupLighting(): void {
    const hemiLight = new THREE.HemisphereLight(0xdbeafe, 0x64748b, 0.92);
    hemiLight.position.set(0, 260, 0);
    this.scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfff7ed, 2.2);
    keyLight.position.set(140, 240, 170);
    keyLight.castShadow = !this.isSoftwareGl;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.camera.near = 20;
    keyLight.shadow.camera.far = 720;
    keyLight.shadow.camera.left = -220;
    keyLight.shadow.camera.right = 220;
    keyLight.shadow.camera.top = 180;
    keyLight.shadow.camera.bottom = -180;
    keyLight.shadow.bias = -0.0005;
    keyLight.shadow.normalBias = 0.02;
    this.scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x93c5fd, 0.85);
    rimLight.position.set(-160, 110, -140);
    this.scene.add(rimLight);
  }

  private buildHyderabadEnvironment(): void {
    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();
    this.asphaltTex = this.trackTex(createAsphaltTexture(maxAniso));
    this.asphaltTex.repeat.set(42, 8);

    // Panoramic Hyderabad valley ground base
    const landscapeGeo = this.trackGeo(new THREE.PlaneGeometry(2600, 2600));
    const landscapeMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xcbd5e1,
        roughness: 0.95,
        metalness: 0.02,
      })
    );
    const landscape = new THREE.Mesh(landscapeGeo, landscapeMat);
    landscape.rotation.x = -Math.PI / 2;
    landscape.position.y = -0.12;
    landscape.receiveShadow = true;
    this.scene.add(landscape);

    // 5-Lane PVNR / ORR Hyderabad Expressway tarmac deck (300 units wide)
    const roadGeo = this.trackGeo(new THREE.PlaneGeometry(2200, 300));
    const roadMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: this.asphaltTex,
        roughness: 0.86,
        metalness: 0.05,
      })
    );
    const road = new THREE.Mesh(roadGeo, roadMat);
    road.rotation.x = -Math.PI / 2;
    road.position.y = 0;
    road.receiveShadow = true;
    this.scene.add(road);

    // Continuous highway edge lines
    const shoulderYellowMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xfacc15,
        roughness: 0.65,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      })
    );
    const laneWhiteMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xf8fafc,
        roughness: 0.65,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      })
    );

    const edgeGeo = this.trackGeo(new THREE.PlaneGeometry(2200, 2.2));
    for (const zPos of [-138, 138]) {
      const edge = new THREE.Mesh(
        edgeGeo,
        zPos < 0 ? shoulderYellowMat : laneWhiteMat
      );
      edge.rotation.x = -Math.PI / 2;
      edge.position.set(0, 0.06, zPos);
      this.scene.add(edge);
    }

    // Concrete jersey barriers flanking the 5-lane expressway
    const barrierGeo = this.trackGeo(new THREE.BoxGeometry(2200, 7.5, 4.5));
    const barrierMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x94a3b8,
        roughness: 0.85,
        metalness: 0.06,
      })
    );
    for (const zSign of [-1, 1]) {
      const barrier = new THREE.Mesh(barrierGeo, barrierMat);
      barrier.position.set(0, 3.6, zSign * 152);
      barrier.receiveShadow = true;
      this.scene.add(barrier);
    }

    // Scrolling dashed lane dividers separating 5 lanes (-102, -54, 0, +54, +100)
    const dashGeo = this.trackGeo(new THREE.PlaneGeometry(24, 1.8));
    const dashCountPerLane = 22;
    const dashStep = ROAD_LOOP_SPAN / dashCountPerLane;
    const dividerZs = [-78, -28, 28, 77];

    for (let i = 0; i < dashCountPerLane; i++) {
      const xPos = -ROAD_HALF_SPAN + i * dashStep;
      for (const laneZ of dividerZs) {
        const dash = new THREE.Mesh(dashGeo, laneWhiteMat);
        dash.rotation.x = -Math.PI / 2;
        dash.position.set(xPos, 0.08, laneZ);
        this.scene.add(dash);
        this.scrollingProps.push(dash);
      }
    }

    // Scrolling Highway Streetlamps + Overhead PVNR Expressway Gantry Signs
    const poleMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x64748b,
        roughness: 0.35,
        metalness: 0.8,
      })
    );
    const lampGlowMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xfef9c3,
        emissive: 0xfef08a,
        emissiveIntensity: 0.85,
      })
    );
    const gantryTex = this.trackTex(createHighwayGantryTexture(maxAniso));
    const gantrySignMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        map: gantryTex,
        roughness: 0.45,
        metalness: 0.1,
      })
    );

    const poleGeo = this.trackGeo(new THREE.CylinderGeometry(0.9, 1.3, 44, 8));
    const armGeo = this.trackGeo(new THREE.BoxGeometry(1.2, 1.2, 14));
    const headGeo = this.trackGeo(new THREE.BoxGeometry(2.6, 0.9, 4.5));

    const gantryPostGeo = this.trackGeo(new THREE.CylinderGeometry(2.0, 2.5, 92, 10));
    const gantryBeamGeo = this.trackGeo(new THREE.BoxGeometry(4.0, 4.0, 195));
    const gantryBoardGeo = this.trackGeo(new THREE.BoxGeometry(2.0, 20, 86));

    const lampCount = 12;
    const lampSpacing = ROAD_LOOP_SPAN / lampCount;

    for (let i = 0; i < lampCount; i++) {
      const xPos = -ROAD_HALF_SPAN + i * lampSpacing;

      const lampGroup = new THREE.Group();
      lampGroup.position.set(xPos, 0, -158);
      const pole = new THREE.Mesh(poleGeo, poleMat);
      pole.position.y = 22;
      lampGroup.add(pole);
      const arm = new THREE.Mesh(armGeo, poleMat);
      arm.position.set(0, 43.5, 6);
      lampGroup.add(arm);
      const head = new THREE.Mesh(headGeo, lampGlowMat);
      head.position.set(0, 42.5, 11.5);
      lampGroup.add(head);
      this.scene.add(lampGroup);
      this.scrollingProps.push(lampGroup);

      // Every 4th slot: cantilevered Hyderabad Expressway Gantry anchored on far -Z shoulder
      // so no foreground +Z post ever occludes the hero truck
      if (i % 4 === 1) {
        const gantryGroup = new THREE.Group();
        gantryGroup.position.set(xPos + 60, 0, 0);

        const post = new THREE.Mesh(gantryPostGeo, poleMat);
        post.position.set(0, 46, -156);
        gantryGroup.add(post);

        const beam = new THREE.Mesh(gantryBeamGeo, poleMat);
        beam.position.set(0, 90, -60);
        gantryGroup.add(beam);

        const sign = new THREE.Mesh(gantryBoardGeo, gantrySignMat);
        sign.position.set(1.5, 88, -56);
        gantryGroup.add(sign);

        this.scene.add(gantryGroup);
        this.scrollingProps.push(gantryGroup);
      }
    }

    // Hyderabad Urban Skyline: IT Glass Towers, Cyber Rotunda, Hospitals & Roadside Trees
    // Placed strictly along far -Z skyline (z <= -166) so camera view from +Z is 100% unobstructed
    const glassTex = this.trackTex(createBuildingFacadeTexture(maxAniso, 'glass'));
    const commTex = this.trackTex(createBuildingFacadeTexture(maxAniso, 'commercial'));
    const hospTex = this.trackTex(createBuildingFacadeTexture(maxAniso, 'hospital'));

    const glassTowerMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        map: glassTex,
        roughness: 0.25,
        metalness: 0.55,
      })
    );
    const commTowerMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        map: commTex,
        roughness: 0.55,
        metalness: 0.15,
      })
    );
    const hospTowerMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        map: hospTex,
        roughness: 0.5,
        metalness: 0.1,
      })
    );
    const roofTrimMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x334155,
        roughness: 0.5,
        metalness: 0.5,
      })
    );
    const podiumMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xe2e8f0,
        roughness: 0.72,
        metalness: 0.08,
      })
    );

    const trunkMat = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0x78350f, roughness: 0.9 })
    );
    const foliageMat = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0x4d7c0f, roughness: 0.85 })
    );
    const trunkGeo = this.trackGeo(new THREE.CylinderGeometry(1.4, 2.0, 14, 7));
    const crownGeo = this.trackGeo(new THREE.ConeGeometry(8.5, 19, 7));

    const buildingCount = 18;
    const bStep = ROAD_LOOP_SPAN / buildingCount;

    for (let i = 0; i < buildingCount; i++) {
      const bx = -ROAD_HALF_SPAN + i * bStep + (i % 2) * 18;
      const bZ = -225 - (i % 3) * 68;
      const w = 52 + (i % 4) * 16;
      const d = 48 + ((i + 1) % 3) * 14;
      const h = 76 + ((i * 29) % 88);

      const bGroup = new THREE.Group();
      bGroup.position.set(bx, 0, bZ);

      // Architectural podium base
      const podiumGeo = this.trackGeo(new THREE.BoxGeometry(w + 14, 24, d + 14));
      const podium = new THREE.Mesh(podiumGeo, podiumMat);
      podium.position.y = 12;
      podium.receiveShadow = true;
      bGroup.add(podium);

      // Main high-rise tower (HITEC / Jubilee Hills / Hospital)
      const isRotunda = i % 5 === 2;
      const towerMat =
        i % 4 === 0
          ? hospTowerMat
          : i % 2 === 0
          ? glassTowerMat
          : commTowerMat;

      if (isRotunda) {
        // Cyber Towers inspired cylindrical IT landmark
        const cylGeo = this.trackGeo(new THREE.CylinderGeometry(w * 0.48, w * 0.5, h, 20));
        const cyl = new THREE.Mesh(cylGeo, glassTowerMat);
        cyl.position.y = 24 + h / 2;
        cyl.castShadow = true;
        bGroup.add(cyl);

        const capGeo = this.trackGeo(new THREE.CylinderGeometry(w * 0.52, w * 0.52, 8, 20));
        const cap = new THREE.Mesh(capGeo, roofTrimMat);
        cap.position.y = 24 + h + 4;
        bGroup.add(cap);
      } else {
        const towerGeo = this.trackGeo(new THREE.BoxGeometry(w, h, d));
        const tower = new THREE.Mesh(towerGeo, towerMat);
        tower.position.y = 24 + h / 2;
        tower.castShadow = true;
        tower.receiveShadow = true;
        bGroup.add(tower);

        const crownGeoBox = this.trackGeo(new THREE.BoxGeometry(w * 0.72, 10, d * 0.72));
        const crownBox = new THREE.Mesh(crownGeoBox, roofTrimMat);
        crownBox.position.y = 24 + h + 5;
        bGroup.add(crownBox);
      }

      this.scene.add(bGroup);
      this.scrollingProps.push(bGroup);

      // Roadside palm/neem-style trees along -Z shoulder verge
      const treeGroup = new THREE.Group();
      treeGroup.position.set(bx + 28, 0, -168 - (i % 2) * 10);
      const trunk = new THREE.Mesh(trunkGeo, trunkMat);
      trunk.position.y = 7;
      treeGroup.add(trunk);
      const crown = new THREE.Mesh(crownGeo, foliageMat);
      crown.position.y = 21;
      treeGroup.add(crown);
      this.scene.add(treeGroup);
      this.scrollingProps.push(treeGroup);
    }
  }

  private buildWheel(x: number, z: number, recordHeroWheel = true): THREE.Group {
    const wheelGroup = new THREE.Group();
    wheelGroup.position.set(x, 0.48, z);

    const tireMat = this.sharedTireMat;
    const rimMat = this.sharedRimMat;
    const hubMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x334155,
        roughness: 0.38,
        metalness: 0.75,
      })
    );

    const tireGeo = this.trackGeo(new THREE.CylinderGeometry(0.48, 0.48, 0.3, 24));
    tireGeo.rotateX(Math.PI / 2);
    const tire = new THREE.Mesh(tireGeo, tireMat);
    tire.castShadow = true;
    tire.receiveShadow = true;
    wheelGroup.add(tire);

    const rimGeo = this.trackGeo(new THREE.CylinderGeometry(0.28, 0.28, 0.315, 20));
    rimGeo.rotateX(Math.PI / 2);
    const rim = new THREE.Mesh(rimGeo, rimMat);
    wheelGroup.add(rim);

    const spokeGeo = this.trackGeo(new THREE.BoxGeometry(0.5, 0.055, 0.33));
    const spoke1 = new THREE.Mesh(spokeGeo, hubMat);
    const spoke2 = new THREE.Mesh(spokeGeo, hubMat);
    spoke2.rotation.z = Math.PI / 2;
    wheelGroup.add(spoke1, spoke2);

    const hubGeo = this.trackGeo(new THREE.CylinderGeometry(0.11, 0.11, 0.345, 12));
    hubGeo.rotateX(Math.PI / 2);
    const hub = new THREE.Mesh(hubGeo, hubMat);
    wheelGroup.add(hub);

    if (recordHeroWheel) {
      this.heroWheels.push(wheelGroup);
    }

    return wheelGroup;
  }

  private buildTruck(): void {
    this.truckGroup = new THREE.Group();
    this.truckGroup.scale.setScalar(TRUCK_SCALE);
    this.scene.add(this.truckGroup);

    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();

    const shadowTex = this.trackTex(createContactShadowTexture());
    const contactGeo = this.trackGeo(new THREE.PlaneGeometry(10.8, 3.9));
    const contactMat = this.trackMat(
      new THREE.MeshBasicMaterial({
        map: shadowTex,
        transparent: true,
        opacity: 0.68,
        depthWrite: false,
      })
    );
    const contactMesh = new THREE.Mesh(contactGeo, contactMat);
    contactMesh.rotation.x = -Math.PI / 2;
    contactMesh.position.set(-0.25, 0.015, 0);
    this.truckGroup.add(contactMesh);

    this.cargoInteriorLight = new THREE.PointLight(0xbae6fd, 2.0, 95, 1.4);
    this.cargoInteriorLight.position.set(1.2, 2.55, 0);
    this.truckGroup.add(this.cargoInteriorLight);

    const chassisSteelMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x1e293b,
        roughness: 0.52,
        metalness: 0.72,
      })
    );
    const brushedAlumMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xe2e8f0,
        roughness: 0.26,
        metalness: 0.85,
      })
    );
    const cabPaintMat = this.trackMat(
      new THREE.MeshPhysicalMaterial({
        color: 0xf8fafc,
        roughness: 0.22,
        metalness: 0.15,
        clearcoat: 0.85,
        clearcoatRoughness: 0.12,
      })
    );
    this.cabAccentMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: this.visualState.accentHex ?? 0x0284c7,
        roughness: 0.3,
        metalness: 0.25,
      })
    );
    const glassMat = this.trackMat(
      new THREE.MeshPhysicalMaterial({
        color: 0x93c5fd,
        roughness: 0.08,
        metalness: 0.05,
        transparent: true,
        opacity: 0.34,
        depthWrite: false,
      })
    );

    // 1. Chassis Frame
    const railGeo = this.trackGeo(new THREE.BoxGeometry(8.9, 0.22, 0.14));
    const leftRail = new THREE.Mesh(railGeo, chassisSteelMat);
    leftRail.position.set(-0.2, 0.78, -0.72);
    leftRail.castShadow = true;
    this.truckGroup.add(leftRail);

    const rightRail = new THREE.Mesh(railGeo, chassisSteelMat);
    rightRail.position.set(-0.2, 0.78, 0.72);
    rightRail.castShadow = true;
    this.truckGroup.add(rightRail);

    const tankGeo = this.trackGeo(new THREE.CylinderGeometry(0.24, 0.24, 1.1, 16));
    tankGeo.rotateZ(Math.PI / 2);
    const tank = new THREE.Mesh(tankGeo, brushedAlumMat);
    tank.position.set(-1.35, 0.66, 0.92);
    tank.castShadow = true;
    this.truckGroup.add(tank);

    const bumperGeo = this.trackGeo(new THREE.BoxGeometry(0.22, 0.2, 2.38));
    const rearBumper = new THREE.Mesh(bumperGeo, chassisSteelMat);
    rearBumper.position.set(4.26, 0.68, 0);
    rearBumper.castShadow = true;
    this.truckGroup.add(rearBumper);

    const wheelXs = [-3.45, 2.15, 3.25];
    for (const wx of wheelXs) {
      this.truckGroup.add(this.buildWheel(wx, -1.06, true));
      this.truckGroup.add(this.buildWheel(wx, 1.06, true));
    }

    const fenderGeo = this.trackGeo(new THREE.BoxGeometry(2.35, 0.08, 0.42));
    for (const zSign of [-1, 1]) {
      const rearFender = new THREE.Mesh(fenderGeo, chassisSteelMat);
      rearFender.position.set(2.7, 1.02, zSign * 1.04);
      this.truckGroup.add(rearFender);
    }

    // 2. Driver Cabin
    const cabGroup = new THREE.Group();
    this.truckGroup.add(cabGroup);

    const lowerCabGeo = this.trackGeo(new THREE.BoxGeometry(2.45, 0.95, 2.24));
    const lowerCab = new THREE.Mesh(lowerCabGeo, cabPaintMat);
    lowerCab.position.set(-3.32, 1.32, 0);
    lowerCab.castShadow = true;
    lowerCab.receiveShadow = true;
    cabGroup.add(lowerCab);

    const frontBumperGeo = this.trackGeo(new THREE.BoxGeometry(0.32, 0.34, 2.3));
    const frontBumper = new THREE.Mesh(frontBumperGeo, chassisSteelMat);
    frontBumper.position.set(-4.52, 0.86, 0);
    cabGroup.add(frontBumper);

    const grilleGeo = this.trackGeo(new THREE.BoxGeometry(0.08, 0.56, 1.48));
    const grille = new THREE.Mesh(grilleGeo, chassisSteelMat);
    grille.position.set(-4.55, 1.34, 0);
    cabGroup.add(grille);

    const cabStripeGeo = this.trackGeo(new THREE.BoxGeometry(2.48, 0.14, 2.26));
    const cabStripe = new THREE.Mesh(cabStripeGeo, this.cabAccentMat);
    cabStripe.position.set(-3.32, 1.72, 0);
    cabGroup.add(cabStripe);

    const hlGeo = this.trackGeo(new THREE.BoxGeometry(0.08, 0.18, 0.32));
    for (const zSign of [-1, 1]) {
      const hl = new THREE.Mesh(hlGeo, this.sharedHeadLightMat);
      hl.position.set(-4.55, 1.15, zSign * 0.82);
      cabGroup.add(hl);
    }

    const roofGeo = this.trackGeo(new THREE.BoxGeometry(1.7, 0.14, 2.2));
    const roof = new THREE.Mesh(roofGeo, cabPaintMat);
    roof.position.set(-2.95, 2.94, 0);
    roof.castShadow = true;
    cabGroup.add(roof);

    const backWallGeo = this.trackGeo(new THREE.BoxGeometry(0.16, 1.2, 2.2));
    const cabBackWall = new THREE.Mesh(backWallGeo, cabPaintMat);
    cabBackWall.position.set(-2.18, 2.34, 0);
    cabGroup.add(cabBackWall);

    const pillarGeo = this.trackGeo(new THREE.BoxGeometry(0.11, 1.28, 0.11));
    for (const zSign of [-1, 1]) {
      const aPillar = new THREE.Mesh(pillarGeo, chassisSteelMat);
      aPillar.position.set(-3.98, 2.34, zSign * 1.04);
      aPillar.rotation.z = -0.38;
      cabGroup.add(aPillar);
    }

    const mirrorGeo = this.trackGeo(new THREE.BoxGeometry(0.1, 0.36, 0.18));
    for (const zSign of [-1, 1]) {
      const mirror = new THREE.Mesh(mirrorGeo, chassisSteelMat);
      mirror.position.set(-3.75, 2.18, zSign * 1.28);
      cabGroup.add(mirror);
    }

    const windshieldGeo = this.trackGeo(new THREE.PlaneGeometry(1.96, 1.15));
    const windshield = new THREE.Mesh(windshieldGeo, glassMat);
    windshield.position.set(-3.98, 2.34, 0);
    windshield.rotation.y = -Math.PI / 2;
    windshield.rotation.x = 0.38;
    windshield.renderOrder = 5;
    cabGroup.add(windshield);

    const sideWinGeo = this.trackGeo(new THREE.PlaneGeometry(1.48, 0.96));
    const rightSideWin = new THREE.Mesh(sideWinGeo, glassMat);
    rightSideWin.position.set(-2.98, 2.34, 1.09);
    rightSideWin.renderOrder = 5;
    cabGroup.add(rightSideWin);

    const leftSideWin = new THREE.Mesh(sideWinGeo, glassMat);
    leftSideWin.position.set(-2.98, 2.34, -1.09);
    leftSideWin.rotation.y = Math.PI;
    leftSideWin.renderOrder = 5;
    cabGroup.add(leftSideWin);

    const interiorMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x334155,
        roughness: 0.75,
        metalness: 0.1,
      })
    );
    const dashGeo = this.trackGeo(new THREE.BoxGeometry(0.55, 0.38, 1.92));
    const dash = new THREE.Mesh(dashGeo, interiorMat);
    dash.position.set(-3.68, 1.88, 0);
    cabGroup.add(dash);

    const seatBackGeo = this.trackGeo(new THREE.BoxGeometry(0.16, 0.8, 0.5));
    const driverSeat = new THREE.Mesh(seatBackGeo, interiorMat);
    driverSeat.position.set(-2.55, 2.15, -0.45);
    driverSeat.rotation.z = 0.12;
    cabGroup.add(driverSeat);

    const wheelRingGeo = this.trackGeo(new THREE.TorusGeometry(0.2, 0.028, 10, 20));
    const steeringWheel = new THREE.Mesh(wheelRingGeo, chassisSteelMat);
    steeringWheel.position.set(-3.36, 2.14, -0.45);
    steeringWheel.rotation.y = Math.PI / 2;
    steeringWheel.rotation.x = 0.45;
    cabGroup.add(steeringWheel);

    // 3. Driver Cabin Gateway Unit (#GW-01)
    const gatewayGroup = new THREE.Group();
    gatewayGroup.position.set(-3.45, 2.18, 0.25);
    cabGroup.add(gatewayGroup);

    const gwBoxGeo = this.trackGeo(new THREE.BoxGeometry(0.28, 0.24, 0.44));
    const gwBoxMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x0f172a,
        roughness: 0.35,
        metalness: 0.65,
      })
    );
    const gwBox = new THREE.Mesh(gwBoxGeo, gwBoxMat);
    gwBox.userData.focusTarget = 'cabin';
    gatewayGroup.add(gwBox);
    this.interactables.push(gwBox);

    this.gatewayScreen = createGatewayScreenTexture();
    this.trackTex(this.gatewayScreen.texture);
    const gwScreenGeo = this.trackGeo(new THREE.PlaneGeometry(0.38, 0.19));
    const gwScreenMat = this.trackMat(
      new THREE.MeshBasicMaterial({ map: this.gatewayScreen.texture })
    );
    const gwScreenMesh = new THREE.Mesh(gwScreenGeo, gwScreenMat);
    gwScreenMesh.position.set(0.02, 0.01, 0.225);
    gatewayGroup.add(gwScreenMesh);

    const gwAntGeo = this.trackGeo(new THREE.CylinderGeometry(0.014, 0.022, 0.42, 8));
    const gwAnt = new THREE.Mesh(gwAntGeo, chassisSteelMat);
    gwAnt.position.set(0.06, 0.31, -0.12);
    gatewayGroup.add(gwAnt);

    const gwBeaconGeo = this.trackGeo(new THREE.SphereGeometry(0.075, 16, 12));
    this.gatewayBeaconMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x10b981,
        emissive: 0x10b981,
        emissiveIntensity: 1.4,
        roughness: 0.2,
      })
    );
    const gwBeacon = new THREE.Mesh(gwBeaconGeo, this.gatewayBeaconMat);
    gwBeacon.position.set(0, 0.17, 0.1);
    gatewayGroup.add(gwBeacon);

    // 4. Cold-Storage Insulated Container
    const containerGroup = new THREE.Group();
    this.truckGroup.add(containerGroup);

    const wallTex = this.trackTex(createContainerWallTexture(maxAniso));
    const containerOuterMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: wallTex,
        roughness: 0.42,
        metalness: 0.12,
      })
    );
    const containerInnerMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xe2e8f0,
        roughness: 0.55,
        metalness: 0.2,
      })
    );

    const floorGeo = this.trackGeo(new THREE.BoxGeometry(6.1, 0.18, 2.42));
    const cFloor = new THREE.Mesh(floorGeo, brushedAlumMat);
    cFloor.position.set(1.2, 0.98, 0);
    cFloor.castShadow = true;
    cFloor.receiveShadow = true;
    containerGroup.add(cFloor);

    const cRoofGeo = this.trackGeo(new THREE.BoxGeometry(6.1, 0.16, 2.42));
    const cRoof = new THREE.Mesh(cRoofGeo, containerInnerMat);
    cRoof.position.set(1.2, 3.22, 0);
    cRoof.castShadow = true;
    containerGroup.add(cRoof);

    // Roof livery stripe matching selected transport vehicle
    const roofStripeGeo = this.trackGeo(new THREE.BoxGeometry(5.9, 0.04, 0.42));
    const roofStripe = new THREE.Mesh(roofStripeGeo, this.cabAccentMat);
    roofStripe.position.set(1.2, 3.31, 0);
    containerGroup.add(roofStripe);

    const frontWallGeo = this.trackGeo(new THREE.BoxGeometry(0.16, 2.16, 2.42));
    const cFrontWall = new THREE.Mesh(frontWallGeo, containerInnerMat);
    cFrontWall.position.set(-1.77, 2.1, 0);
    cFrontWall.castShadow = true;
    containerGroup.add(cFrontWall);

    const sideWallGeo = this.trackGeo(new THREE.BoxGeometry(6.1, 2.16, 0.12));
    const leftWall = new THREE.Mesh(sideWallGeo, containerOuterMat);
    leftWall.position.set(1.2, 2.1, -1.15);
    leftWall.castShadow = true;
    leftWall.receiveShadow = true;
    containerGroup.add(leftWall);

    this.cutawayWallMesh = new THREE.Mesh(sideWallGeo, containerOuterMat);
    this.cutawayWallMesh.position.set(1.2, 2.1, 1.15);
    this.cutawayWallMesh.castShadow = true;
    containerGroup.add(this.cutawayWallMesh);

    const cutawayGlassGeo = this.trackGeo(new THREE.PlaneGeometry(5.85, 1.98));
    const cutawayGlassMat = this.trackMat(
      new THREE.MeshPhysicalMaterial({
        color: 0xe0f2fe,
        roughness: 0.1,
        metalness: 0.05,
        transparent: true,
        opacity: 0.14,
        depthWrite: false,
      })
    );
    this.cutawayGlassMesh = new THREE.Mesh(cutawayGlassGeo, cutawayGlassMat);
    this.cutawayGlassMesh.position.set(1.2, 2.1, 1.18);
    this.cutawayGlassMesh.renderOrder = 4;
    containerGroup.add(this.cutawayGlassMesh);

    const frameBarLong = this.trackGeo(new THREE.BoxGeometry(6.14, 0.1, 0.1));
    for (const yPos of [1.04, 3.18]) {
      for (const zPos of [-1.18, 1.18]) {
        const rail = new THREE.Mesh(frameBarLong, brushedAlumMat);
        rail.position.set(1.2, yPos, zPos);
        containerGroup.add(rail);
      }
    }
    const postGeo = this.trackGeo(new THREE.BoxGeometry(0.12, 2.24, 0.12));
    for (const xPos of [-1.81, 4.21]) {
      for (const zPos of [-1.18, 1.18]) {
        const post = new THREE.Mesh(postGeo, brushedAlumMat);
        post.position.set(xPos, 2.11, zPos);
        containerGroup.add(post);
      }
    }

    const cryoGroup = new THREE.Group();
    cryoGroup.position.set(-2.06, 2.66, 0);
    containerGroup.add(cryoGroup);

    const cryoHousingGeo = this.trackGeo(new THREE.BoxGeometry(0.5, 0.82, 1.62));
    const cryoHousing = new THREE.Mesh(cryoHousingGeo, cabPaintMat);
    cryoHousing.castShadow = true;
    cryoGroup.add(cryoHousing);

    const grilleRingGeo = this.trackGeo(new THREE.TorusGeometry(0.25, 0.03, 10, 24));
    const grilleRing = new THREE.Mesh(grilleRingGeo, chassisSteelMat);
    grilleRing.position.set(-0.26, 0, 0);
    grilleRing.rotation.y = Math.PI / 2;
    cryoGroup.add(grilleRing);

    this.coolingFanGroup = new THREE.Group();
    this.coolingFanGroup.position.set(-0.26, 0, 0);
    cryoGroup.add(this.coolingFanGroup);

    const bladeGeo = this.trackGeo(new THREE.BoxGeometry(0.02, 0.42, 0.08));
    for (let i = 0; i < 3; i++) {
      const blade = new THREE.Mesh(bladeGeo, this.cabAccentMat);
      blade.rotation.x = (i * Math.PI) / 3;
      this.coolingFanGroup.add(blade);
    }

    const thermalBoxGeo = this.trackGeo(new THREE.BoxGeometry(5.65, 1.95, 2.05));
    this.cargoThermalOverlayMat = this.trackMat(
      new THREE.MeshBasicMaterial({
        color: 0xbae6fd,
        transparent: true,
        opacity: 0.08,
        depthWrite: false,
      })
    );
    const thermalOverlay = new THREE.Mesh(thermalBoxGeo, this.cargoThermalOverlayMat);
    thermalOverlay.position.set(1.2, 2.06, 0);
    thermalOverlay.renderOrder = 3;
    containerGroup.add(thermalOverlay);

    // 5. Medical Cold-Storage Cargo Pallets & Vaccine Cryo-Boxes
    const crateTex = this.trackTex(createPharmaCrateTexture(maxAniso));
    const crateMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: crateTex,
        roughness: 0.45,
        metalness: 0.06,
      })
    );
    const palletMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x64748b,
        roughness: 0.6,
        metalness: 0.55,
      })
    );

    const palletGeo = this.trackGeo(new THREE.BoxGeometry(1.15, 0.1, 0.85));
    const crateGeo = this.trackGeo(new THREE.BoxGeometry(0.52, 0.48, 0.72));

    const palletPositions = [
      { x: -0.7, z: -0.5 },
      { x: -0.7, z: 0.5 },
      { x: 0.85, z: -0.5 },
      { x: 0.85, z: 0.5 },
      { x: 2.45, z: -0.5 },
      { x: 2.45, z: 0.5 },
    ];

    for (const p of palletPositions) {
      const pallet = new THREE.Mesh(palletGeo, palletMat);
      pallet.position.set(p.x, 1.12, p.z);
      pallet.receiveShadow = true;
      containerGroup.add(pallet);

      for (const dx of [-0.28, 0.28]) {
        for (const dy of [0.29, 0.78]) {
          const crate = new THREE.Mesh(crateGeo, crateMat);
          crate.position.set(p.x + dx, 1.12 + dy, p.z);
          crate.castShadow = true;
          crate.receiveShadow = true;
          containerGroup.add(crate);
        }
      }
    }

    // 6. Container Wireless Sensor Node (#CN-04) inside Container
    const nodeGroup = new THREE.Group();
    nodeGroup.position.set(0.95, 2.74, -0.92);
    containerGroup.add(nodeGroup);

    const nodeBodyGeo = this.trackGeo(new THREE.BoxGeometry(0.38, 0.28, 0.14));
    const nodeBodyMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x0f172a,
        roughness: 0.3,
        metalness: 0.6,
      })
    );
    const nodeBody = new THREE.Mesh(nodeBodyGeo, nodeBodyMat);
    nodeBody.userData.focusTarget = 'node';
    nodeGroup.add(nodeBody);
    this.interactables.push(nodeBody);

    const probeGeo = this.trackGeo(new THREE.CylinderGeometry(0.018, 0.014, 0.3, 10));
    const probe = new THREE.Mesh(probeGeo, brushedAlumMat);
    probe.position.set(-0.1, -0.26, 0.02);
    nodeGroup.add(probe);

    const nodeAntGeo = this.trackGeo(new THREE.CylinderGeometry(0.012, 0.018, 0.26, 8));
    const nodeAnt = new THREE.Mesh(nodeAntGeo, chassisSteelMat);
    nodeAnt.position.set(0.12, 0.24, 0.02);
    nodeGroup.add(nodeAnt);

    const ledGeo = this.trackGeo(new THREE.SphereGeometry(0.065, 16, 12));
    this.nodeLedMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x10b981,
        emissive: 0x10b981,
        emissiveIntensity: 1.6,
        roughness: 0.2,
      })
    );
    const nodeLed = new THREE.Mesh(ledGeo, this.nodeLedMat);
    nodeLed.position.set(0, 0.02, 0.09);
    nodeGroup.add(nodeLed);

    const haloGeo = this.trackGeo(new THREE.RingGeometry(0.11, 0.15, 24));
    this.nodeHaloMat = this.trackMat(
      new THREE.MeshBasicMaterial({
        color: 0x0ea5e9,
        transparent: true,
        opacity: 0.75,
        side: THREE.DoubleSide,
      })
    );
    const nodeHalo = new THREE.Mesh(haloGeo, this.nodeHaloMat);
    nodeHalo.position.set(0, 0.02, 0.095);
    nodeGroup.add(nodeHalo);

    // 7. Rear Double Insulated Doors + Reed Tamper Sensor (#DR-01)
    const doorPanelGeo = this.trackGeo(new THREE.BoxGeometry(0.11, 2.08, 1.12));
    const lockBarGeo = this.trackGeo(new THREE.CylinderGeometry(0.025, 0.025, 1.98, 10));
    const doorLabelMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xf1f5f9,
        roughness: 0.38,
        metalness: 0.15,
      })
    );

    this.leftDoorPivot = new THREE.Group();
    this.leftDoorPivot.position.set(4.21, 2.1, -1.14);
    containerGroup.add(this.leftDoorPivot);

    const leftDoorMesh = new THREE.Mesh(doorPanelGeo, doorLabelMat);
    leftDoorMesh.position.set(0, 0, 0.56);
    leftDoorMesh.castShadow = true;
    leftDoorMesh.userData.isDoor = true;
    this.leftDoorPivot.add(leftDoorMesh);
    this.interactables.push(leftDoorMesh);

    const leftLockBar = new THREE.Mesh(lockBarGeo, brushedAlumMat);
    leftLockBar.position.set(0.075, 0, 0.88);
    this.leftDoorPivot.add(leftLockBar);

    this.rightDoorPivot = new THREE.Group();
    this.rightDoorPivot.position.set(4.21, 2.1, 1.14);
    containerGroup.add(this.rightDoorPivot);

    const rightDoorMesh = new THREE.Mesh(doorPanelGeo, doorLabelMat);
    rightDoorMesh.position.set(0, 0, -0.56);
    rightDoorMesh.castShadow = true;
    rightDoorMesh.userData.isDoor = true;
    this.rightDoorPivot.add(rightDoorMesh);
    this.interactables.push(rightDoorMesh);

    const rightLockBar = new THREE.Mesh(lockBarGeo, brushedAlumMat);
    rightLockBar.position.set(0.075, 0, -0.88);
    this.rightDoorPivot.add(rightLockBar);

    const reedGroup = new THREE.Group();
    reedGroup.position.set(4.23, 3.12, 0);
    containerGroup.add(reedGroup);

    const reedBoxGeo = this.trackGeo(new THREE.BoxGeometry(0.14, 0.12, 0.28));
    const reedBox = new THREE.Mesh(reedBoxGeo, nodeBodyMat);
    reedGroup.add(reedBox);

    const reedLedGeo = this.trackGeo(new THREE.SphereGeometry(0.055, 14, 12));
    this.doorSensorLedMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x10b981,
        emissive: 0x10b981,
        emissiveIntensity: 1.5,
      })
    );
    const reedLed = new THREE.Mesh(reedLedGeo, this.doorSensorLedMat);
    reedLed.position.set(0.08, 0, 0);
    reedGroup.add(reedLed);

    // 8. Wireless RF Link inside truckGroup
    this.rfCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.95, 2.86, -0.82),
      new THREE.Vector3(-0.6, 2.94, -0.45),
      new THREE.Vector3(-2.05, 2.88, -0.1),
      new THREE.Vector3(-3.39, 2.52, 0.13),
    ]);
    const rfTubeGeo = this.trackGeo(new THREE.TubeGeometry(this.rfCurve, 36, 0.022, 8, false));
    this.rfTubeMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x0ea5e9,
        emissive: 0x0ea5e9,
        emissiveIntensity: 0.7,
        transparent: true,
        opacity: 0.55,
      })
    );
    const rfTube = new THREE.Mesh(rfTubeGeo, this.rfTubeMat);
    this.truckGroup.add(rfTube);

    const pulseGeo = this.trackGeo(new THREE.SphereGeometry(0.068, 12, 10));
    this.rfPulseMat = this.trackMat(
      new THREE.MeshBasicMaterial({ color: 0x38bdf8 })
    );
    for (let i = 0; i < 5; i++) {
      const pulse = new THREE.Mesh(pulseGeo, this.rfPulseMat);
      this.truckGroup.add(pulse);
      this.rfPulseMeshes.push(pulse);
    }
  }

  private buildTwoWheeler(spec: {
    bodyColor: number;
    helmetColor: number;
    laneZ: number;
    x: number;
    cruiseKmh: number;
    minTrafficTier: 0 | 1 | 2;
  }): TrafficVehicleRuntime {
    const group = new THREE.Group();
    group.position.set(spec.x, 0, spec.laneZ);
    const wheels: THREE.Group[] = [];

    const bodyMat = this.trackMat(
      new THREE.MeshPhysicalMaterial({
        color: spec.bodyColor,
        roughness: 0.3,
        metalness: 0.35,
      })
    );
    const riderMat = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.7 })
    );
    const helmetMat = this.trackMat(
      new THREE.MeshPhysicalMaterial({
        color: spec.helmetColor,
        roughness: 0.2,
        clearcoat: 0.8,
      })
    );
    const brakeLightMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xef4444,
        emissive: 0xdc2626,
        emissiveIntensity: 0.75,
      })
    );

    const wheelRadius = 3.8;
    const wheelGeo = this.trackGeo(new THREE.CylinderGeometry(wheelRadius, wheelRadius, 1.8, 14));
    wheelGeo.rotateX(Math.PI / 2);
    const rimGeo = this.trackGeo(new THREE.CylinderGeometry(2.3, 2.3, 1.95, 10));
    rimGeo.rotateX(Math.PI / 2);
    const spokeGeo = this.trackGeo(new THREE.BoxGeometry(4.0, 0.5, 2.05));

    for (const wx of [-8.8, 8.8]) {
      const wg = new THREE.Group();
      wg.position.set(wx, wheelRadius, 0);
      wg.add(new THREE.Mesh(wheelGeo, this.sharedTireMat));
      wg.add(new THREE.Mesh(rimGeo, this.sharedRimMat));
      wg.add(new THREE.Mesh(spokeGeo, this.sharedTireMat));
      group.add(wg);
      wheels.push(wg);
    }

    // Scooter / Motorcycle chassis + front fork + seat + rider with helmet
    const chassisGeo = this.trackGeo(new THREE.BoxGeometry(16, 4.2, 4.4));
    const chassis = new THREE.Mesh(chassisGeo, bodyMat);
    chassis.position.set(0, 7.2, 0);
    chassis.castShadow = true;
    group.add(chassis);

    const forkGeo = this.trackGeo(new THREE.BoxGeometry(2.6, 8.5, 3.2));
    const fork = new THREE.Mesh(forkGeo, bodyMat);
    fork.position.set(-7.6, 10.0, 0);
    fork.rotation.z = 0.28;
    group.add(fork);

    const barGeo = this.trackGeo(new THREE.BoxGeometry(1.4, 1.0, 8.2));
    const handleBar = new THREE.Mesh(barGeo, this.sharedTireMat);
    handleBar.position.set(-8.6, 14.0, 0);
    group.add(handleBar);

    const hlGeo = this.trackGeo(new THREE.BoxGeometry(1.2, 1.8, 2.4));
    const hl = new THREE.Mesh(hlGeo, this.sharedHeadLightMat);
    hl.position.set(-9.4, 11.4, 0);
    group.add(hl);

    const bl = new THREE.Mesh(hlGeo, brakeLightMat);
    bl.position.set(8.4, 8.6, 0);
    group.add(bl);

    const torsoGeo = this.trackGeo(new THREE.BoxGeometry(4.4, 6.8, 4.8));
    const torso = new THREE.Mesh(torsoGeo, riderMat);
    torso.position.set(1.2, 13.0, 0);
    torso.rotation.z = 0.22;
    torso.castShadow = true;
    group.add(torso);

    const helmetGeo = this.trackGeo(new THREE.SphereGeometry(2.3, 12, 10));
    const helmet = new THREE.Mesh(helmetGeo, helmetMat);
    helmet.position.set(0.2, 18.2, 0);
    helmet.castShadow = true;
    group.add(helmet);

    this.scene.add(group);
    return {
      group,
      wheels,
      brakeLightMat,
      laneZ: spec.laneZ,
      cruiseKmh: spec.cruiseKmh,
      wheelRadius,
      x: spec.x,
      minTrafficTier: spec.minTrafficTier,
    };
  }

  private buildThreeWheeler(spec: {
    laneZ: number;
    x: number;
    cruiseKmh: number;
    minTrafficTier: 0 | 1 | 2;
  }): TrafficVehicleRuntime {
    // Classic Indian Green & Yellow Auto-Rickshaw
    const group = new THREE.Group();
    group.position.set(spec.x, 0, spec.laneZ);
    const wheels: THREE.Group[] = [];

    const greenMat = this.trackMat(
      new THREE.MeshPhysicalMaterial({
        color: 0x15803d,
        roughness: 0.35,
        metalness: 0.2,
      })
    );
    const yellowCanopyMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xfacc15,
        roughness: 0.45,
        metalness: 0.08,
      })
    );
    const brakeLightMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xef4444,
        emissive: 0xdc2626,
        emissiveIntensity: 0.75,
      })
    );

    const wheelRadius = 3.6;
    const wheelGeo = this.trackGeo(new THREE.CylinderGeometry(wheelRadius, wheelRadius, 2.2, 14));
    wheelGeo.rotateX(Math.PI / 2);
    const rimGeo = this.trackGeo(new THREE.CylinderGeometry(2.0, 2.0, 2.3, 10));
    rimGeo.rotateX(Math.PI / 2);
    const spokeGeo = this.trackGeo(new THREE.BoxGeometry(3.8, 0.55, 2.4));

    // 1 front wheel + 2 rear wheels
    const wheelCoords: Array<[number, number]> = [
      [-11.5, 0],
      [9.5, -7.2],
      [9.5, 7.2],
    ];
    for (const [wx, wz] of wheelCoords) {
      const wg = new THREE.Group();
      wg.position.set(wx, wheelRadius, wz);
      wg.add(new THREE.Mesh(wheelGeo, this.sharedTireMat));
      wg.add(new THREE.Mesh(rimGeo, this.sharedRimMat));
      wg.add(new THREE.Mesh(spokeGeo, this.sharedTireMat));
      group.add(wg);
      wheels.push(wg);
    }

    // Green lower auto body + rear passenger cabin
    const bodyGeo = this.trackGeo(new THREE.BoxGeometry(26, 7.5, 14.2));
    const body = new THREE.Mesh(bodyGeo, greenMat);
    body.position.set(0, 7.4, 0);
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    // Front apron / cowl
    const noseGeo = this.trackGeo(new THREE.BoxGeometry(6.5, 8.8, 9.6));
    const nose = new THREE.Mesh(noseGeo, greenMat);
    nose.position.set(-10.8, 8.5, 0);
    nose.castShadow = true;
    group.add(nose);

    // Windshield frame + yellow canopy roof
    const windGeo = this.trackGeo(new THREE.BoxGeometry(1.2, 6.6, 11.2));
    const wind = new THREE.Mesh(windGeo, this.sharedCabinGlassMat);
    wind.position.set(-8.6, 14.8, 0);
    wind.rotation.z = 0.16;
    group.add(wind);

    const canopyGeo = this.trackGeo(new THREE.BoxGeometry(24.5, 7.8, 13.8));
    const canopy = new THREE.Mesh(canopyGeo, yellowCanopyMat);
    canopy.position.set(1.2, 15.2, 0);
    canopy.castShadow = true;
    group.add(canopy);

    // Single center headlight + rear brake lights
    const hlGeo = this.trackGeo(new THREE.CylinderGeometry(1.4, 1.4, 1.0, 12));
    hlGeo.rotateZ(Math.PI / 2);
    const hl = new THREE.Mesh(hlGeo, this.sharedHeadLightMat);
    hl.position.set(-14.2, 8.6, 0);
    group.add(hl);

    const blGeo = this.trackGeo(new THREE.BoxGeometry(0.8, 1.6, 2.2));
    for (const zSign of [-1, 1]) {
      const bl = new THREE.Mesh(blGeo, brakeLightMat);
      bl.position.set(13.2, 7.8, zSign * 5.2);
      group.add(bl);
    }

    this.scene.add(group);
    return {
      group,
      wheels,
      brakeLightMat,
      laneZ: spec.laneZ,
      cruiseKmh: spec.cruiseKmh,
      wheelRadius,
      x: spec.x,
      minTrafficTier: spec.minTrafficTier,
    };
  }

  private buildTrafficVehicle(spec: {
    type: 'sedan' | 'suv' | 'van' | 'bus' | 'police';
    bodyColor: number;
    laneZ: number;
    x: number;
    cruiseKmh: number;
    minTrafficTier: 0 | 1 | 2;
  }): TrafficVehicleRuntime {
    const group = new THREE.Group();
    group.position.set(spec.x, 0, spec.laneZ);
    const wheels: THREE.Group[] = [];

    const isPolice = spec.type === 'police';
    const isBus = spec.type === 'bus';
    const isVan = spec.type === 'van';
    const isSuv = spec.type === 'suv' || isPolice;

    const bodyMat = this.trackMat(
      new THREE.MeshPhysicalMaterial({
        color: isPolice ? 0xf8fafc : spec.bodyColor,
        roughness: 0.28,
        metalness: 0.22,
        clearcoat: 0.7,
      })
    );
    const brakeLightMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xef4444,
        emissive: 0xdc2626,
        emissiveIntensity: 0.75,
      })
    );

    const length = isBus ? 92 : isVan ? 64 : isSuv ? 54 : 48;
    const width = isBus ? 24 : 21;
    const bodyHeight = isBus ? 21 : isVan ? 17 : isSuv ? 10.5 : 8.0;
    const wheelRadius = isBus ? 5.2 : 4.1;

    const lowerGeo = this.trackGeo(new THREE.BoxGeometry(length, bodyHeight, width));
    const lowerMesh = new THREE.Mesh(lowerGeo, bodyMat);
    lowerMesh.position.y = wheelRadius + bodyHeight / 2 - 0.8;
    lowerMesh.castShadow = true;
    lowerMesh.receiveShadow = true;
    group.add(lowerMesh);

    if (isBus) {
      // RTC / Hyderabad Metro City Bus windows & roof stripe
      const winGeo = this.trackGeo(new THREE.BoxGeometry(length - 8, 7.2, width + 0.4));
      const winMesh = new THREE.Mesh(winGeo, this.sharedCabinGlassMat);
      winMesh.position.y = wheelRadius + bodyHeight - 4.5;
      group.add(winMesh);
    } else {
      const cabinLen = isVan ? length * 0.72 : length * 0.56;
      const cabinH = isVan ? 8.2 : isSuv ? 8.4 : 7.0;
      const cabinGeo = this.trackGeo(new THREE.BoxGeometry(cabinLen, cabinH, width - 2.4));
      const cabinMesh = new THREE.Mesh(cabinGeo, this.sharedCabinGlassMat);
      cabinMesh.position.set(
        isVan ? 4 : 2,
        wheelRadius + bodyHeight + cabinH / 2 - 1.2,
        0
      );
      cabinMesh.castShadow = true;
      group.add(cabinMesh);
    }

    if (isPolice) {
      // Hyderabad Traffic Police navy side band + flashing red/blue lightbar
      const stripeMat = this.trackMat(
        new THREE.MeshStandardMaterial({ color: 0x1e3a8a, roughness: 0.35 })
      );
      const stripeGeo = this.trackGeo(new THREE.BoxGeometry(length + 0.4, 3.0, width + 0.5));
      const stripe = new THREE.Mesh(stripeGeo, stripeMat);
      stripe.position.y = wheelRadius + 5.2;
      group.add(stripe);

      const barY = wheelRadius + bodyHeight + 7.6;
      const redMat = this.trackMat(
        new THREE.MeshStandardMaterial({
          color: 0xef4444,
          emissive: 0xef4444,
          emissiveIntensity: 2.0,
        })
      );
      const blueMat = this.trackMat(
        new THREE.MeshStandardMaterial({
          color: 0x3b82f6,
          emissive: 0x2563eb,
          emissiveIntensity: 2.0,
        })
      );
      this.policeRedMats.push(redMat);
      this.policeBlueMats.push(blueMat);

      const barGeo = this.trackGeo(new THREE.BoxGeometry(3.2, 2.2, 5.8));
      const redPod = new THREE.Mesh(barGeo, redMat);
      redPod.position.set(0, barY, -3.2);
      const bluePod = new THREE.Mesh(barGeo, blueMat);
      bluePod.position.set(0, barY, 3.2);
      group.add(redPod, bluePod);
    }

    const lightGeo = this.trackGeo(new THREE.BoxGeometry(0.9, 2.2, 3.8));
    for (const zSign of [-1, 1]) {
      const hl = new THREE.Mesh(lightGeo, this.sharedHeadLightMat);
      hl.position.set(-length / 2 - 0.1, wheelRadius + 3.8, zSign * (width * 0.34));
      group.add(hl);

      const bl = new THREE.Mesh(lightGeo, brakeLightMat);
      bl.position.set(length / 2 + 0.1, wheelRadius + 4.2, zSign * (width * 0.34));
      group.add(bl);
    }

    const wheelGeo = this.trackGeo(
      new THREE.CylinderGeometry(wheelRadius, wheelRadius, 3.0, 14)
    );
    wheelGeo.rotateX(Math.PI / 2);
    const rimGeo = this.trackGeo(
      new THREE.CylinderGeometry(wheelRadius * 0.56, wheelRadius * 0.56, 3.2, 10)
    );
    rimGeo.rotateX(Math.PI / 2);
    const spokeGeo = this.trackGeo(new THREE.BoxGeometry(wheelRadius * 1.0, 0.7, 3.3));

    const axleX = length * 0.32;
    const axleZ = width * 0.48;
    for (const wx of [-axleX, axleX]) {
      for (const wz of [-axleZ, axleZ]) {
        const wGroup = new THREE.Group();
        wGroup.position.set(wx, wheelRadius, wz);
        wGroup.add(new THREE.Mesh(wheelGeo, this.sharedTireMat));
        wGroup.add(new THREE.Mesh(rimGeo, this.sharedRimMat));
        wGroup.add(new THREE.Mesh(spokeGeo, this.sharedTireMat));
        group.add(wGroup);
        wheels.push(wGroup);
      }
    }

    this.scene.add(group);
    return {
      group,
      wheels,
      brakeLightMat,
      laneZ: spec.laneZ,
      cruiseKmh: spec.cruiseKmh,
      wheelRadius,
      x: spec.x,
      minTrafficTier: spec.minTrafficTier,
    };
  }

  private buildTrafficFleet(): void {
    // 5x Dense Hyderabad Expressway Traffic (32 active vehicles):
    // 10 Two-Wheelers, 8 Three-Wheeler Auto-Rickshaws, 12 Cars/SUVs/Vans/Buses, 2 Police Patrols.
    // All placed in flanking lanes (-102, -54, +54, +100) so the 3x Hero Rig at z = 0 surges past cleanly.

    // 1. Two-Wheelers (Motorcycles & Scooters) - 10 units
    const bikeSpecs: Array<{
      bodyColor: number;
      helmetColor: number;
      laneZ: number;
      x: number;
      cruiseKmh: number;
      minTrafficTier: 0 | 1 | 2;
    }> = [
      { bodyColor: 0x0284c7, helmetColor: 0xf8fafc, laneZ: 54, x: 35, cruiseKmh: 38, minTrafficTier: 0 },
      { bodyColor: 0xdc2626, helmetColor: 0xfef08a, laneZ: 100, x: -75, cruiseKmh: 34, minTrafficTier: 0 },
      { bodyColor: 0x0f172a, helmetColor: 0x38bdf8, laneZ: -54, x: -120, cruiseKmh: 48, minTrafficTier: 0 },
      { bodyColor: 0xf59e0b, helmetColor: 0xffffff, laneZ: 100, x: 185, cruiseKmh: 36, minTrafficTier: 1 },
      { bodyColor: 0x059669, helmetColor: 0xf1f5f9, laneZ: 54, x: -245, cruiseKmh: 42, minTrafficTier: 1 },
      { bodyColor: 0x7c3aed, helmetColor: 0xf8fafc, laneZ: -102, x: 260, cruiseKmh: 52, minTrafficTier: 1 },
      { bodyColor: 0xe11d48, helmetColor: 0x0f172a, laneZ: 100, x: -390, cruiseKmh: 35, minTrafficTier: 2 },
      { bodyColor: 0x334155, helmetColor: 0xfbbf24, laneZ: 54, x: 420, cruiseKmh: 40, minTrafficTier: 2 },
      { bodyColor: 0x0d9488, helmetColor: 0xffffff, laneZ: 100, x: 560, cruiseKmh: 37, minTrafficTier: 2 },
      { bodyColor: 0x2563eb, helmetColor: 0xe2e8f0, laneZ: -54, x: -580, cruiseKmh: 46, minTrafficTier: 2 },
    ];
    for (const bs of bikeSpecs) {
      this.trafficVehicles.push(this.buildTwoWheeler(bs));
    }

    // 2. Three-Wheelers (Indian Green & Yellow Auto-Rickshaws) - 8 units
    const autoSpecs: Array<{
      laneZ: number;
      x: number;
      cruiseKmh: number;
      minTrafficTier: 0 | 1 | 2;
    }> = [
      { laneZ: 100, x: 15, cruiseKmh: 30, minTrafficTier: 0 },
      { laneZ: 54, x: -135, cruiseKmh: 32, minTrafficTier: 0 },
      { laneZ: -54, x: 110, cruiseKmh: 34, minTrafficTier: 0 },
      { laneZ: 100, x: -220, cruiseKmh: 29, minTrafficTier: 1 },
      { laneZ: 54, x: 295, cruiseKmh: 31, minTrafficTier: 1 },
      { laneZ: 100, x: 390, cruiseKmh: 28, minTrafficTier: 2 },
      { laneZ: 54, x: -460, cruiseKmh: 33, minTrafficTier: 2 },
      { laneZ: 100, x: -640, cruiseKmh: 30, minTrafficTier: 2 },
    ];
    for (const as of autoSpecs) {
      this.trafficVehicles.push(this.buildThreeWheeler(as));
    }

    // 3. Cars, SUVs, Vans, City Buses & Moving Hyderabad Police Patrols - 14 units
    const fourWheelerSpecs: Array<{
      type: 'sedan' | 'suv' | 'van' | 'bus' | 'police';
      bodyColor: number;
      laneZ: number;
      x: number;
      cruiseKmh: number;
      minTrafficTier: 0 | 1 | 2;
    }> = [
      { type: 'sedan', bodyColor: 0x2563eb, laneZ: -54, x: -25, cruiseKmh: 76, minTrafficTier: 0 },
      { type: 'police', bodyColor: 0xf8fafc, laneZ: -102, x: -115, cruiseKmh: 84, minTrafficTier: 0 },
      { type: 'suv', bodyColor: 0x475569, laneZ: -54, x: 245, cruiseKmh: 72, minTrafficTier: 0 },
      { type: 'bus', bodyColor: 0x16a34a, laneZ: 100, x: -530, cruiseKmh: 32, minTrafficTier: 0 },
      { type: 'sedan', bodyColor: 0xd97706, laneZ: -102, x: 140, cruiseKmh: 82, minTrafficTier: 1 },
      { type: 'van', bodyColor: 0xe2e8f0, laneZ: 54, x: 145, cruiseKmh: 42, minTrafficTier: 1 },
      { type: 'suv', bodyColor: 0xb91c1c, laneZ: -54, x: -340, cruiseKmh: 78, minTrafficTier: 1 },
      { type: 'sedan', bodyColor: 0x0f766e, laneZ: -102, x: -380, cruiseKmh: 86, minTrafficTier: 1 },
      { type: 'bus', bodyColor: 0x0284c7, laneZ: 54, x: -640, cruiseKmh: 36, minTrafficTier: 2 },
      { type: 'sedan', bodyColor: 0x64748b, laneZ: -54, x: 520, cruiseKmh: 74, minTrafficTier: 2 },
      { type: 'van', bodyColor: 0xf1f5f9, laneZ: 100, x: 740, cruiseKmh: 40, minTrafficTier: 2 },
      { type: 'police', bodyColor: 0xf8fafc, laneZ: -102, x: 590, cruiseKmh: 88, minTrafficTier: 2 },
      { type: 'suv', bodyColor: 0x1e293b, laneZ: -54, x: -750, cruiseKmh: 79, minTrafficTier: 2 },
      { type: 'sedan', bodyColor: 0xeab308, laneZ: 54, x: 760, cruiseKmh: 45, minTrafficTier: 2 },
    ];
    for (const fw of fourWheelerSpecs) {
      this.trafficVehicles.push(this.buildTrafficVehicle(fw));
    }
  }

  private buildAccidentsAndPoliceCheckposts(): void {
    // 2 Highway Roadside Accident + Nearby Police Response Scenes scrolling along outer shoulders
    const coneMat = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0xf97316, roughness: 0.55 })
    );
    const whiteMat = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.45 })
    );
    const crashedCarMat = this.trackMat(
      new THREE.MeshPhysicalMaterial({ color: 0xdc2626, roughness: 0.35 })
    );
    const crashedAutoMat = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0x15803d, roughness: 0.45 })
    );
    const policeNavyMat = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0x1e3a8a, roughness: 0.35 })
    );
    const coneGeo = this.trackGeo(new THREE.ConeGeometry(2.1, 5.2, 10));
    const barricadeGeo = this.trackGeo(new THREE.BoxGeometry(2.2, 5.5, 16));

    const incidentConfigs = [
      { x: -210, z: -130, facing: 1 },
      { x: 460, z: 130, facing: -1 },
    ];

    for (const cfg of incidentConfigs) {
      const sceneGroup = new THREE.Group();
      sceneGroup.position.set(cfg.x, 0, cfg.z);

      // 1. Crashed / Tilted Vehicle with flashing amber hazards
      const wreckedGroup = new THREE.Group();
      wreckedGroup.position.set(-28, 0, 0);
      wreckedGroup.rotation.y = cfg.facing * 0.42;
      wreckedGroup.rotation.z = 0.08;

      const wreckBodyGeo = this.trackGeo(new THREE.BoxGeometry(42, 9.5, 19));
      const wreckBody = new THREE.Mesh(
        wreckBodyGeo,
        cfg.facing > 0 ? crashedCarMat : crashedAutoMat
      );
      wreckBody.position.y = 7.2;
      wreckBody.castShadow = true;
      wreckedGroup.add(wreckBody);

      const wreckCabGeo = this.trackGeo(new THREE.BoxGeometry(22, 7.2, 16.5));
      const wreckCab = new THREE.Mesh(wreckCabGeo, this.sharedCabinGlassMat);
      wreckCab.position.set(2, 14.8, 0);
      wreckedGroup.add(wreckCab);

      const hazardMat = this.trackMat(
        new THREE.MeshStandardMaterial({
          color: 0xf59e0b,
          emissive: 0xf59e0b,
          emissiveIntensity: 2.0,
        })
      );
      this.hazardLightMats.push(hazardMat);
      const hazGeo = this.trackGeo(new THREE.BoxGeometry(1.4, 2.2, 3.2));
      for (const zS of [-1, 1]) {
        const hl = new THREE.Mesh(hazGeo, hazardMat);
        hl.position.set(21.5, 8.2, zS * 6.5);
        wreckedGroup.add(hl);
      }
      sceneGroup.add(wreckedGroup);

      // 2. Traffic Cones & Police Barricade protecting the accident lane
      for (let c = 0; c < 4; c++) {
        const cone = new THREE.Mesh(coneGeo, coneMat);
        cone.position.set(-55 + c * 28, 2.6, cfg.facing * 12);
        sceneGroup.add(cone);
      }
      const barricade = new THREE.Mesh(barricadeGeo, whiteMat);
      barricade.position.set(-48, 2.75, 0);
      sceneGroup.add(barricade);

      // 3. Nearby Stationed Hyderabad Traffic Police Interceptor SUV with Red/Blue Lightbar
      const patrolGroup = new THREE.Group();
      patrolGroup.position.set(34, 0, 0);
      patrolGroup.rotation.y = -cfg.facing * 0.14;

      const suvBodyGeo = this.trackGeo(new THREE.BoxGeometry(52, 10.8, 21));
      const suvBody = new THREE.Mesh(suvBodyGeo, whiteMat);
      suvBody.position.y = 8.8;
      suvBody.castShadow = true;
      patrolGroup.add(suvBody);

      const stripeGeo = this.trackGeo(new THREE.BoxGeometry(52.4, 3.2, 21.4));
      const stripe = new THREE.Mesh(stripeGeo, policeNavyMat);
      stripe.position.y = 9.5;
      patrolGroup.add(stripe);

      const suvCabGeo = this.trackGeo(new THREE.BoxGeometry(28, 8.2, 18.4));
      const suvCab = new THREE.Mesh(suvCabGeo, this.sharedCabinGlassMat);
      suvCab.position.set(2, 17.5, 0);
      patrolGroup.add(suvCab);

      const pRedMat = this.trackMat(
        new THREE.MeshStandardMaterial({
          color: 0xef4444,
          emissive: 0xef4444,
          emissiveIntensity: 2.2,
        })
      );
      const pBlueMat = this.trackMat(
        new THREE.MeshStandardMaterial({
          color: 0x3b82f6,
          emissive: 0x2563eb,
          emissiveIntensity: 2.2,
        })
      );
      this.policeRedMats.push(pRedMat);
      this.policeBlueMats.push(pBlueMat);

      const podGeo = this.trackGeo(new THREE.BoxGeometry(3.8, 2.5, 6.2));
      const rPod = new THREE.Mesh(podGeo, pRedMat);
      rPod.position.set(0, 22.8, -3.4);
      const bPod = new THREE.Mesh(podGeo, pBlueMat);
      bPod.position.set(0, 22.8, 3.4);
      patrolGroup.add(rPod, bPod);

      sceneGroup.add(patrolGroup);
      this.scene.add(sceneGroup);
      this.scrollingProps.push(sceneGroup);
    }
  }

  public updateVisualState(nextState: SceneVisualState): void {
    const presetChanged = nextState.cameraPreset !== this.visualState.cameraPreset;
    this.visualState = { ...nextState };

    if (presetChanged) {
      const preset = CAMERA_PRESETS[nextState.cameraPreset];
      this.targetCamPos.copy(preset.position);
      this.targetLookAt.copy(preset.target);
      this.cameraTransitionActive = true;
    }
  }

  public focusCameraPreset(presetId: CameraPresetId): void {
    const preset = CAMERA_PRESETS[presetId];
    this.visualState.cameraPreset = presetId;
    this.targetCamPos.copy(preset.position);
    this.targetLookAt.copy(preset.target);
    this.cameraTransitionActive = true;
  }

  private applyVisualStateToScene(elapsedSec: number): void {
    const s = this.visualState;

    this.cutawayWallMesh.visible = !s.cutawayEnabled;
    this.cutawayGlassMesh.visible = s.cutawayEnabled;

    if (this.cabAccentMat && typeof s.accentHex === 'number') {
      this.cabAccentMat.color.setHex(s.accentHex);
    }

    if (s.tempBand === 'below_critical') {
      this.cargoInteriorLight.color.copy(_freezeBlueGlow);
      this.cargoInteriorLight.intensity = 2.6;
      this.cargoThermalOverlayMat.color.copy(_freezeBlueGlow);
      this.cargoThermalOverlayMat.opacity = 0.22;
    } else if (s.tempBand === 'above_critical') {
      this.cargoInteriorLight.color.copy(_heatRedGlow);
      this.cargoInteriorLight.intensity = 2.4;
      this.cargoThermalOverlayMat.color.copy(_heatRedGlow);
      this.cargoThermalOverlayMat.opacity = 0.18;
    } else {
      this.cargoInteriorLight.color.copy(_iceBlueGlow);
      this.cargoInteriorLight.intensity = 1.65;
      this.cargoThermalOverlayMat.color.copy(_iceBlueGlow);
      this.cargoThermalOverlayMat.opacity = 0.08;
    }

    const blinkOn = Math.sin(elapsedSec * 7.5) > 0;

    if (s.tempBand === 'below_critical' || s.tempBand === 'above_critical') {
      const col = blinkOn ? _alertLinkColor : _warnLinkColor;
      this.nodeLedMat.color.copy(col);
      this.nodeLedMat.emissive.copy(col);
      this.nodeLedMat.emissiveIntensity = blinkOn ? 2.4 : 0.9;
      this.nodeHaloMat.color.copy(_alertLinkColor);
    } else {
      this.nodeLedMat.color.copy(_emeraldLed);
      this.nodeLedMat.emissive.copy(_emeraldLed);
      this.nodeLedMat.emissiveIntensity = 1.5;
      this.nodeHaloMat.color.copy(_normalLinkColor);
    }

    const isDoorOpen = s.doorState === 'open' || s.doorState === 'open_authorized';
    if (s.isDoorTampered) {
      const col = blinkOn ? _alertLinkColor : _warnLinkColor;
      this.doorSensorLedMat.color.copy(col);
      this.doorSensorLedMat.emissive.copy(col);
      this.doorSensorLedMat.emissiveIntensity = blinkOn ? 2.6 : 0.8;
    } else if (isDoorOpen) {
      this.doorSensorLedMat.color.copy(_warnLinkColor);
      this.doorSensorLedMat.emissive.copy(_warnLinkColor);
      this.doorSensorLedMat.emissiveIntensity = 1.6;
    } else {
      this.doorSensorLedMat.color.copy(_emeraldLed);
      this.doorSensorLedMat.emissive.copy(_emeraldLed);
      this.doorSensorLedMat.emissiveIntensity = 1.5;
    }

    if (this.renderer?.domElement) {
      const tStr = s.temperatureC != null && Number.isFinite(s.temperatureC) ? `${s.temperatureC.toFixed(1)}°C` : 'Standby';
      const movingStr = s.vehicleMoving ? `moving at ${Math.round(s.speedKmh)} km/h` : 'parked';
      const doorStr = isDoorOpen ? 'doors open' : 'doors sealed';
      const alertStr = s.isAlertActive ? 'EXCURSION ALERT' : 'Normal GDP';
      this.renderer.domElement.setAttribute(
        'aria-label',
        `${s.callsign} 3D Twin: ${movingStr}, chamber ${tStr}, ${doorStr}, ${alertStr}`
      );
    }

    if (s.isAlertActive) {
      const col = blinkOn ? _alertLinkColor : _warnLinkColor;
      this.gatewayBeaconMat.color.copy(col);
      this.gatewayBeaconMat.emissive.copy(col);
      this.gatewayBeaconMat.emissiveIntensity = blinkOn ? 2.8 : 0.8;
      this.rfTubeMat.color.copy(_alertLinkColor);
      this.rfTubeMat.emissive.copy(_alertLinkColor);
      this.rfPulseMat.color.copy(_alertLinkColor);
    } else {
      this.gatewayBeaconMat.color.copy(_emeraldLed);
      this.gatewayBeaconMat.emissive.copy(_emeraldLed);
      this.gatewayBeaconMat.emissiveIntensity = 1.4;
      _scratchColor.copy(_normalLinkColor);
      this.rfTubeMat.color.copy(_scratchColor);
      this.rfTubeMat.emissive.copy(_scratchColor);
      this.rfPulseMat.color.setHex(0x38bdf8);
    }

    const roundedTemp = s.temperatureC != null && Number.isFinite(s.temperatureC) ? Number(s.temperatureC.toFixed(1)) : null;
    if (
      roundedTemp !== this.lastDrawnTemp ||
      s.isAlertActive !== this.lastDrawnCritical ||
      s.isDoorTampered !== this.lastDrawnTampered ||
      s.callsign !== this.lastDrawnCallsign
    ) {
      this.lastDrawnTemp = roundedTemp;
      this.lastDrawnCritical = s.isAlertActive;
      this.lastDrawnTampered = s.isDoorTampered;
      this.lastDrawnCallsign = s.callsign;
      this.gatewayScreen.draw(
        roundedTemp,
        s.isAlertActive,
        s.isDoorTampered,
        s.callsign
      );
    }
  }

  public pause(): void {
    this.isPaused = true;
    if (this.frameId) {
      cancelAnimationFrame(this.frameId);
      clearTimeout(this.frameId);
      this.frameId = 0;
    }
  }

  public resume(): void {
    if (!this.isPaused || this.disposed) return;
    this.isPaused = false;
    this.lastTickMs = performance.now();
    this.tick();
  }

  private tick = (): void => {
    if (this.disposed || this.isPaused) return;

    const nowMs = performance.now();
    const delta = Math.min(Math.max((nowMs - this.lastTickMs) / 1000, 0), 0.1);
    this.lastTickMs = nowMs;
    this.elapsedSec += delta;
    const elapsed = this.elapsedSec;

    // Adaptive Quality measurement
    this.frameCount++;
    this.fpsTimer += delta;
    if (this.fpsTimer >= 2.0) {
      const measuredFps = this.frameCount / this.fpsTimer;
      if (measuredFps < 30 && !this.isQualitySteppedDown && this.renderer) {
        this.isQualitySteppedDown = true;
        this.renderer.shadowMap.enabled = false;
        this.renderer.setPixelRatio(1.0);
      }
      this.frameCount = 0;
      this.fpsTimer = 0;
    }

    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;

    // 1. Hero 3x larger truck forward road motion, wheel spin & subtle road bounce
    const heroSpeedKmh = this.visualState.vehicleMoving
      ? Math.max(this.visualState.speedKmh, 52) // Hero rig visibly surges past dense traffic while moving
      : 0;
    const heroWorldSpeed = prefersReducedMotion ? 0 : (heroSpeedKmh / 3.6) * 5.2;

    if (heroWorldSpeed > 0.05 && !prefersReducedMotion) {
      const wheelSpinDelta = (heroWorldSpeed / HERO_WHEEL_WORLD_RADIUS) * delta;
      for (let i = 0; i < this.heroWheels.length; i++) {
        this.heroWheels[i].rotation.z += wheelSpinDelta;
      }

      this.truckGroup.position.y = Math.sin(elapsed * 8.5) * 0.3;
      this.truckGroup.rotation.z = Math.sin(elapsed * 4.5) * 0.0025;

      this.asphaltTex.offset.x -= (heroWorldSpeed * delta) / 56;
      for (let i = 0; i < this.scrollingProps.length; i++) {
        const prop = this.scrollingProps[i];
        prop.position.x += heroWorldSpeed * delta;
        if (prop.position.x > ROAD_HALF_SPAN) {
          prop.position.x -= ROAD_LOOP_SPAN;
        }
      }
    } else {
      this.truckGroup.position.y = THREE.MathUtils.damp(
        this.truckGroup.position.y,
        0,
        8,
        delta
      );
      this.truckGroup.rotation.z = THREE.MathUtils.damp(
        this.truckGroup.rotation.z,
        0,
        8,
        delta
      );
    }

    // 2. 5x Hyderabad Road Traffic Fleet (2-wheelers, 3-wheelers, cars, buses, police)
    const densityTier =
      this.visualState.trafficDensity === 'heavy'
        ? 2
        : this.visualState.trafficDensity === 'moderate'
        ? 1
        : 0;
    const trafficSlowdown =
      this.visualState.trafficDensity === 'heavy'
        ? 0.45
        : this.visualState.trafficDensity === 'moderate'
        ? 0.74
        : 1.0;

    for (let i = 0; i < this.trafficVehicles.length; i++) {
      const tv = this.trafficVehicles[i];
      const visible = tv.minTrafficTier <= densityTier;
      tv.group.visible = visible;
      if (!visible) continue;

      const actualSpeedKmh = tv.cruiseKmh * trafficSlowdown;
      const tvWorldSpeed = prefersReducedMotion ? 0 : (actualSpeedKmh / 3.6) * 5.2;
      const relVx = heroWorldSpeed - tvWorldSpeed;
      tv.x += relVx * delta;
      if (tv.x > ROAD_HALF_SPAN) tv.x -= ROAD_LOOP_SPAN;
      if (tv.x < -ROAD_HALF_SPAN) tv.x += ROAD_LOOP_SPAN;
      tv.group.position.x = tv.x;

      const tvWheelSpin = (tvWorldSpeed / tv.wheelRadius) * delta;
      for (let w = 0; w < tv.wheels.length; w++) {
        tv.wheels[w].rotation.z += tvWheelSpin;
      }

      tv.brakeLightMat.emissiveIntensity =
        this.visualState.trafficDensity === 'heavy' ? 1.85 : 0.75;
    }

    // 3. Alternating Police Red/Blue Strobes & Accident Hazard Lights (<= 3 Hz)
    const policeRedOn = prefersReducedMotion ? true : Math.sin(elapsed * 5.0) > 0;
    for (let i = 0; i < this.policeRedMats.length; i++) {
      this.policeRedMats[i].emissiveIntensity = policeRedOn ? 2.5 : 0.4;
    }
    for (let i = 0; i < this.policeBlueMats.length; i++) {
      this.policeBlueMats[i].emissiveIntensity = policeRedOn ? 0.4 : 2.5;
    }
    const hazardOn = prefersReducedMotion ? true : Math.sin(elapsed * 4.0) > 0;
    for (let i = 0; i < this.hazardLightMats.length; i++) {
      this.hazardLightMats[i].emissiveIntensity = hazardOn ? 2.2 : 0.4;
    }

    // 4. Smooth rear door opening / closing
    const isDoorOpen =
      this.visualState.doorState === 'open' ||
      this.visualState.doorState === 'open_authorized';
    const targetDoorAngle = isDoorOpen ? 1.75 : 0;
    this.currentDoorAngle = THREE.MathUtils.damp(
      this.currentDoorAngle,
      targetDoorAngle,
      6.5,
      delta
    );
    this.leftDoorPivot.rotation.y = this.currentDoorAngle;
    this.rightDoorPivot.rotation.y = -this.currentDoorAngle;

    // 5. Refrigeration condenser fan
    if (this.visualState.compressorActive) {
      this.coolingFanGroup.rotation.x += delta * 9.5;
    }

    // 6. RF telemetry packets along Node -> Gateway curve
    const packetSpeed = this.visualState.isAlertActive ? 0.85 : 0.42;
    const count = this.rfPulseMeshes.length;
    for (let i = 0; i < count; i++) {
      const t = (elapsed * packetSpeed + i / count) % 1;
      this.rfCurve.getPointAt(t, _scratchVec);
      this.rfPulseMeshes[i].position.copy(_scratchVec);
    }

    // 7. Smooth camera preset damping
    if (this.cameraTransitionActive) {
      this.camera.position.x = THREE.MathUtils.damp(
        this.camera.position.x,
        this.targetCamPos.x,
        5.5,
        delta
      );
      this.camera.position.y = THREE.MathUtils.damp(
        this.camera.position.y,
        this.targetCamPos.y,
        5.5,
        delta
      );
      this.camera.position.z = THREE.MathUtils.damp(
        this.camera.position.z,
        this.targetCamPos.z,
        5.5,
        delta
      );

      this.controls.target.x = THREE.MathUtils.damp(
        this.controls.target.x,
        this.targetLookAt.x,
        6.0,
        delta
      );
      this.controls.target.y = THREE.MathUtils.damp(
        this.controls.target.y,
        this.targetLookAt.y,
        6.0,
        delta
      );
      this.controls.target.z = THREE.MathUtils.damp(
        this.controls.target.z,
        this.targetLookAt.z,
        6.0,
        delta
      );

      if (this.camera.position.distanceTo(this.targetCamPos) < 0.5) {
        this.cameraTransitionActive = false;
      }
    }

    this.applyVisualStateToScene(elapsed);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);

    if (this.isSoftwareGl) {
      this.afterDraw(this.tick);
    } else {
      this.frameId = requestAnimationFrame(this.tick);
    }
  };

  private afterDraw(cb: () => void): void {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    if (!gl || typeof gl.fenceSync !== 'function') {
      this.frameId = window.setTimeout(cb, 80);
      return;
    }
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    const poll = () => {
      if (this.disposed) return;
      const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
      if (state === gl.UNSIGNALED) {
        this.frameId = window.setTimeout(poll, 5);
      } else {
        if (sync) gl.deleteSync(sync);
        this.frameId = window.setTimeout(cb, 80);
      }
    };
    this.frameId = window.setTimeout(poll, 5);
  }

  private handleResize = (): void => {
    if (this.disposed || !this.renderer) return;
    const width = Math.max(this.container.clientWidth, 240);
    const height = Math.max(this.container.clientHeight, 220);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.renderer.render(this.scene, this.camera);
  };

  private onPointerDown = (e: PointerEvent): void => {
    this.pointerDownPos = { x: e.clientX, y: e.clientY };
  };

  private onPointerUp = (e: PointerEvent): void => {
    const dist = Math.hypot(
      e.clientX - this.pointerDownPos.x,
      e.clientY - this.pointerDownPos.y
    );
    if (dist > 6) return;

    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointerVec.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointerVec.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.pointerVec, this.camera);
    const hits = this.raycaster.intersectObjects(this.interactables, false);
    if (hits.length > 0) {
      const hitObj = hits[0].object;
      if (hitObj.userData.isDoor) {
        this.callbacks.onDoorClick();
      } else if (hitObj.userData.focusTarget) {
        this.callbacks.onSelectFocus(hitObj.userData.focusTarget as CameraPresetId);
      }
    }
  };

  private onContextLost = (e: Event): void => {
    e.preventDefault();
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);
  };

  private onContextRestored = (): void => {
    if (!this.disposed) {
      this.tick();
    }
  };

  private bindEvents(): void {
    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('webglcontextlost', this.onContextLost);
    canvas.addEventListener('webglcontextrestored', this.onContextRestored);

    window.addEventListener('resize', this.handleResize);
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.handleResize());
      this.resizeObserver.observe(this.container);
    }
  }

  public dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);

    window.removeEventListener('resize', this.handleResize);
    this.resizeObserver?.disconnect();

    if (this.renderer) {
      const canvas = this.renderer.domElement;
      canvas.removeEventListener('pointerdown', this.onPointerDown);
      canvas.removeEventListener('pointerup', this.onPointerUp);
      canvas.removeEventListener('webglcontextlost', this.onContextLost);
      canvas.removeEventListener('webglcontextrestored', this.onContextRestored);
    }

    this.controls?.dispose();

    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    for (const t of this.textures) t.dispose();

    this.renderer?.dispose();
    if (this.renderer?.domElement?.parentNode === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
