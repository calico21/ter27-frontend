import React, { useEffect, useMemo, useRef, useState } from "react";
import type {
  GripProfileName,
  TireCompoundName,
  TireCurvePoint,
  TireEvaluateResponse,
} from "../../types";
import { evaluateTireModel } from "../../services/apiClient";
import {
  evaluateTireOfflineMF62,
  evaluateTvStabilityScenario,
  extractTireMetrics,
  TvFaultScenario,
} from "../../services/tirePhysics";
import { useTelemetryStore } from "../../state/telemetryStore";
import { SplitPane } from "../layout/SplitPane";

type CompoundViewMode = "R25B" | "R20" | "BOTH";

const MULTI_LOADS = [400, 800, 1200, 1600];
const MULTI_LOAD_COLORS = ["#64748B", "#38BDF8", "#DFBE78", "#34D399"];

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function LinePlotCanvas({
  title,
  xLabel,
  yLabel,
  series,
  annotation,
  fillPrimary = true,
}: {
  title: string;
  xLabel: string;
  yLabel: string;
  series: Array<{ label: string; color: string; dashed?: boolean; points: TireCurvePoint[] }>;
  annotation?: string;
  fillPrimary?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const render = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = canvas.clientWidth || 300;
      const h = canvas.clientHeight || 190;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.fillStyle = "#0B0D12";
      ctx.fillRect(0, 0, w, h);

      let minX = Infinity,
        maxX = -Infinity,
        minY = Infinity,
        maxY = -Infinity;
      for (const s of series) {
        for (const p of s.points) {
          if (p.x < minX) minX = p.x;
          if (p.x > maxX) maxX = p.x;
          if (p.y < minY) minY = p.y;
          if (p.y > maxY) maxY = p.y;
        }
      }
      if (!Number.isFinite(minX)) {
        ctx.restore();
        return;
      }
      const padY = Math.max(1e-3, (maxY - minY) * 0.14);
      minY -= padY;
      maxY += padY;

      const padL = 48,
        padR = 14,
        padT = 14,
        padB = 24;
      const pw = Math.max(20, w - padL - padR);
      const ph = Math.max(20, h - padT - padB);
      const xOf = (x: number) => padL + ((x - minX) / Math.max(1e-6, maxX - minX)) * pw;
      const yOf = (y: number) => padT + ph - ((y - minY) / Math.max(1e-6, maxY - minY)) * ph;

      // Subtle dashed horizontal gridlines
      ctx.font = '9.5px "JetBrains Mono", monospace';
      for (let i = 0; i <= 4; i++) {
        const yv = minY + ((maxY - minY) * i) / 4;
        const py = yOf(yv);
        ctx.save();
        ctx.strokeStyle = "rgba(255, 255, 255, 0.045)";
        ctx.setLineDash([3, 4]);
        ctx.beginPath();
        ctx.moveTo(padL, Math.round(py) + 0.5);
        ctx.lineTo(w - padR, Math.round(py) + 0.5);
        ctx.stroke();
        ctx.restore();

        ctx.fillStyle = "#64748B";
        ctx.textAlign = "right";
        ctx.fillText(Math.abs(yv) >= 100 ? yv.toFixed(0) : yv.toFixed(1), padL - 7, py + 3);
      }

      // Zero axes
      if (minX < 0 && maxX > 0) {
        const zx = xOf(0);
        ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
        ctx.beginPath();
        ctx.moveTo(Math.round(zx) + 0.5, padT);
        ctx.lineTo(Math.round(zx) + 0.5, padT + ph);
        ctx.stroke();
      }
      if (minY < 0 && maxY > 0) {
        const zy = yOf(0);
        ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
        ctx.beginPath();
        ctx.moveTo(padL, Math.round(zy) + 0.5);
        ctx.lineTo(w - padR, Math.round(zy) + 0.5);
        ctx.stroke();
      }

      // X ticks
      for (let i = 0; i <= 4; i++) {
        const xv = minX + ((maxX - minX) * i) / 4;
        const px = xOf(xv);
        ctx.fillStyle = "#64748B";
        ctx.textAlign = i === 0 ? "left" : i === 4 ? "right" : "center";
        ctx.fillText(Math.abs(maxX) <= 1 ? xv.toFixed(2) : xv.toFixed(0), px, h - 7);
      }

      // Curves with soft area gradient under primary non-ellipse trace
      series.forEach((s, sIdx) => {
        if (s.points.length < 2) return;

        if (fillPrimary && sIdx === 0 && series.length <= 2) {
          ctx.save();
          const baseY = minY < 0 && maxY > 0 ? yOf(0) : padT + ph;
          const grad = ctx.createLinearGradient(0, padT, 0, padT + ph);
          grad.addColorStop(0, hexToRgba(s.color, 0.16));
          grad.addColorStop(0.5, hexToRgba(s.color, 0.02));
          grad.addColorStop(1, hexToRgba(s.color, 0.14));
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.moveTo(xOf(s.points[0].x), baseY);
          for (const pt of s.points) ctx.lineTo(xOf(pt.x), yOf(pt.y));
          ctx.lineTo(xOf(s.points[s.points.length - 1].x), baseY);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }

        ctx.save();
        ctx.strokeStyle = s.color;
        ctx.lineWidth = sIdx === 0 ? 1.9 : 1.6;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        if (s.dashed) ctx.setLineDash([4, 3]);
        ctx.beginPath();
        s.points.forEach((pt, idx) => {
          const px = xOf(pt.x);
          const py = yOf(pt.y);
          if (idx === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        });
        ctx.stroke();
        ctx.restore();
      });

      // Peak marker dot on primary curve
      if (series[0] && series[0].points.length > 2 && fillPrimary) {
        let best = series[0].points[0];
        for (const pt of series[0].points) {
          if (pt.y > best.y) best = pt;
        }
        const bx = xOf(best.x);
        const by = yOf(best.y);
        ctx.strokeStyle = series[0].color;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(bx, by, 5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = "#F1F5F9";
        ctx.beginPath();
        ctx.arc(bx, by, 2.3, 0, Math.PI * 2);
        ctx.fill();
      }

      // Hover readout indicator on primary curve
      if (hoverIdx !== null && series[0] && series[0].points[hoverIdx]) {
        const pt = series[0].points[hoverIdx];
        const hx = xOf(pt.x);
        const hy = yOf(pt.y);
        ctx.save();
        ctx.strokeStyle = "rgba(241, 245, 249, 0.35)";
        ctx.setLineDash([2, 3]);
        ctx.beginPath();
        ctx.moveTo(Math.round(hx) + 0.5, padT);
        ctx.lineTo(Math.round(hx) + 0.5, padT + ph);
        ctx.stroke();
        ctx.restore();

        ctx.fillStyle = "#DFBE78";
        ctx.beginPath();
        ctx.arc(hx, hy, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    };

    render();
    const ro = new ResizeObserver(render);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [fillPrimary, hoverIdx, series]);

  const hoveredPoint =
    hoverIdx !== null && series[0] && series[0].points[hoverIdx]
      ? series[0].points[hoverIdx]
      : null;

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!series[0] || series[0].points.length < 2 || !fillPrimary) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const padL = 48;
    const padR = 14;
    const pw = Math.max(1, rect.width - padL - padR);
    const norm = Math.max(0, Math.min(1, (e.clientX - rect.left - padL) / pw));
    setHoverIdx(Math.round(norm * (series[0].points.length - 1)));
  };

  return (
    <div className="machined-panel flex flex-col min-h-0 overflow-hidden">
      <div className="panel-header-bar gap-2">
        <span className="panel-title-label truncate">{title}</span>
        {hoveredPoint ? (
          <span className="status-pill status-pill-gold font-mono text-[10px] tabular">
            x {hoveredPoint.x.toFixed(2)} · y {hoveredPoint.y.toFixed(1)}
          </span>
        ) : (
          <span className="font-mono text-[10px] text-[#64748B] shrink-0">
            {yLabel} vs {xLabel}
          </span>
        )}
      </div>
      {annotation ? (
        <div className="px-3.5 py-1.5 bg-[#0E1118] border-b border-white/[0.05] font-mono text-[10.5px] text-[#DFBE78] truncate">
          {annotation}
        </div>
      ) : null}
      <div className="flex-1 min-h-0 relative">
        <canvas
          ref={canvasRef}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHoverIdx(null)}
          className="block w-full h-full cursor-crosshair"
        />
      </div>
    </div>
  );
}

function PhasePlaneCanvas({
  scenario,
  gripProfile,
}: {
  scenario: TvFaultScenario;
  gripProfile: GripProfileName;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const summary = useMemo(
    () => evaluateTvStabilityScenario(scenario, gripProfile),
    [gripProfile, scenario]
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const render = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = canvas.clientWidth || 320;
      const h = canvas.clientHeight || 220;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.fillStyle = "#0B0D12";
      ctx.fillRect(0, 0, w, h);

      const padL = 44,
        padR = 16,
        padT = 16,
        padB = 26;
      const pw = Math.max(20, w - padL - padR);
      const ph = Math.max(20, h - padT - padB);
      const maxBeta = 14;
      const maxWz = 3.0;

      const xOf = (b: number) => padL + ((b + maxBeta) / (2 * maxBeta)) * pw;
      const yOf = (wz: number) => padT + ph - ((wz + maxWz) / (2 * maxWz)) * ph;

      // Subtle dashed grid
      ctx.save();
      ctx.strokeStyle = "rgba(255, 255, 255, 0.045)";
      ctx.setLineDash([3, 4]);
      for (const bTick of [-10, -5, 5, 10]) {
        ctx.beginPath();
        ctx.moveTo(xOf(bTick), padT);
        ctx.lineTo(xOf(bTick), padT + ph);
        ctx.stroke();
      }
      for (const rTick of [-2, -1, 1, 2]) {
        ctx.beginPath();
        ctx.moveTo(padL, yOf(rTick));
        ctx.lineTo(w - padR, yOf(rTick));
        ctx.stroke();
      }
      ctx.restore();

      // Zero axes
      ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
      ctx.beginPath();
      ctx.moveTo(padL, yOf(0));
      ctx.lineTo(w - padR, yOf(0));
      ctx.moveTo(xOf(0), padT);
      ctx.lineTo(xOf(0), padT + ph);
      ctx.stroke();

      // Stability envelope diamond with soft fill
      const bLim = summary.phaseBetaLimitDeg;
      const wzLim = summary.phaseWzLimitRadS;
      const envCol =
        summary.stabilityMarginLabel === "STABLE"
          ? "#10B981"
          : summary.stabilityMarginLabel === "MARGINAL"
            ? "#F59E0B"
            : "#EF4444";

      ctx.beginPath();
      ctx.moveTo(xOf(-bLim), yOf(wzLim * 0.4));
      ctx.lineTo(xOf(bLim * 0.55), yOf(wzLim));
      ctx.lineTo(xOf(bLim), yOf(-wzLim * 0.4));
      ctx.lineTo(xOf(-bLim * 0.55), yOf(-wzLim));
      ctx.closePath();
      ctx.fillStyle = hexToRgba(envCol, 0.09);
      ctx.fill();
      ctx.strokeStyle = envCol;
      ctx.lineWidth = 1.6;
      ctx.stroke();

      const damping = Math.abs(summary.dMzDbNmPerDeg) / 185.0;
      const starts: Array<[number, number]> = [
        [-10, 2.0],
        [10, -2.0],
        [-7, -1.8],
        [7, 1.8],
        [-11, 0.4],
        [11, -0.4],
      ];

      for (const [b0, r0] of starts) {
        let b = b0;
        let r = r0;
        const outside = Math.abs(b0) > bLim || Math.abs(r0) > wzLim;
        ctx.strokeStyle = outside ? "rgba(239, 68, 68, 0.65)" : "rgba(223, 190, 120, 0.82)";
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(xOf(b), yOf(r));
        for (let step = 0; step < 48; step++) {
          const dt = 0.04;
          const db = -0.85 * damping * b - 2.1 * r + 0.015 * b * b * Math.sign(b);
          const dr = 0.22 * (1.2 - damping) * b - 1.65 * damping * r;
          b = Math.max(-maxBeta, Math.min(maxBeta, b + db * dt));
          r = Math.max(-maxWz, Math.min(maxWz, r + dr * dt));
          ctx.lineTo(xOf(b), yOf(r));
        }
        ctx.stroke();
      }

      ctx.fillStyle = "#64748B";
      ctx.font = '9.5px "JetBrains Mono", monospace';
      ctx.textAlign = "center";
      ctx.fillText("Sideslip β (deg) · -14° to +14°", padL + pw / 2, h - 7);
      ctx.textAlign = "left";
      ctx.fillText("ωz (rad/s)", 6, 12);

      ctx.restore();
    };
    render();
    const ro = new ResizeObserver(render);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [summary]);

  const pillClass =
    summary.stabilityMarginLabel === "STABLE"
      ? "status-pill-nominal"
      : summary.stabilityMarginLabel === "MARGINAL"
        ? "status-pill-caution"
        : "status-pill-limit";

  return (
    <div className="flex flex-col h-full min-h-0 gap-2.5">
      <div className="machined-well flex-1 min-h-0 overflow-hidden">
        <canvas ref={canvasRef} className="block w-full h-full" />
      </div>
      <div className="grid grid-cols-2 gap-2.5 shrink-0">
        <div className="machined-card px-3 py-2 flex items-center justify-between gap-2">
          <div>
            <div className="text-[10px] text-[#94A3B8]">Stability Derivative (dMz / dβ)</div>
            <div className="font-mono text-[12px] font-semibold text-[#F1F5F9] tabular mt-0.5">
              {summary.dMzDbNmPerDeg.toFixed(1)} Nm/deg
            </div>
          </div>
          <span className={`status-pill ${pillClass}`}>{summary.stabilityMarginLabel}</span>
        </div>
        <div className="machined-card px-3 py-2 flex items-center justify-between gap-2">
          <div>
            <div className="text-[10px] text-[#94A3B8]">Yaw Authority / Est. Penalty</div>
            <div className="font-mono text-[12px] font-semibold text-[#F1F5F9] tabular mt-0.5">
              {summary.maxYawAuthorityNm} Nm
            </div>
          </div>
          <span className="status-pill status-pill-gold font-mono">
            +{summary.estAutocrossPenaltyS.toFixed(2)} s
          </span>
        </div>
      </div>
    </div>
  );
}

export function TireModelExplorer() {
  const { forceOfflineMode } = useTelemetryStore();

  const [compoundMode, setCompoundMode] = useState<CompoundViewMode>("R25B");
  const [gripProfile, setGripProfile] = useState<GripProfileName>("FSG_RUBBERED");
  const [fzN, setFzN] = useState<number>(750);
  const [camberDeg, setCamberDeg] = useState<number>(-1.5);
  const [tempC, setTempC] = useState<number>(75);
  const [pressureKpa, setPressureKpa] = useState<number>(83);
  const [multiLoad, setMultiLoad] = useState<boolean>(false);
  const [tvScenario, setTvScenario] = useState<TvFaultScenario>("normal_4wd");
  const [isLiveApi, setIsLiveApi] = useState<boolean>(false);

  const [primaryResp, setPrimaryResp] = useState<TireEvaluateResponse>(() =>
    evaluateTireOfflineMF62({
      compound: "R25B",
      grip_profile: "FSG_RUBBERED",
      fz_n: 750,
      camber_deg: -1.5,
      temp_c: 75,
      pressure_kpa: 83,
    })
  );
  const [secondaryResp, setSecondaryResp] = useState<TireEvaluateResponse | null>(null);

  useEffect(() => {
    const compPrimary: TireCompoundName = compoundMode === "R20" ? "R20" : "R25B";
    const reqPrimary = {
      compound: compPrimary,
      grip_profile: gripProfile,
      fz_n: fzN,
      camber_deg: camberDeg,
      temp_c: tempC,
      pressure_kpa: pressureKpa,
      n_points: 61,
    };

    setPrimaryResp(evaluateTireOfflineMF62(reqPrimary));
    if (compoundMode === "BOTH") {
      setSecondaryResp(evaluateTireOfflineMF62({ ...reqPrimary, compound: "R20" }));
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
        const resB = await evaluateTireModel({ ...reqPrimary, compound: "R20" }, forceOfflineMode);
        if (!cancelled) setSecondaryResp(resB.data);
      }
    }, 90);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [camberDeg, compoundMode, forceOfflineMode, fzN, gripProfile, pressureKpa, tempC]);

  const multiLoadCurves = useMemo(() => {
    if (!multiLoad) return [];
    const comp: TireCompoundName = compoundMode === "R20" ? "R20" : "R25B";
    return MULTI_LOADS.map((load, idx) => ({
      load,
      color: MULTI_LOAD_COLORS[idx],
      resp: evaluateTireOfflineMF62({
        compound: comp,
        grip_profile: gripProfile,
        fz_n: load,
        camber_deg: camberDeg,
        temp_c: tempC,
        pressure_kpa: pressureKpa,
        n_points: 61,
      }),
    }));
  }, [camberDeg, compoundMode, gripProfile, multiLoad, pressureKpa, tempC]);

  const metrics = useMemo(() => extractTireMetrics(primaryResp), [primaryResp]);

  const fySeries = useMemo(() => {
    if (multiLoad) {
      return multiLoadCurves.map((m) => ({
        label: `${m.load} N`,
        color: m.color,
        points: m.resp.fy_vs_alpha,
      }));
    }
    const list = [{ label: primaryResp.compound, color: "#DFBE78", points: primaryResp.fy_vs_alpha }];
    if (secondaryResp) {
      list.push({ label: "R20", color: "#38BDF8", points: secondaryResp.fy_vs_alpha });
    }
    return list;
  }, [multiLoad, multiLoadCurves, primaryResp, secondaryResp]);

  const fxSeries = useMemo(() => {
    if (multiLoad) {
      return multiLoadCurves.map((m) => ({
        label: `${m.load} N`,
        color: m.color,
        points: m.resp.fx_vs_kappa,
      }));
    }
    const list = [{ label: primaryResp.compound, color: "#DFBE78", points: primaryResp.fx_vs_kappa }];
    if (secondaryResp) {
      list.push({ label: "R20", color: "#38BDF8", points: secondaryResp.fx_vs_kappa });
    }
    return list;
  }, [multiLoad, multiLoadCurves, primaryResp, secondaryResp]);

  const mzSeries = useMemo(() => {
    if (multiLoad) {
      return multiLoadCurves.map((m) => ({
        label: `${m.load} N`,
        color: m.color,
        points: m.resp.mz_vs_alpha,
      }));
    }
    const list = [{ label: primaryResp.compound, color: "#DFBE78", points: primaryResp.mz_vs_alpha }];
    if (secondaryResp) {
      list.push({ label: "R20", color: "#38BDF8", points: secondaryResp.mz_vs_alpha });
    }
    return list;
  }, [multiLoad, multiLoadCurves, primaryResp, secondaryResp]);

  const ellipseSeries = useMemo(() => {
    if (multiLoad) {
      return multiLoadCurves.map((m) => ({
        label: `${m.load} N`,
        color: m.color,
        points: m.resp.friction_ellipse.map((pt) => ({ x: pt.fy_n, y: pt.fx_n })),
      }));
    }
    const list = [
      {
        label: primaryResp.compound,
        color: "#DFBE78",
        points: primaryResp.friction_ellipse.map((pt) => ({ x: pt.fy_n, y: pt.fx_n })),
      },
    ];
    if (secondaryResp) {
      list.push({
        label: "R20",
        color: "#38BDF8",
        points: secondaryResp.friction_ellipse.map((pt) => ({ x: pt.fy_n, y: pt.fx_n })),
      });
    }
    return list;
  }, [multiLoad, multiLoadCurves, primaryResp, secondaryResp]);

  return (
    <div className="w-full h-full min-h-0 overflow-hidden">
      <SplitPane
        direction="horizontal"
        initialRatio={0.28}
        minRatio={0.23}
        maxRatio={0.42}
        first={
          <div className="machined-panel w-full h-full min-h-0 flex flex-col overflow-hidden">
            <div className="panel-header-bar">
              <span className="panel-title-label">Hoosier 16.0×7.5-10 MF 6.2</span>
              <span
                className={`status-pill text-[10px] ${
                  isLiveApi ? "status-pill-nominal" : "status-pill-gold"
                }`}
              >
                {isLiveApi ? "Live API" : "MF 6.2 Solver"}
              </span>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto p-3.5 space-y-4">
              {/* Compound Selector */}
              <div className="space-y-1.5">
                <div className="text-[11px] font-semibold text-[#CBD5E1]">Compound Selection</div>
                <div className="seg-track w-full grid grid-cols-3">
                  {(
                    [
                      { id: "R25B", label: "R25B (R8)" },
                      { id: "R20", label: "R20 (R9)" },
                      { id: "BOTH", label: "Overlay" },
                    ] as const
                  ).map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      data-active={compoundMode === c.id ? "true" : "false"}
                      onClick={() => setCompoundMode(c.id)}
                      className="seg-btn text-center"
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Grip Profile Selector */}
              <div className="space-y-1.5">
                <div className="text-[11px] font-semibold text-[#CBD5E1]">Track Grip Surface</div>
                <div className="seg-track w-full grid grid-cols-2">
                  <button
                    type="button"
                    data-active={gripProfile === "COLD_TEST_OCT" ? "true" : "false"}
                    onClick={() => setGripProfile("COLD_TEST_OCT")}
                    className="seg-btn text-center"
                  >
                    Cold Oct (0.47)
                  </button>
                  <button
                    type="button"
                    data-active={gripProfile === "FSG_RUBBERED" ? "true" : "false"}
                    onClick={() => setGripProfile("FSG_RUBBERED")}
                    className="seg-btn text-center"
                  >
                    FSG Rubbered (0.57)
                  </button>
                </div>
              </div>

              {/* Tactile Filled Sliders + Direct Numeric Inputs */}
              <div className="space-y-3">
                {(
                  [
                    {
                      label: "Vertical Load Fz",
                      unit: "N",
                      val: fzN,
                      set: setFzN,
                      min: 200,
                      max: 1800,
                      step: 10,
                      disabled: multiLoad,
                    },
                    {
                      label: "Camber Angle",
                      unit: "deg",
                      val: camberDeg,
                      set: setCamberDeg,
                      min: -4.0,
                      max: 0.0,
                      step: 0.1,
                      disabled: false,
                    },
                    {
                      label: "Tread Temperature",
                      unit: "°C",
                      val: tempC,
                      set: setTempC,
                      min: 18,
                      max: 90,
                      step: 1,
                      disabled: false,
                    },
                    {
                      label: "Inflation Pressure",
                      unit: "kPa",
                      val: pressureKpa,
                      set: setPressureKpa,
                      min: 55,
                      max: 130,
                      step: 1,
                      disabled: false,
                    },
                  ] as const
                ).map((ctrl) => {
                  const pct = ((ctrl.val - ctrl.min) / (ctrl.max - ctrl.min)) * 100;
                  return (
                    <div
                      key={ctrl.label}
                      className={`space-y-1.5 ${ctrl.disabled ? "opacity-45" : ""}`}
                    >
                      <div className="flex items-center justify-between gap-2 text-[11px]">
                        <span className="text-[#CBD5E1] font-medium">{ctrl.label}</span>
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            min={ctrl.min}
                            max={ctrl.max}
                            step={ctrl.step}
                            disabled={ctrl.disabled}
                            value={ctrl.val}
                            onChange={(e) => {
                              const v = parseFloat(e.target.value);
                              if (!Number.isNaN(v)) {
                                ctrl.set(Math.max(ctrl.min, Math.min(ctrl.max, v)));
                              }
                            }}
                            className="w-[64px] h-[24px] bg-[#0B0D12] border border-white/[0.08] rounded-[4px] px-1.5 text-right font-mono text-[11px] text-[#F1F5F9] outline-none focus:border-[#C5A059]/60"
                          />
                          <span className="font-mono text-[10px] text-[#64748B] w-[26px]">
                            {ctrl.unit}
                          </span>
                        </div>
                      </div>
                      <input
                        type="range"
                        min={ctrl.min}
                        max={ctrl.max}
                        step={ctrl.step}
                        disabled={ctrl.disabled}
                        value={ctrl.val}
                        onChange={(e) => ctrl.set(parseFloat(e.target.value))}
                        className="eng-slider"
                        style={{
                          background: `linear-gradient(to right, #C5A059 ${pct}%, #1C212E ${pct}%)`,
                        }}
                      />
                    </div>
                  );
                })}
              </div>

              <label className="machined-card flex items-center justify-between px-3 py-2 text-[11px] cursor-pointer hover:bg-[#1C2230] transition-colors">
                <span className="text-[#E2E8F0] font-medium">
                  Multi-Load Family (400–1600 N)
                </span>
                <input
                  type="checkbox"
                  checked={multiLoad}
                  onChange={(e) => setMultiLoad(e.target.checked)}
                  className="accent-[#C5A059]"
                />
              </label>

              {/* Key Output KPIs */}
              <div className="grid grid-cols-2 gap-2">
                <div className="machined-card px-2.5 py-2">
                  <div className="text-[10px] text-[#94A3B8]">Peak Fy / μy</div>
                  <div className="font-mono text-[11.5px] font-semibold text-[#DFBE78] tabular mt-0.5">
                    {primaryResp.peak_fy_n.toFixed(0)} N · {primaryResp.mu_y_eff.toFixed(2)}
                  </div>
                </div>
                <div className="machined-card px-2.5 py-2">
                  <div className="text-[10px] text-[#94A3B8]">Peak Fx / μx</div>
                  <div className="font-mono text-[11.5px] font-semibold text-[#F1F5F9] tabular mt-0.5">
                    {primaryResp.peak_fx_n.toFixed(0)} N · {primaryResp.mu_x_eff.toFixed(2)}
                  </div>
                </div>
                <div className="machined-card px-2.5 py-2">
                  <div className="text-[10px] text-[#94A3B8]">Cα / Peak α*</div>
                  <div className="font-mono text-[11.5px] font-semibold text-[#F1F5F9] tabular mt-0.5">
                    {metrics.corneringStiffnessNPerDeg.toFixed(0)} · {metrics.optAlphaDeg.toFixed(1)}°
                  </div>
                </div>
                <div className="machined-card px-2.5 py-2">
                  <div className="text-[10px] text-[#94A3B8]">Thermal / λμy</div>
                  <div className="font-mono text-[11.5px] font-semibold text-[#38BDF8] tabular mt-0.5">
                    {(primaryResp.thermal_mu_factor * 100).toFixed(0)}% ·{" "}
                    {primaryResp.lambda_muy_eff.toFixed(3)}
                  </div>
                </div>
              </div>

              {/* Torque Vectoring Fault-Injection Selector */}
              <div className="pt-3 border-t border-white/[0.06] space-y-2">
                <div className="text-[11px] font-semibold text-[#CBD5E1]">
                  Torque Vectoring Fault Injection
                </div>
                <div className="space-y-1.5">
                  {(
                    [
                      { id: "normal_4wd", label: "Normal 4WD SMC" },
                      { id: "motor_loss_fl", label: "3WD Motor Loss (FL)" },
                      { id: "motor_loss_rr", label: "3WD Motor Loss (RR)" },
                      { id: "can_latency_125ms", label: "CAN Latency 125 ms + EKF" },
                      { id: "cold_tires_18c", label: "Cold Tires 18°C" },
                    ] as const
                  ).map((sc) => {
                    const active = tvScenario === sc.id;
                    return (
                      <button
                        key={sc.id}
                        type="button"
                        onClick={() => setTvScenario(sc.id)}
                        className={`w-full text-left px-3 py-1.5 rounded-[5px] text-[11px] font-medium border cursor-pointer transition-colors ${
                          active
                            ? "border-[#C5A059]/45 bg-[#C5A059]/12 text-[#DFBE78]"
                            : "border-white/[0.06] bg-[#161A23] text-[#CBD5E1] hover:bg-[#1D2331] hover:text-[#F1F5F9]"
                        }`}
                      >
                        {sc.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        }
        second={
          <SplitPane
            direction="vertical"
            initialRatio={0.65}
            minRatio={0.45}
            maxRatio={0.78}
            first={
              <div className="w-full h-full min-h-0 grid grid-cols-2 grid-rows-2 gap-2 overflow-hidden">
                <LinePlotCanvas
                  title="Lateral Force Fy(α)"
                  xLabel="α (deg)"
                  yLabel="Fy (N)"
                  series={fySeries}
                  annotation={`Peak Fy ${metrics.peakFyN.toFixed(0)} N @ α* ${metrics.optAlphaDeg.toFixed(1)}° · Cα ${metrics.corneringStiffnessNPerDeg.toFixed(0)} N/deg`}
                />
                <LinePlotCanvas
                  title="Longitudinal Force Fx(κ)"
                  xLabel="κ (-)"
                  yLabel="Fx (N)"
                  series={fxSeries}
                  annotation={`Peak Fx ${metrics.peakFxN.toFixed(0)} N @ κ* ${metrics.optKappa.toFixed(3)} · μx ${primaryResp.mu_x_eff.toFixed(3)}`}
                />
                <LinePlotCanvas
                  title="Self-Aligning Torque Mz(α)"
                  xLabel="α (deg)"
                  yLabel="Mz (Nm)"
                  series={mzSeries}
                  annotation={`Peak Mz ${metrics.peakMzNm.toFixed(2)} Nm · Est. Pneumatic Trail ${metrics.peakPneumaticTrailMm.toFixed(1)} mm`}
                />
                <LinePlotCanvas
                  title="Combined Friction Ellipse"
                  xLabel="Fy (N)"
                  yLabel="Fx (N)"
                  series={ellipseSeries}
                  fillPrimary={false}
                  annotation={
                    multiLoad
                      ? "Load Family: 400 N / 800 N / 1200 N / 1600 N"
                      : `Fz ${primaryResp.fz_n.toFixed(0)} N · Camber ${primaryResp.camber_deg.toFixed(1)}° · ${primaryResp.temp_c.toFixed(0)}°C`
                  }
                />
              </div>
            }
            second={
              <div className="machined-panel w-full h-full min-h-0 flex flex-col overflow-hidden">
                <div className="panel-header-bar">
                  <div className="flex items-center gap-2">
                    <span className="panel-title-label">
                      Torque Vectoring Phase-Plane Stability
                    </span>
                    <span className="panel-subtitle">Sideslip β vs Yaw Rate ωz</span>
                  </div>
                  <span className="status-pill status-pill-muted font-mono text-[10px]">
                    dMz/dβ &lt; 0 Envelope
                  </span>
                </div>
                <div className="flex-1 min-h-0 p-3">
                  <PhasePlaneCanvas scenario={tvScenario} gripProfile={gripProfile} />
                </div>
              </div>
            }
          />
        }
      />
    </div>
  );
}
