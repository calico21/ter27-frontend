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
    gripProfile,
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
      category: "WORKSPACE",
      label: r.label,
      detail: r.description,
      shortcut: `${idx + 1}`,
      run: () => setActiveRoute(r.id),
    }));

    const setupActions: PaletteAction[] = PRESET_NAMES.map((preset) => ({
      id: `setup-${preset.id}`,
      category: "SETUP PRESET",
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
        category: "CONTROL & SENSORS",
        label:
          sensorProfile === "SENSOR_TRACK_REALISM"
            ? "Switch to SENSOR_IDEAL (0 ms)"
            : "Switch to SENSOR_TRACK_REALISM (125 ms CAN + EKF)",
        detail: "Toggle MirenaSim / offline synthesizer sensor realism profile",
        run: () =>
          setSensorProfile(
            sensorProfile === "SENSOR_TRACK_REALISM" ? "SENSOR_IDEAL" : "SENSOR_TRACK_REALISM"
          ),
      },
      {
        id: "grip-fsg",
        category: "GRIP PROFILE",
        label: "Grip Profile: FSG_RUBBERED (lambda_muy = 0.57)",
        detail: "Competition rubbered asphalt surface calibration",
        run: () => setGripProfile("FSG_RUBBERED"),
      },
      {
        id: "grip-cold",
        category: "GRIP PROFILE",
        label: "Grip Profile: COLD_TEST_OCT (lambda_muy = 0.47)",
        detail: "Cold October track surface calibration (18 C ambient)",
        run: () => setGripProfile("COLD_TEST_OCT"),
      },
      {
        id: "playback-toggle",
        category: "TELEMETRY",
        label: isPlaying ? "Pause Telemetry Stream" : "Resume Telemetry Stream",
        detail: "Freeze or resume live / offline 60 Hz ingestion",
        shortcut: "Space",
        run: () => togglePlayPause(),
      },
      {
        id: "backend-mode",
        category: "TRANSPORT",
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
              title: "Offline Mock Engine Enabled",
              detail: "Synthesizing continuous 60 Hz frames from verified mock_data.",
            });
          }
        },
      },
      {
        id: "session-forensics-skidpad",
        category: "DIL SESSION",
        label: "Load Session: Skidpad 14-DOF Godot Parity vs CasADi",
        detail: "Jump to Session Forensics with verified FSG_RUBBERED comparison",
        run: () => setActiveRoute("forensics"),
      },
    ];

    return [...routeActions, ...setupActions, ...systemActions];
  }, [
    forceOfflineMode,
    gripProfile,
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
      className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] bg-black/70 no-print"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setCommandPaletteOpen(false);
      }}
    >
      <div className="w-[620px] max-w-[92vw] bg-[#0F1116] border border-[#222633] rounded-[2px] overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-[#222633] bg-[#151820]">
          <Search className="w-3.5 h-3.5 text-[#C5A059] shrink-0" />
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
            placeholder="Type workspace, setup preset, sensor profile, or command..."
            className="w-full bg-transparent text-[#ECEFF4] text-[12px] font-mono outline-none placeholder:text-[#7E8799]"
          />
          <span className="text-[10px] font-mono text-[#7E8799] shrink-0">ESC</span>
        </div>

        <div className="max-h-[380px] overflow-y-auto divide-y divide-[#222633]/60">
          {filtered.length === 0 ? (
            <div className="px-3 py-6 text-center text-[11px] font-mono text-[#7E8799]">
              No matching engineering commands.
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
                  className={`w-full flex items-center justify-between gap-3 px-3 py-2 text-left transition-colors ${
                    active ? "bg-[#1B1F2A]" : "bg-[#0F1116]"
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] font-mono uppercase tracking-[0.06em] text-[#7E8799] w-[112px] shrink-0">
                        {item.category}
                      </span>
                      <span
                        className={`text-[12px] truncate ${
                          active ? "text-[#C5A059] font-medium" : "text-[#ECEFF4]"
                        }`}
                      >
                        {item.label}
                      </span>
                    </div>
                    <div className="pl-[120px] text-[10px] text-[#7E8799] truncate">
                      {item.detail}
                    </div>
                  </div>
                  {item.shortcut ? (
                    <span className="text-[10px] font-mono text-[#7E8799] border border-[#222633] px-1.5 py-0.5 shrink-0">
                      {item.shortcut}
                    </span>
                  ) : null}
                </button>
              );
            })
          )}
        </div>

        <div className="flex items-center justify-between px-3 py-1.5 bg-[#151820] border-t border-[#222633] text-[10px] font-mono text-[#7E8799]">
          <span className="flex items-center gap-1.5">
            <Terminal className="w-3 h-3 text-[#7E8799]" />
            Arrows navigate / Enter execute
          </span>
          <span>TeR27 4WD Command Bus</span>
        </div>
      </div>
    </div>
  );
}
