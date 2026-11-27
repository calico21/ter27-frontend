import React, { useEffect, useRef } from "react";
import type { WheelTelemetry } from "../../types";
import { useTelemetryStore } from "../../state/telemetryStore";

type CornerKey = "fl" | "fr" | "rl" | "rr";

const CORNERS: Array<{ key: CornerKey; label: string }> = [
  { key: "fl", label: "FL // FRONT LEFT" },
  { key: "fr", label: "FR // FRONT RIGHT" },
  { key: "rl", label: "RL // REAR LEFT" },
  { key: "rr", label: "RR // REAR RIGHT" },
];

function utilSignalColor(util: number): string {
  if (util >= 0.95) return "#DC2626";
  if (util >= 0.85) return "#D97706";
  return "#10B981";
}

function thermalColor(tempC: number): string {
  if (tempC < 42) return "#38BDF8";
  if (tempC <= 85) return "#10B981";
  if (tempC <= 96) return "#D97706";
  return "#DC2626";
}

function CornerFrictionCell({
  cornerKey,
  label,
  wheel,
}: {
  cornerKey: CornerKey;
  label: string;
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

      const size = Math.min(canvas.clientWidth || 120, canvas.clientHeight || 120);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(60, canvas.clientWidth || 120);
      const h = Math.max(60, canvas.clientHeight || 120);

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
      ctx.fillStyle = "#08090C";
      ctx.fillRect(0, 0, w, h);

      const cx = w / 2;
      const cy = h / 2;
      const maxR = Math.max(24, Math.min(w, h) * 0.41);

      // Fixed force scale: 2600 N outer frame so dynamic mu*Fz circle expands/contracts visibly with load transfer
      const maxForceN = 2600;
      const liveW = latestFrameRef.current.wheels[cornerKey];
      const muFz = Math.max(120, 1.52 * liveW.fz_n);
      const dynR = Math.min(maxR, (muFz / maxForceN) * maxR);

      // Crosshair axes
      ctx.strokeStyle = "#1E2330";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx - maxR, cy);
      ctx.lineTo(cx + maxR, cy);
      ctx.moveTo(cx, cy - maxR);
      ctx.lineTo(cx, cy + maxR);
      ctx.stroke();

      // Static reference outer ring (2600 N)
      ctx.strokeStyle = "#1B1F2A";
      ctx.beginPath();
      ctx.arc(cx, cy, maxR, 0, Math.PI * 2);
      ctx.stroke();

      // Dynamic mu * Fz friction circle boundary
      const sigColor = utilSignalColor(liveW.tire_util);
      ctx.strokeStyle = liveW.tire_util >= 0.95 ? "#DC2626" : "#3A4259";
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      ctx.arc(cx, cy, dynR, 0, Math.PI * 2);
      ctx.stroke();

      // Inner 50% mu*Fz ring
      ctx.strokeStyle = "#1E2330";
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.arc(cx, cy, dynR * 0.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      // Fading 45-frame trail of (Fy, Fx)
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

      const trailLen = Math.min(45, rb.count);
      const startL = rb.count - trailLen;
      for (let i = 0; i < trailLen; i++) {
        const phys = rb.getPhysicalIndex(startL + i);
        const px = cx + (fyArr[phys] / maxForceN) * maxR;
        const py = cy - (fxArr[phys] / maxForceN) * maxR;
        const alpha = ((i + 1) / trailLen) * 0.55;
        ctx.fillStyle = `rgba(197, 160, 89, ${alpha.toFixed(2)})`;
        ctx.fillRect(px - 1, py - 1, 2, 2);
      }

      // Live (Fy, Fx) force vector
      const vx = cx + (liveW.fy_n / maxForceN) * maxR;
      const vy = cy - (liveW.fx_n / maxForceN) * maxR;
      ctx.strokeStyle = sigColor;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(vx, vy);
      ctx.stroke();

      ctx.fillStyle = sigColor;
      ctx.beginPath();
      ctx.arc(vx, vy, 3, 0, Math.PI * 2);
      ctx.fill();

      // Tiny axis markers
      ctx.fillStyle = "#7E8799";
      ctx.font = '8px "JetBrains Mono", monospace';
      ctx.textAlign = "center";
      ctx.fillText("+Fx", cx, 9);
      ctx.textAlign = "right";
      ctx.fillText("+Fy", w - 3, cy - 3);

      // Prevent unused var warning
      void size;
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
    <div className="bg-[#0F1116] border border-[#222633] rounded-[2px] flex flex-col min-h-0 overflow-hidden">
      <div className="flex items-center justify-between px-2 py-1 bg-[#151820] border-b border-[#222633]">
        <span className="text-[10px] font-semibold tracking-[0.05em] text-[#ECEFF4]">{label}</span>
        <span className="text-[10px] font-mono font-semibold" style={{ color: utilColor }}>
          {utilPct.toFixed(0)}% UTIL
        </span>
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-[118px_1fr] gap-1.5 p-1.5">
        <div className="w-full h-full min-h-[104px] border border-[#222633] bg-[#08090C]">
          <canvas ref={canvasRef} className="block w-full h-full" />
        </div>

        <div className="flex flex-col justify-between min-w-0 font-mono text-[10px]">
          <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
            <span className="text-[#7E8799]">Fz</span>
            <span className="text-right text-[#ECEFF4]">{wheel.fz_n.toFixed(0)} N</span>

            <span className="text-[#7E8799]">alpha</span>
            <span className="text-right text-[#ECEFF4]">{wheel.slip_angle_deg.toFixed(2)} deg</span>

            <span className="text-[#7E8799]">kappa</span>
            <span className="text-right text-[#ECEFF4]">{wheel.slip_ratio.toFixed(3)}</span>

            <span className="text-[#7E8799]">camber</span>
            <span className="text-right text-[#ECEFF4]">{wheel.camber_deg.toFixed(2)} deg</span>

            <span className="text-[#7E8799]">travel</span>
            <span className="text-right text-[#ECEFF4]">
              {(wheel.wheel_travel_m * 1000).toFixed(1)} mm
            </span>

            <span className="text-[#7E8799]">torque</span>
            <span className="text-right text-[#C5A059]">{wheel.motor_torque_nm.toFixed(1)} Nm</span>
          </div>

          {/* Utilization bar + Thermal window bar */}
          <div className="space-y-1 pt-1 border-t border-[#222633]">
            <div>
              <div className="flex justify-between text-[9px] text-[#7E8799]">
                <span>FRICTION</span>
                <span style={{ color: utilColor }}>{utilPct.toFixed(1)}%</span>
              </div>
              <div className="w-full h-[3px] bg-[#151820] overflow-hidden">
                <div
                  className="h-full"
                  style={{ width: `${utilPct}%`, backgroundColor: utilColor }}
                />
              </div>
            </div>

            <div>
              <div className="flex justify-between text-[9px] text-[#7E8799]">
                <span>TEMP (18-75C OPT)</span>
                <span style={{ color: tempCol }}>{wheel.temp_c.toFixed(1)} C</span>
              </div>
              <div className="w-full h-[3px] bg-[#151820] relative overflow-hidden">
                <div
                  className="h-full"
                  style={{ width: `${(tempNorm * 100).toFixed(1)}%`, backgroundColor: tempCol }}
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
    <div className="flex flex-col w-full h-full min-h-0 bg-[#08090C]">
      <div className="panel-header-bar">
        <span className="panel-title-label">2x2 Contact Patch &amp; Friction Circles</span>
        <span className="text-[10px] font-mono text-[#7E8799]">
          ISO 8855 / DYN mu*Fz BOUNDARY
        </span>
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-2 grid-rows-2 gap-1.5 p-1.5 overflow-hidden">
        {CORNERS.map((c) => (
          <CornerFrictionCell
            key={c.key}
            cornerKey={c.key}
            label={c.label}
            wheel={frame.wheels[c.key]}
          />
        ))}
      </div>
    </div>
  );
}
