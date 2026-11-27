import React from "react";
import {
  Command,
  Pause,
  Play,
  RefreshCw,
  SkipBack,
  SkipForward,
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
  const maxTireUtil = Math.max(
    frame.wheels.fl.tire_util,
    frame.wheels.fr.tire_util,
    frame.wheels.rl.tire_util,
    frame.wheels.rr.tire_util
  );

  return (
    <header className="h-[36px] shrink-0 bg-[#0F1116] border-b border-[#222633] flex items-center justify-between px-2.5 gap-3 select-none no-print">
      {/* Left: Brand & Link State */}
      <div className="flex items-center gap-3 min-w-0 shrink-0">
        <div className="flex items-center gap-2 whitespace-nowrap">
          <span className="text-[11px] font-semibold tracking-[0.04em] text-[#ECEFF4]">
            TeR27 // Vehicle Dynamics Workbench
          </span>
        </div>

        <span className="text-[#222633]" aria-hidden="true">
          |
        </span>

        <div className="flex items-center gap-2 text-[10px] font-mono whitespace-nowrap">
          <span
            className={isLive ? "text-[#10B981] font-semibold" : "text-[#D97706] font-semibold"}
          >
            {isLive
              ? `LIVE: localhost:8000${backendLatencyMs !== null ? ` (${backendLatencyMs}ms)` : ""}`
              : "OFFLINE: MOCK ENGINE"}
          </span>
          <button
            type="button"
            onClick={() => (forceOfflineMode ? retryConnection() : retryConnection())}
            title="Retry FastAPI + WebSocket handshake"
            className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-mono text-[#7E8799] hover:text-[#ECEFF4] hover:bg-[#1B1F2A] border border-[#222633] rounded-[2px] cursor-pointer"
          >
            <RefreshCw className="w-2.5 h-2.5" />
            Retry
          </button>
          <button
            type="button"
            onClick={() => setForceOfflineMode(!forceOfflineMode)}
            title="Toggle forced offline playback mode"
            className="px-1.5 py-0.5 text-[10px] font-mono text-[#7E8799] hover:text-[#ECEFF4] hover:bg-[#1B1F2A] border border-[#222633] rounded-[2px] cursor-pointer"
          >
            {forceOfflineMode ? "Use Live" : "Mock Only"}
          </button>
        </div>
      </div>

      {/* Center: Playback Transport & Timeline Scrub */}
      <div className="flex items-center gap-2 min-w-0 flex-1 max-w-[460px]">
        <div className="flex items-center border border-[#222633] rounded-[2px] bg-[#151820] shrink-0">
          <button
            type="button"
            onClick={() => stepPlaybackFrame(-1)}
            title="Step -1 frame ([)"
            className="p-1 text-[#7E8799] hover:text-[#ECEFF4] hover:bg-[#1B1F2A] cursor-pointer"
          >
            <SkipBack className="w-3 h-3" />
          </button>
          <button
            type="button"
            onClick={togglePlayPause}
            title="Play / Pause (Space)"
            className="px-2 py-1 text-[#C5A059] hover:bg-[#1B1F2A] border-x border-[#222633] cursor-pointer flex items-center gap-1 text-[10px] font-mono"
          >
            {isPlaying ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
            {isPlaying ? "RUN" : "HOLD"}
          </button>
          <button
            type="button"
            onClick={() => stepPlaybackFrame(1)}
            title="Step +1 frame (])"
            className="p-1 text-[#7E8799] hover:text-[#ECEFF4] hover:bg-[#1B1F2A] cursor-pointer"
          >
            <SkipForward className="w-3 h-3" />
          </button>
        </div>

        <div className="flex items-center gap-0.5 shrink-0">
          {SPEEDS.map((spd) => (
            <button
              key={spd}
              type="button"
              onClick={() => setPlaybackSpeed(spd)}
              className={`px-1.5 py-0.5 text-[10px] font-mono border rounded-[1px] cursor-pointer ${
                playbackSpeed === spd
                  ? "border-[#C5A059] text-[#C5A059] bg-[#1B1F2A]"
                  : "border-transparent text-[#7E8799] hover:text-[#ECEFF4]"
              }`}
            >
              {spd}x
            </button>
          ))}
        </div>

        <input
          type="range"
          min={0}
          max={1}
          step={0.001}
          value={playbackProgress}
          onChange={(e) => seekPlayback(parseFloat(e.target.value))}
          aria-label="Scrub telemetry playback timeline"
          className="eng-slider flex-1 min-w-[70px]"
        />
        <span className="text-[10px] font-mono text-[#7E8799] tabular w-[76px] text-right shrink-0">
          {(playbackProgress * playbackDurationS).toFixed(2)}/{playbackDurationS.toFixed(1)}s
        </span>
      </div>

      {/* Right: Critical Vehicle Readouts + Sensor Mode + Command Palette */}
      <div className="flex items-center gap-3 text-[10px] font-mono whitespace-nowrap shrink-0">
        <div className="hidden xl:flex items-center gap-2.5 text-[#7E8799]">
          <span>
            HV{" "}
            <strong
              className={
                netPowerKw > 72
                  ? "text-[#D97706]"
                  : netPowerKw < -1
                    ? "text-[#38BDF8]"
                    : "text-[#ECEFF4]"
              }
            >
              {netPowerKw >= 0 ? "+" : ""}
              {netPowerKw.toFixed(1)} kW
            </strong>
          </span>
          <span aria-hidden="true">/</span>
          <span>
            SoC <strong className="text-[#ECEFF4]">{frame.hv.soc_pct.toFixed(1)}%</strong>
          </span>
          <span aria-hidden="true">/</span>
          <span>
            UTIL{" "}
            <strong
              className={
                maxTireUtil >= 0.96
                  ? "text-[#DC2626]"
                  : maxTireUtil >= 0.85
                    ? "text-[#D97706]"
                    : "text-[#10B981]"
              }
            >
              {(maxTireUtil * 100).toFixed(0)}%
            </strong>
          </span>
          <span aria-hidden="true">/</span>
          <span className={frame.hv.bspd_active ? "text-[#DC2626] font-semibold" : "text-[#10B981]"}>
            BSPD {frame.hv.bspd_active ? "TRIP" : "OK"}
          </span>
        </div>

        <button
          type="button"
          onClick={() =>
            void setSensorProfile(
              sensorProfile === "SENSOR_TRACK_REALISM" ? "SENSOR_IDEAL" : "SENSOR_TRACK_REALISM"
            )
          }
          title="Toggle SENSOR_IDEAL vs SENSOR_TRACK_REALISM (125 ms CAN)"
          className={`px-2 py-0.5 border rounded-[2px] cursor-pointer text-[10px] font-mono ${
            sensorProfile === "SENSOR_TRACK_REALISM"
              ? "border-[#D97706] text-[#D97706] bg-[#151820]"
              : "border-[#222633] text-[#7E8799] hover:text-[#ECEFF4] bg-[#151820]"
          }`}
        >
          {sensorProfile === "SENSOR_TRACK_REALISM" ? "TRACK REALISM 125ms" : "SENSOR IDEAL"}
        </button>

        <button
          type="button"
          onClick={() => setCommandPaletteOpen(true)}
          title="Open Command Palette (Ctrl+K)"
          className="flex items-center gap-1.5 px-2 py-0.5 bg-[#151820] border border-[#222633] hover:border-[#C5A059] text-[#ECEFF4] rounded-[2px] cursor-pointer"
        >
          <Command className="w-3 h-3 text-[#C5A059]" />
          <span>Ctrl+K</span>
        </button>
      </div>
    </header>
  );
}
