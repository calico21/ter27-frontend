import React, { useEffect, useMemo, useState } from "react";
import { Printer, Send, SlidersHorizontal } from "lucide-react";
import type {
  SetupsMatrixResponse,
  SetupValues,
  TireCompoundName,
} from "../../types";
import { applySetupPreset, fetchSetupsMatrix } from "../../services/apiClient";
import { useTelemetryStore } from "../../state/telemetryStore";
import { SplitPane } from "../layout/SplitPane";
import { SimulationLauncher } from "./SimulationLauncher";

interface ParamRowSpec {
  key: keyof SetupValues;
  deltaKey?: string;
  boundKey?: string;
  label: string;
  unit: string;
  decimals: number;
  editable?: boolean;
  step?: number;
}

const PARAM_ROWS: ParamRowSpec[] = [
  { key: "lltd", deltaKey: "lltd", boundKey: "lltd", label: "LLTD Front", unit: "ratio", decimals: 4, editable: true, step: 0.005 },
  { key: "camber_front_deg", deltaKey: "camber_front_deg", boundKey: "camber_f_deg", label: "Camber Front", unit: "deg", decimals: 3, editable: true, step: 0.05 },
  { key: "camber_rear_deg", deltaKey: "camber_rear_deg", boundKey: "camber_r_deg", label: "Camber Rear", unit: "deg", decimals: 3, editable: true, step: 0.05 },
  { key: "toe_front_deg", deltaKey: "toe_front_deg", boundKey: "toe_f_deg", label: "Toe Front", unit: "deg", decimals: 3, editable: true, step: 0.05 },
  { key: "toe_rear_deg", deltaKey: "toe_rear_deg", boundKey: "toe_r_deg", label: "Toe Rear", unit: "deg", decimals: 3, editable: true, step: 0.05 },
  { key: "brake_bias", deltaKey: "brake_bias", boundKey: "brake_bias", label: "Brake Bias Front", unit: "ratio", decimals: 4, editable: true, step: 0.01 },
  { key: "rake_mm", deltaKey: "rake_mm", boundKey: "rake_mm", label: "Aero Rake", unit: "mm", decimals: 2, editable: true, step: 0.25 },
  { key: "spring_rate_front_n_m", deltaKey: "spring_rate_front_n_m", label: "Spring Rate F", unit: "N/m", decimals: 0 },
  { key: "spring_rate_rear_n_m", deltaKey: "spring_rate_rear_n_m", label: "Spring Rate R", unit: "N/m", decimals: 0 },
  { key: "arb_front_nm_rad", deltaKey: "arb_front_nm_rad", label: "ARB Front", unit: "Nm/rad", decimals: 1 },
  { key: "arb_rear_nm_rad", deltaKey: "arb_rear_nm_rad", label: "ARB Rear", unit: "Nm/rad", decimals: 1 },
  { key: "power_limit_kw", deltaKey: "power_limit_kw", label: "HV Power Limit", unit: "kW", decimals: 1 },
  { key: "tire_pressure_front_bar", label: "Pressure Front", unit: "bar", decimals: 2 },
  { key: "tire_pressure_rear_bar", label: "Pressure Rear", unit: "bar", decimals: 2 },
];

export function TracksideSetupMatrix() {
  const {
    forceOfflineMode,
    vehicleOverview,
    activeSetupName,
    setActiveSetupName,
    pushToast,
  } = useTelemetryStore();

  const [matrix, setMatrix] = useState<SetupsMatrixResponse | null>(null);
  const [selectedName, setSelectedName] = useState<string>("optimal_autocross");
  const [customDraft, setCustomDraft] = useState<SetupValues | null>(null);
  const [editMode, setEditMode] = useState<boolean>(false);
  const [dispatching, setDispatching] = useState<boolean>(false);

  const [deltaMassKg, setDeltaMassKg] = useState<number>(0);
  const [deltaClAPct, setDeltaClAPct] = useState<number>(0);
  const [energyBudgetKwh, setEnergyBudgetKwh] = useState<number>(3.12);
  const [simCompound, setSimCompound] = useState<TireCompoundName>("R25B");

  useEffect(() => {
    let active = true;
    fetchSetupsMatrix(forceOfflineMode).then((res) => {
      if (!active) return;
      setMatrix(res.data);
      const found = res.data.presets.find((p) => p.preset.name === selectedName);
      setCustomDraft(found ? { ...found.preset } : { ...res.data.base_setup });
    });
    return () => {
      active = false;
    };
  }, [forceOfflineMode, selectedName]);

  const allColumns = useMemo(() => {
    if (!matrix) return [];
    return [
      { preset: matrix.base_setup, deltas_vs_base: {} as Record<string, number>, isBase: true },
      ...matrix.presets.map((p) => ({ ...p, isBase: false })),
    ];
  }, [matrix]);

  const activeSetup: SetupValues | null = useMemo(() => {
    if (!matrix) return null;
    if (editMode && customDraft) return customDraft;
    if (selectedName === matrix.base_setup.name) return matrix.base_setup;
    return matrix.presets.find((p) => p.preset.name === selectedName)?.preset ?? matrix.base_setup;
  }, [customDraft, editMode, matrix, selectedName]);

  const boundViolations = useMemo(() => {
    const errors: Record<string, string> = {};
    if (!customDraft || !vehicleOverview?.setup_bounds) return errors;
    const bounds = vehicleOverview.setup_bounds;
    for (const row of PARAM_ROWS) {
      if (!row.boundKey || !bounds[row.boundKey]) continue;
      const [lo, hi] = bounds[row.boundKey];
      const val = Number(customDraft[row.key]);
      if (val < lo || val > hi) {
        errors[row.key] = `Bounds [${lo}, ${hi}]`;
      }
    }
    return errors;
  }, [customDraft, vehicleOverview]);

  const hasBoundError = Object.keys(boundViolations).length > 0;

  const handleDispatch = async () => {
    if (!activeSetup) return;
    if (editMode && hasBoundError) {
      pushToast({
        level: "limit",
        title: "Setup Bounds Violation",
        detail: "Correct out-of-range mechanical parameters before UDP dispatch.",
      });
      return;
    }

    setDispatching(true);
    const payload = editMode
      ? { setup: activeSetup as unknown as Record<string, unknown> }
      : { preset: activeSetup.name };
    const res = await applySetupPreset(payload, forceOfflineMode);
    setDispatching(false);
    setActiveSetupName(editMode ? `${activeSetup.name}_custom` : activeSetup.name);
    pushToast({
      level: res.live ? "nominal" : "info",
      title: res.live
        ? `UDP 9877 Dispatched: ${activeSetup.name}`
        : `Validated Locally: ${activeSetup.name}`,
      detail: res.data.message,
    });
  };

  const sensitivity = useMemo(() => {
    const compoundDtFactor = simCompound === "R20" ? -0.015 : 0.0;
    const massTimeRatio = 1 + deltaMassKg * 0.0022;
    const aeroTimeRatio = 1 - (deltaClAPct / 100) * 0.018;
    const energyScale = Math.pow(3.12 / Math.max(2.6, energyBudgetKwh), 0.14);

    const baseAutocross = 67.1057;
    const baseEndurance = 1358.9964;
    const projAutocross = baseAutocross * massTimeRatio * aeroTimeRatio * (1 + compoundDtFactor);
    const projEndurance =
      baseEndurance * massTimeRatio * aeroTimeRatio * energyScale * (1 + compoundDtFactor * 0.5);

    const enduranceDeltaS = projEndurance - baseEndurance;
    const effEnergyPts = (3.12 - energyBudgetKwh) * 28.5;
    const endTimePts = -enduranceDeltaS * 0.42;
    const fsgEndEffPts = 282.69 + endTimePts + effEnergyPts;
    const fssEndEffPts = 335.42 + endTimePts * 1.15 + effEnergyPts * 1.18;

    return {
      projAutocross,
      projEndurance,
      deltaAutocross: projAutocross - baseAutocross,
      deltaEndurance: enduranceDeltaS,
      fsgEndEffPts,
      fsgDelta: fsgEndEffPts - 282.69,
      fssEndEffPts,
      fssDelta: fssEndEffPts - 335.42,
    };
  }, [deltaClAPct, deltaMassKg, energyBudgetKwh, simCompound]);

  if (!matrix || !activeSetup) {
    return (
      <div className="machined-panel w-full h-full flex items-center justify-center text-[12px] text-[#94A3B8]">
        Loading trackside setup differential matrix...
      </div>
    );
  }

  const massPct = ((deltaMassKg + 15) / 30) * 100;
  const aeroPct = ((deltaClAPct + 20) / 40) * 100;
  const energyPct = ((energyBudgetKwh - 2.8) / 0.7) * 100;

  return (
    <div className="w-full h-full min-h-0 overflow-hidden">
      {/* Interactive Screen Layout */}
      <div className="w-full h-full min-h-0 no-print">
        <SplitPane
          direction="horizontal"
          initialRatio={0.67}
          minRatio={0.48}
          maxRatio={0.78}
          first={
            <div className="machined-panel w-full h-full min-h-0 flex flex-col overflow-hidden">
              {/* Top Action Bar */}
              <div className="panel-header-bar gap-3 flex-wrap">
                <div className="flex items-center gap-2.5">
                  <span className="panel-title-label">Trackside Setup Differential Matrix</span>
                  <span className="status-pill status-pill-gold font-mono text-[10px]">
                    Active: {activeSetupName}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setEditMode((e) => !e);
                      if (!editMode) setCustomDraft({ ...activeSetup });
                    }}
                    className={`flex items-center gap-1.5 h-[28px] px-2.5 rounded-[5px] border text-[11px] font-medium cursor-pointer transition-colors ${
                      editMode
                        ? "border-[#C5A059]/45 bg-[#C5A059]/12 text-[#DFBE78]"
                        : "border-white/[0.08] bg-[#161A23] text-[#E2E8F0] hover:border-white/[0.16]"
                    }`}
                  >
                    <SlidersHorizontal className="w-3 h-3" />
                    {editMode ? "Editing Custom Draft" : "Edit Custom Bounds"}
                  </button>

                  <button
                    type="button"
                    onClick={() => window.print()}
                    className="flex items-center gap-1.5 h-[28px] px-2.5 rounded-[5px] border border-white/[0.08] bg-[#161A23] text-[#E2E8F0] hover:border-[#C5A059]/45 hover:text-[#DFBE78] text-[11px] font-medium cursor-pointer transition-colors"
                  >
                    <Printer className="w-3 h-3" />
                    Print Pit Sheet
                  </button>

                  <button
                    type="button"
                    disabled={dispatching || (editMode && hasBoundError)}
                    onClick={() => void handleDispatch()}
                    className="flex items-center gap-1.5 h-[28px] px-3 rounded-[5px] bg-[#C5A059] hover:bg-[#DFBE78] text-[#07080B] font-semibold text-[11px] cursor-pointer disabled:opacity-45 transition-colors shadow-[0_2px_10px_rgba(197,160,89,0.2)]"
                  >
                    <Send className="w-3 h-3" />
                    {dispatching ? "Dispatching..." : `Apply ${selectedName} to Simulator`}
                  </button>
                </div>
              </div>

              {/* Event Optimization Gains Strip */}
              <div className="grid grid-cols-4 gap-2 p-2.5 bg-[#0E1118] border-b border-white/[0.05]">
                {matrix.optimization_gains.map((g) => (
                  <div key={g.event} className="machined-card px-3 py-2">
                    <div className="text-[10.5px] font-medium text-[#94A3B8] truncate">
                      {g.event_name}
                    </div>
                    <div className="flex items-baseline justify-between gap-2 mt-1">
                      <span className="font-mono text-[13px] font-semibold text-[#F1F5F9] tabular">
                        {g.optimal_time_s.toFixed(3)} s
                      </span>
                      <span className="status-pill status-pill-nominal font-mono text-[10px]">
                        {g.delta_time_s.toFixed(3)} s
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Differential Comparison Table */}
              <div className="flex-1 min-h-0 overflow-auto">
                <table className="w-full border-collapse text-[11.5px]">
                  <thead className="sticky top-0 bg-[#141822] border-b border-white/[0.06] z-10">
                    <tr>
                      <th className="text-left px-3.5 py-2.5 font-medium text-[#94A3B8] w-[195px]">
                        Parameter
                      </th>
                      {allColumns.map((col) => {
                        const isSel = col.preset.name === selectedName;
                        return (
                          <th
                            key={col.preset.name}
                            onClick={() => {
                              setSelectedName(col.preset.name);
                              setCustomDraft({ ...col.preset });
                            }}
                            className={`text-right px-3 py-2 cursor-pointer border-l border-white/[0.05] transition-colors ${
                              isSel
                                ? "bg-[#C5A059]/10 text-[#DFBE78]"
                                : "text-[#E2E8F0] hover:bg-white/[0.03]"
                            }`}
                          >
                            <div className="font-mono text-[11px] font-semibold">
                              {col.preset.name}
                            </div>
                            <div className="text-[10px] font-normal text-[#94A3B8] mt-0.5">
                              {col.isBase ? "Base Reference" : col.preset.event}
                            </div>
                          </th>
                        );
                      })}
                      {editMode ? (
                        <th className="text-right px-3 py-2 text-[11px] font-semibold text-[#DFBE78] border-l border-[#C5A059]/40 bg-[#C5A059]/10">
                          Custom Draft
                        </th>
                      ) : null}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.045]">
                    {PARAM_ROWS.map((row) => {
                      const err = boundViolations[row.key];
                      return (
                        <tr key={row.key} className="hover:bg-[#1A202C]/70 transition-colors">
                          <td className="px-3.5 py-2">
                            <span className="text-[#F1F5F9] font-medium">{row.label}</span>
                            <span className="ml-1.5 font-mono text-[10px] text-[#64748B]">
                              {row.unit}
                            </span>
                          </td>
                          {allColumns.map((col) => {
                            const val = Number(col.preset[row.key]);
                            const delta =
                              !col.isBase && row.deltaKey ? col.deltas_vs_base[row.deltaKey] : 0;
                            const isSel = col.preset.name === selectedName;
                            const hasDelta =
                              !col.isBase && typeof delta === "number" && Math.abs(delta) > 1e-5;
                            return (
                              <td
                                key={col.preset.name}
                                className={`px-3 py-2 text-right font-mono tabular border-l border-white/[0.045] ${
                                  isSel ? "bg-[#C5A059]/[0.045]" : ""
                                }`}
                              >
                                <div className="text-[11.5px] text-[#F1F5F9]">
                                  {val.toFixed(row.decimals)}
                                </div>
                                {hasDelta ? (
                                  <span
                                    className={`inline-block mt-0.5 px-1.5 py-[1px] rounded-[3px] text-[9.5px] ${
                                      delta > 0
                                        ? "bg-[#C5A059]/14 text-[#DFBE78]"
                                        : "bg-[#38BDF8]/12 text-[#38BDF8]"
                                    }`}
                                  >
                                    {delta > 0 ? "+" : ""}
                                    {delta.toFixed(row.decimals)}
                                  </span>
                                ) : null}
                              </td>
                            );
                          })}
                          {editMode && customDraft ? (
                            <td className="px-3 py-1.5 text-right border-l border-[#C5A059]/35 bg-[#0B0D12]">
                              {row.editable ? (
                                <div className="flex flex-col items-end">
                                  <input
                                    type="number"
                                    step={row.step ?? 0.01}
                                    value={Number(customDraft[row.key])}
                                    onChange={(e) => {
                                      const v = parseFloat(e.target.value);
                                      if (!Number.isNaN(v)) {
                                        setCustomDraft((prev) =>
                                          prev ? { ...prev, [row.key]: v } : prev
                                        );
                                      }
                                    }}
                                    className={`w-[82px] h-[25px] bg-[#11141B] border px-2 text-right font-mono text-[11px] rounded-[4px] outline-none ${
                                      err
                                        ? "border-[#EF4444] text-[#F87171]"
                                        : "border-white/[0.1] text-[#F1F5F9] focus:border-[#C5A059]"
                                    }`}
                                  />
                                  {err ? (
                                    <span className="text-[9.5px] text-[#F87171] mt-0.5">{err}</span>
                                  ) : null}
                                </div>
                              ) : (
                                <span className="font-mono text-[11px] text-[#64748B]">
                                  {Number(customDraft[row.key]).toFixed(row.decimals)}
                                </span>
                              )}
                            </td>
                          ) : null}
                        </tr>
                      );
                    })}

                    {/* TV Map & Control Law Rows */}
                    <tr className="bg-[#0E1118]/70">
                      <td className="px-3.5 py-2 text-[#94A3B8] font-medium">TV Map File</td>
                      {allColumns.map((col) => (
                        <td
                          key={col.preset.name}
                          className="px-3 py-2 text-right font-mono text-[10.5px] text-[#DFBE78] border-l border-white/[0.045]"
                        >
                          {col.preset.tv_map}
                        </td>
                      ))}
                      {editMode ? <td className="border-l border-[#C5A059]/35" /> : null}
                    </tr>
                    <tr className="bg-[#0E1118]/70">
                      <td className="px-3.5 py-2 text-[#94A3B8] font-medium">Control Law</td>
                      {allColumns.map((col) => (
                        <td
                          key={col.preset.name}
                          className="px-3 py-2 text-right border-l border-white/[0.045]"
                        >
                          <span className="status-pill status-pill-muted font-mono text-[10px]">
                            {col.preset.control_law_mode}
                          </span>
                        </td>
                      ))}
                      {editMode ? <td className="border-l border-[#C5A059]/35" /> : null}
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          }
          second={
            <SplitPane
              direction="vertical"
              initialRatio={0.54}
              minRatio={0.32}
              maxRatio={0.72}
              first={<SimulationLauncher />}
              second={
                <div className="machined-panel w-full h-full min-h-0 flex flex-col overflow-hidden">
                  <div className="panel-header-bar">
                    <span className="panel-title-label">FSG / FS Spain Points Sensitivity</span>
                    <span className="status-pill status-pill-gold text-[10px]">Calculated</span>
                  </div>

                  <div className="flex-1 min-h-0 overflow-y-auto p-3.5 space-y-3.5 text-[11px]">
                    <p className="text-[11px] text-[#94A3B8] m-0 leading-relaxed">
                      Anchored to validated Endurance + Efficiency baseline (282.69 pts FSG / 335.42
                      pts FS Spain @ 3.12 kWh). Setup optimization gain:{" "}
                      <strong className="font-mono text-[#34D399]">
                        +{matrix.delta_total_pts.toFixed(2)} pts
                      </strong>
                      .
                    </p>

                    <div className="space-y-2.5">
                      <div className="space-y-1">
                        <div className="flex justify-between">
                          <span className="text-[#CBD5E1] font-medium">Vehicle Mass Delta</span>
                          <span className="font-mono text-[#F1F5F9] tabular">
                            {deltaMassKg >= 0 ? "+" : ""}
                            {deltaMassKg} kg ({(263 + deltaMassKg).toFixed(0)} kg)
                          </span>
                        </div>
                        <input
                          type="range"
                          min={-15}
                          max={15}
                          step={1}
                          value={deltaMassKg}
                          onChange={(e) => setDeltaMassKg(parseFloat(e.target.value))}
                          className="eng-slider"
                          style={{
                            background: `linear-gradient(to right, #C5A059 ${massPct}%, #1C212E ${massPct}%)`,
                          }}
                        />
                      </div>

                      <div className="space-y-1">
                        <div className="flex justify-between">
                          <span className="text-[#CBD5E1] font-medium">Downforce ClA</span>
                          <span className="font-mono text-[#F1F5F9] tabular">
                            {deltaClAPct >= 0 ? "+" : ""}
                            {deltaClAPct}% ({(2.35 * (1 + deltaClAPct / 100)).toFixed(2)} m²)
                          </span>
                        </div>
                        <input
                          type="range"
                          min={-20}
                          max={20}
                          step={1}
                          value={deltaClAPct}
                          onChange={(e) => setDeltaClAPct(parseFloat(e.target.value))}
                          className="eng-slider"
                          style={{
                            background: `linear-gradient(to right, #C5A059 ${aeroPct}%, #1C212E ${aeroPct}%)`,
                          }}
                        />
                      </div>

                      <div className="space-y-1">
                        <div className="flex justify-between">
                          <span className="text-[#CBD5E1] font-medium">Endurance Energy Budget</span>
                          <span className="font-mono text-[#DFBE78] tabular">
                            {energyBudgetKwh.toFixed(2)} kWh
                          </span>
                        </div>
                        <input
                          type="range"
                          min={2.8}
                          max={3.5}
                          step={0.02}
                          value={energyBudgetKwh}
                          onChange={(e) => setEnergyBudgetKwh(parseFloat(e.target.value))}
                          className="eng-slider"
                          style={{
                            background: `linear-gradient(to right, #C5A059 ${energyPct}%, #1C212E ${energyPct}%)`,
                          }}
                        />
                      </div>

                      <div className="flex items-center justify-between pt-0.5">
                        <span className="text-[#CBD5E1] font-medium">Tire Compound</span>
                        <div className="seg-track">
                          {(["R25B", "R20"] as const).map((c) => (
                            <button
                              key={c}
                              type="button"
                              data-active={simCompound === c ? "true" : "false"}
                              onClick={() => setSimCompound(c)}
                              className="seg-btn font-mono"
                            >
                              {c}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 pt-2 border-t border-white/[0.06]">
                      <div className="machined-card px-3 py-2">
                        <div className="text-[10px] text-[#94A3B8]">FSG End + Eff</div>
                        <div className="font-mono text-[13px] text-[#F1F5F9] font-semibold tabular mt-0.5">
                          {sensitivity.fsgEndEffPts.toFixed(2)} pts
                        </div>
                        <div className="mt-1">
                          <span
                            className={`status-pill font-mono text-[9.5px] ${
                              sensitivity.fsgDelta >= 0
                                ? "status-pill-nominal"
                                : "status-pill-limit"
                            }`}
                          >
                            {sensitivity.fsgDelta >= 0 ? "+" : ""}
                            {sensitivity.fsgDelta.toFixed(2)} pts
                          </span>
                        </div>
                      </div>

                      <div className="machined-card px-3 py-2">
                        <div className="text-[10px] text-[#94A3B8]">FS Spain End + Eff</div>
                        <div className="font-mono text-[13px] text-[#F1F5F9] font-semibold tabular mt-0.5">
                          {sensitivity.fssEndEffPts.toFixed(2)} pts
                        </div>
                        <div className="mt-1">
                          <span
                            className={`status-pill font-mono text-[9.5px] ${
                              sensitivity.fssDelta >= 0
                                ? "status-pill-nominal"
                                : "status-pill-limit"
                            }`}
                          >
                            {sensitivity.fssDelta >= 0 ? "+" : ""}
                            {sensitivity.fssDelta.toFixed(2)} pts
                          </span>
                        </div>
                      </div>

                      <div className="machined-card px-3 py-2">
                        <div className="text-[10px] text-[#94A3B8]">Projected Autocross</div>
                        <div className="font-mono text-[11.5px] text-[#F1F5F9] tabular mt-0.5">
                          {sensitivity.projAutocross.toFixed(2)} s{" "}
                          <span className="text-[#94A3B8]">
                            ({sensitivity.deltaAutocross >= 0 ? "+" : ""}
                            {sensitivity.deltaAutocross.toFixed(2)}s)
                          </span>
                        </div>
                      </div>

                      <div className="machined-card px-3 py-2">
                        <div className="text-[10px] text-[#94A3B8]">Projected Endurance</div>
                        <div className="font-mono text-[11.5px] text-[#F1F5F9] tabular mt-0.5">
                          {sensitivity.projEndurance.toFixed(1)} s{" "}
                          <span className="text-[#94A3B8]">
                            ({sensitivity.deltaEndurance >= 0 ? "+" : ""}
                            {sensitivity.deltaEndurance.toFixed(1)}s)
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              }
            />
          }
        />
      </div>

      {/* 1-Page Printable Trackside Pit-Lane Setup Sheet */}
      <div className="print-only print-sheet">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            borderBottom: "2px solid #000",
            paddingBottom: "6px",
            marginBottom: "10px",
          }}
        >
          <div>
            <h1 style={{ margin: 0, fontSize: "16px", fontWeight: 700 }}>
              TECNUN eRACING // TeR27 4WD TRACKSIDE SETUP SHEET
            </h1>
            <div style={{ fontSize: "11px" }}>
              Preset: {activeSetup.name} ({activeSetup.event.toUpperCase()}) —{" "}
              {activeSetup.description}
            </div>
          </div>
          <div style={{ textAlign: "right", fontSize: "10px" }}>
            <div>ISO 8855 Standard</div>
            <div>TV Map: {activeSetup.tv_map}</div>
            <div>Control Law: {activeSetup.control_law_mode.toUpperCase()}</div>
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th>Parameter</th>
              <th>Unit</th>
              <th>Base (default)</th>
              <th>Target ({activeSetup.name})</th>
              <th>Delta vs Base</th>
              <th>Pit Check [ ]</th>
            </tr>
          </thead>
          <tbody>
            {PARAM_ROWS.map((row) => {
              const baseVal = Number(matrix.base_setup[row.key]);
              const tgtVal = Number(activeSetup[row.key]);
              const diff = tgtVal - baseVal;
              return (
                <tr key={row.key}>
                  <td>{row.label}</td>
                  <td>{row.unit}</td>
                  <td>{baseVal.toFixed(row.decimals)}</td>
                  <td>
                    <strong>{tgtVal.toFixed(row.decimals)}</strong>
                  </td>
                  <td>
                    {diff >= 0 ? "+" : ""}
                    {diff.toFixed(row.decimals)}
                  </td>
                  <td>[ ] Verified</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
