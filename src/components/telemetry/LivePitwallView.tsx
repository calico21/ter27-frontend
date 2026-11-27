import React from "react";
import { useTelemetryStore } from "../../state/telemetryStore";
import { SplitPane } from "../layout/SplitPane";
import { MultiChannelPlot } from "./MultiChannelPlot";
import { FrictionCircle2x2 } from "./FrictionCircle2x2";

function PowertrainAndEkfPanel() {
  const { frame, sensorProfile, setSensorProfile } = useTelemetryStore();

  const netPowerKw = frame.hv.p_dc_kw - frame.hv.p_regen_kw;
  // Bidirectional bar scale: -25 kW to +80 kW -> zero point at 25 / 105 = 23.81%
  const zeroPct = (25 / 105) * 100;
  const clampedPower = Math.max(-25, Math.min(80, netPowerKw));
  const powerWidthPct =
    clampedPower >= 0 ? (clampedPower / 105) * 100 : (Math.abs(clampedPower) / 105) * 100;
  const powerLeftPct = clampedPower >= 0 ? zeroPct : zeroPct - powerWidthPct;

  const betaResidual = Math.abs(frame.state.beta_deg - frame.ekf.ekf_beta_deg);
  const vxResidual = Math.abs(frame.state.vx - frame.ekf.ekf_vx);
  const wzResidual = Math.abs(frame.state.yaw_rate_rad_s - frame.ekf.ekf_yaw_rate);

  const wheelTorques = [
    { id: "FL", val: frame.wheels.fl.motor_torque_nm },
    { id: "FR", val: frame.wheels.fr.motor_torque_nm },
    { id: "RL", val: frame.wheels.rl.motor_torque_nm },
    { id: "RR", val: frame.wheels.rr.motor_torque_nm },
  ];

  return (
    <div className="flex flex-col w-full h-full min-h-0 bg-[#0F1116] overflow-y-auto">
      <div className="panel-header-bar">
        <span className="panel-title-label">HV Powertrain, TV Authority &amp; EKF Health</span>
        <span className="text-[10px] font-mono text-[#7E8799]">
          {frame.grip_profile} / {frame.source.toUpperCase()}
        </span>
      </div>

      <div className="p-2.5 space-y-3">
        {/* Bidirectional HV DC Power Bar (-25 kW to +80 kW) */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[10px] font-mono">
            <span className="text-[#7E8799]">HV DC TRACTIVE POWER (-25 kW REGEN / +80 kW MAX)</span>
            <span
              className={
                netPowerKw >= 75
                  ? "text-[#DC2626] font-semibold"
                  : netPowerKw < 0
                    ? "text-[#38BDF8] font-semibold"
                    : "text-[#ECEFF4] font-semibold"
              }
            >
              {netPowerKw >= 0 ? "+" : ""}
              {netPowerKw.toFixed(2)} kW
            </span>
          </div>

          <div className="relative h-3 bg-[#08090C] border border-[#222633]">
            {/* 0 kW marker */}
            <div
              className="absolute top-0 bottom-0 w-[1px] bg-[#7E8799]"
              style={{ left: `${zeroPct}%` }}
            />
            <div
              className="absolute top-0 bottom-0"
              style={{
                left: `${powerLeftPct}%`,
                width: `${powerWidthPct}%`,
                backgroundColor:
                  clampedPower < 0 ? "#38BDF8" : clampedPower > 74 ? "#D97706" : "#C5A059",
              }}
            />
          </div>

          <div className="grid grid-cols-4 gap-2 pt-1 font-mono text-[10px]">
            <div className="bg-[#151820] border border-[#222633] px-2 py-1">
              <div className="text-[9px] text-[#7E8799]">DISCHARGE</div>
              <div className="text-[#ECEFF4] font-semibold">{frame.hv.p_dc_kw.toFixed(1)} kW</div>
            </div>
            <div className="bg-[#151820] border border-[#222633] px-2 py-1">
              <div className="text-[9px] text-[#7E8799]">REGEN</div>
              <div className="text-[#38BDF8] font-semibold">-{frame.hv.p_regen_kw.toFixed(1)} kW</div>
            </div>
            <div className="bg-[#151820] border border-[#222633] px-2 py-1">
              <div className="text-[9px] text-[#7E8799]">HV SoC</div>
              <div className="text-[#ECEFF4] font-semibold">{frame.hv.soc_pct.toFixed(2)} %</div>
            </div>
            <div className="bg-[#151820] border border-[#222633] px-2 py-1">
              <div className="text-[9px] text-[#7E8799]">BSPD LATCH</div>
              <div
                className={
                  frame.hv.bspd_active
                    ? "text-[#DC2626] font-semibold"
                    : "text-[#10B981] font-semibold"
                }
              >
                {frame.hv.bspd_active ? "FAULT TRIP" : "NOMINAL"}
              </div>
            </div>
          </div>
        </div>

        {/* Torque Vectoring Yaw Moment & 4-Wheel Torque Split */}
        <div className="pt-2 border-t border-[#222633] space-y-1.5">
          <div className="flex items-center justify-between text-[10px] font-mono">
            <span className="text-[#7E8799]">TORQUE VECTORING YAW MOMENT (tv_mz_nm)</span>
            <span className="text-[#C5A059] font-semibold">
              {frame.hv.tv_mz_nm >= 0 ? "+" : ""}
              {frame.hv.tv_mz_nm.toFixed(1)} Nm
            </span>
          </div>

          <div className="grid grid-cols-4 gap-1.5">
            {wheelTorques.map((wt) => {
              const clamped = Math.max(-50, Math.min(50, wt.val));
              const pct = (Math.abs(clamped) / 50) * 50;
              return (
                <div
                  key={wt.id}
                  className="bg-[#151820] border border-[#222633] px-1.5 py-1 font-mono text-[10px]"
                >
                  <div className="flex justify-between">
                    <span className="text-[#7E8799]">{wt.id}</span>
                    <span className={wt.val < 0 ? "text-[#38BDF8]" : "text-[#ECEFF4]"}>
                      {wt.val >= 0 ? "+" : ""}
                      {wt.val.toFixed(1)}
                    </span>
                  </div>
                  <div className="relative h-1.5 bg-[#08090C] mt-1">
                    <div className="absolute left-1/2 top-0 bottom-0 w-[1px] bg-[#232836]" />
                    <div
                      className="absolute top-0 bottom-0"
                      style={{
                        left: wt.val >= 0 ? "50%" : `${50 - pct}%`,
                        width: `${pct}%`,
                        backgroundColor: wt.val >= 0 ? "#C5A059" : "#38BDF8",
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Sensor Realism Comparator & EKF Residuals */}
        <div className="pt-2 border-t border-[#222633] space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-mono text-[#7E8799]">
              EKF STATE ESTIMATOR &amp; CAN REALISM
            </span>
            <div className="flex items-center border border-[#222633] rounded-[2px] bg-[#08090C]">
              {(["SENSOR_IDEAL", "SENSOR_TRACK_REALISM"] as const).map((prof) => (
                <button
                  key={prof}
                  type="button"
                  onClick={() => void setSensorProfile(prof)}
                  className={`px-2 py-0.5 text-[9px] font-mono cursor-pointer ${
                    sensorProfile === prof
                      ? "bg-[#1B1F2A] text-[#C5A059]"
                      : "text-[#7E8799] hover:text-[#ECEFF4]"
                  }`}
                >
                  {prof === "SENSOR_IDEAL" ? "IDEAL (0ms)" : "TRACK REALISM (125ms)"}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 font-mono text-[10px]">
            <div className="bg-[#151820] border border-[#222633] px-2 py-1">
              <div className="text-[9px] text-[#7E8799]">|beta - ekf_beta|</div>
              <div
                className={
                  betaResidual > 0.8
                    ? "text-[#D97706] font-semibold"
                    : "text-[#10B981] font-semibold"
                }
              >
                {betaResidual.toFixed(3)} deg
              </div>
            </div>
            <div className="bg-[#151820] border border-[#222633] px-2 py-1">
              <div className="text-[9px] text-[#7E8799]">|vx - ekf_vx|</div>
              <div
                className={
                  vxResidual > 0.35
                    ? "text-[#D97706] font-semibold"
                    : "text-[#10B981] font-semibold"
                }
              >
                {vxResidual.toFixed(3)} m/s
              </div>
            </div>
            <div className="bg-[#151820] border border-[#222633] px-2 py-1">
              <div className="text-[9px] text-[#7E8799]">CAN LATENCY / |dwz|</div>
              <div className="text-[#ECEFF4] font-semibold">
                {frame.ekf.sensor_latency_ms.toFixed(0)} ms / {wzResidual.toFixed(3)}
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
        initialRatio={0.58}
        minRatio={0.35}
        maxRatio={0.78}
        first={<MultiChannelPlot />}
        second={
          <SplitPane
            direction="vertical"
            initialRatio={0.6}
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
