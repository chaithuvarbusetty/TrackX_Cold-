import React, { useState, useRef } from 'react';
import {
  Sun,
  Moon,
  Volume2,
  VolumeX,
  Smartphone,
  Eye,
  EyeOff,
  RotateCcw,
  AlertTriangle,
  ShieldAlert,
  Car,
  Radio,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Play,
  Pause,
  Square,
  CloudRain,
  Flame,
  CheckCircle2,
  Compass,
  Gauge,
  ThermometerSnowflake,
  ShieldCheck,
  X,
} from 'lucide-react';
import { ColdChainViewport } from '../three/town/ColdChainViewport';
import { DriverPhoneDrawer } from './DriverPhoneDrawer';
import { useLiveTwinBridge, LiveDeviceTelemetry } from '../shared/useLiveTwinBridge';
import { useClientStoryTour, STORY_STAGES } from '../shared/useClientStoryTour';
import {
  AnchorMap,
  CameraPreset,
  GpsSnapshot,
  INDUSTRY_LIST,
} from '../types/cargoguard';
import type { WeatherType } from '../three/town/weatherParticles';
import { isAudioMuted, setAudioMuted } from '../utils/soundAlerts';

interface TwinWorldPageProps {
  liveDevice?: LiveDeviceTelemetry | null;
  onTriggerBackendAction?: (action: 'COMPRESSOR_FAULT' | 'DOOR_BREACH' | 'RESTORE_NORMAL') => void;
}

export const TwinWorldPage: React.FC<TwinWorldPageProps> = ({
  liveDevice,
  onTriggerBackendAction,
}) => {
  const bridge = useLiveTwinBridge({
    liveDevice,
    onTriggerBackendAction,
  });

  const [soundMuted, setSoundMuted] = useState<boolean>(() => isAudioMuted());
  const [phoneDrawerOpen, setPhoneDrawerOpen] = useState<boolean>(false);
  const [activeDockTab, setActiveDockTab] = useState<'industries' | 'cameras' | 'scenarios' | 'environment'>('industries');
  const [dockCollapsed, setDockCollapsed] = useState<boolean>(false);

  // New Features State
  const [weather, setWeather] = useState<WeatherType>('clear');
  const [showHeatmapGrid, setShowHeatmapGrid] = useState<boolean>(false);
  const [gpsSnapshot, setGpsSnapshot] = useState<GpsSnapshot | null>(null);

  // Client Story Tour Hook
  const tour = useClientStoryTour({
    onSetMode: bridge.setMode,
    onSelectIndustry: bridge.selectIndustry,
    onSelectCamera: bridge.selectCamera,
    onSetTimeOfDay: bridge.setTimeOfDay,
    onSetMissionPhase: bridge.setMissionPhase,
    onSetLoadingSubStage: bridge.setLoadingSubStage,
    onSetWallMode: bridge.setWallMode,
    onSpikeTemp: bridge.triggerSpikeTemp,
    onToggleDoor: bridge.toggleDoor,
    onResetAlerts: bridge.resetAllAlerts,
    onSetPhoneDrawerOpen: setPhoneDrawerOpen,
    onSetJumpCommand: bridge.setJumpCommand,
    onSetSimDoorOpen: bridge.setSimDoorOpen,
    onSetSimDoorLocked: bridge.setSimDoorLocked,
    onSetSimTemperature: bridge.setSimTemperature,
    onSetWeather: setWeather,
    onSetShowHeatmapGrid: setShowHeatmapGrid,
  });

  // 3D Anchor DOM elements for floating callout pins
  const anchorNodeRef = useRef<HTMLDivElement | null>(null);
  const anchorGatewayRef = useRef<HTMLDivElement | null>(null);
  const anchorCargoRef = useRef<HTMLDivElement | null>(null);
  const anchorDoorRef = useRef<HTMLDivElement | null>(null);
  const anchorIrRef = useRef<HTMLDivElement | null>(null);

  const handleAnchorsFrame = (anchors: AnchorMap) => {
    const applyPos = (el: HTMLDivElement | null, a: { x: number; y: number; visible: boolean }) => {
      if (!el) return;
      if (!a.visible || !bridge.showCallouts || bridge.cameraPreset === 'fpv_dashcam') {
        el.style.opacity = '0';
        return;
      }
      el.style.opacity = '1';
      el.style.transform = `translate3d(${a.x}px, ${a.y}px, 0)`;
    };

    applyPos(anchorNodeRef.current, anchors.node);
    applyPos(anchorGatewayRef.current, anchors.gateway);
    applyPos(anchorCargoRef.current, anchors.cargo);
    applyPos(anchorDoorRef.current, anchors.door);
    applyPos(anchorIrRef.current, anchors.ir);
  };

  const handleToggleSound = () => {
    const next = !soundMuted;
    setSoundMuted(next);
    setAudioMuted(next);
  };

  const alertCount = bridge.phoneAlerts.length;
  const isFpv = bridge.cameraPreset === 'fpv_dashcam';

  return (
    <div className="relative w-full h-[calc(100vh-4rem)] bg-slate-950 overflow-hidden select-none">
      {/* 3D WebGL Canvas Layer */}
      <div className="absolute inset-0">
        <ColdChainViewport
          industry={bridge.industry}
          routeId={bridge.routeId}
          wallMode={bridge.wallMode}
          timeOfDay={bridge.timeOfDay}
          weather={weather}
          showHeatmapGrid={showHeatmapGrid}
          temperature={bridge.temperature}
          doorOpen={bridge.doorOpen}
          doorLocked={bridge.doorLocked}
          tempAlert={bridge.tempAlert}
          doorAlert={bridge.doorAlert}
          irHazardTriggerId={bridge.irHazardTriggerId}
          irClearTriggerId={bridge.irClearTriggerId}
          autoCycleMission={bridge.autoCycleMission}
          cameraPreset={bridge.cameraPreset}
          cameraTriggerId={bridge.cameraTriggerId}
          jumpCommand={bridge.jumpCommand}
          packetPulseId={bridge.packetPulseId}
          onAnchorsFrame={handleAnchorsFrame}
          onMissionUpdate={(phase, subStage, doorShouldBeOpen, locked) => {
            bridge.setMissionPhase(phase);
            bridge.setLoadingSubStage(subStage);
            bridge.setSimDoorOpen(doorShouldBeOpen);
            bridge.setSimDoorLocked(locked);
            if (!tour.isPlaying) {
              if (phase === 'in_transit' && bridge.cameraPreset === 'godown') {
                bridge.selectCamera('follow_truck');
              } else if (phase === 'loading_godown' && bridge.cameraPreset === 'follow_truck') {
                bridge.selectCamera('godown');
              } else if (phase === 'unloading_dest' && bridge.cameraPreset === 'follow_truck') {
                bridge.selectCamera('city');
              }
            }
          }}
          onGpsUpdate={(snap) => setGpsSnapshot(snap)}
          onIrAlertChange={(active, distM) => {
            bridge.setIrAlertActive(active);
            bridge.setIrDistM(distM);
          }}
        />
      </div>

      {/* 3D Screen Projected HTML Callout Pins */}
      <div className={bridge.showCallouts && !isFpv ? 'block' : 'hidden'}>
        <div ref={anchorNodeRef} className="fixed top-0 left-0 pointer-events-none transition-opacity duration-150 z-20">
          <div className="-translate-x-1/2 -translate-y-full pb-2">
            <div className={`px-2.5 py-1 rounded-lg border text-[11px] shadow-lg backdrop-blur-md ${
              bridge.tempAlert ? 'bg-red-950/90 border-red-400 text-red-100' : 'bg-slate-950/90 border-sky-400/60 text-slate-100'
            }`}>
              <div className="font-semibold whitespace-nowrap flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-sky-400 animate-ping" />
                <span>DS18B20 Internal Probe</span>
              </div>
              <div className="font-mono text-[10px] text-slate-300">
                {bridge.temperature.toFixed(1)}°C (Safe: {bridge.currentProfile.minSafeTemp}-{bridge.currentProfile.maxSafeTemp}°C)
              </div>
            </div>
          </div>
        </div>

        <div ref={anchorGatewayRef} className="fixed top-0 left-0 pointer-events-none transition-opacity duration-150 z-20">
          <div className="-translate-x-1/2 -translate-y-full pb-2">
            <div className="px-2.5 py-1 rounded-lg border border-emerald-400/60 bg-slate-950/90 backdrop-blur-md text-[11px] text-slate-100 shadow-lg">
              <div className="font-semibold whitespace-nowrap flex items-center gap-1">
                <Radio className="h-3 w-3 text-emerald-400" />
                <span>Quectel IoT Gateway</span>
              </div>
              <div className="font-mono text-[10px] text-slate-300">Cellular 4G LTE · Uplink Active</div>
            </div>
          </div>
        </div>

        <div ref={anchorDoorRef} className="fixed top-0 left-0 pointer-events-none transition-opacity duration-150 z-20">
          <div className="-translate-x-1/2 -translate-y-full pb-2">
            <div className={`px-2 py-1 rounded-md border text-[10.5px] font-mono shadow-md backdrop-blur-md ${
              bridge.doorOpen
                ? 'bg-amber-950/90 border-amber-400 text-amber-200'
                : 'bg-slate-950/90 border-emerald-400/60 text-emerald-200'
            }`}>
              {bridge.doorOpen ? 'Door: OPEN (Unsealed)' : 'Door: SEALED (Magnetic Lock)'}
            </div>
          </div>
        </div>

        <div ref={anchorIrRef} className="fixed top-0 left-0 pointer-events-none transition-opacity duration-150 z-20">
          <div className="-translate-x-1/2 -translate-y-full pb-2">
            <div className={`px-2 py-1 rounded-md border text-[10.5px] font-mono shadow-md backdrop-blur-md ${
              bridge.irAlertActive
                ? 'bg-red-950/95 border-red-400 text-red-100 font-bold'
                : 'bg-slate-950/90 border-cyan-400/60 text-cyan-200'
            }`}>
              {bridge.irAlertActive && bridge.irDistM !== null
                ? `IR HAZARD: ${bridge.irDistM.toFixed(1)}m (Braking)`
                : 'IR Radar: Path Clear'}
            </div>
          </div>
        </div>
      </div>

      {/* Top Floating Control Bar */}
      <div className="absolute top-3 inset-x-3 sm:top-4 sm:inset-x-4 pointer-events-none flex flex-wrap items-center justify-between gap-3 z-30">
        {/* Left: Mode Switch & Live Readings */}
        <div className="pointer-events-auto flex items-center gap-2 bg-slate-900/90 backdrop-blur-md border border-white/10 rounded-2xl p-1.5 shadow-xl">
          {/* Mode Pill Toggle */}
          <div className="flex items-center rounded-xl bg-slate-950/80 p-0.5 border border-white/5">
            <button
              onClick={() => { tour.stopTour(); bridge.setMode('live'); }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                bridge.mode === 'live' && !tour.isPlaying
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <span className={`h-2 w-2 rounded-full ${bridge.mode === 'live' && !tour.isPlaying ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'}`} />
              <span>Live Device</span>
            </button>
            <button
              onClick={() => { tour.stopTour(); bridge.setMode('simulation'); }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                bridge.mode === 'simulation' && !tour.isPlaying
                  ? 'bg-purple-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Sparkles className="h-3 w-3" />
              <span>Client Demo Sim</span>
            </button>
          </div>

          {/* Quick Metrics */}
          <div className="hidden md:flex items-center gap-3 px-3 text-xs border-l border-white/10">
            <div className="flex items-center gap-1">
              <span className="text-slate-400">Cargo:</span>
              <span className="font-semibold text-white">{bridge.currentProfile.shortLabel}</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-slate-400">Temp:</span>
              <span className={`font-mono font-bold ${bridge.tempAlert ? 'text-red-400 animate-pulse' : 'text-emerald-400'}`}>
                {bridge.temperature.toFixed(1)}°C
              </span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-slate-400">Door:</span>
              <span className={`font-mono ${bridge.doorOpen ? 'text-amber-400' : 'text-slate-300'}`}>
                {bridge.doorOpen ? 'OPEN' : 'SEALED'}
              </span>
            </div>
          </div>
        </div>

        {/* Center: Prominent Automated "Play Client Tour" Button */}
        <div className="pointer-events-auto flex items-center gap-2">
          {!tour.isPlaying ? (
            <button
              onClick={tour.startTour}
              className="group flex items-center gap-2 px-4 py-2 rounded-2xl bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 text-white text-xs font-bold shadow-lg shadow-blue-900/40 hover:scale-105 active:scale-95 transition-all cursor-pointer border border-white/20 animate-pulse"
            >
              <Play className="h-4 w-4 fill-current text-white group-hover:scale-110 transition-transform" />
              <span>Play Client Tour (90s)</span>
            </button>
          ) : (
            <div className="flex items-center gap-2 bg-slate-900/95 backdrop-blur-md border border-purple-500/50 rounded-2xl px-3 py-1.5 shadow-2xl">
              <div className="flex items-center gap-1.5 text-xs font-bold text-purple-200">
                <span className="h-2 w-2 rounded-full bg-purple-400 animate-ping" />
                <span>Story Mode: {tour.elapsedSec}s / 90s</span>
              </div>
              <button
                onClick={tour.stopTour}
                className="p-1 rounded-lg text-slate-400 hover:text-red-400 hover:bg-slate-800 cursor-pointer ml-1"
                title="Exit Tour"
              >
                <Square className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>

        {/* Right: Quick Action Toggles */}
        <div className="pointer-events-auto flex items-center gap-2 bg-slate-900/90 backdrop-blur-md border border-white/10 rounded-2xl p-1.5 shadow-xl">
          {/* Day / Night Toggle */}
          <button
            onClick={() => bridge.setTimeOfDay(bridge.timeOfDay === 'day' ? 'night' : 'day')}
            className="p-2 rounded-xl text-slate-300 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            title={bridge.timeOfDay === 'day' ? 'Switch to Night Lighting' : 'Switch to Sunlight'}
          >
            {bridge.timeOfDay === 'day' ? <Sun className="h-4 w-4 text-amber-400" /> : <Moon className="h-4 w-4 text-blue-400" />}
          </button>

          {/* Sound Toggle */}
          <button
            onClick={handleToggleSound}
            className="p-2 rounded-xl text-slate-300 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            title={soundMuted ? 'Unmute Audio Alarms' : 'Mute Audio Alarms'}
          >
            {soundMuted ? <VolumeX className="h-4 w-4 text-slate-500" /> : <Volume2 className="h-4 w-4 text-emerald-400" />}
          </button>

          {/* 3D Volumetric Heatmap Grid Toggle */}
          <button
            onClick={() => setShowHeatmapGrid(!showHeatmapGrid)}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${
              showHeatmapGrid
                ? 'bg-emerald-950/90 border-emerald-400 text-emerald-200 shadow-md ring-1 ring-emerald-400'
                : 'border-white/10 text-slate-400 hover:text-white'
            }`}
            title="Toggle 3D Volumetric Thermal Gradient Grid"
          >
            <ThermometerSnowflake className="h-3.5 w-3.5 text-emerald-400" />
            <span className="hidden sm:inline">Heatmap Grid</span>
          </button>

          {/* Callout Pins Toggle */}
          <button
            onClick={() => bridge.setShowCallouts(!bridge.showCallouts)}
            className="p-2 rounded-xl text-slate-300 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            title={bridge.showCallouts ? 'Hide 3D Pins' : 'Show 3D Pins'}
          >
            {bridge.showCallouts ? <Eye className="h-4 w-4 text-blue-400" /> : <EyeOff className="h-4 w-4 text-slate-500" />}
          </button>

          {/* Cutaway Wall Toggle */}
          <button
            onClick={() => bridge.setWallMode(bridge.wallMode === 'cutaway' ? 'solid' : 'cutaway')}
            className={`px-2.5 py-1.5 rounded-xl text-xs font-medium border transition-colors cursor-pointer ${
              bridge.wallMode === 'cutaway'
                ? 'bg-blue-950/80 border-blue-500/50 text-blue-200'
                : 'border-white/10 text-slate-400 hover:text-white'
            }`}
          >
            {bridge.wallMode === 'cutaway' ? 'Cutaway' : 'Solid'}
          </button>

          {/* Driver Phone Alerts Drawer Button */}
          <button
            onClick={() => setPhoneDrawerOpen(true)}
            className="relative flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-600/90 hover:bg-blue-600 text-white text-xs font-semibold shadow-md transition-colors cursor-pointer"
          >
            <Smartphone className="h-3.5 w-3.5" />
            <span>Driver Phone</span>
            {alertCount > 0 && (
              <span className="h-4 min-w-4 px-1 rounded-full bg-red-500 text-[10px] font-bold text-white flex items-center justify-center animate-bounce">
                {alertCount}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Story Mode Subtitle Card & Progress Stepper */}
      {tour.isPlaying && (
        <div className="absolute top-20 inset-x-4 pointer-events-none flex flex-col items-center z-30">
          <div className="pointer-events-auto bg-slate-900/95 backdrop-blur-md border border-purple-500/50 rounded-2xl px-5 py-3 shadow-2xl max-w-2xl text-center">
            <div className="text-xs font-bold text-purple-300 uppercase tracking-wider mb-1">
              Client Guided Presentation
            </div>
            <div className="text-sm font-semibold text-white leading-snug">
              {tour.currentStage.subtitle}
            </div>

            {/* Stage Selector Pills */}
            <div className="flex items-center justify-center gap-1.5 mt-3 pt-2.5 border-t border-white/10">
              {STORY_STAGES.map((stg) => {
                const isCurrent = tour.currentStage.index === stg.index;
                return (
                  <button
                    key={stg.index}
                    onClick={() => tour.jumpToStage(stg.index)}
                    className={`px-2.5 py-1 rounded-lg text-[10.5px] font-medium transition-colors cursor-pointer ${
                      isCurrent
                        ? 'bg-purple-600 text-white font-bold shadow-md'
                        : 'text-slate-400 hover:text-white hover:bg-slate-800'
                    }`}
                  >
                    {stg.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Verified Stamp Badge (Stage 4 Completion) */}
      {tour.showVerifiedStamp && (
        <div className="absolute inset-0 pointer-events-none flex items-center justify-center z-40 p-4 animate-in fade-in zoom-in-95 duration-300">
          <div className="pointer-events-auto bg-slate-900/98 border-2 border-emerald-400 rounded-3xl p-6 shadow-2xl max-w-md text-center text-white relative">
            <button
              onClick={() => tour.setShowVerifiedStamp(false)}
              className="absolute top-3 right-3 text-slate-400 hover:text-white p-1 rounded-lg cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
            <div className="flex justify-center mb-3">
              <div className="h-14 w-14 rounded-full bg-emerald-500/20 border border-emerald-400 flex items-center justify-center">
                <ShieldCheck className="h-8 w-8 text-emerald-400" />
              </div>
            </div>
            <h3 className="font-display text-lg font-bold text-emerald-300">
              100% Cold Chain Integrity Verified
            </h3>
            <p className="text-xs text-slate-300 mt-2 leading-relaxed">
              Delivery completed at Metro Bio-Hospital. Digital temperature audit confirms zero excursions during transit. All 12,000 biologics doses certified safe.
            </p>
            <div className="mt-4 pt-3 border-t border-white/10 flex items-center justify-between text-[11px] font-mono text-slate-400">
              <span>TRUCK-01 · GW-001</span>
              <span className="text-emerald-400 font-bold">GDP COMPLIANT</span>
            </div>
          </div>
        </div>
      )}

      {/* First-Person Driver Dashcam (FPV View) In-Cab Digital HUD Overlay */}
      {isFpv && (
        <div className="absolute inset-x-4 bottom-24 pointer-events-none flex justify-center z-30">
          <div className="pointer-events-auto bg-slate-950/92 backdrop-blur-md border border-cyan-500/40 rounded-3xl px-6 py-3.5 shadow-2xl flex items-center gap-6 text-white max-w-xl">
            {/* Speedometer */}
            <div className="text-center">
              <div className="flex items-center justify-center gap-1 text-[11px] text-cyan-400 font-bold uppercase tracking-wider">
                <Gauge className="h-3.5 w-3.5" />
                <span>Speed</span>
              </div>
              <div className="font-mono text-2xl font-black text-cyan-200 mt-0.5">
                {gpsSnapshot ? gpsSnapshot.truck.speedKmh : (bridge.missionPhase === 'in_transit' ? 54 : 0)}{' '}
                <span className="text-xs font-normal text-slate-400">KM/H</span>
              </div>
            </div>

            {/* Gear & Cruise */}
            <div className="text-center px-4 border-x border-white/10">
              <div className="text-[10px] text-slate-400 uppercase font-mono">Gear</div>
              <div className="font-mono text-lg font-bold text-emerald-400">
                {(gpsSnapshot?.truck.speedKmh ?? (bridge.missionPhase === 'in_transit' ? 54 : 0)) > 0 ? 'D4' : 'P'}
              </div>
              <div className="text-[9px] text-slate-500 mt-0.5">
                {(gpsSnapshot?.truck.speedKmh ?? (bridge.missionPhase === 'in_transit' ? 54 : 0)) > 0 ? 'CRUISE ON' : 'STOPPED'}
              </div>
            </div>

            {/* Compass Heading */}
            <div className="text-center">
              <div className="flex items-center justify-center gap-1 text-[11px] text-slate-400 font-medium">
                <Compass className="h-3.5 w-3.5 text-blue-400" />
                <span>Heading</span>
              </div>
              <div className="font-mono text-sm font-bold text-slate-200 mt-0.5">
                {gpsSnapshot ? `${gpsSnapshot.truck.headingDeg}°` : 'NW 312°'}
              </div>
            </div>

            {/* Live Temp */}
            <div className="text-center px-4 border-l border-white/10">
              <div className="text-[10px] text-slate-400 uppercase font-mono">Cargo Hold</div>
              <div className={`font-mono text-base font-bold ${bridge.tempAlert ? 'text-red-400 animate-pulse' : 'text-emerald-400'}`}>
                {bridge.temperature.toFixed(1)}°C
              </div>
            </div>

            {/* Exit FPV Button */}
            <button
              onClick={() => bridge.selectCamera('follow_truck')}
              className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300 hover:text-white border border-white/10 transition-colors cursor-pointer ml-auto"
            >
              Exit Dashcam
            </button>
          </div>
        </div>
      )}

      {/* Bottom Clean Client Demo Dock */}
      <div className="absolute bottom-3 inset-x-3 sm:bottom-4 sm:inset-x-4 pointer-events-none flex flex-col items-center z-30">
        <div className="pointer-events-auto w-full max-w-4xl bg-slate-900/95 backdrop-blur-md border border-white/12 rounded-3xl p-3 shadow-2xl transition-all">
          {/* Tab Headers & Collapse Toggle */}
          <div className="flex items-center justify-between pb-2 border-b border-white/10">
            <div className="flex items-center gap-1.5 overflow-x-auto">
              <button
                onClick={() => { setActiveDockTab('industries'); setDockCollapsed(false); }}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                  activeDockTab === 'industries' && !dockCollapsed
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                1. Industry Cargo ({INDUSTRY_LIST.length})
              </button>
              <button
                onClick={() => { setActiveDockTab('cameras'); setDockCollapsed(false); }}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                  activeDockTab === 'cameras' && !dockCollapsed
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                2. Camera Angles
              </button>
              <button
                onClick={() => { setActiveDockTab('scenarios'); setDockCollapsed(false); }}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                  activeDockTab === 'scenarios' && !dockCollapsed
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                3. Safety Scenarios
              </button>
              <button
                onClick={() => { setActiveDockTab('environment'); setDockCollapsed(false); }}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                  activeDockTab === 'environment' && !dockCollapsed
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                4. Weather & Heat
              </button>
            </div>

            <button
              onClick={() => setDockCollapsed(!dockCollapsed)}
              className="p-1 rounded-lg text-slate-400 hover:text-white cursor-pointer ml-2 shrink-0"
              title={dockCollapsed ? 'Expand Dock' : 'Collapse Dock'}
            >
              {dockCollapsed ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          </div>

          {/* Tab Content */}
          {!dockCollapsed && (
            <div className="pt-2.5">
              {/* Tab 1: Industry Selector */}
              {activeDockTab === 'industries' && (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
                  {INDUSTRY_LIST.map((ind) => {
                    const isSelected = bridge.industry === ind.id;
                    return (
                      <button
                        key={ind.id}
                        onClick={() => bridge.selectIndustry(ind.id)}
                        className={`p-2 rounded-2xl border text-left transition-all cursor-pointer ${
                          isSelected
                            ? 'bg-blue-950/80 border-blue-500 text-white shadow-lg shadow-blue-900/30 ring-1 ring-blue-400'
                            : 'bg-slate-950/50 border-white/5 text-slate-300 hover:border-white/20 hover:text-white'
                        }`}
                      >
                        <div className="text-[11px] font-bold truncate">{ind.label.split('&')[0]}</div>
                        <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                          {ind.minSafeTemp} to {ind.maxSafeTemp}°C
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Tab 2: Camera Presets & Zone Jump */}
              {activeDockTab === 'cameras' && (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mr-1">Views:</span>
                    {[
                      { id: 'follow_truck', label: '🎥 Chase Truck' },
                      { id: 'interior', label: '📦 Interior Cutaway' },
                      { id: 'fpv_dashcam', label: '🏎️ FPV Driver Dashcam' },
                      { id: 'gateway', label: '🛰️ Roof Gateway' },
                      { id: 'godown', label: '🏭 Warehouse Bay' },
                      { id: 'forest', label: '🌲 Forest Hwy' },
                      { id: 'bridge', label: '🌉 River Bridge' },
                      { id: 'city', label: '🏙️ Midtown City' },
                    ].map((cam) => {
                      const isSelected = bridge.cameraPreset === cam.id;
                      return (
                        <button
                          key={cam.id}
                          onClick={() => bridge.selectCamera(cam.id as CameraPreset)}
                          className={`px-2.5 py-1 rounded-xl text-xs font-medium border transition-colors cursor-pointer ${
                            isSelected
                              ? 'bg-blue-600 text-white border-blue-400 shadow-md font-bold'
                              : 'border-white/10 text-slate-300 hover:border-white/20 hover:text-white bg-slate-950/50'
                          }`}
                        >
                          {cam.label}
                        </button>
                      );
                    })}
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5 pt-1.5 border-t border-white/10">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mr-1">Teleport Zone:</span>
                    {[
                      { zone: 'loading' as const, label: '🏭 1. Warehouse Dock' },
                      { zone: 'highway' as const, label: '🛣️ 2. ORR Highway' },
                      { zone: 'bridge' as const, label: '🌉 3. River Bridge' },
                      { zone: 'hospital' as const, label: '🏥 4. Metro Hospital' },
                    ].map((z) => (
                      <button
                        key={z.zone}
                        onClick={() => bridge.jumpToZone(z.zone)}
                        className="px-2.5 py-1 rounded-xl text-[11px] font-semibold border border-purple-500/30 bg-purple-950/40 text-purple-200 hover:bg-purple-900/60 hover:text-white transition-all cursor-pointer shadow-sm"
                      >
                        {z.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Tab 3: Safety & Emergency Scenarios for Client Demo */}
              {activeDockTab === 'scenarios' && (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={bridge.triggerSpikeTemp}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-red-950/80 border border-red-500/50 hover:bg-red-900/90 text-red-200 text-xs font-semibold shadow-md transition-colors cursor-pointer"
                  >
                    <AlertTriangle className="h-3.5 w-3.5 text-red-400" />
                    <span>Spike Temp Excursion</span>
                  </button>

                  <button
                    onClick={bridge.toggleDoor}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-amber-950/80 border border-amber-500/50 hover:bg-amber-900/90 text-amber-200 text-xs font-semibold shadow-md transition-colors cursor-pointer"
                  >
                    <ShieldAlert className="h-3.5 w-3.5 text-amber-400" />
                    <span>{bridge.doorOpen ? 'Close & Lock Door' : 'Trigger Door Breach'}</span>
                  </button>

                  <button
                    onClick={bridge.triggerIrHazard}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-cyan-950/80 border border-cyan-500/50 hover:bg-cyan-900/90 text-cyan-200 text-xs font-semibold shadow-md transition-colors cursor-pointer"
                  >
                    <Car className="h-3.5 w-3.5 text-cyan-400" />
                    <span>Trigger IR Collision Alert</span>
                  </button>

                  <button
                    onClick={bridge.resetAllAlerts}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-white/10 transition-colors cursor-pointer ml-auto"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    <span>Reset to Normal Safe</span>
                  </button>
                </div>
              )}

              {/* Tab 4: Weather & Environment Conditions */}
              {activeDockTab === 'environment' && (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => setWeather('clear')}
                    className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${
                      weather === 'clear'
                        ? 'bg-blue-600 text-white border-blue-400 shadow-md'
                        : 'bg-slate-950/50 border-white/10 text-slate-300 hover:text-white'
                    }`}
                  >
                    <Sun className="h-3.5 w-3.5 text-amber-300" />
                    <span>Clear Daylight</span>
                  </button>

                  <button
                    onClick={() => setWeather('rain')}
                    className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${
                      weather === 'rain'
                        ? 'bg-blue-600 text-white border-blue-400 shadow-md'
                        : 'bg-slate-950/50 border-white/10 text-slate-300 hover:text-white'
                    }`}
                  >
                    <CloudRain className="h-3.5 w-3.5 text-cyan-300" />
                    <span>Monsoon Rain & Wet Roads</span>
                  </button>

                  <button
                    onClick={() => setWeather('heatwave')}
                    className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${
                      weather === 'heatwave'
                        ? 'bg-orange-600 text-white border-orange-400 shadow-md'
                        : 'bg-slate-950/50 border-white/10 text-slate-300 hover:text-white'
                    }`}
                  >
                    <Flame className="h-3.5 w-3.5 text-amber-300" />
                    <span>Summer Heatwave (42°C External)</span>
                  </button>

                  {/* Volumetric Thermal Grid Toggle */}
                  <button
                    onClick={() => setShowHeatmapGrid(!showHeatmapGrid)}
                    className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold border transition-all cursor-pointer ml-auto ${
                      showHeatmapGrid
                        ? 'bg-emerald-600 text-white border-emerald-400 shadow-md'
                        : 'bg-slate-950/50 border-white/10 text-slate-300 hover:text-white'
                    }`}
                  >
                    <ThermometerSnowflake className="h-3.5 w-3.5 text-emerald-300" />
                    <span>{showHeatmapGrid ? '3D Heatmap Grid: ACTIVE' : 'Enable 3D Heatmap Grid'}</span>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Driver Smartphone Simulator Drawer */}
      <DriverPhoneDrawer
        isOpen={phoneDrawerOpen}
        onClose={() => setPhoneDrawerOpen(false)}
        alerts={bridge.phoneAlerts}
        onDismissAlert={bridge.dismissPhoneAlert}
        onClearAll={bridge.clearPhoneAlerts}
      />
    </div>
  );
};
