import { useState, useEffect, useRef, useCallback } from 'react';
import {
  IndustryId,
  INDUSTRY_PROFILES,
  TruckRouteId,
  MissionPhase,
  LoadingSubStage,
  TimeOfDay,
  WallMode,
  CameraPreset,
  PhoneAlertMessage,
  TelemetryPacket,
  GpsSnapshot,
} from '../types/cargoguard';
import { playAlertTone, playPacketTick } from '../utils/soundAlerts';

export type TwinOperationMode = 'live' | 'simulation';

export interface LiveDeviceTelemetry {
  deviceId: string;
  temperature: number | null;
  ambientTemp: number;
  doorStatus: 'SEALED' | 'OPEN';
  speedKmh: number;
  latitude: number | null;
  longitude: number | null;
  tamper: boolean;
  compressorActive: boolean;
  connectivity: 'ONLINE' | 'STANDBY' | 'OFFLINE';
  lastUpdatedMs: number;
}

interface UseLiveTwinBridgeProps {
  liveDevice?: LiveDeviceTelemetry | null;
  onTriggerBackendAction?: (action: 'COMPRESSOR_FAULT' | 'DOOR_BREACH' | 'RESTORE_NORMAL') => void;
}

export function useLiveTwinBridge({ liveDevice, onTriggerBackendAction }: UseLiveTwinBridgeProps) {
  // Mode: 'simulation' by default on Twin World page for instant interactive client demos; 'live' binds directly to physical GW-001 hardware
  const [mode, setMode] = useState<TwinOperationMode>('simulation');

  // Industry & Configuration
  const [industry, setIndustry] = useState<IndustryId>('vaccines');
  const [routeId, setRouteId] = useState<TruckRouteId>('orr_forest_bridge');
  const [wallMode, setWallMode] = useState<WallMode>('cutaway');
  const [timeOfDay, setTimeOfDay] = useState<TimeOfDay>('day');

  // Simulation State
  const [targetTemperature, setTargetTemperature] = useState<number>(INDUSTRY_PROFILES.vaccines.nominalTemp);
  const [simTemperature, setSimTemperature] = useState<number>(INDUSTRY_PROFILES.vaccines.nominalTemp);
  const [simDoorOpen, setSimDoorOpen] = useState<boolean>(true);
  const [simDoorLocked, setSimDoorLocked] = useState<boolean>(false);
  const [missionPhase, setMissionPhase] = useState<MissionPhase>('loading_godown');
  const [loadingSubStage, setLoadingSubStage] = useState<LoadingSubStage>('opening_door');
  const [autoCycleMission, setAutoCycleMission] = useState<boolean>(true);

  // IR Obstacle Sensor Triggers
  const [irHazardTriggerId, setIrHazardTriggerId] = useState<number>(0);
  const [irClearTriggerId, setIrClearTriggerId] = useState<number>(0);
  const [irAlertActive, setIrAlertActive] = useState<boolean>(false);
  const [irDistM, setIrDistM] = useState<number | null>(null);

  // Camera & Navigation
  const [cameraPreset, setCameraPreset] = useState<CameraPreset>('godown');
  const [cameraTriggerId, setCameraTriggerId] = useState<number>(0);
  const [showCallouts, setShowCallouts] = useState<boolean>(true);

  // Packets & Alerts
  const [packetPulseId, setPacketPulseId] = useState<number>(1);
  const [phoneAlerts, setPhoneAlerts] = useState<PhoneAlertMessage[]>([]);
  const phoneAlertIdRef = useRef(1);

  // Jump Command for timeline scrubber / instant zones
  const [jumpCommand, setJumpCommand] = useState<{
    phase: MissionPhase;
    subStage?: LoadingSubStage;
    targetT?: number;
    id: number;
  } | null>(null);

  // Sync with Live Hardware when in 'live' mode
  const currentProfile = INDUSTRY_PROFILES[industry];
  const isLive = mode === 'live';

  const effectiveTemperature = isLive
    ? (liveDevice?.temperature !== null && liveDevice?.temperature !== undefined
        ? liveDevice.temperature
        : currentProfile.nominalTemp)
    : simTemperature;

  const effectiveDoorOpen = isLive
    ? (liveDevice?.doorStatus === 'OPEN')
    : simDoorOpen;

  const effectiveDoorLocked = isLive
    ? (liveDevice?.doorStatus === 'SEALED')
    : simDoorLocked;

  const isTempExcursion = effectiveTemperature < currentProfile.minSafeTemp || effectiveTemperature > currentProfile.maxSafeTemp;
  const isDoorTamper = isLive
    ? (liveDevice?.doorStatus === 'OPEN' && (liveDevice?.speedKmh || 0) > 2)
    : (simDoorOpen && missionPhase === 'in_transit');

  // Trigger pulse whenever live device sends an update
  const lastLiveUpdateMs = liveDevice?.lastUpdatedMs || 0;
  useEffect(() => {
    if (isLive && lastLiveUpdateMs > 0) {
      setPacketPulseId((p) => p + 1);
      playPacketTick(isTempExcursion);
    }
  }, [isLive, lastLiveUpdateMs, isTempExcursion]);

  // Audio tone playback for alerts
  useEffect(() => {
    if (isTempExcursion) {
      playAlertTone('temp_critical');
    } else if (isDoorTamper) {
      playAlertTone('door_tamper');
    }
  }, [isTempExcursion, isDoorTamper]);

  // Add Phone Alert Helper
  const addPhoneAlert = useCallback((kind: 'temp_high' | 'door_tamper' | 'ir_collision', title: string, body: string, location: string) => {
    const newAlert: PhoneAlertMessage = {
      id: phoneAlertIdRef.current++,
      timestamp: new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      kind,
      title,
      body,
      location,
    };
    setPhoneAlerts((prev) => [newAlert, ...prev.slice(0, 8)]);
  }, []);

  const dismissPhoneAlert = useCallback((id: number) => {
    setPhoneAlerts((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const clearPhoneAlerts = useCallback(() => {
    setPhoneAlerts([]);
  }, []);

  // Quick Scenario Buttons for Client Demo
  const triggerSpikeTemp = useCallback(() => {
    if (isLive && onTriggerBackendAction) {
      onTriggerBackendAction('COMPRESSOR_FAULT');
    } else {
      const spike = currentProfile.maxSafeTemp + 4.5;
      setSimTemperature(spike);
      addPhoneAlert(
        'temp_high',
        'Temperature Excursion Alert',
        `Cargo chamber reached ${spike.toFixed(1)}°C (Safe Range: ${currentProfile.minSafeTemp} - ${currentProfile.maxSafeTemp}°C)`,
        'ORR Express Corridor'
      );
    }
  }, [isLive, onTriggerBackendAction, currentProfile, addPhoneAlert]);

  const toggleDoor = useCallback(() => {
    if (isLive && onTriggerBackendAction) {
      onTriggerBackendAction(liveDevice?.doorStatus === 'OPEN' ? 'RESTORE_NORMAL' : 'DOOR_BREACH');
    } else {
      setSimDoorOpen((prev) => {
        const next = !prev;
        setSimDoorLocked(!next);
        if (next && missionPhase === 'in_transit') {
          addPhoneAlert(
            'door_tamper',
            'Unauthorized Door Breach',
            'Chamber rear security seal opened while vehicle in motion',
            'NH-44 Forest Highway'
          );
        }
        return next;
      });
    }
  }, [isLive, onTriggerBackendAction, liveDevice?.doorStatus, missionPhase, addPhoneAlert]);

  const triggerIrHazard = useCallback(() => {
    setIrHazardTriggerId((id) => id + 1);
    addPhoneAlert(
      'ir_collision',
      'Forward Collision Warning',
      'Front IR sensor detected stationary hazard in lane. Auto-braking engaged.',
      'River Bridge Crossing'
    );
  }, [addPhoneAlert]);

  const clearIrHazard = useCallback(() => {
    setIrClearTriggerId((id) => id + 1);
  }, []);

  const resetAllAlerts = useCallback(() => {
    if (isLive && onTriggerBackendAction) {
      onTriggerBackendAction('RESTORE_NORMAL');
    }
    setSimTemperature(currentProfile.nominalTemp);
    setSimDoorOpen(false);
    setSimDoorLocked(true);
    clearIrHazard();
    clearPhoneAlerts();
  }, [isLive, onTriggerBackendAction, currentProfile.nominalTemp, clearIrHazard, clearPhoneAlerts]);

  const selectIndustry = useCallback((newInd: IndustryId) => {
    setIndustry(newInd);
    const prof = INDUSTRY_PROFILES[newInd];
    setTargetTemperature(prof.nominalTemp);
    setSimTemperature(prof.nominalTemp);
  }, []);

  const selectCamera = useCallback((preset: CameraPreset) => {
    setCameraPreset(preset);
    setCameraTriggerId((id) => id + 1);
  }, []);

  const jumpToZone = useCallback((zone: 'loading' | 'highway' | 'bridge' | 'hospital') => {
    if (zone === 'loading') {
      setJumpCommand({ phase: 'loading_godown', subStage: 'opening_door', targetT: 0, id: Date.now() });
      selectCamera('godown');
      setSimDoorOpen(true);
      setSimDoorLocked(false);
    } else if (zone === 'highway') {
      setJumpCommand({ phase: 'in_transit', targetT: 0.08, id: Date.now() });
      selectCamera('follow_truck');
      setSimDoorOpen(false);
      setSimDoorLocked(true);
    } else if (zone === 'bridge') {
      setJumpCommand({ phase: 'in_transit', targetT: 0.54, id: Date.now() });
      selectCamera('bridge');
      setSimDoorOpen(false);
      setSimDoorLocked(true);
    } else if (zone === 'hospital') {
      setJumpCommand({ phase: 'unloading_dest', id: Date.now() });
      selectCamera('city');
      setSimDoorOpen(true);
      setSimDoorLocked(false);
    }
  }, [selectCamera]);

  return {
    mode,
    setMode,
    industry,
    selectIndustry,
    currentProfile,
    routeId,
    setRouteId,
    wallMode,
    setWallMode,
    timeOfDay,
    setTimeOfDay,
    temperature: effectiveTemperature,
    targetTemperature,
    setTargetTemperature,
    simTemperature,
    setSimTemperature,
    doorOpen: effectiveDoorOpen,
    simDoorOpen,
    setSimDoorOpen,
    doorLocked: effectiveDoorLocked,
    simDoorLocked,
    setSimDoorLocked,
    tempAlert: isTempExcursion,
    doorAlert: isDoorTamper,
    missionPhase,
    setMissionPhase,
    loadingSubStage,
    setLoadingSubStage,
    autoCycleMission,
    setAutoCycleMission,
    irHazardTriggerId,
    irClearTriggerId,
    irAlertActive,
    setIrAlertActive,
    irDistM,
    setIrDistM,
    cameraPreset,
    cameraTriggerId,
    selectCamera,
    showCallouts,
    setShowCallouts,
    packetPulseId,
    phoneAlerts,
    dismissPhoneAlert,
    clearPhoneAlerts,
    jumpCommand,
    setJumpCommand,
    jumpToZone,
    triggerSpikeTemp,
    toggleDoor,
    triggerIrHazard,
    clearIrHazard,
    resetAllAlerts,
  };
}
