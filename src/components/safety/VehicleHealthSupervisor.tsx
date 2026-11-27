import React, { useEffect, useMemo, useRef } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  OctagonAlert,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import {
  SafetyFaultInjection,
  useTelemetryStore,
} from "../../state/telemetryStore";
import { SplitPane } from "../layout/SplitPane";
import { InstrumentHeader } from "../shared/PrecisionControl";

type SensorSeverity = "NOMINAL" | "CAUTION" | "TRIP";

interface PlausibilityRow {
  id: string;
  channel: string;
  rule: string;
  reading: string;
  bound: string;
  status: SensorSeverity;
  detail: string;
}

const WHEEL_R_M = 0.203;

function statusPillClass(status: SensorSeverity): string {
  if (status === "TRIP") return "status-pill status-pill-limit";
  if (status === "CAUTION") return "status-pill status-pill-caution";
  return "status-pill status-pill-nominal";
}

function WaveformMonitorCanvas({
  mode,
}: {
  mode: "live_ekf" | "freeze_frame";
}) {
  const { ringBufferRef, preFaultFreezeFrame } = useTelemetryStore();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let rafId = 0;

    const draw = () => {
      const canvas = canvasRef.current;
      const parent = canvas?.parentElement;
      if (!canvas || !parent) {
        rafId = requestAnimationFrame(draw);
        return;
      }

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = parent.clientWidth;
      const height = parent.clientHeight;
      if (width < 40 || height < 40) {
        rafId = requestAnimationFrame(draw);
        return;
      }

      if (
        canvas.width !== Math.floor(width * dpr) ||
        canvas.height !== Math.floor(height * dpr)
      ) {
        canvas.width = Math.floor(width * dpr);
        canvas.height = Math.floor(height * dpr);
      }

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        rafId = requestAnimationFrame(draw);
        return;
      }

      ctx.save();
      ctx.scale(dpr, dpr);

      ctx.fillStyle = "#08090C";
      ctx.fillRect(0, 0, width, height);

      const padLeft = 40;
      const padRight = 42;
      const padTop = 18;
      const padBottom = 18;
      const plotW = Math.max(40, width - padLeft - padRight);
      const plotH = Math.max(30, height - padTop - padBottom);

      ctx.strokeStyle = "rgba(255,255,255,0.045)";
      ctx.lineWidth = 1;
      for (let i = 0; i <= 4; i++) {
        const y = padTop + (plotH * i) / 4;
        ctx.save();
        ctx.setLineDash([3, 4]);
        ctx.beginPath();
        ctx.moveTo(padLeft, Math.round(y) + 0.5);
        ctx.lineTo(padLeft + plotW, Math.round(y) + 0.5);
        ctx.stroke();
        ctx.restore();
      }

      if (mode === "live_ekf") {
        const rb = ringBufferRef.current;
        const maxSamples = Math.min(rb.count, 360);
        const startLogical = Math.max(0, rb.count - maxSamples);
        const betaMax = 4.0;
        const latMax = 300;

        const threshY = padTop + plotH - (2.5 / betaMax) * plotH;
        ctx.save();
        ctx.strokeStyle = "rgba(220, 38, 38, 0.6)";
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(padLeft, Math.round(threshY) + 0.5);
        ctx.lineTo(padLeft + plotW, Math.round(threshY) + 0.5);
        ctx.stroke();
        ctx.restore();

        ctx.font = '9.5px "JetBrains Mono", monospace';
        ctx.fillStyle = "#F87171";
        ctx.textAlign = "left";
        ctx.fillText("Soft-Stop 2.5°", padLeft + 5, threshY - 4);

        if (maxSamples >= 2) {
          // Gradient under-fill for |Delta Beta|
          ctx.save();
          const grad = ctx.createLinearGradient(0, padTop, 0, padTop + plotH);
          grad.addColorStop(0, "rgba(197, 160, 89, 0.16)");
          grad.addColorStop(1, "rgba(197, 160, 89, 0.0)");
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.moveTo(padLeft, padTop + plotH);
          for (let s = 0; s < maxSamples; s++) {
            const phys = rb.getPhysicalIndex(startLogical + s);
            const err = Math.min(betaMax, Math.abs(rb.betaDeg[phys] - rb.ekfBetaDeg[phys]));
            const px = padLeft + (s / (maxSamples - 1)) * plotW;
            const py = padTop + plotH - (err / betaMax) * plotH;
            ctx.lineTo(px, py);
          }
          ctx.lineTo(padLeft + plotW, padTop + plotH);
          ctx.closePath();
          ctx.fill();
          ctx.restore();

          ctx.strokeStyle = "#C5A059";
          ctx.lineWidth = 1.8;
          ctx.beginPath();
          for (let s = 0; s < maxSamples; s++) {
            const phys = rb.getPhysicalIndex(startLogical + s);
            const err = Math.min(betaMax, Math.abs(rb.betaDeg[phys] - rb.ekfBetaDeg[phys]));
            const px = padLeft + (s / (maxSamples - 1)) * plotW;
            const py = padTop + plotH - (err / betaMax) * plotH;
            if (s === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.stroke();

          ctx.strokeStyle = "#38BDF8";
          ctx.lineWidth = 1.45;
          ctx.beginPath();
          for (let s = 0; s < maxSamples; s++) {
            const phys = rb.getPhysicalIndex(startLogical + s);
            const fr = rb.frames[phys];
            const lat = Math.min(latMax, fr ? fr.ekf.sensor_latency_ms : 0);
            const px = padLeft + (s / (maxSamples - 1)) * plotW;
            const py = padTop + plotH - (lat / latMax) * plotH;
            if (s === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.stroke();
        }

        ctx.font = '9px "JetBrains Mono", monospace';
        ctx.fillStyle = "#C5A059";
        ctx.textAlign = "right";
        ctx.fillText("4.0°", padLeft - 5, padTop + 4);
        ctx.fillText("2.0°", padLeft - 5, padTop + plotH / 2);
        ctx.fillText("0.0°", padLeft - 5, padTop + plotH);

        ctx.fillStyle = "#38BDF8";
        ctx.textAlign = "left";
        ctx.fillText("300ms", padLeft + plotW + 4, padTop + 4);
        ctx.fillText("150ms", padLeft + plotW + 4, padTop + plotH / 2);
        ctx.fillText("0ms", padLeft + plotW + 4, padTop + plotH);

        ctx.fillStyle = "#7E8899";
        ctx.textAlign = "left";
        ctx.fillText("Gold: |β-ekf_β| · Cyan: CAN Delay", padLeft, 11);
        ctx.textAlign = "right";
        ctx.fillText("-6.0 s -> Now", padLeft + plotW, height - 5);
      } else {
        const frames = preFaultFreezeFrame;
        if (frames.length < 2) {
          ctx.fillStyle = "#64748B";
          ctx.font = '10.5px "JetBrains Mono", monospace';
          ctx.textAlign = "center";
          ctx.fillText("Awaiting Fault / E-Stop Trigger", width / 2, height / 2 - 6);
          ctx.font = '9.5px "Inter", sans-serif';
          ctx.fillText("Captures 2.0 s (120 frames) pre-trip buffer", width / 2, height / 2 + 10);
        } else {
          const n = frames.length;
          ctx.strokeStyle = "#ECEFF4";
          ctx.lineWidth = 1.7;
          ctx.beginPath();
          for (let i = 0; i < n; i++) {
            const vxKmh = Math.min(120, Math.max(0, frames[i].state.vx * 3.6));
            const px = padLeft + (i / (n - 1)) * plotW;
            const py = padTop + plotH - (vxKmh / 120) * plotH;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.stroke();

          ctx.strokeStyle = "#C5A059";
          ctx.lineWidth = 1.65;
          ctx.beginPath();
          for (let i = 0; i < n; i++) {
            const pNet = Math.max(
              -30,
              Math.min(90, frames[i].hv.p_dc_kw - frames[i].hv.p_regen_kw)
            );
            const px = padLeft + (i / (n - 1)) * plotW;
            const py = padTop + plotH - ((pNet + 30) / 120) * plotH;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.stroke();

          ctx.save();
          ctx.strokeStyle = "#DC2626";
          ctx.lineWidth = 1.4;
          ctx.setLineDash([4, 3]);
          ctx.beginPath();
          ctx.moveTo(padLeft + plotW - 1, padTop);
          ctx.lineTo(padLeft + plotW - 1, padTop + plotH);
          ctx.stroke();
          ctx.restore();

          ctx.font = '9px "JetBrains Mono", monospace';
          ctx.fillStyle = "#ECEFF4";
          ctx.textAlign = "right";
          ctx.fillText("120", padLeft - 5, padTop + 4);
          ctx.fillText("60", padLeft - 5, padTop + plotH / 2);
          ctx.fillText("0", padLeft - 5, padTop + plotH);

          ctx.fillStyle = "#C5A059";
          ctx.textAlign = "left";
          ctx.fillText("+90kW", padLeft + plotW + 4, padTop + 4);
          ctx.fillText("-30kW", padLeft + plotW + 4, padTop + plotH);

          ctx.fillStyle = "#7E8899";
          ctx.textAlign = "left";
          ctx.fillText(`${n}f (${(n / 60).toFixed(1)}s) · vx / kW`, padLeft, 11);
          ctx.fillStyle = "#F87171";
          ctx.textAlign = "right";
          ctx.fillText("T=0.00s", padLeft + plotW - 3, height - 5);
        }
      }

      ctx.restore();
      if (mode === "live_ekf") {
        rafId = requestAnimationFrame(draw);
      }
    };

    rafId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafId);
  }, [mode, preFaultFreezeFrame, ringBufferRef]);

  return <canvas ref={canvasRef} className="block w-full h-full" />;
}

export function VehicleHealthSupervisor() {
  const {
    frame,
    stopState,
    sdcClosed,
    stopReason,
    triggerSoftStop,
    triggerEmergencyStop,
    resetSafetyLatch,
    injectedSafetyFault,
    injectSafetyFault,
    autoInterlocks,
    setAutoInterlocks,
    safetyEvents,
    clearSafetyEvents,
    preFaultFreezeFrame,
    safetyOverlay,
    activeFaultMode,
  } = useTelemetryStore();

  const betaErrDeg = Math.abs(frame.state.beta_deg - frame.ekf.ekf_beta_deg);
  const vxErrMps = Math.abs(frame.state.vx - frame.ekf.ekf_vx);
  const canLatencyMs = frame.ekf.sensor_latency_ms;
  const brakePct = frame.state.brake * 100;
  const bspdViolated = frame.hv.bspd_active || (brakePct > 20 && frame.hv.p_dc_kw > 5.0);
  const appsViolated = safetyOverlay.appsDiffPct > 10.0;
  const netPowerKw = frame.hv.p_dc_kw - frame.hv.p_regen_kw;

  const tireTemps = [
    frame.wheels.fl.temp_c,
    frame.wheels.fr.temp_c,
    frame.wheels.rl.temp_c,
    frame.wheels.rr.temp_c,
  ];
  const maxTireTemp = Math.max(...tireTemps);
  const minTireTemp = Math.min(...tireTemps);
  const tireFault = minTireTemp < -20 || maxTireTemp > 95;

  const maxWheelSpeedSpread = Math.max(
    Math.abs(frame.state.vx * frame.wheels.fl.slip_ratio),
    Math.abs(frame.state.vx * frame.wheels.fr.slip_ratio),
    Math.abs(frame.state.vx * frame.wheels.rl.slip_ratio),
    Math.abs(frame.state.vx * frame.wheels.rr.slip_ratio)
  );
  const frRlTempDiff = Math.abs(frame.wheels.fr.temp_c - frame.wheels.rl.temp_c);
  const frRlSwapDetected = safetyOverlay.frRlSwapActive;

  const yawRestoringNominal =
    Math.abs(frame.state.beta_deg) < 1.2 || frame.hv.tv_mz_nm * frame.state.beta_deg <= 65;

  const plausibilityRows = useMemo<PlausibilityRow[]>(() => {
    return [
      {
        id: "apps",
        channel: "APPS Dual-Channel (T.4.2.5)",
        rule: "|APPS1 - APPS2| <= 10%",
        reading: `${safetyOverlay.appsDiffPct.toFixed(1)} %`,
        bound: "<= 10.0 %",
        status: appsViolated ? "TRIP" : safetyOverlay.appsDiffPct > 6 ? "CAUTION" : "NOMINAL",
        detail: appsViolated ? "Dual-pot implausibility > 10%" : "Hall channels coherent",
      },
      {
        id: "bspd",
        channel: "BSPD Hardware Gate (EV 2.3)",
        rule: "Brk > 20% => P_dc <= 5 kW",
        reading: `Brk ${brakePct.toFixed(0)}% · ${frame.hv.p_dc_kw.toFixed(1)}kW`,
        bound: "<= 5.0 kW",
        status: bspdViolated ? "TRIP" : "NOMINAL",
        detail: bspdViolated ? "Hard brake + >5kW HV discharge" : "Standalone comparator nominal",
      },
      {
        id: "wheels",
        channel: "4-Wheel Speed & FR<->RL Swap",
        rule: "ω·r vs vx + cross-check",
        reading: frRlSwapDetected
          ? `SWAP (ΔT ${frRlTempDiff.toFixed(1)}°C)`
          : `Δv ${maxWheelSpeedSpread.toFixed(2)} m/s`,
        bound: "Coherent 4W",
        status: frRlSwapDetected ? "TRIP" : maxWheelSpeedSpread > 2.2 ? "CAUTION" : "NOMINAL",
        detail: frRlSwapDetected
          ? "FR/RL wheel harness inversion"
          : `r=${WHEEL_R_M}m · 4 encoders locked`,
      },
      {
        id: "tire_ir",
        channel: "Tire IR Thermal Integrity",
        rule: "Open / Short / >95°C",
        reading: `${minTireTemp.toFixed(0)}..${maxTireTemp.toFixed(0)} °C`,
        bound: "15..95 °C",
        status: tireFault ? "TRIP" : maxTireTemp > 84 ? "CAUTION" : "NOMINAL",
        detail: tireFault ? "IR rail out of valid range" : "4 corners within thermal window",
      },
      {
        id: "can_ekf",
        channel: "IMU, SAS & CAN Watchdog",
        rule: "CAN <= 200ms · |Δβ| <= 2.5°",
        reading: `${canLatencyMs.toFixed(0)}ms · ${betaErrDeg.toFixed(2)}°`,
        bound: "200ms / 2.5°",
        status:
          canLatencyMs > 200 || betaErrDeg > 2.5
            ? "TRIP"
            : canLatencyMs > 140 || betaErrDeg > 1.2
              ? "CAUTION"
              : "NOMINAL",
        detail:
          canLatencyMs > 200
            ? "CAN heartbeat timeout; EKF diverging"
            : `|Δvx| ${vxErrMps.toFixed(3)} m/s · 200 Hz`,
      },
    ];
  }, [
    appsViolated,
    betaErrDeg,
    brakePct,
    bspdViolated,
    canLatencyMs,
    frRlSwapDetected,
    frRlTempDiff,
    frame.hv.p_dc_kw,
    maxTireTemp,
    maxWheelSpeedSpread,
    minTireTemp,
    safetyOverlay.appsDiffPct,
    tireFault,
    vxErrMps,
  ]);

  const scrutineeringGates = useMemo(() => {
    return [
      {
        id: "sdc",
        label: "SDC Closed & Latch Clear",
        pass: sdcClosed && stopState === "NOMINAL",
        val: sdcClosed ? (stopState === "SOFT_STOP" ? "SOFT" : "CLOSED") : "OPEN",
      },
      {
        id: "apps_bspd",
        label: "APPS (T.4.2.5) / BSPD (EV 2.3)",
        pass: !appsViolated && !bspdViolated,
        val: !appsViolated && !bspdViolated ? "PASS" : "TRIP",
      },
      {
        id: "hv_cells",
        label: "HV Envelope (<=80kW, >=3V, <=60°C)",
        pass:
          frame.hv.p_dc_kw <= 80.5 &&
          safetyOverlay.minCellVoltageV >= 3.0 &&
          safetyOverlay.maxCellTempC <= 60.0,
        val: `${safetyOverlay.minCellVoltageV.toFixed(2)}V/${safetyOverlay.maxCellTempC.toFixed(0)}°`,
      },
      {
        id: "inv_thermal",
        label: "Inverter IGBT Margin (<=82°C)",
        pass: safetyOverlay.inverterTempC <= 82.0,
        val: `${safetyOverlay.inverterTempC.toFixed(1)}°C`,
      },
      {
        id: "harness",
        label: "4-Corner Harness Mapping",
        pass: !frRlSwapDetected,
        val: frRlSwapDetected ? "SWAP" : "OK",
      },
      {
        id: "ecu_wdg",
        label: "STM32F405 200 Hz Watchdog",
        pass: canLatencyMs <= 200 && betaErrDeg <= 2.5,
        val: `${canLatencyMs.toFixed(0)}ms`,
      },
    ];
  }, [
    appsViolated,
    betaErrDeg,
    bspdViolated,
    canLatencyMs,
    frRlSwapDetected,
    frame.hv.p_dc_kw,
    safetyOverlay.inverterTempC,
    safetyOverlay.maxCellTempC,
    safetyOverlay.minCellVoltageV,
    sdcClosed,
    stopState,
  ]);

  const releaseToTrack = scrutineeringGates.every((g) => g.pass);

  const faultButtons: Array<{
    id: SafetyFaultInjection;
    label: string;
    tag: string;
  }> = [
    { id: "apps_mismatch", label: "APPS Mismatch", tag: "T.4.2.5" },
    { id: "bspd_violation", label: "BSPD Violation", tag: "EV 2.3" },
    { id: "can_spike_240ms", label: "CAN Delay 240ms", tag: "WDG" },
    { id: "rr_inv_overtemp", label: "RR IGBT Overtemp", tag: "88.4°C" },
    { id: "fr_rl_swap", label: "FR/RL Sensor Swap", tag: "SWAP" },
  ];

  // Column 1 (44%): Plausibility Matrix + Live EKF Innovation Canvas
  const colLeft = (
    <SplitPane
      direction="vertical"
      initialRatio={0.54}
      minRatio={0.38}
      maxRatio={0.68}
      first={
        <div className="machined-panel w-full h-full min-h-0 flex flex-col overflow-hidden">
          <InstrumentHeader
            title="FSAE EV Sensor Plausibility Matrix"
            right={
              <span className="font-mono text-[9.5px] text-[#7E8899]">200 Hz Safety Audit</span>
            }
          />
          <div className="flex-1 min-h-0 overflow-auto bg-[#08090C]">
            <table className="w-full border-collapse text-left">
              <thead className="sticky top-0 bg-[#12151D] border-b border-[#222633] text-[9.5px] uppercase tracking-wider text-[#7E8899]">
                <tr>
                  <th className="py-1.5 px-2.5 font-medium">Channel</th>
                  <th className="py-1.5 px-2 font-medium">Live</th>
                  <th className="py-1.5 px-2 font-medium">Bound</th>
                  <th className="py-1.5 px-2.5 font-medium text-right">State</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#181C26] text-[10.5px]">
                {plausibilityRows.map((row) => (
                  <tr
                    key={row.id}
                    className={
                      row.status === "TRIP"
                        ? "bg-[#DC2626]/12"
                        : row.status === "CAUTION"
                          ? "bg-[#D97706]/10"
                          : "hover:bg-[#141822]"
                    }
                  >
                    <td className="py-1.5 px-2.5">
                      <div className="font-medium text-[#ECEFF4] leading-tight">{row.channel}</div>
                      <div className="text-[9.5px] text-[#7E8899] leading-tight mt-0.5">
                        {row.detail}
                      </div>
                    </td>
                    <td className="py-1.5 px-2 font-mono text-[10px] text-[#ECEFF4] tabular whitespace-nowrap">
                      {row.reading}
                    </td>
                    <td className="py-1.5 px-2 font-mono text-[10px] text-[#94A3B8] tabular whitespace-nowrap">
                      {row.bound}
                    </td>
                    <td className="py-1.5 px-2.5 text-right whitespace-nowrap">
                      <span
                        className={`${statusPillClass(row.status)} font-mono !text-[9px] !px-1.5 !py-0`}
                      >
                        {row.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      }
      second={
        <div className="machined-panel w-full h-full min-h-0 flex flex-col overflow-hidden">
          <InstrumentHeader
            title="Live 60 Hz EKF Innovation & CAN Watchdog"
            right={
              <span className="font-mono text-[10px] text-[#DFBE78] tabular">
                |Δβ| {betaErrDeg.toFixed(2)}° · {canLatencyMs.toFixed(0)} ms
              </span>
            }
          />
          <div className="flex-1 min-h-0 relative bg-[#08090C]">
            <WaveformMonitorCanvas mode="live_ekf" />
          </div>
        </div>
      }
    />
  );

  // Column 2 (30%): 200 Hz STM32F405 & HV Gauges + Interlocks & Fault Injection
  const colCenter = (
    <SplitPane
      direction="vertical"
      initialRatio={0.44}
      minRatio={0.32}
      maxRatio={0.58}
      first={
        <div className="machined-panel w-full h-full min-h-0 flex flex-col overflow-hidden">
          <InstrumentHeader
            title="STM32F405 200 Hz & HV Pack"
            right={
              <span className="status-pill status-pill-gold !text-[9px] font-mono">
                {activeFaultMode === "nominal_4wd" ? "4WD NOM" : "3WD LIMP"}
              </span>
            }
          />
          <div className="flex-1 min-h-0 p-2 flex flex-col justify-between gap-2 overflow-hidden">
            <div className="grid grid-cols-2 gap-1.5">
              <div className="rounded-[3px] bg-[#141720] border border-[#222633] px-2 py-1.5">
                <div className="text-[9px] text-[#7E8899]">HV Net Power</div>
                <div
                  className={`font-mono text-[12px] font-semibold tabular ${
                    frame.hv.p_dc_kw > 80 ? "text-[#F87171]" : "text-[#ECEFF4]"
                  }`}
                >
                  {netPowerKw >= 0 ? "+" : ""}
                  {netPowerKw.toFixed(1)} kW
                </div>
                <div className="font-mono text-[9px] text-[#64748B]">[-25, +80] kW</div>
              </div>

              <div className="rounded-[3px] bg-[#141720] border border-[#222633] px-2 py-1.5">
                <div className="text-[9px] text-[#7E8899]">Min Cell Volt</div>
                <div
                  className={`font-mono text-[12px] font-semibold tabular ${
                    safetyOverlay.minCellVoltageV < 3.0 ? "text-[#F87171]" : "text-[#34D399]"
                  }`}
                >
                  {safetyOverlay.minCellVoltageV.toFixed(3)} V
                </div>
                <div className="font-mono text-[9px] text-[#64748B]">&gt;= 3.00 V</div>
              </div>

              <div className="rounded-[3px] bg-[#141720] border border-[#222633] px-2 py-1.5">
                <div className="text-[9px] text-[#7E8899]">Max Cell Temp</div>
                <div
                  className={`font-mono text-[12px] font-semibold tabular ${
                    safetyOverlay.maxCellTempC > 60 ? "text-[#F87171]" : "text-[#ECEFF4]"
                  }`}
                >
                  {safetyOverlay.maxCellTempC.toFixed(1)} °C
                </div>
                <div className="font-mono text-[9px] text-[#64748B]">&lt;= 60.0 °C</div>
              </div>

              <div className="rounded-[3px] bg-[#141720] border border-[#222633] px-2 py-1.5">
                <div className="text-[9px] text-[#7E8899]">Inverter IGBT</div>
                <div
                  className={`font-mono text-[12px] font-semibold tabular ${
                    safetyOverlay.inverterTempC > 82 ? "text-[#F87171]" : "text-[#38BDF8]"
                  }`}
                >
                  {safetyOverlay.inverterTempC.toFixed(1)} °C
                </div>
                <div className="font-mono text-[9px] text-[#64748B]">Derate &gt; 78°C</div>
              </div>
            </div>

            {/* 200 Hz Execution Budget */}
            <div className="rounded-[3px] bg-[#141720] border border-[#222633] p-2 space-y-1">
              <div className="flex items-center justify-between text-[9.5px] font-mono">
                <span className="text-[#CBD5E1]">ECU 5.00ms Slot</span>
                <span className="text-[#34D399] tabular">306 µs (6.12%)</span>
              </div>
              <div className="h-[6px] w-full rounded-[1px] bg-[#08090C] flex overflow-hidden">
                <div className="h-full bg-[#C5A059]" style={{ width: "37%" }} title="AL-QP 185µs" />
                <div className="h-full bg-[#38BDF8]" style={{ width: "14%" }} title="EKF 68µs" />
                <div className="h-full bg-[#10B981]" style={{ width: "11%" }} title="PINN+WDG 53µs" />
              </div>
              <div className="flex items-center justify-between text-[9px] font-mono text-[#7E8899]">
                <span>AL-QP 185µs · PINN 1.11µs</span>
                <span className={yawRestoringNominal ? "text-[#34D399]" : "text-[#FBBF24]"}>
                  dMz/dβ {yawRestoringNominal ? "<0 OK" : "SAT"}
                </span>
              </div>
            </div>
          </div>
        </div>
      }
      second={
        <div className="machined-panel w-full h-full min-h-0 flex flex-col overflow-hidden">
          <InstrumentHeader
            title="Interlocks & HIL Fault Bench"
            right={
              injectedSafetyFault ? (
                <button
                  type="button"
                  onClick={() => injectSafetyFault(null)}
                  className="h-[20px] px-1.5 rounded-[2px] bg-[#1B1F2A] border border-[#C5A059]/50 text-[9.5px] font-medium text-[#DFBE78] cursor-pointer"
                >
                  Clear Fault
                </button>
              ) : null
            }
          />
          <div className="flex-1 min-h-0 p-2 flex flex-col justify-between gap-2 overflow-y-auto">
            <div className="space-y-1">
              {(
                [
                  {
                    key: "appsBspdHardCutoff",
                    label: "Auto E-Stop: APPS (>10%) / BSPD",
                  },
                  {
                    key: "ekfBetaSoftStop",
                    label: "Soft Stop: CAN >200ms / |Δβ| >2.5°",
                  },
                  {
                    key: "hvPowerOrCellEstop",
                    label: "Auto E-Stop: HV >80.5kW / Cell >60°C",
                  },
                  {
                    key: "inverterOvertempLimp3wd",
                    label: "3WD Limp-Home: IGBT >82°C",
                  },
                ] as const
              ).map((rule) => (
                <label
                  key={rule.key}
                  className="flex items-center justify-between gap-1.5 px-2 py-1 rounded-[3px] bg-[#141720] border border-[#222633] cursor-pointer hover:border-[#32384A]"
                >
                  <span className="text-[10px] text-[#CBD5E1] truncate">{rule.label}</span>
                  <input
                    type="checkbox"
                    checked={autoInterlocks[rule.key]}
                    onChange={(e) =>
                      setAutoInterlocks((prev) => ({
                        ...prev,
                        [rule.key]: e.target.checked,
                      }))
                    }
                    className="accent-[#C5A059] w-3 h-3 cursor-pointer shrink-0"
                  />
                </label>
              ))}
            </div>

            <div className="space-y-1 pt-1.5 border-t border-[#222633]">
              <div className="text-[9.5px] font-mono uppercase text-[#7E8899]">
                Inject HIL Fault
              </div>
              <div className="grid grid-cols-1 gap-1">
                {faultButtons.map((btn) => {
                  const active = injectedSafetyFault === btn.id;
                  return (
                    <button
                      key={btn.id}
                      type="button"
                      onClick={() => injectSafetyFault(active ? null : btn.id)}
                      className={`h-[24px] flex items-center justify-between gap-1.5 px-2 rounded-[3px] border text-[10px] font-medium cursor-pointer transition-colors ${
                        active
                          ? "bg-[#DC2626]/20 border-[#DC2626] text-[#FCA5A5]"
                          : "bg-[#141720] border-[#222633] text-[#CBD5E1] hover:border-[#D97706]/60 hover:text-[#FBBF24]"
                      }`}
                    >
                      <span className="truncate">{btn.label}</span>
                      <span className="font-mono text-[9px] opacity-80 shrink-0">{btn.tag}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      }
    />
  );

  // Column 3 (26%): 2.0s Pre-Fault Freeze-Frame + Pit-Release Gate & Safety Log
  const colRight = (
    <SplitPane
      direction="vertical"
      initialRatio={0.38}
      minRatio={0.28}
      maxRatio={0.54}
      first={
        <div className="machined-panel w-full h-full min-h-0 flex flex-col overflow-hidden">
          <InstrumentHeader
            title="2.0 s Pre-Fault Freeze-Frame"
            right={
              <span
                className={`status-pill !text-[9px] font-mono ${
                  preFaultFreezeFrame.length > 0 ? "status-pill-caution" : "status-pill-muted"
                }`}
              >
                {preFaultFreezeFrame.length > 0 ? `${preFaultFreezeFrame.length}f` : "Armed"}
              </span>
            }
          />
          <div className="flex-1 min-h-0 relative bg-[#08090C]">
            <WaveformMonitorCanvas mode="freeze_frame" />
          </div>
        </div>
      }
      second={
        <div className="machined-panel w-full h-full min-h-0 flex flex-col overflow-hidden">
          <InstrumentHeader
            title="Pit-Release Gate & Log"
            right={
              <button
                type="button"
                onClick={clearSafetyEvents}
                className="flex items-center gap-1 text-[9.5px] text-[#7E8899] hover:text-[#ECEFF4] cursor-pointer"
              >
                <Trash2 className="w-2.5 h-2.5" />
                Clear
              </button>
            }
          />

          {/* Automated Pit-Release / Hold Vehicle Banner */}
          <div
            className={`p-2 border-b shrink-0 space-y-1.5 ${
              releaseToTrack
                ? "bg-[#10B981]/10 border-[#10B981]/35"
                : "bg-[#DC2626]/14 border-[#DC2626]/55"
            }`}
          >
            <div className="flex items-center justify-between gap-1.5">
              <div className="flex items-center gap-1.5 min-w-0">
                {releaseToTrack ? (
                  <ShieldCheck className="w-4 h-4 text-[#10B981] shrink-0" />
                ) : (
                  <ShieldAlert className="w-4 h-4 text-[#EF4444] shrink-0" />
                )}
                <span
                  className={`text-[11px] font-bold tracking-wide truncate ${
                    releaseToTrack ? "text-[#34D399]" : "text-[#FCA5A5]"
                  }`}
                >
                  {releaseToTrack ? "RELEASE TO TRACK" : "HOLD VEHICLE"}
                </span>
              </div>
              <span
                className={`font-mono text-[9px] px-1.5 py-0.5 rounded-[2px] border shrink-0 ${
                  sdcClosed
                    ? "bg-[#10B981]/15 border-[#10B981]/40 text-[#34D399]"
                    : "bg-[#DC2626]/25 border-[#DC2626] text-[#FCA5A5]"
                }`}
              >
                SDC {sdcClosed ? "CLOSED" : "OPEN"}
              </span>
            </div>

            {stopReason ? (
              <div className="text-[9.5px] font-mono text-[#FCA5A5] truncate">{stopReason}</div>
            ) : null}

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => void triggerSoftStop("Supervisor Soft Stop")}
                className={`flex-1 h-[24px] rounded-[2px] border text-[9.5px] font-semibold cursor-pointer ${
                  stopState === "SOFT_STOP"
                    ? "bg-[#D97706] border-[#F59E0B] text-[#08090C]"
                    : "bg-[#151820] border-[#D97706]/60 text-[#FBBF24] hover:bg-[#D97706]/20"
                }`}
              >
                SOFT STOP
              </button>
              <button
                type="button"
                onClick={() => void triggerEmergencyStop("Supervisor Hard E-Stop")}
                className="flex-1 h-[24px] rounded-[2px] bg-[#DC2626] hover:bg-[#B91C1C] border border-[#EF4444] text-white text-[9.5px] font-bold flex items-center justify-center gap-1 cursor-pointer"
              >
                <OctagonAlert className="w-3 h-3" />
                E-STOP
              </button>
              {(stopState !== "NOMINAL" || injectedSafetyFault !== null) ? (
                <button
                  type="button"
                  onClick={() => void resetSafetyLatch()}
                  className="h-[24px] px-2 rounded-[2px] bg-[#151820] border border-[#10B981]/60 text-[#34D399] text-[9.5px] font-semibold flex items-center cursor-pointer"
                  title="Reset Safety Latch"
                >
                  <RotateCcw className="w-3 h-3" />
                </button>
              ) : null}
            </div>
          </div>

          {/* Compact 6-Gate Scrutineering List */}
          <div className="p-1.5 border-b border-[#222633] space-y-1 shrink-0 bg-[#0F1116]">
            {scrutineeringGates.map((gate) => (
              <div
                key={gate.id}
                className="flex items-center justify-between gap-1 px-1.5 py-0.5 rounded-[2px] bg-[#141720] text-[9.5px]"
              >
                <div className="flex items-center gap-1 min-w-0">
                  {gate.pass ? (
                    <CheckCircle2 className="w-2.5 h-2.5 text-[#10B981] shrink-0" />
                  ) : (
                    <AlertTriangle className="w-2.5 h-2.5 text-[#DC2626] shrink-0" />
                  )}
                  <span className="text-[#CBD5E1] truncate">{gate.label}</span>
                </div>
                <span
                  className={`font-mono shrink-0 ${
                    gate.pass ? "text-[#34D399]" : "text-[#F87171]"
                  }`}
                >
                  {gate.val}
                </span>
              </div>
            ))}
          </div>

          {/* Millisecond Safety Event Log */}
          <div className="flex-1 min-h-0 overflow-y-auto p-1.5 space-y-1 bg-[#08090C] font-mono text-[9.5px]">
            {safetyEvents.length === 0 ? (
              <div className="text-center text-[#64748B] py-4">No safety events logged.</div>
            ) : (
              safetyEvents.map((ev) => (
                <div
                  key={ev.id}
                  className="px-1.5 py-1 rounded-[2px] bg-[#0F1116] border border-[#1E222E]"
                >
                  <div className="flex items-center justify-between gap-1">
                    <span
                      className={
                        ev.severity === "TRIP"
                          ? "text-[#F87171] font-semibold"
                          : ev.severity === "CAUTION"
                            ? "text-[#FBBF24] font-semibold"
                            : "text-[#34D399] font-semibold"
                      }
                    >
                      {ev.severity} · {ev.source}
                    </span>
                    <span className="text-[#64748B] tabular">{ev.timestampMs}</span>
                  </div>
                  <div className="text-[#CBD5E1] font-sans text-[10px] leading-tight mt-0.5">
                    {ev.message}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      }
    />
  );

  return (
    <div className="w-full h-full min-h-0 overflow-hidden">
      {/* Full-Viewport 3-Column Safety Console (44% / 30% / 26%) */}
      <SplitPane
        direction="horizontal"
        initialRatio={0.44}
        minRatio={0.34}
        maxRatio={0.54}
        first={colLeft}
        second={
          <SplitPane
            direction="horizontal"
            initialRatio={0.535}
            minRatio={0.40}
            maxRatio={0.66}
            first={colCenter}
            second={colRight}
          />
        }
      />
    </div>
  );
}
