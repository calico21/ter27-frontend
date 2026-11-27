import React, { useEffect, useRef, useState } from "react";
import { Upload, X } from "lucide-react";
import type { CornerHardpoints3D, SuspensionOverview, TelemetryFrame } from "../../types";
import {
  ConfirmedHardpointsOverride,
  hasNonZeroHardpoints,
} from "../../services/apiClient";
import { InstrumentHeader } from "../shared/PrecisionControl";

export interface KinematicsLayerToggles {
  forceVectors: boolean;
  frictionRings: boolean;
  rollCenterLines: boolean;
  antiGeometryPlanes: boolean;
  wireframeChassis: boolean;
}

interface SuspensionKinematicsOverlayProps {
  suspension: SuspensionOverview;
  frame: TelemetryFrame;
  layers: KinematicsLayerToggles;
  onToggleLayer: (key: keyof KinematicsLayerToggles) => void;
  onImportHardpoints: (override: ConfirmedHardpointsOverride | null) => Promise<void>;
  hardpointsLoaded: boolean;
}

const EXAMPLE_TEMPLATE = `{
  "front_left_hardpoints": {
    "lca_front": [0.90, 0.22, 0.14],
    "lca_rear": [0.62, 0.24, 0.15],
    "lbj": [0.77, 0.56, 0.13],
    "uca_front": [0.88, 0.25, 0.29],
    "uca_rear": [0.64, 0.26, 0.30],
    "ubj": [0.76, 0.54, 0.31],
    "pushrod_wishbone": [0.76, 0.51, 0.16],
    "pushrod_rocker": [0.75, 0.22, 0.44],
    "tie_outer": [0.70, 0.55, 0.18],
    "tie_inner": [0.71, 0.20, 0.19],
    "wheel_center": [0.77, 0.62, 0.203],
    "contact_patch": [0.77, 0.62, 0.0],
    "damper_chassis": [0.55, 0.16, 0.43],
    "damper_rocker": [0.72, 0.19, 0.44],
    "rocker_axis_p1": [0.75, 0.20, 0.41],
    "rocker_pivot": [0.75, 0.21, 0.41],
    "arb_link_rocker": [0.77, 0.19, 0.45],
    "arb_arm_tip": [0.80, 0.15, 0.45],
    "arb_chassis_piv": [0.80, 0.10, 0.45],
    "spring_stiffness_n_m": 35000
  },
  "rear_left_hardpoints": { ... }
}`;

function computeRollCenterHeightMm(corner: CornerHardpoints3D): number | null {
  if (!hasNonZeroHardpoints(corner)) return null;
  const lcaInY = 0.5 * (corner.lca_front[1] + corner.lca_rear[1]);
  const lcaInZ = 0.5 * (corner.lca_front[2] + corner.lca_rear[2]);
  const ucaInY = 0.5 * (corner.uca_front[1] + corner.uca_rear[1]);
  const ucaInZ = 0.5 * (corner.uca_front[2] + corner.uca_rear[2]);

  const y1 = lcaInY,
    z1 = lcaInZ,
    y2 = corner.lbj[1],
    z2 = corner.lbj[2];
  const y3 = ucaInY,
    z3 = ucaInZ,
    y4 = corner.ubj[1],
    z4 = corner.ubj[2];

  const denom = (y1 - y2) * (z3 - z4) - (z1 - z2) * (y3 - y4);
  if (Math.abs(denom) < 1e-6) return null;

  const icY = ((y1 * z2 - z1 * y2) * (y3 - y4) - (y1 - y2) * (y3 * z4 - z3 * y4)) / denom;
  const icZ = ((y1 * z2 - z1 * y2) * (z3 - z4) - (z1 - z2) * (y3 * z4 - z3 * y4)) / denom;

  const cpY = corner.contact_patch[1];
  const cpZ = corner.contact_patch[2];
  if (Math.abs(icY - cpY) < 1e-6) return null;
  const t = (0 - cpY) / (icY - cpY);
  const rcZ = cpZ + t * (icZ - cpZ);
  return rcZ * 1000;
}

export function SuspensionKinematicsOverlay({
  suspension,
  frame,
  onImportHardpoints,
  hardpointsLoaded,
}: SuspensionKinematicsOverlayProps) {
  const camberCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [jsonInput, setJsonInput] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);

  const flTravelMm = frame.wheels.fl.wheel_travel_m * 1000;
  const frTravelMm = frame.wheels.fr.wheel_travel_m * 1000;
  const rlTravelMm = frame.wheels.rl.wheel_travel_m * 1000;
  const rrTravelMm = frame.wheels.rr.wheel_travel_m * 1000;

  const heaveMm = (flTravelMm + frTravelMm + rlTravelMm + rrTravelMm) / 4;
  const rollDeg = frame.state.ay_g * 0.8;
  const pitchDeg = frame.state.ax_g * 0.52;

  const frontRcMm = computeRollCenterHeightMm(suspension.front_left_hardpoints);
  const rearRcMm = computeRollCenterHeightMm(suspension.rear_left_hardpoints);

  useEffect(() => {
    const canvas = camberCanvasRef.current;
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

      const padL = 32,
        padR = 10,
        padT = 10,
        padB = 18;
      const pw = w - padL - padR;
      const ph = h - padT - padB;

      const minT = -30,
        maxT = 30;
      const minC = -4.0,
        maxC = 0.0;

      const xOf = (t: number) => padL + ((t - minT) / (maxT - minT)) * pw;
      const yOf = (c: number) => padT + ph - ((c - minC) / (maxC - minC)) * ph;

      ctx.font = '9px "JetBrains Mono", monospace';
      for (const c of [-4, -3, -2, -1, 0]) {
        const py = yOf(c);
        ctx.save();
        ctx.strokeStyle = c === 0 ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.045)";
        if (c !== 0) ctx.setLineDash([3, 4]);
        ctx.beginPath();
        ctx.moveTo(padL, Math.round(py) + 0.5);
        ctx.lineTo(w - padR, Math.round(py) + 0.5);
        ctx.stroke();
        ctx.restore();

        ctx.fillStyle = "#64748B";
        ctx.textAlign = "right";
        ctx.fillText(`${c}°`, padL - 5, py + 3);
      }

      const zeroX = xOf(0);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
      ctx.beginPath();
      ctx.moveTo(Math.round(zeroX) + 0.5, padT);
      ctx.lineTo(Math.round(zeroX) + 0.5, padT + ph);
      ctx.stroke();

      const drawCurve = (staticCam: number, slope: number, color: string, fill = false) => {
        const pts: Array<[number, number]> = [];
        for (let t = minT; t <= maxT; t += 2) {
          const cam = staticCam - slope * t - 0.00018 * t * t;
          pts.push([xOf(t), yOf(Math.max(minC, Math.min(maxC, cam)))]);
        }
        if (fill && pts.length > 1) {
          ctx.save();
          const grad = ctx.createLinearGradient(0, padT, 0, padT + ph);
          grad.addColorStop(0, "rgba(197, 160, 89, 0.16)");
          grad.addColorStop(1, "rgba(197, 160, 89, 0.0)");
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.moveTo(pts[0][0], padT + ph);
          for (const [px, py] of pts) ctx.lineTo(px, py);
          ctx.lineTo(pts[pts.length - 1][0], padT + ph);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.8;
        ctx.lineJoin = "round";
        ctx.beginPath();
        pts.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
        ctx.stroke();
      };

      drawCurve(suspension.static_camber_front_deg, 0.029, "#C5A059", true);
      drawCurve(suspension.static_camber_rear_deg, 0.024, "#38BDF8", false);

      const liveX = xOf(Math.max(minT, Math.min(maxT, flTravelMm)));
      const liveY = yOf(Math.max(minC, Math.min(maxC, frame.wheels.fl.camber_deg)));
      ctx.strokeStyle = "#DFBE78";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(liveX, liveY, 4.8, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = "#ECEFF4";
      ctx.beginPath();
      ctx.arc(liveX, liveY, 2.3, 0, Math.PI * 2);
      ctx.fill();

      ctx.textAlign = "center";
      ctx.fillStyle = "#64748B";
      ctx.fillText("Wheel Travel (-30 Droop .. +30 mm Bump)", padL + pw / 2, h - 5);
      ctx.restore();
    };
    render();
    const ro = new ResizeObserver(render);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [
    flTravelMm,
    frame.wheels.fl.camber_deg,
    suspension.static_camber_front_deg,
    suspension.static_camber_rear_deg,
  ]);

  const handleApplyJson = async () => {
    setParseError(null);
    try {
      const parsed = JSON.parse(jsonInput) as ConfirmedHardpointsOverride;
      if (!parsed.front_left_hardpoints || !parsed.rear_left_hardpoints) {
        setParseError("JSON must include front_left_hardpoints and rear_left_hardpoints.");
        return;
      }
      if (!hasNonZeroHardpoints(parsed.front_left_hardpoints)) {
        setParseError("front_left_hardpoints contains only zero vectors.");
        return;
      }
      await onImportHardpoints({
        ...parsed,
        sourceLabel: "User Confirmed ISO 8855 JSON",
      });
      setImportOpen(false);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : "Invalid JSON payload.");
    }
  };

  const corners = [
    { id: "FL", mm: flTravelMm, w: frame.wheels.fl },
    { id: "FR", mm: frTravelMm, w: frame.wheels.fr },
    { id: "RL", mm: rlTravelMm, w: frame.wheels.rl },
    { id: "RR", mm: rrTravelMm, w: frame.wheels.rr },
  ];

  return (
    <div className="machined-panel w-full h-full min-h-0 flex flex-col overflow-hidden">
      <InstrumentHeader
        title="Kinematics & Corner Loads"
        right={
          <button
            type="button"
            onClick={() => setImportOpen((o) => !o)}
            className="h-[20px] px-1.5 rounded-[3px] bg-[#151820] border border-[#222633] hover:border-[#C5A059]/45 text-[9.5px] font-medium text-[#CBD5E1] hover:text-[#DFBE78] flex items-center gap-1 cursor-pointer"
          >
            <Upload className="w-2.5 h-2.5 text-[#C5A059]" />
            HP JSON
          </button>
        }
      />

      <div className="flex-1 min-h-0 p-2 flex flex-col justify-between gap-2 overflow-y-auto text-[10.5px]">
        {/* Compact Hardpoints Provenance Pill */}
        <div className="rounded-[3px] bg-[#141720] border border-[#222633] px-2 py-1.5 flex items-center justify-between gap-2 shrink-0">
          <span className="font-mono text-[9.5px] text-[#94A3B8] truncate">
            {suspension.frame}
          </span>
          <span
            className={`status-pill !text-[9px] shrink-0 ${
              hardpointsLoaded ? "status-pill-nominal" : "status-pill-caution"
            }`}
          >
            {hardpointsLoaded ? "3D Hardpoints Active" : "Awaiting HP"}
          </span>
        </div>

        {/* Inline Confirmed Hardpoints Importer */}
        {importOpen ? (
          <div className="rounded-[3px] bg-[#08090C] border border-[#C5A059]/45 p-2 space-y-1.5 shrink-0">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold text-[#DFBE78]">
                CornerHardpoints3D JSON
              </span>
              <button
                type="button"
                onClick={() => setImportOpen(false)}
                className="text-[#7E8899] hover:text-[#ECEFF4] cursor-pointer"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
            <textarea
              rows={5}
              value={jsonInput}
              onChange={(e) => setJsonInput(e.target.value)}
              placeholder={EXAMPLE_TEMPLATE}
              className="w-full bg-[#0F1116] border border-[#222633] rounded-[3px] p-1.5 font-mono text-[9.5px] text-[#ECEFF4] outline-none resize-y focus:border-[#C5A059]"
            />
            {parseError ? <div className="text-[9.5px] text-[#F87171]">{parseError}</div> : null}
            <div className="flex items-center justify-between gap-2">
              {hardpointsLoaded ? (
                <button
                  type="button"
                  onClick={() => {
                    void onImportHardpoints(null);
                    setImportOpen(false);
                  }}
                  className="px-2 py-0.5 text-[9.5px] rounded-[2px] border border-[#222633] text-[#7E8899] hover:text-[#F87171] cursor-pointer"
                >
                  Clear Override
                </button>
              ) : (
                <span />
              )}
              <button
                type="button"
                onClick={() => void handleApplyJson()}
                className="px-2.5 py-0.5 text-[10px] rounded-[2px] bg-[#C5A059] hover:bg-[#DFBE78] text-[#07080B] font-semibold cursor-pointer"
              >
                Load
              </button>
            </div>
          </div>
        ) : null}

        {/* Sprung Mass Attitude 3-Up */}
        <div className="grid grid-cols-3 gap-1.5 shrink-0">
          <div className="rounded-[3px] bg-[#141720] border border-[#222633] px-2 py-1.5">
            <div className="text-[9px] text-[#7E8899]">Heave</div>
            <div className="font-mono text-[11.5px] font-semibold text-[#ECEFF4] tabular">
              {heaveMm >= 0 ? "+" : ""}
              {heaveMm.toFixed(1)}mm
            </div>
          </div>
          <div className="rounded-[3px] bg-[#141720] border border-[#222633] px-2 py-1.5">
            <div className="text-[9px] text-[#7E8899]">Roll (est)</div>
            <div className="font-mono text-[11.5px] font-semibold text-[#DFBE78] tabular">
              {rollDeg >= 0 ? "+" : ""}
              {rollDeg.toFixed(2)}°
            </div>
          </div>
          <div className="rounded-[3px] bg-[#141720] border border-[#222633] px-2 py-1.5">
            <div className="text-[9px] text-[#7E8899]">Pitch (est)</div>
            <div className="font-mono text-[11.5px] font-semibold text-[#38BDF8] tabular">
              {pitchDeg >= 0 ? "+" : ""}
              {pitchDeg.toFixed(2)}°
            </div>
          </div>
        </div>

        {/* Roll Centers & Anti-Geometry */}
        <div className="grid grid-cols-2 gap-1.5 shrink-0">
          <div className="rounded-[3px] bg-[#141720] border border-[#222633] px-2 py-1.5 flex items-center justify-between">
            <span className="text-[9.5px] text-[#7E8899]">RC F / R</span>
            <span className="font-mono text-[10.5px] text-[#ECEFF4] tabular">
              {frontRcMm !== null ? frontRcMm.toFixed(0) : "—"} /{" "}
              {rearRcMm !== null ? rearRcMm.toFixed(0) : "—"} mm
            </span>
          </div>
          <div className="rounded-[3px] bg-[#141720] border border-[#222633] px-2 py-1.5 flex items-center justify-between">
            <span className="text-[9.5px] text-[#7E8899]">AD / AS</span>
            <span className="font-mono text-[10.5px] text-[#DFBE78] tabular">
              {(suspension.anti_dive_front * 100).toFixed(0)}% /{" "}
              {(suspension.anti_squat_rear * 100).toFixed(0)}%
            </span>
          </div>
        </div>

        {/* 4-Corner Live Loads, Camber & Travel Strip */}
        <div className="space-y-1.5 shrink-0">
          <div className="flex items-center justify-between text-[9.5px] font-mono text-[#7E8899] px-0.5">
            <span>CORNER TELEMETRY (Fz · γ · TRAVEL)</span>
            <span>±30 mm</span>
          </div>
          {corners.map((c) => {
            const pct = Math.max(0, Math.min(100, ((c.mm + 30) / 60) * 100));
            const utilPct = c.w.tire_util * 100;
            return (
              <div
                key={c.id}
                className="rounded-[3px] bg-[#141720] border border-[#222633] px-2 py-1.5 space-y-1"
              >
                <div className="flex items-center justify-between font-mono text-[10px] tabular">
                  <span className="font-semibold text-[#ECEFF4] w-[24px]">{c.id}</span>
                  <span className="text-[#DFBE78]">{c.w.fz_n.toFixed(0)} N</span>
                  <span className="text-[#94A3B8]">{c.w.camber_deg.toFixed(2)}°</span>
                  <span
                    className={
                      utilPct >= 90
                        ? "text-[#F87171]"
                        : utilPct >= 72
                          ? "text-[#FBBF24]"
                          : "text-[#34D399]"
                    }
                  >
                    {utilPct.toFixed(0)}%
                  </span>
                  <span className="text-[#ECEFF4] w-[48px] text-right">
                    {c.mm >= 0 ? "+" : ""}
                    {c.mm.toFixed(1)}
                  </span>
                </div>
                <div className="relative h-[4px] rounded-[1px] bg-[#08090C] overflow-hidden">
                  <div
                    className="absolute top-0 bottom-0 bg-[#C5A059]"
                    style={{
                      left: c.mm >= 0 ? "50%" : `${pct}%`,
                      width: `${Math.abs(pct - 50)}%`,
                    }}
                  />
                  <div className="absolute left-1/2 top-0 bottom-0 w-[1px] bg-white/30" />
                </div>
              </div>
            );
          })}
        </div>

        {/* High-DPI Camber Gain Curve */}
        <div className="flex-1 min-h-[110px] flex flex-col rounded-[3px] border border-[#222633] overflow-hidden">
          <div className="h-[22px] px-2 bg-[#12151D] border-b border-[#222633] flex items-center justify-between text-[9.5px] font-mono shrink-0">
            <span className="text-[#CBD5E1]">Camber Gain</span>
            <span>
              <span className="text-[#DFBE78]">Front</span> ·{" "}
              <span className="text-[#38BDF8]">Rear</span>
            </span>
          </div>
          <div className="flex-1 min-h-0 relative bg-[#08090C]">
            <canvas ref={camberCanvasRef} className="block w-full h-full" />
          </div>
        </div>

        {/* Compact Spec Footer */}
        <div className="rounded-[3px] bg-[#141720] border border-[#222633] px-2 py-1.5 grid grid-cols-2 gap-y-1 font-mono text-[9.5px] shrink-0">
          <span className="text-[#7E8899]">Spring F / R</span>
          <span className="text-right text-[#ECEFF4] tabular">
            {(suspension.spring_stiffness_front_n_m / 1000).toFixed(0)} /{" "}
            {(suspension.spring_stiffness_rear_n_m / 1000).toFixed(0)} N/mm
          </span>
          <span className="text-[#7E8899]">MR F / R</span>
          <span className="text-right text-[#ECEFF4] tabular">
            {suspension.motion_ratio_front.toFixed(2)} / {suspension.motion_ratio_rear.toFixed(2)}
          </span>
          <span className="text-[#7E8899]">Caster / KPI</span>
          <span className="text-right text-[#ECEFF4] tabular">
            {suspension.caster_deg.toFixed(1)}° / {suspension.kpi_deg.toFixed(1)}°
          </span>
          <span className="text-[#7E8899]">Elastic LLTD</span>
          <span className="text-right text-[#DFBE78] font-semibold tabular">
            {(suspension.lltd_elastic_front * 100).toFixed(1)}% F
          </span>
        </div>
      </div>
    </div>
  );
}
