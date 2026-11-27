import React, { useEffect, useMemo, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
import { useTelemetryStore } from "../../state/telemetryStore";
import {
  KinematicsInputs,
  KinematicsSolution,
  solveSuspensionKinematics,
} from "../../services/physics/kinematicsSolver";
import { SplitPane } from "../layout/SplitPane";
import { PrecisionControl } from "../shared/PrecisionControl";
import { TelemetryCanvasChart } from "../shared/TelemetryCanvasChart";

type AxleViewMode = "FRONT" | "REAR" | "SPLIT";

const DEFAULT_INPUTS: KinematicsInputs = {
  heaveMm: 0,
  rollDeg: 0,
  pitchDeg: 0,
  rackMm: 12,
  springFrontNmm: 35,
  springRearNmm: 48,
  motionRatioFront: 0.92,
  motionRatioRear: 0.92,
  arbFrontNmRad: 4500,
  arbRearNmRad: 5500,
};

/**
 * Interactive High-DPI 2D Double-Wishbone CAD Visualizer
 * Renders TeR27 chassis pickups, upper/lower A-arms, upright, pushrod, rocker, tire contact patch,
 * Instant Center (IC) projection lines, Roll Center (RC) height/lateral migration vector, and KPI axis.
 */
function DoubleWishboneCadCanvas({
  inputs,
  sol,
  viewMode,
}: {
  inputs: KinematicsInputs;
  sol: KinematicsSolution;
  viewMode: AxleViewMode;
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
      if (w < 60 || h < 60) return;

      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.fillStyle = "#08090C";
      ctx.fillRect(0, 0, w, h);

      const drawAxle = (
        isFront: boolean,
        ox: number,
        oy: number,
        availW: number,
        availH: number
      ) => {
        ctx.save();
        ctx.beginPath();
        ctx.rect(ox, oy, availW, availH);
        ctx.clip();

        // Scale mm -> px (full view spans ~1680 mm wide, ~680 mm tall)
        const scale = Math.min(availW / 1680, availH / 640);
        const cx = ox + availW / 2;
        const groundY = oy + availH - 28;
        const toX = (yMm: number) => cx + yMm * scale;
        const toY = (zMm: number) => groundY - zMm * scale;

        // Ground plane & centerline
        ctx.strokeStyle = "rgba(255,255,255,0.16)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(ox + 10, Math.round(groundY) + 0.5);
        ctx.lineTo(ox + availW - 10, Math.round(groundY) + 0.5);
        ctx.stroke();

        ctx.save();
        ctx.strokeStyle = "rgba(255,255,255,0.06)";
        ctx.setLineDash([3, 4]);
        ctx.beginPath();
        ctx.moveTo(Math.round(cx) + 0.5, oy + 12);
        ctx.lineTo(Math.round(cx) + 0.5, groundY);
        ctx.stroke();
        ctx.restore();

        const halfTrack = isFront ? 620 : 610;
        const rollRad = (inputs.rollDeg * Math.PI) / 180;
        const pitchOffset = (isFront ? 1 : -1) * inputs.pitchDeg * 12.5;
        const chassisHeave = -inputs.heaveMm - pitchOffset;

        // Transform chassis-fixed point (y, z) with chassis heave & roll about static CG
        const cgZ = 285 + chassisHeave;
        const xformChassis = (yLocal: number, zLocal: number): [number, number] => {
          const dz = zLocal - 285;
          const yr = yLocal * Math.cos(rollRad) - dz * Math.sin(rollRad);
          const zr = yLocal * Math.sin(rollRad) + dz * Math.cos(rollRad) + cgZ;
          return [yr, zr];
        };

        // Monocoque bulkhead cross-section polygon
        const tubPts: Array<[number, number]> = [
          xformChassis(-215, 78),
          xformChassis(215, 78),
          xformChassis(205, 345),
          xformChassis(145, 420),
          xformChassis(-145, 420),
          xformChassis(-205, 345),
        ];
        ctx.fillStyle = "#12151D";
        ctx.strokeStyle = "#32384A";
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        tubPts.forEach(([y, z], i) => {
          if (i === 0) ctx.moveTo(toX(y), toY(z));
          else ctx.lineTo(toX(y), toY(z));
        });
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Draw Left (-1) and Right (+1) Suspension Assemblies
        const sides: Array<-1 | 1> = [-1, 1];
        const icPoints: Array<[number, number]> = [];

        for (const side of sides) {
          const lcaIn = xformChassis(side * 208, isFront ? 112 : 122);
          const ucaIn = xformChassis(side * 218, isFront ? 286 : 292);
          const rockerPivot = xformChassis(side * 165, 385);
          const damperIn = xformChassis(side * 75, 392);

          // Outer wheel vertical contact patch remains on ground (z=0), upright tilts with dynamic camber
          const camberDeg = isFront
            ? side === -1
              ? sol.camberFrontLeftDeg
              : sol.camberFrontRightDeg
            : side === -1
              ? sol.camberRearLeftDeg
              : sol.camberRearRightDeg;
          const cambRad = ((camberDeg * side) * Math.PI) / 180;

          const cpY = side * halfTrack;
          const wheelCenterY = cpY - Math.sin(cambRad) * 203;
          const wheelCenterZ = Math.cos(cambRad) * 203;

          const lbjY = wheelCenterY - side * 48 - Math.sin(cambRad) * -92;
          const lbjZ = wheelCenterZ - 92;
          const ubjY = wheelCenterY - side * 64 + Math.sin(cambRad) * 98;
          const ubjZ = wheelCenterZ + 98;

          // Tire section outline (Hoosier 16x7.5-10: 190 mm width, 406 mm dia)
          ctx.save();
          ctx.translate(toX(wheelCenterY), toY(wheelCenterZ));
          ctx.rotate(cambRad);
          const tireW = 190 * scale;
          const tireH = 406 * scale;
          ctx.fillStyle = "#151820";
          ctx.strokeStyle = "#475569";
          ctx.lineWidth = 1.4;
          ctx.fillRect(-tireW / 2, -tireH / 2, tireW, tireH);
          ctx.strokeRect(-tireW / 2, -tireH / 2, tireW, tireH);
          // Rim center bar
          ctx.strokeStyle = "#334155";
          ctx.beginPath();
          ctx.moveTo(0, -tireH * 0.3);
          ctx.lineTo(0, tireH * 0.3);
          ctx.stroke();
          ctx.restore();

          // Kingpin Inclination (KPI) dashed axis
          ctx.save();
          ctx.strokeStyle = "rgba(148,163,184,0.35)";
          ctx.setLineDash([2, 3]);
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(toX(ubjY), toY(ubjZ + 22));
          ctx.lineTo(toX(lbjY + (lbjY - ubjY) * 0.45), toY(0));
          ctx.stroke();
          ctx.restore();

          // Upright link (LBJ -> UBJ)
          ctx.strokeStyle = "#94A3B8";
          ctx.lineWidth = 2.6;
          ctx.beginPath();
          ctx.moveTo(toX(lbjY), toY(lbjZ));
          ctx.lineTo(toX(ubjY), toY(ubjZ));
          ctx.stroke();

          // Upper & Lower A-arms
          ctx.strokeStyle = "#ECEFF4";
          ctx.lineWidth = 2.0;
          ctx.beginPath();
          ctx.moveTo(toX(lcaIn[0]), toY(lcaIn[1]));
          ctx.lineTo(toX(lbjY), toY(lbjZ));
          ctx.moveTo(toX(ucaIn[0]), toY(ucaIn[1]));
          ctx.lineTo(toX(ubjY), toY(ubjZ));
          ctx.stroke();

          // Pushrod (from LCA outer clevis to rocker) & coilover damper
          const pushOuterY = lbjY - side * 24;
          const pushOuterZ = lbjZ + 18;
          ctx.strokeStyle = "#38BDF8";
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.moveTo(toX(pushOuterY), toY(pushOuterZ));
          ctx.lineTo(toX(rockerPivot[0]), toY(rockerPivot[1]));
          ctx.stroke();

          ctx.strokeStyle = "#C5A059";
          ctx.lineWidth = 2.1;
          ctx.beginPath();
          ctx.moveTo(toX(rockerPivot[0]), toY(rockerPivot[1]));
          ctx.lineTo(toX(damperIn[0]), toY(damperIn[1]));
          ctx.stroke();

          // Pickup & ball-joint nodes
          for (const [py, pz] of [lcaIn, ucaIn, [lbjY, lbjZ], [ubjY, ubjZ], rockerPivot]) {
            ctx.fillStyle = "#C5A059";
            ctx.beginPath();
            ctx.arc(toX(py), toY(pz), 2.8, 0, Math.PI * 2);
            ctx.fill();
          }

          // Compute 2D Instant Center intersection of UCA & LCA lines
          const mL = (lbjZ - lcaIn[1]) / (lbjY - lcaIn[0] || 1e-4);
          const mU = (ubjZ - ucaIn[1]) / (ubjY - ucaIn[0] || 1e-4);
          if (Math.abs(mU - mL) > 1e-3) {
            const yIC = (lbjZ - ubjZ + mU * ubjY - mL * lbjY) / (mU - mL);
            const zIC = lbjZ + mL * (yIC - lbjY);
            const clampedY = Math.max(-760, Math.min(760, yIC));
            const clampedZ = Math.max(-40, Math.min(520, zIC));
            icPoints.push([clampedY, clampedZ]);

            // Projection lines to IC and Contact Patch -> IC
            ctx.save();
            ctx.strokeStyle = "rgba(56, 189, 248, 0.28)";
            ctx.setLineDash([3, 3]);
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(toX(lcaIn[0]), toY(lcaIn[1]));
            ctx.lineTo(toX(clampedY), toY(clampedZ));
            ctx.moveTo(toX(ucaIn[0]), toY(ucaIn[1]));
            ctx.lineTo(toX(clampedY), toY(clampedZ));
            ctx.stroke();

            ctx.strokeStyle = "rgba(197, 160, 89, 0.35)";
            ctx.beginPath();
            ctx.moveTo(toX(cpY), toY(0));
            ctx.lineTo(toX(clampedY), toY(clampedZ));
            ctx.stroke();
            ctx.restore();
          }
        }

        // Plot Roll Center (RC) + Migration Vector from Static RC
        const rcY = isFront ? sol.frontRcYmm : sol.rearRcYmm;
        const rcZ = isFront ? sol.frontRcZmm : sol.rearRcZmm;
        const staticRcZ = isFront ? 28 : 44;

        ctx.strokeStyle = "#10B981";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(toX(0), toY(staticRcZ));
        ctx.lineTo(toX(rcY), toY(rcZ));
        ctx.stroke();

        ctx.fillStyle = "#C5A059";
        ctx.strokeStyle = "#ECEFF4";
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(toX(rcY), toY(rcZ), 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // CG Marker
        ctx.fillStyle = "#38BDF8";
        ctx.beginPath();
        ctx.arc(toX(0), toY(cgZ), 4, 0, Math.PI * 2);
        ctx.fill();

        // HUD labels
        ctx.font = '10px "JetBrains Mono", monospace';
        ctx.fillStyle = "#DFBE78";
        ctx.textAlign = "left";
        ctx.fillText(
          `${isFront ? "FRONT" : "REAR"} RC (${rcY >= 0 ? "+" : ""}${rcY.toFixed(1)}, ${rcZ.toFixed(1)} mm)`,
          ox + 10,
          oy + 16
        );
        ctx.fillStyle = "#7E8899";
        ctx.textAlign = "right";
        ctx.fillText(
          `ICs: ${icPoints.length} · Roll ${inputs.rollDeg.toFixed(1)}°`,
          ox + availW - 10,
          oy + 16
        );
        ctx.restore();
      };

      if (viewMode === "SPLIT") {
        drawAxle(true, 0, 0, w / 2, h);
        ctx.strokeStyle = "#222633";
        ctx.beginPath();
        ctx.moveTo(Math.round(w / 2) + 0.5, 0);
        ctx.lineTo(Math.round(w / 2) + 0.5, h);
        ctx.stroke();
        drawAxle(false, w / 2, 0, w / 2, h);
      } else {
        drawAxle(viewMode === "FRONT", 0, 0, w, h);
      }

      ctx.restore();
    };

    render();
    const ro = new ResizeObserver(render);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [inputs, sol, viewMode]);

  return <canvas ref={canvasRef} className="block w-full h-full" />;
}

export function SuspensionKinematicsLab() {
  const { vehicleOverview } = useTelemetryStore();
  const [inputs, setInputs] = useState<KinematicsInputs>(DEFAULT_INPUTS);
  const [viewMode, setViewMode] = useState<AxleViewMode>("FRONT");
  const [steerChartMode, setSteerChartMode] = useState<"ACKERMANN" | "BUMP_STEER">("ACKERMANN");

  const sol = useMemo(
    () => solveSuspensionKinematics(inputs, vehicleOverview?.suspension, vehicleOverview?.params),
    [inputs, vehicleOverview]
  );

  const update = <K extends keyof KinematicsInputs>(key: K, val: number) => {
    setInputs((prev) => ({ ...prev, [key]: val }));
  };

  // Plot 1: Static vs Dynamic Roll-Compensated Camber Gain
  const camberSeries = useMemo(
    () => [
      {
        id: "camber_front_dyn",
        label: "Front (Roll Comp)",
        shortLabel: "F_dyn",
        unit: "deg",
        color: "#C5A059",
        fill: true,
        decimals: 2,
        points: sol.camberSweep.map((p) => ({
          x: p.x,
          y: p.yFront + inputs.rollDeg * 0.45,
        })),
      },
      {
        id: "camber_front_static",
        label: "Front Static",
        shortLabel: "F_0",
        unit: "deg",
        color: "#ECEFF4",
        dashed: true,
        decimals: 2,
        points: sol.camberSweep.map((p) => ({ x: p.x, y: p.yFront })),
      },
      {
        id: "camber_rear",
        label: "Rear Camber",
        shortLabel: "Rear",
        unit: "deg",
        color: "#38BDF8",
        decimals: 2,
        points: sol.camberSweep.map((p) => ({ x: p.x, y: p.yRear })),
      },
    ],
    [inputs.rollDeg, sol.camberSweep]
  );

  // Plot 2: Bump Steer OR Progressive Ackermann
  const steerSeries = useMemo(() => {
    if (steerChartMode === "BUMP_STEER") {
      return [
        {
          id: "bs_f",
          label: "Front Bump Steer",
          shortLabel: "Front",
          unit: "deg",
          color: "#C5A059",
          fill: true,
          decimals: 3,
          points: sol.bumpSteerSweep.map((p) => ({ x: p.x, y: p.yFront })),
        },
        {
          id: "bs_r",
          label: "Rear Bump Steer",
          shortLabel: "Rear",
          unit: "deg",
          color: "#38BDF8",
          decimals: 3,
          points: sol.bumpSteerSweep.map((p) => ({ x: p.x, y: p.yRear })),
        },
      ];
    }
    return [
      {
        id: "ack_in",
        label: "Inner Steer",
        shortLabel: "Inner",
        unit: "deg",
        color: "#C5A059",
        fill: true,
        axis: "left" as const,
        decimals: 1,
        points: sol.ackermannSweep.map((p) => ({ x: p.rackMm, y: p.innerDeg })),
      },
      {
        id: "ack_out",
        label: "Outer Steer",
        shortLabel: "Outer",
        unit: "deg",
        color: "#38BDF8",
        axis: "left" as const,
        decimals: 1,
        points: sol.ackermannSweep.map((p) => ({ x: p.rackMm, y: p.outerDeg })),
      },
      {
        id: "ack_pct",
        label: "Ackermann %",
        shortLabel: "Ack%",
        unit: "%",
        color: "#10B981",
        dashed: true,
        axis: "right" as const,
        decimals: 1,
        points: sol.ackermannSweep.map((p) => ({ x: p.rackMm, y: p.ackermannPct })),
      },
    ];
  }, [sol.ackermannSweep, sol.bumpSteerSweep, steerChartMode]);

  // Plot 3: Roll Center Height [mm] & Lateral RC Migration [mm] across Roll sweep
  const rcSeries = useMemo(
    () => [
      {
        id: "rc_fz",
        label: "Front RC Z",
        shortLabel: "F_Z",
        unit: "mm",
        color: "#C5A059",
        fill: true,
        axis: "left" as const,
        decimals: 1,
        points: sol.frontRcMigration.map((p) => ({ x: p.rollDeg, y: p.zMm })),
      },
      {
        id: "rc_rz",
        label: "Rear RC Z",
        shortLabel: "R_Z",
        unit: "mm",
        color: "#38BDF8",
        axis: "left" as const,
        decimals: 1,
        points: sol.rearRcMigration.map((p) => ({ x: p.rollDeg, y: p.zMm })),
      },
      {
        id: "rc_fy",
        label: "Front RC Lat Y",
        shortLabel: "F_Y",
        unit: "mm",
        color: "#10B981",
        dashed: true,
        axis: "right" as const,
        decimals: 1,
        points: sol.frontRcMigration.map((p) => ({ x: p.rollDeg, y: p.yMm })),
      },
    ],
    [sol.frontRcMigration, sol.rearRcMigration]
  );

  // Plot 4: Dynamic LLTD & Motion Ratio across Roll sweep
  const lltdMrSeries = useMemo(() => {
    const lltdPts = [];
    const mrPts = [];
    for (let r = -3.0; r <= 3.01; r += 0.25) {
      const lltdPct = (sol.lltdElasticFront + Math.abs(r) * 0.0042) * 100;
      const mrEff = inputs.motionRatioFront - 0.0065 * Math.abs(r) + 0.002 * (inputs.heaveMm / 30);
      lltdPts.push({ x: r, y: lltdPct });
      mrPts.push({ x: r, y: mrEff });
    }
    return [
      {
        id: "lltd_curve",
        label: "Front LLTD",
        shortLabel: "LLTD",
        unit: "%",
        color: "#C5A059",
        fill: true,
        axis: "left" as const,
        decimals: 2,
        points: lltdPts,
      },
      {
        id: "mr_curve",
        label: "Motion Ratio",
        shortLabel: "MR",
        unit: "-",
        color: "#38BDF8",
        dashed: true,
        axis: "right" as const,
        decimals: 3,
        points: mrPts,
      },
    ];
  }, [inputs.heaveMm, inputs.motionRatioFront, sol.lltdElasticFront]);

  return (
    <div className="w-full h-full min-h-0 overflow-hidden">
      <SplitPane
        direction="horizontal"
        initialRatio={0.38}
        minRatio={0.3}
        maxRatio={0.48}
        first={
          <SplitPane
            direction="vertical"
            initialRatio={0.56}
            minRatio={0.4}
            maxRatio={0.7}
            first={
              /* Interactive 2D Double-Wishbone CAD Visualizer */
              <div className="machined-panel w-full h-full min-h-0 flex flex-col overflow-hidden">
                <div className="inst-header">
                  <span className="panel-title-label">2D Double-Wishbone CAD</span>
                  <div className="seg-track" role="group" aria-label="Axle cross section view">
                    {(["FRONT", "REAR", "SPLIT"] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        data-active={viewMode === m ? "true" : "false"}
                        onClick={() => setViewMode(m)}
                        className="seg-btn !py-0.5 !px-2 !text-[10px]"
                      >
                        {m === "SPLIT" ? "Split F+R" : m === "FRONT" ? "Front" : "Rear"}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex-1 min-h-0 relative overflow-hidden">
                  <DoubleWishboneCadCanvas inputs={inputs} sol={sol} viewMode={viewMode} />
                </div>
                <div className="h-[22px] shrink-0 px-2.5 bg-[#0F1116] border-t border-[#222633] flex items-center justify-between font-mono text-[9.5px] text-[#7E8899] tabular">
                  <span>
                    FL {sol.camberFrontLeftDeg.toFixed(2)}° · FR {sol.camberFrontRightDeg.toFixed(2)}°
                  </span>
                  <span>
                    RL {sol.camberRearLeftDeg.toFixed(2)}° · RR {sol.camberRearRightDeg.toFixed(2)}°
                  </span>
                </div>
              </div>
            }
            second={
              /* Compact Machined Kinematics & Compliance Controls */
              <div className="machined-panel w-full h-full min-h-0 flex flex-col overflow-hidden">
                <div className="inst-header">
                  <span className="panel-title-label">Attitude &amp; Compliance Controls</span>
                  <button
                    type="button"
                    onClick={() => setInputs(DEFAULT_INPUTS)}
                    className="h-[20px] px-2 rounded-[2px] bg-[#151820] border border-[#222633] text-[10px] text-[#94A3B8] hover:text-[#DFBE78] hover:border-[#C5A059]/50 flex items-center gap-1 cursor-pointer"
                  >
                    <RotateCcw className="w-2.5 h-2.5" />
                    <span>Reset</span>
                  </button>
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1.5">
                  <PrecisionControl
                    label="Heave Travel"
                    value={inputs.heaveMm}
                    min={-30}
                    max={30}
                    step={1}
                    unit="mm"
                    onChange={(v) => update("heaveMm", v)}
                  />
                  <PrecisionControl
                    label="Body Roll"
                    value={inputs.rollDeg}
                    min={-3.0}
                    max={3.0}
                    step={0.1}
                    unit="deg"
                    decimals={1}
                    onChange={(v) => update("rollDeg", v)}
                  />
                  <PrecisionControl
                    label="Body Pitch"
                    value={inputs.pitchDeg}
                    min={-2.0}
                    max={2.0}
                    step={0.1}
                    unit="deg"
                    decimals={1}
                    onChange={(v) => update("pitchDeg", v)}
                  />
                  <PrecisionControl
                    label="Steering Rack"
                    value={inputs.rackMm}
                    min={-35}
                    max={35}
                    step={1}
                    unit="mm"
                    onChange={(v) => update("rackMm", v)}
                  />
                  <div className="grid grid-cols-2 gap-1.5 pt-1 border-t border-[#222633]">
                    <PrecisionControl
                      label="Spring F"
                      value={inputs.springFrontNmm}
                      min={20}
                      max={90}
                      step={1}
                      unit="N/mm"
                      onChange={(v) => update("springFrontNmm", v)}
                    />
                    <PrecisionControl
                      label="Spring R"
                      value={inputs.springRearNmm}
                      min={25}
                      max={110}
                      step={1}
                      unit="N/mm"
                      onChange={(v) => update("springRearNmm", v)}
                    />
                    <PrecisionControl
                      label="ARB Front"
                      value={inputs.arbFrontNmRad}
                      min={0}
                      max={12000}
                      step={250}
                      unit="Nm"
                      onChange={(v) => update("arbFrontNmRad", v)}
                    />
                    <PrecisionControl
                      label="ARB Rear"
                      value={inputs.arbRearNmRad}
                      min={0}
                      max={12000}
                      step={250}
                      unit="Nm"
                      onChange={(v) => update("arbRearNmRad", v)}
                    />
                  </div>
                </div>

                {/* Live Compliance KPI Footer */}
                <div className="shrink-0 grid grid-cols-4 gap-1 p-2 bg-[#0F1116] border-t border-[#222633] font-mono text-[10px] tabular">
                  <div className="px-1.5 py-1 rounded-[2px] bg-[#151820] border border-[#222633]">
                    <div className="text-[9px] text-[#7E8899] font-sans">Wheel Rate</div>
                    <div className="text-[#ECEFF4] font-semibold">
                      {sol.wheelRateFrontNmm.toFixed(0)}/{sol.wheelRateRearNmm.toFixed(0)}
                    </div>
                  </div>
                  <div className="px-1.5 py-1 rounded-[2px] bg-[#151820] border border-[#222633]">
                    <div className="text-[9px] text-[#7E8899] font-sans">Ride Freq</div>
                    <div className="text-[#38BDF8] font-semibold">
                      {sol.rideFreqFrontHz.toFixed(2)}/{sol.rideFreqRearHz.toFixed(2)}
                    </div>
                  </div>
                  <div className="px-1.5 py-1 rounded-[2px] bg-[#151820] border border-[#222633]">
                    <div className="text-[9px] text-[#7E8899] font-sans">LLTD F</div>
                    <div className="text-[#DFBE78] font-semibold">
                      {(sol.lltdElasticFront * 100).toFixed(1)}%
                    </div>
                  </div>
                  <div className="px-1.5 py-1 rounded-[2px] bg-[#151820] border border-[#222633]">
                    <div className="text-[9px] text-[#7E8899] font-sans">Anti-D / S</div>
                    <div className="text-[#34D399] font-semibold">
                      {sol.antiDiveFrontPct.toFixed(1)}/{sol.antiSquatRearPct.toFixed(1)}
                    </div>
                  </div>
                </div>
              </div>
            }
          />
        }
        second={
          /* Right 62% — 2x2 Synchronized Kinematic Curves Matrix */
          <div className="w-full h-full min-h-0 grid grid-cols-2 grid-rows-2 gap-2 overflow-hidden">
            <TelemetryCanvasChart
              title="Camber Gain vs Wheel Travel"
              xLabel="Heave Travel (mm)"
              yLabel="Camber (deg)"
              series={camberSeries}
              xDomain={[-30, 30]}
              activeCursorX={inputs.heaveMm}
              referenceLines={[
                {
                  axis: "x",
                  value: inputs.heaveMm,
                  color: "#C5A059",
                  label: `${inputs.heaveMm}mm`,
                },
              ]}
              footerNote="Solid Gold: Dynamic Roll-Compensated · Dashed Ivory: Static SLA · Cyan: Rear"
            />

            <TelemetryCanvasChart
              title={
                steerChartMode === "ACKERMANN"
                  ? "Progressive Ackermann Geometry"
                  : "Bump Steer Toe Envelope"
              }
              xLabel={steerChartMode === "ACKERMANN" ? "Rack Travel (mm)" : "Heave Travel (mm)"}
              yLabel={steerChartMode === "ACKERMANN" ? "Wheel Steer (deg)" : "Toe (deg)"}
              yRightLabel={steerChartMode === "ACKERMANN" ? "Ack %" : undefined}
              series={steerSeries}
              xDomain={steerChartMode === "ACKERMANN" ? [0, 35] : [-30, 30]}
              yRightDomain={steerChartMode === "ACKERMANN" ? [50, 100] : undefined}
              activeCursorX={
                steerChartMode === "ACKERMANN" ? Math.abs(inputs.rackMm) : inputs.heaveMm
              }
              headerRight={
                <div className="seg-track">
                  <button
                    type="button"
                    data-active={steerChartMode === "ACKERMANN" ? "true" : "false"}
                    onClick={() => setSteerChartMode("ACKERMANN")}
                    className="seg-btn !py-0 !px-1.5 !text-[9.5px]"
                  >
                    Ackermann
                  </button>
                  <button
                    type="button"
                    data-active={steerChartMode === "BUMP_STEER" ? "true" : "false"}
                    onClick={() => setSteerChartMode("BUMP_STEER")}
                    className="seg-btn !py-0 !px-1.5 !text-[9.5px]"
                  >
                    Bump Steer
                  </button>
                </div>
              }
              footerNote={`Ackermann ${sol.ackermannPctAtRack.toFixed(1)}% · Inner ${sol.innerSteerDeg.toFixed(1)}° / Outer ${sol.outerSteerDeg.toFixed(1)}°`}
            />

            <TelemetryCanvasChart
              title="Roll Center Height & Lateral Migration"
              xLabel="Chassis Roll (deg)"
              yLabel="RC Height Z (mm)"
              yRightLabel="RC Lat Y (mm)"
              series={rcSeries}
              xDomain={[-3, 3]}
              activeCursorX={inputs.rollDeg}
              referenceLines={[
                {
                  axis: "x",
                  value: inputs.rollDeg,
                  color: "#C5A059",
                  label: `${inputs.rollDeg.toFixed(1)}°`,
                },
              ]}
              footerNote={`Front RC (${sol.frontRcYmm.toFixed(1)}, ${sol.frontRcZmm.toFixed(1)} mm) · Rear RC (${sol.rearRcYmm.toFixed(1)}, ${sol.rearRcZmm.toFixed(1)} mm)`}
            />

            <TelemetryCanvasChart
              title="Elastic LLTD & Motion Ratio"
              xLabel="Chassis Roll (deg)"
              yLabel="Front LLTD (%)"
              yRightLabel="MR (-)"
              series={lltdMrSeries}
              xDomain={[-3, 3]}
              yDomain={[35, 62]}
              yRightDomain={[0.82, 1.0]}
              activeCursorX={inputs.rollDeg}
              referenceLines={[
                {
                  axis: "x",
                  value: inputs.rollDeg,
                  color: "#C5A059",
                  label: `Active`,
                },
                {
                  axis: "y",
                  value: 44.74,
                  color: "rgba(16,185,129,0.45)",
                  label: "TeR27 Base 44.7%",
                },
              ]}
              footerNote={`Roll Gradient ${sol.rollGradientDegPerG.toFixed(2)} °/g · Kφ F ${sol.rollStiffFrontNmDeg.toFixed(0)} / R ${sol.rollStiffRearNmDeg.toFixed(0)} Nm/°`}
            />
          </div>
        }
      />
    </div>
  );
}
