import type {
  SensorProfileName,
  SessionABComparisonResponse,
  TelemetryFrame,
  TrajectorySample,
} from "../types";
import mockLiveFrame from "../../mock_data/live_telemetry_frame.json";
import mockDilComparison from "../../mock_data/dil_session_comparison.json";

export type TelemetryConnectionStatus = "connected" | "reconnecting" | "offline_mock";

const DEFAULT_API_BASE = "http://localhost:8000";

function getWsUrl(): string {
  const envBase =
    (import.meta as unknown as { env?: Record<string, string | undefined> }).env
      ?.VITE_TER27_API_URL ?? DEFAULT_API_BASE;
  return envBase.replace(/^http/, "ws").replace(/\/$/, "") + "/ws/telemetry";
}

export function getOfflineMockTelemetryFrame(): TelemetryFrame {
  return mockLiveFrame as unknown as TelemetryFrame;
}

/**
 * Deterministic 60 Hz Offline Playback Engine.
 * Loops and linearly interpolates mock_data/dil_session_comparison.json +
 * mock_data/live_telemetry_frame.json so live oscilloscopes, 2x2 friction circles,
 * HV powertrain meters, EKF residual comparators, and the 3D Digital Twin run smoothly
 * when localhost:8000 is unreachable.
 */
export class OfflineTelemetrySynthesizer {
  private readonly trace: TrajectorySample[];
  private readonly durationS: number;
  private readonly baseFrame: TelemetryFrame;
  private simTimeS = 0;
  private totalElapsedS = 0;
  private socPct = 95.0;
  private sensorProfile: SensorProfileName = "SENSOR_TRACK_REALISM";
  private gripProfile = "FSG_RUBBERED";

  // Delay queue to accurately model 125 ms CAN transport latency (~8 frames @ 60 Hz)
  private readonly ekfHistory: Array<{ vx: number; vy: number; wz: number; beta: number }> = [];

  constructor() {
    const dil = mockDilComparison as unknown as SessionABComparisonResponse;
    this.trace = dil.driver_trace;
    this.durationS = this.trace.length > 0 ? this.trace[this.trace.length - 1].t_s : 10.58;
    this.baseFrame = mockLiveFrame as unknown as TelemetryFrame;
  }

  public getDurationS(): number {
    return this.durationS;
  }

  public getCurrentLoopTimeS(): number {
    return this.simTimeS;
  }

  public setSensorProfile(profile: SensorProfileName): void {
    this.sensorProfile = profile;
  }

  public setGripProfile(profile: string): void {
    this.gripProfile = profile;
  }

  public seekNormalized(norm: number): TelemetryFrame {
    const clamped = Math.max(0, Math.min(1, norm));
    this.simTimeS = clamped * this.durationS;
    return this.sampleAt(this.simTimeS, this.totalElapsedS);
  }

  public step(dtS: number): TelemetryFrame {
    this.simTimeS = (this.simTimeS + dtS) % this.durationS;
    if (this.simTimeS < 0) this.simTimeS += this.durationS;
    this.totalElapsedS += Math.abs(dtS);
    return this.sampleAt(this.simTimeS, this.totalElapsedS);
  }

  private sampleAt(loopT: number, absT: number): TelemetryFrame {
    const trace = this.trace;
    if (trace.length < 2) return this.baseFrame;

    // Binary search for bracketing samples
    let lo = 0;
    let hi = trace.length - 1;
    while (lo + 1 < hi) {
      const mid = (lo + hi) >> 1;
      if (trace[mid].t_s <= loopT) lo = mid;
      else hi = mid;
    }

    const s0 = trace[lo];
    const s1 = trace[hi];
    const span = Math.max(1e-6, s1.t_s - s0.t_s);
    const u = Math.max(0, Math.min(1, (loopT - s0.t_s) / span));
    const lerp = (a: number, b: number) => a + (b - a) * u;

    const vx = lerp(s0.vx_mps, s1.vx_mps);
    const axG = lerp(s0.ax_g, s1.ax_g);
    const ayG = lerp(s0.ay_g, s1.ay_g);
    const betaDeg = lerp(s0.beta_deg, s1.beta_deg);
    const steerDeg = lerp(s0.steer_deg, s1.steer_deg);
    const mzTvNm = lerp(s0.mz_tv_nm, s1.mz_tv_nm);
    const deltaTS = lerp(s0.delta_t_s, s1.delta_t_s);
    const xM = lerp(s0.x_m, s1.x_m);
    const yM = lerp(s0.y_m, s1.y_m);

    const dx = s1.x_m - s0.x_m;
    const dy = s1.y_m - s0.y_m;
    const headingRad = Math.atan2(dy, dx);

    const betaRad = (betaDeg * Math.PI) / 180;
    const vy = vx * Math.tan(betaRad);
    const yawRate = Math.abs(vx) > 0.5 ? (ayG * 9.80665) / Math.max(vx, 3.0) : 0;

    // TeR27 physical parameters from overview (263 kg, h_cg=0.285 m, wb=1.54 m, tf=1.24 m, tr=1.22 m, clA=2.35 m2)
    const m = 263.0;
    const g = 9.80665;
    const aeroDownforce = 0.5 * 1.225 * 2.35 * vx * vx;
    const totalFz = m * g + aeroDownforce;
    const staticFront = 0.48;
    const dFzLong = (m * axG * g * 0.285) / 1.54;
    const fzFrontAxle = Math.max(200, totalFz * staticFront - dFzLong);
    const fzRearAxle = Math.max(200, totalFz * (1 - staticFront) + dFzLong);

    const lltd = 0.45;
    const dFzLatTotal = (m * ayG * g * 0.285) / 1.23;
    const dFzLatF = dFzLatTotal * lltd;
    const dFzLatR = dFzLatTotal * (1 - lltd);

    // ISO 8855: +Y is left, positive ay_g (left turn) loads right wheels (FR, RR)
    const fzFL = Math.max(95, 0.5 * fzFrontAxle - dFzLatF);
    const fzFR = Math.max(95, 0.5 * fzFrontAxle + dFzLatF);
    const fzRL = Math.max(110, 0.5 * fzRearAxle - dFzLatR);
    const fzRR = Math.max(110, 0.5 * fzRearAxle + dFzLatR);

    const gripMult = this.gripProfile === "COLD_TEST_OCT" ? 0.84 : 1.0;
    const muMax = 1.52 * gripMult;

    // Distribute lateral & longitudinal forces with torque vectoring Mz
    const fyFrontTotal = m * ayG * g * 0.47;
    const fyRearTotal = m * ayG * g * 0.53;
    const fxTotal = m * axG * g + 0.5 * 1.225 * 1.05 * vx * vx;

    // Yaw moment Mz = (Fx_R - Fx_L) * track/2 -> differential wheel torque
    const dFxTv = mzTvNm / 1.23;

    const wheelRadius = 0.203;
    const makeWheel = (
      fz: number,
      axleFz: number,
      axleFy: number,
      isLeft: boolean,
      isFront: boolean
    ) => {
      const loadShare = fz / Math.max(axleFz, 1);
      const fy = axleFy * loadShare;
      const fxBase = fxTotal * (isFront ? 0.44 : 0.56) * 0.5;
      const fx = fxBase + (isLeft ? -0.5 * dFxTv : 0.5 * dFxTv);
      const util = Math.min(1.12, Math.hypot(fx, fy) / Math.max(muMax * fz, 80));
      const slipAngleDeg =
        (isFront ? steerDeg * 0.52 : 0) - betaDeg * 0.85 + Math.atan2(fy, Math.max(fz, 100)) * 5.2;
      const slipRatio = Math.max(-0.18, Math.min(0.18, fx / Math.max(fz * 14, 1500)));
      const staticFz = (isFront ? 0.48 : 0.52) * 0.5 * m * g;
      const wheelRate = isFront ? 35000 * 0.846 : 48000 * 0.846;
      const wheelTravelM = Math.max(-0.028, Math.min(0.028, (fz - staticFz) / wheelRate));
      const staticCamber = isFront ? -2.0 : -1.5;
      const rollDeg = ayG * 0.80; // Confirmed 0.80 deg/g roll gradient from validation vault
      const camberDeg = staticCamber + (isLeft ? -rollDeg * 0.65 : rollDeg * 0.65) - wheelTravelM * 28;
      const motorTorqueNm = fx * wheelRadius;
      const tempBase = this.gripProfile === "COLD_TEST_OCT" ? 34.0 : 75.0;
      const tempC = tempBase + util * 5.2 + (isLeft ? -0.4 : 0.6) * Math.sign(ayG);

      return {
        fx_n: Number(fx.toFixed(2)),
        fy_n: Number(fy.toFixed(2)),
        fz_n: Number(fz.toFixed(2)),
        slip_angle_deg: Number(slipAngleDeg.toFixed(3)),
        slip_ratio: Number(slipRatio.toFixed(4)),
        tire_util: Number(util.toFixed(4)),
        camber_deg: Number(camberDeg.toFixed(2)),
        wheel_travel_m: Number(wheelTravelM.toFixed(5)),
        motor_torque_nm: Number(motorTorqueNm.toFixed(2)),
        temp_c: Number(tempC.toFixed(2)),
      };
    };

    const fl = makeWheel(fzFL, fzFL + fzFR, fyFrontTotal, true, true);
    const fr = makeWheel(fzFR, fzFL + fzFR, fyFrontTotal, false, true);
    const rl = makeWheel(fzRL, fzRL + fzRR, fyRearTotal, true, false);
    const rr = makeWheel(fzRR, fzRL + fzRR, fyRearTotal, false, false);

    // HV Powertrain
    const mechPowerKw = ((fl.fx_n + fr.fx_n + rl.fx_n + rr.fx_n) * vx) / 1000;
    const pDcKw = mechPowerKw > 0 ? Math.min(80.0, mechPowerKw / 0.89 + 1.8) : 0.4;
    const pRegenKw = mechPowerKw < 0 ? Math.min(25.0, Math.abs(mechPowerKw) * 0.82) : 0.0;
    const throttle = axG > -0.05 ? Math.max(0.08, Math.min(1, 0.35 + axG * 0.65)) : 0;
    const brake = axG < -0.18 ? Math.min(1, Math.abs(axG + 0.18) * 0.72) : 0;
    this.socPct = Math.max(12, this.socPct - (pDcKw - pRegenKw) * (1 / 60) * 0.00018);

    // EKF estimator + realistic 125 ms CAN transport delay
    this.ekfHistory.push({ vx, vy, wz: yawRate, beta: betaDeg });
    if (this.ekfHistory.length > 16) this.ekfHistory.shift();

    const isTrackRealism = this.sensorProfile === "SENSOR_TRACK_REALISM";
    const delayFrames = isTrackRealism ? 8 : 0; // 8 frames @ 60 Hz ≈ 125-133 ms
    const refIdx = Math.max(0, this.ekfHistory.length - 1 - delayFrames);
    const delayed = this.ekfHistory[refIdx];
    const noise1 = Math.sin(absT * 19.7) * 0.5 + Math.cos(absT * 31.3) * 0.5;
    const noise2 = Math.cos(absT * 23.1) * 0.5 + Math.sin(absT * 41.9) * 0.5;

    const ekfVx = delayed.vx + (isTrackRealism ? noise1 * 0.065 : 0.004 * noise1);
    const ekfVy = delayed.vy + (isTrackRealism ? noise2 * 0.042 : 0.002 * noise2);
    const ekfWz = delayed.wz + (isTrackRealism ? noise1 * 0.018 : 0.001 * noise1);
    const ekfBeta = delayed.beta + (isTrackRealism ? noise2 * 0.24 : 0.012 * noise2);

    return {
      timestamp_s: Number(absT.toFixed(4)),
      source: "synthetic_fallback",
      vehicle_id: "ter27_4wd",
      grip_profile: this.gripProfile,
      sensor_profile: this.sensorProfile,
      state: {
        vx: Number(vx.toFixed(4)),
        vy: Number(vy.toFixed(4)),
        vz: 0.0,
        ax_g: Number(axG.toFixed(4)),
        ay_g: Number(ayG.toFixed(4)),
        yaw_rate_rad_s: Number(yawRate.toFixed(4)),
        beta_deg: Number(betaDeg.toFixed(4)),
        steer_deg: Number(steerDeg.toFixed(4)),
        throttle: Number(throttle.toFixed(4)),
        brake: Number(brake.toFixed(4)),
        x_m: Number(xM.toFixed(4)),
        y_m: Number(yM.toFixed(4)),
        z_m: 0.285,
        heading_rad: Number(headingRad.toFixed(4)),
      },
      wheels: { fl, fr, rl, rr },
      hv: {
        p_dc_kw: Number(pDcKw.toFixed(3)),
        p_regen_kw: Number(pRegenKw.toFixed(3)),
        soc_pct: Number(this.socPct.toFixed(3)),
        bspd_active: throttle > 0.25 && brake > 0.25 && pDcKw > 5.0,
        tv_mz_nm: Number(mzTvNm.toFixed(2)),
      },
      ekf: {
        ekf_vx: Number(ekfVx.toFixed(4)),
        ekf_vy: Number(ekfVy.toFixed(4)),
        ekf_yaw_rate: Number(ekfWz.toFixed(4)),
        ekf_beta_deg: Number(ekfBeta.toFixed(4)),
        sensor_latency_ms: isTrackRealism ? 125.0 : 0.0,
      },
      dil_delta: {
        delta_time_s: Number(deltaTS.toFixed(4)),
        delta_vx_mps: Number((vx - 10.65).toFixed(4)),
        delta_ay_g: Number((ayG * 0.025).toFixed(4)),
      },
    };
  }
}

export function connectTelemetrySocket(
  onFrame: (frame: TelemetryFrame) => void,
  onStatus: (status: TelemetryConnectionStatus) => void
): () => void {
  let ws: WebSocket | null = null;
  let retryMs = 1000;
  let closed = false;
  let timerId: number | null = null;
  let attempts = 0;

  const open = () => {
    if (closed) return;
    try {
      ws = new WebSocket(getWsUrl());
    } catch {
      onStatus("offline_mock");
      return;
    }

    ws.onopen = () => {
      retryMs = 1000;
      attempts = 0;
      onStatus("connected");
    };

    ws.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data) as TelemetryFrame;
        onFrame(parsed);
      } catch {
        // Ignore malformed telemetry frame
      }
    };

    ws.onerror = () => {
      ws?.close();
    };

    ws.onclose = () => {
      if (closed) return;
      attempts += 1;
      onStatus(attempts <= 1 ? "reconnecting" : "offline_mock");
      timerId = window.setTimeout(() => {
        retryMs = Math.min(retryMs * 2, 16000);
        open();
      }, retryMs);
    };
  };

  open();

  return () => {
    closed = true;
    if (timerId !== null) {
      window.clearTimeout(timerId);
    }
    ws?.close();
  };
}
