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
const MULTI_LOAD_COLORS = ["#64748B", "#38BDF8", "#C5A059", "#10B981"];

function LinePlotCanvas({
  title,
  xLabel,
  yLabel,
  series,
  annotation,
}: {
  title: string;
  xLabel: string;
  yLabel: string;
  series: Array<{ label: string; color: string; dashed?: boolean; points: TireCurvePoint[] }>;
  annotation?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const render = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = canvas.clientWidth || 300;
      const h = canvas.clientHeight || 180;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.fillStyle = "#08090C";
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
      const padY = Math.max(1e-3, (maxY - minY) * 0.12);
      minY -= padY;
      maxY += padY;

      const padL = 48,
        padR = 12,
        padT = 12,
        padB = 24;
      const pw = Math.max(20, w - padL - padR);
      const ph = Math.max(20, h - padT - padB);
      const xOf = (x: number) => padL + ((x - minX) / Math.max(1e-6, maxX - minX)) * pw;
      const yOf = (y: number) => padT + ph - ((y - minY) / Math.max(1e-6, maxY - minY)) * ph;

      // Grid lines
      ctx.font = '9px "JetBrains Mono", monospace';
      for (let i = 0; i <= 4; i++) {
        const yv = minY + ((maxY - minY) * i) / 4;
        const py = yOf(yv);
        ctx.strokeStyle = "#181C26";
        ctx.beginPath();
        ctx.moveTo(padL, Math.round(py) + 0.5);
        ctx.lineTo(w - padR, Math.round(py) + 0.5);
        ctx.stroke();
        ctx.fillStyle = "#7E8799";
        ctx.textAlign = "right";
        ctx.fillText(Math.abs(yv) >= 100 ? yv.toFixed(0) : yv.toFixed(1), padL - 5, py + 3);
      }

      // Zero axes
      if (minX < 0 && maxX > 0) {
        const zx = xOf(0);
        ctx.strokeStyle = "#2A3042";
        ctx.beginPath();
        ctx.moveTo(Math.round(zx) + 0.5, padT);
        ctx.lineTo(Math.round(zx) + 0.5, padT + ph);
        ctx.stroke();
      }
      if (minY < 0 && maxY > 0) {
        const zy = yOf(0);
        ctx.strokeStyle = "#2A3042";
        ctx.beginPath();
        ctx.moveTo(padL, Math.round(zy) + 0.5);
        ctx.lineTo(w - padR, Math.round(zy) + 0.5);
        ctx.stroke();
      }

      // X ticks
      for (let i = 0; i <= 4; i++) {
        const xv = minX + ((maxX - minX) * i) / 4;
        const px = xOf(xv);
        ctx.fillStyle = "#7E8799";
        ctx.textAlign = i === 0 ? "left" : i === 4 ? "right" : "center";
        ctx.fillText(Math.abs(maxX) <= 1 ? xv.toFixed(2) : xv.toFixed(0), px, h - 8);
      }

      // Draw curves
      for (const s of series) {
        ctx.save();
        ctx.strokeStyle = s.color;
        ctx.lineWidth = 1.6;
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
      }

      ctx.restore();
    };

    render();
    const ro = new ResizeObserver(render);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [series]);

  return (
    <div className="bg-[#0F1116] border border-[#222633] rounded-[2px] flex flex-col min-h-0 overflow-hidden">
      <div className="panel-header-bar">
        <span className="panel-title-label">{title}</span>
        <span className="text-[9px] font-mono text-[#7E8799]">
          {yLabel} vs {xLabel}
        </span>
      </div>
      {annotation ? (
        <div className="px-2 py-0.5 bg-[#151820] border-b border-[#222633] font-mono text-[10px] text-[#C5A059] truncate">
          {annotation}
        </div>
      ) : null}
      <div className="flex-1 min-h-0 relative">
        <canvas ref={canvasRef} className="block w-full h-full" />
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
      ctx.fillStyle = "#08090C";
      ctx.fillRect(0, 0, w, h);

      const padL = 42,
        padR = 14,
        padT = 14,
        padB = 26;
      const pw = Math.max(20, w - padL - padR);
      const ph = Math.max(20, h - padT - padB);
      const maxBeta = 14;
      const maxWz = 3.0;

      const xOf = (b: number) => padL + ((b + maxBeta) / (2 * maxBeta)) * pw;
      const yOf = (wz: number) => padT + ph - ((wz + maxWz) / (2 * maxWz)) * ph;

      // Axes
      ctx.strokeStyle = "#232836";
      ctx.beginPath();
      ctx.moveTo(padL, yOf(0));
      ctx.lineTo(w - padR, yOf(0));
      ctx.moveTo(xOf(0), padT);
      ctx.lineTo(xOf(0), padT + ph);
      ctx.stroke();

      // Stability envelope diamond/parallelogram
      const bLim = summary.phaseBetaLimitDeg;
      const wzLim = summary.phaseWzLimitRadS;
      ctx.strokeStyle =
        summary.stabilityMarginLabel === "STABLE"
          ? "#10B981"
          : summary.stabilityMarginLabel === "MARGINAL"
            ? "#D97706"
            : "#DC2626";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(xOf(-bLim), yOf(wzLim * 0.4));
      ctx.lineTo(xOf(bLim * 0.55), yOf(wzLim));
      ctx.lineTo(xOf(bLim), yOf(-wzLim * 0.4));
      ctx.lineTo(xOf(-bLim * 0.55), yOf(-wzLim));
      ctx.closePath();
      ctx.stroke();

      // Phase-plane trajectories converging or diverging based on dMz/dbeta damping
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
        ctx.strokeStyle = outside ? "rgba(220, 38, 38, 0.55)" : "rgba(197, 160, 89, 0.72)";
        ctx.lineWidth = 1.1;
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

      // Labels
      ctx.fillStyle = "#7E8799";
      ctx.font = '9px "JetBrains Mono", monospace';
      ctx.textAlign = "center";
      ctx.fillText("Sideslip beta [deg] (-14 to +14)", padL + pw / 2, h - 7);
      ctx.textAlign = "left";
      ctx.fillText("wz [rad/s]", 4, 12);

      ctx.restore();
    };
    render();
    const ro = new ResizeObserver(render);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [summary]);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex-1 min-h-0 border border-[#222633] bg-[#08090C]">
        <canvas ref={canvasRef} className="block w-full h-full" />
      </div>
      <div className="grid grid-cols-2 gap-1.5 pt-2 font-mono text-[10px]">
        <div className="bg-[#151820] border border-[#222633] px-2 py-1">
          <div className="text-[9px] text-[#7E8799]">dMz / dbeta (STABILITY)</div>
          <div
            className={
              summary.stabilityMarginLabel === "STABLE"
                ? "text-[#10B981] font-semibold"
                : summary.stabilityMarginLabel === "MARGINAL"
                  ? "text-[#D97706] font-semibold"
                  : "text-[#DC2626] font-semibold"
            }
          >
            {summary.dMzDbNmPerDeg.toFixed(1)} Nm/deg ({summary.stabilityMarginLabel})
          </div>
        </div>
        <div className="bg-[#151820] border border-[#222633] px-2 py-1">
          <div className="text-[9px] text-[#7E8799]">YAW AUTHORITY / PENALTY</div>
          <div className="text-[#ECEFF4] font-semibold">
            {summary.maxYawAuthorityNm} Nm / +{summary.estAutocrossPenaltyS.toFixed(2)} s
          </div>
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

  // Instant 60 fps local MF 6.2 response while sliders drag; synced with backend POST /api/tires/evaluate when online
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

    // Immediate local update for zero-lag slider interaction
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
    const list = [{ label: primaryResp.compound, color: "#C5A059", points: primaryResp.fy_vs_alpha }];
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
    const list = [{ label: primaryResp.compound, color: "#C5A059", points: primaryResp.fx_vs_kappa }];
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
    const list = [{ label: primaryResp.compound, color: "#C5A059", points: primaryResp.mz_vs_alpha }];
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
        color: "#C5A059",
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
    <div className="w-full h-full min-h-0 overflow-hidden bg-[#08090C]">
      <SplitPane
        direction="horizontal"
        initialRatio={0.28}
        minRatio={0.22}
        maxRatio={0.42}
        first={
          <div className="w-full h-full min-h-0 flex flex-col bg-[#0F1116] border-r border-[#222633] overflow-y-auto">
            <div className="panel-header-bar">
              <span className="panel-title-label">Hoosier 16.0x7.5-10 MF 6.2</span>
              <span
                className={`text-[9px] font-mono ${isLiveApi ? "text-[#10B981]" : "text-[#C5A059]"}`}
              >
                {isLiveApi ? "LIVE API" : "CALC MF 6.2"}
              </span>
            </div>

            <div className="p-2.5 space-y-3">
              {/* Compound Selector */}
              <div className="space-y-1">
                <div className="text-[10px] font-semibold uppercase tracking-[0.06em] text-[#7E8799]">
                  Compound Overlay
                </div>
                <div className="grid grid-cols-3 border border-[#222633] rounded-[2px] bg-[#08090C] font-mono text-[10px]">
                  {(
                    [
                      { id: "R25B", label: "R25B (R8)" },
                      { id: "R20", label: "R20 (R9)" },
                      { id: "BOTH", label: "Overlay Both" },
                    ] as const
                  ).map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setCompoundMode(c.id)}
                      className={`py-1 cursor-pointer ${
                        compoundMode === c.id
                          ? "bg-[#1B1F2A] text-[#C5A059]"
                          : "text-[#7E8799] hover:text-[#ECEFF4]"
                      }`}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Grip Profile Selector */}
              <div className="space-y-1">
                <div className="text-[10px] font-semibold uppercase tracking-[0.06em] text-[#7E8799]">
                  Track Grip Profile
                </div>
                <div className="grid grid-cols-2 border border-[#222633] rounded-[2px] bg-[#08090C] font-mono text-[10px]">
                  <button
                    type="button"
                    onClick={() => setGripProfile("COLD_TEST_OCT")}
                    className={`py-1 cursor-pointer ${
                      gripProfile === "COLD_TEST_OCT"
                        ? "bg-[#1B1F2A] text-[#C5A059]"
                        : "text-[#7E8799] hover:text-[#ECEFF4]"
                    }`}
                  >
                    COLD_OCT (0.47)
                  </button>
                  <button
                    type="button"
                    onClick={() => setGripProfile("FSG_RUBBERED")}
                    className={`py-1 cursor-pointer ${
                      gripProfile === "FSG_RUBBERED"
                        ? "bg-[#1B1F2A] text-[#C5A059]"
                        : "text-[#7E8799] hover:text-[#ECEFF4]"
                    }`}
                  >
                    FSG_RUB (0.57)
                  </button>
                </div>
              </div>

              {/* Precision Numeric Sliders + Direct Keyboard Inputs */}
              {(
                [
                  {
                    label: "Vertical Load Fz [N]",
                    val: fzN,
                    set: setFzN,
                    min: 200,
                    max: 1800,
                    step: 10,
                    disabled: multiLoad,
                  },
                  {
                    label: "Camber Angle [deg]",
                    val: camberDeg,
                    set: setCamberDeg,
                    min: -4.0,
                    max: 0.0,
                    step: 0.1,
                    disabled: false,
                  },
                  {
                    label: "Tire Temp [C]",
                    val: tempC,
                    set: setTempC,
                    min: 18,
                    max: 90,
                    step: 1,
                    disabled: false,
                  },
                  {
                    label: "Inflation Pressure [kPa]",
                    val: pressureKpa,
                    set: setPressureKpa,
                    min: 55,
                    max: 130,
                    step: 1,
                    disabled: false,
                  },
                ] as const
              ).map((ctrl) => (
                <div key={ctrl.label} className={`space-y-1 ${ctrl.disabled ? "opacity-45" : ""}`}>
                  <div className="flex items-center justify-between text-[10px] font-mono">
                    <span className="text-[#7E8799]">{ctrl.label}</span>
                    <input
                      type="number"
                      min={ctrl.min}
                      max={ctrl.max}
                      step={ctrl.step}
                      disabled={ctrl.disabled}
                      value={ctrl.val}
                      onChange={(e) => {
                        const v = parseFloat(e.target.value);
                        if (!Number.isNaN(v)) ctrl.set(Math.max(ctrl.min, Math.min(ctrl.max, v)));
                      }}
                      className="w-[68px] bg-[#08090C] border border-[#222633] px-1.5 py-0.5 text-right text-[#ECEFF4] rounded-[2px]"
                    />
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
                  />
                </div>
              ))}

              <label className="flex items-center justify-between px-2 py-1.5 bg-[#151820] border border-[#222633] font-mono text-[10px] cursor-pointer">
                <span className="text-[#ECEFF4]">Multi-Load Family (400 / 800 / 1200 / 1600 N)</span>
                <input
                  type="checkbox"
                  checked={multiLoad}
                  onChange={(e) => setMultiLoad(e.target.checked)}
                  className="accent-[#C5A059]"
                />
              </label>

              {/* Key Output KPIs */}
              <div className="grid grid-cols-2 gap-1.5 font-mono text-[10px]">
                <div className="bg-[#151820] border border-[#222633] px-2 py-1">
                  <div className="text-[9px] text-[#7E8799]">PEAK Fy / mu_y</div>
                  <div className="text-[#C5A059] font-semibold">
                    {primaryResp.peak_fy_n.toFixed(0)} N / {primaryResp.mu_y_eff.toFixed(2)}
                  </div>
                </div>
                <div className="bg-[#151820] border border-[#222633] px-2 py-1">
                  <div className="text-[9px] text-[#7E8799]">PEAK Fx / mu_x</div>
                  <div className="text-[#ECEFF4] font-semibold">
                    {primaryResp.peak_fx_n.toFixed(0)} N / {primaryResp.mu_x_eff.toFixed(2)}
                  </div>
                </div>
                <div className="bg-[#151820] border border-[#222633] px-2 py-1">
                  <div className="text-[9px] text-[#7E8799]">C_alpha / opt alpha</div>
                  <div className="text-[#ECEFF4] font-semibold">
                    {metrics.corneringStiffnessNPerDeg.toFixed(0)} N/deg / {metrics.optAlphaDeg.toFixed(1)} deg
                  </div>
                </div>
                <div className="bg-[#151820] border border-[#222633] px-2 py-1">
                  <div className="text-[9px] text-[#7E8799]">THERMAL / lambda_muy</div>
                  <div className="text-[#38BDF8] font-semibold">
                    {(primaryResp.thermal_mu_factor * 100).toFixed(0)}% /{" "}
                    {primaryResp.lambda_muy_eff.toFixed(3)}
                  </div>
                </div>
              </div>

              {/* Torque Vectoring Fault-Injection Selector */}
              <div className="pt-2 border-t border-[#222633] space-y-1.5">
                <div className="text-[10px] font-semibold uppercase tracking-[0.06em] text-[#7E8799]">
                  Torque Vectoring Fault Injection
                </div>
                <div className="space-y-1 font-mono text-[10px]">
                  {(
                    [
                      { id: "normal_4wd", label: "Normal 4WD SMC" },
                      { id: "motor_loss_fl", label: "3WD Motor Loss (FL)" },
                      { id: "motor_loss_rr", label: "3WD Motor Loss (RR)" },
                      { id: "can_latency_125ms", label: "CAN Latency 125 ms + EKF" },
                      { id: "cold_tires_18c", label: "Cold Tires 18 C" },
                    ] as const
                  ).map((sc) => (
                    <button
                      key={sc.id}
                      type="button"
                      onClick={() => setTvScenario(sc.id)}
                      className={`w-full text-left px-2 py-1 border rounded-[2px] cursor-pointer ${
                        tvScenario === sc.id
                          ? "border-[#C5A059] bg-[#1B1F2A] text-[#C5A059]"
                          : "border-[#222633] bg-[#151820] text-[#ECEFF4] hover:bg-[#1B1F2A]"
                      }`}
                    >
                      {sc.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        }
        second={
          <SplitPane
            direction="vertical"
            initialRatio={0.66}
            minRatio={0.45}
            maxRatio={0.78}
            first={
              <div className="w-full h-full min-h-0 grid grid-cols-2 grid-rows-2 gap-1.5 p-1.5 bg-[#08090C]">
                <LinePlotCanvas
                  title="Lateral Force Fy(alpha)"
                  xLabel="alpha [deg]"
                  yLabel="Fy [N]"
                  series={fySeries}
                  annotation={`Peak Fy ${metrics.peakFyN.toFixed(0)} N @ alpha* ${metrics.optAlphaDeg.toFixed(1)} deg | C_alpha ${metrics.corneringStiffnessNPerDeg.toFixed(0)} N/deg`}
                />
                <LinePlotCanvas
                  title="Longitudinal Force Fx(kappa)"
                  xLabel="kappa [-]"
                  yLabel="Fx [N]"
                  series={fxSeries}
                  annotation={`Peak Fx ${metrics.peakFxN.toFixed(0)} N @ kappa* ${metrics.optKappa.toFixed(3)} | mu_x ${primaryResp.mu_x_eff.toFixed(3)}`}
                />
                <LinePlotCanvas
                  title="Self-Aligning Torque Mz(alpha)"
                  xLabel="alpha [deg]"
                  yLabel="Mz [Nm]"
                  series={mzSeries}
                  annotation={`Peak Mz ${metrics.peakMzNm.toFixed(2)} Nm | Est Pneumatic Trail ${metrics.peakPneumaticTrailMm.toFixed(1)} mm`}
                />
                <LinePlotCanvas
                  title="Combined Friction Ellipse (Fy vs Fx)"
                  xLabel="Fy [N]"
                  yLabel="Fx [N]"
                  series={ellipseSeries}
                  annotation={
                    multiLoad
                      ? "Family: 400 N / 800 N / 1200 N / 1600 N"
                      : `Fz ${primaryResp.fz_n.toFixed(0)} N | Camber ${primaryResp.camber_deg.toFixed(1)} deg | ${primaryResp.temp_c.toFixed(0)} C`
                  }
                />
              </div>
            }
            second={
              <div className="w-full h-full min-h-0 flex flex-col bg-[#0F1116]">
                <div className="panel-header-bar">
                  <span className="panel-title-label">
                    Torque Vectoring Phase-Plane (beta vs omega_z) &amp; Stability Margin
                  </span>
                  <span className="text-[10px] font-mono text-[#7E8799]">
                    CALCULATED STABILITY ENVELOPE // dMz/dbeta &lt; 0
                  </span>
                </div>
                <div className="flex-1 min-h-0 p-2">
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
