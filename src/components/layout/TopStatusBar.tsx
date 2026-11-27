import React from "react";
import {
  Command,
  Crosshair,
  OctagonAlert,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  SkipBack,
  SkipForward,
  Wifi,
  WifiOff,
} from "lucide-react";
import { PlaybackSpeed, useTelemetryStore } from "../../state/telemetryStore";

const SPEEDS: PlaybackSpeed[] = [0.25, 0.5, 1, 2];

const SIM_EVENTS: Array<{ id: "skidpad" | "accel" | "autocross" | "endurance"; label: string }> = [
  { id: "skidpad", label: "Skidpad" },
  { id: "accel", label: "Accel 75m" },
  { id: "autocross", label: "Autocross" },
  { id: "endurance", label: "Endurance" },
];

export function TopStatusBar() {
  const {
    frame,
    connectionStatus,
    backendLive,
    backendLatencyMs,
    forceOfflineMode,
    setForceOfflineMode,
    retryConnection,
    isPlaying,
    togglePlayPause,
    playbackSpeed,
    setPlaybackSpeed,
    playbackProgress,
    playbackDurationS,
    seekPlayback,
    stepPlaybackFrame,
    sensorProfile,
    setSensorProfile,
    gripProfile,
    setGripProfile,
    activeSimEvent,
    dispatchMirenaEventReset,
    dispatchMirenaReplaySync,
    stopState,
    triggerSoftStop,
    triggerEmergencyStop,
    resetSafetyLatch,
    setCommandPaletteOpen,
  } = useTelemetryStore();

  const isLive = !forceOfflineMode && (connectionStatus === "connected" || backendLive);
  const pct = Math.max(0, Math.min(100, playbackProgress * 100));
  const vxKmh = frame.state.vx * 3.6;

  return (
    <header className="h-[46px] shrink-0 bg-[#0E1016] border-b border-[#222633] flex items-center justify-between px-3 gap-2 select-none no-print">
      {/* Zone 1: Brand Identity & Stream Connection */}
      <div className="flex items-center gap-2 min-w-0 shrink-0">
        <div className="flex items-center gap-2 whitespace-nowrap">
          <span className="inline-flex items-center justify-center px-1.5 py-0.5 rounded-[3px] bg-[#C5A059]/16 border border-[#C5A059]/35 text-[#DFBE78] font-mono text-[11px] font-bold tracking-tight">
            TeR27
          </span>
          <span className="text-[12.5px] font-semibold tracking-[-0.01em] text-[#ECEFF4] hidden 2xl:inline">
            Vehicle Dynamics Workbench
          </span>
        </div>

        <div className="h-4 w-px bg-[#222633]" aria-hidden="true" />

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setForceOfflineMode(!forceOfflineMode)}
            title={
              isLive
                ? "Live MirenaSim UDP / FastAPI link active — click to switch to Offline Engine"
                : "Offline Deterministic Engine active — click to probe localhost:8000"
            }
            className={`status-pill cursor-pointer transition-colors !text-[10px] !px-2 ${
              isLive ? "status-pill-nominal" : "status-pill-gold"
            }`}
          >
            {isLive ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
            <span>
              {isLive
                ? `MirenaSim${backendLatencyMs !== null ? ` · ${backendLatencyMs}ms` : ""}`
                : "Offline Engine"}
            </span>
          </button>

          <button
            type="button"
            onClick={retryConnection}
            title="Probe localhost:8000 REST + WebSocket bridge"
            aria-label="Retry backend connection"
            className="w-6 h-6 flex items-center justify-center rounded-[4px] text-[#7E8799] hover:text-[#ECEFF4] hover:bg-[#1B1F2A] transition-colors cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Zone 2: Unified Telemetry Transport & Replay Deck */}
      <div className="flex items-center gap-2 px-2 py-1 rounded-[4px] bg-[#08090C] border border-[#222633] flex-1 max-w-[380px] min-w-[200px]">
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            type="button"
            onClick={() => stepPlaybackFrame(-1)}
            title="Step Back 1 Frame ([)"
            aria-label="Step back one frame"
            className="w-5 h-6 flex items-center justify-center rounded-[3px] text-[#7E8799] hover:text-[#ECEFF4] hover:bg-[#1B1F2A] transition-colors cursor-pointer"
          >
            <SkipBack className="w-3 h-3" />
          </button>
          <button
            type="button"
            onClick={togglePlayPause}
            title="Play / Pause Stream (Space)"
            aria-label={isPlaying ? "Pause telemetry" : "Play telemetry"}
            className={`h-6 px-2 flex items-center justify-center gap-1 rounded-[3px] text-[10.5px] font-medium transition-colors cursor-pointer ${
              isPlaying
                ? "bg-[#C5A059]/18 text-[#DFBE78] hover:bg-[#C5A059]/26"
                : "bg-[#1B1F2A] text-[#ECEFF4] hover:bg-[#232836]"
            }`}
          >
            {isPlaying ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
            <span className="hidden sm:inline">{isPlaying ? "Live" : "Paused"}</span>
          </button>
          <button
            type="button"
            onClick={() => stepPlaybackFrame(1)}
            title="Step Forward 1 Frame (])"
            aria-label="Step forward one frame"
            className="w-5 h-6 flex items-center justify-center rounded-[3px] text-[#7E8799] hover:text-[#ECEFF4] hover:bg-[#1B1F2A] transition-colors cursor-pointer"
          >
            <SkipForward className="w-3 h-3" />
          </button>
        </div>

        <div className="seg-track shrink-0 hidden lg:inline-flex">
          {SPEEDS.map((spd) => (
            <button
              key={spd}
              type="button"
              onClick={() => setPlaybackSpeed(spd)}
              data-active={playbackSpeed === spd ? "true" : "false"}
              className="seg-btn font-mono !px-1.5 !py-0.5 !text-[9.5px]"
            >
              {spd}x
            </button>
          ))}
        </div>

        <div className="flex-1 flex items-center gap-1.5 min-w-[56px]">
          <input
            type="range"
            min={0}
            max={1}
            step={0.001}
            value={playbackProgress}
            onChange={(e) => seekPlayback(parseFloat(e.target.value))}
            aria-label="Scrub telemetry timeline"
            className="eng-slider flex-1"
            style={{
              background: `linear-gradient(to right, #C5A059 ${pct}%, #1C212E ${pct}%)`,
            }}
          />
          <span className="font-mono text-[10px] text-[#7E8799] min-w-[7.2ch] text-right shrink-0 tabular">
            {(playbackProgress * playbackDurationS).toFixed(1)}/{playbackDurationS.toFixed(0)}s
          </span>
        </div>
      </div>

      {/* Zone 3: Quick MirenaSim Controls + Industrial STOP VEHICLE / E-STOP Cluster */}
      <div className="flex items-center gap-1.5 shrink-0">
        {/* Grip Profile Switch */}
        <div className="seg-track hidden 2xl:inline-flex" title="Surface Grip Profile (UDP 9877)">
          <button
            type="button"
            onClick={() => setGripProfile("COLD_TEST_OCT")}
            data-active={gripProfile === "COLD_TEST_OCT" ? "true" : "false"}
            className="seg-btn !text-[10px] !px-1.5 !py-0.5"
          >
            Cold 0.47
          </button>
          <button
            type="button"
            onClick={() => setGripProfile("FSG_RUBBERED")}
            data-active={gripProfile === "FSG_RUBBERED" ? "true" : "false"}
            className="seg-btn !text-[10px] !px-1.5 !py-0.5"
          >
            FSG 0.57
          </button>
        </div>

        {/* Sensor Realism Switch */}
        <div className="seg-track hidden xl:inline-flex" title="CAN Sensor Realism Profile">
          <button
            type="button"
            onClick={() => void setSensorProfile("SENSOR_IDEAL")}
            data-active={sensorProfile === "SENSOR_IDEAL" ? "true" : "false"}
            className="seg-btn !text-[10px] !px-1.5 !py-0.5"
          >
            0ms
          </button>
          <button
            type="button"
            onClick={() => void setSensorProfile("SENSOR_TRACK_REALISM")}
            data-active={sensorProfile === "SENSOR_TRACK_REALISM" ? "true" : "false"}
            className="seg-btn !text-[10px] !px-1.5 !py-0.5"
          >
            125ms
          </button>
        </div>

        {/* MirenaSim Event Reset */}
        <div className="hidden xl:flex items-center rounded-[4px] bg-[#08090C] border border-[#222633] overflow-hidden">
          <select
            aria-label="MirenaSim target event"
            value={activeSimEvent}
            onChange={(e) =>
              void dispatchMirenaEventReset(
                e.target.value as "skidpad" | "accel" | "autocross" | "endurance"
              )
            }
            className="h-7 bg-transparent text-[10px] font-medium text-[#ECEFF4] pl-1.5 pr-1 outline-none cursor-pointer"
          >
            {SIM_EVENTS.map((ev) => (
              <option key={ev.id} value={ev.id} className="bg-[#0F1116] text-[#ECEFF4]">
                {ev.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void dispatchMirenaEventReset(activeSimEvent)}
            title={`Reset MirenaSim to ${activeSimEvent.toUpperCase()} gate (UDP 9877)`}
            className="h-7 px-1.5 border-l border-[#222633] text-[#7E8799] hover:text-[#DFBE78] hover:bg-[#151820] flex items-center cursor-pointer"
          >
            <RotateCcw className="w-3 h-3" />
          </button>
        </div>

        {/* Sync 3D */}
        <button
          type="button"
          onClick={() => void dispatchMirenaReplaySync()}
          title="Send replay_seek timestamp to frame-lock MirenaSim 3D viewport"
          className="hidden lg:flex h-7 px-2 rounded-[4px] bg-[#151820] hover:bg-[#1B1F2A] border border-[#222633] hover:border-[#C5A059]/45 text-[#94A3B8] hover:text-[#DFBE78] items-center gap-1 text-[10px] font-medium cursor-pointer"
        >
          <Crosshair className="w-3 h-3 text-[#C5A059]" />
        </button>

        <div className="h-5 w-px bg-[#222633] mx-0.5" aria-hidden="true" />

        {/* Industrial STOP VEHICLE (SOFT STOP + E-STOP / RESET) Cluster */}
        <div className="flex items-center gap-1 rounded-[4px] bg-[#08090C] border border-[#222633] p-0.5">
          {stopState === "NOMINAL" ? (
            <>
              <button
                type="button"
                onClick={() => void triggerSoftStop("Manual Pitwall Soft Stop")}
                title="Command smooth regenerative + hydraulic deceleration (0 kW tractive)"
                className="h-6 px-2 rounded-[3px] bg-[#D97706]/16 hover:bg-[#D97706]/28 border border-[#D97706]/45 text-[#FBBF24] text-[10px] font-semibold tracking-wide cursor-pointer transition-colors"
              >
                SOFT STOP
              </button>
              <button
                type="button"
                onClick={() => void triggerEmergencyStop("Manual Engineer Hard E-Stop")}
                title="Trip Shutdown Circuit (SDC OPEN), cut all 4 motors to 0.0 Nm, dispatch HARD_SHUTDOWN via UDP 9877"
                className="h-6 px-2.5 rounded-[3px] bg-[#DC2626] hover:bg-[#B91C1C] text-[#ECEFF4] text-[10.5px] font-bold tracking-wide flex items-center gap-1 cursor-pointer transition-colors"
              >
                <OctagonAlert className="w-3.5 h-3.5" />
                E-STOP
              </button>
            </>
          ) : (
            <div className="flex items-center gap-1.5 pl-1.5 pr-0.5">
              <span
                className={`font-mono text-[10px] font-bold tabular ${
                  stopState === "E_STOP" ? "text-[#F87171]" : "text-[#FBBF24]"
                }`}
              >
                {stopState === "E_STOP" ? "E-STOP TRIPPED" : "SOFT STOP"} · {vxKmh.toFixed(1)} km/h
              </span>
              <button
                type="button"
                onClick={() => void resetSafetyLatch()}
                title="Explicit Engineer Reset: Close Shutdown Circuit (SDC) and restore nominal operation"
                className="h-6 px-2 rounded-[3px] bg-[#10B981]/20 hover:bg-[#10B981]/32 border border-[#10B981]/50 text-[#34D399] text-[10px] font-semibold flex items-center gap-1 cursor-pointer transition-colors"
              >
                <ShieldCheck className="w-3 h-3" />
                RESET
              </button>
            </div>
          )}
        </div>

        {/* Command Palette */}
        <button
          type="button"
          onClick={() => setCommandPaletteOpen(true)}
          title="Open Command Palette (Ctrl+K)"
          className="h-7 px-2 rounded-[4px] bg-[#151820] hover:bg-[#1B1F2A] border border-[#222633] hover:border-[#C5A059]/45 text-[#94A3B8] hover:text-[#ECEFF4] flex items-center gap-1 text-[10.5px] font-medium cursor-pointer"
        >
          <Command className="w-3.5 h-3.5 text-[#C5A059]" />
          <kbd className="font-mono text-[9.5px] hidden md:inline text-[#7E8799]">Ctrl+K</kbd>
        </button>
      </div>
    </header>
  );
}
