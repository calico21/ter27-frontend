import React, { useEffect, useMemo, useState } from "react";
import { Printer, Send } from "lucide-react";
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
  { key: "rake_mm", deltaKey: "rake_mm", boundKey: "rake_mm", label: "Rake", unit: "mm", decimals: 2, editable: true, step: 0.25 },
  { key: "spring_rate_front_n_m", deltaKey: "spring_rate_front_n_m", label: "Spring Rate F", unit: "N/m", decimals: 0 },
  { key: "spring_rate_rear_n_m", deltaKey: "spring_rate_rear_n_m", label: "Spring Rate R", unit: "N/m", decimals: 0 },
  { key: "arb_front_nm_rad", deltaKey: "arb_front_nm_rad", label: "ARB Front", unit: "Nm/rad", decimals: 1 },
  { key: "arb_rear_nm_rad", deltaKey: "arb_rear_nm_rad", label: "ARB Rear", unit: "Nm/rad", decimals: 1 },
  { key: "power_limit_kw", deltaKey: "power_limit_kw", label: "HV Power Limit", unit: "kW", decimals: 1 },
  { key: "tire_pressure_front_bar", label: "Pressure F", unit: "bar", decimals: 2 },
  { key: "tire_pressure_rear_bar", label: "Pressure R", unit: "bar", decimals: 2 },
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

  // FSG / FS Spain Points & Design Sensitivity Simulator
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

  // Mechanical bounds verification for custom edits
  const boundViolations = useMemo(() => {
    const errors: Record<string, string> = {};
    if (!customDraft || !vehicleOverview?.setup_bounds) return errors;
    const bounds = vehicleOverview.setup_bounds;
    for (const row of PARAM_ROWS) {
      if (!row.boundKey || !bounds[row.boundKey]) continue;
      const [lo, hi] = bounds[row.boundKey];
      const val = Number(customDraft[row.key]);
      if (val < lo || val > hi) {
        errors[row.key] = `Out of mechanical bounds [${lo}, ${hi}]`;
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

  // Sensitivity projection anchored strictly to validated baseline:
  // 282.69 pts FSG / 335.42 pts FS Spain (Endurance + Efficiency @ 3.12 kWh, R25B)
  const sensitivity = useMemo(() => {
    const compoundDtFactor = simCompound === "R20" ? -0.015 : 0.0; // R20 slightly softer peak grip, higher wear
    const massTimeRatio = 1 + deltaMassKg * 0.0022;
    const aeroTimeRatio = 1 - (deltaClAPct / 100) * 0.018;
    const energyScale = Math.pow(3.12 / Math.max(2.6, energyBudgetKwh), 0.14);

    const baseAutocross = 67.1057;
    const baseEndurance = 1358.9964;
    const projAutocross = baseAutocross * massTimeRatio * aeroTimeRatio * (1 + compoundDtFactor);
    const projEndurance =
      baseEndurance * massTimeRatio * aeroTimeRatio * energyScale * (1 + compoundDtFactor * 0.5);

    const enduranceDeltaS = projEndurance - baseEndurance;
    // Efficiency rewards lower energy consumption; Endurance penalizes slower time
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
      <div className="w-full h-full flex items-center justify-center bg-[#08090C] font-mono text-[11px] text-[#7E8799]">
        Loading trackside setup differential matrix...
      </div>
    );
  }

  return (
    <div className="w-full h-full min-h-0 overflow-hidden bg-[#08090C]">
      {/* Screen Interactive Layout */}
      <div className="w-full h-full min-h-0 no-print">
        <SplitPane
          direction="horizontal"
          initialRatio={0.67}
          minRatio={0.48}
          maxRatio={0.78}
          first={
            <div className="w-full h-full min-h-0 flex flex-col bg-[#0F1116]">
              {/* Action Bar */}
              <div className="panel-header-bar gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <span className="panel-title-label">Trackside Setup Differential Matrix</span>
                  <span className="text-[10px] font-mono text-[#7E8799]">
                    ACTIVE: <strong className="text-[#C5A059]">{activeSetupName}</strong>
                  </span>
                </div>

                <div className="flex items-center gap-1.5 font-mono text-[10px]">
                  <button
                    type="button"
                    onClick={() => {
                      setEditMode((e) => !e);
                      if (!editMode) setCustomDraft({ ...activeSetup });
                    }}
                    className={`px-2 py-0.5 border rounded-[2px] cursor-pointer ${
                      editMode
                        ? "border-[#C5A059] text-[#C5A059] bg-[#1B1F2A]"
                        : "border-[#222633] bg-[#08090C] text-[#ECEFF4]"
                    }`}
                  >
                    {editMode ? "Editing Custom Draft" : "Edit Custom Bounds"}
                  </button>

                  <button
                    type="button"
                    onClick={() => window.print()}
                    className="flex items-center gap-1 px-2 py-0.5 border border-[#222633] bg-[#08090C] text-[#ECEFF4] hover:border-[#C5A059] rounded-[2px] cursor-pointer"
                  >
                    <Printer className="w-3 h-3" />
                    Print Pit Sheet
                  </button>

                  <button
                    type="button"
                    disabled={dispatching || (editMode && hasBoundError)}
                    onClick={() => void handleDispatch()}
                    className="flex items-center gap-1 px-2.5 py-0.5 bg-[#C5A059] hover:bg-[#D4B06A] text-[#08090C] font-semibold rounded-[2px] cursor-pointer disabled:opacity-45"
                  >
                    <Send className="w-3 h-3" />
                    {dispatching ? "Dispatching..." : `Push ${selectedName} (UDP 9877)`}
                  </button>
                </div>
              </div>

              {/* Optimization Gains Summary Ribbon */}
              <div className="grid grid-cols-4 border-b border-[#222633] bg-[#151820] divide-x divide-[#222633] font-mono text-[10px]">
                {matrix.optimization_gains.map((g) => (
                  <div key={g.event} className="px-2.5 py-1.5">
                    <div className="text-[9px] text-[#7E8799] uppercase">{g.event_name}</div>
                    <div className="flex items-baseline justify-between mt-0.5">
                      <span className="text-[#ECEFF4] font-semibold">
                        {g.optimal_time_s.toFixed(3)} s
                      </span>
                      <span className="text-[#10B981]">
                        {g.delta_time_s.toFixed(4)} s ({g.delta_pct.toFixed(2)}%)
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Differential Comparison Table */}
              <div className="flex-1 min-h-0 overflow-auto">
                <table className="w-full border-collapse font-mono text-[11px]">
                  <thead className="sticky top-0 bg-[#151820] border-b border-[#222633] z-10">
                    <tr>
                      <th className="text-left px-2.5 py-2 text-[10px] text-[#7E8799] w-[180px]">
                        PARAMETER [UNIT]
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
                            className={`text-right px-2 py-2 text-[10px] cursor-pointer border-l border-[#222633] ${
                              isSel
                                ? "bg-[#1B1F2A] text-[#C5A059]"
                                : "text-[#ECEFF4] hover:bg-[#1B1F2A]/50"
                            }`}
                          >
                            <div>{col.preset.name}</div>
                            <div className="text-[9px] font-normal text-[#7E8799]">
                              {col.isBase ? "BASE REF" : col.preset.event.toUpperCase()}
                            </div>
                          </th>
                        );
                      })}
                      {editMode ? (
                        <th className="text-right px-2 py-2 text-[10px] text-[#C5A059] border-l border-[#C5A059] bg-[#1B1F2A]">
                          CUSTOM DRAFT
                        </th>
                      ) : null}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#222633]">
                    {PARAM_ROWS.map((row) => {
                      const err = boundViolations[row.key];
                      return (
                        <tr key={row.key} className="hover:bg-[#1B1F2A]/60">
                          <td className="px-2.5 py-1.5 text-[#ECEFF4]">
                            <span>{row.label}</span>{" "}
                            <span className="text-[9px] text-[#7E8799]">[{row.unit}]</span>
                          </td>
                          {allColumns.map((col) => {
                            const val = Number(col.preset[row.key]);
                            const delta =
                              !col.isBase && row.deltaKey ? col.deltas_vs_base[row.deltaKey] : 0;
                            const isSel = col.preset.name === selectedName;
                            return (
                              <td
                                key={col.preset.name}
                                className={`px-2 py-1.5 text-right border-l border-[#222633] ${
                                  isSel ? "bg-[#1B1F2A]/70" : ""
                                }`}
                              >
                                <div className="text-[#ECEFF4]">{val.toFixed(row.decimals)}</div>
                                {!col.isBase && typeof delta === "number" && Math.abs(delta) > 1e-5 ? (
                                  <div
                                    className={`text-[9px] ${
                                      delta > 0 ? "text-[#C5A059]" : "text-[#38BDF8]"
                                    }`}
                                  >
                                    {delta > 0 ? "+" : ""}
                                    {delta.toFixed(row.decimals)}
                                  </div>
                                ) : null}
                              </td>
                            );
                          })}
                          {editMode && customDraft ? (
                            <td className="px-2 py-1 text-right border-l border-[#C5A059] bg-[#08090C]">
                              {row.editable ? (
                                <div>
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
                                    className={`w-[78px] bg-[#0F1116] border px-1.5 py-0.5 text-right rounded-[2px] ${
                                      err
                                        ? "border-[#DC2626] text-[#DC2626]"
                                        : "border-[#222633] text-[#ECEFF4]"
                                    }`}
                                  />
                                  {err ? (
                                    <div className="text-[8px] text-[#DC2626] mt-0.5">{err}</div>
                                  ) : null}
                                </div>
                              ) : (
                                <span className="text-[#7E8799]">
                                  {Number(customDraft[row.key]).toFixed(row.decimals)}
                                </span>
                              )}
                            </td>
                          ) : null}
                        </tr>
                      );
                    })}
                    {/* String metadata rows: TV Map & Control Law */}
                    <tr className="bg-[#151820]/50">
                      <td className="px-2.5 py-1.5 text-[#7E8799]">TV Map File</td>
                      {allColumns.map((col) => (
                        <td
                          key={col.preset.name}
                          className="px-2 py-1.5 text-right text-[10px] text-[#C5A059] border-l border-[#222633]"
                        >
                          {col.preset.tv_map}
                        </td>
                      ))}
                      {editMode ? <td className="border-l border-[#C5A059]" /> : null}
                    </tr>
                    <tr className="bg-[#151820]/50">
                      <td className="px-2.5 py-1.5 text-[#7E8799]">Control Law Mode</td>
                      {allColumns.map((col) => (
                        <td
                          key={col.preset.name}
                          className="px-2 py-1.5 text-right text-[10px] text-[#ECEFF4] border-l border-[#222633]"
                        >
                          {col.preset.control_law_mode.toUpperCase()}
                        </td>
                      ))}
                      {editMode ? <td className="border-l border-[#C5A059]" /> : null}
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
                <div className="w-full h-full min-h-0 flex flex-col bg-[#0F1116] overflow-y-auto">
                  <div className="panel-header-bar">
                    <span className="panel-title-label">
                      FSG / FS Spain Points Sensitivity Simulator
                    </span>
                    <span className="text-[9px] font-mono text-[#C5A059]">
                      CALCULATED SENSITIVITY
                    </span>
                  </div>

                  <div className="p-2.5 space-y-2.5 font-mono text-[10px]">
                    <div className="text-[9px] text-[#7E8799] leading-snug">
                      Anchored to validated Endurance + Efficiency baseline: 282.69 pts (FSG) /
                      335.42 pts (FS Spain) @ 3.12 kWh | Setup optimization gain: +
                      {matrix.delta_total_pts.toFixed(2)} dynamic pts.
                    </div>

                    <div className="space-y-1">
                      <div className="flex justify-between">
                        <span className="text-[#7E8799]">Delta Mass [kg]</span>
                        <span className="text-[#ECEFF4]">
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
                      />
                    </div>

                    <div className="space-y-1">
                      <div className="flex justify-between">
                        <span className="text-[#7E8799]">Downforce ClA [%]</span>
                        <span className="text-[#ECEFF4]">
                          {deltaClAPct >= 0 ? "+" : ""}
                          {deltaClAPct}% ({(2.35 * (1 + deltaClAPct / 100)).toFixed(2)} m2)
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
                      />
                    </div>

                    <div className="space-y-1">
                      <div className="flex justify-between">
                        <span className="text-[#7E8799]">Endurance Energy Budget [kWh]</span>
                        <span className="text-[#C5A059]">{energyBudgetKwh.toFixed(2)} kWh</span>
                      </div>
                      <input
                        type="range"
                        min={2.8}
                        max={3.5}
                        step={0.02}
                        value={energyBudgetKwh}
                        onChange={(e) => setEnergyBudgetKwh(parseFloat(e.target.value))}
                        className="eng-slider"
                      />
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-[#7E8799]">Compound Selection</span>
                      <div className="flex border border-[#222633] rounded-[2px] bg-[#08090C]">
                        {(["R25B", "R20"] as const).map((c) => (
                          <button
                            key={c}
                            type="button"
                            onClick={() => setSimCompound(c)}
                            className={`px-2 py-0.5 cursor-pointer ${
                              simCompound === c ? "bg-[#1B1F2A] text-[#C5A059]" : "text-[#7E8799]"
                            }`}
                          >
                            {c}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-1.5 pt-1 border-t border-[#222633]">
                      <div className="bg-[#151820] border border-[#222633] px-2 py-1.5">
                        <div className="text-[9px] text-[#7E8799]">FSG END + EFF</div>
                        <div className="text-[12px] text-[#ECEFF4] font-semibold">
                          {sensitivity.fsgEndEffPts.toFixed(2)} pts
                        </div>
                        <div
                          className={
                            sensitivity.fsgDelta >= 0 ? "text-[#10B981]" : "text-[#DC2626]"
                          }
                        >
                          {sensitivity.fsgDelta >= 0 ? "+" : ""}
                          {sensitivity.fsgDelta.toFixed(2)} pts vs base
                        </div>
                      </div>
                      <div className="bg-[#151820] border border-[#222633] px-2 py-1.5">
                        <div className="text-[9px] text-[#7E8799]">FS SPAIN END + EFF</div>
                        <div className="text-[12px] text-[#ECEFF4] font-semibold">
                          {sensitivity.fssEndEffPts.toFixed(2)} pts
                        </div>
                        <div
                          className={
                            sensitivity.fssDelta >= 0 ? "text-[#10B981]" : "text-[#DC2626]"
                          }
                        >
                          {sensitivity.fssDelta >= 0 ? "+" : ""}
                          {sensitivity.fssDelta.toFixed(2)} pts vs base
                        </div>
                      </div>
                      <div className="bg-[#151820] border border-[#222633] px-2 py-1">
                        <div className="text-[9px] text-[#7E8799]">PROJ AUTOCROSS</div>
                        <div className="text-[#ECEFF4]">
                          {sensitivity.projAutocross.toFixed(2)} s (
                          {sensitivity.deltaAutocross >= 0 ? "+" : ""}
                          {sensitivity.deltaAutocross.toFixed(2)} s)
                        </div>
                      </div>
                      <div className="bg-[#151820] border border-[#222633] px-2 py-1">
                        <div className="text-[9px] text-[#7E8799]">PROJ ENDURANCE 22km</div>
                        <div className="text-[#ECEFF4]">
                          {sensitivity.projEndurance.toFixed(1)} s (
                          {sensitivity.deltaEndurance >= 0 ? "+" : ""}
                          {sensitivity.deltaEndurance.toFixed(1)} s)
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
        <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "2px solid #000", paddingBottom: "6px", marginBottom: "10px" }}>
          <div>
            <h1 style={{ margin: 0, fontSize: "16px", fontWeight: 700 }}>
              TECNUN eRACING // TeR27 4WD TRACKSIDE SETUP SHEET
            </h1>
            <div style={{ fontSize: "11px" }}>
              Preset: {activeSetup.name} ({activeSetup.event.toUpperCase()}) — {activeSetup.description}
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
