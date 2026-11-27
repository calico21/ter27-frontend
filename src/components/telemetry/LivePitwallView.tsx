import React from "react";
import { useTelemetryStore } from "../../state/telemetryStore";
import { SplitPane } from "../layout/SplitPane";
import { MultiChannelPlot } from "./MultiChannelPlot";
import { FrictionCircle2x2 } from "./FrictionCircle2x2";

function PowertrainAndEkfPanel() {
  const { frame, sensorProfile, setSensorProfile } = useTelemetryStore();

  const netPowerKw = frame.hv.p_dc_kw - frame.hv.p_regen_kw;
  // Bipolar bar scale: -25 kW regen to +80 kW FSG discharge limit -> 0 kW at 23.81%
  const zeroPct = (25 / 105) * 100;
  const clampedPower = Math.max(-25, Math.min(80, netPowerKw));
  const powerWidthPct = (Math.abs(clampedPower) / 105) * 100;
  const powerLeftPct = clampedPower >= 0 ? zeroPct : zeroPct - powerWidthPct;

  const betaResidual = Math.abs(frame.state.beta_deg - frame.ekf.ekf_beta_deg);
  const vxResidual = Math.abs(frame.state.vx - frame.ekf.ekf_vx);
  const wzResidual = Math.abs(frame.state.yaw_rate_rad_s - frame.ekf.ekf_yaw_rate);

  const wheelTorques = [
    { id: "FL", label: "Front Left", val: frame.wheels.fl.motor_torque_nm },
    { id: "FR", label: "Front Right", val: frame.wheels.fr.motor_torque_nm },
    { id: "RL", label: "Rear Left", val: frame.wheels.rl.motor_torque_nm },
    { id: "RR", label: "Rear Right", val: frame.wheels.rr.motor_torque_nm },
  ];

  return (
    <div className="machined-panel flex flex-col w-full h-full min-h-0 overflow-hidden">
      <div className="panel-header-bar">
        <div className="flex items-center gap-2">
          <span className="panel-title-label">Powertrain, Torque Vectoring &amp; EKF</span>
        </div>
        <span className="status-pill status-pill-muted font-mono text-[10px]">
          {frame.grip_profile}
        </span>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-3.5 space-y-4">
        {/* Bidirectional HV DC Tractive Power */}
        <div className="space-y-2">
          <div className="flex items-baseline justify-between gap-2">
            <div>
              <span className="text-[11.5px] font-semibold text-[#F1F5F9]">
                HV Tractive Power
              </span>
              <span className="ml-2 text-[10.5px] text-[#94A3B8]">
                -25 kW Regen to +80 kW FSG Limit
              </span>
            </div>
            <span
              className={`font-mono text-[13px] font-semibold tabular ${
                netPowerKw >= 75
                  ? "text-[#F87171]"
                  : netPowerKw < 0
                    ? "text-[#38BDF8]"
                    : "text-[#F1F5F9]"
              }`}
            >
              {netPowerKw >= 0 ? "+" : ""}
              {netPowerKw.toFixed(2)} kW
            </span>
          </div>

          {/* Sleek bipolar bar with crisp zero-center tick */}
          <div className="relative h-3 rounded-full bg-[#0B0D12] border border-white/[0.06] overflow-hidden">
            <div
              className="absolute top-0 bottom-0 transition-all duration-75"
              style={{
                left: `${powerLeftPct}%`,
                width: `${powerWidthPct}%`,
                background:
                  clampedPower < 0
                    ? "linear-gradient(90deg, #0EA5E9, #38BDF8)"
                    : clampedPower > 74
                      ? "linear-gradient(90deg, #D97706, #EF4444)"
                      : "linear-gradient(90deg, #A3803E, #DFBE78)",
              }}
            />
            <div
              className="absolute top-0 bottom-0 w-[2px] bg-[#E2E8F0]/75"
              style={{ left: `${zeroPct}%` }}
            />
          </div>

          {/* 4 KPI Summary Cards */}
          <div className="grid grid-cols-4 gap-2 pt-0.5">
            <div className="machined-card px-2.5 py-2">
              <div className="text-[10px] text-[#94A3B8]">Discharge</div>
              <div className="font-mono text-[12px] font-semibold text-[#F1F5F9] tabular mt-0.5">
                {frame.hv.p_dc_kw.toFixed(1)} kW
              </div>
            </div>
            <div className="machined-card px-2.5 py-2">
              <div className="text-[10px] text-[#94A3B8]">Regen</div>
              <div className="font-mono text-[12px] font-semibold text-[#38BDF8] tabular mt-0.5">
                -{frame.hv.p_regen_kw.toFixed(1)} kW
              </div>
            </div>
            <div className="machined-card px-2.5 py-2">
              <div className="text-[10px] text-[#94A3B8]">Battery SoC</div>
              <div className="font-mono text-[12px] font-semibold text-[#F1F5F9] tabular mt-0.5">
                {frame.hv.soc_pct.toFixed(1)}%
              </div>
            </div>
            <div className="machined-card px-2.5 py-2 flex flex-col justify-between">
              <div className="text-[10px] text-[#94A3B8]">BSPD Safety</div>
              <div className="mt-0.5">
                <span
                  className={`status-pill text-[10px] ${
                    frame.hv.bspd_active ? "status-pill-limit" : "status-pill-nominal"
                  }`}
                >
                  {frame.hv.bspd_active ? "Fault Trip" : "Nominal"}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Torque Vectoring Yaw Moment & 4WD Split */}
        <div className="pt-3 border-t border-white/[0.06] space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11.5px] font-semibold text-[#F1F5F9]">
              4WD Torque Vectoring Allocation
            </span>
            <span className="status-pill status-pill-gold font-mono text-[10.5px]">
              Mz {frame.hv.tv_mz_nm >= 0 ? "+" : ""}
              {frame.hv.tv_mz_nm.toFixed(1)} Nm
            </span>
          </div>

          <div className="grid grid-cols-4 gap-2">
            {wheelTorques.map((wt) => {
              const clamped = Math.max(-50, Math.min(50, wt.val));
              const pct = (Math.abs(clamped) / 50) * 50;
              return (
                <div key={wt.id} className="machined-card px-2.5 py-2">
                  <div className="flex items-center justify-between text-[10.5px]">
                    <span className="font-medium text-[#94A3B8]">{wt.id}</span>
                    <span
                      className={`font-mono font-semibold tabular ${
                        wt.val < 0 ? "text-[#38BDF8]" : "text-[#F1F5F9]"
                      }`}
                    >
                      {wt.val >= 0 ? "+" : ""}
                      {wt.val.toFixed(1)}
                    </span>
                  </div>
                  <div className="relative h-1.5 rounded-full bg-[#0B0D12] mt-1.5 overflow-hidden">
                    <div
                      className="absolute top-0 bottom-0 rounded-full"
                      style={{
                        left: wt.val >= 0 ? "50%" : `${50 - pct}%`,
                        width: `${pct}%`,
                        backgroundColor: wt.val >= 0 ? "#C5A059" : "#38BDF8",
                      }}
                    />
                    <div className="absolute left-1/2 top-0 bottom-0 w-[1.5px] bg-white/30" />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* EKF Estimator & CAN Sensor Profile */}
        <div className="pt-3 border-t border-white/[0.06] space-y-2.5">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="text-[11.5px] font-semibold text-[#F1F5F9]">
              EKF State Estimator &amp; CAN Profile
            </span>
            <div className="seg-track" role="group" aria-label="Sensor Realism Profile">
              {(["SENSOR_IDEAL", "SENSOR_TRACK_REALISM"] as const).map((prof) => (
                <button
                  key={prof}
                  type="button"
                  data-active={sensorProfile === prof ? "true" : "false"}
                  onClick={() => void setSensorProfile(prof)}
                  className="seg-btn"
                >
                  {prof === "SENSOR_IDEAL" ? "Ideal (0ms)" : "Track Realism (125ms)"}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="machined-card px-2.5 py-2">
              <div className="text-[10px] text-[#94A3B8]">Sideslip Residual</div>
              <div
                className={`font-mono text-[12px] font-semibold tabular mt-0.5 ${
                  betaResidual > 0.8 ? "text-[#FBBF24]" : "text-[#34D399]"
                }`}
              >
                {betaResidual.toFixed(3)}°
              </div>
            </div>
            <div className="machined-card px-2.5 py-2">
              <div className="text-[10px] text-[#94A3B8]">Velocity Residual</div>
              <div
                className={`font-mono text-[12px] font-semibold tabular mt-0.5 ${
                  vxResidual > 0.35 ? "text-[#FBBF24]" : "text-[#34D399]"
                }`}
              >
                {vxResidual.toFixed(3)} m/s
              </div>
            </div>
            <div className="machined-card px-2.5 py-2">
              <div className="text-[10px] text-[#94A3B8]">CAN Delay / Δωz</div>
              <div className="font-mono text-[12px] font-semibold text-[#F1F5F9] tabular mt-0.5">
                {frame.ekf.sensor_latency_ms.toFixed(0)} ms · {wzResidual.toFixed(3)}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function LivePitwallView() {
  return (
    <div className="w-full h-full min-h-0 overflow-hidden">
      <SplitPane
        direction="horizontal"
        initialRatio={0.57}
        minRatio={0.35}
        maxRatio={0.78}
        first={<MultiChannelPlot />}
        second={
          <SplitPane
            direction="vertical"
            initialRatio={0.58}
            minRatio={0.35}
            maxRatio={0.78}
            first={<FrictionCircle2x2 />}
            second={<PowertrainAndEkfPanel />}
          />
        }
      />
    </div>
  );
}
