import React from "react";
import {
  Command,
  Pause,
  Play,
  RefreshCw,
  SkipBack,
  SkipForward,
  Wifi,
  WifiOff,
} from "lucide-react";
import { PlaybackSpeed, useTelemetryStore } from "../../state/telemetryStore";

const SPEEDS: PlaybackSpeed[] = [0.25, 0.5, 1, 2];

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
    setCommandPaletteOpen,
  } = useTelemetryStore();

  const isLive = !forceOfflineMode && (connectionStatus === "connected" || backendLive);
  const netPowerKw = frame.hv.p_dc_kw - frame.hv.p_regen_kw;
  const pct = Math.max(0, Math.min(100, playbackProgress * 100));

  return (
    <header className="h-[46px] shrink-0 bg-[#0E1016] border-b border-white/[0.065] flex items-center justify-between px-3.5 gap-4 select-none no-print">
      {/* Zone 1: Brand Identity & Stream Connection */}
      <div className="flex items-center gap-3 min-w-0 shrink-0">
        <div className="flex items-center gap-2.5 whitespace-nowrap">
          <span className="inline-flex items-center justify-center px-2 py-0.5 rounded-[4px] bg-[#C5A059]/16 border border-[#C5A059]/35 text-[#DFBE78] font-mono text-[11px] font-bold tracking-tight">
            TeR27
          </span>
          <span className="text-[13px] font-semibold tracking-[-0.01em] text-[#F1F5F9]">
            Vehicle Dynamics Workbench
          </span>
        </div>

        <div className="h-4 w-px bg-white/[0.08]" aria-hidden="true" />

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setForceOfflineMode(!forceOfflineMode)}
            title={
              isLive
                ? "Connected to local FastAPI backend — click to switch to Offline Playback"
                : "Running 60 Hz Offline Playback — click to toggle live probe"
            }
            className={`status-pill cursor-pointer transition-colors ${
              isLive ? "status-pill-nominal" : "status-pill-gold"
            }`}
          >
            {isLive ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
            <span>
              {isLive
                ? `Live Stream${backendLatencyMs !== null ? ` · ${backendLatencyMs}ms` : ""}`
                : "Offline Playback"}
            </span>
          </button>

          <button
            type="button"
            onClick={retryConnection}
            title="Retry localhost:8000 REST + WebSocket connection"
            aria-label="Retry backend connection"
            className="w-6 h-6 flex items-center justify-center rounded-[4px] text-[#94A3B8] hover:text-[#F1F5F9] hover:bg-white/[0.06] transition-colors cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Zone 2: Unified Telemetry Transport & Replay Deck */}
      <div className="flex items-center gap-2.5 px-2.5 py-1 rounded-[6px] bg-[#090B10] border border-white/[0.06] flex-1 max-w-[490px] min-w-[260px]">
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            type="button"
            onClick={() => stepPlaybackFrame(-1)}
            title="Step Back 1 Frame ([)"
            aria-label="Step back one frame"
            className="w-6 h-6 flex items-center justify-center rounded-[4px] text-[#94A3B8] hover:text-[#F1F5F9] hover:bg-white/[0.06] transition-colors cursor-pointer"
          >
            <SkipBack className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={togglePlayPause}
            title="Play / Pause Stream (Space)"
            aria-label={isPlaying ? "Pause telemetry" : "Play telemetry"}
            className={`h-6 px-2.5 flex items-center justify-center gap-1 rounded-[4px] text-[11px] font-medium transition-colors cursor-pointer ${
              isPlaying
                ? "bg-[#C5A059]/18 text-[#DFBE78] hover:bg-[#C5A059]/26"
                : "bg-white/[0.08] text-[#F1F5F9] hover:bg-white/[0.12]"
            }`}
          >
            {isPlaying ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
            <span>{isPlaying ? "Live" : "Paused"}</span>
          </button>
          <button
            type="button"
            onClick={() => stepPlaybackFrame(1)}
            title="Step Forward 1 Frame (])"
            aria-label="Step forward one frame"
            className="w-6 h-6 flex items-center justify-center rounded-[4px] text-[#94A3B8] hover:text-[#F1F5F9] hover:bg-white/[0.06] transition-colors cursor-pointer"
          >
            <SkipForward className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="seg-track shrink-0">
          {SPEEDS.map((spd) => (
            <button
              key={spd}
              type="button"
              onClick={() => setPlaybackSpeed(spd)}
              data-active={playbackSpeed === spd ? "true" : "false"}
              className="seg-btn font-mono !px-1.5 !py-0.5 !text-[10px]"
            >
              {spd}x
            </button>
          ))}
        </div>

        <div className="flex-1 flex items-center gap-2 min-w-[70px]">
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
          <span className="font-mono text-[10px] text-[#94A3B8] w-[82px] text-right shrink-0">
            {(playbackProgress * playbackDurationS).toFixed(2)} / {playbackDurationS.toFixed(1)}s
          </span>
        </div>
      </div>

      {/* Zone 3: Vehicle KPI Pills, Sensor Profile Switch & Command Palette */}
      <div className="flex items-center gap-2 shrink-0">
        <div className="hidden 2xl:flex items-center gap-1.5">
          <span className="status-pill status-pill-muted font-mono !text-[10.5px]">
            <span className="text-[#64748B] font-sans">HV</span>
            <span
              className={
                netPowerKw > 72
                  ? "text-[#FBBF24]"
                  : netPowerKw < -0.5
                    ? "text-[#38BDF8]"
                    : "text-[#F1F5F9]"
              }
            >
              {netPowerKw >= 0 ? "+" : ""}
              {netPowerKw.toFixed(1)} kW
            </span>
          </span>

          <span className="status-pill status-pill-muted font-mono !text-[10.5px]">
            <span className="text-[#64748B] font-sans">SoC</span>
            <span className="text-[#F1F5F9]">{frame.hv.soc_pct.toFixed(1)}%</span>
          </span>

          <span
            className={`status-pill !text-[10.5px] ${
              frame.hv.bspd_active ? "status-pill-limit" : "status-pill-nominal"
            }`}
          >
            BSPD {frame.hv.bspd_active ? "Trip" : "OK"}
          </span>
        </div>

        {/* Segmented Sensor Realism Switch */}
        <div className="seg-track hidden lg:inline-flex">
          <button
            type="button"
            onClick={() => void setSensorProfile("SENSOR_IDEAL")}
            data-active={sensorProfile === "SENSOR_IDEAL" ? "true" : "false"}
            className="seg-btn !text-[10.5px] !px-2 !py-0.5"
          >
            Ideal 0ms
          </button>
          <button
            type="button"
            onClick={() => void setSensorProfile("SENSOR_TRACK_REALISM")}
            data-active={sensorProfile === "SENSOR_TRACK_REALISM" ? "true" : "false"}
            className="seg-btn !text-[10.5px] !px-2 !py-0.5"
          >
            Realism 125ms
          </button>
        </div>

        <button
          type="button"
          onClick={() => setCommandPaletteOpen(true)}
          title="Open Command Palette (Ctrl+K)"
          className="h-7 px-2.5 rounded-[5px] bg-[#161A23] hover:bg-[#1E2432] border border-white/[0.08] hover:border-[#C5A059]/45 text-[#94A3B8] hover:text-[#F1F5F9] flex items-center gap-2 text-[11px] font-medium transition-colors cursor-pointer"
        >
          <Command className="w-3.5 h-3.5 text-[#C5A059]" />
          <span className="hidden xl:inline">Commands</span>
          <kbd className="font-mono text-[10px] px-1.5 py-0.2 rounded-[3px] bg-[#0B0D12] text-[#94A3B8] border border-white/[0.06]">
            Ctrl+K
          </kbd>
        </button>
      </div>
    </header>
  );
}
