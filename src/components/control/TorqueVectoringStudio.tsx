import React, { useEffect, useMemo, useRef, useState } from "react";
import type { GripProfileName } from "../../types";
import {
  solveTvControlOperatingPoint,
  TvControllerMode,
  TvControlSolution,
  TvFaultMode,
  WheelAllocation,
} from "../../services/physics/tvControlModel";
import { useTelemetryStore } from "../../state/telemetryStore";
import { SplitPane } from "../layout/SplitPane";
import { PrecisionControl } from "../shared/PrecisionControl";
import { TelemetryCanvasChart } from "../shared/TelemetryCanvasChart";

/**
 * Interactive Yaw Phase-Plane Canvas (beta vs omega_z) with vector-field stability arrows,
 * passive open-diff trajectories vs closed-loop 200 Hz AL-QP TV trajectories,
 * Crimson dMz/dbeta = 0 stability boundary, and Brushed Gold live operating cursor.
 */
function YawPhasePlaneCanvas({
  sol,
  controllerMode,
  showPassive,
}: {
  sol: TvControlSolution;
  controllerMode: TvControllerMode;
  showPassive: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const render = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = parent.clientWidth;
      const h = parent.clientHeight;
      if (w < 40 || h < 40) return;

      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.fillStyle = "#08090C";
      ctx.fillRect(0, 0, w, h);

      const padL = 44;
      const padR = 14;
      const padT = 14;
      const padB = 22;
      const pw = Math.max(20, w - padL - padR);
      const ph = Math.max(20, h - padT - padB);
      const maxBeta = 14;
      const maxWz = 3.0;
      const xOf = (b: number) => padL + ((b + maxBeta) / (2 * maxBeta)) * pw;
      const yOf = (r: number) => padT + ph - ((r + maxWz) / (2 * maxWz)) * ph;

      // Subtle dashed grid
      ctx.font = '9.5px "JetBrains Mono", monospace';
      for (const bTick of [-10, -5, 5, 10]) {
        ctx.save();
        ctx.strokeStyle = "rgba(255,255,255,0.045)";
        ctx.setLineDash([3, 4]);
        ctx.beginPath();
        ctx.moveTo(xOf(bTick), padT);
        ctx.lineTo(xOf(bTick), padT + ph);
        ctx.stroke();
        ctx.restore();
        ctx.fillStyle = "#64748B";
        ctx.textAlign = "center";
        ctx.fillText(`${bTick}°`, xOf(bTick), h - 6);
      }
      for (const rTick of [-2, -1, 1, 2]) {
        ctx.save();
        ctx.strokeStyle = "rgba(255,255,255,0.045)";
        ctx.setLineDash([3, 4]);
        ctx.beginPath();
        ctx.moveTo(padL, yOf(rTick));
        ctx.lineTo(w - padR, yOf(rTick));
        ctx.stroke();
        ctx.restore();
        ctx.fillStyle = "#64748B";
        ctx.textAlign = "right";
        ctx.fillText(`${rTick.toFixed(1)}`, padL - 6, yOf(rTick) + 3);
      }

      // Zero axes
      ctx.strokeStyle = "rgba(255,255,255,0.12)";
      ctx.beginPath();
      ctx.moveTo(padL, Math.round(yOf(0)) + 0.5);
      ctx.lineTo(w - padR, Math.round(yOf(0)) + 0.5);
      ctx.moveTo(Math.round(xOf(0)) + 0.5, padT);
      ctx.lineTo(Math.round(xOf(0)) + 0.5, padT + ph);
      ctx.stroke();

      // Vector-field stability arrows across phase plane
      const damp = Math.max(0.42, Math.abs(sol.dMzDbNmPerDeg) / 165);
      ctx.save();
      ctx.strokeStyle = "rgba(148, 163, 184, 0.22)";
      ctx.lineWidth = 1;
      for (let b = -12; b <= 12; b += 3) {
        for (let r = -2.4; r <= 2.41; r += 0.8) {
          const db = -0.82 * damp * b - 2.05 * r + 0.012 * b * b * Math.sign(b);
          const dr = 0.26 * (1.15 - damp) * b - 1.55 * damp * r;
          const mag = Math.hypot(db, dr * 4.5) || 1;
          const dx = (db / mag) * 10;
          const dy = -(dr * 4.5 / mag) * 10;
          const sx = xOf(b);
          const sy = yOf(r);
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.lineTo(sx + dx, sy + dy);
          ctx.stroke();
        }
      }
      ctx.restore();

      // Crimson dMz/dbeta = 0 directional stability boundary diamond
      ctx.beginPath();
      sol.stabilityBoundary.forEach((pt, idx) => {
        if (idx === 0) ctx.moveTo(xOf(pt.betaDeg), yOf(pt.wzRadS));
        else ctx.lineTo(xOf(pt.betaDeg), yOf(pt.wzRadS));
      });
      ctx.closePath();
      ctx.fillStyle = "rgba(220, 38, 38, 0.06)";
      ctx.fill();
      ctx.strokeStyle = "#DC2626";
      ctx.lineWidth = 1.6;
      ctx.stroke();

      // Passive Open-Diff diverging trajectories (Cyan/Crimson dashed)
      if (showPassive || controllerMode === "PASSIVE_OPEN_DIFF") {
        ctx.save();
        ctx.setLineDash([4, 3]);
        for (const traj of sol.passiveTrajectories) {
          ctx.strokeStyle = traj.unstable
            ? "rgba(220, 38, 38, 0.6)"
            : "rgba(56, 189, 248, 0.55)";
          ctx.lineWidth = 1.3;
          ctx.beginPath();
          traj.points.forEach((p, idx) => {
            if (idx === 0) ctx.moveTo(xOf(p.betaDeg), yOf(p.wzRadS));
            else ctx.lineTo(xOf(p.betaDeg), yOf(p.wzRadS));
          });
          ctx.stroke();
        }
        ctx.restore();
      }

      // Closed-Loop 200 Hz AL-QP 4WD TV trajectories (Brushed Gold solid)
      if (controllerMode === "AL_QP_TV") {
        for (const traj of sol.tvTrajectories) {
          ctx.strokeStyle = traj.unstable ? "#DC2626" : "#C5A059";
          ctx.lineWidth = 1.75;
          ctx.beginPath();
          traj.points.forEach((p, idx) => {
            if (idx === 0) ctx.moveTo(xOf(p.betaDeg), yOf(p.wzRadS));
            else ctx.lineTo(xOf(p.betaDeg), yOf(p.wzRadS));
          });
          ctx.stroke();
        }
      }

      // Brushed Gold Live (beta, yaw_rate) Operating Cursor
      const ox = xOf(sol.operatingBetaDeg);
      const oy = yOf(sol.operatingWzRadS);
      ctx.strokeStyle = "#C5A059";
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(ox, oy, 7, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "#ECEFF4";
      ctx.beginPath();
      ctx.arc(ox, oy, 2.8, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "#7E8899";
      ctx.textAlign = "left";
      ctx.fillText("ωz (rad/s)", 6, 11);
      ctx.textAlign = "right";
      ctx.fillText("Crimson: dMz/dβ=0 · Gold: AL-QP TV · Cyan: Open-Diff", w - padR, 11);
      ctx.restore();
    };

    render();
    const ro = new ResizeObserver(render);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [controllerMode, showPassive, sol]);

  return <canvas ref={canvasRef} className="block w-full h-full" />;
}

/**
 * 2x2 Corner Allocation Friction Circle Instruments (Twin of FrictionCircle2x2.tsx in Pitwall Live)
 */
function CornerAllocation2x2({ wheels }: { wheels: WheelAllocation[] }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const render = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = parent.clientWidth;
      const h = parent.clientHeight;
      if (w < 60 || h < 60) return;

      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.fillStyle = "#08090C";
      ctx.fillRect(0, 0, w, h);

      const cellW = w / 2;
      const cellH = h / 2;

      // Crisp 2x2 hairline divider
      ctx.strokeStyle = "#222633";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.round(cellW) + 0.5, 0);
      ctx.lineTo(Math.round(cellW) + 0.5, h);
      ctx.moveTo(0, Math.round(cellH) + 0.5);
      ctx.lineTo(w, Math.round(cellH) + 0.5);
      ctx.stroke();

      wheels.forEach((wheel, idx) => {
        const col = idx % 2;
        const row = Math.floor(idx / 2);
        const x0 = col * cellW;
        const y0 = row * cellH;
        const cx = x0 + cellW * 0.48;
        const cy = y0 + cellH * 0.54;
        const rad = Math.max(18, Math.min(cellW * 0.34, cellH * 0.36));

        const fMax = Math.max(200, wheel.fzN * 1.42);
        const scale = rad / fMax;

        // Outer mu*Fz friction circle
        ctx.save();
        ctx.strokeStyle = wheel.offline
          ? "rgba(220,38,38,0.45)"
          : wheel.clipped
            ? "rgba(217,119,6,0.55)"
            : "rgba(255,255,255,0.18)";
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(cx, cy, rad, 0, Math.PI * 2);
        ctx.stroke();

        // Inner 50% dashed ring
        ctx.strokeStyle = "rgba(255,255,255,0.06)";
        ctx.setLineDash([2, 3]);
        ctx.beginPath();
        ctx.arc(cx, cy, rad * 0.5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();

        // Crosshair axes
        ctx.strokeStyle = "rgba(255,255,255,0.07)";
        ctx.beginPath();
        ctx.moveTo(cx - rad - 4, cy);
        ctx.lineTo(cx + rad + 4, cy);
        ctx.moveTo(cx, cy - rad - 4);
        ctx.lineTo(cx, cy + rad + 4);
        ctx.stroke();

        // (Fy, Fx) force vector
        const vx = Math.max(-rad * 1.08, Math.min(rad * 1.08, wheel.fyN * scale));
        const vy = Math.max(-rad * 1.08, Math.min(rad * 1.08, -wheel.fxN * scale));
        const vecColor = wheel.offline
          ? "#EF4444"
          : wheel.motorTorqueNm < -0.2
            ? "#38BDF8"
            : wheel.clipped
              ? "#D97706"
              : "#C5A059";

        ctx.strokeStyle = vecColor;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + vx, cy + vy);
        ctx.stroke();

        ctx.fillStyle = "#ECEFF4";
        ctx.beginPath();
        ctx.arc(cx + vx, cy + vy, 3, 0, Math.PI * 2);
        ctx.fill();

        // Top-left corner tag & state
        ctx.font = '700 11px "JetBrains Mono", monospace';
        ctx.fillStyle = "#ECEFF4";
        ctx.textAlign = "left";
        ctx.fillText(wheel.corner, x0 + 9, y0 + 16);

        ctx.font = '500 9.5px "JetBrains Mono", monospace';
        ctx.fillStyle = wheel.offline
          ? "#F87171"
          : wheel.clipped
            ? "#FBBF24"
            : "#34D399";
        ctx.fillText(
          wheel.offline ? "OFFLINE" : wheel.clipped ? "SAT CLIP" : "NOMINAL",
          x0 + 30,
          y0 + 16
        );

        // Top-right torque & util readout
        ctx.textAlign = "right";
        ctx.fillStyle = vecColor;
        ctx.font = '600 10.5px "JetBrains Mono", monospace';
        ctx.fillText(
          `${wheel.motorTorqueNm >= 0 ? "+" : ""}${wheel.motorTorqueNm.toFixed(1)} Nm`,
          x0 + cellW - 9,
          y0 + 16
        );

        // Bottom strip: Fz & util%
        ctx.fillStyle = "#7E8899";
        ctx.font = '9.5px "JetBrains Mono", monospace';
        ctx.textAlign = "left";
        ctx.fillText(`Fz ${wheel.fzN.toFixed(0)} N`, x0 + 9, y0 + cellH - 7);
        ctx.textAlign = "right";
        ctx.fillStyle =
          wheel.muUtilPct > 94 ? "#F87171" : wheel.muUtilPct > 82 ? "#FBBF24" : "#CBD5E1";
        ctx.fillText(`μ ${wheel.muUtilPct.toFixed(0)}%`, x0 + cellW - 9, y0 + cellH - 7);
      });

      ctx.restore();
    };

    render();
    const ro = new ResizeObserver(render);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [wheels]);

  return <canvas ref={canvasRef} className="block w-full h-full" />;
}

export function TorqueVectoringStudio() {
  const { gripProfile, activeFaultMode, setActiveFaultMode } = useTelemetryStore();

  const [controllerMode, setControllerMode] = useState<TvControllerMode>("AL_QP_TV");
  const [speedKmh, setSpeedKmh] = useState<number>(64);
  const [steerDeg, setSteerDeg] = useState<number>(48);
  const [pedalDemand, setPedalDemand] = useState<number>(0.45);
  const [regenCapKw, setRegenCapKw] = useState<number>(22);
  const [showPassive, setShowPassive] = useState<boolean>(true);

  const activeGrip: GripProfileName =
    gripProfile === "COLD_TEST_OCT" ? "COLD_TEST_OCT" : "FSG_RUBBERED";

  const sol = useMemo(
    () =>
      solveTvControlOperatingPoint({
        speedKmh,
        steerDeg,
        pedalDemand,
        regenCapKw,
        gripProfile: activeGrip,
        controllerMode,
        faultMode: activeFaultMode,
      }),
    [activeFaultMode, activeGrip, controllerMode, pedalDemand, regenCapKw, speedKmh, steerDeg]
  );

  // Sweep Mz_TV authority across Steering Angle (-120..+120 deg)
  const mzAuthoritySeries = useMemo(() => {
    const mzPts: Array<{ x: number; y: number }> = [];
    const capHiPts: Array<{ x: number; y: number }> = [];
    const capLoPts: Array<{ x: number; y: number }> = [];
    for (let s = -120; s <= 120; s += 8) {
      const res = solveTvControlOperatingPoint({
        speedKmh,
        steerDeg: s,
        pedalDemand,
        regenCapKw,
        gripProfile: activeGrip,
        controllerMode,
        faultMode: activeFaultMode,
      });
      mzPts.push({ x: s, y: res.yawMomentTvNm });
      capHiPts.push({ x: s, y: res.peakYawAuthorityNm });
      capLoPts.push({ x: s, y: -res.peakYawAuthorityNm });
    }
    return [
      {
        id: "mz_tv",
        label: "Allocated Mz_TV",
        shortLabel: "Mz_TV",
        unit: "Nm",
        color: "#C5A059",
        fill: true,
        decimals: 0,
        points: mzPts,
      },
      {
        id: "mz_cap_hi",
        label: "Friction Cap +",
        shortLabel: "Cap+",
        unit: "Nm",
        color: "rgba(220,38,38,0.55)",
        dashed: true,
        lineWidth: 1.1,
        decimals: 0,
        points: capHiPts,
      },
      {
        id: "mz_cap_lo",
        label: "Friction Cap -",
        shortLabel: "Cap-",
        unit: "Nm",
        color: "rgba(220,38,38,0.55)",
        dashed: true,
        lineWidth: 1.1,
        decimals: 0,
        points: capLoPts,
      },
    ];
  }, [activeFaultMode, activeGrip, controllerMode, pedalDemand, regenCapKw, speedKmh]);

  return (
    <div className="w-full h-full min-h-0 overflow-hidden">
      <SplitPane
        direction="horizontal"
        initialRatio={0.48}
        minRatio={0.38}
        maxRatio={0.6}
        first={
          /* Left 48% — Yaw Phase-Plane (62%) + Yaw Moment Authority (38%) */
          <SplitPane
            direction="vertical"
            initialRatio={0.62}
            minRatio={0.45}
            maxRatio={0.74}
            first={
              <div className="machined-panel w-full h-full min-h-0 flex flex-col overflow-hidden">
                <div className="inst-header">
                  <span className="panel-title-label">Yaw Phase-Plane (β vs ωz)</span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span
                      className={`font-mono text-[10px] px-1.5 h-[20px] rounded-[2px] border flex items-center tabular ${
                        sol.stabilityState === "STABLE"
                          ? "bg-[#10B981]/14 border-[#10B981]/40 text-[#34D399]"
                          : sol.stabilityState === "MARGINAL"
                            ? "bg-[#D97706]/16 border-[#D97706]/50 text-[#FBBF24]"
                            : "bg-[#DC2626]/18 border-[#DC2626]/60 text-[#FCA5A5]"
                      }`}
                    >
                      dMz/dβ {sol.dMzDbNmPerDeg.toFixed(1)} · {sol.stabilityState}
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowPassive((v) => !v)}
                      className={`h-[20px] px-1.5 rounded-[2px] border text-[9.5px] font-mono cursor-pointer ${
                        showPassive
                          ? "bg-[#181C26] border-[#38BDF8]/50 text-[#38BDF8]"
                          : "bg-[#12151D] border-[#222633] text-[#7E8899]"
                      }`}
                    >
                      Passive {showPassive ? "ON" : "OFF"}
                    </button>
                  </div>
                </div>
                <div className="flex-1 min-h-0 relative overflow-hidden">
                  <YawPhasePlaneCanvas
                    sol={sol}
                    controllerMode={controllerMode}
                    showPassive={showPassive}
                  />
                </div>
                <div className="h-[22px] shrink-0 px-2.5 bg-[#0F1116] border-t border-[#222633] flex items-center justify-between font-mono text-[9.5px] text-[#7E8899] tabular">
                  <span>
                    Op Point: β {sol.operatingBetaDeg.toFixed(2)}° · ωz{" "}
                    {sol.achievedYawRateRadS.toFixed(2)} / {sol.desiredYawRateRadS.toFixed(2)} rad/s
                  </span>
                  <span>
                    AL-QP {sol.alQpIterations} iter · {sol.solverRuntimeUs} µs
                  </span>
                </div>
              </div>
            }
            second={
              <TelemetryCanvasChart
                title="Yaw Moment Authority Mz_TV(δ)"
                xLabel="Steering Angle (deg)"
                yLabel="Mz_TV (Nm)"
                series={mzAuthoritySeries}
                xDomain={[-120, 120]}
                activeCursorX={steerDeg}
                referenceLines={[
                  {
                    axis: "x",
                    value: steerDeg,
                    color: "#C5A059",
                    label: `${steerDeg}°`,
                  },
                ]}
                footerNote={`Active Mz ${sol.yawMomentTvNm >= 0 ? "+" : ""}${sol.yawMomentTvNm.toFixed(0)} Nm · Peak Authority ±${sol.peakYawAuthorityNm} Nm · Est. Penalty +${sol.estLapPenaltyS.toFixed(2)} s`}
              />
            }
          />
        }
        second={
          /* Right 52% — 2x2 Corner Allocation Instruments (56%) + Operating Point & Fault Console (44%) */
          <SplitPane
            direction="vertical"
            initialRatio={0.56}
            minRatio={0.42}
            maxRatio={0.7}
            first={
              <div className="machined-panel w-full h-full min-h-0 flex flex-col overflow-hidden">
                <div className="inst-header">
                  <span className="panel-title-label">4-Corner Torque &amp; Friction Allocation</span>
                  <div className="flex items-center gap-1.5 font-mono text-[10px] tabular">
                    <span className="text-[#94A3B8]">Net HV</span>
                    <span
                      className={
                        sol.netHvPowerKw < 0 ? "text-[#38BDF8]" : "text-[#DFBE78]"
                      }
                    >
                      {sol.netHvPowerKw >= 0 ? "+" : ""}
                      {sol.netHvPowerKw.toFixed(1)} kW
                    </span>
                    <span className="text-[#64748B]">·</span>
                    <span className="text-[#38BDF8]">Regen {sol.regenPowerKw.toFixed(1)} kW</span>
                  </div>
                </div>
                <div className="flex-1 min-h-0 relative overflow-hidden">
                  <CornerAllocation2x2 wheels={sol.wheels} />
                </div>
              </div>
            }
            second={
              <div className="machined-panel w-full h-full min-h-0 flex flex-col overflow-hidden">
                <div className="inst-header">
                  <span className="panel-title-label">Operating Point &amp; Fault-Mode Console</span>
                  <div className="seg-track">
                    <button
                      type="button"
                      data-active={controllerMode === "AL_QP_TV" ? "true" : "false"}
                      onClick={() => setControllerMode("AL_QP_TV")}
                      className="seg-btn !py-0 !px-2 !text-[9.5px]"
                    >
                      200 Hz AL-QP
                    </button>
                    <button
                      type="button"
                      data-active={controllerMode === "PASSIVE_OPEN_DIFF" ? "true" : "false"}
                      onClick={() => setControllerMode("PASSIVE_OPEN_DIFF")}
                      className="seg-btn !py-0 !px-2 !text-[9.5px]"
                    >
                      Open-Diff
                    </button>
                  </div>
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto p-2.5 space-y-2">
                  {/* Segmented Fault & Attack Mode Pills */}
                  <div className="grid grid-cols-5 gap-1">
                    {(
                      [
                        { id: "nominal_4wd", label: "Nominal 4WD" },
                        { id: "motor_loss_fl", label: "3WD Loss FL" },
                        { id: "motor_loss_rr", label: "3WD Loss RR" },
                        { id: "can_jitter_200ms", label: "CAN 200ms" },
                        { id: "cold_tire_18c", label: "Cold 18°C" },
                      ] as Array<{ id: TvFaultMode; label: string }>
                    ).map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setActiveFaultMode(m.id)}
                        className={`h-[24px] px-1.5 rounded-[3px] border text-[10px] font-medium truncate cursor-pointer transition-colors ${
                          activeFaultMode === m.id
                            ? "bg-[#C5A059]/18 border-[#C5A059]/65 text-[#DFBE78]"
                            : "bg-[#151820] border-[#222633] text-[#94A3B8] hover:text-[#ECEFF4]"
                        }`}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>

                  {/* 2x2 Grid of Machined 30px PrecisionControls */}
                  <div className="grid grid-cols-2 gap-1.5">
                    <PrecisionControl
                      label="Speed vx"
                      value={speedKmh}
                      min={20}
                      max={110}
                      step={1}
                      unit="km/h"
                      onChange={setSpeedKmh}
                    />
                    <PrecisionControl
                      label="Steer Angle"
                      value={steerDeg}
                      min={-120}
                      max={120}
                      step={2}
                      unit="deg"
                      onChange={setSteerDeg}
                    />
                    <PrecisionControl
                      label="Thr / Brake"
                      value={Math.round(pedalDemand * 100)}
                      min={-100}
                      max={100}
                      step={5}
                      unit="%"
                      onChange={(v) => setPedalDemand(v / 100)}
                    />
                    <PrecisionControl
                      label="Regen Cap"
                      value={regenCapKw}
                      min={0}
                      max={25}
                      step={1}
                      unit="kW"
                      onChange={setRegenCapKw}
                    />
                  </div>

                  {/* Bipolar 4-Wheel Torque Distribution Bars + Parasitic Torque Fight Meter */}
                  <div className="grid grid-cols-5 gap-1.5 pt-1 border-t border-[#222633]">
                    {sol.wheels.map((w) => {
                      const pct = Math.min(50, (Math.abs(w.motorTorqueNm) / 21) * 50);
                      const isPos = w.motorTorqueNm >= 0;
                      return (
                        <div
                          key={w.corner}
                          className="px-2 py-1.5 rounded-[3px] bg-[#151820] border border-[#222633]"
                        >
                          <div className="flex items-center justify-between font-mono text-[10px] tabular">
                            <span className="text-[#94A3B8]">{w.corner}</span>
                            <span
                              className={
                                w.offline
                                  ? "text-[#F87171]"
                                  : isPos
                                    ? "text-[#DFBE78]"
                                    : "text-[#38BDF8]"
                              }
                            >
                              {isPos ? "+" : ""}
                              {w.motorTorqueNm.toFixed(1)}
                            </span>
                          </div>
                          <div className="relative h-1.5 mt-1 rounded-full bg-[#08090C] overflow-hidden">
                            <div
                              className="absolute top-0 bottom-0"
                              style={{
                                left: isPos ? "50%" : `${50 - pct}%`,
                                width: `${pct}%`,
                                backgroundColor: w.offline
                                  ? "#DC2626"
                                  : isPos
                                    ? "#C5A059"
                                    : "#38BDF8",
                              }}
                            />
                            <div className="absolute left-1/2 top-0 bottom-0 w-[1px] bg-white/30" />
                          </div>
                        </div>
                      );
                    })}

                    <div
                      className={`px-2 py-1.5 rounded-[3px] border ${
                        sol.parasiticFightDetected
                          ? "bg-[#D97706]/15 border-[#D97706]/60"
                          : "bg-[#151820] border-[#222633]"
                      }`}
                    >
                      <div className="text-[9.5px] text-[#7E8899] truncate">Torque Fight</div>
                      <div
                        className={`font-mono text-[10.5px] font-semibold tabular mt-0.5 ${
                          sol.parasiticFightDetected ? "text-[#FBBF24]" : "text-[#34D399]"
                        }`}
                      >
                        {(sol.parasiticLossW / 1000).toFixed(2)} kW
                      </div>
                    </div>
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
