import React, { useEffect, useMemo, useRef, useState } from "react";
import { Search, Terminal } from "lucide-react";
import { WORKBENCH_PILLARS, WORKBENCH_ROUTES } from "../../app/routes";
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
    dispatchMirenaEventReset,
    dispatchMirenaReplaySync,
    dispatchGhostLap,
    setActiveFaultMode,
    triggerSoftStop,
    triggerEmergencyStop,
    resetSafetyLatch,
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
    const routeActions: PaletteAction[] = WORKBENCH_ROUTES.map((r) => {
      const pillar = WORKBENCH_PILLARS.find((p) => p.id === r.pillarId);
      return {
        id: `route-${r.id}`,
        category: `Pillar ${pillar?.roman ?? ""}`,
        label: r.label,
        detail: r.description,
        shortcut: r.shortcut,
        run: () => setActiveRoute(r.id),
      };
    });

    const mirenaActions: PaletteAction[] = [
      {
        id: "mirena-reset-skidpad",
        category: "MirenaSim",
        label: "Reset Simulator: Skidpad",
        detail: "Dispatch UDP 9877 event reset to FSG Skidpad figure-8 gate",
        run: () => dispatchMirenaEventReset("skidpad"),
      },
      {
        id: "mirena-reset-accel",
        category: "MirenaSim",
        label: "Reset Simulator: Acceleration 75 m",
        detail: "Dispatch UDP 9877 event reset to 75 m straight launch gate",
        run: () => dispatchMirenaEventReset("accel"),
      },
      {
        id: "mirena-reset-autocross",
        category: "MirenaSim",
        label: "Reset Simulator: Autocross",
        detail: "Dispatch UDP 9877 event reset to FSG Autocross start line",
        run: () => dispatchMirenaEventReset("autocross"),
      },
      {
        id: "mirena-reset-endurance",
        category: "MirenaSim",
        label: "Reset Simulator: Endurance 22 km",
        detail: "Dispatch UDP 9877 event reset to 18-lap Endurance circuit",
        run: () => dispatchMirenaEventReset("endurance"),
      },
      {
        id: "mirena-replay-sync",
        category: "MirenaSim",
        label: "Sync 3D Replay Cursor (replay_seek)",
        detail: "Frame-lock Godot 3D viewport to active workbench timeline timestamp",
        run: () => dispatchMirenaReplaySync(),
      },
      {
        id: "mirena-ghost-inject",
        category: "Real-to-Sim",
        label: "Inject Verified Skidpad Ghost Lap to MirenaSim",
        detail: "Send verified trajectory reference packet via UDP 9877",
        run: () =>
          dispatchGhostLap(
            "casadi_optimal_skidpad_fsg_rubbered",
            "CasADi Skidpad Reference (4.607s)",
            600
          ),
      },
    ];

    const faultActions: PaletteAction[] = [
      {
        id: "safety-soft-stop",
        category: "Safety E-Stop",
        label: "Trigger SOFT STOP (Controlled Deceleration)",
        detail: "Cut tractive discharge to 0 kW and apply smooth regenerative + hydraulic braking",
        run: () => triggerSoftStop("Command Palette Soft Stop"),
      },
      {
        id: "safety-hard-estop",
        category: "Safety E-Stop",
        label: "Trigger HARD E-STOP (SDC OPEN / 0 Nm)",
        detail: "Open Shutdown Circuit, cut all 4 motors to 0.0 Nm, dispatch HARD_SHUTDOWN via UDP 9877",
        run: () => triggerEmergencyStop("Command Palette Hard E-Stop"),
      },
      {
        id: "safety-reset-latch",
        category: "Safety E-Stop",
        label: "Reset Safety Latch & Re-Close SDC",
        detail: "Clear active E-Stop / Soft Stop / injected fault and restore nominal 4WD",
        run: () => resetSafetyLatch(),
      },
      {
        id: "fault-nominal",
        category: "Safety Bench",
        label: "Fault Scenario: Nominal 4WD (AL-QP Active)",
        detail: "Restore all four in-wheel motors and open Safety & E-Stop Supervisor",
        run: () => {
          setActiveFaultMode("nominal_4wd");
          setActiveRoute("ekf_faults");
        },
      },
      {
        id: "fault-fl-loss",
        category: "Safety Bench",
        label: "Inject 3WD Limp-Home: Front-Left Motor Loss",
        detail: "Disable FL actuator and evaluate compensatory torque reallocation",
        run: () => {
          setActiveFaultMode("motor_loss_fl");
          setActiveRoute("ekf_faults");
        },
      },
      {
        id: "fault-rr-loss",
        category: "Safety Bench",
        label: "Inject 3WD Limp-Home: Rear-Right Motor Loss",
        detail: "Disable RR actuator and evaluate yaw stability margin",
        run: () => {
          setActiveFaultMode("motor_loss_rr");
          setActiveRoute("ekf_faults");
        },
      },
    ];

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
          : "Switch to Offline Deterministic Engine",
        detail: forceOfflineMode
          ? "Attempt FastAPI REST + WS telemetry handshake"
          : "Bypass localhost:8000 and run deterministic 60 Hz offline engine",
        run: () => {
          if (forceOfflineMode) {
            retryConnection();
          } else {
            setForceOfflineMode(true);
            pushToast({
              level: "info",
              title: "Offline Engine Active",
              detail: "Synthesizing continuous 60 Hz frames from verified mock datasets.",
            });
          }
        },
      },
    ];

    return [...routeActions, ...mirenaActions, ...faultActions, ...setupActions, ...systemActions];
  }, [
    dispatchGhostLap,
    dispatchMirenaEventReset,
    dispatchMirenaReplaySync,
    forceOfflineMode,
    isPlaying,
    pushToast,
    retryConnection,
    sensorProfile,
    setActiveFaultMode,
    setActiveRoute,
    setActiveSetupName,
    setForceOfflineMode,
    setGripProfile,
    setSensorProfile,
    togglePlayPause,
    triggerSoftStop,
    triggerEmergencyStop,
    resetSafetyLatch,
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
      className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] bg-black/75 no-print"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setCommandPaletteOpen(false);
      }}
    >
      <div className="w-[650px] max-w-[92vw] bg-[#131720] border border-white/[0.1] rounded-[8px] overflow-hidden shadow-[0_24px_64px_rgba(0,0,0,0.7)]">
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
            placeholder="Jump to any of 12 workspaces, reset MirenaSim event, inject ghost lap, or trigger fault..."
            className="w-full bg-transparent text-[#F1F5F9] text-[13px] outline-none placeholder:text-[#64748B]"
          />
          <kbd className="text-[10px] font-mono text-[#94A3B8] bg-[#0B0D12] border border-white/[0.08] px-1.5 py-0.5 rounded-[4px] shrink-0">
            Esc
          </kbd>
        </div>

        <div className="max-h-[410px] overflow-y-auto p-1.5 space-y-0.5">
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
            12 Workspaces · MirenaSim UDP 9877 · Fault Injection
          </span>
          <span className="font-mono text-[10px]">TeR27 Command Bus</span>
        </div>
      </div>
    </div>
  );
}
