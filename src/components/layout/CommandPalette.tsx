import React, { useEffect, useMemo, useRef, useState } from "react";
import { Search, Terminal } from "lucide-react";
import { WORKBENCH_ROUTES } from "../../app/routes";
import { useTelemetryStore } from "../../state/telemetryStore";
import { applySetupPreset } from "../../services/apiClient";

interface PaletteAction {
  id: string;
  category: string;
  label: string;
  detail: string;
  shortcut?: string;
  run: () => void | Promise<void>;
}

const PRESET_NAMES = [
  { id: "default", label: "default", detail: "Base TeR27 4WD equilibrium setup" },
  { id: "optimal_skidpad", label: "optimal_skidpad", detail: "CasADi co-optimized Skidpad (-0.017 s)" },
  { id: "optimal_accel", label: "optimal_accel", detail: "CasADi co-optimized 75 m Acceleration (-0.0007 s)" },
  { id: "optimal_autocross", label: "optimal_autocross", detail: "CasADi co-optimized Autocross (-0.4578 s)" },
  { id: "optimal_endurance", label: "optimal_endurance", detail: "CasADi co-optimized 22 km Endurance (62 kW limit)" },
];

export function CommandPalette() {
  const {
    commandPaletteOpen,
    setCommandPaletteOpen,
    setActiveRoute,
    sensorProfile,
    setSensorProfile,
    setGripProfile,
    forceOfflineMode,
    setForceOfflineMode,
    retryConnection,
    togglePlayPause,
    isPlaying,
    setActiveSetupName,
    pushToast,
  } = useTelemetryStore();

  const [query, setQuery] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (commandPaletteOpen) {
      setQuery("");
      setSelectedIdx(0);
      window.setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [commandPaletteOpen]);

  const actions = useMemo<PaletteAction[]>(() => {
    const routeActions: PaletteAction[] = WORKBENCH_ROUTES.map((r, idx) => ({
      id: `route-${r.id}`,
      category: "Workspace",
      label: r.label,
      detail: r.description,
      shortcut: `${idx + 1}`,
      run: () => setActiveRoute(r.id),
    }));

    const setupActions: PaletteAction[] = PRESET_NAMES.map((preset) => ({
      id: `setup-${preset.id}`,
      category: "Setup Preset",
      label: `Apply Setup: ${preset.label}`,
      detail: preset.detail,
      run: async () => {
        setActiveSetupName(preset.id);
        const res = await applySetupPreset({ preset: preset.id }, forceOfflineMode);
        pushToast({
          level: res.live ? "nominal" : "info",
          title: `Setup Applied: ${preset.label}`,
          detail: res.data.message,
        });
      },
    }));

    const systemActions: PaletteAction[] = [
      {
        id: "sensor-toggle",
        category: "Sensors",
        label:
          sensorProfile === "SENSOR_TRACK_REALISM"
            ? "Switch to Ideal Sensors (0 ms)"
            : "Switch to Track Realism (125 ms CAN + EKF)",
        detail: "Toggle MirenaSim / offline synthesizer sensor realism profile",
        run: () =>
          setSensorProfile(
            sensorProfile === "SENSOR_TRACK_REALISM" ? "SENSOR_IDEAL" : "SENSOR_TRACK_REALISM"
          ),
      },
      {
        id: "grip-fsg",
        category: "Grip Profile",
        label: "FSG Rubbered Asphalt (lambda_muy = 0.57)",
        detail: "Competition rubbered asphalt surface calibration",
        run: () => setGripProfile("FSG_RUBBERED"),
      },
      {
        id: "grip-cold",
        category: "Grip Profile",
        label: "Cold October Track (lambda_muy = 0.47)",
        detail: "Cold test track surface calibration (18 C ambient)",
        run: () => setGripProfile("COLD_TEST_OCT"),
      },
      {
        id: "playback-toggle",
        category: "Telemetry",
        label: isPlaying ? "Pause Telemetry Stream" : "Resume Telemetry Stream",
        detail: "Freeze or resume live / offline 60 Hz ingestion",
        shortcut: "Space",
        run: () => togglePlayPause(),
      },
      {
        id: "backend-mode",
        category: "Transport",
        label: forceOfflineMode
          ? "Connect Live Backend (localhost:8000)"
          : "Switch to Offline Mock Playback Engine",
        detail: forceOfflineMode
          ? "Attempt FastAPI REST + WS telemetry handshake"
          : "Bypass localhost:8000 and run deterministic 60 Hz offline playback",
        run: () => {
          if (forceOfflineMode) {
            retryConnection();
          } else {
            setForceOfflineMode(true);
            pushToast({
              level: "info",
              title: "Offline Playback Active",
              detail: "Synthesizing continuous 60 Hz frames from verified mock datasets.",
            });
          }
        },
      },
      {
        id: "session-forensics-skidpad",
        category: "DiL Session",
        label: "Load Skidpad 14-DOF Godot Parity vs CasADi",
        detail: "Jump to Session Forensics with verified FSG_RUBBERED comparison",
        run: () => setActiveRoute("forensics"),
      },
    ];

    return [...routeActions, ...setupActions, ...systemActions];
  }, [
    forceOfflineMode,
    isPlaying,
    pushToast,
    retryConnection,
    sensorProfile,
    setActiveRoute,
    setActiveSetupName,
    setForceOfflineMode,
    setGripProfile,
    setSensorProfile,
    togglePlayPause,
  ]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return actions;
    const tokens = q.split(/\s+/);
    return actions.filter((a) => {
      const hay = `${a.category} ${a.label} ${a.detail}`.toLowerCase();
      return tokens.every((tok) => hay.includes(tok));
    });
  }, [actions, query]);

  useEffect(() => {
    setSelectedIdx(0);
  }, [query]);

  if (!commandPaletteOpen) return null;

  const execute = (action: PaletteAction | undefined) => {
    if (!action) return;
    setCommandPaletteOpen(false);
    void action.run();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] bg-black/72 no-print"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setCommandPaletteOpen(false);
      }}
    >
      <div className="w-[620px] max-w-[92vw] bg-[#131720] border border-white/[0.1] rounded-[8px] overflow-hidden shadow-[0_24px_64px_rgba(0,0,0,0.7)]">
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-white/[0.07] bg-[#171C27]">
          <Search className="w-4 h-4 text-[#C5A059] shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSelectedIdx((i) => Math.min(filtered.length - 1, i + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSelectedIdx((i) => Math.max(0, i - 1));
              } else if (e.key === "Enter") {
                e.preventDefault();
                execute(filtered[selectedIdx]);
              } else if (e.key === "Escape") {
                e.preventDefault();
                setCommandPaletteOpen(false);
              }
            }}
            placeholder="Jump to workspace, apply setup preset, or toggle sensor profile..."
            className="w-full bg-transparent text-[#F1F5F9] text-[13px] outline-none placeholder:text-[#64748B]"
          />
          <kbd className="text-[10px] font-mono text-[#94A3B8] bg-[#0B0D12] border border-white/[0.08] px-1.5 py-0.5 rounded-[4px] shrink-0">
            Esc
          </kbd>
        </div>

        <div className="max-h-[380px] overflow-y-auto p-1.5 space-y-0.5">
          {filtered.length === 0 ? (
            <div className="px-4 py-8 text-center text-[12px] text-[#64748B]">
              No matching commands found.
            </div>
          ) : (
            filtered.map((item, idx) => {
              const active = idx === selectedIdx;
              return (
                <button
                  key={item.id}
                  type="button"
                  onMouseEnter={() => setSelectedIdx(idx)}
                  onClick={() => execute(item)}
                  className={`w-full flex items-center justify-between gap-3 px-3 py-2 rounded-[5px] text-left transition-colors cursor-pointer ${
                    active ? "bg-[#1F2534]" : "bg-transparent"
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2.5">
                      <span className="text-[10px] font-medium text-[#64748B] w-[86px] shrink-0">
                        {item.category}
                      </span>
                      <span
                        className={`text-[12.5px] font-medium truncate ${
                          active ? "text-[#DFBE78]" : "text-[#F1F5F9]"
                        }`}
                      >
                        {item.label}
                      </span>
                    </div>
                    <div className="pl-[96px] text-[11px] text-[#64748B] truncate mt-0.5">
                      {item.detail}
                    </div>
                  </div>
                  {item.shortcut ? (
                    <kbd className="text-[10px] font-mono text-[#94A3B8] bg-[#0B0D12] border border-white/[0.08] px-1.5 py-0.5 rounded-[4px] shrink-0">
                      {item.shortcut}
                    </kbd>
                  ) : null}
                </button>
              );
            })
          )}
        </div>

        <div className="flex items-center justify-between px-4 py-2 bg-[#0F1219] border-t border-white/[0.06] text-[11px] text-[#64748B]">
          <span className="flex items-center gap-1.5">
            <Terminal className="w-3.5 h-3.5" />
            Use arrow keys to navigate, Enter to execute
          </span>
          <span className="font-mono text-[10px]">TeR27 Command Bus</span>
        </div>
      </div>
    </div>
  );
}
