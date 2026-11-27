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
}

const CHANNELS: ChannelDef[] = [
  { id: "vx", lane: 0, label: "vx", unit: "km/h", color: "#ECEFF4" },
  { id: "delta_t", lane: 0, label: "delta_t", unit: "s", color: "#C5A059" },
  { id: "ax_g", lane: 1, label: "ax", unit: "g", color: "#38BDF8" },
  { id: "ay_g", lane: 1, label: "ay", unit: "g", color: "#C5A059" },
  { id: "yaw_rate", lane: 2, label: "omega_z", unit: "rad/s", color: "#ECEFF4" },
  { id: "beta", lane: 2, label: "beta", unit: "deg", color: "#C5A059" },
  { id: "ekf_beta", lane: 2, label: "ekf_beta", unit: "deg", color: "#38BDF8", dashed: true },
  { id: "tq_fl", lane: 3, label: "Tq_FL", unit: "Nm", color: "#ECEFF4" },
  { id: "tq_fr", lane: 3, label: "Tq_FR", unit: "Nm", color: "#C5A059" },
  { id: "tq_rl", lane: 3, label: "Tq_RL", unit: "Nm", color: "#38BDF8" },
  { id: "tq_rr", lane: 3, label: "Tq_RR", unit: "Nm", color: "#10B981" },
];

const LANE_TITLES = [
  "01 VELOCITY [km/h] & TIME DELTA [s]",
  "02 ACCELERATIONS ax / ay [g]",
  "03 YAW RATE [rad/s] & SIDESLIP beta vs EKF [deg]",
  "04 4WD IN-WHEEL MOTOR TORQUES FL / FR / RL / RR [Nm]",
];

export function MultiChannelPlot() {
  const { ringBufferRef } = useTelemetryStore();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [timebase, setTimebase] = useState<TimebaseSec>(15);
  const [frozen, setFrozen] = useState<boolean>(false);
  const [visible, setVisible] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const c of CHANNELS) init[c.id] = true;
    return init;
  });

  const hoverXNormRef = useRef<number | null>(null);
  const frozenRef = useRef<boolean>(false);
  const timebaseRef = useRef<TimebaseSec>(15);
  const visibleRef = useRef<Record<string, boolean>>(visible);

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
      if (width < 20 || height < 20) {
        rafId = requestAnimationFrame(draw);
        return;
      }

      if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
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

      // Clear matte carbon background
      ctx.fillStyle = "#08090C";
      ctx.fillRect(0, 0, width, height);

      const rb = ringBufferRef.current;
      const totalCount = rb.count;
      const maxSamples = Math.min(totalCount, timebaseRef.current * 60);
      const startLogical = Math.max(0, totalCount - maxSamples);

      const padLeft = 52;
      const padRight = 14;
      const plotW = Math.max(40, width - padLeft - padRight);
      const laneH = height / 4;

      const laneConfigs: Array<{
        min: number;
        max: number;
        ticks: number[];
        secMin?: number;
        secMax?: number;
      }> = [
        { min: 0, max: 90, ticks: [0, 30, 60, 90], secMin: -0.5, secMax: 0.5 },
        { min: -2.2, max: 2.2, ticks: [-2, -1, 0, 1, 2] },
        { min: -6, max: 6, ticks: [-6, -3, 0, 3, 6] },
        { min: -55, max: 55, ticks: [-50, -25, 0, 25, 50] },
      ];

      const vis = visibleRef.current;

      // Draw each of the 4 oscilloscope lanes
      for (let lane = 0; lane < 4; lane++) {
        const y0 = lane * laneH;
        const headerH = 18;
        const innerTop = y0 + headerH;
        const innerBottom = y0 + laneH - 8;
        const innerH = Math.max(20, innerBottom - innerTop);
        const cfg = laneConfigs[lane];

        // Lane divider
        if (lane > 0) {
          ctx.strokeStyle = "#222633";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(0, y0 + 0.5);
          ctx.lineTo(width, y0 + 0.5);
          ctx.stroke();
        }

        // Subtle lane title strip
        ctx.fillStyle = "#0F1116";
        ctx.fillRect(0, y0, width, headerH);
        ctx.fillStyle = "#7E8799";
        ctx.font = '600 9px "IBM Plex Sans", sans-serif';
        ctx.textBaseline = "middle";
        ctx.textAlign = "left";
        ctx.fillText(LANE_TITLES[lane], 8, y0 + headerH / 2);

        // Horizontal gridlines & Y ticks
        ctx.font = '10px "JetBrains Mono", monospace';
        ctx.textAlign = "right";
        for (const tick of cfg.ticks) {
          const norm = (tick - cfg.min) / (cfg.max - cfg.min);
          const py = innerBottom - norm * innerH;
          ctx.strokeStyle = tick === 0 ? "#2D3345" : "#181C26";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(padLeft, Math.round(py) + 0.5);
          ctx.lineTo(padLeft + plotW, Math.round(py) + 0.5);
          ctx.stroke();

          ctx.fillStyle = "#7E8799";
          ctx.fillText(tick.toString(), padLeft - 6, py);
        }

        // Vertical timebase gridlines (5 divisions)
        for (let g = 0; g <= 5; g++) {
          const gx = padLeft + (plotW * g) / 5;
          ctx.strokeStyle = "#181C26";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(Math.round(gx) + 0.5, innerTop);
          ctx.lineTo(Math.round(gx) + 0.5, innerBottom);
          ctx.stroke();

          if (lane === 3) {
            const secAgo = -Math.round((timebaseRef.current * (5 - g)) / 5);
            ctx.fillStyle = "#7E8799";
            ctx.textAlign = g === 5 ? "right" : "center";
            ctx.fillText(`${secAgo}s`, gx, innerBottom + 4);
          }
        }

        // Helper to draw a series array
        const drawSeries = (
          arr: Float32Array,
          color: string,
          minV: number,
          maxV: number,
          dashed = false,
          scale = 1
        ) => {
          if (maxSamples < 2) return;
          ctx.save();
          ctx.strokeStyle = color;
          ctx.lineWidth = 1.4;
          if (dashed) ctx.setLineDash([4, 3]);
          ctx.beginPath();
          const stride = Math.max(1, Math.floor(maxSamples / Math.max(200, plotW)));
          let started = false;
          for (let s = 0; s < maxSamples; s += stride) {
            const phys = rb.getPhysicalIndex(startLogical + s);
            const val = arr[phys] * scale;
            const px = padLeft + (s / Math.max(1, maxSamples - 1)) * plotW;
            const norm = Math.max(0, Math.min(1, (val - minV) / (maxV - minV)));
            const py = innerBottom - norm * innerH;
            if (!started) {
              ctx.moveTo(px, py);
              started = true;
            } else {
              ctx.lineTo(px, py);
            }
          }
          ctx.stroke();
          ctx.restore();
        };

        if (lane === 0) {
          if (vis.vx) drawSeries(rb.vxKmh, "#ECEFF4", cfg.min, cfg.max);
          if (vis.delta_t) drawSeries(rb.deltaT, "#C5A059", -0.5, 0.5);
        } else if (lane === 1) {
          if (vis.ax_g) drawSeries(rb.axG, "#38BDF8", cfg.min, cfg.max);
          if (vis.ay_g) drawSeries(rb.ayG, "#C5A059", cfg.min, cfg.max);
        } else if (lane === 2) {
          if (vis.yaw_rate) drawSeries(rb.yawRate, "#ECEFF4", cfg.min, cfg.max);
          if (vis.beta) drawSeries(rb.betaDeg, "#C5A059", cfg.min, cfg.max);
          if (vis.ekf_beta) drawSeries(rb.ekfBetaDeg, "#38BDF8", cfg.min, cfg.max, true);
        } else if (lane === 3) {
          if (vis.tq_fl) drawSeries(rb.torqueFL, "#ECEFF4", cfg.min, cfg.max);
          if (vis.tq_fr) drawSeries(rb.torqueFR, "#C5A059", cfg.min, cfg.max);
          if (vis.tq_rl) drawSeries(rb.torqueRL, "#38BDF8", cfg.min, cfg.max);
          if (vis.tq_rr) drawSeries(rb.torqueRR, "#10B981", cfg.min, cfg.max);
        }

        // Live right-hand readout in lane header
        if (maxSamples > 0) {
          const sampleOffset =
            hoverXNormRef.current !== null
              ? Math.min(maxSamples - 1, Math.max(0, Math.round(hoverXNormRef.current * (maxSamples - 1))))
              : maxSamples - 1;
          const phys = rb.getPhysicalIndex(startLogical + sampleOffset);
          ctx.font = '10px "JetBrains Mono", monospace';
          ctx.textAlign = "right";
          let summary = "";
          if (lane === 0) {
            summary = `vx ${rb.vxKmh[phys].toFixed(1)} km/h  |  dt ${rb.deltaT[phys] >= 0 ? "+" : ""}${rb.deltaT[phys].toFixed(3)} s`;
          } else if (lane === 1) {
            summary = `ax ${rb.axG[phys] >= 0 ? "+" : ""}${rb.axG[phys].toFixed(2)} g  |  ay ${rb.ayG[phys] >= 0 ? "+" : ""}${rb.ayG[phys].toFixed(2)} g`;
          } else if (lane === 2) {
            summary = `wz ${rb.yawRate[phys].toFixed(2)} rad/s  |  beta ${rb.betaDeg[phys].toFixed(2)} deg  |  EKF ${rb.ekfBetaDeg[phys].toFixed(2)} deg`;
          } else {
            summary = `FL ${rb.torqueFL[phys].toFixed(1)}  FR ${rb.torqueFR[phys].toFixed(1)}  RL ${rb.torqueRL[phys].toFixed(1)}  RR ${rb.torqueRR[phys].toFixed(1)} Nm`;
          }
          ctx.fillStyle = hoverXNormRef.current !== null ? "#C5A059" : "#ECEFF4";
          ctx.fillText(summary, width - 8, y0 + headerH / 2);
        }
      }

      // Hover crosshair across all 4 lanes
      if (hoverXNormRef.current !== null && maxSamples > 1) {
        const cx = padLeft + hoverXNormRef.current * plotW;
        ctx.strokeStyle = "#C5A059";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(Math.round(cx) + 0.5, 0);
        ctx.lineTo(Math.round(cx) + 0.5, height);
        ctx.stroke();
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
    const padLeft = 52;
    const padRight = 14;
    const plotW = Math.max(1, rect.width - padLeft - padRight);
    const rel = (e.clientX - rect.left - padLeft) / plotW;
    if (rel >= 0 && rel <= 1) {
      hoverXNormRef.current = rel;
      if (frozen) {
        // Trigger single redraw on hover while frozen
        setVisible((v) => ({ ...v }));
      }
    } else {
      hoverXNormRef.current = null;
    }
  };

  return (
    <div className="flex flex-col w-full h-full min-h-0 bg-[#0F1116] border-r border-[#222633]">
      <div className="panel-header-bar gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="panel-title-label">60 Hz Telemetry Oscilloscopes</span>
          <span className="text-[10px] font-mono text-[#7E8799]">
            RING BUFFER: 3,600 FRAMES (60s)
          </span>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center border border-[#222633] rounded-[2px] bg-[#08090C]">
            {TIMEBASES.map((tb) => (
              <button
                key={tb}
                type="button"
                onClick={() => setTimebase(tb)}
                className={`px-2 py-0.5 text-[10px] font-mono cursor-pointer ${
                  timebase === tb
                    ? "bg-[#1B1F2A] text-[#C5A059]"
                    : "text-[#7E8799] hover:text-[#ECEFF4]"
                }`}
              >
                {tb}s
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setFrozen((f) => !f)}
            className={`flex items-center gap-1 px-2 py-0.5 text-[10px] font-mono border rounded-[2px] cursor-pointer ${
              frozen
                ? "border-[#D97706] text-[#D97706] bg-[#1B1F2A]"
                : "border-[#222633] text-[#ECEFF4] bg-[#08090C] hover:border-[#C5A059]"
            }`}
          >
            {frozen ? <Play className="w-2.5 h-2.5" /> : <Pause className="w-2.5 h-2.5" />}
            {frozen ? "Resume Scope" : "Freeze Scope"}
          </button>
        </div>
      </div>

      {/* Compact channel toggle bar */}
      <div className="flex items-center flex-wrap gap-1 px-2 py-1 bg-[#0F1116] border-b border-[#222633]">
        {CHANNELS.map((ch) => {
          const on = visible[ch.id];
          return (
            <button
              key={ch.id}
              type="button"
              onClick={() => toggleChannel(ch.id)}
              className={`flex items-center gap-1.5 px-1.5 py-0.5 text-[10px] font-mono border rounded-[1px] cursor-pointer ${
                on
                  ? "border-[#222633] bg-[#151820] text-[#ECEFF4]"
                  : "border-transparent bg-transparent text-[#7E8799] opacity-55"
              }`}
            >
              <span
                className="inline-block w-2.5 h-[2px]"
                style={{
                  backgroundColor: ch.color,
                  borderBottom: ch.dashed ? `1px dashed ${ch.color}` : undefined,
                }}
              />
              <span>{ch.label}</span>
            </button>
          );
        })}
      </div>

      {/* Canvas oscilloscope stage */}
      <div ref={containerRef} className="flex-1 min-h-0 w-full relative overflow-hidden">
        <canvas
          ref={canvasRef}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => {
            hoverXNormRef.current = null;
          }}
          className="block w-full h-full cursor-crosshair"
        />
      </div>
    </div>
  );
}
