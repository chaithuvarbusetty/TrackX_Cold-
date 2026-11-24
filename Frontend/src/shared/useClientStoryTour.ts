import { useState, useEffect, useRef, useCallback } from 'react';
import type { CameraPreset, IndustryId, LoadingSubStage, MissionPhase, TimeOfDay } from '../types/cargoguard';
import type { WeatherType } from '../three/town/weatherParticles';

export interface StoryStageInfo {
  index: number;
  id: 'loading' | 'highway' | 'emergency' | 'delivery';
  label: string;
  startSec: number;
  endSec: number;
  subtitle: string;
}

export const STORY_STAGES: StoryStageInfo[] = [
  {
    index: 1,
    id: 'loading',
    label: '1. Godown Loading',
    startSec: 0,
    endSec: 20,
    subtitle: 'STAGE 1: Cold Godown Dispatch · Loading 12,000 mRNA Vaccine Vials (Safe Range: 2.0 - 8.0°C)',
  },
  {
    index: 2,
    id: 'highway',
    label: '2. Night Highway',
    startSec: 20,
    endSec: 45,
    subtitle: 'STAGE 2: NH-44 Express Highway · Active Telemetry & Night Transit with Driver Windshield Dashcam',
  },
  {
    index: 3,
    id: 'emergency',
    label: '3. Breach Alarm',
    startSec: 45,
    endSec: 70,
    subtitle: 'STAGE 3: Mid-Route Incident · Rear Security Seal Breach Detected! Automated Siren & Instant Cellular Alert',
  },
  {
    index: 4,
    id: 'delivery',
    label: '4. Hospital Delivery',
    startSec: 70,
    endSec: 90,
    subtitle: 'STAGE 4: Metro Bio-Hospital Delivery · Full Thermal Recovery & 100% Cold Chain Integrity Verified',
  },
];

interface UseClientStoryTourProps {
  onSetMode: (mode: 'live' | 'simulation') => void;
  onSelectIndustry: (ind: IndustryId) => void;
  onSelectCamera: (cam: CameraPreset) => void;
  onSetTimeOfDay: (tod: TimeOfDay) => void;
  onSetMissionPhase: (phase: MissionPhase) => void;
  onSetLoadingSubStage: (stage: LoadingSubStage) => void;
  onSetWallMode: (mode: 'cutaway' | 'solid') => void;
  onSpikeTemp: () => void;
  onToggleDoor: () => void;
  onResetAlerts: () => void;
  onSetPhoneDrawerOpen: (open: boolean) => void;
  onSetJumpCommand: (cmd: { phase: MissionPhase; subStage?: LoadingSubStage; targetT?: number; id: number }) => void;
  onSetSimDoorOpen: (open: boolean) => void;
  onSetSimDoorLocked: (locked: boolean) => void;
  onSetSimTemperature: (temp: number) => void;
  onSetWeather?: (w: WeatherType) => void;
  onSetShowHeatmapGrid?: (show: boolean) => void;
}

export function useClientStoryTour({
  onSetMode,
  onSelectIndustry,
  onSelectCamera,
  onSetTimeOfDay,
  onSetMissionPhase,
  onSetLoadingSubStage,
  onSetWallMode,
  onSpikeTemp,
  onToggleDoor,
  onResetAlerts,
  onSetPhoneDrawerOpen,
  onSetJumpCommand,
  onSetSimDoorOpen,
  onSetSimDoorLocked,
  onSetSimTemperature,
  onSetWeather,
  onSetShowHeatmapGrid,
}: UseClientStoryTourProps) {
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [elapsedSec, setElapsedSec] = useState<number>(0);
  const [showVerifiedStamp, setShowVerifiedStamp] = useState<boolean>(false);

  const timerRef = useRef<number | null>(null);
  const currentStageRef = useRef<number>(0);
  const emergencyTriggeredRef = useRef<boolean>(false);
  const recoveryTriggeredRef = useRef<boolean>(false);

  const TOTAL_DURATION = 90;

  const currentStage = STORY_STAGES.find(
    (s) => elapsedSec >= s.startSec && elapsedSec < s.endSec
  ) || STORY_STAGES[STORY_STAGES.length - 1];

  const stopTour = useCallback(() => {
    setIsPlaying(false);
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setShowVerifiedStamp(false);
    emergencyTriggeredRef.current = false;
    recoveryTriggeredRef.current = false;
    currentStageRef.current = 0;
  }, []);

  const jumpToStage = useCallback((stageIndex: number) => {
    const target = STORY_STAGES.find((s) => s.index === stageIndex);
    if (!target) return;
    setElapsedSec(target.startSec);
    emergencyTriggeredRef.current = false;
    recoveryTriggeredRef.current = false;
    setShowVerifiedStamp(false);
    currentStageRef.current = stageIndex;

    onSetMode('simulation');
    onSetWallMode('cutaway');

    if (stageIndex === 1) {
      onSelectIndustry('vaccines');
      onSetTimeOfDay('day');
      onSetWeather?.('clear');
      onSetShowHeatmapGrid?.(true);
      onSetSimDoorOpen(true);
      onSetSimDoorLocked(false);
      onSetSimTemperature(3.8);
      onSetMissionPhase('loading_godown');
      onSetLoadingSubStage('opening_door');
      onSelectCamera('godown');
      onResetAlerts();
      onSetPhoneDrawerOpen(false);
      onSetJumpCommand({
        phase: 'loading_godown',
        subStage: 'opening_door',
        targetT: 0,
        id: Date.now(),
      });
    } else if (stageIndex === 2) {
      onSetTimeOfDay('night');
      onSetWeather?.('clear');
      onSetSimDoorOpen(false);
      onSetSimDoorLocked(true);
      onSetSimTemperature(4.2);
      onSetMissionPhase('in_transit');
      onSetLoadingSubStage('complete');
      onSelectCamera('follow_truck');
      onResetAlerts();
      onSetPhoneDrawerOpen(false);
      onSetJumpCommand({
        phase: 'in_transit',
        targetT: 0.1,
        id: Date.now(),
      });
    } else if (stageIndex === 3) {
      onSetTimeOfDay('night');
      onSetMissionPhase('in_transit');
      onSetLoadingSubStage('complete');
      onSelectCamera('interior');
      onSetJumpCommand({
        phase: 'in_transit',
        targetT: 0.44,
        id: Date.now(),
      });
      emergencyTriggeredRef.current = true;
      onToggleDoor();
      onSpikeTemp();
      onSetPhoneDrawerOpen(true);
    } else if (stageIndex === 4) {
      onSetTimeOfDay('day');
      onResetAlerts();
      onSetPhoneDrawerOpen(false);
      onSetMissionPhase('unloading_dest');
      onSetLoadingSubStage('complete');
      onSelectCamera('interior');
      setShowVerifiedStamp(true);
      onSetJumpCommand({
        phase: 'unloading_dest',
        id: Date.now(),
      });
    }
  }, [
    onSetMode,
    onSetWallMode,
    onSelectIndustry,
    onSetTimeOfDay,
    onSetWeather,
    onSetShowHeatmapGrid,
    onSetSimDoorOpen,
    onSetSimDoorLocked,
    onSetSimTemperature,
    onSetMissionPhase,
    onSetLoadingSubStage,
    onSelectCamera,
    onResetAlerts,
    onSetPhoneDrawerOpen,
    onSetJumpCommand,
    onToggleDoor,
    onSpikeTemp,
  ]);

  const startTour = useCallback(() => {
    stopTour();
    setElapsedSec(0);
    setIsPlaying(true);
    setShowVerifiedStamp(false);
    emergencyTriggeredRef.current = false;
    recoveryTriggeredRef.current = false;
    currentStageRef.current = 1;

    // Initial setup for Stage 1 (0:00 - 0:20)
    onSetMode('simulation');
    onSelectIndustry('vaccines');
    onSetWallMode('cutaway');
    onSetTimeOfDay('day');
    onSetWeather?.('clear');
    onSetShowHeatmapGrid?.(true);
    onSetSimDoorOpen(true);
    onSetSimDoorLocked(false);
    onSetSimTemperature(3.8);
    onSetMissionPhase('loading_godown');
    onSetLoadingSubStage('opening_door');
    onSelectCamera('godown');
    onResetAlerts();
    onSetPhoneDrawerOpen(false);
    onSetJumpCommand({
      phase: 'loading_godown',
      subStage: 'opening_door',
      targetT: 0,
      id: Date.now(),
    });
  }, [
    stopTour,
    onSetMode,
    onSelectIndustry,
    onSetWallMode,
    onSetTimeOfDay,
    onSetWeather,
    onSetShowHeatmapGrid,
    onSetSimDoorOpen,
    onSetSimDoorLocked,
    onSetSimTemperature,
    onSetMissionPhase,
    onSetLoadingSubStage,
    onSelectCamera,
    onResetAlerts,
    onSetPhoneDrawerOpen,
    onSetJumpCommand,
  ]);

  // Main 1-second interval execution loop
  useEffect(() => {
    if (!isPlaying) return;

    timerRef.current = window.setInterval(() => {
      setElapsedSec((prev) => {
        const next = prev + 1;
        if (next >= TOTAL_DURATION) {
          setIsPlaying(false);
          setShowVerifiedStamp(true);
          return TOTAL_DURATION;
        }
        return next;
      });
    }, 1000);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [isPlaying]);

  // Handle stage events on elapsedSec change
  useEffect(() => {
    if (!isPlaying) return;

    // --- STAGE 1: 0 - 20s (Warehouse Loading Bay) ---
    if (elapsedSec >= 0 && elapsedSec < 20) {
      if (currentStageRef.current !== 1) {
        currentStageRef.current = 1;
        onSetMissionPhase('loading_godown');
        onSetTimeOfDay('day');
        onSelectCamera('godown');
        onSetPhoneDrawerOpen(false);
        onSetSimDoorOpen(true);
        onSetSimDoorLocked(false);
        onSetJumpCommand({
          phase: 'loading_godown',
          subStage: 'opening_door',
          targetT: 0,
          id: Date.now(),
        });
      }
      if (elapsedSec < 7) {
        onSetLoadingSubStage('opening_door');
      } else if (elapsedSec < 14) {
        onSetLoadingSubStage('loading_inside');
      } else {
        onSetLoadingSubStage('locking_door');
        onSetSimDoorOpen(false);
        onSetSimDoorLocked(true);
      }
    }

    // --- STAGE 2: 20 - 45s (Highway Drive & Night Lighting) ---
    else if (elapsedSec >= 20 && elapsedSec < 45) {
      if (currentStageRef.current !== 2) {
        currentStageRef.current = 2;
        onSetMissionPhase('in_transit');
        onSetLoadingSubStage('complete');
        onSetSimDoorOpen(false);
        onSetSimDoorLocked(true);
        onSelectCamera('follow_truck');
        onSetJumpCommand({
          phase: 'in_transit',
          targetT: 0.05,
          id: Date.now(),
        });
      }
      if (elapsedSec === 28) {
        // Show in-cabin FPV dashcam looking through windshield
        onSelectCamera('fpv_dashcam');
      }
      if (elapsedSec === 35) {
        // Night transition
        onSetTimeOfDay('night');
      }
      if (elapsedSec === 40) {
        onSelectCamera('follow_truck');
      }
    }

    // --- STAGE 3: 45 - 70s (Mid-Route Emergency Incident) ---
    else if (elapsedSec >= 45 && elapsedSec < 70) {
      if (currentStageRef.current !== 3) {
        currentStageRef.current = 3;
        onSelectCamera('interior');
        onSetJumpCommand({
          phase: 'in_transit',
          targetT: 0.42,
          id: Date.now(),
        });
      }
      // Trigger breach at 48s
      if (elapsedSec >= 48 && !emergencyTriggeredRef.current) {
        emergencyTriggeredRef.current = true;
        onToggleDoor();
        onSpikeTemp();
        onSetPhoneDrawerOpen(true);
      }
      if (elapsedSec === 58) {
        onSelectCamera('follow_truck');
      }
    }

    // --- STAGE 4: 70 - 90s (Recovery & Hospital Delivery) ---
    else if (elapsedSec >= 70 && elapsedSec <= 90) {
      if (currentStageRef.current !== 4) {
        currentStageRef.current = 4;
        currentStageRef.current = 4;
        onSetTimeOfDay('day');
        onSelectCamera('city');
        onSetJumpCommand({
          phase: 'in_transit',
          targetT: 0.65,
          id: Date.now(),
        });
      }
      // Recover at 72s
      if (elapsedSec >= 72 && !recoveryTriggeredRef.current) {
        recoveryTriggeredRef.current = true;
        onResetAlerts();
        onSetPhoneDrawerOpen(false);
      }
      if (elapsedSec === 80) {
        onSetMissionPhase('unloading_dest');
        onSelectCamera('interior');
        setShowVerifiedStamp(true);
        onSetJumpCommand({
          phase: 'unloading_dest',
          id: Date.now(),
        });
      }
    }
  }, [
    elapsedSec,
    isPlaying,
    onSetMissionPhase,
    onSetTimeOfDay,
    onSelectCamera,
    onSetPhoneDrawerOpen,
    onSetLoadingSubStage,
    onSetJumpCommand,
    onSetSimDoorOpen,
    onSetSimDoorLocked,
    onToggleDoor,
    onSpikeTemp,
    onResetAlerts,
  ]);

  return {
    isPlaying,
    elapsedSec,
    totalDuration: TOTAL_DURATION,
    currentStage,
    showVerifiedStamp,
    startTour,
    stopTour,
    jumpToStage,
    setShowVerifiedStamp,
  };
}
