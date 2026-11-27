import React, { useEffect, useMemo, useRef } from "react";
import { Cpu, ShieldAlert } from "lucide-react";
import { useTelemetryStore } from "../../state/telemetryStore";
import {
  solveTvControlOperatingPoint,
  TvFaultMode,
} from "../../services/physics/tvControlModel";
import { SplitPane } from "../layout/SplitPane";
import type { GripProfileName } from "../../types";

const FAULT_SCENARIOS: Array<{
  id: TvFaultMode;
  title: string;
  subtitle: string;
}> = [
  {
    id: "nominal_4wd",
    title: "Nominal 4WD (AL-QP)",
    subtitle: "All 4 AMK in-wheel actuators online · 200 Hz closed-loop",
  },
  {
    id: "motor_loss_fl",
    title: "3WD Limp-Home: FL Motor Loss",
    subtitle: "Inverter fault on Front-Left · AL-QP reallocates RL/FR yaw torque",
  },
  {
    id: "motor_loss_rr",
    title: "3WD Limp-Home: RR Motor Loss",
    subtitle: "Inverter fault on Rear-Right · High-load outer rear compensation",
  },
  {
    id: "can_jitter_200ms",
    title: "CAN Bus Jitter (200 ms)",
    subtitle: "Severe bus delay + EKF prediction horizon degradation",
  },
  {
    id: "cold_tire_18c",
    title: "Cold Tire Tread (18 °C)",
    subtitle: "Reduced peak friction envelope · Aggressive friction-ellipse clipping",
  },
];

const ECU_TASKS = [
  { label: "AL-QP Torque Allocator (16 iter)", us: 242.0, color: "#C5A059" },
  { label: "EKF 14-DOF State Estimator", us: 38.0, color: "#38BDF8" },
  { label: "CAN RX/TX + BSPD Watchdog", us: 21.6, color: "#10B981" },
  { label: "C++17 Hybrid PINN Tire (4x 1.11 µs)", us: 4.44, color: "#F59E0B" },
];

export function EkfFaultBench() {
  const {
    frame,
    ringBufferRef,
    sensorProfile,
    setSensorProfile,
    gripProfile,
    activeFaultMode,
    setActiveFaultMode,
  } = useTelemetryStore();

  const betaCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const vxCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const activeGrip: GripProfileName =
    gripProfile === "COLD_TEST_OCT" ? "COLD_TEST_OCT" : "FSG_RUBBERED";

  // Deterministic fault evaluation at canonical 65 km/h cornering load
  const faultSolution = useMemo(
    () =>
      solveTvControlOperatingPoint({
        speedKmh: 65,
        steerDeg: 52,
        pedalDemand: 0.55,
        regenCapKw: 22,
        gripProfile: activeGrip,
        controllerMode: "AL_QP_TV",
        faultMode: activeFaultMode,
      }),
    [activeFaultMode, activeGrip]
  );

  // 60 fps Canvas Waveforms comparing Ground Truth vs EKF Estimated States
  useEffect(() => {
    let rafId = 0;

    const drawDualWave = (
      canvas: HTMLCanvasElement | null,
      getTruth: (idx: number) => number,
      getEst: (idx: number) => number,
      minY: number,
      maxY: number,
      unit: string,
      label: string
    ) => {
      if (!canvas) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = canvas.clientWidth || 360;
      const h = canvas.clientHeight || 150;
      if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
        canvas.width = Math.floor(w * dpr);
        canvas.height = Math.floor(h * dpr);
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const rb = ringBufferRef.current;
      const n = Math.min(rb.count, 360); // last 6 seconds @ 60 Hz

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.fillStyle = "#0B0D12";
      ctx.fillRect(0, 0, w, h);

      const padL = 44,
        padR = 14,
        padT = 14,
        padB = 20;
      const pw = Math.max(20, w - padL - padR);
      const ph = Math.max(20, h - padT - padB);
      const yOf = (v: number) =>
        padT + ph - ((Math.max(minY, Math.min(maxY, v)) - minY) / Math.max(1e-4, maxY - minY)) * ph;

      ctx.font = '9.5px "JetBrains Mono", monospace';
      for (let i = 0; i <= 4; i++) {
        const yv = minY + ((maxY - minY) * i) / 4;
        const py = yOf(yv);
        ctx.save();
        ctx.strokeStyle = "rgba(255,255,255,0.045)";
        ctx.setLineDash([3, 4]);
        ctx.beginPath();
        ctx.moveTo(padL, Math.round(py) + 0.5);
        ctx.lineTo(w - padR, Math.round(py) + 0.5);
        ctx.stroke();
        ctx.restore();
        ctx.fillStyle = "#64748B";
        ctx.textAlign = "right";
        ctx.fillText(yv.toFixed(1), padL - 6, py + 3);
      }

      if (n > 2) {
        const startLogical = rb.count - n;

        // Innovation residual ribbon between truth and EKF
        ctx.fillStyle = "rgba(217, 119, 6, 0.14)";
        ctx.beginPath();
        for (let k = 0; k < n; k++) {
          const phys = rb.getPhysicalIndex(startLogical + k);
          const px = padL + (k / (n - 1)) * pw;
          const py = yOf(getTruth(phys));
          if (k === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        for (let k = n - 1; k >= 0; k--) {
          const phys = rb.getPhysicalIndex(startLogical + k);
          const px = padL + (k / (n - 1)) * pw;
          ctx.lineTo(px, yOf(getEst(phys)));
        }
        ctx.closePath();
        ctx.fill();

        // Ground truth (Gold)
        ctx.strokeStyle = "#DFBE78";
        ctx.lineWidth = 1.7;
        ctx.beginPath();
        for (let k = 0; k < n; k++) {
          const phys = rb.getPhysicalIndex(startLogical + k);
          const px = padL + (k / (n - 1)) * pw;
          const py = yOf(getTruth(phys));
          if (k === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();

        // EKF Estimate (Cyan)
        ctx.strokeStyle = "#38BDF8";
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        for (let k = 0; k < n; k++) {
          const phys = rb.getPhysicalIndex(startLogical + k);
          const px = padL + (k / (n - 1)) * pw;
          const py = yOf(getEst(phys));
          if (k === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
      }

      ctx.fillStyle = "#94A3B8";
      ctx.textAlign = "left";
      ctx.fillText(`${label} (${unit}) · Gold: Ground Truth · Cyan: EKF Estimate · Amber: Residual`, padL, h - 5);
      ctx.restore();
    };

    const tick = () => {
      const rb = ringBufferRef.current;
      drawDualWave(
        betaCanvasRef.current,
        (i) => rb.betaDeg[i],
        (i) => rb.ekfBetaDeg[i],
        -10,
        10,
        "deg",
        "Sideslip β"
      );
      drawDualWave(
        vxCanvasRef.current,
        (i) => rb.vxKmh[i],
        (i) => rb.ekfVxKmh[i],
        0,
        110,
        "km/h",
        "Longitudinal Velocity Vx"
      );
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [ringBufferRef]);

  const betaErr = Math.abs(frame.state.beta_deg - frame.ekf.ekf_beta_deg);
  const vxErr = Math.abs(frame.state.vx - frame.ekf.ekf_vx);
  const fzErrN = sensorProfile === "SENSOR_TRACK_REALISM" ? 28.4 : 0.8;
  const totalEcuUs = ECU_TASKS.reduce((acc, t) => acc + t.us, 0);
  const cpuPct = (totalEcuUs / 5000) * 100;

  return (
    <div className="w-full h-full min-h-0 overflow-hidden">
      <SplitPane
        direction="horizontal"
        initialRatio={0.56}
        minRatio={0.42}
        maxRatio={0.7}
        first={
          <div className="machined-panel w-full h-full min-h-0 flex flex-col overflow-hidden">
            <div className="panel-header-bar gap-2">
              <div className="flex items-center gap-2">
                <ShieldAlert className="w-3.5 h-3.5 text-[#C5A059]" />
                <span className="panel-title-label">
                  Sensor Realism & EKF Innovation Bench
                </span>
              </div>
              <div className="seg-track">
                <button
                  type="button"
                  data-active={sensorProfile === "SENSOR_IDEAL" ? "true" : "false"}
                  onClick={() => void setSensorProfile("SENSOR_IDEAL")}
                  className="seg-btn !text-[10.5px]"
                >
                  SENSOR_IDEAL (0 ms)
                </button>
                <button
                  type="button"
                  data-active={sensorProfile === "SENSOR_TRACK_REALISM" ? "true" : "false"}
                  onClick={() => void setSensorProfile("SENSOR_TRACK_REALISM")}
                  className="seg-btn !text-[10.5px]"
                >
                  TRACK_REALISM (125 ms)
                </button>
              </div>
            </div>

            <div className="flex-1 min-h-0 p-3 flex flex-col gap-2.5 overflow-hidden">
              {/* Live EKF Innovation Residual Strip */}
              <div className="grid grid-cols-4 gap-2 shrink-0">
                <div className="machined-card px-2.5 py-2">
                  <div className="text-[10px] text-[#94A3B8]">|β - ekf_β|</div>
                  <div
                    className={`font-mono text-[13px] font-semibold tabular mt-0.5 ${
                      betaErr > 0.8 ? "text-[#FBBF24]" : "text-[#34D399]"
                    }`}
                  >
                    {betaErr.toFixed(3)}°
                  </div>
                </div>
                <div className="machined-card px-2.5 py-2">
                  <div className="text-[10px] text-[#94A3B8]">|Vx - ekf_Vx|</div>
                  <div className="font-mono text-[13px] font-semibold text-[#F1F5F9] tabular mt-0.5">
                    {vxErr.toFixed(3)} m/s
                  </div>
                </div>
                <div className="machined-card px-2.5 py-2">
                  <div className="text-[10px] text-[#94A3B8]">|Fz - ekf_Fz| Est.</div>
                  <div className="font-mono text-[13px] font-semibold text-[#38BDF8] tabular mt-0.5">
                    {fzErrN.toFixed(1)} N
                  </div>
                </div>
                <div className="machined-card px-2.5 py-2">
                  <div className="text-[10px] text-[#94A3B8]">CAN Bus Delay</div>
                  <div className="font-mono text-[13px] font-semibold text-[#DFBE78] tabular mt-0.5">
                    {frame.ekf.sensor_latency_ms.toFixed(0)} ms
                  </div>
                </div>
              </div>

              {/* Dual Live 60 fps Waveforms */}
              <div className="machined-well flex-1 min-h-0 overflow-hidden">
                <canvas ref={betaCanvasRef} className="block w-full h-full" />
              </div>
              <div className="machined-well flex-1 min-h-0 overflow-hidden">
                <canvas ref={vxCanvasRef} className="block w-full h-full" />
              </div>
            </div>
          </div>
        }
        second={
          <SplitPane
            direction="vertical"
            initialRatio={0.62}
            minRatio={0.42}
            maxRatio={0.75}
            first={
              <div className="machined-panel w-full h-full min-h-0 flex flex-col overflow-hidden">
                <div className="panel-header-bar">
                  <span className="panel-title-label">Interactive Fault-Injection Matrix</span>
                  <span
                    className={`status-pill font-mono text-[10px] ${
                      faultSolution.stabilityState === "STABLE"
                        ? "status-pill-nominal"
                        : faultSolution.stabilityState === "MARGINAL"
                          ? "status-pill-caution"
                          : "status-pill-limit"
                    }`}
                  >
                    {faultSolution.stabilityState} · +{faultSolution.estLapPenaltyS.toFixed(2)}s
                  </span>
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2.5">
                  <div className="space-y-1.5">
                    {FAULT_SCENARIOS.map((sc) => {
                      const active = activeFaultMode === sc.id;
                      return (
                        <button
                          key={sc.id}
                          type="button"
                          onClick={() => setActiveFaultMode(sc.id)}
                          className={`w-full text-left px-3 py-2 rounded-[5px] border cursor-pointer transition-colors ${
                            active
                              ? "border-[#C5A059]/50 bg-[#C5A059]/12"
                              : "border-white/[0.06] bg-[#161A23] hover:bg-[#1D2331]"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span
                              className={`text-[11.5px] font-semibold ${
                                active ? "text-[#DFBE78]" : "text-[#F1F5F9]"
                              }`}
                            >
                              {sc.title}
                            </span>
                            {active ? (
                              <span className="status-pill status-pill-gold !text-[9.5px]">
                                Active
                              </span>
                            ) : null}
                          </div>
                          <div className="text-[10.5px] text-[#94A3B8] mt-0.5">{sc.subtitle}</div>
                        </button>
                      );
                    })}
                  </div>

                  {/* Compensatory Actuator Reallocation Readout */}
                  <div className="machined-card p-2.5 space-y-2">
                    <div className="flex items-center justify-between text-[10.5px]">
                      <span className="font-semibold text-[#CBD5E1]">
                        Actuator Reallocation @ 65 km/h Cornering
                      </span>
                      <span className="font-mono text-[#DFBE78]">
                        dMz/dβ {faultSolution.dMzDbNmPerDeg.toFixed(1)} Nm/deg
                      </span>
                    </div>
                    <div className="grid grid-cols-4 gap-1.5">
                      {faultSolution.wheels.map((w) => (
                        <div
                          key={w.corner}
                          className={`px-2 py-1.5 rounded-[4px] bg-[#0B0D12] border text-center ${
                            w.offline ? "border-[#EF4444]/50" : "border-white/[0.06]"
                          }`}
                        >
                          <div className="font-mono text-[10px] text-[#94A3B8]">{w.corner}</div>
                          <div
                            className={`font-mono text-[11.5px] font-semibold ${
                              w.offline ? "text-[#F87171]" : "text-[#F1F5F9]"
                            }`}
                          >
                            {w.offline ? "0.0 Nm" : `${w.motorTorqueNm.toFixed(1)} Nm`}
                          </div>
                          <div className="font-mono text-[9.5px] text-[#64748B]">
                            μ {w.muUtilPct.toFixed(0)}%
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            }
            second={
              <div className="machined-panel w-full h-full min-h-0 flex flex-col overflow-hidden">
                <div className="panel-header-bar">
                  <div className="flex items-center gap-2">
                    <Cpu className="w-3.5 h-3.5 text-[#C5A059]" />
                    <span className="panel-title-label">
                      Embedded ECU Execution Audit (STM32F405)
                    </span>
                  </div>
                  <span className="status-pill status-pill-nominal font-mono text-[10px]">
                    {cpuPct.toFixed(2)}% CPU · 200 Hz
                  </span>
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2.5">
                  <div className="space-y-1">
                    <div className="flex justify-between text-[10.5px]">
                      <span className="text-[#94A3B8]">
                        Real-Time 5.0 ms Cycle Budget ({totalEcuUs.toFixed(1)} µs used)
                      </span>
                      <span className="font-mono text-[#34D399]">
                        Headroom: {(5000 - totalEcuUs).toFixed(0)} µs
                      </span>
                    </div>
                    <div className="h-3 rounded-full bg-[#0B0D12] border border-white/[0.07] overflow-hidden flex">
                      {ECU_TASKS.map((t) => (
                        <div
                          key={t.label}
                          title={`${t.label}: ${t.us} µs`}
                          style={{
                            width: `${Math.max(1.5, (t.us / 5000) * 100 * 6)}%`,
                            backgroundColor: t.color,
                          }}
                          className="h-full"
                        />
                      ))}
                    </div>
                    <div className="text-[9.5px] text-[#64748B]">
                      Bar magnified 6x for visual inspection of sub-millisecond tasks inside 5,000 µs slot.
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-1.5">
                    {ECU_TASKS.map((t) => (
                      <div
                        key={t.label}
                        className="machined-card px-2.5 py-1.5 flex items-center justify-between gap-2 text-[10.5px]"
                      >
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span
                            className="w-2 h-2 rounded-full shrink-0"
                            style={{ backgroundColor: t.color }}
                          />
                          <span className="text-[#CBD5E1] truncate">{t.label}</span>
                        </div>
                        <span className="font-mono text-[#F1F5F9] shrink-0">{t.us.toFixed(2)} µs</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            }
          />
        }
      />
    </div>
  );
}
