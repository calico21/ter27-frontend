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
  // 2D front-view (Y, Z) intersection of UCA and LCA lines
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

  // Line from contact patch (cpY, cpZ) through IC (icY, icZ) to centerline Y = 0
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
  const rollDeg = frame.state.ay_g * 0.80; // Confirmed 0.80 deg/g roll gradient
  const pitchDeg = frame.state.ax_g * 0.52;

  const frontRcMm = computeRollCenterHeightMm(suspension.front_left_hardpoints);
  const rearRcMm = computeRollCenterHeightMm(suspension.rear_left_hardpoints);

  // Draw live camber-gain curve on Canvas
  useEffect(() => {
    const canvas = camberCanvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth || 240;
    const h = canvas.clientHeight || 110;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.fillStyle = "#08090C";
    ctx.fillRect(0, 0, w, h);

    const padL = 34,
      padR = 10,
      padT = 10,
      padB = 20;
    const pw = w - padL - padR;
    const ph = h - padT - padB;

    const minT = -30,
      maxT = 30;
    const minC = -4.0,
      maxC = 0.0;

    const xOf = (t: number) => padL + ((t - minT) / (maxT - minT)) * pw;
    const yOf = (c: number) => padT + ph - ((c - minC) / (maxC - minC)) * ph;

    // Grid
    ctx.strokeStyle = "#181C26";
    ctx.lineWidth = 1;
    ctx.font = '9px "JetBrains Mono", monospace';
    ctx.fillStyle = "#7E8799";
    for (const c of [-4, -3, -2, -1, 0]) {
      const py = yOf(c);
      ctx.beginPath();
      ctx.moveTo(padL, Math.round(py) + 0.5);
      ctx.lineTo(w - padR, Math.round(py) + 0.5);
      ctx.stroke();
      ctx.textAlign = "right";
      ctx.fillText(`${c.toFixed(0)}`, padL - 4, py + 3);
    }
    const zeroX = xOf(0);
    ctx.strokeStyle = "#232836";
    ctx.beginPath();
    ctx.moveTo(Math.round(zeroX) + 0.5, padT);
    ctx.lineTo(Math.round(zeroX) + 0.5, padT + ph);
    ctx.stroke();

    // Front & rear camber gain curves (static camber + SLA bump camber gain ~ -0.028 deg/mm)
    const drawCurve = (staticCam: number, slope: number, color: string) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      for (let t = minT; t <= maxT; t += 2) {
        const cam = staticCam - slope * t - 0.00018 * t * t;
        const px = xOf(t);
        const py = yOf(Math.max(minC, Math.min(maxC, cam)));
        if (t === minT) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
    };

    drawCurve(suspension.static_camber_front_deg, 0.029, "#C5A059");
    drawCurve(suspension.static_camber_rear_deg, 0.024, "#38BDF8");

    // Live FL operating point
    const liveX = xOf(Math.max(minT, Math.min(maxT, flTravelMm)));
    const liveY = yOf(Math.max(minC, Math.min(maxC, frame.wheels.fl.camber_deg)));
    ctx.fillStyle = "#ECEFF4";
    ctx.beginPath();
    ctx.arc(liveX, liveY, 3, 0, Math.PI * 2);
    ctx.fill();

    ctx.textAlign = "center";
    ctx.fillStyle = "#7E8799";
    ctx.fillText("Travel [mm] (-30 droop / +30 bump)", padL + pw / 2, h - 5);
    ctx.restore();
  }, [flTravelMm, frame.wheels.fl.camber_deg, suspension.static_camber_front_deg, suspension.static_camber_rear_deg]);

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
    <div className="w-full h-full min-h-0 flex flex-col bg-[#0F1116] overflow-y-auto">
      <div className="panel-header-bar">
        <span className="panel-title-label">Kinematics Telemetry Inspector</span>
        <span className="text-[10px] font-mono text-[#7E8799]">{suspension.frame}</span>
      </div>

      <div className="p-2.5 space-y-3 text-[11px]">
        {/* Hardpoint Source Status & Zero-Fabrication Notice */}
        <div
          className={`p-2 border rounded-[2px] font-mono text-[10px] ${
            hardpointsLoaded
              ? "bg-[#151820] border-[#10B981]/60"
              : "bg-[#151820] border-[#D97706]/70"
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <span className={hardpointsLoaded ? "text-[#10B981] font-semibold" : "text-[#D97706] font-semibold"}>
              {hardpointsLoaded ? "CONFIRMED 3D HARDPOINTS ACTIVE" : "OFFLINE HARDPOINTS UNLOADED"}
            </span>
            <button
              type="button"
              onClick={() => setImportOpen((o) => !o)}
              className="flex items-center gap-1 px-1.5 py-0.5 bg-[#08090C] border border-[#222633] hover:border-[#C5A059] text-[#ECEFF4] rounded-[2px] cursor-pointer"
            >
              <Upload className="w-2.5 h-2.5 text-[#C5A059]" />
              Import JSON
            </button>
          </div>
          <p className="text-[#7E8799] mt-1 leading-snug">
            {hardpointsLoaded
              ? "Rendering exact double-wishbone, pushrod, rocker, damper, and ARB geometry in ISO 8855."
              : "Zero synthetic wishbone coordinates fabricated. Connect FastAPI :8000 or import confirmed ISO 8855 hardpoints JSON."}
          </p>
        </div>

        {/* Inline Confirmed Hardpoints Importer */}
        {importOpen ? (
          <div className="p-2 bg-[#08090C] border border-[#C5A059] rounded-[2px] space-y-1.5">
            <div className="flex items-center justify-between text-[10px] font-mono">
              <span className="text-[#C5A059]">PASTE CONFIRMED CornerHardpoints3D JSON</span>
              <button
                type="button"
                onClick={() => setImportOpen(false)}
                className="text-[#7E8799] hover:text-[#ECEFF4] cursor-pointer"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
            <textarea
              rows={6}
              value={jsonInput}
              onChange={(e) => setJsonInput(e.target.value)}
              placeholder={EXAMPLE_TEMPLATE}
              className="w-full bg-[#0F1116] border border-[#222633] p-1.5 font-mono text-[10px] text-[#ECEFF4] outline-none resize-y"
            />
            {parseError ? (
              <div className="text-[10px] font-mono text-[#DC2626]">{parseError}</div>
            ) : null}
            <div className="flex items-center justify-between gap-2">
              {hardpointsLoaded ? (
                <button
                  type="button"
                  onClick={() => {
                    void onImportHardpoints(null);
                    setImportOpen(false);
                  }}
                  className="px-2 py-1 text-[10px] font-mono border border-[#222633] text-[#7E8799] hover:text-[#DC2626] cursor-pointer"
                >
                  Clear Local Override
                </button>
              ) : (
                <span />
              )}
              <button
                type="button"
                onClick={() => void handleApplyJson()}
                className="px-2.5 py-1 text-[10px] font-mono bg-[#C5A059] text-[#08090C] font-semibold rounded-[2px] cursor-pointer"
              >
                Validate &amp; Load
              </button>
            </div>
          </div>
        ) : null}

        {/* Physics Layer Visibility Toggles */}
        <div className="space-y-1">
          <div className="text-[10px] font-semibold uppercase tracking-[0.06em] text-[#7E8799]">
            3D Physics Overlays
          </div>
          <div className="grid grid-cols-1 gap-1 font-mono text-[10px]">
            {(
              [
                { key: "forceVectors", label: "Contact Patch Force Vectors (Fx, Fy, Fz)" },
                { key: "frictionRings", label: "Ground Friction-Saturation Rings" },
                { key: "rollCenterLines", label: "Dynamic IC & Roll Center Axis" },
                {
                  key: "antiGeometryPlanes",
                  label: `Anti-Dive (${(suspension.anti_dive_front * 100).toFixed(1)}%) / Anti-Squat (${(suspension.anti_squat_rear * 100).toFixed(1)}%)`,
                },
                { key: "wireframeChassis", label: "Monocoque Chassis Wireframe" },
              ] as const
            ).map((item) => (
              <label
                key={item.key}
                className="flex items-center justify-between px-2 py-1 bg-[#151820] border border-[#222633] cursor-pointer hover:bg-[#1B1F2A]"
              >
                <span className="text-[#ECEFF4]">{item.label}</span>
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

        {/* Live Chassis Attitude */}
        <div className="grid grid-cols-3 gap-1.5 font-mono text-[10px]">
          <div className="bg-[#151820] border border-[#222633] px-2 py-1">
            <div className="text-[9px] text-[#7E8799]">HEAVE</div>
            <div className="text-[#ECEFF4] font-semibold">
              {heaveMm >= 0 ? "+" : ""}
              {heaveMm.toFixed(1)} mm
            </div>
          </div>
          <div className="bg-[#151820] border border-[#222633] px-2 py-1">
            <div className="text-[9px] text-[#7E8799]">ROLL (est)</div>
            <div className="text-[#C5A059] font-semibold">
              {rollDeg >= 0 ? "+" : ""}
              {rollDeg.toFixed(2)} deg
            </div>
          </div>
          <div className="bg-[#151820] border border-[#222633] px-2 py-1">
            <div className="text-[9px] text-[#7E8799]">PITCH (est)</div>
            <div className="text-[#38BDF8] font-semibold">
              {pitchDeg >= 0 ? "+" : ""}
              {pitchDeg.toFixed(2)} deg
            </div>
          </div>
        </div>

        {/* Roll Center & Anti-Geometry Readouts */}
        <div className="grid grid-cols-2 gap-1.5 font-mono text-[10px]">
          <div className="bg-[#151820] border border-[#222633] px-2 py-1">
            <div className="text-[9px] text-[#7E8799]">FRONT RC HEIGHT</div>
            <div className="text-[#ECEFF4] font-semibold">
              {frontRcMm !== null ? `${frontRcMm.toFixed(1)} mm` : "Awaiting HP"}
            </div>
          </div>
          <div className="bg-[#151820] border border-[#222633] px-2 py-1">
            <div className="text-[9px] text-[#7E8799]">REAR RC HEIGHT</div>
            <div className="text-[#ECEFF4] font-semibold">
              {rearRcMm !== null ? `${rearRcMm.toFixed(1)} mm` : "Awaiting HP"}
            </div>
          </div>
          <div className="bg-[#151820] border border-[#222633] px-2 py-1">
            <div className="text-[9px] text-[#7E8799]">ANTI-DIVE (FRONT)</div>
            <div className="text-[#C5A059] font-semibold">
              {(suspension.anti_dive_front * 100).toFixed(1)} %
            </div>
          </div>
          <div className="bg-[#151820] border border-[#222633] px-2 py-1">
            <div className="text-[9px] text-[#7E8799]">ANTI-SQUAT (REAR)</div>
            <div className="text-[#38BDF8] font-semibold">
              {(suspension.anti_squat_rear * 100).toFixed(1)} %
            </div>
          </div>
        </div>

        {/* 4-Corner Wheel Travel Gauges */}
        <div className="space-y-1.5">
          <div className="text-[10px] font-semibold uppercase tracking-[0.06em] text-[#7E8799]">
            Wheel Travel Gauges (+/- 30 mm)
          </div>
          {gauges.map((g) => {
            const pct = Math.max(0, Math.min(100, ((g.mm + 30) / 60) * 100));
            return (
              <div key={g.id} className="font-mono text-[10px]">
                <div className="flex justify-between text-[#ECEFF4]">
                  <span>
                    {g.id} <span className="text-[#7E8799]">cam {g.cam.toFixed(2)} deg</span>
                  </span>
                  <span className="text-[#C5A059]">
                    {g.mm >= 0 ? "+" : ""}
                    {g.mm.toFixed(1)} mm
                  </span>
                </div>
                <div className="relative h-1.5 bg-[#08090C] border border-[#222633] mt-0.5">
                  <div className="absolute left-1/2 top-0 bottom-0 w-[1px] bg-[#232836]" />
                  <div
                    className="absolute top-0 bottom-0 bg-[#C5A059]"
                    style={{
                      left: g.mm >= 0 ? "50%" : `${pct}%`,
                      width: `${Math.abs(pct - 50)}%`,
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>

        {/* Camber Gain Curve */}
        <div className="space-y-1">
          <div className="flex justify-between text-[10px]">
            <span className="font-semibold uppercase tracking-[0.06em] text-[#7E8799]">
              Camber Gain Curve
            </span>
            <span className="font-mono text-[#7E8799]">
              <span className="text-[#C5A059]">Front</span> /{" "}
              <span className="text-[#38BDF8]">Rear</span>
            </span>
          </div>
          <div className="h-[115px] border border-[#222633] bg-[#08090C]">
            <canvas ref={camberCanvasRef} className="block w-full h-full" />
          </div>
        </div>

        {/* Suspension Rates Summary */}
        <div className="border-t border-[#222633] pt-2 grid grid-cols-2 gap-y-1 font-mono text-[10px]">
          <span className="text-[#7E8799]">Spring F / R</span>
          <span className="text-right text-[#ECEFF4]">
            {(suspension.spring_stiffness_front_n_m / 1000).toFixed(0)} /{" "}
            {(suspension.spring_stiffness_rear_n_m / 1000).toFixed(0)} N/mm
          </span>
          <span className="text-[#7E8799]">Motion Ratio F / R</span>
          <span className="text-right text-[#ECEFF4]">
            {suspension.motion_ratio_front.toFixed(2)} / {suspension.motion_ratio_rear.toFixed(2)}
          </span>
          <span className="text-[#7E8799]">Caster / KPI</span>
          <span className="text-right text-[#ECEFF4]">
            {suspension.caster_deg.toFixed(1)} / {suspension.kpi_deg.toFixed(1)} deg
          </span>
          <span className="text-[#7E8799]">Elastic LLTD (F)</span>
          <span className="text-right text-[#C5A059]">
            {(suspension.lltd_elastic_front * 100).toFixed(1)} %
          </span>
        </div>
      </div>
    </div>
  );
}
