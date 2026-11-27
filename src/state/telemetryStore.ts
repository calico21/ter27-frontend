import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  SensorProfileName,
  TelemetryFrame,
  VehicleOverviewResponse,
} from "../types";
import {
  applySetupPreset,
  ConfirmedHardpointsOverride,
  dispatchEmergencyStop,
  dispatchMirenaCommand,
  fetchHealth,
  fetchVehicleOverview,
  saveConfirmedHardpoints,
} from "../services/apiClient";
import type { TvFaultMode } from "../services/physics/tvControlModel";
import type { SignalSafetyOverlay } from "../services/vehicleSignalCatalog";
import {
  connectTelemetrySocket,
  getOfflineMockTelemetryFrame,
  OfflineTelemetrySynthesizer,
  TelemetryConnectionStatus,
} from "../services/telemetrySocket";
import type { WorkbenchRouteId } from "../app/routes";

/**
 * 60-second (3,600-frame @ 60 Hz) zero-GC TypedArray + Frame Ring Buffer.
 * Read directly by HTML5 Canvas oscilloscopes, 2x2 friction circles, and Pre-Fault Freeze-Frame capture.
 */
export const RING_CAPACITY = 3600;

export class TelemetryRingBuffer {
  public readonly capacity = RING_CAPACITY;
  public count = 0;
  public writeIdx = 0;

  public readonly frames: Array<TelemetryFrame | null> = new Array(RING_CAPACITY).fill(null);

  public readonly t = new Float64Array(RING_CAPACITY);
  public readonly vxKmh = new Float32Array(RING_CAPACITY);
  public readonly deltaT = new Float32Array(RING_CAPACITY);
  public readonly axG = new Float32Array(RING_CAPACITY);
  public readonly ayG = new Float32Array(RING_CAPACITY);
  public readonly yawRate = new Float32Array(RING_CAPACITY);
  public readonly betaDeg = new Float32Array(RING_CAPACITY);
  public readonly ekfBetaDeg = new Float32Array(RING_CAPACITY);
  public readonly ekfVxKmh = new Float32Array(RING_CAPACITY);
  public readonly steerDeg = new Float32Array(RING_CAPACITY);
  public readonly torqueFL = new Float32Array(RING_CAPACITY);
  public readonly torqueFR = new Float32Array(RING_CAPACITY);
  public readonly torqueRL = new Float32Array(RING_CAPACITY);
  public readonly torqueRR = new Float32Array(RING_CAPACITY);

  public readonly flFx = new Float32Array(RING_CAPACITY);
  public readonly flFy = new Float32Array(RING_CAPACITY);
  public readonly frFx = new Float32Array(RING_CAPACITY);
  public readonly frFy = new Float32Array(RING_CAPACITY);
  public readonly rlFx = new Float32Array(RING_CAPACITY);
  public readonly rlFy = new Float32Array(RING_CAPACITY);
  public readonly rrFx = new Float32Array(RING_CAPACITY);
  public readonly rrFy = new Float32Array(RING_CAPACITY);

  public readonly pDcKw = new Float32Array(RING_CAPACITY);
  public readonly tvMzNm = new Float32Array(RING_CAPACITY);

  public push(f: TelemetryFrame): void {
    const i = this.writeIdx;
    this.frames[i] = f;
    this.t[i] = f.timestamp_s;
    this.vxKmh[i] = f.state.vx * 3.6;
    this.deltaT[i] = f.dil_delta.delta_time_s;
    this.axG[i] = f.state.ax_g;
    this.ayG[i] = f.state.ay_g;
    this.yawRate[i] = f.state.yaw_rate_rad_s;
    this.betaDeg[i] = f.state.beta_deg;
    this.ekfBetaDeg[i] = f.ekf.ekf_beta_deg;
    this.ekfVxKmh[i] = f.ekf.ekf_vx * 3.6;
    this.steerDeg[i] = f.state.steer_deg;

    this.torqueFL[i] = f.wheels.fl.motor_torque_nm;
    this.torqueFR[i] = f.wheels.fr.motor_torque_nm;
    this.torqueRL[i] = f.wheels.rl.motor_torque_nm;
    this.torqueRR[i] = f.wheels.rr.motor_torque_nm;

    this.flFx[i] = f.wheels.fl.fx_n;
    this.flFy[i] = f.wheels.fl.fy_n;
    this.frFx[i] = f.wheels.fr.fx_n;
    this.frFy[i] = f.wheels.fr.fy_n;
    this.rlFx[i] = f.wheels.rl.fx_n;
    this.rlFy[i] = f.wheels.rl.fy_n;
    this.rrFx[i] = f.wheels.rr.fx_n;
    this.rrFy[i] = f.wheels.rr.fy_n;

    this.pDcKw[i] = f.hv.p_dc_kw - f.hv.p_regen_kw;
    this.tvMzNm[i] = f.hv.tv_mz_nm;

    this.writeIdx = (i + 1) % this.capacity;
    if (this.count < this.capacity) {
      this.count += 1;
    }
  }

  public getPhysicalIndex(logicalFromOldest: number): number {
    if (this.count < this.capacity) {
      return logicalFromOldest;
    }
    return (this.writeIdx + logicalFromOldest) % this.capacity;
  }

  public captureRecentFrames(maxFrames = 120): TelemetryFrame[] {
    const n = Math.min(this.count, maxFrames);
    const startLogical = this.count - n;
    const out: TelemetryFrame[] = [];
    for (let k = 0; k < n; k++) {
      const fr = this.frames[this.getPhysicalIndex(startLogical + k)];
      if (fr) out.push(fr);
    }
    return out;
  }

  public clear(): void {
    this.count = 0;
    this.writeIdx = 0;
    this.frames.fill(null);
  }
}

export type PlaybackSpeed = 0.25 | 0.5 | 1 | 2;
export type VehicleStopState = "NOMINAL" | "SOFT_STOP" | "E_STOP";

export type SafetyFaultInjection =
  | "apps_mismatch"
  | "bspd_violation"
  | "can_spike_240ms"
  | "rr_inv_overtemp"
  | "fr_rl_swap";

export interface AutoInterlockConfig {
  ekfBetaSoftStop: boolean; // Auto Soft Stop if |beta - ekf_beta| > 2.5 deg for 200 ms
  hvPowerOrCellEstop: boolean; // Auto E-Stop if HV power > 80.5 kW or Cell Temp > 60 C
  inverterOvertempLimp3wd: boolean; // Auto-derate to 3WD Limp-Home on inverter overtemp
  appsBspdHardCutoff: boolean; // Auto E-Stop on APPS T.4.2.5 or BSPD EV 2.3 trip
}

export interface SafetyEventLog {
  id: number;
  timestampMs: string;
  severity: "NOMINAL" | "CAUTION" | "TRIP";
  source: string;
  message: string;
  action: string;
}

export interface WorkbenchToast {
  id: number;
  level: "nominal" | "caution" | "limit" | "info";
  title: string;
  detail: string;
}

export interface GlobalCursorState {
  cursorDistanceM: number;
  cursorTimeS: number;
  markerA: number | null;
  markerB: number | null;
}

interface TelemetryStoreValue {
  ringBufferRef: React.MutableRefObject<TelemetryRingBuffer>;
  latestFrameRef: React.MutableRefObject<TelemetryFrame>;

  frame: TelemetryFrame;
  connectionStatus: TelemetryConnectionStatus;
  backendLive: boolean;
  backendLatencyMs: number | null;
  forceOfflineMode: boolean;
  setForceOfflineMode: (offline: boolean) => void;
  retryConnection: () => void;

  isPlaying: boolean;
  setIsPlaying: (playing: boolean) => void;
  togglePlayPause: () => void;
  playbackSpeed: PlaybackSpeed;
  setPlaybackSpeed: (speed: PlaybackSpeed) => void;
  playbackProgress: number;
  playbackDurationS: number;
  seekPlayback: (norm: number) => void;
  stepPlaybackFrame: (deltaFrames: number) => void;

  vehicleOverview: VehicleOverviewResponse | null;
  refreshVehicleOverview: () => Promise<void>;
  importConfirmedHardpoints: (override: ConfirmedHardpointsOverride | null) => Promise<void>;
  sensorProfile: SensorProfileName;
  setSensorProfile: (profile: SensorProfileName) => Promise<void>;
  gripProfile: string;
  setGripProfile: (profile: string) => void;
  activeSetupName: string;
  setActiveSetupName: (name: string) => void;

  activeSimEvent: "skidpad" | "accel" | "autocross" | "endurance";
  dispatchMirenaEventReset: (event: "skidpad" | "accel" | "autocross" | "endurance") => Promise<void>;
  dispatchMirenaReplaySync: (timeS?: number) => Promise<void>;
  dispatchGhostLap: (sessionId: string, label: string, sampleCount: number) => Promise<void>;
  activeFaultMode: TvFaultMode;
  setActiveFaultMode: (mode: TvFaultMode) => void;

  // Global Safety Supervisor & Emergency Stop System
  stopState: VehicleStopState;
  sdcClosed: boolean;
  stopReason: string | null;
  triggerSoftStop: (reason?: string) => Promise<void>;
  triggerEmergencyStop: (reason?: string) => Promise<void>;
  resetSafetyLatch: () => Promise<void>;
  injectedSafetyFault: SafetyFaultInjection | null;
  injectSafetyFault: (fault: SafetyFaultInjection | null) => void;
  autoInterlocks: AutoInterlockConfig;
  setAutoInterlocks: React.Dispatch<React.SetStateAction<AutoInterlockConfig>>;
  safetyEvents: SafetyEventLog[];
  clearSafetyEvents: () => void;
  preFaultFreezeFrame: TelemetryFrame[];
  safetyOverlay: SignalSafetyOverlay;

  cursor: GlobalCursorState;
  setCursor: React.Dispatch<React.SetStateAction<GlobalCursorState>>;

  activeRoute: WorkbenchRouteId;
  setActiveRoute: (route: WorkbenchRouteId) => void;
  commandPaletteOpen: boolean;
  setCommandPaletteOpen: React.Dispatch<React.SetStateAction<boolean>>;
  toasts: WorkbenchToast[];
  pushToast: (toast: Omit<WorkbenchToast, "id">) => void;
  dismissToast: (id: number) => void;
}

const TelemetryContext = createContext<TelemetryStoreValue | null>(null);

function formatClockMs(): string {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return `${hh}:${mm}:${ss}.${ms}`;
}

export function TelemetryProvider({ children }: { children: React.ReactNode }) {
  const ringBufferRef = useRef<TelemetryRingBuffer>(new TelemetryRingBuffer());
  const synthRef = useRef<OfflineTelemetrySynthesizer>(new OfflineTelemetrySynthesizer());
  const latestFrameRef = useRef<TelemetryFrame>(getOfflineMockTelemetryFrame());

  const [frame, setFrame] = useState<TelemetryFrame>(() => getOfflineMockTelemetryFrame());
  const [connectionStatus, setConnectionStatus] =
    useState<TelemetryConnectionStatus>("offline_mock");
  const [backendLive, setBackendLive] = useState<boolean>(false);
  const [backendLatencyMs, setBackendLatencyMs] = useState<number | null>(null);
  const [forceOfflineMode, setForceOfflineMode] = useState<boolean>(false);
  const [reconnectToken, setReconnectToken] = useState<number>(0);

  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [playbackSpeed, setPlaybackSpeed] = useState<PlaybackSpeed>(1);
  const [playbackProgress, setPlaybackProgress] = useState<number>(0);

  const [vehicleOverview, setVehicleOverview] = useState<VehicleOverviewResponse | null>(null);
  const [sensorProfile, setSensorProfileState] = useState<SensorProfileName>("SENSOR_TRACK_REALISM");
  const [gripProfile, setGripProfileState] = useState<string>("FSG_RUBBERED");
  const [activeSetupName, setActiveSetupName] = useState<string>("default");
  const [activeSimEvent, setActiveSimEvent] = useState<"skidpad" | "accel" | "autocross" | "endurance">("skidpad");
  const [activeFaultMode, setActiveFaultModeState] = useState<TvFaultMode>("nominal_4wd");

  // Safety Supervisor State
  const [stopState, setStopState] = useState<VehicleStopState>("NOMINAL");
  const [stopReason, setStopReason] = useState<string | null>(null);
  const [injectedSafetyFault, setInjectedSafetyFaultState] = useState<SafetyFaultInjection | null>(null);
  const [autoInterlocks, setAutoInterlocks] = useState<AutoInterlockConfig>({
    ekfBetaSoftStop: true,
    hvPowerOrCellEstop: true,
    inverterOvertempLimp3wd: true,
    appsBspdHardCutoff: true,
  });
  const [safetyEvents, setSafetyEvents] = useState<SafetyEventLog[]>([
    {
      id: 1,
      timestampMs: formatClockMs(),
      severity: "NOMINAL",
      source: "SUPERVISOR_INIT",
      message: "Shutdown Circuit (SDC) closed; 200 Hz STM32F405 watchdog armed.",
      action: "NOMINAL_READY",
    },
  ]);
  const [preFaultFreezeFrame, setPreFaultFreezeFrame] = useState<TelemetryFrame[]>([]);

  const [cursor, setCursor] = useState<GlobalCursorState>({
    cursorDistanceM: 0,
    cursorTimeS: 0,
    markerA: null,
    markerB: null,
  });

  const [activeRoute, setActiveRoute] = useState<WorkbenchRouteId>("live_pitwall");
  const [commandPaletteOpen, setCommandPaletteOpen] = useState<boolean>(false);
  const [toasts, setToasts] = useState<WorkbenchToast[]>([]);

  const isPlayingRef = useRef(isPlaying);
  const playbackSpeedRef = useRef(playbackSpeed);
  const connectionStatusRef = useRef(connectionStatus);
  const forceOfflineRef = useRef(forceOfflineMode);

  isPlayingRef.current = isPlaying;
  playbackSpeedRef.current = playbackSpeed;
  connectionStatusRef.current = connectionStatus;
  forceOfflineRef.current = forceOfflineMode;

  const pushToast = useCallback((toast: Omit<WorkbenchToast, "id">) => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts((prev) => [...prev.slice(-3), { ...toast, id }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const appendSafetyEvent = useCallback(
    (severity: SafetyEventLog["severity"], source: string, message: string, action: string) => {
      setSafetyEvents((prev) => [
        {
          id: Date.now() + Math.floor(Math.random() * 1000),
          timestampMs: formatClockMs(),
          severity,
          source,
          message,
          action,
        },
        ...prev.slice(0, 39),
      ]);
    },
    []
  );

  const clearSafetyEvents = useCallback(() => {
    setSafetyEvents([]);
  }, []);

  const refreshVehicleOverview = useCallback(async () => {
    const [healthRes, overviewRes] = await Promise.all([
      fetchHealth(forceOfflineMode),
      fetchVehicleOverview(forceOfflineMode),
    ]);
    setBackendLive(healthRes.live);
    setBackendLatencyMs(healthRes.latencyMs ?? null);
    setVehicleOverview(overviewRes.data);
  }, [forceOfflineMode]);

  useEffect(() => {
    refreshVehicleOverview();
  }, [refreshVehicleOverview, reconnectToken]);

  // Seed initial 180 frames (3 seconds) into ring buffer
  useEffect(() => {
    if (ringBufferRef.current.count === 0) {
      const synth = synthRef.current;
      for (let i = 0; i < 180; i++) {
        const f = synth.step(1 / 60);
        ringBufferRef.current.push(f);
        latestFrameRef.current = f;
      }
      setFrame(latestFrameRef.current);
      setPlaybackProgress(synth.getCurrentLoopTimeS() / synth.getDurationS());
    }
  }, []);

  // Live WebSocket connection
  useEffect(() => {
    if (forceOfflineMode) {
      setConnectionStatus("offline_mock");
      setBackendLive(false);
      return;
    }

    const disconnect = connectTelemetrySocket(
      (incoming) => {
        if (!isPlayingRef.current) return;
        ringBufferRef.current.push(incoming);
        latestFrameRef.current = incoming;
      },
      (status) => {
        setConnectionStatus(status);
        if (status === "connected") {
          setBackendLive(true);
        }
      }
    );

    return disconnect;
  }, [forceOfflineMode, reconnectToken]);

  // 60 Hz Offline Playback Engine + ~18 Hz React DOM publish
  useEffect(() => {
    let rafId = 0;
    let lastPerf = performance.now();
    let accumSynth = 0;
    let lastUiPublish = performance.now();

    const loop = (now: number) => {
      const dtWall = Math.min(0.1, (now - lastPerf) / 1000);
      lastPerf = now;

      const usingOffline = forceOfflineRef.current || connectionStatusRef.current !== "connected";
      if (usingOffline && isPlayingRef.current) {
        accumSynth += dtWall;
        const stepWall = 1 / 60;
        let steps = 0;
        while (accumSynth >= stepWall && steps < 4) {
          const f = synthRef.current.step(stepWall * playbackSpeedRef.current);
          ringBufferRef.current.push(f);
          latestFrameRef.current = f;
          accumSynth -= stepWall;
          steps += 1;
        }
      }

      if (now - lastUiPublish >= 55) {
        lastUiPublish = now;
        setFrame(latestFrameRef.current);
        if (usingOffline) {
          setPlaybackProgress(
            synthRef.current.getCurrentLoopTimeS() / Math.max(0.1, synthRef.current.getDurationS())
          );
        }
      }

      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, []);

  const triggerSoftStop = useCallback(
    async (reason = "Manual Pitwall Soft Stop") => {
      setStopState("SOFT_STOP");
      setStopReason(reason);
      synthRef.current.setStopMode("SOFT_STOP");
      setPreFaultFreezeFrame(ringBufferRef.current.captureRecentFrames(120));
      appendSafetyEvent(
        "CAUTION",
        "SOFT_STOP",
        `${reason} — Controlled regenerative + hydraulic deceleration engaged.`,
        "CMD_SOFT_STOP"
      );
      const res = await dispatchEmergencyStop("SOFT_STOP", reason, forceOfflineMode);
      pushToast({
        level: "caution",
        title: "SOFT STOP ENGAGED",
        detail: res.live
          ? `Dispatched controlled pit deceleration to MirenaSim UDP ${res.data.target_port}.`
          : "Controlled deceleration active in offline physics engine (0 kW tractive).",
      });
    },
    [appendSafetyEvent, forceOfflineMode, pushToast]
  );

  const triggerEmergencyStop = useCallback(
    async (reason = "Manual Engineer Hard E-Stop") => {
      setStopState("E_STOP");
      setStopReason(reason);
      synthRef.current.setStopMode("E_STOP");
      setPreFaultFreezeFrame(ringBufferRef.current.captureRecentFrames(120));
      appendSafetyEvent(
        "TRIP",
        "E_STOP_SDC",
        `${reason} — SDC OPENED, 4WD motor torques zeroed (0.0 Nm), max emergency brake latched.`,
        "HARD_SHUTDOWN"
      );
      const res = await dispatchEmergencyStop("HARD_SHUTDOWN", reason, forceOfflineMode);
      pushToast({
        level: "limit",
        title: "E-STOP TRIPPED — SDC OPEN",
        detail: res.live
          ? `HARD_SHUTDOWN sent via UDP ${res.data.target_port}. Explicit reset required.`
          : "All 4 motors cut to 0.0 Nm; braking to 0.0 km/h. Explicit reset required.",
      });
    },
    [appendSafetyEvent, forceOfflineMode, pushToast]
  );

  const resetSafetyLatch = useCallback(async () => {
    setStopState("NOMINAL");
    setStopReason(null);
    setInjectedSafetyFaultState(null);
    synthRef.current.setInjectedFault(null);
    synthRef.current.setStopMode("NOMINAL");
    setActiveFaultModeState("nominal_4wd");
    appendSafetyEvent(
      "NOMINAL",
      "LATCH_RESET",
      "Engineer verified scrutineering interlocks; Shutdown Circuit (SDC) re-closed.",
      "RESUME_NOMINAL"
    );
    await dispatchEmergencyStop("RESET", "Engineer explicit safety latch reset", forceOfflineMode);
    pushToast({
      level: "nominal",
      title: "Safety Latch Reset — SDC Closed",
      detail: "All interlocks cleared and nominal 4WD operation restored.",
    });
  }, [appendSafetyEvent, forceOfflineMode, pushToast]);

  const injectSafetyFault = useCallback(
    (fault: SafetyFaultInjection | null) => {
      setInjectedSafetyFaultState(fault);
      synthRef.current.setInjectedFault(fault);
      if (!fault) {
        appendSafetyEvent(
          "NOMINAL",
          "FAULT_CLEAR",
          "Cleared injected safety fault scenario.",
          "NOMINAL"
        );
        return;
      }

      // Capture 2.0 s pre-fault freeze-frame immediately
      setPreFaultFreezeFrame(ringBufferRef.current.captureRecentFrames(120));

      if (fault === "apps_mismatch") {
        appendSafetyEvent(
          "TRIP",
          "APPS_T4.2.5",
          "Injected APPS1/APPS2 dual-channel mismatch (16.4% > 10% for >100 ms).",
          autoInterlocks.appsBspdHardCutoff ? "AUTO_E_STOP" : "ALARM_ONLY"
        );
        if (autoInterlocks.appsBspdHardCutoff) {
          void triggerEmergencyStop("Auto-Trip: APPS T.4.2.5 Dual-Channel Mismatch > 10%");
        }
      } else if (fault === "bspd_violation") {
        appendSafetyEvent(
          "TRIP",
          "BSPD_EV2.3",
          "Injected simultaneous brake pressure (62%) + HV power (18.4 kW > 5.0 kW).",
          autoInterlocks.appsBspdHardCutoff ? "AUTO_E_STOP" : "ALARM_ONLY"
        );
        if (autoInterlocks.appsBspdHardCutoff) {
          void triggerEmergencyStop("Auto-Trip: BSPD EV 2.3 Brake + >5 kW Plausibility Violation");
        }
      } else if (fault === "can_spike_240ms") {
        appendSafetyEvent(
          "CAUTION",
          "CAN_WATCHDOG",
          "Injected CAN transport latency spike (242 ms > 200 ms) & EKF |Δβ| divergence.",
          autoInterlocks.ekfBetaSoftStop ? "AUTO_SOFT_STOP" : "ALARM_ONLY"
        );
        if (autoInterlocks.ekfBetaSoftStop) {
          void triggerSoftStop("Auto-Soft-Stop: CAN Timeout 242 ms / EKF β Error > 2.5 deg");
        }
      } else if (fault === "rr_inv_overtemp") {
        appendSafetyEvent(
          "CAUTION",
          "INV_THERMAL",
          "Injected Rear-Right Inverter IGBT overtemperature (88.4 °C > 78 °C derate gate).",
          autoInterlocks.inverterOvertempLimp3wd ? "DERATE_3WD_LIMP" : "ALARM_ONLY"
        );
        if (autoInterlocks.inverterOvertempLimp3wd) {
          setActiveFaultModeState("motor_loss_rr");
          pushToast({
            level: "caution",
            title: "3WD Limp-Home Engaged (RR Cut)",
            detail: "RR inverter overtemp detected; AL-QP reallocated yaw authority to FL/FR/RL.",
          });
        }
      } else if (fault === "fr_rl_swap") {
        appendSafetyEvent(
          "CAUTION",
          "SENSOR_AUDIT",
          "Injected FR <-> RL thermistor & wheel-speed cross-channel swap anomaly.",
          "DIAGNOSTIC_FLAG"
        );
        pushToast({
          level: "caution",
          title: "FR <-> RL Sensor Swap Flagged",
          detail: "Cross-check detected wheel thermal/speed asymmetry between FR and RL.",
        });
      }
    },
    [
      appendSafetyEvent,
      autoInterlocks.appsBspdHardCutoff,
      autoInterlocks.ekfBetaSoftStop,
      autoInterlocks.inverterOvertempLimp3wd,
      pushToast,
      triggerEmergencyStop,
      triggerSoftStop,
    ]
  );

  const retryConnection = useCallback(() => {
    setForceOfflineMode(false);
    setReconnectToken((n) => n + 1);
    pushToast({
      level: "info",
      title: "Probing FastAPI Backend",
      detail: "Attempting REST + WS handshake on localhost:8000",
    });
  }, [pushToast]);

  const togglePlayPause = useCallback(() => {
    setIsPlaying((prev) => !prev);
  }, []);

  const seekPlayback = useCallback((norm: number) => {
    const f = synthRef.current.seekNormalized(norm);
    ringBufferRef.current.push(f);
    latestFrameRef.current = f;
    setFrame(f);
    setPlaybackProgress(Math.max(0, Math.min(1, norm)));
    setCursor((prev) => ({
      ...prev,
      cursorTimeS: synthRef.current.getCurrentLoopTimeS(),
    }));
  }, []);

  const stepPlaybackFrame = useCallback((deltaFrames: number) => {
    setIsPlaying(false);
    const f = synthRef.current.step((deltaFrames * 1) / 60);
    ringBufferRef.current.push(f);
    latestFrameRef.current = f;
    setFrame(f);
    setPlaybackProgress(
      synthRef.current.getCurrentLoopTimeS() / Math.max(0.1, synthRef.current.getDurationS())
    );
  }, []);

  const setSensorProfile = useCallback(
    async (profile: SensorProfileName) => {
      setSensorProfileState(profile);
      synthRef.current.setSensorProfile(profile);
      const res = await applySetupPreset({ sensor_profile: profile }, forceOfflineMode);
      pushToast({
        level: res.live ? "nominal" : "info",
        title: `Sensor Profile: ${profile}`,
        detail: res.live
          ? `Dispatched via UDP ${res.data.target_port} to MirenaSim.`
          : profile === "SENSOR_TRACK_REALISM"
            ? "Offline synthesizer active: 125 ms CAN latency + EKF residual model."
            : "Offline synthesizer active: 0 ms ideal ground-truth sensor feed.",
      });
    },
    [forceOfflineMode, pushToast]
  );

  const setGripProfile = useCallback(
    (profile: string) => {
      setGripProfileState(profile);
      synthRef.current.setGripProfile(profile);
      void dispatchMirenaCommand("set_grip_profile", { grip_profile: profile }, forceOfflineMode);
      pushToast({
        level: "info",
        title: `Grip Profile: ${profile}`,
        detail:
          profile === "COLD_TEST_OCT"
            ? "lambda_muy = 0.47 (cold October test surface)"
            : "lambda_muy = 0.57 (FSG rubbered competition asphalt)",
      });
    },
    [forceOfflineMode, pushToast]
  );

  const dispatchMirenaEventReset = useCallback(
    async (event: "skidpad" | "accel" | "autocross" | "endurance") => {
      setActiveSimEvent(event);
      const res = await dispatchMirenaCommand("reset_event", { event }, forceOfflineMode);
      pushToast({
        level: res.live ? "nominal" : "info",
        title: `MirenaSim Event Reset: ${event.toUpperCase()}`,
        detail: res.live
          ? `Sent event reset command to Godot UDP ${res.data.target_port}.`
          : `Staged ${event.toUpperCase()} event locally (start FastAPI on :8000 for live UDP 9877).`,
      });
    },
    [forceOfflineMode, pushToast]
  );

  const dispatchMirenaReplaySync = useCallback(
    async (timeS?: number) => {
      const targetS = timeS ?? synthRef.current.getCurrentLoopTimeS();
      const res = await dispatchMirenaCommand(
        "replay_seek",
        { timestamp_s: Number(targetS.toFixed(3)) },
        forceOfflineMode
      );
      pushToast({
        level: res.live ? "nominal" : "info",
        title: `Replay Sync @ ${targetS.toFixed(2)} s`,
        detail: res.live
          ? `Frame-locked MirenaSim 3D viewport via UDP ${res.data.target_port}.`
          : "Timeline cursor synchronized locally (offline playback engine).",
      });
    },
    [forceOfflineMode, pushToast]
  );

  const dispatchGhostLap = useCallback(
    async (sessionId: string, label: string, sampleCount: number) => {
      const res = await dispatchMirenaCommand(
        "inject_ghost",
        { session_id: sessionId, label, n_samples: sampleCount },
        forceOfflineMode
      );
      pushToast({
        level: res.live ? "nominal" : "info",
        title: `Ghost Reference Dispatched: ${label}`,
        detail: res.live
          ? `Injected ${sampleCount} trajectory points to MirenaSim UDP ${res.data.target_port}.`
          : `Validated ${sampleCount}-sample JSON ghost packet locally for MirenaSim injection.`,
      });
    },
    [forceOfflineMode, pushToast]
  );

  const setActiveFaultMode = useCallback(
    (mode: TvFaultMode) => {
      setActiveFaultModeState(mode);
      void dispatchMirenaCommand("set_fault_mode", { fault_mode: mode }, forceOfflineMode);
    },
    [forceOfflineMode]
  );

  const importConfirmedHardpoints = useCallback(
    async (override: ConfirmedHardpointsOverride | null) => {
      saveConfirmedHardpoints(override);
      await refreshVehicleOverview();
      pushToast({
        level: override ? "nominal" : "info",
        title: override ? "Confirmed 3D Hardpoints Loaded" : "Hardpoints Override Cleared",
        detail: override
          ? "ISO 8855 front & rear wishbone coordinates persisted locally."
          : "Reverted to active backend / offline overview state.",
      });
    },
    [pushToast, refreshVehicleOverview]
  );

  // Derived real-time safety overlay used by both Universal Oscilloscope and Safety Supervisor
  const safetyOverlay = useMemo<SignalSafetyOverlay>(() => {
    const ocv = 144 * (3.48 + 0.64 * Math.pow(Math.max(0.05, frame.hv.soc_pct / 100), 0.72));
    const netW = (frame.hv.p_dc_kw - frame.hv.p_regen_kw) * 1000;
    const currentA = netW / Math.max(400, ocv);
    const packVoltageV = Math.max(400, ocv - currentA * 0.145);
    return {
      appsDiffPct: injectedSafetyFault === "apps_mismatch" ? 16.4 : 0.6 + Math.abs(frame.state.throttle) * 0.8,
      inverterTempC: injectedSafetyFault === "rr_inv_overtemp" ? 88.4 : 52 + frame.hv.p_dc_kw * 0.24,
      motorStatorTempC: injectedSafetyFault === "rr_inv_overtemp" ? 118.2 : 74 + frame.hv.p_dc_kw * 0.34,
      maxCellTempC: 39.2 + (100 - frame.hv.soc_pct) * 0.22,
      minCellVoltageV: packVoltageV / 144 - 0.035,
      packVoltageV,
      frRlSwapActive: injectedSafetyFault === "fr_rl_swap",
    };
  }, [frame, injectedSafetyFault]);

  const sdcClosed = stopState !== "E_STOP";

  const value = useMemo<TelemetryStoreValue>(
    () => ({
      ringBufferRef,
      latestFrameRef,
      frame,
      connectionStatus,
      backendLive,
      backendLatencyMs,
      forceOfflineMode,
      setForceOfflineMode,
      retryConnection,
      isPlaying,
      setIsPlaying,
      togglePlayPause,
      playbackSpeed,
      setPlaybackSpeed,
      playbackProgress,
      playbackDurationS: synthRef.current.getDurationS(),
      seekPlayback,
      stepPlaybackFrame,
      vehicleOverview,
      refreshVehicleOverview,
      importConfirmedHardpoints,
      sensorProfile,
      setSensorProfile,
      gripProfile,
      setGripProfile,
      activeSetupName,
      setActiveSetupName,
      activeSimEvent,
      dispatchMirenaEventReset,
      dispatchMirenaReplaySync,
      dispatchGhostLap,
      activeFaultMode,
      setActiveFaultMode,
      stopState,
      sdcClosed,
      stopReason,
      triggerSoftStop,
      triggerEmergencyStop,
      resetSafetyLatch,
      injectedSafetyFault,
      injectSafetyFault,
      autoInterlocks,
      setAutoInterlocks,
      safetyEvents,
      clearSafetyEvents,
      preFaultFreezeFrame,
      safetyOverlay,
      cursor,
      setCursor,
      activeRoute,
      setActiveRoute,
      commandPaletteOpen,
      setCommandPaletteOpen,
      toasts,
      pushToast,
      dismissToast,
    }),
    [
      frame,
      connectionStatus,
      backendLive,
      backendLatencyMs,
      forceOfflineMode,
      retryConnection,
      isPlaying,
      togglePlayPause,
      playbackSpeed,
      playbackProgress,
      seekPlayback,
      stepPlaybackFrame,
      vehicleOverview,
      refreshVehicleOverview,
      importConfirmedHardpoints,
      sensorProfile,
      setSensorProfile,
      gripProfile,
      setGripProfile,
      activeSetupName,
      activeSimEvent,
      dispatchMirenaEventReset,
      dispatchMirenaReplaySync,
      dispatchGhostLap,
      activeFaultMode,
      setActiveFaultMode,
      stopState,
      sdcClosed,
      stopReason,
      triggerSoftStop,
      triggerEmergencyStop,
      resetSafetyLatch,
      injectedSafetyFault,
      injectSafetyFault,
      autoInterlocks,
      safetyEvents,
      clearSafetyEvents,
      preFaultFreezeFrame,
      safetyOverlay,
      cursor,
      activeRoute,
      commandPaletteOpen,
      toasts,
      pushToast,
      dismissToast,
    ]
  );

  return React.createElement(TelemetryContext.Provider, { value }, children);
}

export function useTelemetryStore(): TelemetryStoreValue {
  const ctx = useContext(TelemetryContext);
  if (!ctx) {
    throw new Error("useTelemetryStore must be used inside TelemetryProvider");
  }
  return ctx;
}
