import React, { useEffect, useMemo, useRef, useState } from "react";
import type { TireCompoundName } from "../../types";
import { SimulationLauncher } from "../setup_matrix/SimulationLauncher";
import { SplitPane } from "../layout/SplitPane";
import { InstrumentHeader, PrecisionControl } from "../shared/PrecisionControl";
import { TelemetryCanvasChart } from "../shared/TelemetryCanvasChart";

export function CompetitionStrategyView() {
  // Aero Map & Rake Explorer state
  const [frontRhMm, setFrontRhMm] = useState<number>(32);
  const [rearRhMm, setRearRhMm] = useState<number>(36);

  // FSG / FS Spain Points & Tornado Sensitivity state
  const [deltaMassKg, setDeltaMassKg] = useState<number>(0);
  const [deltaClAPct, setDeltaClAPct] = useState<number>(0);
  const [energyBudgetKwh, setEnergyBudgetKwh] = useState<number>(3.12);
  const [compound, setCompound] = useState<TireCompoundName>("R25B");

  const tornadoCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const rakeMm = rearRhMm - frontRhMm;

  const aeroCalc = useMemo(() => {
    const clampedRake = Math.max(-8, Math.min(8, rakeMm));
    const groundEffFactor =
      1 + (34 - frontRhMm) * 0.011 + clampedRake * 0.014 - 0.0012 * clampedRake * clampedRake;
    const clA = Math.max(1.6, 2.35 * groundEffFactor);
    const cdA = Math.max(0.85, 1.05 * (1 + Math.max(0, clampedRake) * 0.016));
    const copFrontPct = Math.max(
      36,
      Math.min(54, 45.0 + clampedRake * 0.68 + (32 - frontRhMm) * 0.22)
    );
    const lOverD = clA / cdA;

    const forcesAtSpeed = [60, 80, 105].map((vKmh) => {
      const v = vKmh / 3.6;
      const q = 0.5 * 1.225 * v * v;
      return {
        vKmh,
        downforceN: q * clA,
        dragN: q * cdA,
      };
    });

    const rakeSweepCop: { x: number; y: number }[] = [];
    const rakeSweepClA: { x: number; y: number }[] = [];
    for (let rk = -8; rk <= 8; rk += 0.5) {
      const gf = 1 + (34 - frontRhMm) * 0.011 + rk * 0.014 - 0.0012 * rk * rk;
      rakeSweepCop.push({
        x: rk,
        y: Math.max(36, Math.min(54, 45.0 + rk * 0.68 + (32 - frontRhMm) * 0.22)),
      });
      rakeSweepClA.push({ x: rk, y: Math.max(1.6, 2.35 * gf) });
    }

    return {
      clA,
      cdA,
      copFrontPct,
      lOverD,
      forcesAtSpeed,
      mechanicalLltdPct: 44.74,
      clampedRake,
      rakeSweepCop,
      rakeSweepClA,
    };
  }, [frontRhMm, rakeMm]);

  const pointsModel = useMemo(() => {
    const evalFsg = (mKg: number, clPct: number, eKwh: number, comp: TireCompoundName) => {
      const compDt = comp === "R20" ? -0.015 : 0.0;
      const massRatio = 1 + mKg * 0.0022;
      const aeroRatio = 1 - (clPct / 100) * 0.018;
      const energyScale = Math.pow(3.12 / Math.max(2.6, eKwh), 0.14);

      const baseAx = 67.1057;
      const baseEnd = 1358.9964;
      const projAx = baseAx * massRatio * aeroRatio * (1 + compDt);
      const projEnd = baseEnd * massRatio * aeroRatio * energyScale * (1 + compDt * 0.5);

      const endDelta = projEnd - baseEnd;
      const effPts = (3.12 - eKwh) * 28.5;
      const endPts = -endDelta * 0.42;
      const axPts = -(projAx - baseAx) * 3.1;

      const fsgEndEff = 282.69 + endPts + effPts;
      const fsgTotalDelta = endPts + effPts + axPts;
      const fssEndEff = 335.42 + endPts * 1.15 + effPts * 1.18;

      return {
        projAx,
        projEnd,
        fsgEndEff,
        fsgDelta: fsgEndEff - 282.69,
        fssEndEff,
        fssDelta: fssEndEff - 335.42,
        fsgTotalDelta,
      };
    };

    const current = evalFsg(deltaMassKg, deltaClAPct, energyBudgetKwh, compound);

    const tornado = [
      {
        label: "Mass (±10 kg)",
        lowDelta: evalFsg(10, 0, 3.12, "R25B").fsgTotalDelta,
        highDelta: evalFsg(-10, 0, 3.12, "R25B").fsgTotalDelta,
      },
      {
        label: "ClA (±15%)",
        lowDelta: evalFsg(0, -15, 3.12, "R25B").fsgTotalDelta,
        highDelta: evalFsg(0, 15, 3.12, "R25B").fsgTotalDelta,
      },
      {
        label: "Energy (±0.25 kWh)",
        lowDelta: evalFsg(0, 0, 3.37, "R25B").fsgTotalDelta,
        highDelta: evalFsg(0, 0, 2.87, "R25B").fsgTotalDelta,
      },
      {
        label: "Compound (R20/R25B)",
        lowDelta: -2.2,
        highDelta: evalFsg(0, 0, 3.12, "R20").fsgTotalDelta,
      },
      {
        label: "Aero Rake (±4 mm)",
        lowDelta: -3.4,
        highDelta: 2.9,
      },
    ].sort(
      (a, b) => Math.abs(b.highDelta - b.lowDelta) - Math.abs(a.highDelta - a.lowDelta)
    );

    return { current, tornado };
  }, [compound, deltaClAPct, deltaMassKg, energyBudgetKwh]);

  // High-DPI Tornado Sensitivity Canvas
  useEffect(() => {
    const canvas = tornadoCanvasRef.current;
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

      const padL = 122;
      const padR = 30;
      const padT = 14;
      const padB = 22;
      const pw = Math.max(40, w - padL - padR);
      const ph = Math.max(40, h - padT - padB);
      const maxAbs = 22;
      const xOf = (pts: number) => padL + ((pts + maxAbs) / (2 * maxAbs)) * pw;
      const zeroX = xOf(0);

      // Subtle vertical gridlines
      for (const tick of [-20, -10, 10, 20]) {
        const tx = xOf(tick);
        ctx.save();
        ctx.strokeStyle = "rgba(255,255,255,0.04)";
        ctx.setLineDash([3, 4]);
        ctx.beginPath();
        ctx.moveTo(Math.round(tx) + 0.5, padT);
        ctx.lineTo(Math.round(tx) + 0.5, padT + ph);
        ctx.stroke();
        ctx.restore();
      }

      ctx.strokeStyle = "rgba(255,255,255,0.18)";
      ctx.beginPath();
      ctx.moveTo(Math.round(zeroX) + 0.5, padT);
      ctx.lineTo(Math.round(zeroX) + 0.5, padT + ph);
      ctx.stroke();

      const rows = pointsModel.tornado;
      const rowH = ph / Math.max(1, rows.length);

      rows.forEach((row, idx) => {
        const cy = padT + idx * rowH + rowH / 2;
        const barH = Math.min(16, rowH * 0.52);

        ctx.font = '10px "Inter", sans-serif';
        ctx.fillStyle = "#CBD5E1";
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";
        ctx.fillText(row.label, padL - 8, cy);

        const xLow = xOf(Math.max(-maxAbs, Math.min(0, row.lowDelta)));
        ctx.fillStyle = "rgba(220, 38, 38, 0.78)";
        ctx.fillRect(xLow, cy - barH / 2, zeroX - xLow, barH);

        const xHigh = xOf(Math.min(maxAbs, Math.max(0, row.highDelta)));
        ctx.fillStyle = "rgba(197, 160, 89, 0.88)";
        ctx.fillRect(zeroX, cy - barH / 2, xHigh - zeroX, barH);

        ctx.font = '9.5px "JetBrains Mono", monospace';
        ctx.fillStyle = "#F87171";
        ctx.textAlign = "right";
        ctx.fillText(`${row.lowDelta.toFixed(1)}`, xLow - 4, cy);

        ctx.fillStyle = "#DFBE78";
        ctx.textAlign = "left";
        ctx.fillText(`+${row.highDelta.toFixed(1)}`, xHigh + 4, cy);
      });

      ctx.font = '9.5px "JetBrains Mono", monospace';
      ctx.fillStyle = "#64748B";
      ctx.textAlign = "center";
      ctx.fillText("FSG Dynamic Points Sensitivity (Δ pts vs Baseline)", padL + pw / 2, h - 8);
      ctx.restore();
    };
    render();
    const ro = new ResizeObserver(render);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [pointsModel.tornado]);

  const aeroSeries = useMemo(
    () => [
      {
        id: "cop_front",
        label: "Aero CoP % Front",
        shortLabel: "CoP%",
        unit: "%",
        color: "#C5A059",
        fill: true,
        lineWidth: 2,
        decimals: 1,
        points: aeroCalc.rakeSweepCop,
      },
      {
        id: "cla_m2",
        label: "Downforce ClA",
        shortLabel: "ClA",
        unit: "m²",
        color: "#38BDF8",
        axis: "right" as const,
        lineWidth: 1.65,
        decimals: 2,
        points: aeroCalc.rakeSweepClA,
      },
    ],
    [aeroCalc.rakeSweepClA, aeroCalc.rakeSweepCop]
  );

  return (
    <div className="w-full h-full min-h-0 overflow-hidden">
      {/* Full-Height 3-Pane Strategy Desk (30% / 36% / 34%) */}
      <SplitPane
        direction="horizontal"
        initialRatio={0.30}
        minRatio={0.23}
        maxRatio={0.38}
        first={<SimulationLauncher />}
        second={
          <SplitPane
            direction="horizontal"
            initialRatio={0.51}
            minRatio={0.38}
            maxRatio={0.64}
            first={
              <div className="machined-panel w-full h-full min-h-0 flex flex-col overflow-hidden">
                <InstrumentHeader
                  title="Aero Map & Rake Sensitivity"
                  right={
                    <span className="status-pill status-pill-gold !text-[9.5px] font-mono">
                      Rake {rakeMm >= 0 ? "+" : ""}
                      {rakeMm} mm · L/D {aeroCalc.lOverD.toFixed(2)}
                    </span>
                  }
                />

                <div className="p-2 space-y-1.5 border-b border-[#222633] bg-[#0F1116] shrink-0">
                  <PrecisionControl
                    label="Front Ride Ht"
                    value={frontRhMm}
                    min={24}
                    max={44}
                    step={1}
                    unit="mm"
                    decimals={0}
                    onChange={(v) => setFrontRhMm(Math.round(v))}
                  />
                  <PrecisionControl
                    label="Rear Ride Ht"
                    value={rearRhMm}
                    min={24}
                    max={48}
                    step={1}
                    unit="mm"
                    decimals={0}
                    accent="#38BDF8"
                    onChange={(v) => setRearRhMm(Math.round(v))}
                  />

                  <div className="grid grid-cols-3 gap-1.5 pt-0.5">
                    {aeroCalc.forcesAtSpeed.map((row) => (
                      <div
                        key={row.vKmh}
                        className="rounded-[3px] bg-[#141720] border border-[#222633] px-2 py-1"
                      >
                        <div className="font-mono text-[9px] text-[#7E8899]">@ {row.vKmh} km/h</div>
                        <div className="font-mono text-[11px] font-semibold text-[#DFBE78] tabular">
                          {row.downforceN.toFixed(0)} N
                        </div>
                        <div className="font-mono text-[9.5px] text-[#94A3B8] tabular">
                          Drag {row.dragN.toFixed(0)} N
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex-1 min-h-0 p-1.5 bg-[#0A0C10]">
                  <TelemetryCanvasChart
                    title="CoP % & ClA vs Rake"
                    xLabel="Aero Rake (mm)"
                    yLabel="CoP % Front"
                    yRightLabel="ClA (m²)"
                    xDomain={[-8, 8]}
                    yDomain={[36, 54]}
                    yRightDomain={[1.8, 3.0]}
                    series={aeroSeries}
                    referenceLines={[
                      {
                        axis: "y",
                        value: aeroCalc.mechanicalLltdPct,
                        color: "#38BDF8",
                        label: "Mech LLTD 44.74%",
                      },
                      {
                        axis: "x",
                        value: aeroCalc.clampedRake,
                        color: "#C5A059",
                        label: `Active ${rakeMm >= 0 ? "+" : ""}${rakeMm}mm`,
                      },
                    ]}
                    footerNote={`Active ClA ${aeroCalc.clA.toFixed(2)} m² · CdA ${aeroCalc.cdA.toFixed(2)} m² · CoP ${aeroCalc.copFrontPct.toFixed(1)}% F`}
                  />
                </div>
              </div>
            }
            second={
              <div className="machined-panel w-full h-full min-h-0 flex flex-col overflow-hidden">
                <InstrumentHeader
                  title="FSG / FS Spain Points & Tornado"
                  right={
                    <span className="status-pill status-pill-gold !text-[9.5px] font-mono">
                      282.69 / 335.42
                    </span>
                  }
                />

                <div className="p-2 space-y-1.5 border-b border-[#222633] bg-[#0F1116] shrink-0">
                  <PrecisionControl
                    label="Mass Δ"
                    value={deltaMassKg}
                    min={-15}
                    max={15}
                    step={1}
                    unit="kg"
                    decimals={0}
                    onChange={(v) => setDeltaMassKg(Math.round(v))}
                  />
                  <PrecisionControl
                    label="ClA Δ"
                    value={deltaClAPct}
                    min={-25}
                    max={25}
                    step={1}
                    unit="%"
                    decimals={0}
                    accent="#38BDF8"
                    onChange={(v) => setDeltaClAPct(Math.round(v))}
                  />
                  <PrecisionControl
                    label="Energy Budget"
                    value={energyBudgetKwh}
                    min={2.8}
                    max={3.5}
                    step={0.02}
                    unit="kWh"
                    decimals={2}
                    onChange={setEnergyBudgetKwh}
                  />

                  <div className="h-[30px] flex items-center justify-between px-2 rounded-[3px] bg-[#141720] border border-[#222633]">
                    <span className="text-[10.5px] text-[#CBD5E1]">Hoosier Compound</span>
                    <div className="seg-track">
                      {(["R25B", "R20"] as const).map((c) => (
                        <button
                          key={c}
                          type="button"
                          data-active={compound === c ? "true" : "false"}
                          onClick={() => setCompound(c)}
                          className="seg-btn font-mono"
                        >
                          {c}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Compact 4-KPI Score Strip */}
                  <div className="grid grid-cols-2 gap-1.5 pt-0.5">
                    <div className="rounded-[3px] bg-[#141720] border border-[#222633] px-2 py-1.5 flex items-baseline justify-between">
                      <div>
                        <div className="text-[9px] text-[#7E8899]">FSG End+Eff</div>
                        <div className="font-mono text-[13px] font-semibold text-[#ECEFF4] tabular">
                          {pointsModel.current.fsgEndEff.toFixed(2)}
                        </div>
                      </div>
                      <span
                        className={`font-mono text-[10px] tabular ${
                          pointsModel.current.fsgDelta >= 0 ? "text-[#34D399]" : "text-[#F87171]"
                        }`}
                      >
                        {pointsModel.current.fsgDelta >= 0 ? "+" : ""}
                        {pointsModel.current.fsgDelta.toFixed(1)}
                      </span>
                    </div>

                    <div className="rounded-[3px] bg-[#141720] border border-[#222633] px-2 py-1.5 flex items-baseline justify-between">
                      <div>
                        <div className="text-[9px] text-[#7E8899]">FS Spain End+Eff</div>
                        <div className="font-mono text-[13px] font-semibold text-[#ECEFF4] tabular">
                          {pointsModel.current.fssEndEff.toFixed(2)}
                        </div>
                      </div>
                      <span
                        className={`font-mono text-[10px] tabular ${
                          pointsModel.current.fssDelta >= 0 ? "text-[#34D399]" : "text-[#F87171]"
                        }`}
                      >
                        {pointsModel.current.fssDelta >= 0 ? "+" : ""}
                        {pointsModel.current.fssDelta.toFixed(1)}
                      </span>
                    </div>

                    <div className="rounded-[3px] bg-[#141720] border border-[#222633] px-2 py-1 flex items-center justify-between">
                      <span className="text-[9.5px] text-[#7E8899]">Autocross</span>
                      <span className="font-mono text-[11.5px] font-semibold text-[#DFBE78] tabular">
                        {pointsModel.current.projAx.toFixed(2)} s
                      </span>
                    </div>

                    <div className="rounded-[3px] bg-[#141720] border border-[#222633] px-2 py-1 flex items-center justify-between">
                      <span className="text-[9.5px] text-[#7E8899]">Endurance 22km</span>
                      <span className="font-mono text-[11.5px] font-semibold text-[#38BDF8] tabular">
                        {pointsModel.current.projEnd.toFixed(1)} s
                      </span>
                    </div>
                  </div>
                </div>

                {/* Tornado Sensitivity Canvas */}
                <div className="flex-1 min-h-0 relative bg-[#08090C]">
                  <canvas ref={tornadoCanvasRef} className="block w-full h-full" />
                </div>
              </div>
            }
          />
        }
      />
    </div>
  );
}
