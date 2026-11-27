import type { TelemetryFrame } from "../types";

export type SignalSubsystemId =
  | "chassis"
  | "suspension"
  | "tires"
  | "powertrain"
  | "hv_safety"
  | "ekf_sensors"
  | "dil_deltas";

export interface SignalSafetyOverlay {
  appsDiffPct: number;
  inverterTempC: number;
  motorStatorTempC: number;
  maxCellTempC: number;
  minCellVoltageV: number;
  packVoltageV: number;
  frRlSwapActive: boolean;
}

export interface VehicleSignalDef {
  id: string;
  label: string;
  shortLabel: string;
  unit: string;
  subsystem: SignalSubsystemId;
  decimals: number;
  defaultColor: string;
  symmetric?: boolean;
  floorZero?: boolean;
  minSpan: number;
  extract: (
    frame: TelemetryFrame,
    prevFrame: TelemetryFrame | null,
    safety?: SignalSafetyOverlay
  ) => number;
}

export const SIGNAL_SUBSYSTEMS: Array<{ id: SignalSubsystemId; label: string }> = [
  { id: "chassis", label: "Chassis & 6-DOF Dynamics" },
  { id: "suspension", label: "4-Corner Suspension & Kinematics" },
  { id: "tires", label: "4-Corner Tire Forces, Slips & Thermal" },
  { id: "powertrain", label: "4WD Powertrain & Torque Vectoring" },
  { id: "hv_safety", label: "HV Accumulator & Safety Bus" },
  { id: "ekf_sensors", label: "EKF Observer & Sensor Plausibility" },
  { id: "dil_deltas", label: "DiL & CasADi Reference Deltas" },
];

const WHEEL_R_M = 0.203;
const ROLL_GRAD_DEG_G = 0.8;
const PITCH_GRAD_DEG_G = 0.52;

const CORNERS: Array<{ key: "fl" | "fr" | "rl" | "rr"; label: string; color: string }> = [
  { key: "fl", label: "FL", color: "#F1F5F9" },
  { key: "fr", label: "FR", color: "#C5A059" },
  { key: "rl", label: "RL", color: "#38BDF8" },
  { key: "rr", label: "RR", color: "#34D399" },
];

function computePackVoltage(frame: TelemetryFrame, safety?: SignalSafetyOverlay): number {
  if (safety) return safety.packVoltageV;
  const ocv = 144 * (3.48 + 0.64 * Math.pow(Math.max(0.05, frame.hv.soc_pct / 100), 0.72));
  const netW = (frame.hv.p_dc_kw - frame.hv.p_regen_kw) * 1000;
  const currentA = netW / Math.max(400, ocv);
  return Math.max(400, ocv - currentA * 0.145);
}

const CHASSIS_SIGNALS: VehicleSignalDef[] = [
  {
    id: "vx_kmh",
    label: "Velocity vx",
    shortLabel: "vx",
    unit: "km/h",
    subsystem: "chassis",
    decimals: 1,
    defaultColor: "#F1F5F9",
    floorZero: true,
    minSpan: 24,
    extract: (f) => f.state.vx * 3.6,
  },
  {
    id: "vy_mps",
    label: "Lateral Velocity vy",
    shortLabel: "vy",
    unit: "m/s",
    subsystem: "chassis",
    decimals: 2,
    defaultColor: "#38BDF8",
    symmetric: true,
    minSpan: 2.0,
    extract: (f) => f.state.vy,
  },
  {
    id: "vz_mps",
    label: "Vertical Velocity vz",
    shortLabel: "vz",
    unit: "m/s",
    subsystem: "chassis",
    decimals: 3,
    defaultColor: "#94A3B8",
    symmetric: true,
    minSpan: 0.4,
    extract: (f) => f.state.vz,
  },
  {
    id: "ax_g",
    label: "Longitudinal Accel ax",
    shortLabel: "ax",
    unit: "g",
    subsystem: "chassis",
    decimals: 2,
    defaultColor: "#38BDF8",
    symmetric: true,
    minSpan: 1.4,
    extract: (f) => f.state.ax_g,
  },
  {
    id: "ay_g",
    label: "Lateral Accel ay",
    shortLabel: "ay",
    unit: "g",
    subsystem: "chassis",
    decimals: 2,
    defaultColor: "#C5A059",
    symmetric: true,
    minSpan: 1.4,
    extract: (f) => f.state.ay_g,
  },
  {
    id: "az_g",
    label: "Vertical Accel az",
    shortLabel: "az",
    unit: "g",
    subsystem: "chassis",
    decimals: 2,
    defaultColor: "#94A3B8",
    minSpan: 0.6,
    extract: (f) => 1.0 + (f.wheels.fl.wheel_travel_m + f.wheels.fr.wheel_travel_m) * 4.5,
  },
  {
    id: "yaw_rate",
    label: "Yaw Rate ωz",
    shortLabel: "ωz",
    unit: "rad/s",
    subsystem: "chassis",
    decimals: 2,
    defaultColor: "#F1F5F9",
    symmetric: true,
    minSpan: 2.0,
    extract: (f) => f.state.yaw_rate_rad_s,
  },
  {
    id: "roll_rate_dps",
    label: "Roll Rate ωx",
    shortLabel: "ωx",
    unit: "deg/s",
    subsystem: "chassis",
    decimals: 1,
    defaultColor: "#38BDF8",
    symmetric: true,
    minSpan: 12,
    extract: (f, prev) => {
      if (!prev) return 0;
      const dt = Math.max(0.008, Math.abs(f.timestamp_s - prev.timestamp_s));
      return ((f.state.ay_g - prev.state.ay_g) * ROLL_GRAD_DEG_G) / dt;
    },
  },
  {
    id: "pitch_rate_dps",
    label: "Pitch Rate ωy",
    shortLabel: "ωy",
    unit: "deg/s",
    subsystem: "chassis",
    decimals: 1,
    defaultColor: "#34D399",
    symmetric: true,
    minSpan: 10,
    extract: (f, prev) => {
      if (!prev) return 0;
      const dt = Math.max(0.008, Math.abs(f.timestamp_s - prev.timestamp_s));
      return (-(f.state.ax_g - prev.state.ax_g) * PITCH_GRAD_DEG_G) / dt;
    },
  },
  {
    id: "roll_angle_deg",
    label: "Chassis Roll Angle φ",
    shortLabel: "Roll",
    unit: "deg",
    subsystem: "chassis",
    decimals: 2,
    defaultColor: "#C5A059",
    symmetric: true,
    minSpan: 2.4,
    extract: (f) => f.state.ay_g * ROLL_GRAD_DEG_G,
  },
  {
    id: "pitch_angle_deg",
    label: "Chassis Pitch Angle θ",
    shortLabel: "Pitch",
    unit: "deg",
    subsystem: "chassis",
    decimals: 2,
    defaultColor: "#38BDF8",
    symmetric: true,
    minSpan: 1.6,
    extract: (f) => -f.state.ax_g * PITCH_GRAD_DEG_G,
  },
  {
    id: "beta_deg",
    label: "Sideslip Angle β",
    shortLabel: "β",
    unit: "deg",
    subsystem: "chassis",
    decimals: 2,
    defaultColor: "#C5A059",
    symmetric: true,
    minSpan: 4.0,
    extract: (f) => f.state.beta_deg,
  },
  {
    id: "steer_wheel_deg",
    label: "Steering Wheel Angle",
    shortLabel: "Steer",
    unit: "deg",
    subsystem: "chassis",
    decimals: 1,
    defaultColor: "#F1F5F9",
    symmetric: true,
    minSpan: 60,
    extract: (f) => f.state.steer_deg * 4.6,
  },
  {
    id: "throttle_pct",
    label: "Throttle Pedal APPS",
    shortLabel: "Thr",
    unit: "%",
    subsystem: "chassis",
    decimals: 1,
    defaultColor: "#34D399",
    floorZero: true,
    minSpan: 100,
    extract: (f) => f.state.throttle * 100,
  },
  {
    id: "brake_pct",
    label: "Brake Pressure BSE",
    shortLabel: "Brk",
    unit: "%",
    subsystem: "chassis",
    decimals: 1,
    defaultColor: "#EF4444",
    floorZero: true,
    minSpan: 100,
    extract: (f) => f.state.brake * 100,
  },
];

const SUSPENSION_SIGNALS: VehicleSignalDef[] = [
  ...CORNERS.map((c) => ({
    id: `wheel_travel_${c.key}_mm`,
    label: `Wheel Travel ${c.label}`,
    shortLabel: `z_${c.label}`,
    unit: "mm",
    subsystem: "suspension" as const,
    decimals: 1,
    defaultColor: c.color,
    symmetric: true,
    minSpan: 24,
    extract: (f: TelemetryFrame) => f.wheels[c.key].wheel_travel_m * 1000,
  })),
  ...CORNERS.map((c) => ({
    id: `damper_vel_${c.key}_mps`,
    label: `Damper Velocity ${c.label}`,
    shortLabel: `vD_${c.label}`,
    unit: "m/s",
    subsystem: "suspension" as const,
    decimals: 3,
    defaultColor: c.color,
    symmetric: true,
    minSpan: 0.2,
    extract: (f: TelemetryFrame, prev: TelemetryFrame | null) => {
      if (!prev) return 0;
      const dt = Math.max(0.008, Math.abs(f.timestamp_s - prev.timestamp_s));
      return ((f.wheels[c.key].wheel_travel_m - prev.wheels[c.key].wheel_travel_m) * 0.92) / dt;
    },
  })),
  ...CORNERS.map((c) => ({
    id: `camber_${c.key}_deg`,
    label: `Dynamic Camber ${c.label}`,
    shortLabel: `γ_${c.label}`,
    unit: "deg",
    subsystem: "suspension" as const,
    decimals: 2,
    defaultColor: c.color,
    minSpan: 2.5,
    extract: (f: TelemetryFrame) => f.wheels[c.key].camber_deg,
  })),
  ...CORNERS.map((c) => ({
    id: `toe_${c.key}_deg`,
    label: `Dynamic Toe ${c.label}`,
    shortLabel: `δ_${c.label}`,
    unit: "deg",
    subsystem: "suspension" as const,
    decimals: 2,
    defaultColor: c.color,
    symmetric: true,
    minSpan: 0.4,
    extract: (f: TelemetryFrame) =>
      (c.key === "fl" || c.key === "fr" ? 0.0045 : -0.0038) *
      (f.wheels[c.key].wheel_travel_m * 1000),
  })),
  {
    id: "rc_front_mm",
    label: "Roll Center Height Front",
    shortLabel: "RC_F",
    unit: "mm",
    subsystem: "suspension",
    decimals: 1,
    defaultColor: "#C5A059",
    minSpan: 20,
    extract: (f) =>
      28.0 - 0.58 * ((f.wheels.fl.wheel_travel_m + f.wheels.fr.wheel_travel_m) * 500) - Math.abs(f.state.ay_g) * 2.1,
  },
  {
    id: "rc_rear_mm",
    label: "Roll Center Height Rear",
    shortLabel: "RC_R",
    unit: "mm",
    subsystem: "suspension",
    decimals: 1,
    defaultColor: "#38BDF8",
    minSpan: 20,
    extract: (f) =>
      44.0 - 0.64 * ((f.wheels.rl.wheel_travel_m + f.wheels.rr.wheel_travel_m) * 500) - Math.abs(f.state.ay_g) * 1.9,
  },
  {
    id: "dynamic_lltd",
    label: "Dynamic Front LLTD",
    shortLabel: "LLTD",
    unit: "ratio",
    subsystem: "suspension",
    decimals: 3,
    defaultColor: "#DFBE78",
    minSpan: 0.16,
    extract: (f) => {
      const dF = Math.abs(f.wheels.fr.fz_n - f.wheels.fl.fz_n);
      const dR = Math.abs(f.wheels.rr.fz_n - f.wheels.rl.fz_n);
      return dF + dR > 25 ? dF / (dF + dR) : 0.4474;
    },
  },
];

const TIRE_SIGNALS: VehicleSignalDef[] = [
  ...CORNERS.map((c) => ({
    id: `fx_${c.key}_n`,
    label: `Longitudinal Force Fx ${c.label}`,
    shortLabel: `Fx_${c.label}`,
    unit: "N",
    subsystem: "tires" as const,
    decimals: 0,
    defaultColor: c.color,
    symmetric: true,
    minSpan: 600,
    extract: (f: TelemetryFrame) => f.wheels[c.key].fx_n,
  })),
  ...CORNERS.map((c) => ({
    id: `fy_${c.key}_n`,
    label: `Lateral Force Fy ${c.label}`,
    shortLabel: `Fy_${c.label}`,
    unit: "N",
    subsystem: "tires" as const,
    decimals: 0,
    defaultColor: c.color,
    symmetric: true,
    minSpan: 800,
    extract: (f: TelemetryFrame) => f.wheels[c.key].fy_n,
  })),
  ...CORNERS.map((c) => ({
    id: `fz_${c.key}_n`,
    label: `Vertical Load Fz ${c.label}`,
    shortLabel: `Fz_${c.label}`,
    unit: "N",
    subsystem: "tires" as const,
    decimals: 0,
    defaultColor: c.color,
    floorZero: true,
    minSpan: 600,
    extract: (f: TelemetryFrame) => f.wheels[c.key].fz_n,
  })),
  ...CORNERS.map((c) => ({
    id: `mz_${c.key}_nm`,
    label: `Aligning Torque Mz ${c.label}`,
    shortLabel: `Mz_${c.label}`,
    unit: "Nm",
    subsystem: "tires" as const,
    decimals: 1,
    defaultColor: c.color,
    symmetric: true,
    minSpan: 24,
    extract: (f: TelemetryFrame) => {
      const w = f.wheels[c.key];
      const trailM = 0.028 * Math.exp(-Math.abs(w.slip_angle_deg) / 7.5);
      return -w.fy_n * trailM;
    },
  })),
  ...CORNERS.map((c) => ({
    id: `alpha_${c.key}_deg`,
    label: `Slip Angle α ${c.label}`,
    shortLabel: `α_${c.label}`,
    unit: "deg",
    subsystem: "tires" as const,
    decimals: 2,
    defaultColor: c.color,
    symmetric: true,
    minSpan: 8.0,
    extract: (f: TelemetryFrame) => f.wheels[c.key].slip_angle_deg,
  })),
  ...CORNERS.map((c) => ({
    id: `kappa_${c.key}`,
    label: `Slip Ratio κ ${c.label}`,
    shortLabel: `κ_${c.label}`,
    unit: "-",
    subsystem: "tires" as const,
    decimals: 3,
    defaultColor: c.color,
    symmetric: true,
    minSpan: 0.16,
    extract: (f: TelemetryFrame) => f.wheels[c.key].slip_ratio,
  })),
  ...CORNERS.map((c) => ({
    id: `util_${c.key}_pct`,
    label: `Tire Utilization ${c.label}`,
    shortLabel: `μ_${c.label}`,
    unit: "%",
    subsystem: "tires" as const,
    decimals: 1,
    defaultColor: c.color,
    floorZero: true,
    minSpan: 100,
    extract: (f: TelemetryFrame) => f.wheels[c.key].tire_util * 100,
  })),
  ...CORNERS.map((c) => ({
    id: `tread_temp_${c.key}_c`,
    label: `Tire Tread Temp ${c.label}`,
    shortLabel: `Tt_${c.label}`,
    unit: "°C",
    subsystem: "tires" as const,
    decimals: 1,
    defaultColor: c.color,
    minSpan: 20,
    extract: (f: TelemetryFrame) => f.wheels[c.key].temp_c,
  })),
  ...CORNERS.map((c) => ({
    id: `core_temp_${c.key}_c`,
    label: `Tire Core Temp ${c.label}`,
    shortLabel: `Tc_${c.label}`,
    unit: "°C",
    subsystem: "tires" as const,
    decimals: 1,
    defaultColor: c.color,
    minSpan: 20,
    extract: (f: TelemetryFrame) => f.wheels[c.key].temp_c - 6.2,
  })),
];

const POWERTRAIN_SIGNALS: VehicleSignalDef[] = [
  ...CORNERS.map((c) => ({
    id: `tq_cmd_${c.key}_nm`,
    label: `Motor Torque Cmd ${c.label}`,
    shortLabel: `Tcmd_${c.label}`,
    unit: "Nm",
    subsystem: "powertrain" as const,
    decimals: 1,
    defaultColor: c.color,
    symmetric: true,
    minSpan: 36,
    extract: (f: TelemetryFrame) => f.wheels[c.key].motor_torque_nm,
  })),
  ...CORNERS.map((c) => ({
    id: `tq_act_${c.key}_nm`,
    label: `Motor Torque Act ${c.label}`,
    shortLabel: `Tact_${c.label}`,
    unit: "Nm",
    subsystem: "powertrain" as const,
    decimals: 1,
    defaultColor: c.color,
    symmetric: true,
    minSpan: 36,
    extract: (f: TelemetryFrame) => f.wheels[c.key].motor_torque_nm * 0.985,
  })),
  ...CORNERS.map((c) => ({
    id: `omega_${c.key}_rads`,
    label: `Wheel Angular Speed ${c.label}`,
    shortLabel: `ω_${c.label}`,
    unit: "rad/s",
    subsystem: "powertrain" as const,
    decimals: 1,
    defaultColor: c.color,
    floorZero: true,
    minSpan: 40,
    extract: (f: TelemetryFrame) => (f.state.vx / WHEEL_R_M) * (1 + f.wheels[c.key].slip_ratio),
  })),
  {
    id: "tv_mz_nm",
    label: "TV Yaw Moment Mz",
    shortLabel: "Mz_TV",
    unit: "Nm",
    subsystem: "powertrain",
    decimals: 1,
    defaultColor: "#C5A059",
    symmetric: true,
    minSpan: 240,
    extract: (f) => f.hv.tv_mz_nm,
  },
  {
    id: "tv_fight_kw",
    label: "TV Parasitic Torque Fight",
    shortLabel: "Fight",
    unit: "kW",
    subsystem: "powertrain",
    decimals: 2,
    defaultColor: "#D97706",
    floorZero: true,
    minSpan: 2.0,
    extract: (f) => {
      const oppF = f.wheels.fl.motor_torque_nm * f.wheels.fr.motor_torque_nm < 0 ? 1 : 0;
      const oppR = f.wheels.rl.motor_torque_nm * f.wheels.rr.motor_torque_nm < 0 ? 1 : 0;
      if (!oppF && !oppR) return 0;
      const omega = f.state.vx / WHEEL_R_M;
      return (
        (oppF * Math.abs(f.wheels.fl.motor_torque_nm - f.wheels.fr.motor_torque_nm) +
          oppR * Math.abs(f.wheels.rl.motor_torque_nm - f.wheels.rr.motor_torque_nm)) *
        omega *
        0.00018
      );
    },
  },
  {
    id: "inverter_temp_c",
    label: "Inverter IGBT Peak Temp",
    shortLabel: "T_inv",
    unit: "°C",
    subsystem: "powertrain",
    decimals: 1,
    defaultColor: "#38BDF8",
    minSpan: 25,
    extract: (f, _prev, s) => s?.inverterTempC ?? 52 + f.hv.p_dc_kw * 0.24,
  },
  {
    id: "motor_temp_c",
    label: "Motor Stator Peak Temp",
    shortLabel: "T_mot",
    unit: "°C",
    subsystem: "powertrain",
    decimals: 1,
    defaultColor: "#DFBE78",
    minSpan: 30,
    extract: (f, _prev, s) => s?.motorStatorTempC ?? 74 + f.hv.p_dc_kw * 0.34,
  },
];

const HV_SAFETY_SIGNALS: VehicleSignalDef[] = [
  {
    id: "hv_dc_kw",
    label: "HV DC Discharge Power",
    shortLabel: "P_dc",
    unit: "kW",
    subsystem: "hv_safety",
    decimals: 1,
    defaultColor: "#DFBE78",
    floorZero: true,
    minSpan: 85,
    extract: (f) => f.hv.p_dc_kw,
  },
  {
    id: "hv_regen_kw",
    label: "HV Regen Charge Power",
    shortLabel: "P_reg",
    unit: "kW",
    subsystem: "hv_safety",
    decimals: 1,
    defaultColor: "#38BDF8",
    floorZero: true,
    minSpan: 30,
    extract: (f) => f.hv.p_regen_kw,
  },
  {
    id: "pack_voltage_v",
    label: "HV Pack Terminal Voltage",
    shortLabel: "V_pack",
    unit: "V",
    subsystem: "hv_safety",
    decimals: 1,
    defaultColor: "#F1F5F9",
    minSpan: 60,
    extract: (f, _p, s) => computePackVoltage(f, s),
  },
  {
    id: "pack_current_a",
    label: "HV Pack Bus Current",
    shortLabel: "I_pack",
    unit: "A",
    subsystem: "hv_safety",
    decimals: 1,
    defaultColor: "#C5A059",
    symmetric: true,
    minSpan: 120,
    extract: (f, _p, s) => ((f.hv.p_dc_kw - f.hv.p_regen_kw) * 1000) / computePackVoltage(f, s),
  },
  {
    id: "min_cell_v",
    label: "Min Cell Voltage",
    shortLabel: "V_minC",
    unit: "V",
    subsystem: "hv_safety",
    decimals: 3,
    defaultColor: "#34D399",
    minSpan: 0.4,
    extract: (f, _p, s) => s?.minCellVoltageV ?? computePackVoltage(f, s) / 144 - 0.04,
  },
  {
    id: "max_cell_temp_c",
    label: "Max Cell Temperature",
    shortLabel: "T_cell",
    unit: "°C",
    subsystem: "hv_safety",
    decimals: 1,
    defaultColor: "#D97706",
    minSpan: 20,
    extract: (f, _p, s) => s?.maxCellTempC ?? 38.5 + (100 - f.hv.soc_pct) * 0.22,
  },
  {
    id: "soc_pct",
    label: "HV Battery SoC",
    shortLabel: "SoC",
    unit: "%",
    subsystem: "hv_safety",
    decimals: 1,
    defaultColor: "#34D399",
    floorZero: true,
    minSpan: 20,
    extract: (f) => f.hv.soc_pct,
  },
  {
    id: "bspd_margin_kw",
    label: "BSPD Power Margin (vs 5 kW)",
    shortLabel: "BSPD",
    unit: "kW",
    subsystem: "hv_safety",
    decimals: 2,
    defaultColor: "#EF4444",
    symmetric: true,
    minSpan: 10,
    extract: (f) => (f.state.brake > 0.2 ? 5.0 - f.hv.p_dc_kw : 5.0),
  },
];

const EKF_SENSOR_SIGNALS: VehicleSignalDef[] = [
  {
    id: "ekf_vx_mps",
    label: "EKF Velocity vx",
    shortLabel: "ekf_vx",
    unit: "m/s",
    subsystem: "ekf_sensors",
    decimals: 2,
    defaultColor: "#38BDF8",
    floorZero: true,
    minSpan: 10,
    extract: (f) => f.ekf.ekf_vx,
  },
  {
    id: "ekf_vy_mps",
    label: "EKF Lateral Vel vy",
    shortLabel: "ekf_vy",
    unit: "m/s",
    subsystem: "ekf_sensors",
    decimals: 2,
    defaultColor: "#38BDF8",
    symmetric: true,
    minSpan: 2.0,
    extract: (f) => f.ekf.ekf_vy,
  },
  {
    id: "ekf_yaw_rate",
    label: "EKF Yaw Rate ωz",
    shortLabel: "ekf_ωz",
    unit: "rad/s",
    subsystem: "ekf_sensors",
    decimals: 2,
    defaultColor: "#38BDF8",
    symmetric: true,
    minSpan: 2.0,
    extract: (f) => f.ekf.ekf_yaw_rate,
  },
  {
    id: "ekf_beta_deg",
    label: "EKF Sideslip β",
    shortLabel: "ekf_β",
    unit: "deg",
    subsystem: "ekf_sensors",
    decimals: 2,
    defaultColor: "#38BDF8",
    symmetric: true,
    minSpan: 4.0,
    extract: (f) => f.ekf.ekf_beta_deg,
  },
  {
    id: "beta_err_deg",
    label: "EKF Sideslip Error |Δβ|",
    shortLabel: "|Δβ|",
    unit: "deg",
    subsystem: "ekf_sensors",
    decimals: 3,
    defaultColor: "#D97706",
    floorZero: true,
    minSpan: 1.5,
    extract: (f) => Math.abs(f.state.beta_deg - f.ekf.ekf_beta_deg),
  },
  {
    id: "vx_err_mps",
    label: "EKF Velocity Error |Δvx|",
    shortLabel: "|Δvx|",
    unit: "m/s",
    subsystem: "ekf_sensors",
    decimals: 3,
    defaultColor: "#D97706",
    floorZero: true,
    minSpan: 0.8,
    extract: (f) => Math.abs(f.state.vx - f.ekf.ekf_vx),
  },
  {
    id: "can_latency_ms",
    label: "CAN Transport Latency",
    shortLabel: "CAN_ms",
    unit: "ms",
    subsystem: "ekf_sensors",
    decimals: 0,
    defaultColor: "#C5A059",
    floorZero: true,
    minSpan: 160,
    extract: (f) => f.ekf.sensor_latency_ms,
  },
  {
    id: "apps_diff_pct",
    label: "APPS Dual-Channel Diff",
    shortLabel: "ΔAPPS",
    unit: "%",
    subsystem: "ekf_sensors",
    decimals: 1,
    defaultColor: "#EF4444",
    floorZero: true,
    minSpan: 15,
    extract: (_f, _p, s) => s?.appsDiffPct ?? 0.6,
  },
];

const DIL_DELTA_SIGNALS: VehicleSignalDef[] = [
  {
    id: "delta_time_s",
    label: "DiL Delta Time Δt",
    shortLabel: "Δt",
    unit: "s",
    subsystem: "dil_deltas",
    decimals: 3,
    defaultColor: "#C5A059",
    symmetric: true,
    minSpan: 0.3,
    extract: (f) => f.dil_delta.delta_time_s,
  },
  {
    id: "delta_vx_mps",
    label: "DiL Speed Delta Δvx",
    shortLabel: "Δvx",
    unit: "m/s",
    subsystem: "dil_deltas",
    decimals: 2,
    defaultColor: "#38BDF8",
    symmetric: true,
    minSpan: 2.0,
    extract: (f) => f.dil_delta.delta_vx_mps,
  },
  {
    id: "delta_ay_g",
    label: "DiL Lateral G Delta Δay",
    shortLabel: "Δay",
    unit: "g",
    subsystem: "dil_deltas",
    decimals: 3,
    defaultColor: "#34D399",
    symmetric: true,
    minSpan: 0.4,
    extract: (f) => f.dil_delta.delta_ay_g,
  },
  {
    id: "cone_clearance_m",
    label: "Min Cone Clearance",
    shortLabel: "Cone",
    unit: "m",
    subsystem: "dil_deltas",
    decimals: 2,
    defaultColor: "#10B981",
    floorZero: true,
    minSpan: 1.5,
    extract: (f) => Math.max(0.12, 0.78 - Math.abs(f.state.beta_deg) * 0.045),
  },
];

export const VEHICLE_SIGNALS: VehicleSignalDef[] = [
  ...CHASSIS_SIGNALS,
  ...SUSPENSION_SIGNALS,
  ...TIRE_SIGNALS,
  ...POWERTRAIN_SIGNALS,
  ...HV_SAFETY_SIGNALS,
  ...EKF_SENSOR_SIGNALS,
  ...DIL_DELTA_SIGNALS,
];

export const SIGNAL_MAP: Record<string, VehicleSignalDef> = Object.fromEntries(
  VEHICLE_SIGNALS.map((s) => [s.id, s])
);

export interface OscilloscopeChannelBinding {
  signalId: string;
  axis: "left" | "right";
  color: string;
  dashed?: boolean;
  fill?: boolean;
}

export interface OscilloscopeTrackConfig {
  id: string;
  title: string;
  channels: OscilloscopeChannelBinding[];
}

export interface OscilloscopePreset {
  id: string;
  name: string;
  tracks: OscilloscopeTrackConfig[];
}

export const OSCILLOSCOPE_PRESETS: OscilloscopePreset[] = [
  {
    id: "pitwall_default",
    name: "Pitwall Default (4-Lane)",
    tracks: [
      {
        id: "t-vel",
        title: "Velocity & Time Delta",
        channels: [
          { signalId: "vx_kmh", axis: "left", color: "#F1F5F9", fill: true },
          { signalId: "delta_time_s", axis: "right", color: "#C5A059" },
        ],
      },
      {
        id: "t-acc",
        title: "Longitudinal & Lateral Acceleration",
        channels: [
          { signalId: "ax_g", axis: "left", color: "#38BDF8" },
          { signalId: "ay_g", axis: "left", color: "#C5A059", fill: true },
        ],
      },
      {
        id: "t-yaw",
        title: "Yaw Rate & Sideslip vs EKF",
        channels: [
          { signalId: "yaw_rate", axis: "left", color: "#F1F5F9" },
          { signalId: "beta_deg", axis: "right", color: "#C5A059", fill: true },
          { signalId: "ekf_beta_deg", axis: "right", color: "#38BDF8", dashed: true },
        ],
      },
      {
        id: "t-tq",
        title: "4WD In-Wheel Motor Torques",
        channels: [
          { signalId: "tq_cmd_fl_nm", axis: "left", color: "#F1F5F9" },
          { signalId: "tq_cmd_fr_nm", axis: "left", color: "#C5A059", fill: true },
          { signalId: "tq_cmd_rl_nm", axis: "left", color: "#38BDF8" },
          { signalId: "tq_cmd_rr_nm", axis: "left", color: "#34D399" },
        ],
      },
    ],
  },
  {
    id: "driver_inputs",
    name: "Driver Inputs",
    tracks: [
      {
        id: "d-vel",
        title: "Velocity & Steering Angle",
        channels: [
          { signalId: "vx_kmh", axis: "left", color: "#F1F5F9", fill: true },
          { signalId: "steer_wheel_deg", axis: "right", color: "#C5A059" },
        ],
      },
      {
        id: "d-pedals",
        title: "Throttle APPS vs Brake BSE",
        channels: [
          { signalId: "throttle_pct", axis: "left", color: "#34D399", fill: true },
          { signalId: "brake_pct", axis: "left", color: "#EF4444" },
        ],
      },
      {
        id: "d-g",
        title: "Combined G-Envelope & Delta-t",
        channels: [
          { signalId: "ay_g", axis: "left", color: "#C5A059" },
          { signalId: "ax_g", axis: "left", color: "#38BDF8" },
          { signalId: "delta_time_s", axis: "right", color: "#F1F5F9", dashed: true },
        ],
      },
    ],
  },
  {
    id: "tire_saturation",
    name: "Tire Saturation & Slips",
    tracks: [
      {
        id: "ts-util",
        title: "4-Corner Friction Circle Utilization (%)",
        channels: [
          { signalId: "util_fl_pct", axis: "left", color: "#F1F5F9" },
          { signalId: "util_fr_pct", axis: "left", color: "#C5A059", fill: true },
          { signalId: "util_rl_pct", axis: "left", color: "#38BDF8" },
          { signalId: "util_rr_pct", axis: "left", color: "#34D399" },
        ],
      },
      {
        id: "ts-alpha",
        title: "4-Corner Slip Angles α (deg)",
        channels: [
          { signalId: "alpha_fl_deg", axis: "left", color: "#F1F5F9" },
          { signalId: "alpha_fr_deg", axis: "left", color: "#C5A059" },
          { signalId: "alpha_rl_deg", axis: "left", color: "#38BDF8" },
          { signalId: "alpha_rr_deg", axis: "left", color: "#34D399" },
        ],
      },
      {
        id: "ts-fz",
        title: "Vertical Contact Loads Fz (N)",
        channels: [
          { signalId: "fz_fl_n", axis: "left", color: "#F1F5F9" },
          { signalId: "fz_fr_n", axis: "left", color: "#C5A059" },
          { signalId: "fz_rl_n", axis: "left", color: "#38BDF8" },
          { signalId: "fz_rr_n", axis: "left", color: "#34D399" },
        ],
      },
    ],
  },
  {
    id: "tv_yaw",
    name: "TV & Yaw Stability",
    tracks: [
      {
        id: "tv-mz",
        title: "Velocity & TV Yaw Moment Mz",
        channels: [
          { signalId: "vx_kmh", axis: "left", color: "#F1F5F9", fill: true },
          { signalId: "tv_mz_nm", axis: "right", color: "#C5A059" },
        ],
      },
      {
        id: "tv-beta",
        title: "Sideslip β & Yaw Rate ωz",
        channels: [
          { signalId: "beta_deg", axis: "left", color: "#C5A059", fill: true },
          { signalId: "yaw_rate", axis: "right", color: "#38BDF8" },
        ],
      },
      {
        id: "tv-split",
        title: "Left/Right Motor Torque Split & Fight",
        channels: [
          { signalId: "tq_cmd_fl_nm", axis: "left", color: "#F1F5F9" },
          { signalId: "tq_cmd_fr_nm", axis: "left", color: "#C5A059" },
          { signalId: "tv_fight_kw", axis: "right", color: "#D97706", dashed: true },
        ],
      },
    ],
  },
  {
    id: "ekf_residuals",
    name: "EKF & Sensor Residuals",
    tracks: [
      {
        id: "ekf-b",
        title: "Sideslip β vs EKF β & |Δβ| Residual",
        channels: [
          { signalId: "beta_deg", axis: "left", color: "#C5A059" },
          { signalId: "ekf_beta_deg", axis: "left", color: "#38BDF8", dashed: true },
          { signalId: "beta_err_deg", axis: "right", color: "#D97706", fill: true },
        ],
      },
      {
        id: "ekf-v",
        title: "Velocity Error |Δvx| & CAN Latency",
        channels: [
          { signalId: "vx_err_mps", axis: "left", color: "#38BDF8", fill: true },
          { signalId: "can_latency_ms", axis: "right", color: "#C5A059" },
        ],
      },
      {
        id: "ekf-apps",
        title: "APPS Dual-Channel Diff & BSPD Margin",
        channels: [
          { signalId: "apps_diff_pct", axis: "left", color: "#EF4444", fill: true },
          { signalId: "bspd_margin_kw", axis: "right", color: "#34D399" },
        ],
      },
    ],
  },
  {
    id: "hv_thermal",
    name: "HV & Thermal",
    tracks: [
      {
        id: "hv-p",
        title: "HV Tractive Power & Regen",
        channels: [
          { signalId: "hv_dc_kw", axis: "left", color: "#C5A059", fill: true },
          { signalId: "hv_regen_kw", axis: "left", color: "#38BDF8" },
          { signalId: "pack_voltage_v", axis: "right", color: "#F1F5F9" },
        ],
      },
      {
        id: "hv-t",
        title: "Motor Stator, Inverter & Cell Temps",
        channels: [
          { signalId: "motor_temp_c", axis: "left", color: "#C5A059" },
          { signalId: "inverter_temp_c", axis: "left", color: "#38BDF8" },
          { signalId: "max_cell_temp_c", axis: "left", color: "#D97706" },
        ],
      },
      {
        id: "hv-tire",
        title: "4-Corner Tire Tread Temperatures",
        channels: [
          { signalId: "tread_temp_fl_c", axis: "left", color: "#F1F5F9" },
          { signalId: "tread_temp_fr_c", axis: "left", color: "#C5A059" },
          { signalId: "tread_temp_rl_c", axis: "left", color: "#38BDF8" },
          { signalId: "tread_temp_rr_c", axis: "left", color: "#34D399" },
        ],
      },
    ],
  },
];
