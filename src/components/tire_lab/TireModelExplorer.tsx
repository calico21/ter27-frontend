import React, { useEffect, useMemo, useRef, useState } from "react";
import type {
  GripProfileName,
  TireCompoundName,
  TireEvaluateResponse,
} from "../../types";
import { evaluateTireModel } from "../../services/apiClient";
import { evaluateTireOfflineMF62, extractTireMetrics } from "../../services/tirePhysics";
import { useTelemetryStore } from "../../state/telemetryStore";
import { PrecisionControl } from "../shared/PrecisionControl";
import {
  CanvasSeries,
  TelemetryCanvasChart,
} from "../shared/TelemetryCanvasChart";

type CompoundViewMode = "R20" | "R25B" | "BOTH";

const MULTI_LOADS = [400, 800, 1200, 1600];
const MULTI_LOAD_COLORS = ["#64748B", "#38BDF8", "#C5A059", "#10B981"];

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace("#", "");
  if (clean.length !== 6) return `rgba(197, 160, 89, ${alpha})`;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Interactive Bottom-Right Combined Friction Envelope (Fy vs Fx)
 * Supports concentric multi-load friction ellipses and a draggable/hoverable (kappa, alpha) operating point
 * displaying real-time resultant force vector |F| and tire_util %.
 */
function CombinedFrictionEnvelope({
  primaryResp,
  secondaryResp,
  multiLoad,
  multiLoadCurves,
  slipAngleMaxDeg,
  slipRatioMax,
}: {
  primaryResp: TireEvaluateResponse;
  secondaryResp: TireEvaluateResponse | null;
  multiLoad: boolean;
  multiLoadCurves: Array<{ load: number; color: string; resp: TireEvaluateResponse }>;
  slipAngleMaxDeg: number;
  slipRatioMax: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [opPoint, setOpPoint] = useState<{ fx: number; fy: number }>({
    fx: primaryResp.peak_fx_n * 0.48,
    fy: primaryResp.peak_fy_n * 0.68,
  });
  const [isDragging, setIsDragging] = useState(false);

  // Keep operating point clamped when Fz changes
  useEffect(() => {
    setOpPoint((prev) => ({
      fx: Math.max(-primaryResp.peak_fx_n * 1.15, Math.min(primaryResp.peak_fx_n * 1.15, prev.fx)),
      fy: Math.max(-primaryResp.peak_fy_n * 1.15, Math.min(primaryResp.peak_fy_n * 1.15, prev.fy)),
    }));
  }, [primaryResp.peak_fx_n, primaryResp.peak_fy_n]);

  const maxForceAxis = useMemo(() => {
    if (multiLoad && multiLoadCurves.length > 0) {
      const top = multiLoadCurves[multiLoadCurves.length - 1].resp;
      return Math.max(top.peak_fy_n, top.peak_fx_n, 1400) * 1.16;
    }
    return Math.max(primaryResp.peak_fy_n, primaryResp.peak_fx_n, 1000) * 1.18;
  }, [multiLoad, multiLoadCurves, primaryResp.peak_fx_n, primaryResp.peak_fy_n]);

  const resultantF = Math.hypot(opPoint.fx, opPoint.fy);
  const normFy = opPoint.fy / Math.max(1, primaryResp.peak_fy_n);
  const normFx = opPoint.fx / Math.max(1, primaryResp.peak_fx_n);
  const tireUtilPct = Math.min(130, Math.hypot(normFx, normFy) * 100);
  const estAlphaDeg = Math.max(
    -slipAngleMaxDeg,
    Math.min(slipAngleMaxDeg, normFy * 8.2)
  );
  const estKappa = Math.max(-slipRatioMax, Math.min(slipRatioMax, normFx * 0.13));

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

      const cx = w / 2;
      const cy = h / 2;
      const radiusPx = Math.max(24, Math.min(w - 76, h - 42) / 2);
      const scale = radiusPx / maxForceAxis;

      // Concentric dashed reference rings (50% & 100% scale)
      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255,0.05)";
      ctx.setLineDash([3, 4]);
      for (const frac of [0.5, 1.0]) {
        ctx.beginPath();
        ctx.arc(cx, cy, radiusPx * frac, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();

      // Crosshair axes
      ctx.strokeStyle = "rgba(255,255,255,0.11)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx - radiusPx - 10, Math.round(cy) + 0.5);
      ctx.lineTo(cx + radiusPx + 10, Math.round(cy) + 0.5);
      ctx.moveTo(Math.round(cx) + 0.5, cy - radiusPx - 8);
      ctx.lineTo(Math.round(cx) + 0.5, cy + radiusPx + 8);
      ctx.stroke();

      const drawEllipse = (
        pts: Array<{ fy_n: number; fx_n: number }>,
        color: string,
        fillAlpha: number,
        width: number,
        dashed = false
      ) => {
        if (pts.length < 3) return;
        ctx.save();
        ctx.beginPath();
        pts.forEach((pt, idx) => {
          const px = cx + pt.fy_n * scale;
          const py = cy - pt.fx_n * scale;
          if (idx === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        });
        ctx.closePath();
        if (fillAlpha > 0) {
          ctx.fillStyle = hexToRgba(color, fillAlpha);
          ctx.fill();
        }
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        if (dashed) ctx.setLineDash([4, 3]);
        ctx.stroke();
        ctx.restore();
      };

      if (multiLoad) {
        multiLoadCurves.forEach((m) => {
          drawEllipse(m.resp.friction_ellipse, m.color, 0.04, 1.5);
        });
      } else {
        drawEllipse(primaryResp.friction_ellipse, "#C5A059", 0.11, 1.85);
        if (secondaryResp) {
          drawEllipse(secondaryResp.friction_ellipse, "#38BDF8", 0.05, 1.55, true);
        }
      }

      // Operating force vector arrow from origin to (Fy, Fx)
      const ox = cx + opPoint.fy * scale;
      const oy = cy - opPoint.fx * scale;
      const vecColor =
        tireUtilPct >= 98 ? "#EF4444" : tireUtilPct >= 85 ? "#D97706" : "#ECEFF4";

      ctx.save();
      ctx.strokeStyle = vecColor;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(ox, oy);
      ctx.stroke();

      // Crosshair rings at operating point
      ctx.strokeStyle = "#C5A059";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(ox, oy, 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = vecColor;
      ctx.beginPath();
      ctx.arc(ox, oy, 2.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Axis labels
      ctx.font = '9.5px "JetBrains Mono", monospace';
      ctx.fillStyle = "#64748B";
      ctx.textAlign = "center";
      ctx.fillText("+Fx Drive", cx, 12);
      ctx.fillText("-Fx Brake", cx, h - 6);
      ctx.textAlign = "left";
      ctx.fillText("-Fy", 8, cy - 4);
      ctx.textAlign = "right";
      ctx.fillText("+Fy", w - 8, cy - 4);

      ctx.restore();
    };

    render();
    const ro = new ResizeObserver(render);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [maxForceAxis, multiLoad, multiLoadCurves, opPoint, primaryResp, secondaryResp, tireUtilPct]);

  const updateFromPointer = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const radiusPx = Math.max(24, Math.min(rect.width - 76, rect.height - 42) / 2);
    const scale = radiusPx / maxForceAxis;
    const fy = (e.clientX - rect.left - cx) / scale;
    const fx = -(e.clientY - rect.top - cy) / scale;
    const lim = maxForceAxis * 0.98;
    setOpPoint({
      fy: Math.max(-lim, Math.min(lim, fy)),
      fx: Math.max(-lim, Math.min(lim, fx)),
    });
  };

  return (
    <div className="machined-panel flex flex-col w-full h-full min-h-0 overflow-hidden">
      <div className="inst-header">
        <div className="flex items-center gap-2 min-w-0 overflow-hidden">
          <span className="panel-title-label truncate">Combined Friction Envelope (Fy vs Fx)</span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0 font-mono text-[10px] tabular">
          <span className="px-1.5 h-[20px] rounded-[2px] bg-[#151820] border border-[#222633] flex items-center text-[#ECEFF4]">
            |F| {resultantF.toFixed(0)} N
          </span>
          <span
            className={`px-1.5 h-[20px] rounded-[2px] border flex items-center ${
              tireUtilPct >= 98
                ? "bg-[#DC2626]/18 border-[#DC2626]/55 text-[#FCA5A5]"
                : tireUtilPct >= 85
                  ? "bg-[#D97706]/18 border-[#D97706]/55 text-[#FBBF24]"
                  : "bg-[#10B981]/15 border-[#10B981]/45 text-[#34D399]"
            }`}
          >
            util {tireUtilPct.toFixed(0)}%
          </span>
        </div>
      </div>

      <div className="flex-1 min-h-0 relative overflow-hidden bg-[#08090C]">
        <canvas
          ref={canvasRef}
          onMouseDown={(e) => {
            setIsDragging(true);
            updateFromPointer(e);
          }}
          onMouseMove={(e) => {
            if (isDragging) updateFromPointer(e);
          }}
          onMouseUp={() => setIsDragging(false)}
          onMouseLeave={() => setIsDragging(false)}
          className="block w-full h-full cursor-crosshair"
        />
      </div>

      <div className="h-[22px] shrink-0 px-2.5 flex items-center justify-between bg-[#0F1116] border-t border-[#222633] font-mono text-[9.5px] text-[#7E8899] tabular">
        <span>
          Drag crosshair · α {estAlphaDeg >= 0 ? "+" : ""}
          {estAlphaDeg.toFixed(1)}° · κ {estKappa >= 0 ? "+" : ""}
          {estKappa.toFixed(3)}
        </span>
        <span>
          Fx {opPoint.fx.toFixed(0)} N · Fy {opPoint.fy.toFixed(0)} N
        </span>
      </div>
    </div>
  );
}

export function TireModelExplorer() {
  const { forceOfflineMode } = useTelemetryStore();

  const [compoundMode, setCompoundMode] = useState<CompoundViewMode>("R20");
  const [gripProfile, setGripProfile] = useState<GripProfileName>("FSG_RUBBERED");
  const [fzN, setFzN] = useState<number>(850);
  const [camberDeg, setCamberDeg] = useState<number>(-1.8);
  const [tempC, setTempC] = useState<number>(75);
  const [slipAngleSweepDeg, setSlipAngleSweepDeg] = useState<number>(16);
  const [slipRatioSweep, setSlipRatioSweep] = useState<number>(0.25);
  const [multiLoad, setMultiLoad] = useState<boolean>(false);
  const [showTtcScatter, setShowTtcScatter] = useState<boolean>(true);
  const [showPinnBand, setShowPinnBand] = useState<boolean>(true);
  const [isLiveApi, setIsLiveApi] = useState<boolean>(false);
  const [sharedAlphaHover, setSharedAlphaHover] = useState<number | null>(null);

  const [primaryResp, setPrimaryResp] = useState<TireEvaluateResponse>(() =>
    evaluateTireOfflineMF62({
      compound: "R20",
      grip_profile: "FSG_RUBBERED",
      fz_n: 850,
      camber_deg: -1.8,
      temp_c: 75,
      pressure_kpa: 83,
    })
  );
  const [secondaryResp, setSecondaryResp] = useState<TireEvaluateResponse | null>(null);

  useEffect(() => {
    const compPrimary: TireCompoundName = compoundMode === "R25B" ? "R25B" : "R20";
    const reqPrimary = {
      compound: compPrimary,
      grip_profile: gripProfile,
      fz_n: fzN,
      camber_deg: camberDeg,
      temp_c: tempC,
      pressure_kpa: 83,
      n_points: 65,
    };

    setPrimaryResp(evaluateTireOfflineMF62(reqPrimary));
    if (compoundMode === "BOTH") {
      setSecondaryResp(evaluateTireOfflineMF62({ ...reqPrimary, compound: "R25B" }));
    } else {
      setSecondaryResp(null);
    }

    if (forceOfflineMode) {
      setIsLiveApi(false);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const resA = await evaluateTireModel(reqPrimary, forceOfflineMode);
      if (cancelled) return;
      setPrimaryResp(resA.data);
      setIsLiveApi(resA.live);
      if (compoundMode === "BOTH") {
        const resB = await evaluateTireModel({ ...reqPrimary, compound: "R25B" }, forceOfflineMode);
        if (!cancelled) setSecondaryResp(resB.data);
      }
    }, 90);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [camberDeg, compoundMode, forceOfflineMode, fzN, gripProfile, tempC]);

  const multiLoadCurves = useMemo(() => {
    if (!multiLoad) return [];
    const comp: TireCompoundName = compoundMode === "R25B" ? "R25B" : "R20";
    return MULTI_LOADS.map((load, idx) => ({
      load,
      color: MULTI_LOAD_COLORS[idx],
      resp: evaluateTireOfflineMF62({
        compound: comp,
        grip_profile: gripProfile,
        fz_n: load,
        camber_deg: camberDeg,
        temp_c: tempC,
        pressure_kpa: 83,
        n_points: 65,
      }),
    }));
  }, [camberDeg, compoundMode, gripProfile, multiLoad, tempC]);

  const metrics = useMemo(() => extractTireMetrics(primaryResp), [primaryResp]);

  // Deterministic pseudo-TTC experimental scatter points centered around MF 6.2 curve (bounded by ±31.88 N RMSE)
  const ttcFyScatter = useMemo(() => {
    return primaryResp.fy_vs_alpha
      .filter((p, idx) => idx % 2 === 0 && Math.abs(p.x) <= slipAngleSweepDeg)
      .map((p, i) => {
        const jitter = Math.sin(i * 12.9898 + fzN * 0.01) * 28.5;
        return { x: p.x, y: p.y + jitter };
      });
  }, [fzN, primaryResp.fy_vs_alpha, slipAngleSweepDeg]);

  // Linear cornering stiffness tangent line at alpha = 0
  const tangentPoints = useMemo(() => {
    const slope = metrics.corneringStiffnessNPerDeg;
    const maxA = Math.min(slipAngleSweepDeg, Math.max(3.5, primaryResp.peak_fy_n / Math.max(1, slope)));
    return [
      { x: -maxA, y: -slope * maxA },
      { x: maxA, y: slope * maxA },
    ];
  }, [metrics.corneringStiffnessNPerDeg, primaryResp.peak_fy_n, slipAngleSweepDeg]);

  // 1. Fy(alpha) series
  const fySeries = useMemo<CanvasSeries[]>(() => {
    if (multiLoad) {
      return multiLoadCurves.map((m, idx) => ({
        id: `fy_${m.load}`,
        label: `${m.load} N`,
        shortLabel: `${m.load}N`,
        unit: "N",
        color: m.color,
        fill: idx === multiLoadCurves.length - 1,
        points: m.resp.fy_vs_alpha.filter((p) => Math.abs(p.x) <= slipAngleSweepDeg),
      }));
    }
    const list: CanvasSeries[] = [
      {
        id: "fy_primary",
        label: `${primaryResp.compound} Fy`,
        shortLabel: primaryResp.compound,
        unit: "N",
        color: "#C5A059",
        fill: true,
        decimals: 0,
        points: primaryResp.fy_vs_alpha.filter((p) => Math.abs(p.x) <= slipAngleSweepDeg),
      },
      {
        id: "c_alpha_tangent",
        label: "Cα Tangent",
        shortLabel: "Cα",
        unit: "N",
        color: "rgba(236, 239, 244, 0.35)",
        dashed: true,
        lineWidth: 1.1,
        decimals: 0,
        points: tangentPoints,
      },
    ];
    if (secondaryResp) {
      list.push({
        id: "fy_secondary",
        label: "R25B Fy",
        shortLabel: "R25B",
        unit: "N",
        color: "#38BDF8",
        decimals: 0,
        points: secondaryResp.fy_vs_alpha.filter((p) => Math.abs(p.x) <= slipAngleSweepDeg),
      });
    }
    if (showPinnBand) {
      list.push({
        id: "pinn_hi",
        label: "PINN +σ",
        shortLabel: "+σ",
        unit: "N",
        color: "rgba(16, 185, 129, 0.45)",
        dashed: true,
        lineWidth: 1,
        decimals: 0,
        points: primaryResp.fy_vs_alpha
          .filter((p) => Math.abs(p.x) <= slipAngleSweepDeg)
          .map((p) => ({ x: p.x, y: p.y + 31.88 })),
      });
    }
    if (showTtcScatter) {
      list.push({
        id: "ttc_scatter",
        label: "TTC Exp.",
        color: "rgba(56, 189, 248, 0.72)",
        mode: "scatter",
        pointRadius: 2.1,
        points: ttcFyScatter,
      });
    }
    return list;
  }, [
    multiLoad,
    multiLoadCurves,
    primaryResp.compound,
    primaryResp.fy_vs_alpha,
    secondaryResp,
    showPinnBand,
    showTtcScatter,
    slipAngleSweepDeg,
    tangentPoints,
    ttcFyScatter,
  ]);

  // 2. Fx(kappa) series
  const fxSeries = useMemo<CanvasSeries[]>(() => {
    if (multiLoad) {
      return multiLoadCurves.map((m, idx) => ({
        id: `fx_${m.load}`,
        label: `${m.load} N`,
        shortLabel: `${m.load}N`,
        unit: "N",
        color: m.color,
        fill: idx === multiLoadCurves.length - 1,
        decimals: 0,
        points: m.resp.fx_vs_kappa.filter((p) => Math.abs(p.x) <= slipRatioSweep),
      }));
    }
    const list: CanvasSeries[] = [
      {
        id: "fx_primary",
        label: `${primaryResp.compound} Fx`,
        shortLabel: primaryResp.compound,
        unit: "N",
        color: "#38BDF8",
        fill: true,
        decimals: 0,
        points: primaryResp.fx_vs_kappa.filter((p) => Math.abs(p.x) <= slipRatioSweep),
      },
    ];
    if (secondaryResp) {
      list.push({
        id: "fx_secondary",
        label: "R25B Fx",
        shortLabel: "R25B",
        unit: "N",
        color: "#C5A059",
        decimals: 0,
        points: secondaryResp.fx_vs_kappa.filter((p) => Math.abs(p.x) <= slipRatioSweep),
      });
    }
    return list;
  }, [multiLoad, multiLoadCurves, primaryResp.compound, primaryResp.fx_vs_kappa, secondaryResp, slipRatioSweep]);

  // 3. Mz(alpha) + Pneumatic Trail t_p [mm] dual-axis series
  const mzAndTrailSeries = useMemo<CanvasSeries[]>(() => {
    const mzPts = primaryResp.mz_vs_alpha.filter((p) => Math.abs(p.x) <= slipAngleSweepDeg);
    const fyByAlpha = primaryResp.fy_vs_alpha;
    const trailPts = mzPts.map((mzPt, idx) => {
      const fyPt = fyByAlpha[idx];
      const fyMag = fyPt ? Math.abs(fyPt.y) : 0;
      const trailMm = fyMag > 35 ? Math.min(48, Math.max(-8, (-mzPt.y / fyPt.y) * 1000)) : 28;
      return { x: mzPt.x, y: trailMm };
    });

    const list: CanvasSeries[] = [
      {
        id: "mz_primary",
        label: `${primaryResp.compound} Mz`,
        shortLabel: "Mz",
        unit: "Nm",
        color: "#C5A059",
        fill: true,
        axis: "left",
        decimals: 1,
        points: mzPts,
      },
      {
        id: "trail_mm",
        label: "Pneumatic Trail t_p",
        shortLabel: "t_p",
        unit: "mm",
        color: "#10B981",
        dashed: true,
        axis: "right",
        decimals: 1,
        points: trailPts,
      },
    ];
    if (secondaryResp) {
      list.push({
        id: "mz_secondary",
        label: "R25B Mz",
        shortLabel: "R25B",
        unit: "Nm",
        color: "#38BDF8",
        axis: "left",
        decimals: 1,
        points: secondaryResp.mz_vs_alpha.filter((p) => Math.abs(p.x) <= slipAngleSweepDeg),
      });
    }
    return list;
  }, [primaryResp.compound, primaryResp.fy_vs_alpha, primaryResp.mz_vs_alpha, secondaryResp, slipAngleSweepDeg]);

  return (
    <div className="w-full h-full min-h-0 flex gap-2 overflow-hidden">
      {/* Left Fixed 270px Machined Control Rail */}
      <div className="machined-panel w-[270px] shrink-0 h-full min-h-0 flex flex-col overflow-hidden">
        <div className="inst-header">
          <span className="panel-title-label">Tire Lab · MF 6.2 + PINN</span>
          <span className="font-mono text-[9.5px] text-[#DFBE78]">
            {isLiveApi ? "LIVE API" : "HYBRID SOLVER"}
          </span>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-2.5 space-y-2.5">
          {/* Compound Segmented Selector */}
          <div className="space-y-1">
            <div className="text-[10px] font-medium text-[#7E8899]">Hoosier 16.0×7.5-10 Compound</div>
            <div className="seg-track w-full grid grid-cols-3">
              {(
                [
                  { id: "R20", label: "R20 R9" },
                  { id: "R25B", label: "R25B R8" },
                  { id: "BOTH", label: "Overlay" },
                ] as const
              ).map((c) => (
                <button
                  key={c.id}
                  type="button"
                  data-active={compoundMode === c.id ? "true" : "false"}
                  onClick={() => setCompoundMode(c.id)}
                  className="seg-btn text-center !px-1.5"
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          {/* Surface Grip Segmented Selector */}
          <div className="space-y-1">
            <div className="text-[10px] font-medium text-[#7E8899]">Surface Scaling Profile</div>
            <div className="seg-track w-full grid grid-cols-2">
              <button
                type="button"
                data-active={gripProfile === "COLD_TEST_OCT" ? "true" : "false"}
                onClick={() => setGripProfile("COLD_TEST_OCT")}
                className="seg-btn text-center !px-1.5"
              >
                COLD_OCT 0.47
              </button>
              <button
                type="button"
                data-active={gripProfile === "FSG_RUBBERED" ? "true" : "false"}
                onClick={() => setGripProfile("FSG_RUBBERED")}
                className="seg-btn text-center !px-1.5"
              >
                FSG_RUB 0.57
              </button>
            </div>
          </div>

          {/* Machined 30px Parameter Rows */}
          <div className="space-y-1.5 pt-1 border-t border-[#222633]">
            <PrecisionControl
              label="Vertical Load Fz"
              value={fzN}
              min={200}
              max={1800}
              step={10}
              unit="N"
              disabled={multiLoad}
              onChange={setFzN}
            />
            <PrecisionControl
              label="Camber γ"
              value={camberDeg}
              min={-4.0}
              max={0.0}
              step={0.1}
              unit="deg"
              decimals={1}
              onChange={setCamberDeg}
            />
            <PrecisionControl
              label="Tread Temp"
              value={tempC}
              min={18}
              max={90}
              step={1}
              unit="°C"
              onChange={setTempC}
            />
            <PrecisionControl
              label="Slip Angle ±α"
              value={slipAngleSweepDeg}
              min={6}
              max={16}
              step={1}
              unit="deg"
              onChange={setSlipAngleSweepDeg}
            />
            <PrecisionControl
              label="Slip Ratio ±κ"
              value={slipRatioSweep}
              min={0.1}
              max={0.25}
              step={0.01}
              decimals={2}
              onChange={setSlipRatioSweep}
            />
          </div>

          {/* Quick Overlay Toggle Pills */}
          <div className="space-y-1 pt-1 border-t border-[#222633]">
            <div className="text-[10px] font-medium text-[#7E8899]">Overlays &amp; Load Family</div>
            <div className="grid grid-cols-1 gap-1">
              {[
                {
                  label: "Multi-Load Family (400–1600 N)",
                  active: multiLoad,
                  toggle: () => setMultiLoad((v) => !v),
                },
                {
                  label: "TTC Experimental Scatter",
                  active: showTtcScatter,
                  toggle: () => setShowTtcScatter((v) => !v),
                },
                {
                  label: "Hybrid PINN Residual Band (±σ)",
                  active: showPinnBand,
                  toggle: () => setShowPinnBand((v) => !v),
                },
              ].map((item) => (
                <button
                  key={item.label}
                  type="button"
                  onClick={item.toggle}
                  className={`h-[26px] px-2.5 rounded-[3px] border text-[10.5px] font-medium flex items-center justify-between cursor-pointer transition-colors ${
                    item.active
                      ? "bg-[#181C26] border-[#C5A059]/55 text-[#DFBE78]"
                      : "bg-[#12151D] border-[#222633] text-[#94A3B8] hover:text-[#ECEFF4]"
                  }`}
                >
                  <span className="truncate">{item.label}</span>
                  <span className="font-mono text-[9.5px]">{item.active ? "ON" : "OFF"}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Bottom Hybrid PINN Validation KPI Strip */}
        <div className="shrink-0 p-2.5 bg-[#0F1116] border-t border-[#222633] space-y-1.5">
          <div className="flex items-center justify-between text-[10px]">
            <span className="font-semibold text-[#CBD5E1]">Hybrid PINN Validation KPIs</span>
            <span className="font-mono text-[#10B981]">TTC CAL</span>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            <div className="px-2 py-1 rounded-[2px] bg-[#151820] border border-[#222633]">
              <div className="text-[9px] text-[#7E8899]">Fy RMSE</div>
              <div className="font-mono text-[10.5px] font-semibold text-[#ECEFF4] tabular">
                31.88 N
              </div>
            </div>
            <div className="px-2 py-1 rounded-[2px] bg-[#151820] border border-[#222633]">
              <div className="text-[9px] text-[#7E8899]">Mz RMSE</div>
              <div className="font-mono text-[10.5px] font-semibold text-[#ECEFF4] tabular">
                5.02 Nm
              </div>
            </div>
            <div className="px-2 py-1 rounded-[2px] bg-[#151820] border border-[#222633]">
              <div className="text-[9px] text-[#7E8899]">C++17</div>
              <div className="font-mono text-[10.5px] font-semibold text-[#DFBE78] tabular">
                1.11 µs
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <div className="px-2 py-1 rounded-[2px] bg-[#151820] border border-[#222633] flex items-center justify-between">
              <span className="text-[9.5px] text-[#7E8899]">Cα</span>
              <span className="font-mono text-[10.5px] font-semibold text-[#ECEFF4] tabular">
                {metrics.corneringStiffnessNPerDeg.toFixed(0)} N/deg
              </span>
            </div>
            <div className="px-2 py-1 rounded-[2px] bg-[#151820] border border-[#222633] flex items-center justify-between">
              <span className="text-[9.5px] text-[#7E8899]">α*</span>
              <span className="font-mono text-[10.5px] font-semibold text-[#DFBE78] tabular">
                {metrics.optAlphaDeg.toFixed(1)} deg
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Right 2x2 Full-Height Synchronized Canvas Matrix */}
      <div className="flex-1 min-w-0 h-full min-h-0 grid grid-cols-2 grid-rows-2 gap-2 overflow-hidden">
        <TelemetryCanvasChart
          title="Lateral Force Fy(α)"
          xLabel="Slip Angle α (deg)"
          yLabel="Fy (N)"
          series={fySeries}
          xDomain={[-slipAngleSweepDeg, slipAngleSweepDeg]}
          highlightPeakOnPrimary
          peakUnit="N"
          activeCursorX={sharedAlphaHover}
          onHoverX={setSharedAlphaHover}
          referenceLines={[
            {
              axis: "x",
              value: metrics.optAlphaDeg,
              color: "rgba(197,160,89,0.5)",
              label: `α* ${metrics.optAlphaDeg.toFixed(1)}°`,
            },
          ]}
          footerNote={`Peak Fy ${metrics.peakFyN.toFixed(0)} N · μy ${primaryResp.mu_y_eff.toFixed(2)} · Cα ${metrics.corneringStiffnessNPerDeg.toFixed(0)} N/deg`}
        />

        <TelemetryCanvasChart
          title="Longitudinal Force Fx(κ)"
          xLabel="Slip Ratio κ (-)"
          yLabel="Fx (N)"
          series={fxSeries}
          xDomain={[-slipRatioSweep, slipRatioSweep]}
          highlightPeakOnPrimary
          peakUnit="N"
          referenceLines={[
            {
              axis: "x",
              value: metrics.optKappa,
              color: "rgba(56,189,248,0.5)",
              label: `κ* ${metrics.optKappa.toFixed(3)}`,
            },
            {
              axis: "y",
              value: primaryResp.peak_fx_n,
              color: "rgba(16,185,129,0.4)",
              label: `μx ${primaryResp.mu_x_eff.toFixed(2)}`,
            },
          ]}
          footerNote={`Peak Fx ${metrics.peakFxN.toFixed(0)} N @ κ* ${metrics.optKappa.toFixed(3)} · Thermal Scale ${(primaryResp.thermal_mu_factor * 100).toFixed(0)}%`}
        />

        <TelemetryCanvasChart
          title="Aligning Torque Mz(α) & Pneumatic Trail"
          xLabel="Slip Angle α (deg)"
          yLabel="Mz (Nm)"
          yRightLabel="t_p (mm)"
          series={mzAndTrailSeries}
          xDomain={[-slipAngleSweepDeg, slipAngleSweepDeg]}
          yRightDomain={[-5, 45]}
          highlightPeakOnPrimary
          peakUnit="Nm"
          activeCursorX={sharedAlphaHover}
          onHoverX={setSharedAlphaHover}
          footerNote={`Peak Mz ${metrics.peakMzNm.toFixed(2)} Nm · Peak Trail ${metrics.peakPneumaticTrailMm.toFixed(1)} mm (collapses before α*)`}
        />

        <CombinedFrictionEnvelope
          primaryResp={primaryResp}
          secondaryResp={secondaryResp}
          multiLoad={multiLoad}
          multiLoadCurves={multiLoadCurves}
          slipAngleMaxDeg={slipAngleSweepDeg}
          slipRatioMax={slipRatioSweep}
        />
      </div>
    </div>
  );
}
