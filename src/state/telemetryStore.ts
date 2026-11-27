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
  fetchHealth,
  fetchVehicleOverview,
  saveConfirmedHardpoints,
} from "../services/apiClient";
import {
  connectTelemetrySocket,
  getOfflineMockTelemetryFrame,
  OfflineTelemetrySynthesizer,
  TelemetryConnectionStatus,
} from "../services/telemetrySocket";
import type { WorkbenchRouteId } from "../app/routes";

/**
 * 60-second (3,600-frame @ 60 Hz) zero-GC TypedArray Ring Buffer.
 * Read directly by HTML5 Canvas oscilloscopes and 2x2 friction circles via requestAnimationFrame.
 */
export const RING_CAPACITY = 3600;

export class TelemetryRingBuffer {
  public readonly capacity = RING_CAPACITY;
  public count = 0;
  public writeIdx = 0;

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

  public clear(): void {
    this.count = 0;
    this.writeIdx = 0;
  }
}

export type PlaybackSpeed = 0.25 | 0.5 | 1 | 2;

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
  // High-frequency refs (read at 60 fps inside Canvas / R3F without re-rendering React)
  ringBufferRef: React.MutableRefObject<TelemetryRingBuffer>;
  latestFrameRef: React.MutableRefObject<TelemetryFrame>;

  // Throttled React state (~15-20 Hz) for crisp tabular numeric readouts
  frame: TelemetryFrame;
  connectionStatus: TelemetryConnectionStatus;
  backendLive: boolean;
  backendLatencyMs: number | null;
  forceOfflineMode: boolean;
  setForceOfflineMode: (offline: boolean) => void;
  retryConnection: () => void;

  // Offline 60 Hz playback transport
  isPlaying: boolean;
  setIsPlaying: (playing: boolean) => void;
  togglePlayPause: () => void;
  playbackSpeed: PlaybackSpeed;
  setPlaybackSpeed: (speed: PlaybackSpeed) => void;
  playbackProgress: number; // [0..1]
  playbackDurationS: number;
  seekPlayback: (norm: number) => void;
  stepPlaybackFrame: (deltaFrames: number) => void;

  // Vehicle & configuration state
  vehicleOverview: VehicleOverviewResponse | null;
  refreshVehicleOverview: () => Promise<void>;
  importConfirmedHardpoints: (override: ConfirmedHardpointsOverride | null) => Promise<void>;
  sensorProfile: SensorProfileName;
  setSensorProfile: (profile: SensorProfileName) => Promise<void>;
  gripProfile: string;
  setGripProfile: (profile: string) => void;
  activeSetupName: string;
  setActiveSetupName: (name: string) => void;

  // Global synchronized cursor across plots, 2D map, and 3D Digital Twin
  cursor: GlobalCursorState;
  setCursor: React.Dispatch<React.SetStateAction<GlobalCursorState>>;

  // Navigation & Global UX (Command Palette + Toasts)
  activeRoute: WorkbenchRouteId;
  setActiveRoute: (route: WorkbenchRouteId) => void;
  commandPaletteOpen: boolean;
  setCommandPaletteOpen: React.Dispatch<React.SetStateAction<boolean>>;
  toasts: WorkbenchToast[];
  pushToast: (toast: Omit<WorkbenchToast, "id">) => void;
  dismissToast: (id: number) => void;
}

const TelemetryContext = createContext<TelemetryStoreValue | null>(null);

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

  // Seed initial 120 frames (2 seconds) into ring buffer so live oscilloscopes have immediate history
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

  // Live WebSocket connection (disabled when forceOfflineMode is true)
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

  // 60 Hz Offline Playback Engine + 18 Hz throttled React DOM state publisher
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
      pushToast({
        level: "info",
        title: `Grip Profile: ${profile}`,
        detail:
          profile === "COLD_TEST_OCT"
            ? "lambda_muy = 0.47 (cold October test surface)"
            : "lambda_muy = 0.57 (FSG rubbered competition asphalt)",
      });
    },
    [pushToast]
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
