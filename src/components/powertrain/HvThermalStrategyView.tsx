import React, { useMemo, useState } from "react";
import { RotateCcw } from "lucide-react";
import {
  EnduranceThermalInput,
  solveEndurancePowertrainThermal,
} from "../../services/physics/powertrainThermalModel";
import { InstrumentHeader, PrecisionControl } from "../shared/PrecisionControl";
import { TelemetryCanvasChart } from "../shared/TelemetryCanvasChart";

const DEFAULT_ENDURANCE: EnduranceThermalInput = {
  energyBudgetKwh: 3.12,
  regenMaxKw: 22,
  ambientTempC: 28,
};

export function HvThermalStrategyView() {
  const [inputs, setInputs] = useState<EnduranceThermalInput>(DEFAULT_ENDURANCE);
  const [hoverLap, setHoverLap] = useState<number | null>(null);

  const sol = useMemo(() => solveEndurancePowertrainThermal(inputs), [inputs]);

  const energySeries = useMemo(
    () => [
      {
        id: "net_kwh",
        label: "Net HV Energy",
        shortLabel: "Net kWh",
        unit: "kWh",
        color: "#C5A059",
        fill: true,
        lineWidth: 2,
        decimals: 2,
        points: sol.laps.map((p) => ({ x: p.lap, y: p.cumulativeEnergyKwh })),
      },
      {
        id: "regen_kwh",
        label: "Regen Recovered",
        shortLabel: "Regen",
        unit: "kWh",
        color: "#38BDF8",
        lineWidth: 1.65,
        decimals: 2,
        points: sol.laps.map((p) => ({ x: p.lap, y: p.regenRecoveredKwh })),
      },
    ],
    [sol.laps]
  );

  const voltageSeries = useMemo(
    () => [
      {
        id: "v_sag",
        label: "Terminal Sag (80 kW)",
        shortLabel: "Sag",
        unit: "V",
        color: "#C5A059",
        fill: true,
        lineWidth: 2,
        decimals: 1,
        points: sol.laps.map((p) => ({ x: p.lap, y: p.packSagVoltageV })),
      },
      {
        id: "v_ocv",
        label: "Pack OCV (144s)",
        shortLabel: "OCV",
        unit: "V",
        color: "#38BDF8",
        dashed: true,
        lineWidth: 1.6,
        decimals: 1,
        points: sol.laps.map((p) => ({ x: p.lap, y: p.packOcvV })),
      },
    ],
    [sol.laps]
  );

  const thermalSeries = useMemo(
    () => [
      {
        id: "t_motor",
        label: "AMK Motor Stator",
        shortLabel: "AMK",
        unit: "°C",
        color: "#C5A059",
        fill: true,
        lineWidth: 1.9,
        decimals: 1,
        points: sol.laps.map((p) => ({ x: p.lap, y: p.motorTempC })),
      },
      {
        id: "t_inv",
        label: "Inverter IGBT",
        shortLabel: "IGBT",
        unit: "°C",
        color: "#38BDF8",
        lineWidth: 1.65,
        decimals: 1,
        points: sol.laps.map((p) => ({ x: p.lap, y: p.inverterTempC })),
      },
      {
        id: "t_cell",
        label: "HV Accumulator Cell",
        shortLabel: "Cell",
        unit: "°C",
        color: "#10B981",
        lineWidth: 1.65,
        decimals: 1,
        points: sol.laps.map((p) => ({ x: p.lap, y: p.cellTempC })),
      },
    ],
    [sol.laps]
  );

  const tireSeries = useMemo(
    () => [
      {
        id: "t_tread",
        label: "R25B Tread Temp",
        shortLabel: "Tread",
        unit: "°C",
        color: "#C5A059",
        fill: true,
        lineWidth: 2,
        decimals: 1,
        points: sol.laps.map((p) => ({ x: p.lap, y: p.tireTreadTempC })),
      },
    ],
    [sol.laps]
  );

  return (
    <div className="w-full h-full min-h-0 flex gap-1.5 overflow-hidden">
      {/* Fixed 268px Left Strategy Rail */}
      <div className="machined-panel w-[268px] shrink-0 h-full min-h-0 flex flex-col overflow-hidden">
        <InstrumentHeader
          title="22 km HV & Thermal"
          right={
            <button
              type="button"
              onClick={() => setInputs(DEFAULT_ENDURANCE)}
              className="h-[20px] px-1.5 rounded-[3px] bg-[#151820] hover:bg-[#1E2432] border border-[#222633] text-[#94A3B8] hover:text-[#ECEFF4] flex items-center gap-1 text-[9.5px] cursor-pointer"
            >
              <RotateCcw className="w-2.5 h-2.5" />
              3.12 kWh
            </button>
          }
        />

        <div className="flex-1 min-h-0 p-2 flex flex-col justify-between gap-2 overflow-hidden">
          <div className="space-y-1.5">
            <div className="text-[9.5px] uppercase tracking-[0.06em] font-mono text-[#7E8899] px-0.5">
              Endurance Operating Strategy
            </div>
            <PrecisionControl
              label="Energy Budget"
              value={inputs.energyBudgetKwh}
              min={2.8}
              max={3.5}
              step={0.02}
              unit="kWh"
              decimals={2}
              onChange={(v) => setInputs((p) => ({ ...p, energyBudgetKwh: v }))}
            />
            <PrecisionControl
              label="Regen Limit"
              value={inputs.regenMaxKw}
              min={0}
              max={25}
              step={1}
              unit="kW"
              decimals={0}
              accent="#38BDF8"
              onChange={(v) => setInputs((p) => ({ ...p, regenMaxKw: v }))}
            />
            <PrecisionControl
              label="Ambient Track"
              value={inputs.ambientTempC}
              min={18}
              max={45}
              step={1}
              unit="°C"
              decimals={0}
              onChange={(v) => setInputs((p) => ({ ...p, ambientTempC: v }))}
            />
            <div className="px-1 text-[9.5px] font-mono text-[#64748B]">
              144s 6.8 kWh HV Pack · Sweet Spot 3.12 kWh
            </div>
          </div>

          {/* Compact 2x2 KPI Grid */}
          <div className="grid grid-cols-2 gap-1.5">
            <div className="rounded-[3px] bg-[#141720] border border-[#222633] px-2 py-1.5">
              <div className="text-[9.5px] text-[#7E8899]">FSG End + Eff</div>
              <div className="font-mono text-[13px] font-semibold text-[#ECEFF4] tabular mt-0.5">
                {sol.fsgCombinedPts.toFixed(2)}
              </div>
              <div
                className={`font-mono text-[9.5px] tabular ${
                  sol.fsgDeltaVsSweetSpotPts >= -0.2 ? "text-[#34D399]" : "text-[#FBBF24]"
                }`}
              >
                {sol.fsgDeltaVsSweetSpotPts >= 0 ? "+" : ""}
                {sol.fsgDeltaVsSweetSpotPts.toFixed(2)} pts
              </div>
            </div>

            <div className="rounded-[3px] bg-[#141720] border border-[#222633] px-2 py-1.5">
              <div className="text-[9.5px] text-[#7E8899]">22 km Time</div>
              <div className="font-mono text-[13px] font-semibold text-[#DFBE78] tabular mt-0.5">
                {sol.projectedEnduranceTimeS.toFixed(1)} s
              </div>
              <div className="font-mono text-[9.5px] text-[#38BDF8] tabular">
                +{sol.totalRegenKwh.toFixed(2)} kWh
              </div>
            </div>

            <div className="rounded-[3px] bg-[#141720] border border-[#222633] px-2 py-1.5">
              <div className="text-[9.5px] text-[#7E8899]">Min Sag Volt</div>
              <div
                className={`font-mono text-[13px] font-semibold tabular mt-0.5 ${
                  sol.hvMinVoltageSafe ? "text-[#34D399]" : "text-[#F87171]"
                }`}
              >
                {sol.minTerminalVoltageV.toFixed(1)} V
              </div>
              <div className="font-mono text-[9.5px] text-[#7E8899]">Floor 432 V</div>
            </div>

            <div className="rounded-[3px] bg-[#141720] border border-[#222633] px-2 py-1.5">
              <div className="text-[9.5px] text-[#7E8899]">AMK / Cell Peak</div>
              <div
                className={`font-mono text-[13px] font-semibold tabular mt-0.5 ${
                  sol.thermalDerateWarning ? "text-[#FBBF24]" : "text-[#ECEFF4]"
                }`}
              >
                {sol.peakMotorTempC.toFixed(0)}° / {sol.peakCellTempC.toFixed(0)}°
              </div>
              <div className="font-mono text-[9.5px] text-[#7E8899]">
                IGBT {sol.peakInverterTempC.toFixed(0)} °C
              </div>
            </div>
          </div>

          {/* EV Rules & Thermal Gate */}
          <div className="rounded-[3px] bg-[#141720] border border-[#222633] p-2 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-semibold text-[#CBD5E1]">
                EV Rules Thermal Gate
              </span>
              <span
                className={`status-pill !text-[9px] ${
                  sol.thermalDerateWarning || !sol.hvMinVoltageSafe
                    ? "status-pill-caution"
                    : "status-pill-nominal"
                }`}
              >
                {sol.thermalDerateWarning || !sol.hvMinVoltageSafe ? "Check Margin" : "Compliant"}
              </span>
            </div>
            <div className="space-y-1 font-mono text-[9.5px] text-[#94A3B8]">
              <div className="flex justify-between">
                <span>EV 60 °C Cell Ceiling</span>
                <span className={sol.peakCellTempC <= 60 ? "text-[#34D399]" : "text-[#F87171]"}>
                  {sol.peakCellTempC.toFixed(1)} / 60.0 °C
                </span>
              </div>
              <div className="flex justify-between">
                <span>AMK Derate Limit</span>
                <span className={sol.peakMotorTempC <= 115 ? "text-[#34D399]" : "text-[#FBBF24]"}>
                  {sol.peakMotorTempC.toFixed(1)} / 115.0 °C
                </span>
              </div>
              <div className="flex justify-between">
                <span>R25B Optimal Window</span>
                <span className="text-[#DFBE78]">{sol.lapsInOptimalTireWindow} / 18 laps</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Right 2x2 Synchronized TelemetryCanvasChart Matrix */}
      <div className="flex-1 min-w-0 h-full min-h-0 grid grid-cols-2 grid-rows-2 gap-1.5 overflow-hidden">
        <TelemetryCanvasChart
          title="Cumulative HV Energy & Regen"
          xLabel="Endurance Lap (22 km)"
          yLabel="kWh"
          xDomain={[0, 18]}
          yDomain={[0, 3.8]}
          series={energySeries}
          referenceLines={[
            { axis: "y", value: 3.12, color: "#10B981", label: "3.12 kWh Sweet Spot" },
          ]}
          activeCursorX={hoverLap}
          onHoverX={setHoverLap}
          footerNote={`Net Target ${inputs.energyBudgetKwh.toFixed(2)} kWh · Regen +${sol.totalRegenKwh.toFixed(2)} kWh`}
        />

        <TelemetryCanvasChart
          title="HV Pack Voltage Sag (80 kW Peaks)"
          xLabel="Endurance Lap"
          yLabel="Volts (V)"
          xDomain={[0, 18]}
          yDomain={[410, 610]}
          series={voltageSeries}
          referenceLines={[
            { axis: "y", value: 432, color: "#DC2626", label: "BMS Cutoff 432 V" },
          ]}
          activeCursorX={hoverLap}
          onHoverX={setHoverLap}
          footerNote={`144s HV Pack · Min Terminal Sag ${sol.minTerminalVoltageV.toFixed(1)} V`}
        />

        <TelemetryCanvasChart
          title="Motor, Inverter & HV Cell Temperatures"
          xLabel="Endurance Lap"
          yLabel="Temp (°C)"
          xDomain={[0, 18]}
          yDomain={[15, 130]}
          series={thermalSeries}
          referenceLines={[
            { axis: "y", value: 115, color: "#DC2626", label: "AMK Derate 115 °C" },
            { axis: "y", value: 60, color: "#D97706", label: "EV Cell Limit 60 °C" },
          ]}
          activeCursorX={hoverLap}
          onHoverX={setHoverLap}
          footerNote={`Peak AMK ${sol.peakMotorTempC.toFixed(1)} °C · IGBT ${sol.peakInverterTempC.toFixed(1)} °C · Cell ${sol.peakCellTempC.toFixed(1)} °C`}
        />

        <TelemetryCanvasChart
          title="Tire Tread Warm-Up (Hoosier R25B)"
          xLabel="Endurance Lap"
          yLabel="Tread (°C)"
          xDomain={[0, 18]}
          yDomain={[15, 100]}
          series={tireSeries}
          bands={[
            {
              axis: "y",
              from: 70,
              to: 85,
              color: "rgba(16, 185, 129, 0.14)",
              label: "70–85 °C Optimal Grip",
            },
          ]}
          activeCursorX={hoverLap}
          onHoverX={setHoverLap}
          footerNote={`Hoosier 16.0×7.5-10 R25B · ${sol.lapsInOptimalTireWindow}/18 laps inside peak window`}
        />
      </div>
    </div>
  );
}
