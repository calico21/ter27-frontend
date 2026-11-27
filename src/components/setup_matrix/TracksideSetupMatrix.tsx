import React, { useEffect, useMemo, useState } from "react";
import { Printer, RotateCcw, Send } from "lucide-react";
import type { SetupsMatrixResponse, SetupValues } from "../../types";
import { applySetupPreset, fetchSetupsMatrix } from "../../services/apiClient";
import { useTelemetryStore } from "../../state/telemetryStore";
import { SplitPane } from "../layout/SplitPane";
import { InstrumentHeader, PrecisionControl } from "../shared/PrecisionControl";

interface ParamRowSpec {
  key: keyof SetupValues;
  deltaKey?: string;
  boundKey?: string;
  label: string;
  unit: string;
  decimals: number;
  min?: number;
  max?: number;
  step?: number;
  editable?: boolean;
}

const PARAM_ROWS: ParamRowSpec[] = [
  { key: "lltd", deltaKey: "lltd", boundKey: "lltd", label: "LLTD Front", unit: "ratio", decimals: 3, min: 0.36, max: 0.58, step: 0.005, editable: true },
  { key: "camber_front_deg", deltaKey: "camber_front_deg", boundKey: "camber_f_deg", label: "Camber Front", unit: "deg", decimals: 2, min: -4.5, max: 0.0, step: 0.05, editable: true },
  { key: "camber_rear_deg", deltaKey: "camber_rear_deg", boundKey: "camber_r_deg", label: "Camber Rear", unit: "deg", decimals: 2, min: -4.0, max: 0.0, step: 0.05, editable: true },
  { key: "toe_front_deg", deltaKey: "toe_front_deg", boundKey: "toe_f_deg", label: "Toe Front", unit: "deg", decimals: 2, min: -1.5, max: 1.5, step: 0.05, editable: true },
  { key: "toe_rear_deg", deltaKey: "toe_rear_deg", boundKey: "toe_r_deg", label: "Toe Rear", unit: "deg", decimals: 2, min: -1.5, max: 1.5, step: 0.05, editable: true },
  { key: "brake_bias", deltaKey: "brake_bias", boundKey: "brake_bias", label: "Brake Bias F", unit: "ratio", decimals: 3, min: 0.50, max: 0.72, step: 0.005, editable: true },
  { key: "rake_mm", deltaKey: "rake_mm", boundKey: "rake_mm", label: "Aero Rake", unit: "mm", decimals: 2, min: -6.0, max: 8.0, step: 0.25, editable: true },
  { key: "power_limit_kw", deltaKey: "power_limit_kw", label: "HV Power Lim", unit: "kW", decimals: 1, min: 40, max: 80, step: 1, editable: true },
  { key: "spring_rate_front_n_m", deltaKey: "spring_rate_front_n_m", label: "Spring Rate F", unit: "N/m", decimals: 0 },
  { key: "spring_rate_rear_n_m", deltaKey: "spring_rate_rear_n_m", label: "Spring Rate R", unit: "N/m", decimals: 0 },
  { key: "arb_front_nm_rad", deltaKey: "arb_front_nm_rad", label: "ARB Front", unit: "Nm/rad", decimals: 1 },
  { key: "arb_rear_nm_rad", deltaKey: "arb_rear_nm_rad", label: "ARB Rear", unit: "Nm/rad", decimals: 1 },
  { key: "tire_pressure_front_bar", label: "Pressure Front", unit: "bar", decimals: 2 },
  { key: "tire_pressure_rear_bar", label: "Pressure Rear", unit: "bar", decimals: 2 },
];

const SANDBOX_ROWS = PARAM_ROWS.filter((r) => r.editable);

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
  const [isCustomModified, setIsCustomModified] = useState<boolean>(false);
  const [dispatching, setDispatching] = useState<boolean>(false);

  const [coldAmbTempC, setColdAmbTempC] = useState<number>(22);
  const [targetHotTempC, setTargetHotTempC] = useState<number>(75);
  const [targetHotBarF, setTargetHotBarF] = useState<number>(0.83);
  const [targetHotBarR, setTargetHotBarR] = useState<number>(0.83);

  useEffect(() => {
    let active = true;
    fetchSetupsMatrix(forceOfflineMode).then((res) => {
      if (!active) return;
      setMatrix(res.data);
      const found = res.data.presets.find((p) => p.preset.name === selectedName);
      setCustomDraft(found ? { ...found.preset } : { ...res.data.base_setup });
      setIsCustomModified(false);
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

  const selectedPreset: SetupValues | null = useMemo(() => {
    if (!matrix) return null;
    if (selectedName === matrix.base_setup.name) return matrix.base_setup;
    return matrix.presets.find((p) => p.preset.name === selectedName)?.preset ?? matrix.base_setup;
  }, [matrix, selectedName]);

  const activeSetup: SetupValues | null = useMemo(() => {
    if (isCustomModified && customDraft) return customDraft;
    return selectedPreset;
  }, [customDraft, isCustomModified, selectedPreset]);

  const boundViolations = useMemo(() => {
    const errors: Record<string, string> = {};
    if (!customDraft || !vehicleOverview?.setup_bounds) return errors;
    const bounds = vehicleOverview.setup_bounds;
    for (const row of PARAM_ROWS) {
      if (!row.boundKey || !bounds[row.boundKey]) continue;
      const [lo, hi] = bounds[row.boundKey];
      const val = Number(customDraft[row.key]);
      if (val < lo || val > hi) {
        errors[row.key] = `[${lo}, ${hi}]`;
      }
    }
    return errors;
  }, [customDraft, vehicleOverview]);

  const hasBoundError = Object.keys(boundViolations).length > 0;

  const understeerShiftDegPerG = useMemo(() => {
    if (!matrix || !activeSetup) return 0;
    const dLltd = activeSetup.lltd - matrix.base_setup.lltd;
    const dRake = activeSetup.rake_mm - matrix.base_setup.rake_mm;
    const dToeF = activeSetup.toe_front_deg - matrix.base_setup.toe_front_deg;
    return dLltd * 4.8 - dRake * 0.045 - dToeF * 0.22;
  }, [activeSetup, matrix]);

  const coldPressures = useMemo(() => {
    const tColdK = coldAmbTempC + 273.15;
    const tHotK = targetHotTempC + 273.15;
    const calcCold = (hotGaugeBar: number) => {
      const pHotAbs = hotGaugeBar + 1.01325;
      const pColdAbs = pHotAbs * (tColdK / tHotK) - 0.018;
      return Math.max(0.45, pColdAbs - 1.01325);
    };
    const coldF = calcCold(targetHotBarF);
    const coldR = calcCold(targetHotBarR);
    return {
      coldFBar: coldF,
      coldRBar: coldR,
      coldFPsi: coldF * 14.5038,
      coldRPsi: coldR * 14.5038,
      hotRiseFBar: targetHotBarF - coldF,
      hotRiseRBar: targetHotBarR - coldR,
    };
  }, [coldAmbTempC, targetHotBarF, targetHotBarR, targetHotTempC]);

  const handleDispatch = async () => {
    if (!activeSetup) return;
    if (isCustomModified && hasBoundError) {
      pushToast({
        level: "limit",
        title: "Setup Bounds Violation",
        detail: "Correct out-of-range mechanical parameters before UDP 9877 dispatch.",
      });
      return;
    }

    setDispatching(true);
    const payload = isCustomModified
      ? { setup: activeSetup as unknown as Record<string, unknown> }
      : { preset: activeSetup.name };
    const res = await applySetupPreset(payload, forceOfflineMode);
    setDispatching(false);
    setActiveSetupName(isCustomModified ? `${activeSetup.name}_custom` : activeSetup.name);
    pushToast({
      level: res.live ? "nominal" : "info",
      title: res.live
        ? `UDP 9877 Dispatched: ${activeSetup.name}`
        : `Validated Locally: ${activeSetup.name}`,
      detail: res.data.message,
    });
  };

  if (!matrix || !activeSetup || !customDraft) {
    return (
      <div className="machined-panel w-full h-full flex items-center justify-center text-[11.5px] font-mono text-[#94A3B8]">
        Loading trackside setup differential matrix...
      </div>
    );
  }

  const kuBarPct = Math.max(0, Math.min(100, 50 + understeerShiftDegPerG * 42));

  return (
    <div className="w-full h-full min-h-0 overflow-hidden">
      <div className="w-full h-full min-h-0 no-print">
        <SplitPane
          direction="vertical"
          initialRatio={0.54}
          minRatio={0.38}
          maxRatio={0.68}
          first={
            <div className="machined-panel w-full h-full min-h-0 flex flex-col overflow-hidden">
              <InstrumentHeader
                title="Trackside Setup Differential Matrix"
                subtitle={`Active: ${activeSetupName}`}
                right={
                  <>
                    <span
                      className={`status-pill !text-[9.5px] font-mono ${
                        Math.abs(understeerShiftDegPerG) < 0.05
                          ? "status-pill-muted"
                          : understeerShiftDegPerG > 0
                            ? "status-pill-caution"
                            : "status-pill-nominal"
                      }`}
                    >
                      ΔKu {understeerShiftDegPerG >= 0 ? "+" : ""}
                      {understeerShiftDegPerG.toFixed(2)} °/g
                    </span>

                    <button
                      type="button"
                      onClick={() => window.print()}
                      className="h-[21px] px-2 rounded-[3px] border border-[#222633] bg-[#151820] text-[#CBD5E1] hover:border-[#C5A059]/45 hover:text-[#DFBE78] flex items-center gap-1 text-[10px] font-medium cursor-pointer transition-colors"
                    >
                      <Printer className="w-3 h-3" />
                      Print Pit Sheet
                    </button>

                    <button
                      type="button"
                      disabled={dispatching || (isCustomModified && hasBoundError)}
                      onClick={() => void handleDispatch()}
                      className="h-[21px] px-2.5 rounded-[3px] bg-[#C5A059] hover:bg-[#DFBE78] text-[#07080B] font-semibold text-[10px] flex items-center gap-1 cursor-pointer disabled:opacity-45 transition-colors"
                    >
                      <Send className="w-3 h-3" />
                      {dispatching
                        ? "Dispatching..."
                        : `Apply ${isCustomModified ? "Custom" : selectedName} (UDP 9877)`}
                    </button>
                  </>
                }
              />

              {/* Compact Event Optimization Gains Strip */}
              <div className="grid grid-cols-4 gap-1.5 p-1.5 bg-[#0C0E14] border-b border-[#222633] shrink-0">
                {matrix.optimization_gains.map((g) => (
                  <div
                    key={g.event}
                    className="rounded-[3px] bg-[#141720] border border-[#222633] px-2.5 py-1 flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <div className="text-[9.5px] text-[#7E8899] truncate">{g.event_name}</div>
                      <div className="font-mono text-[11.5px] font-semibold text-[#ECEFF4] tabular">
                        {g.optimal_time_s.toFixed(3)} s
                      </div>
                    </div>
                    <span className="status-pill status-pill-nominal !text-[9.5px] font-mono shrink-0">
                      {g.delta_time_s.toFixed(3)} s
                    </span>
                  </div>
                ))}
              </div>

              {/* Scrollable High-Density Comparison Table */}
              <div className="flex-1 min-h-0 overflow-auto">
                <table className="w-full border-collapse text-[11px]">
                  <thead className="sticky top-0 bg-[#12151D] border-b border-[#222633] z-10">
                    <tr>
                      <th className="text-left px-3 py-1.5 font-medium text-[#7E8899] w-[180px]">
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
                              setIsCustomModified(false);
                            }}
                            className={`text-right px-2.5 py-1.5 cursor-pointer border-l border-[#1E222E] transition-colors ${
                              isSel
                                ? "bg-[#C5A059]/12 text-[#DFBE78]"
                                : "text-[#CBD5E1] hover:bg-[#171B26]"
                            }`}
                          >
                            <div className="font-mono text-[10.5px] font-semibold">
                              {col.preset.name}
                            </div>
                            <div className="text-[9.5px] font-normal text-[#7E8899]">
                              {col.isBase ? "Base Ref" : col.preset.event}
                            </div>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1A1E2A]">
                    {PARAM_ROWS.map((row) => (
                      <tr key={row.key} className="hover:bg-[#151923] transition-colors">
                        <td className="px-3 py-1.5">
                          <span className="text-[#ECEFF4] font-medium">{row.label}</span>
                          <span className="ml-1.5 font-mono text-[9.5px] text-[#64748B]">
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
                              className={`px-2.5 py-1.5 text-right font-mono tabular border-l border-[#1A1E2A] ${
                                isSel ? "bg-[#C5A059]/[0.05]" : ""
                              }`}
                            >
                              <span className="text-[#ECEFF4]">{val.toFixed(row.decimals)}</span>
                              {hasDelta ? (
                                <span
                                  className={`ml-1.5 inline-block px-1 py-[0.5px] rounded-[2px] text-[9.5px] ${
                                    delta > 0
                                      ? "bg-[#C5A059]/15 text-[#DFBE78]"
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
                      </tr>
                    ))}
                    <tr className="bg-[#0D1017]">
                      <td className="px-3 py-1.5 text-[#7E8899] font-medium">TV Map / Law</td>
                      {allColumns.map((col) => (
                        <td
                          key={col.preset.name}
                          className="px-2.5 py-1.5 text-right font-mono text-[10px] border-l border-[#1A1E2A]"
                        >
                          <span className="text-[#DFBE78]">{col.preset.tv_map}</span>
                          <span className="text-[#64748B] ml-1.5">
                            [{col.preset.control_law_mode}]
                          </span>
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          }
          second={
            <SplitPane
              direction="horizontal"
              initialRatio={0.58}
              minRatio={0.44}
              maxRatio={0.70}
              first={
                <div className="machined-panel w-full h-full min-h-0 flex flex-col overflow-hidden">
                  <InstrumentHeader
                    title="Custom Setup Sandbox"
                    subtitle={isCustomModified ? `Modified from ${selectedName}` : selectedName}
                    right={
                      <>
                        <span
                          className={`status-pill !text-[9.5px] ${
                            hasBoundError ? "status-pill-limit" : "status-pill-nominal"
                          }`}
                        >
                          {hasBoundError ? "Bounds Error" : "Bounds OK"}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            if (selectedPreset) {
                              setCustomDraft({ ...selectedPreset });
                              setIsCustomModified(false);
                            }
                          }}
                          className="h-[20px] px-1.5 rounded-[3px] bg-[#151820] hover:bg-[#1E2432] border border-[#222633] text-[#94A3B8] hover:text-[#ECEFF4] flex items-center gap-1 text-[9.5px] cursor-pointer"
                        >
                          <RotateCcw className="w-2.5 h-2.5" />
                          Reset
                        </button>
                      </>
                    }
                  />

                  <div className="flex-1 min-h-0 p-2 flex flex-col justify-between gap-2 overflow-hidden">
                    <div className="grid grid-cols-2 gap-1.5 overflow-y-auto pr-0.5">
                      {SANDBOX_ROWS.map((row) => {
                        const bounds =
                          row.boundKey && vehicleOverview?.setup_bounds?.[row.boundKey];
                        const minVal = bounds ? bounds[0] : (row.min ?? 0);
                        const maxVal = bounds ? bounds[1] : (row.max ?? 100);
                        const err = boundViolations[row.key];
                        return (
                          <div key={row.key} className="space-y-0.5">
                            <PrecisionControl
                              label={row.label}
                              value={Number(customDraft[row.key])}
                              min={minVal}
                              max={maxVal}
                              step={row.step ?? 0.01}
                              unit={row.unit}
                              decimals={row.decimals}
                              accent={err ? "#DC2626" : "#C5A059"}
                              onChange={(val) => {
                                setCustomDraft((prev) =>
                                  prev ? { ...prev, [row.key]: val } : prev
                                );
                                setIsCustomModified(true);
                              }}
                            />
                            {err ? (
                              <div className="text-[9px] font-mono text-[#F87171] px-1">
                                Mechanical limit {err}
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>

                    {/* Live Understeer Gradient Balance Gauge */}
                    <div className="rounded-[3px] bg-[#141720] border border-[#222633] px-2.5 py-1.5 shrink-0">
                      <div className="flex items-center justify-between text-[10px] font-mono mb-1">
                        <span className="text-[#38BDF8]">Oversteer / Front Bite (-)</span>
                        <span className="text-[#ECEFF4] font-semibold tabular">
                          Understeer Shift ΔKu = {understeerShiftDegPerG >= 0 ? "+" : ""}
                          {understeerShiftDegPerG.toFixed(2)} °/g
                        </span>
                        <span className="text-[#DFBE78]">Understeer Stability (+)</span>
                      </div>
                      <div className="relative h-[6px] rounded-[2px] bg-[#08090C] border border-[#222633] overflow-hidden">
                        <div className="absolute left-1/2 top-0 bottom-0 w-[1px] bg-white/25" />
                        <div
                          className="absolute top-0 bottom-0 w-[6px] -ml-[3px] rounded-[1px]"
                          style={{
                            left: `${kuBarPct}%`,
                            backgroundColor:
                              Math.abs(understeerShiftDegPerG) < 0.05
                                ? "#10B981"
                                : understeerShiftDegPerG > 0
                                  ? "#DFBE78"
                                  : "#38BDF8",
                          }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              }
              second={
                <div className="machined-panel w-full h-full min-h-0 flex flex-col overflow-hidden">
                  <InstrumentHeader
                    title="Cold-to-Hot Tire Pressure"
                    right={
                      <span className="status-pill status-pill-gold !text-[9.5px] font-mono">
                        16.0×7.5-10
                      </span>
                    }
                  />

                  <div className="flex-1 min-h-0 p-2 flex flex-col justify-between gap-2 overflow-hidden">
                    <div className="space-y-1.5">
                      <PrecisionControl
                        label="Ambient Cold"
                        value={coldAmbTempC}
                        min={5}
                        max={45}
                        step={1}
                        unit="°C"
                        decimals={0}
                        onChange={setColdAmbTempC}
                      />
                      <PrecisionControl
                        label="Target Hot"
                        value={targetHotTempC}
                        min={45}
                        max={95}
                        step={1}
                        unit="°C"
                        decimals={0}
                        onChange={setTargetHotTempC}
                      />
                      <PrecisionControl
                        label="Hot Front"
                        value={targetHotBarF}
                        min={0.6}
                        max={1.3}
                        step={0.01}
                        unit="bar"
                        decimals={2}
                        accent="#C5A059"
                        onChange={setTargetHotBarF}
                      />
                      <PrecisionControl
                        label="Hot Rear"
                        value={targetHotBarR}
                        min={0.6}
                        max={1.3}
                        step={0.01}
                        unit="bar"
                        decimals={2}
                        accent="#38BDF8"
                        onChange={setTargetHotBarR}
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-1.5 shrink-0">
                      <div className="rounded-[3px] bg-[#141720] border border-[#222633] px-2.5 py-2">
                        <div className="text-[9.5px] text-[#7E8899]">Set Cold Front (FL/FR)</div>
                        <div className="font-mono text-[15px] font-semibold text-[#DFBE78] tabular mt-0.5">
                          {coldPressures.coldFBar.toFixed(2)} bar
                        </div>
                        <div className="font-mono text-[9.5px] text-[#94A3B8] tabular">
                          {coldPressures.coldFPsi.toFixed(1)} psi · +{coldPressures.hotRiseFBar.toFixed(2)} bar
                        </div>
                      </div>

                      <div className="rounded-[3px] bg-[#141720] border border-[#222633] px-2.5 py-2">
                        <div className="text-[9.5px] text-[#7E8899]">Set Cold Rear (RL/RR)</div>
                        <div className="font-mono text-[15px] font-semibold text-[#38BDF8] tabular mt-0.5">
                          {coldPressures.coldRBar.toFixed(2)} bar
                        </div>
                        <div className="font-mono text-[9.5px] text-[#94A3B8] tabular">
                          {coldPressures.coldRPsi.toFixed(1)} psi · +{coldPressures.hotRiseRBar.toFixed(2)} bar
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
