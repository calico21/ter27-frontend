import React, { useEffect, useRef, useState } from "react";
import { Upload, X } from "lucide-react";
import type { CornerHardpoints3D, SuspensionOverview, TelemetryFrame } from "../../types";
import {
  ConfirmedHardpointsOverride,
  hasNonZeroHardpoints,
} from "../../services/apiClient";

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
  layers,
  onToggleLayer,
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

  // Polished Camber Gain Canvas
  useEffect(() => {
    const canvas = camberCanvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth || 260;
    const h = canvas.clientHeight || 124;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.fillStyle = "#0B0D12";
    ctx.fillRect(0, 0, w, h);

    const padL = 34,
      padR = 12,
      padT = 12,
      padB = 22;
    const pw = w - padL - padR;
    const ph = h - padT - padB;

    const minT = -30,
      maxT = 30;
    const minC = -4.0,
      maxC = 0.0;

    const xOf = (t: number) => padL + ((t - minT) / (maxT - minT)) * pw;
    const yOf = (c: number) => padT + ph - ((c - minC) / (maxC - minC)) * ph;

    ctx.font = '9.5px "JetBrains Mono", monospace';
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
      ctx.fillText(`${c}°`, padL - 6, py + 3);
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

    drawCurve(suspension.static_camber_front_deg, 0.029, "#DFBE78", true);
    drawCurve(suspension.static_camber_rear_deg, 0.024, "#38BDF8", false);

    // Live FL operating point
    const liveX = xOf(Math.max(minT, Math.min(maxT, flTravelMm)));
    const liveY = yOf(Math.max(minC, Math.min(maxC, frame.wheels.fl.camber_deg)));
    ctx.strokeStyle = "#DFBE78";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(liveX, liveY, 5.5, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = "#F1F5F9";
    ctx.beginPath();
    ctx.arc(liveX, liveY, 2.8, 0, Math.PI * 2);
    ctx.fill();

    ctx.textAlign = "center";
    ctx.fillStyle = "#64748B";
    ctx.fillText("Wheel Travel (mm) · -30 Droop to +30 Bump", padL + pw / 2, h - 6);
    ctx.restore();
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
        setParseError("JSON must include front_left_hardpoints and rear_left_hardpoints objects.");
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

  const gauges = [
    { id: "FL", mm: flTravelMm, cam: frame.wheels.fl.camber_deg },
    { id: "FR", mm: frTravelMm, cam: frame.wheels.fr.camber_deg },
    { id: "RL", mm: rlTravelMm, cam: frame.wheels.rl.camber_deg },
    { id: "RR", mm: rrTravelMm, cam: frame.wheels.rr.camber_deg },
  ];

  return (
    <div className="machined-panel w-full h-full min-h-0 flex flex-col overflow-hidden">
      <div className="panel-header-bar">
        <span className="panel-title-label">Kinematics Inspector</span>
        <span className="status-pill status-pill-muted font-mono text-[10px]">
          {suspension.frame}
        </span>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-3.5 space-y-4 text-[11.5px]">
        {/* Hardpoint Source Provenance Card */}
        <div className="machined-card p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span
              className={`status-pill text-[10.5px] ${
                hardpointsLoaded ? "status-pill-nominal" : "status-pill-caution"
              }`}
            >
              {hardpointsLoaded ? "Confirmed Hardpoints" : "Hardpoints Unloaded"}
            </span>
            <button
              type="button"
              onClick={() => setImportOpen((o) => !o)}
              className="flex items-center gap-1.5 h-[26px] px-2.5 rounded-[5px] bg-[#0B0D12] border border-white/[0.08] hover:border-[#C5A059]/45 text-[11px] font-medium text-[#E2E8F0] hover:text-[#DFBE78] cursor-pointer transition-colors"
            >
              <Upload className="w-3 h-3 text-[#DFBE78]" />
              Import JSON
            </button>
          </div>
          <p className="text-[11px] text-[#94A3B8] m-0 leading-relaxed">
            {hardpointsLoaded
              ? "Rendering verified double-wishbone, pushrod, rocker, damper, and ARB geometry in ISO 8855."
              : "Zero synthetic wishbone coordinates fabricated. Connect FastAPI :8000 or import confirmed ISO 8855 hardpoints JSON."}
          </p>
        </div>

        {/* Inline Confirmed Hardpoints Importer */}
        {importOpen ? (
          <div className="machined-well p-3 border-[#C5A059]/45 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-[#DFBE78]">
                Paste Confirmed CornerHardpoints3D JSON
              </span>
              <button
                type="button"
                onClick={() => setImportOpen(false)}
                className="text-[#94A3B8] hover:text-[#F1F5F9] cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <textarea
              rows={6}
              value={jsonInput}
              onChange={(e) => setJsonInput(e.target.value)}
              placeholder={EXAMPLE_TEMPLATE}
              className="w-full bg-[#11141B] border border-white/[0.08] rounded-[5px] p-2 font-mono text-[10px] text-[#F1F5F9] outline-none resize-y focus:border-[#C5A059]/60"
            />
            {parseError ? (
              <div className="text-[10.5px] text-[#F87171]">{parseError}</div>
            ) : null}
            <div className="flex items-center justify-between gap-2">
              {hardpointsLoaded ? (
                <button
                  type="button"
                  onClick={() => {
                    void onImportHardpoints(null);
                    setImportOpen(false);
                  }}
                  className="px-2.5 py-1 text-[11px] rounded-[5px] border border-white/[0.08] text-[#94A3B8] hover:text-[#F87171] cursor-pointer"
                >
                  Clear Local Override
                </button>
              ) : (
                <span />
              )}
              <button
                type="button"
                onClick={() => void handleApplyJson()}
                className="px-3 py-1 text-[11px] rounded-[5px] bg-[#C5A059] hover:bg-[#DFBE78] text-[#07080B] font-semibold cursor-pointer transition-colors"
              >
                Validate &amp; Load
              </button>
            </div>
          </div>
        ) : null}

        {/* Live Sprung Attitude */}
        <div className="space-y-1.5">
          <div className="text-[11px] font-semibold text-[#CBD5E1]">Sprung Mass Attitude</div>
          <div className="grid grid-cols-3 gap-2">
            <div className="machined-card px-2.5 py-2">
              <div className="text-[10px] text-[#94A3B8]">Heave</div>
              <div className="font-mono text-[12px] font-semibold text-[#F1F5F9] tabular mt-0.5">
                {heaveMm >= 0 ? "+" : ""}
                {heaveMm.toFixed(1)} mm
              </div>
            </div>
            <div className="machined-card px-2.5 py-2">
              <div className="text-[10px] text-[#94A3B8]">Roll (est)</div>
              <div className="font-mono text-[12px] font-semibold text-[#DFBE78] tabular mt-0.5">
                {rollDeg >= 0 ? "+" : ""}
                {rollDeg.toFixed(2)}°
              </div>
            </div>
            <div className="machined-card px-2.5 py-2">
              <div className="text-[10px] text-[#94A3B8]">Pitch (est)</div>
              <div className="font-mono text-[12px] font-semibold text-[#38BDF8] tabular mt-0.5">
                {pitchDeg >= 0 ? "+" : ""}
                {pitchDeg.toFixed(2)}°
              </div>
            </div>
          </div>
        </div>

        {/* Roll Centers & Anti-Geometry */}
        <div className="grid grid-cols-2 gap-2">
          <div className="machined-card px-2.5 py-2">
            <div className="text-[10px] text-[#94A3B8]">Front RC Height</div>
            <div className="font-mono text-[12px] font-semibold text-[#F1F5F9] tabular mt-0.5">
              {frontRcMm !== null ? `${frontRcMm.toFixed(1)} mm` : "Awaiting HP"}
            </div>
          </div>
          <div className="machined-card px-2.5 py-2">
            <div className="text-[10px] text-[#94A3B8]">Rear RC Height</div>
            <div className="font-mono text-[12px] font-semibold text-[#F1F5F9] tabular mt-0.5">
              {rearRcMm !== null ? `${rearRcMm.toFixed(1)} mm` : "Awaiting HP"}
            </div>
          </div>
          <div className="machined-card px-2.5 py-2">
            <div className="text-[10px] text-[#94A3B8]">Front Anti-Dive</div>
            <div className="font-mono text-[12px] font-semibold text-[#DFBE78] tabular mt-0.5">
              {(suspension.anti_dive_front * 100).toFixed(1)}%
            </div>
          </div>
          <div className="machined-card px-2.5 py-2">
            <div className="text-[10px] text-[#94A3B8]">Rear Anti-Squat</div>
            <div className="font-mono text-[12px] font-semibold text-[#38BDF8] tabular mt-0.5">
              {(suspension.anti_squat_rear * 100).toFixed(1)}%
            </div>
          </div>
        </div>

        {/* Wheel Travel Gauges */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-[#CBD5E1]">Wheel Travel Gauges</span>
            <span className="font-mono text-[10px] text-[#64748B]">±30 mm</span>
          </div>
          <div className="space-y-2">
            {gauges.map((g) => {
              const pct = Math.max(0, Math.min(100, ((g.mm + 30) / 60) * 100));
              return (
                <div key={g.id} className="space-y-1">
                  <div className="flex justify-between text-[10.5px]">
                    <span className="text-[#E2E8F0] font-medium">
                      {g.id}{" "}
                      <span className="font-mono text-[10px] text-[#94A3B8]">
                        cam {g.cam.toFixed(2)}°
                      </span>
                    </span>
                    <span className="font-mono text-[#DFBE78] tabular">
                      {g.mm >= 0 ? "+" : ""}
                      {g.mm.toFixed(1)} mm
                    </span>
                  </div>
                  <div className="relative h-1.5 rounded-full bg-[#0B0D12] overflow-hidden">
                    <div
                      className="absolute top-0 bottom-0 rounded-full bg-[#C5A059]"
                      style={{
                        left: g.mm >= 0 ? "50%" : `${pct}%`,
                        width: `${Math.abs(pct - 50)}%`,
                      }}
                    />
                    <div className="absolute left-1/2 top-0 bottom-0 w-[1.5px] bg-white/30" />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Camber Gain Curve */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-[#CBD5E1]">Camber Gain Curve</span>
            <span className="text-[10.5px] text-[#94A3B8]">
              <span className="text-[#DFBE78]">Front</span> ·{" "}
              <span className="text-[#38BDF8]">Rear</span>
            </span>
          </div>
          <div className="machined-well h-[126px] overflow-hidden">
            <canvas ref={camberCanvasRef} className="block w-full h-full" />
          </div>
        </div>

        {/* Physics Layer Checklist */}
        <div className="space-y-1.5">
          <div className="text-[11px] font-semibold text-[#CBD5E1]">3D Physics Overlays</div>
          <div className="space-y-1">
            {(
              [
                { key: "forceVectors", label: "Contact Patch Force Vectors (Fx, Fy, Fz)" },
                { key: "frictionRings", label: "Ground Friction-Saturation Rings" },
                { key: "rollCenterLines", label: "Dynamic IC & Roll Center Axis" },
                {
                  key: "antiGeometryPlanes",
                  label: `Anti-Dive (${(suspension.anti_dive_front * 100).toFixed(1)}%) & Anti-Squat (${(suspension.anti_squat_rear * 100).toFixed(1)}%)`,
                },
                { key: "wireframeChassis", label: "Monocoque Chassis Wireframe" },
              ] as const
            ).map((item) => (
              <label
                key={item.key}
                className="machined-card flex items-center justify-between px-2.5 py-1.5 cursor-pointer hover:bg-[#1C2230] transition-colors text-[11px]"
              >
                <span className="text-[#E2E8F0]">{item.label}</span>
                <input
                  type="checkbox"
                  checked={layers[item.key]}
                  onChange={() => onToggleLayer(item.key)}
                  className="accent-[#C5A059]"
                />
              </label>
            ))}
          </div>
        </div>

        {/* Suspension Rates Specification Table */}
        <div className="pt-3 border-t border-white/[0.06] grid grid-cols-2 gap-y-1.5 text-[11px]">
          <span className="text-[#94A3B8]">Spring Rates (F / R)</span>
          <span className="text-right font-mono text-[#F1F5F9] tabular">
            {(suspension.spring_stiffness_front_n_m / 1000).toFixed(0)} /{" "}
            {(suspension.spring_stiffness_rear_n_m / 1000).toFixed(0)} N/mm
          </span>
          <span className="text-[#94A3B8]">Motion Ratios (F / R)</span>
          <span className="text-right font-mono text-[#F1F5F9] tabular">
            {suspension.motion_ratio_front.toFixed(2)} / {suspension.motion_ratio_rear.toFixed(2)}
          </span>
          <span className="text-[#94A3B8]">Caster / KPI</span>
          <span className="text-right font-mono text-[#F1F5F9] tabular">
            {suspension.caster_deg.toFixed(1)}° / {suspension.kpi_deg.toFixed(1)}°
          </span>
          <span className="text-[#94A3B8]">Elastic Front LLTD</span>
          <span className="text-right font-mono font-semibold text-[#DFBE78] tabular">
            {(suspension.lltd_elastic_front * 100).toFixed(1)}%
          </span>
        </div>
      </div>
    </div>
  );
}
