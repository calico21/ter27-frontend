import type { CornerHardpoints3D, SuspensionOverview, VehicleOverviewResponse } from "../../types";
import { hasNonZeroHardpoints } from "../apiClient";

export interface KinematicsInputs {
  heaveMm: number; // -30 to +30 mm (positive = bump / compression)
  rollDeg: number; // -3.0 to +3.0 deg (ISO 8855: positive = roll right / compress right)
  pitchDeg: number; // -2.0 to +2.0 deg (positive = nose dive)
  rackMm: number; // -35 to +35 mm (positive = left turn)
  springFrontNmm: number; // N/mm (e.g. 35)
  springRearNmm: number; // N/mm (e.g. 48)
  motionRatioFront: number; // e.g. 0.92
  motionRatioRear: number; // e.g. 0.92
  arbFrontNmRad: number; // e.g. 4500
  arbRearNmRad: number; // e.g. 5500
}

export interface SweepPoint {
  x: number;
  yFront: number;
  yRear: number;
}

export interface AckermannPoint {
  rackMm: number;
  innerDeg: number;
  outerDeg: number;
  ackermannPct: number;
}

export interface RollCenterPoint {
  rollDeg: number;
  yMm: number;
  zMm: number;
}

export interface KinematicsSolution {
  provenance: string;
  usingConfirmedHardpoints: boolean;
  // Operating point outputs
  camberFrontLeftDeg: number;
  camberFrontRightDeg: number;
  camberRearLeftDeg: number;
  camberRearRightDeg: number;
  toeFrontLeftDeg: number;
  toeFrontRightDeg: number;
  ackermannPctAtRack: number;
  innerSteerDeg: number;
  outerSteerDeg: number;
  frontRcYmm: number;
  frontRcZmm: number;
  rearRcYmm: number;
  rearRcZmm: number;
  antiDiveFrontPct: number;
  antiSquatRearPct: number;
  // Wheel rate / ride frequency / LLTD
  wheelRateFrontNmm: number;
  wheelRateRearNmm: number;
  rideFreqFrontHz: number;
  rideFreqRearHz: number;
  rollStiffFrontNmDeg: number;
  rollStiffRearNmDeg: number;
  lltdElasticFront: number;
  rollGradientDegPerG: number;
  // Curves for 4 Canvas plots
  camberSweep: SweepPoint[]; // x = heave mm, y = camber deg
  bumpSteerSweep: SweepPoint[]; // x = heave mm, y = toe deg
  ackermannSweep: AckermannPoint[]; // x = rack mm
  frontRcMigration: RollCenterPoint[];
  rearRcMigration: RollCenterPoint[];
}

interface DerivedArmGeometry {
  upperArmLenM: number;
  lowerArmLenM: number;
  uprightHeightM: number;
  staticRcZM: number;
  camberGainDegPerMm: number;
  bumpSteerDegPerMm: number;
}

function vecLen(a: number[], b: number[]): number {
  const dx = (a[0] ?? 0) - (b[0] ?? 0);
  const dy = (a[1] ?? 0) - (b[1] ?? 0);
  const dz = (a[2] ?? 0) - (b[2] ?? 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function deriveArmGeometryFromCorner(
  corner: CornerHardpoints3D | undefined,
  isFront: boolean
): DerivedArmGeometry {
  if (corner && hasNonZeroHardpoints(corner)) {
    const lcaMid: [number, number, number] = [
      0.5 * (corner.lca_front[0] + corner.lca_rear[0]),
      0.5 * (corner.lca_front[1] + corner.lca_rear[1]),
      0.5 * (corner.lca_front[2] + corner.lca_rear[2]),
    ];
    const ucaMid: [number, number, number] = [
      0.5 * (corner.uca_front[0] + corner.uca_rear[0]),
      0.5 * (corner.uca_front[1] + corner.uca_rear[1]),
      0.5 * (corner.uca_front[2] + corner.uca_rear[2]),
    ];

    const lowerLen = Math.max(0.22, vecLen(lcaMid, corner.lbj));
    const upperLen = Math.max(0.16, vecLen(ucaMid, corner.ubj));
    const uprightH = Math.max(0.14, Math.abs(corner.ubj[2] - corner.lbj[2]));

    // 2D front-view instant center intersection (Y-Z plane)
    const dyL = corner.lbj[1] - lcaMid[1];
    const dzL = corner.lbj[2] - lcaMid[2];
    const dyU = corner.ubj[1] - ucaMid[1];
    const dzU = corner.ubj[2] - ucaMid[2];

    const mL = Math.abs(dyL) > 1e-4 ? dzL / dyL : 0;
    const mU = Math.abs(dyU) > 1e-4 ? dzU / dyU : -0.15;

    let rcZ = isFront ? 0.028 : 0.044;
    if (Math.abs(mU - mL) > 1e-3) {
      const yIC = (corner.lbj[2] - corner.ubj[2] + mU * corner.ubj[1] - mL * corner.lbj[1]) / (mU - mL);
      const zIC = corner.lbj[2] + mL * (yIC - corner.lbj[1]);
      // Line from contact patch to IC evaluated at y=0
      const cpY = corner.contact_patch[1];
      const cpZ = corner.contact_patch[2];
      if (Math.abs(yIC - cpY) > 1e-3) {
        const zAtCenter = cpZ + ((zIC - cpZ) / (yIC - cpY)) * (0 - cpY);
        rcZ = Math.max(-0.04, Math.min(0.12, zAtCenter));
      }
    }

    const ratio = lowerLen / Math.max(0.15, upperLen);
    const camberGainDegPerMm = -(0.022 + (ratio - 1.0) * 0.055);
    const tieDy = corner.tie_outer[1] - corner.tie_inner[1];
    const tieDz = corner.tie_outer[2] - corner.tie_inner[2];
    const tieSlope = Math.abs(tieDy) > 1e-4 ? tieDz / tieDy : 0;
    const bumpSteerDegPerMm = (tieSlope - mL) * 0.045;

    return {
      upperArmLenM: upperLen,
      lowerArmLenM: lowerLen,
      uprightHeightM: uprightH,
      staticRcZM: rcZ,
      camberGainDegPerMm,
      bumpSteerDegPerMm,
    };
  }

  // Parametric SLA baseline calibrated to TeR27 chassis parameters when 3D hardpoints are unloaded
  return isFront
    ? {
        upperArmLenM: 0.285,
        lowerArmLenM: 0.375,
        uprightHeightM: 0.195,
        staticRcZM: 0.028,
        camberGainDegPerMm: -0.046,
        bumpSteerDegPerMm: 0.0045,
      }
    : {
        upperArmLenM: 0.275,
        lowerArmLenM: 0.365,
        uprightHeightM: 0.19,
        staticRcZM: 0.044,
        camberGainDegPerMm: -0.052,
        bumpSteerDegPerMm: -0.0038,
      };
}

export function solveSuspensionKinematics(
  inputs: KinematicsInputs,
  suspension?: SuspensionOverview | null,
  params?: VehicleOverviewResponse["params"] | null
): KinematicsSolution {
  const wheelbaseM = params?.wheelbase_m ?? 1.54;
  const trackFrontM = params?.track_front_m ?? 1.24;
  const trackRearM = params?.track_rear_m ?? 1.22;
  const cgHeightM = params?.cg_height_m ?? 0.285;
  const sprungMassKg = params?.sprung_mass_kg ?? 223.0;
  const frontWeightDist = params?.front_weight_dist ?? 0.48;

  const staticCamberF = suspension?.static_camber_front_deg ?? -2.0;
  const staticCamberR = suspension?.static_camber_rear_deg ?? -1.5;
  const antiDiveFrontPct = (suspension?.anti_dive_front ?? 0.569) * 100;
  const antiSquatRearPct = (suspension?.anti_squat_rear ?? 0.412) * 100;

  const hasConfirmed =
    hasNonZeroHardpoints(suspension?.front_left_hardpoints) &&
    hasNonZeroHardpoints(suspension?.rear_left_hardpoints);

  const geomF = deriveArmGeometryFromCorner(suspension?.front_left_hardpoints, true);
  const geomR = deriveArmGeometryFromCorner(suspension?.rear_left_hardpoints, false);

  const evalCamber = (staticDeg: number, heaveMm: number, gain: number): number => {
    // Non-linear progressive SLA camber gain (quadratic bump progression)
    return staticDeg + gain * heaveMm - 0.00028 * heaveMm * Math.abs(heaveMm);
  };

  const evalBumpSteer = (heaveMm: number, slope: number): number => {
    return slope * heaveMm + 0.000045 * heaveMm * heaveMm;
  };

  // Corner heave displacements from body heave, roll, and pitch
  const rollRad = (inputs.rollDeg * Math.PI) / 180;
  const pitchRad = (inputs.pitchDeg * Math.PI) / 180;

  const pitchFrontMm = Math.sin(pitchRad) * (wheelbaseM * (1 - frontWeightDist)) * 1000;
  const pitchRearMm = -Math.sin(pitchRad) * (wheelbaseM * frontWeightDist) * 1000;

  const rollFrontMm = Math.sin(rollRad) * (trackFrontM * 0.5) * 1000;
  const rollRearMm = Math.sin(rollRad) * (trackRearM * 0.5) * 1000;

  // Positive rollDeg = roll right -> right side compresses (+), left side droops (-)
  const heaveFL = inputs.heaveMm + pitchFrontMm - rollFrontMm;
  const heaveFR = inputs.heaveMm + pitchFrontMm + rollFrontMm;
  const heaveRL = inputs.heaveMm + pitchRearMm - rollRearMm;
  const heaveRR = inputs.heaveMm + pitchRearMm + rollRearMm;

  // Dynamic wheel camber relative to road includes body roll compensation
  const camberFrontLeftDeg = evalCamber(staticCamberF, heaveFL, geomF.camberGainDegPerMm) - inputs.rollDeg;
  const camberFrontRightDeg = evalCamber(staticCamberF, heaveFR, geomF.camberGainDegPerMm) + inputs.rollDeg;
  const camberRearLeftDeg = evalCamber(staticCamberR, heaveRL, geomR.camberGainDegPerMm) - inputs.rollDeg;
  const camberRearRightDeg = evalCamber(staticCamberR, heaveRR, geomR.camberGainDegPerMm) + inputs.rollDeg;

  const toeFrontLeftDeg = evalBumpSteer(heaveFL, geomF.bumpSteerDegPerMm);
  const toeFrontRightDeg = evalBumpSteer(heaveFR, geomF.bumpSteerDegPerMm);

  // Progressive Ackermann Steering Geometry (rack travel -> inner/outer road wheel angles)
  const evalAckermann = (rackMm: number): AckermannPoint => {
    const absRack = Math.abs(rackMm);
    const meanSteerDeg = absRack * 0.82; // ~28.7 deg max road wheel steer at 35 mm rack
    const meanRad = (meanSteerDeg * Math.PI) / 180;
    if (absRack < 0.25) {
      return { rackMm, innerDeg: 0, outerDeg: 0, ackermannPct: 68.0 };
    }
    // Ideal 100% Ackermann difference cot(outer) - cot(inner) = track / wheelbase
    const cotMean = 1 / Math.max(1e-4, Math.tan(meanRad));
    const halfRatio = (0.5 * trackFrontM) / wheelbaseM;
    const idealInnerDeg = (Math.atan(1 / Math.max(0.15, cotMean - halfRatio)) * 180) / Math.PI;
    const idealOuterDeg = (Math.atan(1 / (cotMean + halfRatio)) * 180) / Math.PI;
    // TeR27 progressive Ackermann ramps from 64% at low lock to 88% at tight hairpins/skidpad
    const ackPct = Math.min(92, 64 + (absRack / 35) * 24);
    const f = ackPct / 100;
    const innerDeg = meanSteerDeg + f * (idealInnerDeg - meanSteerDeg);
    const outerDeg = meanSteerDeg - f * (meanSteerDeg - idealOuterDeg);
    return { rackMm, innerDeg, outerDeg, ackermannPct: ackPct };
  };

  const rackSol = evalAckermann(inputs.rackMm);

  // Roll Center migration curves across roll angle (-3..+3 deg)
  const evalRcAt = (rDeg: number, staticZ: number, trackM: number, isFront: boolean): RollCenterPoint => {
    const yMm = rDeg * (isFront ? 14.5 : 11.8) + Math.sign(rDeg) * rDeg * rDeg * 0.65;
    const heaveShiftMm = -inputs.heaveMm * (isFront ? 0.58 : 0.64);
    const pitchShiftMm = (isFront ? -1 : 1) * inputs.pitchDeg * 4.2;
    const rollDropMm = -Math.abs(rDeg) * (trackM * 2.1);
    const zMm = staticZ * 1000 + heaveShiftMm + pitchShiftMm + rollDropMm;
    return { rollDeg: rDeg, yMm, zMm };
  };

  const frontRcNow = evalRcAt(inputs.rollDeg, geomF.staticRcZM, trackFrontM, true);
  const rearRcNow = evalRcAt(inputs.rollDeg, geomR.staticRcZM, trackRearM, false);

  // Wheel Rate, Ride Frequency & Elastic LLTD Calculator
  // Kw = Ks * MR^2 (N/mm)
  const wheelRateFrontNmm = inputs.springFrontNmm * inputs.motionRatioFront * inputs.motionRatioFront;
  const wheelRateRearNmm = inputs.springRearNmm * inputs.motionRatioRear * inputs.motionRatioRear;

  const cornerSprungMassF = (sprungMassKg * frontWeightDist) / 2;
  const cornerSprungMassR = (sprungMassKg * (1 - frontWeightDist)) / 2;

  // f_ride = (1 / 2pi) * sqrt(Kw_N_m / m_corner)
  const rideFreqFrontHz =
    (1 / (2 * Math.PI)) * Math.sqrt((wheelRateFrontNmm * 1000) / Math.max(10, cornerSprungMassF));
  const rideFreqRearHz =
    (1 / (2 * Math.PI)) * Math.sqrt((wheelRateRearNmm * 1000) / Math.max(10, cornerSprungMassR));

  // Axle Roll Stiffness K_phi (Nm/rad) = 0.5 * Kw * track^2 + K_arb
  const kPhiFrontNmRad =
    0.5 * (wheelRateFrontNmm * 1000) * trackFrontM * trackFrontM + inputs.arbFrontNmRad;
  const kPhiRearNmRad =
    0.5 * (wheelRateRearNmm * 1000) * trackRearM * trackRearM + inputs.arbRearNmRad;

  const degToRad = Math.PI / 180;
  const rollStiffFrontNmDeg = kPhiFrontNmRad * degToRad;
  const rollStiffRearNmDeg = kPhiRearNmRad * degToRad;

  const lltdElasticFront = kPhiFrontNmRad / Math.max(1, kPhiFrontNmRad + kPhiRearNmRad);

  // Roll gradient (deg/g): phi / ay_g = (m_s * g * h_arm) / (K_phi_total)
  const avgRcZ = 0.5 * (geomF.staticRcZM + geomR.staticRcZM);
  const rollMomentArmM = Math.max(0.08, cgHeightM - avgRcZ);
  const rollMomentPerG = sprungMassKg * 9.81 * rollMomentArmM;
  const rollGradientDegPerG = rollMomentPerG / Math.max(1, rollStiffFrontNmDeg + rollStiffRearNmDeg);

  // Build sweep curves
  const camberSweep: SweepPoint[] = [];
  const bumpSteerSweep: SweepPoint[] = [];
  for (let h = -30; h <= 30; h += 2) {
    camberSweep.push({
      x: h,
      yFront: evalCamber(staticCamberF, h, geomF.camberGainDegPerMm),
      yRear: evalCamber(staticCamberR, h, geomR.camberGainDegPerMm),
    });
    bumpSteerSweep.push({
      x: h,
      yFront: evalBumpSteer(h, geomF.bumpSteerDegPerMm),
      yRear: evalBumpSteer(h, geomR.bumpSteerDegPerMm),
    });
  }

  const ackermannSweep: AckermannPoint[] = [];
  for (let r = 0; r <= 35; r += 2.5) {
    ackermannSweep.push(evalAckermann(r));
  }

  const frontRcMigration: RollCenterPoint[] = [];
  const rearRcMigration: RollCenterPoint[] = [];
  for (let roll = -3.0; roll <= 3.001; roll += 0.25) {
    frontRcMigration.push(evalRcAt(roll, geomF.staticRcZM, trackFrontM, true));
    rearRcMigration.push(evalRcAt(roll, geomR.staticRcZM, trackRearM, false));
  }

  return {
    provenance: hasConfirmed
      ? "CALCULATED (From Confirmed ISO 8855 3D Hardpoints)"
      : "CALCULATED (Parametric SLA Model — Confirmed 3D Hardpoints Unloaded)",
    usingConfirmedHardpoints: hasConfirmed,
    camberFrontLeftDeg,
    camberFrontRightDeg,
    camberRearLeftDeg,
    camberRearRightDeg,
    toeFrontLeftDeg,
    toeFrontRightDeg,
    ackermannPctAtRack: rackSol.ackermannPct,
    innerSteerDeg: rackSol.innerDeg,
    outerSteerDeg: rackSol.outerDeg,
    frontRcYmm: frontRcNow.yMm,
    frontRcZmm: frontRcNow.zMm,
    rearRcYmm: rearRcNow.yMm,
    rearRcZmm: rearRcNow.zMm,
    antiDiveFrontPct,
    antiSquatRearPct,
    wheelRateFrontNmm,
    wheelRateRearNmm,
    rideFreqFrontHz,
    rideFreqRearHz,
    rollStiffFrontNmDeg,
    rollStiffRearNmDeg,
    lltdElasticFront,
    rollGradientDegPerG,
    camberSweep,
    bumpSteerSweep,
    ackermannSweep,
    frontRcMigration,
    rearRcMigration,
  };
}
