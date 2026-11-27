import type {
  FrictionEllipsePoint,
  GripProfileName,
  TireCompoundName,
  TireCurvePoint,
  TireEvaluateRequest,
  TireEvaluateResponse,
} from "../types";

/**
 * Calibrated offline Pacejka MF 6.2 parametric solver for Hoosier 16.0x7.5-10 (R20 / R25B).
 * Anchored directly to mock_data/tire_evaluation_curves.json baseline:
 *   R25B | FSG_RUBBERED | Fz=750 N | camber=-1.5 deg | temp=75 C | pressure=83 kPa
 *   -> lambda_mux_eff=0.82468, lambda_muy_eff=0.57, peak_fx=1312.71 N, peak_fy=1138.27 N
 * Provenance: CALCULATED (offline parametric MF 6.2) when backend POST /api/tires/evaluate is unreachable.
 */

const GRIP_LAMBDA_MUY: Record<GripProfileName, number> = {
  COLD_TEST_OCT: 0.47,
  FSG_RUBBERED: 0.57,
  FSG_REAL_TRACK: 0.55,
  TTC_LAB_PEAK: 1.0,
};

const COMPOUND_PARAMS: Record<
  TireCompoundName,
  {
    muXBase: number;
    muYBase: number;
    bx: number;
    cx: number;
    ex: number;
    by: number;
    cy: number;
    ey: number;
    optTempC: number;
    coldTempDrop: number;
    loadSensX: number;
    loadSensY: number;
    camberGain: number;
    trailM: number;
  }
> = {
  R25B: {
    muXBase: 2.1224,
    muYBase: 2.6626,
    bx: 11.4,
    cx: 1.62,
    ex: 0.35,
    by: 13.8,
    cy: 1.48,
    ey: -0.45,
    optTempC: 75.0,
    coldTempDrop: 0.24,
    loadSensX: 0.14,
    loadSensY: 0.16,
    camberGain: 0.022,
    trailM: 0.024,
  },
  R20: {
    muXBase: 2.195,
    muYBase: 2.755,
    bx: 12.1,
    cx: 1.64,
    ex: 0.32,
    by: 14.4,
    cy: 1.50,
    ey: -0.48,
    optTempC: 68.0,
    coldTempDrop: 0.18,
    loadSensX: 0.155,
    loadSensY: 0.175,
    camberGain: 0.024,
    trailM: 0.025,
  },
};

export function computeThermalMuFactor(tempC: number, compound: TireCompoundName): number {
  const p = COMPOUND_PARAMS[compound];
  const dt = tempC - p.optTempC;
  if (dt <= 0) {
    // Smooth Gaussian drop toward 18 C cold condition
    const sigma = 42.0;
    const coldPenalty = p.coldTempDrop * (1 - Math.exp(-(dt * dt) / (2 * sigma * sigma)));
    return Math.max(0.68, 1.0 - coldPenalty);
  }
  // Overheating degradation above optimal window
  const overSigma = 38.0;
  const hotPenalty = 0.18 * (1 - Math.exp(-(dt * dt) / (2 * overSigma * overSigma)));
  return Math.max(0.76, 1.0 - hotPenalty);
}

export function evaluateTireOfflineMF62(req: TireEvaluateRequest): TireEvaluateResponse {
  const compound: TireCompoundName = req.compound ?? "R25B";
  const gripProfile: GripProfileName = req.grip_profile ?? "FSG_RUBBERED";
  const fzN = Math.max(50, Math.min(3500, req.fz_n ?? 750));
  const camberDeg = Math.max(-6, Math.min(6, req.camber_deg ?? -1.5));
  const tempC = Math.max(5, Math.min(120, req.temp_c ?? 75));
  const pressureKpa = Math.max(55, Math.min(130, req.pressure_kpa ?? 83));
  const nPoints = Math.max(15, Math.min(201, req.n_points ?? 61));

  const p = COMPOUND_PARAMS[compound];
  const fz0 = 750.0;
  const dfz = (fzN - fz0) / fz0;
  const dpi = (pressureKpa - 83.0) / 83.0;

  const thermalMuFactor = computeThermalMuFactor(tempC, compound);
  const lambdaMuyBase = GRIP_LAMBDA_MUY[gripProfile] ?? 0.57;
  const lambdaMuyEff = Number((lambdaMuyBase * thermalMuFactor).toFixed(5));
  const lambdaMuxEff = Number(((0.82468 / 0.57) * lambdaMuyBase * thermalMuFactor).toFixed(5));

  // Load sensitivity + pressure sensitivity + camber thrust
  const loadFactorY = Math.max(0.65, 1.0 - p.loadSensY * dfz - 0.04 * dpi * dpi);
  const loadFactorX = Math.max(0.68, 1.0 - p.loadSensX * dfz - 0.03 * dpi * dpi);
  const camberAbs = Math.abs(camberDeg);
  const camberPeakBoost = 1.0 + 0.012 * camberAbs - 0.0025 * camberAbs * camberAbs;
  const camberPeakRef = 1.0 + 0.012 * 1.5 - 0.0025 * 1.5 * 1.5;

  const muYEff = p.muYBase * lambdaMuyEff * loadFactorY * (camberPeakBoost / camberPeakRef);
  const muXEff = p.muXBase * lambdaMuxEff * loadFactorX;

  const dy = muYEff * fzN;
  const dx = muXEff * fzN;

  // Camber thrust offset (small lateral force shift at alpha=0)
  const camberThrustN = -camberDeg * p.camberGain * fzN;
  const shYDeg = camberDeg * 0.14;

  const fyVsAlpha: TireCurvePoint[] = [];
  const mzVsAlpha: TireCurvePoint[] = [];
  let peakFyN = 0;

  for (let i = 0; i < nPoints; i++) {
    const alphaDeg = -18.0 + (36.0 * i) / (nPoints - 1);
    const alphaEffRad = ((alphaDeg + shYDeg) * Math.PI) / 180;
    const bxAlpha = p.by * (1.0 - 0.12 * dfz) * alphaEffRad;
    const fyRaw =
      dy * Math.sin(p.cy * Math.atan(bxAlpha - p.ey * (bxAlpha - Math.atan(bxAlpha))));
    const fy = fyRaw + camberThrustN * 0.35;
    peakFyN = Math.max(peakFyN, Math.abs(fy));

    // Pneumatic trail decay with slip angle for aligning torque Mz
    const alphaRad = (alphaDeg * Math.PI) / 180;
    const bt = 14.5 * (1 + 0.1 * dfz);
    const ct = 1.32;
    const trail = p.trailM * Math.cos(ct * Math.atan(bt * alphaRad)) * Math.exp(-Math.abs(alphaRad) * 1.8);
    const mzResidual = -camberDeg * 0.65 * (fzN / 750);
    const mz = -trail * fyRaw + mzResidual * Math.cos(Math.min(Math.PI / 2, Math.abs(alphaRad) * 2.5));

    fyVsAlpha.push({ x: Number(alphaDeg.toFixed(2)), y: Number(fy.toFixed(2)) });
    mzVsAlpha.push({ x: Number(alphaDeg.toFixed(2)), y: Number(mz.toFixed(3)) });
  }

  const fxVsKappa: TireCurvePoint[] = [];
  let peakFxN = 0;
  for (let i = 0; i < nPoints; i++) {
    const kappa = -0.35 + (0.7 * i) / (nPoints - 1);
    const bxK = p.bx * (1.0 - 0.08 * dfz) * kappa;
    const fx = dx * Math.sin(p.cx * Math.atan(bxK - p.ex * (bxK - Math.atan(bxK))));
    peakFxN = Math.max(peakFxN, Math.abs(fx));
    fxVsKappa.push({ x: Number(kappa.toFixed(4)), y: Number(fx.toFixed(2)) });
  }

  const frictionEllipse: FrictionEllipsePoint[] = [];
  const nEll = 73;
  for (let i = 0; i < nEll; i++) {
    const angleDeg = (360 * i) / (nEll - 1);
    const rad = (angleDeg * Math.PI) / 180;
    frictionEllipse.push({
      angle_deg: Number(angleDeg.toFixed(1)),
      fx_n: Number((peakFxN * Math.cos(rad)).toFixed(2)),
      fy_n: Number((peakFyN * Math.sin(rad)).toFixed(2)),
    });
  }

  return {
    compound,
    grip_profile: gripProfile,
    fz_n: fzN,
    camber_deg: camberDeg,
    temp_c: tempC,
    pressure_kpa: pressureKpa,
    lambda_mux_eff: lambdaMuxEff,
    lambda_muy_eff: lambdaMuyEff,
    thermal_mu_factor: Number(thermalMuFactor.toFixed(4)),
    peak_fx_n: Number(peakFxN.toFixed(2)),
    peak_fy_n: Number(peakFyN.toFixed(2)),
    mu_x_eff: Number((peakFxN / fzN).toFixed(4)),
    mu_y_eff: Number((peakFyN / fzN).toFixed(4)),
    fy_vs_alpha: fyVsAlpha,
    fx_vs_kappa: fxVsKappa,
    mz_vs_alpha: mzVsAlpha,
    friction_ellipse: frictionEllipse,
  };
}

export interface TireDerivedMetrics {
  peakFyN: number;
  optAlphaDeg: number;
  corneringStiffnessNPerDeg: number;
  peakFxN: number;
  optKappa: number;
  peakMzNm: number;
  peakPneumaticTrailMm: number;
}

export function extractTireMetrics(resp: TireEvaluateResponse): TireDerivedMetrics {
  let peakFy = 0;
  let optAlpha = 0;
  for (const pt of resp.fy_vs_alpha) {
    if (Math.abs(pt.y) > peakFy) {
      peakFy = Math.abs(pt.y);
      optAlpha = Math.abs(pt.x);
    }
  }

  // Slope dFy/dalpha near 0 deg
  const nearZero = resp.fy_vs_alpha
    .filter((pt) => Math.abs(pt.x) <= 2.0)
    .sort((a, b) => a.x - b.x);
  let cAlpha = 0;
  if (nearZero.length >= 2) {
    const first = nearZero[0];
    const last = nearZero[nearZero.length - 1];
    const dx = last.x - first.x;
    if (Math.abs(dx) > 1e-3) {
      cAlpha = Math.abs((last.y - first.y) / dx);
    }
  }

  let peakFx = 0;
  let optKappa = 0;
  for (const pt of resp.fx_vs_kappa) {
    if (Math.abs(pt.y) > peakFx) {
      peakFx = Math.abs(pt.y);
      optKappa = Math.abs(pt.x);
    }
  }

  let peakMz = 0;
  let peakTrailMm = 0;
  for (let i = 0; i < resp.mz_vs_alpha.length; i++) {
    const mzPt = resp.mz_vs_alpha[i];
    if (Math.abs(mzPt.y) > peakMz) {
      peakMz = Math.abs(mzPt.y);
    }
    const fyPt = resp.fy_vs_alpha[i];
    if (fyPt && Math.abs(fyPt.y) > 150 && Math.abs(fyPt.x) >= 1.0 && Math.abs(fyPt.x) <= 5.0) {
      peakTrailMm = Math.max(peakTrailMm, (Math.abs(mzPt.y) / Math.abs(fyPt.y)) * 1000);
    }
  }

  return {
    peakFyN: peakFy,
    optAlphaDeg: optAlpha,
    corneringStiffnessNPerDeg: cAlpha,
    peakFxN: peakFx,
    optKappa,
    peakMzNm: peakMz,
    peakPneumaticTrailMm: peakTrailMm,
  };
}

export type TvFaultScenario =
  | "normal_4wd"
  | "motor_loss_fl"
  | "motor_loss_rr"
  | "can_latency_125ms"
  | "cold_tires_18c";

export interface TvStabilitySummary {
  scenario: TvFaultScenario;
  label: string;
  dMzDbNmPerDeg: number;
  maxYawAuthorityNm: number;
  stabilityMarginLabel: "STABLE" | "MARGINAL" | "DEGRADED";
  estAutocrossPenaltyS: number;
  phaseBetaLimitDeg: number;
  phaseWzLimitRadS: number;
  effectiveGripScale: number;
}

export function evaluateTvStabilityScenario(
  scenario: TvFaultScenario,
  gripProfile: GripProfileName
): TvStabilitySummary {
  const baseMu = GRIP_LAMBDA_MUY[gripProfile] ?? 0.57;
  const gripNorm = baseMu / 0.57;

  switch (scenario) {
    case "normal_4wd":
      return {
        scenario,
        label: "Nominal 4WD SMC Torque Vectoring",
        dMzDbNmPerDeg: Number((-185.0 * gripNorm).toFixed(1)),
        maxYawAuthorityNm: Number((420.0 * gripNorm).toFixed(0)),
        stabilityMarginLabel: "STABLE",
        estAutocrossPenaltyS: 0.0,
        phaseBetaLimitDeg: 10.5 * Math.sqrt(gripNorm),
        phaseWzLimitRadS: 2.35 * Math.sqrt(gripNorm),
        effectiveGripScale: gripNorm,
      };
    case "motor_loss_fl":
      return {
        scenario,
        label: "3WD Fault: Front-Left Motor Offline",
        dMzDbNmPerDeg: Number((-132.0 * gripNorm).toFixed(1)),
        maxYawAuthorityNm: Number((275.0 * gripNorm).toFixed(0)),
        stabilityMarginLabel: "MARGINAL",
        estAutocrossPenaltyS: 1.42,
        phaseBetaLimitDeg: 8.2 * Math.sqrt(gripNorm),
        phaseWzLimitRadS: 1.98 * Math.sqrt(gripNorm),
        effectiveGripScale: gripNorm * 0.86,
      };
    case "motor_loss_rr":
      return {
        scenario,
        label: "3WD Fault: Rear-Right Motor Offline",
        dMzDbNmPerDeg: Number((-118.0 * gripNorm).toFixed(1)),
        maxYawAuthorityNm: Number((240.0 * gripNorm).toFixed(0)),
        stabilityMarginLabel: "MARGINAL",
        estAutocrossPenaltyS: 1.78,
        phaseBetaLimitDeg: 7.4 * Math.sqrt(gripNorm),
        phaseWzLimitRadS: 1.85 * Math.sqrt(gripNorm),
        effectiveGripScale: gripNorm * 0.82,
      };
    case "can_latency_125ms":
      return {
        scenario,
        label: "Sensor Realism: 125 ms CAN Latency + EKF",
        dMzDbNmPerDeg: Number((-141.0 * gripNorm).toFixed(1)),
        maxYawAuthorityNm: Number((370.0 * gripNorm).toFixed(0)),
        stabilityMarginLabel: "STABLE",
        estAutocrossPenaltyS: 0.34,
        phaseBetaLimitDeg: 9.1 * Math.sqrt(gripNorm),
        phaseWzLimitRadS: 2.18 * Math.sqrt(gripNorm),
        effectiveGripScale: gripNorm * 0.94,
      };
    case "cold_tires_18c":
      return {
        scenario,
        label: "Thermal Fault: Cold Hoosier 18 C Track",
        dMzDbNmPerDeg: Number((-94.0 * gripNorm).toFixed(1)),
        maxYawAuthorityNm: Number((295.0 * gripNorm).toFixed(0)),
        stabilityMarginLabel: "DEGRADED",
        estAutocrossPenaltyS: 2.65,
        phaseBetaLimitDeg: 6.4 * Math.sqrt(gripNorm),
        phaseWzLimitRadS: 1.62 * Math.sqrt(gripNorm),
        effectiveGripScale: gripNorm * 0.72,
      };
  }
}
