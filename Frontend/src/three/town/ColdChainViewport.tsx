import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildTelemetryVisuals } from './buildTelemetryVisuals';
import { buildMiniTown, worldToGps } from './buildTown';
import { buildCargoTruck, TruckRig } from './buildTruck';
import { buildThermalHeatmapGrid, ThermalHeatmapGrid } from './thermalHeatmapGrid';
import { buildWeatherSystem, WeatherSystem, WeatherType } from './weatherParticles';
import {
  AnchorMap,
  CameraPreset,
  GpsSnapshot,
  INDUSTRY_PROFILES,
  IndustryId,
  LoadingSubStage,
  MissionPhase,
  TimeOfDay,
  TruckRouteId,
  WallMode,
} from '../../types/cargoguard';

interface ColdChainViewportProps {
  industry: IndustryId;
  routeId: TruckRouteId;
  wallMode: WallMode;
  timeOfDay: TimeOfDay;
  weather?: WeatherType;
  showHeatmapGrid?: boolean;
  temperature: number;
  doorOpen: boolean;
  doorLocked: boolean;
  tempAlert: boolean;
  doorAlert: boolean;
  irHazardTriggerId: number;
  irClearTriggerId: number;
  autoCycleMission: boolean;
  cameraPreset: CameraPreset;
  cameraTriggerId: number;
  jumpCommand: { phase: MissionPhase; subStage?: LoadingSubStage; targetT?: number; id: number } | null;
  packetPulseId: number;
  onAnchorsFrame: (anchors: AnchorMap) => void;
  onMissionUpdate: (
    phase: MissionPhase,
    subStage: LoadingSubStage,
    doorShouldBeOpen: boolean,
    doorLocked: boolean,
    speedKmh: number,
  ) => void;
  onGpsUpdate: (gps: GpsSnapshot) => void;
  onIrAlertChange: (active: boolean, distM: number | null) => void;
}

const DAY_SKY = new THREE.Color(0x70addd);
const NIGHT_SKY = new THREE.Color(0x050a14);
const DAY_KEY = new THREE.Color(0xfff5db);
const NIGHT_KEY = new THREE.Color(0x93c5fd);

// Pre-allocated math helpers outside render loop (zero GC)
const _projVec = new THREE.Vector3();
const _desiredCamPos = new THREE.Vector3();
const _desiredTarget = new THREE.Vector3();
const _pt = new THREE.Vector3();
const _tan = new THREE.Vector3();
const _side = new THREE.Vector3();
const _prevFollowPos = new THREE.Vector3();
const _currFollowPos = new THREE.Vector3();
const _localOffset = new THREE.Vector3();
const _localTargetOffset = new THREE.Vector3();
const _skyScratch = new THREE.Color();
const _keyScratch = new THREE.Color();

function projectObjectToScreen(
  obj: THREE.Object3D,
  camera: THREE.PerspectiveCamera,
  width: number,
  height: number,
): { x: number; y: number; visible: boolean } {
  obj.getWorldPosition(_projVec);
  _projVec.project(camera);
  const visible = _projVec.z > -1 && _projVec.z < 1;
  return {
    x: ((_projVec.x + 1) * 0.5) * width,
    y: ((-_projVec.y + 1) * 0.5) * height,
    visible,
  };
}

export const ColdChainViewport: React.FC<ColdChainViewportProps> = ({
  industry,
  routeId,
  wallMode,
  timeOfDay,
  temperature,
  doorOpen,
  doorLocked,
  tempAlert,
  doorAlert,
  irHazardTriggerId,
  irClearTriggerId,
  autoCycleMission,
  cameraPreset,
  cameraTriggerId,
  jumpCommand,
  packetPulseId,
  weather = 'clear',
  showHeatmapGrid = false,
  onAnchorsFrame,
  onMissionUpdate,
  onGpsUpdate,
  onIrAlertChange,
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [contextLost, setContextLost] = useState(false);

  const stateRef = useRef({
    industry,
    routeId,
    wallMode,
    timeOfDay,
    temperature,
    doorOpen,
    doorLocked,
    tempAlert,
    doorAlert,
    autoCycleMission,
    cameraPreset,
    weather,
    showHeatmapGrid,
  });
  stateRef.current = {
    industry,
    routeId,
    wallMode,
    timeOfDay,
    temperature,
    doorOpen,
    doorLocked,
    tempAlert,
    doorAlert,
    autoCycleMission,
    cameraPreset,
    weather,
    showHeatmapGrid,
  };

  const callbacksRef = useRef({
    onAnchorsFrame,
    onMissionUpdate,
    onGpsUpdate,
    onIrAlertChange,
  });
  callbacksRef.current = {
    onAnchorsFrame,
    onMissionUpdate,
    onGpsUpdate,
    onIrAlertChange,
  };

  const cameraAnimRef = useRef<{ active: boolean; preset: CameraPreset }>({
    active: false,
    preset: 'godown',
  });

  const truckRef = useRef<TruckRig | null>(null);
  const telemetryVisualsRef = useRef<ReturnType<typeof buildTelemetryVisuals> | null>(null);
  const townRef = useRef<ReturnType<typeof buildMiniTown> | null>(null);

  const nodePulseAgeRef = useRef(1);
  const gatewayRxAgeRef = useRef(1);
  const gatewayRxAlertRef = useRef(false);

  const missionRef = useRef<{
    phase: MissionPhase;
    subStage: LoadingSubStage;
    t: number;
    timer: number;
    returningToGodown: boolean;
  }>({
    phase: 'loading_godown',
    subStage: 'opening_door',
    t: 0.0,
    timer: 0,
    returningToGodown: false,
  });

  const irHazardRef = useRef<{ stopped: boolean; alertActive: boolean; timer: number }>({
    stopped: false,
    alertActive: false,
    timer: 0,
  });

  const userOrbitingRef = useRef(false);

  useEffect(() => {
    userOrbitingRef.current = false;
    cameraAnimRef.current = { active: true, preset: cameraPreset };
  }, [cameraPreset, cameraTriggerId]);

  useEffect(() => {
    truckRef.current?.updateCargoVisuals(industry);
  }, [industry]);

  useEffect(() => {
    const town = townRef.current;
    if (!town) return;
    town.setActiveRouteHighlight(routeId);
    const m = missionRef.current;
    if (m.phase === 'in_transit') {
      m.t = 0.035;
      m.returningToGodown = false;
    }
  }, [routeId]);

  useEffect(() => {
    const rig = truckRef.current;
    if (!rig) return;
    rig.cutawaySolidWall.visible = wallMode === 'solid';
    rig.cutawayAcrylicPanel.visible = wallMode === 'cutaway';
  }, [wallMode]);

  useEffect(() => {
    if (packetPulseId === 0) return;
    const st = stateRef.current;
    const isAlert = st.tempAlert || st.doorAlert || irHazardRef.current.alertActive;
    telemetryVisualsRef.current?.emitPacket(isAlert);
    nodePulseAgeRef.current = 0;
  }, [packetPulseId]);

  useEffect(() => {
    if (irHazardTriggerId === 0) return;
    const town = townRef.current;
    if (!town) return;
    const m = missionRef.current;
    if (m.phase !== 'in_transit') {
      m.phase = 'in_transit';
      m.subStage = 'complete';
      m.t = Math.max(m.t, 0.06);
      m.timer = 0;
      callbacksRef.current.onMissionUpdate('in_transit', 'complete', false, true, 54);
    }
    if (stateRef.current.routeId === 'orr_forest_bridge') {
      // Position leadCar ahead on ORR loop so TRUCK-01's front IR beam physically detects it
      const orrLen = town.truckRouteLengths.orr_forest_bridge;
      const deltaT = 12.5 / orrLen;
      town.leadCar.progress = (Math.max(m.t, 0.06) + deltaT) % 1;
    }
    irHazardRef.current = { stopped: true, alertActive: true, timer: 0 };
    callbacksRef.current.onIrAlertChange(true, 11.4);
  }, [irHazardTriggerId]);

  useEffect(() => {
    if (irClearTriggerId === 0) return;
    irHazardRef.current = { stopped: false, alertActive: false, timer: 0 };
    callbacksRef.current.onIrAlertChange(false, null);
  }, [irClearTriggerId]);

  useEffect(() => {
    if (!jumpCommand) return;
    const m = missionRef.current;
    const town = townRef.current;
    const activeRoute = stateRef.current.routeId;
    m.phase = jumpCommand.phase;
    m.timer = 0;
    irHazardRef.current = { stopped: false, alertActive: false, timer: 0 };
    callbacksRef.current.onIrAlertChange(false, null);

    if (jumpCommand.phase === 'loading_godown') {
      m.t = 0.0;
      m.subStage = jumpCommand.subStage ?? 'opening_door';
      m.returningToGodown = false;
      callbacksRef.current.onMissionUpdate('loading_godown', m.subStage, true, false, 0);
    } else if (jumpCommand.phase === 'in_transit') {
      m.t = jumpCommand.targetT ?? (town ? town.destinationStops[activeRoute].orrT : 0.04);
      m.subStage = 'complete';
      m.returningToGodown = false;
      callbacksRef.current.onMissionUpdate('in_transit', 'complete', false, true, 56);
    } else {
      m.t = town ? town.destinationStops[activeRoute].hospitalT : 0.72;
      m.subStage = 'complete';
      m.returningToGodown = false;
      callbacksRef.current.onMissionUpdate('unloading_dest', 'complete', true, false, 0);
    }
  }, [jumpCommand]);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const isSoftwareGl = (() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      if (!gl) return true;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
      const gpu = String(gl.getParameter(param));
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    })();

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

    const scene = new THREE.Scene();
    scene.background = DAY_SKY.clone();
    const fog = new THREE.FogExp2(DAY_SKY.getHex(), 0.004);
    scene.fog = fog;

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.2, 400);

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    const onContextLost = (e: Event) => {
      e.preventDefault();
      setContextLost(true);
    };
    const onContextRestored = () => setContextLost(false);
    renderer.domElement.addEventListener('webglcontextlost', onContextLost);
    renderer.domElement.addEventListener('webglcontextrestored', onContextRestored);

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const envTex = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTex;
    pmremGenerator.dispose();

    const hemiLight = new THREE.HemisphereLight(0x8ecae6, 0x1e293b, 1.15);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfff3d6, 2.55);
    keyLight.position.set(32, 48, 28);
    keyLight.castShadow = !isSoftwareGl;
    keyLight.shadow.mapSize.set(2048, 2048);
    keyLight.shadow.camera.near = 4;
    keyLight.shadow.camera.far = 165;
    const d = 76;
    keyLight.shadow.camera.left = -d;
    keyLight.shadow.camera.right = d;
    keyLight.shadow.camera.top = d;
    keyLight.shadow.camera.bottom = -d;
    keyLight.shadow.bias = -0.0005;
    keyLight.shadow.normalBias = 0.02;
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x38bdf8, 0.65);
    rimLight.position.set(-34, 18, -30);
    scene.add(rimLight);

    const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();
    const town = buildMiniTown(maxAnisotropy);
    town.setActiveRouteHighlight(stateRef.current.routeId);
    scene.add(town.root);
    townRef.current = town;

    // Single Switchable ColdChain Cargo Truck (TRUCK-01)
    const truck = buildCargoTruck(maxAnisotropy, isSoftwareGl, {
      cabColorHex: 0x0f2744,
      enablePointLights: true,
      enableIrAndTorch: true,
    });
    truck.updateCargoVisuals(stateRef.current.industry);
    truck.cutawaySolidWall.visible = stateRef.current.wallMode === 'solid';
    truck.cutawayAcrylicPanel.visible = stateRef.current.wallMode === 'cutaway';
    scene.add(truck.root);
    truckRef.current = truck;

    const telemetryVisuals = buildTelemetryVisuals();
    truck.root.add(telemetryVisuals.root);
    telemetryVisualsRef.current = telemetryVisuals;

    const thermalGrid = buildThermalHeatmapGrid();
    truck.trailerGroup.add(thermalGrid.root);

    const weatherSystem = buildWeatherSystem();
    scene.add(weatherSystem.root);

    // Initial position inside Dedicated Off-Road Godown 01 Pull-Through Bay (z = 31.35)
    const initCurve = town.truckRoutes[stateRef.current.routeId];
    initCurve.getPointAt(0, _pt);
    initCurve.getTangentAt(0, _tan);
    _tan.y = 0;
    _tan.normalize();
    _side.set(-_tan.z, 0, _tan.x);
    truck.root.position.set(_pt.x + _side.x * 2.25, 0.02, _pt.z + _side.z * 2.25);
    truck.root.rotation.y = Math.atan2(-_tan.z, _tan.x);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.06;
    controls.minDistance = 3.2;
    controls.maxDistance = 148;
    controls.maxPolarAngle = Math.PI / 2 - 0.03;

    camera.position.set(-20.5, 7.6, 19.5);
    controls.target.set(-32.2, 2.2, 32.0);
    controls.update();

    const onControlsStart = () => {
      userOrbitingRef.current = true;
      cameraAnimRef.current.active = false;
    };
    controls.addEventListener('start', onControlsStart);

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    let frameId = 0;
    let disposed = false;
    const clock = new THREE.Clock();
    let currentDoorAngle = 0;
    let lastGpsEmit = 0;
    let hasFollowPrev = false;
    let nightFactor = stateRef.current.timeOfDay === 'night' ? 1 : 0;

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (disposed) return;
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    }

    function getFollowTargetPos(preset: CameraPreset, out: THREE.Vector3): boolean {
      if (preset === 'follow_truck' || preset === 'interior' || preset === 'gateway' || preset === 'fpv_dashcam') {
        out.copy(truck.root.position);
        return true;
      }
      return false;
    }

    let autoIrActive = false;
    let lastReportedIrState = false;

    function tick() {
      if (disposed) return;
      const delta = Math.min(clock.getDelta(), 0.1);
      const elapsed = clock.getElapsedTime();
      const st = stateRef.current;

      // 1. Day / Night Atmosphere & Strict Daytime Torch Light OFF
      const targetNight = st.timeOfDay === 'night' ? 1 : 0;
      nightFactor = THREE.MathUtils.damp(nightFactor, targetNight, 4.2, delta);
      const torchOn = nightFactor > 0.05;

      _skyScratch.copy(DAY_SKY).lerp(NIGHT_SKY, nightFactor);
      (scene.background as THREE.Color).copy(_skyScratch);
      fog.color.copy(_skyScratch);

      _keyScratch.copy(DAY_KEY).lerp(NIGHT_KEY, nightFactor);
      keyLight.color.copy(_keyScratch);
      keyLight.intensity = THREE.MathUtils.lerp(2.65, 0.52, nightFactor);
      hemiLight.intensity = THREE.MathUtils.lerp(1.18, 0.38, nightFactor);
      rimLight.intensity = THREE.MathUtils.lerp(0.6, 1.15, nightFactor);

      town.setTimeOfDayVisuals(nightFactor);

      const torchOpacity = torchOn ? THREE.MathUtils.lerp(0.0, 0.34, nightFactor) : 0.0;
      for (let ci = 0; ci < truck.torchConeMeshes.length; ci++) {
        truck.torchConeMeshes[ci].visible = torchOn;
        truck.torchConeMats[ci].opacity = torchOpacity;
      }
      truck.headlightMat.emissiveIntensity = torchOn
        ? THREE.MathUtils.lerp(0.2, 3.2, nightFactor)
        : 0.0;
      if (truck.torchSpotLight) {
        truck.torchSpotLight.intensity = torchOn
          ? THREE.MathUtils.lerp(0.0, 22.0, nightFactor)
          : 0.0;
      }

      // 2. Real-Time Front IR Sensor Vehicle Detection (IR = ON stops TRUCK-01 whenever any vehicle is ahead!)
      const m = missionRef.current;
      const ir = irHazardRef.current;
      const activeCurve = town.truckRoutes[st.routeId];
      const activeLen = town.truckRouteLengths[st.routeId];
      const destT = town.destinationStops[st.routeId].hospitalT;

      activeCurve.getPointAt(m.t, _pt);
      activeCurve.getTangentAt(m.t, _tan);
      _tan.y = 0;
      if (_tan.lengthSq() < 1e-6) _tan.set(1, 0, 0);
      _tan.normalize();
      _side.set(-_tan.z, 0, _tan.x);

      const curTruckX = _pt.x + _side.x * 2.25;
      const curTruckZ = _pt.z + _side.z * 2.25;
      const frontBumperX = curTruckX + _tan.x * 5.2;
      const frontBumperZ = curTruckZ + _tan.z * 5.2;

      let closestDetectedM: number | null = null;
      if (m.phase === 'in_transit') {
        const detectRangeM = autoIrActive ? 15.8 : 13.5;
        const detectLatM = autoIrActive ? 3.05 : 2.7;
        for (let vi = 0; vi < town.trafficVehicles.length; vi++) {
          const veh = town.trafficVehicles[vi];
          const vx = veh.root.position.x - frontBumperX;
          const vz = veh.root.position.z - frontBumperZ;
          const ahead = vx * _tan.x + vz * _tan.z;
          const lat = Math.abs(vx * _side.x + vz * _side.z);
          const gapM = ahead - veh.lengthM * 0.5;
          if (gapM > -2.5 && gapM < detectRangeM && lat < detectLatM) {
            const clampedM = Math.max(1.2, Number(gapM.toFixed(1)));
            if (closestDetectedM === null || clampedM < closestDetectedM) {
              closestDetectedM = clampedM;
            }
          }
        }
      }

      autoIrActive = closestDetectedM !== null;
      const combinedIrAlert = autoIrActive || ir.alertActive;

      if (ir.stopped) {
        ir.timer += delta;
        if (ir.timer >= 6.8) {
          irHazardRef.current = { stopped: false, alertActive: false, timer: 0 };
        }
      }

      const activeIrState = autoIrActive || irHazardRef.current.alertActive;
      if (activeIrState !== lastReportedIrState) {
        lastReportedIrState = activeIrState;
        const reportDist = closestDetectedM ?? (irHazardRef.current.alertActive ? 11.4 : null);
        callbacksRef.current.onIrAlertChange(activeIrState, reportDist);
      }

      // 3. Mission Lifecycle & Selected Path Traversal (Stops immediately when IR = ON!)
      let speedMps = 0;
      if (st.autoCycleMission) {
        if (m.phase === 'loading_godown') {
          m.timer += delta;
          speedMps = 0;
          if (m.timer < 1.4 && m.subStage !== 'opening_door') {
            m.subStage = 'opening_door';
            callbacksRef.current.onMissionUpdate('loading_godown', 'opening_door', true, false, 0);
          } else if (m.timer >= 1.4 && m.timer < 5.6 && m.subStage !== 'loading_inside') {
            m.subStage = 'loading_inside';
            callbacksRef.current.onMissionUpdate('loading_godown', 'loading_inside', true, false, 0);
          } else if (m.timer >= 5.6 && m.timer < 7.0 && m.subStage !== 'locking_door') {
            m.subStage = 'locking_door';
            callbacksRef.current.onMissionUpdate('loading_godown', 'locking_door', false, true, 0);
          } else if (m.timer >= 7.0) {
            m.phase = 'in_transit';
            m.subStage = 'complete';
            m.timer = 0;
            m.returningToGodown = false;
            callbacksRef.current.onMissionUpdate('in_transit', 'complete', false, true, 56);
          }
        } else if (m.phase === 'in_transit') {
          speedMps = combinedIrAlert ? 0 : 15.8;
          const prevT = m.t;
          m.t = (m.t + (speedMps * delta) / activeLen) % 1;

          if (!m.returningToGodown && prevT < destT && m.t >= destT) {
            m.t = destT;
            m.phase = 'unloading_dest';
            m.subStage = 'complete';
            m.timer = 0;
            speedMps = 0;
            callbacksRef.current.onMissionUpdate('unloading_dest', 'complete', true, false, 0);
          } else if (m.returningToGodown && m.t < prevT) {
            m.t = 0;
            m.phase = 'loading_godown';
            m.subStage = 'opening_door';
            m.timer = 0;
            m.returningToGodown = false;
            speedMps = 0;
            callbacksRef.current.onMissionUpdate('loading_godown', 'opening_door', true, false, 0);
          }
        } else if (m.phase === 'unloading_dest') {
          m.timer += delta;
          speedMps = 0;
          if (m.timer >= 4.5) {
            m.phase = 'in_transit';
            m.subStage = 'complete';
            m.timer = 0;
            m.returningToGodown = true;
            callbacksRef.current.onMissionUpdate('in_transit', 'complete', false, true, 56);
          }
        }
      } else if (m.phase === 'in_transit') {
        speedMps = combinedIrAlert ? 0 : 15.8;
        m.t = (m.t + (speedMps * delta) / activeLen) % 1;
      }

      // Position & pitch TRUCK-01 onto active road & bridge
      activeCurve.getPointAt(m.t, _pt);
      activeCurve.getTangentAt(m.t, _tan);
      const horizLen = Math.hypot(_tan.x, _tan.z) || 1;
      const pitch = Math.atan2(_tan.y, horizLen);
      _tan.y = 0;
      if (_tan.lengthSq() < 1e-6) _tan.set(1, 0, 0);
      _tan.normalize();
      _side.set(-_tan.z, 0, _tan.x);

      truck.root.position.set(_pt.x + _side.x * 2.25, _pt.y + 0.02, _pt.z + _side.z * 2.25);
      truck.root.rotation.order = 'YXZ';
      truck.root.rotation.y = Math.atan2(-_tan.z, _tan.x);
      truck.root.rotation.z = pitch;

      // 4. Update Town, Retractable Loading Bridge, Interior Delivery Boys & Anti-Overlap Road Vehicles
      const loadPhaseProg =
        m.phase === 'loading_godown' && m.subStage === 'loading_inside'
          ? THREE.MathUtils.clamp((m.timer - 1.4) / 4.2, 0, 1)
          : 0;
      town.update(delta, elapsed, irHazardRef.current.stopped, {
        x: truck.root.position.x,
        z: truck.root.position.z,
        fwdX: _tan.x,
        fwdZ: _tan.z,
        loadingActive: m.phase === 'loading_godown',
        subStage: m.subStage,
        phaseProgress: loadPhaseProg,
      });

      // 5. Truck Wheel, Door & IoT Visual Updates
      const wRot = (speedMps * delta) / 0.52;
      for (let wi = 0; wi < truck.wheels.length; wi++) {
        truck.wheels[wi].rotation.z -= wRot;
      }

      const bounce =
        speedMps > 0 ? Math.sin(elapsed * 11.5) * 0.011 : Math.sin(elapsed * 24) * 0.002;
      truck.cabGroup.position.y = bounce;
      truck.trailerGroup.position.y = bounce * 0.7;
      truck.coolingFan.rotation.x += delta * (st.tempAlert ? 3.0 : 15.0);

      const targetAngle = st.doorOpen ? Math.PI * 0.62 : 0;
      currentDoorAngle = THREE.MathUtils.damp(currentDoorAngle, targetAngle, 6.8, delta);
      truck.leftDoorPivot.rotation.y = -currentDoorAngle;
      truck.rightDoorPivot.rotation.y = currentDoorAngle;

      truck.taillightMat.emissiveIntensity = combinedIrAlert || speedMps === 0 ? 3.2 : 0.85;

      if (combinedIrAlert) {
        truck.irBeamMat.color.setHex(0xef4444);
        truck.irBeamMat.opacity = 0.28 + 0.16 * Math.sin(elapsed * 14);
        truck.irLedMat.color.setHex(0xef4444);
        truck.irLedMat.emissive.setHex(0xef4444);
      } else {
        truck.irBeamMat.color.setHex(0x22d3ee);
        truck.irBeamMat.opacity = 0.08;
        truck.irLedMat.color.setHex(0x06b6d4);
        truck.irLedMat.emissive.setHex(0x06b6d4);
      }

      const profile = INDUSTRY_PROFILES[st.industry];
      const tempRatio = THREE.MathUtils.clamp(
        (st.temperature - profile.minSafeTemp) /
          (profile.maxSafeTemp - profile.minSafeTemp + 4),
        0,
        1,
      );
      const mistOp = st.doorOpen ? 0.08 : THREE.MathUtils.lerp(0.42, 0.06, tempRatio);
      truck.coldMistMaterial.opacity = THREE.MathUtils.damp(
        truck.coldMistMaterial.opacity,
        mistOp,
        4,
        delta,
      );
      const mistAttr = truck.coldMistPoints.geometry.attributes.position as THREE.BufferAttribute;
      for (let mi = 0; mi < mistAttr.count; mi++) {
        let mx = mistAttr.getX(mi) - delta * 1.4;
        if (mx < -4.7) mx = 1.85;
        mistAttr.setX(mi, mx);
      }
      mistAttr.needsUpdate = true;

      const strobe = 0.5 + 0.5 * Math.sin(elapsed * 12);
      const anyAlert = st.tempAlert || st.doorAlert || ir.alertActive;

      truck.doorSensorLedMat.color.setHex(
        st.doorAlert ? 0xef4444 : st.doorLocked ? 0x10b981 : 0xf59e0b,
      );
      truck.doorSensorLedMat.emissive.setHex(
        st.doorAlert ? 0xef4444 : st.doorLocked ? 0x10b981 : 0xf59e0b,
      );

      if (st.tempAlert) {
        truck.interiorStripMat.color.setHex(0xfecaca);
        truck.interiorStripMat.emissive.setHex(0xef4444);
        truck.interiorLight.color.setHex(0xf87171);
        truck.reeferStatusMat.color.setHex(0xef4444);
        truck.reeferStatusMat.emissive.setHex(0xef4444);
      } else if (st.doorAlert) {
        truck.interiorStripMat.color.setHex(0xfef08a);
        truck.interiorStripMat.emissive.setHex(0xf59e0b);
        truck.interiorLight.color.setHex(0xfbbf24);
        truck.reeferStatusMat.color.setHex(0xf59e0b);
        truck.reeferStatusMat.emissive.setHex(0xf59e0b);
      } else {
        truck.interiorStripMat.color.setHex(0xe0f2fe);
        truck.interiorStripMat.emissive.setHex(0x38bdf8);
        truck.interiorLight.color.setHex(0x7dd3fc);
        truck.reeferStatusMat.color.setHex(0x0ea5e9);
        truck.reeferStatusMat.emissive.setHex(0x38bdf8);
      }

      if (anyAlert) {
        truck.nodeLedMat.color.setHex(0xef4444);
        truck.nodeLedMat.emissive.setHex(0xef4444);
        truck.nodeLedMat.emissiveIntensity = 1.5 + strobe * 2.5;
        truck.gatewayBeaconMat.color.setHex(0xef4444);
        truck.gatewayBeaconMat.emissive.setHex(0xef4444);
        truck.gatewayBeaconMat.emissiveIntensity = 0.8 + strobe * 3.8;
        truck.gatewayBeaconLight.intensity = strobe * 4.5;
        truck.gatewayLedMat.color.setHex(0xef4444);
        truck.gatewayLedMat.emissive.setHex(0xef4444);
      } else {
        truck.nodeLedMat.color.setHex(0x10b981);
        truck.nodeLedMat.emissive.setHex(0x10b981);
        truck.nodeLedMat.emissiveIntensity = 2.0;
        truck.gatewayBeaconMat.color.setHex(0x475569);
        truck.gatewayBeaconMat.emissive.setHex(0x000000);
        truck.gatewayBeaconMat.emissiveIntensity = 0;
        truck.gatewayBeaconLight.intensity = 0;
        truck.gatewayLedMat.color.setHex(0x38bdf8);
        truck.gatewayLedMat.emissive.setHex(0x38bdf8);
      }

      (truck.gpsBeaconRing.material as THREE.MeshBasicMaterial).color.setHex(
        anyAlert ? 0xef4444 : 0x38bdf8,
      );

      if (nodePulseAgeRef.current < 1) {
        nodePulseAgeRef.current += delta * 2.2;
        const p = Math.min(nodePulseAgeRef.current, 1);
        truck.nodeTxRing.scale.setScalar(1 + p * 5.2);
        const rMat = truck.nodeTxRing.material as THREE.MeshBasicMaterial;
        rMat.color.setHex(anyAlert ? 0xef4444 : 0x38bdf8);
        rMat.opacity = (1 - p) * 0.85;
      }
      if (gatewayRxAgeRef.current < 1) {
        gatewayRxAgeRef.current += delta * 2.5;
        const p = Math.min(gatewayRxAgeRef.current, 1);
        truck.gatewayRxRing.scale.setScalar(1 + p * 4.5);
        const rxMat = truck.gatewayRxRing.material as THREE.MeshBasicMaterial;
        rxMat.color.setHex(gatewayRxAlertRef.current ? 0xef4444 : 0x10b981);
        rxMat.opacity = (1 - p) * 0.9;
      }

      telemetryVisuals.update(delta, elapsed, anyAlert, (pktAlert) => {
        gatewayRxAgeRef.current = 0;
        gatewayRxAlertRef.current = pktAlert;
      });

      // 6. Camera Follow & Preset Damping
      const isFollowing = getFollowTargetPos(st.cameraPreset, _currFollowPos);
      if (isFollowing) {
        if (hasFollowPrev && userOrbitingRef.current) {
          const dx = _currFollowPos.x - _prevFollowPos.x;
          const dy = _currFollowPos.y - _prevFollowPos.y;
          const dz = _currFollowPos.z - _prevFollowPos.z;
          camera.position.x += dx;
          camera.position.y += dy;
          camera.position.z += dz;
          controls.target.x += dx;
          controls.target.y += dy;
          controls.target.z += dz;
        }
        _prevFollowPos.copy(_currFollowPos);
        hasFollowPrev = true;
      } else {
        hasFollowPrev = false;
      }

      const preset = st.cameraPreset;
      const isVehicleCam =
        preset === 'fpv_dashcam' ||
        preset === 'follow_truck' ||
        preset === 'interior' ||
        preset === 'gateway';

      if (isVehicleCam && !userOrbitingRef.current) {
        const yaw = truck.root.rotation.y;
        if (preset === 'fpv_dashcam') {
          // Rigid driver seat lock looking forward through windshield at road ahead
          _localOffset.set(3.1, 2.62, -0.38);
          _localTargetOffset.set(28.0, 2.45, -0.38);
          _localOffset.applyAxisAngle(THREE.Object3D.DEFAULT_UP, yaw);
          _localTargetOffset.applyAxisAngle(THREE.Object3D.DEFAULT_UP, yaw);
          camera.position.copy(truck.root.position).add(_localOffset);
          controls.target.copy(truck.root.position).add(_localTargetOffset);
        } else {
          if (preset === 'follow_truck') {
            _localOffset.set(-11.5, 5.2, 7.6);
            _localTargetOffset.set(1.5, 2.0, 0.0);
          } else if (preset === 'interior') {
            _localOffset.set(-4.2, 2.4, 0.0);
            _localTargetOffset.set(1.6, 2.1, 0.0);
          } else {
            // gateway
            _localOffset.set(4.2, 4.4, 3.8);
            _localTargetOffset.set(1.5, 3.2, 0.2);
          }
          _localOffset.applyAxisAngle(THREE.Object3D.DEFAULT_UP, yaw);
          _localTargetOffset.applyAxisAngle(THREE.Object3D.DEFAULT_UP, yaw);
          _desiredCamPos.copy(truck.root.position).add(_localOffset);
          _desiredTarget.copy(truck.root.position).add(_localTargetOffset);

          const dampSpeed = cameraAnimRef.current.active ? 4.8 : 7.2;
          camera.position.x = THREE.MathUtils.damp(camera.position.x, _desiredCamPos.x, dampSpeed, delta);
          camera.position.y = THREE.MathUtils.damp(camera.position.y, _desiredCamPos.y, dampSpeed, delta);
          camera.position.z = THREE.MathUtils.damp(camera.position.z, _desiredCamPos.z, dampSpeed, delta);

          controls.target.x = THREE.MathUtils.damp(controls.target.x, _desiredTarget.x, dampSpeed, delta);
          controls.target.y = THREE.MathUtils.damp(controls.target.y, _desiredTarget.y, dampSpeed, delta);
          controls.target.z = THREE.MathUtils.damp(controls.target.z, _desiredTarget.z, dampSpeed, delta);
        }
      } else if (!isVehicleCam && cameraAnimRef.current.active && !userOrbitingRef.current) {
        if (preset === 'godown') {
          _desiredCamPos.set(-20.5, 7.6, 19.5);
          _desiredTarget.set(-32.2, 2.2, 32.0);
        } else if (preset === 'forest') {
          _desiredCamPos.set(-41, 13.5, 10);
          _desiredTarget.set(-58, 2.5, -4);
        } else if (preset === 'bridge') {
          _desiredCamPos.set(24, 12.5, 22);
          _desiredTarget.set(41, 2.0, 4);
        } else if (preset === 'bus_stand') {
          _desiredCamPos.set(-18, 8.5, 29);
          _desiredTarget.set(-8, 2.2, 18.2);
        } else {
          // city
          _desiredCamPos.set(6, 74, 88);
          _desiredTarget.set(8, 0, -4);
        }

        camera.position.x = THREE.MathUtils.damp(camera.position.x, _desiredCamPos.x, 4.8, delta);
        camera.position.y = THREE.MathUtils.damp(camera.position.y, _desiredCamPos.y, 4.8, delta);
        camera.position.z = THREE.MathUtils.damp(camera.position.z, _desiredCamPos.z, 4.8, delta);

        controls.target.x = THREE.MathUtils.damp(controls.target.x, _desiredTarget.x, 4.8, delta);
        controls.target.y = THREE.MathUtils.damp(controls.target.y, _desiredTarget.y, 4.8, delta);
        controls.target.z = THREE.MathUtils.damp(controls.target.z, _desiredTarget.z, 4.8, delta);

        if (
          camera.position.distanceTo(_desiredCamPos) < 0.14 &&
          controls.target.distanceTo(_desiredTarget) < 0.14
        ) {
          cameraAnimRef.current.active = false;
        }
      }

      controls.update();
      renderer.render(scene, camera);

      // 7. Project 3D Callouts for TRUCK-01
      const cw = container?.clientWidth || window.innerWidth;
      const ch = container?.clientHeight || window.innerHeight;
      callbacksRef.current.onAnchorsFrame({
        node: { id: 'node', ...projectObjectToScreen(truck.anchorNode, camera, cw, ch) },
        gateway: { id: 'gateway', ...projectObjectToScreen(truck.anchorGateway, camera, cw, ch) },
        cargo: { id: 'cargo', ...projectObjectToScreen(truck.anchorCargo, camera, cw, ch) },
        door: { id: 'door', ...projectObjectToScreen(truck.anchorDoorSensor, camera, cw, ch) },
        ir: { id: 'ir', ...projectObjectToScreen(truck.anchorIrSensor, camera, cw, ch) },
      });

      // 8. Emit Live GPS Snapshot (~5Hz)
      if (elapsed - lastGpsEmit > 0.2) {
        lastGpsEmit = elapsed;
        const g = worldToGps(truck.root.position.x, truck.root.position.z);
        const headingDeg = Math.round((Math.atan2(_tan.x, -_tan.z) * 180) / Math.PI);
        callbacksRef.current.onGpsUpdate({
          truck: {
            id: 'TRUCK-01',
            label: 'ColdChain Unit TC-408',
            x: truck.root.position.x,
            z: truck.root.position.z,
            headingDeg,
            lat: g.lat,
            lng: g.lng,
            zoneLabel: g.zoneLabel,
            speedKmh: Math.round(speedMps * 3.6),
            phase: m.phase,
            progress: m.t,
            alert: anyAlert,
            industry: st.industry,
            routeId: st.routeId,
          },
          traffic: town.trafficVehicles.map((v) => ({
            id: v.id,
            vehicleType: v.vehicleType,
            label: v.label,
            lat: v.lat,
            lng: v.lng,
            zoneLabel: v.zoneLabel,
          })),
          routeGeoPaths: town.routeGeoPaths,
        });
      }

      thermalGrid.update(st.temperature, st.doorOpen, delta, elapsed);
      thermalGrid.setVisible(Boolean(st.showHeatmapGrid));
      weatherSystem.update(st.weather || 'clear', truck.root.position, speedMps * 3.6, delta);

      if (isSoftwareGl) {
        afterDraw(tick);
      } else {
        frameId = requestAnimationFrame(tick);
      }
    }

    tick();

    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth || window.innerWidth;
      const h = container.clientHeight || window.innerHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      window.removeEventListener('resize', handleResize);
      controls.removeEventListener('start', onControlsStart);
      controls.dispose();
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
      renderer.domElement.removeEventListener('webglcontextrestored', onContextRestored);

      thermalGrid.dispose();
      weatherSystem.dispose();
      town.dispose();
      truck.dispose();
      telemetryVisuals.dispose();
      envTex.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
      truckRef.current = null;
      telemetryVisualsRef.current = null;
      townRef.current = null;
    };
  }, []);

  return (
    <div className="relative w-full h-full">
      <div ref={mountRef} className="w-full h-full cursor-grab active:cursor-grabbing" />
      {contextLost && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-950/95 text-slate-200 z-30">
          <div className="max-w-md text-center px-6 py-5 border border-slate-800 rounded-xl bg-slate-900">
            <h2 className="text-base font-semibold text-white">3D Viewport Suspended</h2>
            <p className="mt-2 text-sm text-slate-400">
              WebGL rendering context was interrupted. Reload the page to resume the 3D simulation.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
