import React, { useEffect, useRef } from "react";
import type { WheelTelemetry } from "../../types";
import { useTelemetryStore } from "../../state/telemetryStore";

type CornerKey = "fl" | "fr" | "rl" | "rr";

const CORNERS: Array<{ key: CornerKey; code: string; name: string }> = [
  { key: "fl", code: "FL", name: "Front Left" },
  { key: "fr", code: "FR", name: "Front Right" },
  { key: "rl", code: "RL", name: "Rear Left" },
  { key: "rr", code: "RR", name: "Rear Right" },
];

function utilSignalColor(util: number): string {
  if (util >= 0.9) return "#EF4444";
  if (util >= 0.7) return "#C5A059";
  return "#10B981";
}

function utilPillClass(util: number): string {
  if (util >= 0.9) return "status-pill-limit";
  if (util >= 0.7) return "status-pill-gold";
  return "status-pill-nominal";
}

function thermalColor(tempC: number): string {
  if (tempC < 42) return "#38BDF8";
  if (tempC <= 82) return "#34D399";
  if (tempC <= 95) return "#F59E0B";
  return "#EF4444";
}

function CornerFrictionCell({
  cornerKey,
  code,
  name,
  wheel,
}: {
  cornerKey: CornerKey;
  code: string;
  name: string;
  wheel: WheelTelemetry;
}) {
  const { ringBufferRef, latestFrameRef } = useTelemetryStore();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let rafId = 0;

    const draw = () => {
      const canvas = canvasRef.current;
      if (!canvas) {
        rafId = requestAnimationFrame(draw);
        return;
      }

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(80, canvas.clientWidth || 132);
      const h = Math.max(80, canvas.clientHeight || 132);

      if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
        canvas.width = Math.floor(w * dpr);
        canvas.height = Math.floor(h * dpr);
      }

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        rafId = requestAnimationFrame(draw);
        return;
      }

      ctx.save();
      ctx.scale(dpr, dpr);

      // Clean dark circular instrument well
      ctx.fillStyle = "#0B0D12";
      ctx.fillRect(0, 0, w, h);

      const cx = w / 2;
      const cy = h / 2;
      const maxR = Math.max(28, Math.min(w, h) * 0.42);
      const maxForceN = 2600;
      const liveW = latestFrameRef.current.wheels[cornerKey];
      const muFz = Math.max(140, 1.52 * liveW.fz_n);
      const dynR = Math.min(maxR, (muFz / maxForceN) * maxR);
      const sigColor = utilSignalColor(liveW.tire_util);

      // Soft radial fill inside dynamic mu*Fz envelope
      const radGrad = ctx.createRadialGradient(cx, cy, 2, cx, cy, dynR);
      if (liveW.tire_util >= 0.9) {
        radGrad.addColorStop(0, "rgba(239, 68, 68, 0.03)");
        radGrad.addColorStop(1, "rgba(239, 68, 68, 0.14)");
      } else if (liveW.tire_util >= 0.7) {
        radGrad.addColorStop(0, "rgba(197, 160, 89, 0.02)");
        radGrad.addColorStop(1, "rgba(197, 160, 89, 0.11)");
      } else {
        radGrad.addColorStop(0, "rgba(16, 185, 129, 0.02)");
        radGrad.addColorStop(1, "rgba(16, 185, 129, 0.08)");
      }
      ctx.fillStyle = radGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, dynR, 0, Math.PI * 2);
      ctx.fill();

      // Subtle crosshair axes
      ctx.strokeStyle = "rgba(255, 255, 255, 0.07)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx - maxR, cy);
      ctx.lineTo(cx + maxR, cy);
      ctx.moveTo(cx, cy - maxR);
      ctx.lineTo(cx, cy + maxR);
      ctx.stroke();

      // Static outer capacity ring (2600 N)
      ctx.strokeStyle = "rgba(255, 255, 255, 0.06)";
      ctx.beginPath();
      ctx.arc(cx, cy, maxR, 0, Math.PI * 2);
      ctx.stroke();

      // Concentric 25%, 50%, 75% rings relative to dynamic mu*Fz limit
      ctx.save();
      ctx.setLineDash([2, 3]);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.075)";
      for (const frac of [0.25, 0.5, 0.75]) {
        ctx.beginPath();
        ctx.arc(cx, cy, dynR * frac, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();

      // Dynamic 100% mu*Fz boundary ring
      ctx.strokeStyle =
        liveW.tire_util >= 0.9
          ? "rgba(239, 68, 68, 0.85)"
          : liveW.tire_util >= 0.7
            ? "rgba(197, 160, 89, 0.65)"
            : "rgba(148, 163, 184, 0.35)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy, dynR, 0, Math.PI * 2);
      ctx.stroke();

      // Smooth fading 48-frame trajectory trail
      const rb = ringBufferRef.current;
      const fxArr =
        cornerKey === "fl"
          ? rb.flFx
          : cornerKey === "fr"
            ? rb.frFx
            : cornerKey === "rl"
              ? rb.rlFx
              : rb.rrFx;
      const fyArr =
        cornerKey === "fl"
          ? rb.flFy
          : cornerKey === "fr"
            ? rb.frFy
            : cornerKey === "rl"
              ? rb.rlFy
              : rb.rrFy;

      const trailLen = Math.min(48, rb.count);
      const startL = rb.count - trailLen;
      if (trailLen > 2) {
        for (let i = 1; i < trailLen; i++) {
          const p0 = rb.getPhysicalIndex(startL + i - 1);
          const p1 = rb.getPhysicalIndex(startL + i);
          const x0 = cx + (fyArr[p0] / maxForceN) * maxR;
          const y0 = cy - (fxArr[p0] / maxForceN) * maxR;
          const x1 = cx + (fyArr[p1] / maxForceN) * maxR;
          const y1 = cy - (fxArr[p1] / maxForceN) * maxR;
          const alpha = ((i / trailLen) * 0.55).toFixed(2);
          ctx.strokeStyle = `rgba(223, 190, 120, ${alpha})`;
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.lineTo(x1, y1);
          ctx.stroke();
        }
      }

      // Live (Fy, Fx) force vector with precision arrowhead
      const vx = cx + (liveW.fy_n / maxForceN) * maxR;
      const vy = cy - (liveW.fx_n / maxForceN) * maxR;
      const vecLen = Math.hypot(vx - cx, vy - cy);

      ctx.strokeStyle = sigColor;
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(vx, vy);
      ctx.stroke();

      if (vecLen > 7) {
        const ang = Math.atan2(vy - cy, vx - cx);
        const head = 6;
        ctx.fillStyle = sigColor;
        ctx.beginPath();
        ctx.moveTo(vx, vy);
        ctx.lineTo(vx - head * Math.cos(ang - 0.45), vy - head * Math.sin(ang - 0.45));
        ctx.lineTo(vx - head * Math.cos(ang + 0.45), vy - head * Math.sin(ang + 0.45));
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.fillStyle = sigColor;
        ctx.beginPath();
        ctx.arc(vx, vy, 3.2, 0, Math.PI * 2);
        ctx.fill();
      }

      // Subtle axis labels
      ctx.fillStyle = "#64748B";
      ctx.font = '500 8.5px "JetBrains Mono", monospace';
      ctx.textAlign = "center";
      ctx.fillText("+Fx", cx, 10);
      ctx.textAlign = "right";
      ctx.fillText("+Fy", w - 4, cy - 4);

      ctx.restore();
      rafId = requestAnimationFrame(draw);
    };

    rafId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafId);
  }, [cornerKey, latestFrameRef, ringBufferRef]);

  const utilPct = Math.min(100, Math.max(0, wheel.tire_util * 100));
  const utilColor = utilSignalColor(wheel.tire_util);
  const tempNorm = Math.max(0, Math.min(1, (wheel.temp_c - 18) / (100 - 18)));
  const tempCol = thermalColor(wheel.temp_c);

  return (
    <div className="machined-card flex flex-col min-h-0 overflow-hidden p-2.5 gap-2">
      {/* Card Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="px-1.5 py-0.5 rounded-[4px] bg-[#0B0D12] border border-white/[0.06] font-mono text-[10px] font-semibold text-[#DFBE78]">
            {code}
          </span>
          <span className="text-[11.5px] font-semibold text-[#F1F5F9] truncate">{name}</span>
        </div>
        <span className={`status-pill ${utilPillClass(wheel.tire_util)} font-mono text-[10px]`}>
          {utilPct.toFixed(0)}%
        </span>
      </div>

      {/* Main Content: Enlarged Friction Circle + Key-Value Telemetry */}
      <div className="flex-1 min-h-0 grid grid-cols-[minmax(108px,136px)_1fr] gap-2.5 items-stretch">
        <div className="machined-well w-full h-full min-h-[108px] overflow-hidden">
          <canvas ref={canvasRef} className="block w-full h-full" />
        </div>

        <div className="flex flex-col justify-between min-w-0">
          <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-[10.5px]">
            <span className="text-[#94A3B8]">Normal Fz</span>
            <span className="text-right font-mono text-[#F1F5F9] tabular">
              {wheel.fz_n.toFixed(0)} N
            </span>

            <span className="text-[#94A3B8]">Slip α</span>
            <span className="text-right font-mono text-[#F1F5F9] tabular">
              {wheel.slip_angle_deg.toFixed(2)}°
            </span>

            <span className="text-[#94A3B8]">Ratio κ</span>
            <span className="text-right font-mono text-[#F1F5F9] tabular">
              {wheel.slip_ratio.toFixed(3)}
            </span>

            <span className="text-[#94A3B8]">Camber</span>
            <span className="text-right font-mono text-[#E2E8F0] tabular">
              {wheel.camber_deg.toFixed(2)}°
            </span>

            <span className="text-[#94A3B8]">Travel</span>
            <span className="text-right font-mono text-[#E2E8F0] tabular">
              {(wheel.wheel_travel_m * 1000).toFixed(1)} mm
            </span>

            <span className="text-[#94A3B8]">Torque</span>
            <span className="text-right font-mono font-medium text-[#DFBE78] tabular">
              {wheel.motor_torque_nm >= 0 ? "+" : ""}
              {wheel.motor_torque_nm.toFixed(1)} Nm
            </span>
          </div>

          {/* Utilization & Thermal Window Bars */}
          <div className="space-y-1.5 pt-1.5 mt-1 border-t border-white/[0.06]">
            <div>
              <div className="flex justify-between text-[10px] mb-0.5">
                <span className="text-[#94A3B8]">Grip Utilization</span>
                <span className="font-mono font-medium tabular" style={{ color: utilColor }}>
                  {utilPct.toFixed(1)}%
                </span>
              </div>
              <div className="w-full h-1.5 rounded-full bg-[#0B0D12] overflow-hidden">
                <div
                  className="h-full rounded-full transition-[width] duration-75"
                  style={{ width: `${utilPct}%`, backgroundColor: utilColor }}
                />
              </div>
            </div>

            <div>
              <div className="flex justify-between text-[10px] mb-0.5">
                <span className="text-[#94A3B8]">Tread Temp</span>
                <span className="font-mono font-medium tabular" style={{ color: tempCol }}>
                  {wheel.temp_c.toFixed(1)}°C
                </span>
              </div>
              {/* Continuous thermal gradient window (18°C cold -> 75°C optimal -> 95°C overheat) */}
              <div className="relative w-full h-1.5 rounded-full bg-gradient-to-r from-[#38BDF8] via-[#10B981] via-70% to-[#EF4444]">
                <div
                  className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full bg-[#F1F5F9] border-2 border-[#0B0D12] shadow"
                  style={{ left: `${(tempNorm * 100).toFixed(1)}%` }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function FrictionCircle2x2() {
  const { frame } = useTelemetryStore();

  return (
    <div className="machined-panel flex flex-col w-full h-full min-h-0 overflow-hidden">
      <div className="panel-header-bar">
        <div className="flex items-center gap-2">
          <span className="panel-title-label">Contact Patch &amp; Friction Circles</span>
          <span className="panel-subtitle">Dynamic μ·Fz Envelope</span>
        </div>
        <span className="status-pill status-pill-muted font-mono text-[10px]">ISO 8855</span>
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-2 grid-rows-2 gap-2.5 p-2.5 overflow-hidden">
        {CORNERS.map((c) => (
          <CornerFrictionCell
            key={c.key}
            cornerKey={c.key}
            code={c.code}
            name={c.name}
            wheel={frame.wheels[c.key]}
          />
        ))}
      </div>
    </div>
  );
}
