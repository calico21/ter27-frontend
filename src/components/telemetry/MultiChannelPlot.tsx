import React, { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { useTelemetryStore } from "../../state/telemetryStore";

type TimebaseSec = 5 | 15 | 30 | 60;
const TIMEBASES: TimebaseSec[] = [5, 15, 30, 60];

interface ChannelDef {
  id: string;
  lane: 0 | 1 | 2 | 3;
  label: string;
  unit: string;
  color: string;
  dashed?: boolean;
  fill?: boolean;
}

const CHANNELS: ChannelDef[] = [
  { id: "vx", lane: 0, label: "Velocity vx", unit: "km/h", color: "#F1F5F9", fill: true },
  { id: "delta_t", lane: 0, label: "Delta t", unit: "s", color: "#C5A059" },
  { id: "ax_g", lane: 1, label: "Long. ax", unit: "g", color: "#38BDF8" },
  { id: "ay_g", lane: 1, label: "Lat. ay", unit: "g", color: "#C5A059", fill: true },
  { id: "yaw_rate", lane: 2, label: "Yaw Rate", unit: "rad/s", color: "#F1F5F9" },
  { id: "beta", lane: 2, label: "Sideslip β", unit: "deg", color: "#C5A059", fill: true },
  { id: "ekf_beta", lane: 2, label: "EKF β", unit: "deg", color: "#38BDF8", dashed: true },
  { id: "tq_fl", lane: 3, label: "FL", unit: "Nm", color: "#F1F5F9" },
  { id: "tq_fr", lane: 3, label: "FR", unit: "Nm", color: "#C5A059", fill: true },
  { id: "tq_rl", lane: 3, label: "RL", unit: "Nm", color: "#38BDF8" },
  { id: "tq_rr", lane: 3, label: "RR", unit: "Nm", color: "#34D399" },
];

const LANE_META = [
  { title: "Velocity & Time Delta", unit: "km/h" },
  { title: "Longitudinal & Lateral Acceleration", unit: "g" },
  { title: "Yaw Rate & Sideslip vs EKF", unit: "deg / rad·s⁻¹" },
  { title: "4WD In-Wheel Motor Torques", unit: "Nm" },
];

interface HoverReadout {
  pxX: number;
  plotWidth: number;
  secAgo: number;
  vx: number;
  deltaT: number;
  ax: number;
  ay: number;
  yawRate: number;
  beta: number;
  ekfBeta: number;
  tqFl: number;
  tqFr: number;
  tqRl: number;
  tqRr: number;
}

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function computeNiceRange(
  minVal: number,
  maxVal: number,
  minSpan: number,
  symmetric: boolean,
  floorZero = false
): [number, number] {
  if (!Number.isFinite(minVal) || !Number.isFinite(maxVal)) {
    return symmetric ? [-minSpan / 2, minSpan / 2] : [0, minSpan];
  }
  if (symmetric) {
    const absMax = Math.max(Math.abs(minVal), Math.abs(maxVal), minSpan / 2);
    const padded = absMax * 1.15;
    return [-padded, padded];
  }
  let lo = floorZero ? Math.min(0, minVal) : minVal;
  let hi = maxVal;
  if (hi - lo < minSpan) {
    const mid = (lo + hi) / 2;
    lo = floorZero ? Math.max(0, mid - minSpan / 2) : mid - minSpan / 2;
    hi = lo + minSpan;
  }
  const pad = (hi - lo) * 0.14;
  return [floorZero ? Math.max(0, lo - pad * 0.4) : lo - pad, hi + pad];
}

export function MultiChannelPlot() {
  const { ringBufferRef, frame } = useTelemetryStore();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [timebase, setTimebase] = useState<TimebaseSec>(15);
  const [frozen, setFrozen] = useState<boolean>(false);
  const [hoverInfo, setHoverInfo] = useState<HoverReadout | null>(null);
  const [visible, setVisible] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const c of CHANNELS) init[c.id] = true;
    return init;
  });

  const hoverXNormRef = useRef<number | null>(null);
  const frozenRef = useRef<boolean>(false);
  const timebaseRef = useRef<TimebaseSec>(15);
  const visibleRef = useRef<Record<string, boolean>>(visible);
  // Smooth auto-range bounds to prevent harsh vertical snapping during live playback
  const smoothBoundsRef = useRef<Array<[number, number]>>([
    [0, 90],
    [-2.0, 2.0],
    [-5.0, 5.0],
    [-45, 45],
  ]);

  frozenRef.current = frozen;
  timebaseRef.current = timebase;
  visibleRef.current = visible;

  const toggleChannel = (id: string) => {
    setVisible((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  useEffect(() => {
    let rafId = 0;

    const draw = () => {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) {
        rafId = requestAnimationFrame(draw);
        return;
      }

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = container.clientWidth;
      const height = container.clientHeight;
      if (width < 40 || height < 40) {
        rafId = requestAnimationFrame(draw);
        return;
      }

      if (
        canvas.width !== Math.floor(width * dpr) ||
        canvas.height !== Math.floor(height * dpr)
      ) {
        canvas.width = Math.floor(width * dpr);
        canvas.height = Math.floor(height * dpr);
      }

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        rafId = requestAnimationFrame(draw);
        return;
      }

      ctx.save();
      ctx.scale(dpr, dpr);

      // Deep matte-carbon oscilloscope well
      ctx.fillStyle = "#0B0D12";
      ctx.fillRect(0, 0, width, height);

      const rb = ringBufferRef.current;
      const totalCount = rb.count;
      const maxSamples = Math.min(totalCount, timebaseRef.current * 60);
      const startLogical = Math.max(0, totalCount - maxSamples);

      const padLeft = 50;
      const padRight = 14;
      const axisFootH = 22;
      const plotW = Math.max(40, width - padLeft - padRight);
      const laneH = (height - axisFootH) / 4;
      const vis = visibleRef.current;

      const scanMinMax = (arrays: Float32Array[]): [number, number] => {
        if (maxSamples < 2 || arrays.length === 0) return [0, 1];
        let lo = Infinity;
        let hi = -Infinity;
        const step = Math.max(1, Math.floor(maxSamples / 220));
        for (let s = 0; s < maxSamples; s += step) {
          const phys = rb.getPhysicalIndex(startLogical + s);
          for (const arr of arrays) {
            const v = arr[phys];
            if (v < lo) lo = v;
            if (v > hi) hi = v;
          }
        }
        return [lo, hi];
      };

      // Smart auto-ranging with 14% headroom and smooth damping
      const targetBounds: Array<[number, number]> = [
        computeNiceRange(...scanMinMax([rb.vxKmh]), 24, false, true),
        computeNiceRange(
          ...scanMinMax([
            ...(vis.ax_g ? [rb.axG] : []),
            ...(vis.ay_g ? [rb.ayG] : []),
          ]),
          1.4,
          true
        ),
        computeNiceRange(
          ...scanMinMax([
            ...(vis.yaw_rate ? [rb.yawRate] : []),
            ...(vis.beta ? [rb.betaDeg] : []),
            ...(vis.ekf_beta ? [rb.ekfBetaDeg] : []),
          ]),
          2.5,
          true
        ),
        computeNiceRange(
          ...scanMinMax([
            ...(vis.tq_fl ? [rb.torqueFL] : []),
            ...(vis.tq_fr ? [rb.torqueFR] : []),
            ...(vis.tq_rl ? [rb.torqueRL] : []),
            ...(vis.tq_rr ? [rb.torqueRR] : []),
          ]),
          28,
          true
        ),
      ];

      for (let i = 0; i < 4; i++) {
        const cur = smoothBoundsRef.current[i];
        const tgt = targetBounds[i];
        cur[0] = cur[0] + (tgt[0] - cur[0]) * 0.16;
        cur[1] = cur[1] + (tgt[1] - cur[1]) * 0.16;
      }

      // Secondary auto-range for delta_t on Lane 0
      const [dtLoRaw, dtHiRaw] = scanMinMax([rb.deltaT]);
      const [dtMin, dtMax] = computeNiceRange(dtLoRaw, dtHiRaw, 0.3, true);

      for (let lane = 0; lane < 4; lane++) {
        const y0 = lane * laneH;
        const headerH = 26;
        const innerTop = y0 + headerH + 4;
        const innerBottom = y0 + laneH - 8;
        const innerH = Math.max(22, innerBottom - innerTop);
        const [minV, maxV] = smoothBoundsRef.current[lane];

        // Subtle lane top separator
        if (lane > 0) {
          ctx.strokeStyle = "rgba(255, 255, 255, 0.06)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(0, Math.round(y0) + 0.5);
          ctx.lineTo(width, Math.round(y0) + 0.5);
          ctx.stroke();
        }

        // Subtle lane header tint
        ctx.fillStyle = "rgba(255, 255, 255, 0.018)";
        ctx.fillRect(0, y0, width, headerH);

        // Lane title (Title Case Plus Jakarta Sans)
        ctx.fillStyle = "#94A3B8";
        ctx.font = '600 11px "Plus Jakarta Sans", sans-serif';
        ctx.textBaseline = "middle";
        ctx.textAlign = "left";
        ctx.fillText(LANE_META[lane].title, 12, y0 + headerH / 2);

        // Horizontal subtle dashed gridlines (3 levels + zero if in range)
        const gridLevels =
          minV < 0 && maxV > 0
            ? [minV, 0, maxV]
            : [minV, (minV + maxV) / 2, maxV];

        ctx.font = '10px "JetBrains Mono", monospace';
        ctx.textAlign = "right";
        for (const tick of gridLevels) {
          const norm = (tick - minV) / Math.max(1e-5, maxV - minV);
          const py = innerBottom - norm * innerH;
          const isZero = Math.abs(tick) < 1e-4;
          ctx.save();
          ctx.strokeStyle = isZero
            ? "rgba(255, 255, 255, 0.11)"
            : "rgba(255, 255, 255, 0.045)";
          ctx.lineWidth = 1;
          if (!isZero) ctx.setLineDash([3, 4]);
          ctx.beginPath();
          ctx.moveTo(padLeft, Math.round(py) + 0.5);
          ctx.lineTo(padLeft + plotW, Math.round(py) + 0.5);
          ctx.stroke();
          ctx.restore();

          ctx.fillStyle = isZero ? "#94A3B8" : "#64748B";
          const labelTxt =
            Math.abs(tick) >= 10 || isZero ? tick.toFixed(0) : tick.toFixed(1);
          ctx.fillText(labelTxt, padLeft - 8, py);
        }

        // Subtle vertical timebase dashed gridlines
        for (let g = 1; g < 5; g++) {
          const gx = padLeft + (plotW * g) / 5;
          ctx.save();
          ctx.strokeStyle = "rgba(255, 255, 255, 0.035)";
          ctx.setLineDash([2, 5]);
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(Math.round(gx) + 0.5, innerTop);
          ctx.lineTo(Math.round(gx) + 0.5, innerBottom);
          ctx.stroke();
          ctx.restore();
        }

        // Series renderer with optional vertical gradient fill beneath primary curve
        const drawSeries = (
          arr: Float32Array,
          color: string,
          sMin: number,
          sMax: number,
          opts?: { dashed?: boolean; fill?: boolean; width?: number }
        ) => {
          if (maxSamples < 2) return;
          const stride = Math.max(1, Math.floor(maxSamples / Math.max(220, plotW)));
          const pts: Array<[number, number]> = [];
          for (let s = 0; s < maxSamples; s += stride) {
            const phys = rb.getPhysicalIndex(startLogical + s);
            const val = arr[phys];
            const px = padLeft + (s / Math.max(1, maxSamples - 1)) * plotW;
            const norm = Math.max(0, Math.min(1, (val - sMin) / Math.max(1e-5, sMax - sMin)));
            const py = innerBottom - norm * innerH;
            pts.push([px, py]);
          }
          if (pts.length < 2) return;

          // Ensure final point reaches the live right edge
          const lastPhys = rb.getPhysicalIndex(startLogical + maxSamples - 1);
          const lastNorm = Math.max(
            0,
            Math.min(1, (arr[lastPhys] - sMin) / Math.max(1e-5, sMax - sMin))
          );
          pts.push([padLeft + plotW, innerBottom - lastNorm * innerH]);

          if (opts?.fill) {
            ctx.save();
            const grad = ctx.createLinearGradient(0, innerTop, 0, innerBottom);
            grad.addColorStop(0, hexToRgba(color, 0.16));
            grad.addColorStop(1, hexToRgba(color, 0.0));
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.moveTo(pts[0][0], innerBottom);
            for (const [px, py] of pts) ctx.lineTo(px, py);
            ctx.lineTo(pts[pts.length - 1][0], innerBottom);
            ctx.closePath();
            ctx.fill();
            ctx.restore();
          }

          ctx.save();
          ctx.strokeStyle = color;
          ctx.lineWidth = opts?.width ?? 1.75;
          ctx.lineJoin = "round";
          ctx.lineCap = "round";
          if (opts?.dashed) ctx.setLineDash([5, 4]);
          ctx.beginPath();
          ctx.moveTo(pts[0][0], pts[0][1]);
          for (let i = 1; i < pts.length; i++) {
            ctx.lineTo(pts[i][0], pts[i][1]);
          }
          ctx.stroke();
          ctx.restore();
        };

        if (lane === 0) {
          if (vis.vx) drawSeries(rb.vxKmh, "#F1F5F9", minV, maxV, { fill: true, width: 1.9 });
          if (vis.delta_t) drawSeries(rb.deltaT, "#C5A059", dtMin, dtMax, { width: 1.6 });
        } else if (lane === 1) {
          if (vis.ax_g) drawSeries(rb.axG, "#38BDF8", minV, maxV, { width: 1.7 });
          if (vis.ay_g) drawSeries(rb.ayG, "#C5A059", minV, maxV, { fill: true, width: 1.85 });
        } else if (lane === 2) {
          if (vis.yaw_rate) drawSeries(rb.yawRate, "#F1F5F9", minV, maxV, { width: 1.6 });
          if (vis.beta) drawSeries(rb.betaDeg, "#C5A059", minV, maxV, { fill: true, width: 1.85 });
          if (vis.ekf_beta) drawSeries(rb.ekfBetaDeg, "#38BDF8", minV, maxV, { dashed: true, width: 1.55 });
        } else if (lane === 3) {
          if (vis.tq_fl) drawSeries(rb.torqueFL, "#F1F5F9", minV, maxV, { width: 1.6 });
          if (vis.tq_fr) drawSeries(rb.torqueFR, "#C5A059", minV, maxV, { fill: true, width: 1.75 });
          if (vis.tq_rl) drawSeries(rb.torqueRL, "#38BDF8", minV, maxV, { width: 1.6 });
          if (vis.tq_rr) drawSeries(rb.torqueRR, "#34D399", minV, maxV, { width: 1.6 });
        }

        // Inline right-hand live numeric summary for each lane
        if (maxSamples > 0) {
          const sampleOffset =
            hoverXNormRef.current !== null
              ? Math.min(
                  maxSamples - 1,
                  Math.max(0, Math.round(hoverXNormRef.current * (maxSamples - 1)))
                )
              : maxSamples - 1;
          const phys = rb.getPhysicalIndex(startLogical + sampleOffset);
          ctx.font = '500 10.5px "JetBrains Mono", monospace';
          ctx.textAlign = "right";
          ctx.textBaseline = "middle";
          let summary = "";
          if (lane === 0) {
            summary = `vx ${rb.vxKmh[phys].toFixed(1)} km/h   Δt ${rb.deltaT[phys] >= 0 ? "+" : ""}${rb.deltaT[phys].toFixed(3)} s`;
          } else if (lane === 1) {
            summary = `ax ${rb.axG[phys] >= 0 ? "+" : ""}${rb.axG[phys].toFixed(2)} g   ay ${rb.ayG[phys] >= 0 ? "+" : ""}${rb.ayG[phys].toFixed(2)} g`;
          } else if (lane === 2) {
            summary = `ωz ${rb.yawRate[phys].toFixed(2)}   β ${rb.betaDeg[phys].toFixed(2)}°   EKF ${rb.ekfBetaDeg[phys].toFixed(2)}°`;
          } else {
            summary = `FL ${rb.torqueFL[phys].toFixed(0)}   FR ${rb.torqueFR[phys].toFixed(0)}   RL ${rb.torqueRL[phys].toFixed(0)}   RR ${rb.torqueRR[phys].toFixed(0)} Nm`;
          }
          ctx.fillStyle = hoverXNormRef.current !== null ? "#DFBE78" : "#CBD5E1";
          ctx.fillText(summary, width - 12, y0 + headerH / 2);
        }
      }

      // Bottom timebase ruler
      const footY = height - axisFootH;
      ctx.fillStyle = "#11141B";
      ctx.fillRect(0, footY, width, axisFootH);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.06)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, footY + 0.5);
      ctx.lineTo(width, footY + 0.5);
      ctx.stroke();

      ctx.font = '10px "JetBrains Mono", monospace';
      ctx.fillStyle = "#64748B";
      ctx.textBaseline = "middle";
      for (let g = 0; g <= 5; g++) {
        const gx = padLeft + (plotW * g) / 5;
        const secAgo = -Math.round((timebaseRef.current * (5 - g)) / 5);
        ctx.textAlign = g === 0 ? "left" : g === 5 ? "right" : "center";
        ctx.fillText(g === 5 ? "Now (0s)" : `${secAgo}s`, gx, footY + axisFootH / 2);
      }

      // Hover vertical crosshair hairline
      if (hoverXNormRef.current !== null && maxSamples > 1) {
        const cx = padLeft + hoverXNormRef.current * plotW;
        ctx.save();
        ctx.strokeStyle = "rgba(223, 190, 120, 0.72)";
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(Math.round(cx) + 0.5, 0);
        ctx.lineTo(Math.round(cx) + 0.5, footY);
        ctx.stroke();
        ctx.restore();
      }

      ctx.restore();

      if (!frozenRef.current) {
        rafId = requestAnimationFrame(draw);
      }
    };

    rafId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafId);
  }, [ringBufferRef, frozen, timebase, visible]);

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const padLeft = 50;
    const padRight = 14;
    const plotW = Math.max(1, rect.width - padLeft - padRight);
    const rel = (e.clientX - rect.left - padLeft) / plotW;
    if (rel >= 0 && rel <= 1) {
      hoverXNormRef.current = rel;
      const rb = ringBufferRef.current;
      const totalCount = rb.count;
      const maxSamples = Math.min(totalCount, timebase * 60);
      if (maxSamples > 1) {
        const startLogical = Math.max(0, totalCount - maxSamples);
        const offset = Math.min(maxSamples - 1, Math.max(0, Math.round(rel * (maxSamples - 1))));
        const phys = rb.getPhysicalIndex(startLogical + offset);
        setHoverInfo({
          pxX: e.clientX - rect.left,
          plotWidth: rect.width,
          secAgo: -((1 - rel) * timebase),
          vx: rb.vxKmh[phys],
          deltaT: rb.deltaT[phys],
          ax: rb.axG[phys],
          ay: rb.ayG[phys],
          yawRate: rb.yawRate[phys],
          beta: rb.betaDeg[phys],
          ekfBeta: rb.ekfBetaDeg[phys],
          tqFl: rb.torqueFL[phys],
          tqFr: rb.torqueFR[phys],
          tqRl: rb.torqueRL[phys],
          tqRr: rb.torqueRR[phys],
        });
      }
      if (frozen) {
        setVisible((v) => ({ ...v }));
      }
    } else {
      hoverXNormRef.current = null;
      setHoverInfo(null);
    }
  };

  // Current live values for channel chips
  const liveChannelVal = (id: string): string => {
    switch (id) {
      case "vx":
        return `${(frame.state.vx * 3.6).toFixed(0)}`;
      case "delta_t":
        return `${frame.dil_delta.delta_time_s >= 0 ? "+" : ""}${frame.dil_delta.delta_time_s.toFixed(2)}`;
      case "ax_g":
        return `${frame.state.ax_g.toFixed(2)}`;
      case "ay_g":
        return `${frame.state.ay_g.toFixed(2)}`;
      case "yaw_rate":
        return `${frame.state.yaw_rate_rad_s.toFixed(2)}`;
      case "beta":
        return `${frame.state.beta_deg.toFixed(1)}°`;
      case "ekf_beta":
        return `${frame.ekf.ekf_beta_deg.toFixed(1)}°`;
      case "tq_fl":
        return `${frame.wheels.fl.motor_torque_nm.toFixed(0)}`;
      case "tq_fr":
        return `${frame.wheels.fr.motor_torque_nm.toFixed(0)}`;
      case "tq_rl":
        return `${frame.wheels.rl.motor_torque_nm.toFixed(0)}`;
      case "tq_rr":
        return `${frame.wheels.rr.motor_torque_nm.toFixed(0)}`;
      default:
        return "";
    }
  };

  return (
    <div className="machined-panel flex flex-col w-full h-full min-h-0 overflow-hidden">
      {/* Header Bar */}
      <div className="panel-header-bar gap-3 flex-wrap">
        <div className="flex items-center gap-2.5">
          <span className="panel-title-label">Live Telemetry Oscilloscopes</span>
          <span className="status-pill status-pill-muted font-mono text-[10px]">
            60 Hz · 3,600 frames
          </span>
        </div>

        <div className="flex items-center gap-2">
          <div className="seg-track" role="group" aria-label="Oscilloscope timebase">
            {TIMEBASES.map((tb) => (
              <button
                key={tb}
                type="button"
                data-active={timebase === tb ? "true" : "false"}
                onClick={() => setTimebase(tb)}
                className="seg-btn font-mono"
              >
                {tb}s
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setFrozen((f) => !f)}
            className={`flex items-center gap-1.5 h-[26px] px-2.5 text-[11px] font-medium rounded-[5px] border cursor-pointer transition-colors ${
              frozen
                ? "border-[#D97706]/45 bg-[#D97706]/14 text-[#FBBF24]"
                : "border-white/[0.08] bg-[#161A23] text-[#E2E8F0] hover:border-[#C5A059]/45 hover:text-[#DFBE78]"
            }`}
          >
            {frozen ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
            <span>{frozen ? "Resume" : "Freeze"}</span>
          </button>
        </div>
      </div>

      {/* Interactive Channel Legend Strip with Inline Live Values */}
      <div className="flex items-center flex-wrap gap-1.5 px-3 py-1.5 bg-[#0E1118] border-b border-white/[0.05]">
        {CHANNELS.map((ch) => {
          const on = visible[ch.id];
          return (
            <button
              key={ch.id}
              type="button"
              onClick={() => toggleChannel(ch.id)}
              className={`flex items-center gap-1.5 px-2 py-0.5 rounded-[4px] text-[10.5px] cursor-pointer transition-all border ${
                on
                  ? "bg-[#161A23] border-white/[0.07] text-[#E2E8F0]"
                  : "bg-transparent border-transparent text-[#64748B] opacity-55 hover:opacity-85"
              }`}
            >
              <span
                className="inline-block w-2.5 h-[2px] rounded-full shrink-0"
                style={{
                  backgroundColor: ch.dashed ? "transparent" : ch.color,
                  borderTop: ch.dashed ? `2px dashed ${ch.color}` : undefined,
                }}
              />
              <span className="font-medium">{ch.label}</span>
              <span className="font-mono text-[10px] text-[#94A3B8] tabular">
                {liveChannelVal(ch.id)}
              </span>
            </button>
          );
        })}
      </div>

      {/* Oscilloscope Canvas Stage + Floating Crosshair Readout Popover */}
      <div ref={containerRef} className="flex-1 min-h-0 w-full relative overflow-hidden">
        <canvas
          ref={canvasRef}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => {
            hoverXNormRef.current = null;
            setHoverInfo(null);
          }}
          className="block w-full h-full cursor-crosshair"
        />

        {hoverInfo ? (
          <div
            className="pointer-events-none absolute top-3 z-20 w-[212px] rounded-[6px] bg-[#141821]/95 border border-white/[0.11] shadow-[0_12px_28px_rgba(0,0,0,0.55)] p-2.5 text-[10.5px]"
            style={{
              left:
                hoverInfo.pxX + 230 > hoverInfo.plotWidth
                  ? Math.max(56, hoverInfo.pxX - 224)
                  : hoverInfo.pxX + 14,
            }}
          >
            <div className="flex items-center justify-between pb-1.5 mb-1.5 border-b border-white/[0.07]">
              <span className="text-[11px] font-semibold text-[#F1F5F9]">Sample Inspector</span>
              <span className="font-mono text-[10px] text-[#DFBE78]">
                {hoverInfo.secAgo.toFixed(2)}s
              </span>
            </div>
            <div className="grid grid-cols-2 gap-x-2 gap-y-1 font-mono text-[10px] tabular">
              <span className="text-[#94A3B8]">Velocity</span>
              <span className="text-right text-[#F1F5F9]">{hoverInfo.vx.toFixed(1)} km/h</span>
              <span className="text-[#94A3B8]">Delta t</span>
              <span className="text-right text-[#DFBE78]">
                {hoverInfo.deltaT >= 0 ? "+" : ""}
                {hoverInfo.deltaT.toFixed(3)} s
              </span>
              <span className="text-[#94A3B8]">Accel ax / ay</span>
              <span className="text-right text-[#E2E8F0]">
                {hoverInfo.ax.toFixed(2)} / {hoverInfo.ay.toFixed(2)} g
              </span>
              <span className="text-[#94A3B8]">β / EKF β</span>
              <span className="text-right text-[#38BDF8]">
                {hoverInfo.beta.toFixed(2)}° / {hoverInfo.ekfBeta.toFixed(2)}°
              </span>
              <span className="text-[#94A3B8]">FL / FR</span>
              <span className="text-right text-[#E2E8F0]">
                {hoverInfo.tqFl.toFixed(0)} / {hoverInfo.tqFr.toFixed(0)} Nm
              </span>
              <span className="text-[#94A3B8]">RL / RR</span>
              <span className="text-right text-[#34D399]">
                {hoverInfo.tqRl.toFixed(0)} / {hoverInfo.tqRr.toFixed(0)} Nm
              </span>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
