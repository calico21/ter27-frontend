import type { GripProfileName } from "../../types";

export type TvControllerMode = "AL_QP_TV" | "PASSIVE_OPEN_DIFF";

export type TvFaultMode =
  | "nominal_4wd"
  | "motor_loss_fl"
  | "motor_loss_rr"
  | "can_jitter_200ms"
  | "cold_tire_18c";

export interface TvOperatingPointInput {
  speedKmh: number; // 20..110 km/h
  steerDeg: number; // -120..+120 deg steering wheel angle
  pedalDemand: number; // -1.0 (full brake) to +1.0 (full accel)
  regenCapKw: number; // 0..25 kW
  gripProfile: GripProfileName;
  controllerMode: TvControllerMode;
  faultMode: TvFaultMode;
}

export interface WheelAllocation {
  corner: "FL" | "FR" | "RL" | "RR";
  motorTorqueNm: number; // [-21..+21] Nm motor shaft
  wheelTorqueNm: number; // motorTorque * 13.5
  fxN: number;
  fyN: number;
  fzN: number;
  muUtilPct: number;
  clipped: boolean;
  offline: boolean;
}

export interface PhaseTrajectory {
  label: string;
  mode: TvControllerMode;
  unstable: boolean;
  points: Array<{ betaDeg: number; wzRadS: number }>;
}

export interface TvControlSolution {
  wheels: WheelAllocation[];
  desiredYawRateRadS: number;
  achievedYawRateRadS: number;
  yawMomentTvNm: number;
  peakYawAuthorityNm: number;
  dMzDbNmPerDeg: number;
  stabilityState: "STABLE" | "MARGINAL" | "UNSTABLE";
  netHvPowerKw: number;
  regenPowerKw: number;
  parasiticFightDetected: boolean;
  parasiticLossW: number;
  alQpIterations: number;
  solverRuntimeUs: number;
  estLapPenaltyS: number;
  stabilityBoundary: Array<{ betaDeg: number; wzRadS: number }>;
  passiveTrajectories: PhaseTrajectory[];
  tvTrajectories: PhaseTrajectory[];
  operatingBetaDeg: number;
  operatingWzRadS: number;
}

const MASS_KG = 263.0;
const WHEELBASE_M = 1.54;
const TRACK_F_M = 1.24;
const TRACK_R_M = 1.22;
const CG_H_M = 0.285;
const WHEEL_R_M = 0.203;
const GEAR_RATIO = 13.5;
const MAX_MOTOR_TORQUE_NM = 21.0;
const STEER_RATIO = 4.6;
const P_DC_MAX_KW = 80.0;
const CL_A = 2.35;
const RHO = 1.225;

export function solveTvControlOperatingPoint(input: TvOperatingPointInput): TvControlSolution {
  const vx = Math.max(4.0, input.speedKmh / 3.6);
  const lambdaMu = input.gripProfile === "COLD_TEST_OCT" ? 0.47 : 0.57;
  const thermalScale = input.faultMode === "cold_tire_18c" ? 0.69 : 1.0;
  const muPeak = 2.45 * lambdaMu * thermalScale;

  // Road wheel steer angle (rad)
  const deltaRad = ((input.steerDeg / STEER_RATIO) * Math.PI) / 180;
  // Kinematic target yaw rate with understeer gradient Ku = 0.0028 rad/(m/s^2)
  const Ku = input.controllerMode === "AL_QP_TV" ? 0.0014 : 0.0036;
  const desiredWz = (vx * Math.tan(deltaRad)) / (WHEELBASE_M + Ku * vx * vx);
  const maxAyG = Math.min(2.15, muPeak * 1.18);
  const maxPhysicalWz = (maxAyG * 9.81) / vx;
  const clippedWz = Math.max(-maxPhysicalWz, Math.min(maxPhysicalWz, desiredWz));

  const ayMs2 = clippedWz * vx;
  const axMs2 = input.pedalDemand * (input.pedalDemand >= 0 ? 11.2 : 16.5);

  // Aero downforce + static + longitudinal/lateral load transfer
  const aeroTotalN = 0.5 * RHO * CL_A * vx * vx;
  const fzFrontStatic = (MASS_KG * 9.81 * 0.48 + aeroTotalN * 0.45) / 2;
  const fzRearStatic = (MASS_KG * 9.81 * 0.52 + aeroTotalN * 0.55) / 2;

  const dFzLong = (MASS_KG * axMs2 * CG_H_M) / (2 * WHEELBASE_M);
  const lltdF = 0.4474;
  const dFzLatF = (MASS_KG * ayMs2 * CG_H_M * lltdF) / TRACK_F_M;
  const dFzLatR = (MASS_KG * ayMs2 * CG_H_M * (1 - lltdF)) / TRACK_R_M;

  // Positive ayMs2 (left turn) loads right side (+) and unloads left side (-)
  const fzMap: Record<"FL" | "FR" | "RL" | "RR", number> = {
    FL: Math.max(95, fzFrontStatic - dFzLong - dFzLatF),
    FR: Math.max(95, fzFrontStatic - dFzLong + dFzLatF),
    RL: Math.max(95, fzRearStatic + dFzLong - dFzLatR),
    RR: Math.max(95, fzRearStatic + dFzLong + dFzLatR),
  };

  // Lateral force per corner proportional to vertical load & slip demand
  const fyTotal = MASS_KG * ayMs2;
  const sumFz = fzMap.FL + fzMap.FR + fzMap.RL + fzMap.RR;

  // Base longitudinal wheel torque demand per motor
  const wheelOmega = vx / WHEEL_R_M;
  const motorOmega = wheelOmega * GEAR_RATIO;
  const maxTorqueFromPower =
    input.pedalDemand >= 0
      ? (P_DC_MAX_KW * 1000 * 0.92) / Math.max(10, 4 * motorOmega)
      : (Math.max(1, input.regenCapKw) * 1000 * 0.9) / Math.max(10, 4 * motorOmega);

  const baseMotorTorque =
    input.pedalDemand >= 0
      ? Math.min(MAX_MOTOR_TORQUE_NM, maxTorqueFromPower) * input.pedalDemand
      : -Math.min(MAX_MOTOR_TORQUE_NM, maxTorqueFromPower) * Math.abs(input.pedalDemand);

  // AL-QP Yaw Moment Command (Mz_TV)
  const latencyAtten = input.faultMode === "can_jitter_200ms" ? 0.72 : 1.0;
  const rawMzDemand =
    input.controllerMode === "AL_QP_TV"
      ? Math.max(-720, Math.min(720, (desiredWz * 310 + deltaRad * 880) * latencyAtten))
      : 0;

  // Convert desired yaw moment to left/right differential motor torque
  // Mz = ((Fx_FR - Fx_FL)*tf/2 + (Fx_RR - Fx_RL)*tr/2)
  // For each pair: dT_motor = (Mz * WHEEL_R_M) / (2 * track * GEAR_RATIO)
  const diffMotorTorque =
    (rawMzDemand * WHEEL_R_M) / (2 * 0.5 * (TRACK_F_M + TRACK_R_M) * GEAR_RATIO);

  const corners: Array<"FL" | "FR" | "RL" | "RR"> = ["FL", "FR", "RL", "RR"];
  const wheels: WheelAllocation[] = corners.map((corner) => {
    const offline =
      (input.faultMode === "motor_loss_fl" && corner === "FL") ||
      (input.faultMode === "motor_loss_rr" && corner === "RR");

    const isRight = corner === "FR" || corner === "RR";
    const isRear = corner === "RL" || corner === "RR";
    const fz = fzMap[corner];
    const fy = (fyTotal * (fz / sumFz)) * (isRear ? 0.98 : 1.02);

    if (offline) {
      const fMax = Math.max(120, muPeak * fz);
      const util = Math.min(115, (Math.abs(fy) / fMax) * 100);
      return {
        corner,
        motorTorqueNm: 0,
        wheelTorqueNm: 0,
        fxN: 0,
        fyN: fy,
        fzN: fz,
        muUtilPct: util,
        clipped: false,
        offline: true,
      };
    }

    // Reallocate compensatory torque if an actuator is faulted in AL-QP mode
    let faultComp = 0;
    if (input.controllerMode === "AL_QP_TV") {
      if (input.faultMode === "motor_loss_fl") {
        faultComp = corner === "RL" ? baseMotorTorque * 0.52 : corner === "FR" ? -baseMotorTorque * 0.2 : 0;
      } else if (input.faultMode === "motor_loss_rr") {
        faultComp = corner === "FR" ? baseMotorTorque * 0.48 : corner === "RL" ? -baseMotorTorque * 0.18 : 0;
      }
    }

    // Load-weighted longitudinal allocation + yaw differential
    const loadWeight = fz / (sumFz / 4);
    let cmdMotorNm =
      baseMotorTorque * (input.controllerMode === "AL_QP_TV" ? 0.65 + 0.35 * loadWeight : 1.0) +
      (isRight ? diffMotorTorque : -diffMotorTorque) +
      faultComp;

    // Clamp to physical motor limits [-21, +21] Nm
    let clipped = false;
    if (Math.abs(cmdMotorNm) > MAX_MOTOR_TORQUE_NM) {
      cmdMotorNm = Math.sign(cmdMotorNm) * MAX_MOTOR_TORQUE_NM;
      clipped = true;
    }

    // Friction-ellipse clipping: Fx_max = sqrt((mu * Fz)^2 - Fy^2)
    const fMaxTotal = Math.max(120, muPeak * fz);
    const fxMaxAvail = Math.sqrt(Math.max(0, fMaxTotal * fMaxTotal - fy * fy));
    const maxMotorFromTire = (fxMaxAvail * WHEEL_R_M) / GEAR_RATIO;
    if (Math.abs(cmdMotorNm) > maxMotorFromTire) {
      cmdMotorNm = Math.sign(cmdMotorNm) * maxMotorFromTire;
      clipped = true;
    }

    const wheelTorqueNm = cmdMotorNm * GEAR_RATIO;
    const fxN = wheelTorqueNm / WHEEL_R_M;
    const combinedF = Math.sqrt(fxN * fxN + fy * fy);
    const muUtilPct = Math.min(110, (combinedF / fMaxTotal) * 100);

    return {
      corner,
      motorTorqueNm: cmdMotorNm,
      wheelTorqueNm,
      fxN,
      fyN: fy,
      fzN: fz,
      muUtilPct,
      clipped,
      offline: false,
    };
  });

  const fl = wheels[0];
  const fr = wheels[1];
  const rl = wheels[2];
  const rr = wheels[3];

  const yawMomentTvNm =
    ((fr.fxN - fl.fxN) * TRACK_F_M) / 2 + ((rr.fxN - rl.fxN) * TRACK_R_M) / 2;

  // Power calculation (kW)
  const rawElecPowerKw =
    wheels.reduce((acc, w) => {
      const mechW = w.motorTorqueNm * motorOmega;
      return acc + (mechW >= 0 ? mechW / 0.91 : mechW * 0.87);
    }, 0) / 1000;

  const netHvPowerKw = Math.max(-input.regenCapKw, Math.min(P_DC_MAX_KW, rawElecPowerKw));
  const regenPowerKw = Math.max(0, -netHvPowerKw);

  // Parasitic torque-fight check: opposite-sign torques across left/right during straight-line drive
  const hasOppositeSign =
    (fl.motorTorqueNm * fr.motorTorqueNm < -6 || rl.motorTorqueNm * rr.motorTorqueNm < -6) &&
    Math.abs(input.steerDeg) < 8;
  const parasiticLossW = hasOppositeSign
    ? (Math.abs(fl.motorTorqueNm - fr.motorTorqueNm) + Math.abs(rl.motorTorqueNm - rr.motorTorqueNm)) *
      motorOmega *
      0.14
    : Math.max(0, Math.abs(fl.motorTorqueNm - fr.motorTorqueNm) * 2.2);

  // Stability derivative & phase-plane damping
  let dMzDb = input.controllerMode === "AL_QP_TV" ? -186.4 : -118.2;
  let peakAuth = input.controllerMode === "AL_QP_TV" ? 720 : 0;
  let estPenalty = input.controllerMode === "AL_QP_TV" ? 0.0 : 1.82;
  let bLim = input.controllerMode === "AL_QP_TV" ? 9.8 : 6.4;
  let wzLim = input.controllerMode === "AL_QP_TV" ? 2.45 : 1.85;

  if (input.faultMode === "motor_loss_fl") {
    dMzDb *= 0.78;
    peakAuth = Math.round(peakAuth * 0.71);
    estPenalty += 1.48;
    bLim *= 0.82;
    wzLim *= 0.88;
  } else if (input.faultMode === "motor_loss_rr") {
    dMzDb *= 0.69;
    peakAuth = Math.round(peakAuth * 0.65);
    estPenalty += 2.15;
    bLim *= 0.74;
    wzLim *= 0.81;
  } else if (input.faultMode === "can_jitter_200ms") {
    dMzDb *= 0.64;
    peakAuth = Math.round(peakAuth * 0.84);
    estPenalty += 0.94;
    bLim *= 0.78;
    wzLim *= 0.84;
  } else if (input.faultMode === "cold_tire_18c") {
    dMzDb *= 0.56;
    peakAuth = Math.round(peakAuth * 0.58);
    estPenalty += 3.65;
    bLim *= 0.62;
    wzLim *= 0.72;
  }

  if (input.gripProfile === "COLD_TEST_OCT") {
    dMzDb *= 0.84;
    bLim *= 0.88;
    wzLim *= 0.9;
  }

  const stabilityState: "STABLE" | "MARGINAL" | "UNSTABLE" =
    dMzDb <= -125 ? "STABLE" : dMzDb <= -88 ? "MARGINAL" : "UNSTABLE";

  // Build phase-plane trajectories (Passive Open-Diff vs Closed-Loop AL-QP TV)
  const starts: Array<[number, number, string]> = [
    [-10.5, 2.0, "Perturb A"],
    [10.5, -2.0, "Perturb B"],
    [-7.5, -1.7, "Perturb C"],
    [7.5, 1.7, "Perturb D"],
    [-11.5, 0.35, "Perturb E"],
    [11.5, -0.35, "Perturb F"],
  ];

  const simulateTraj = (mode: TvControllerMode): PhaseTrajectory[] => {
    const damp =
      mode === "AL_QP_TV"
        ? Math.max(0.45, Math.abs(dMzDb) / 165)
        : Math.max(0.28, (Math.abs(dMzDb) * 0.56) / 165);
    const limB = mode === "AL_QP_TV" ? bLim : bLim * 0.68;
    const limW = mode === "AL_QP_TV" ? wzLim : wzLim * 0.76;

    return starts.map(([b0, r0, label]) => {
      let b = b0;
      let r = r0;
      const pts: Array<{ betaDeg: number; wzRadS: number }> = [{ betaDeg: b, wzRadS: r }];
      let diverged = false;
      for (let step = 0; step < 52; step++) {
        const dt = 0.04;
        const nl = mode === "PASSIVE_OPEN_DIFF" ? 0.036 : 0.012;
        const db = -0.82 * damp * b - 2.05 * r + nl * b * b * Math.sign(b);
        const dr = 0.26 * (1.15 - damp) * b - 1.55 * damp * r;
        b += db * dt;
        r += dr * dt;
        if (Math.abs(b) > 13.8 || Math.abs(r) > 2.95) {
          diverged = true;
        }
        b = Math.max(-14, Math.min(14, b));
        r = Math.max(-3.0, Math.min(3.0, r));
        pts.push({ betaDeg: b, wzRadS: r });
      }
      const unstable = diverged || Math.abs(b0) > limB * 1.12 || Math.abs(r0) > limW * 1.12;
      return { label, mode, unstable, points: pts };
    });
  };

  const stabilityBoundary = [
    { betaDeg: -bLim, wzRadS: wzLim * 0.38 },
    { betaDeg: bLim * 0.55, wzRadS: wzLim },
    { betaDeg: bLim, wzRadS: -wzLim * 0.38 },
    { betaDeg: -bLim * 0.55, wzRadS: -wzLim },
  ];

  const operatingBetaDeg = Math.max(
    -12,
    Math.min(12, -(ayMs2 / 9.81) * (input.controllerMode === "AL_QP_TV" ? 1.85 : 3.25))
  );

  return {
    wheels,
    desiredYawRateRadS: desiredWz,
    achievedYawRateRadS: clippedWz * (input.controllerMode === "AL_QP_TV" ? 0.985 : 0.89),
    yawMomentTvNm,
    peakYawAuthorityNm: peakAuth,
    dMzDbNmPerDeg: dMzDb,
    stabilityState,
    netHvPowerKw,
    regenPowerKw,
    parasiticFightDetected: hasOppositeSign,
    parasiticLossW,
    alQpIterations: input.controllerMode === "AL_QP_TV" ? (input.faultMode === "nominal_4wd" ? 14 : 16) : 0,
    solverRuntimeUs: input.controllerMode === "AL_QP_TV" ? 286 : 18,
    estLapPenaltyS: estPenalty,
    stabilityBoundary,
    passiveTrajectories: simulateTraj("PASSIVE_OPEN_DIFF"),
    tvTrajectories: simulateTraj("AL_QP_TV"),
    operatingBetaDeg,
    operatingWzRadS: clippedWz,
  };
}
