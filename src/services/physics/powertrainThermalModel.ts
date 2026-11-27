export interface EnduranceThermalInput {
  energyBudgetKwh: number; // 2.80..3.50 kWh (sweet spot 3.12 kWh)
  regenMaxKw: number; // 0..25 kW
  ambientTempC: number; // 18..45 C
}

export interface EnduranceLapPoint {
  lap: number; // 0..18 (22 km total)
  distanceKm: number;
  cumulativeEnergyKwh: number;
  regenRecoveredKwh: number;
  packOcvV: number;
  packSagVoltageV: number; // under 80 kW peak pull
  socPct: number;
  motorTempC: number;
  inverterTempC: number;
  cellTempC: number;
  tireTreadTempC: number;
  lapPowerCapKw: number;
}

export interface EnduranceThermalSolution {
  laps: EnduranceLapPoint[];
  totalEnergyUsedKwh: number;
  totalRegenKwh: number;
  minTerminalVoltageV: number;
  peakMotorTempC: number;
  peakInverterTempC: number;
  peakCellTempC: number;
  lapsInOptimalTireWindow: number; // 70..85 C
  projectedEnduranceTimeS: number;
  fsgCombinedPts: number;
  fsgDeltaVsSweetSpotPts: number;
  thermalDerateWarning: boolean;
  hvMinVoltageSafe: boolean;
}

const TOTAL_LAPS = 18;
const LAP_DIST_KM = 22.0 / TOTAL_LAPS;
const PACK_CAPACITY_KWH = 6.8;
const PACK_INTERNAL_R_OHM = 0.145; // 144s HV pack ESR
const BASE_ENDURANCE_TIME_S = 1358.9964; // Confirmed CasADi 22 km reference @ 3.12 kWh

export function solveEndurancePowertrainThermal(
  input: EnduranceThermalInput
): EnduranceThermalSolution {
  const laps: EnduranceLapPoint[] = [];

  // Net energy per lap = energyBudget / 18; regen offsets gross consumption so driver can sustain higher lap speed
  const netPerLapKwh = input.energyBudgetKwh / TOTAL_LAPS;
  const regenPerLapKwh = (input.regenMaxKw / 25) * 0.036; // up to ~0.65 kWh recovered across 22 km
  const grossPerLapKwh = netPerLapKwh + regenPerLapKwh;

  // Lap power cap scales smoothly with allowed gross energy
  const basePowerCapKw = Math.max(46, Math.min(80, 52 + (grossPerLapKwh - 0.155) * 410));

  let cumEnergy = 0;
  let cumRegen = 0;
  let motorT = input.ambientTempC + 6;
  let invT = input.ambientTempC + 4;
  let cellT = input.ambientTempC + 2;
  let tireT = input.ambientTempC + 8;

  let minVoltage = 600;
  let peakMotor = motorT;
  let peakInv = invT;
  let peakCell = cellT;
  let optimalTireLaps = 0;

  for (let lap = 0; lap <= TOTAL_LAPS; lap++) {
    const socPct = Math.max(12, 98.0 - (cumEnergy / PACK_CAPACITY_KWH) * 100);
    // 144s LiPo/NMC open-circuit voltage curve (4.12V -> 3.55V per cell)
    const cellOcv = 3.48 + 0.64 * Math.pow(socPct / 100, 0.72);
    const packOcvV = 144 * cellOcv;

    // Terminal voltage sag under 80 kW peak burst (or capped lap power)
    const peakPullW = Math.min(80, Math.max(basePowerCapKw, 66)) * 1000;
    const tempRScale = 1 + Math.max(0, (25 - cellT) * 0.012);
    const rPack = PACK_INTERNAL_R_OHM * tempRScale;
    const currentPeakA = peakPullW / Math.max(380, packOcvV);
    const packSagVoltageV = Math.max(390, packOcvV - currentPeakA * rPack);

    if (packSagVoltageV < minVoltage) minVoltage = packSagVoltageV;
    if (motorT > peakMotor) peakMotor = motorT;
    if (invT > peakInv) peakInv = invT;
    if (cellT > peakCell) peakCell = cellT;
    if (lap > 0 && tireT >= 70 && tireT <= 85) optimalTireLaps += 1;

    laps.push({
      lap,
      distanceKm: lap * LAP_DIST_KM,
      cumulativeEnergyKwh: cumEnergy,
      regenRecoveredKwh: cumRegen,
      packOcvV,
      packSagVoltageV,
      socPct,
      motorTempC: motorT,
      inverterTempC: invT,
      cellTempC: cellT,
      tireTreadTempC: tireT,
      lapPowerCapKw: basePowerCapKw,
    });

    // Advance thermal & energy state by 1 lap (~75.5 s)
    const thermalFactor = 1 + (grossPerLapKwh - 0.19) * 2.1;
    cumEnergy += netPerLapKwh;
    cumRegen += regenPerLapKwh;

    // First-order lumped thermal rise with liquid cooling jacket & airflow dissipation
    const motorEquil = input.ambientTempC + 68 * thermalFactor + (input.regenMaxKw / 25) * 5.5;
    motorT += (motorEquil - motorT) * 0.21;

    const invEquil = input.ambientTempC + 38 * thermalFactor + (input.regenMaxKw / 25) * 4.0;
    invT += (invEquil - invT) * 0.24;

    const cellEquil = input.ambientTempC + 24 * thermalFactor + (input.regenMaxKw / 25) * 2.2;
    cellT += (cellEquil - cellT) * 0.13;

    // Hoosier R25B tread warm-up into 70..85 C window
    const tireEquil = Math.min(93, input.ambientTempC + 49 + (grossPerLapKwh - 0.17) * 40);
    tireT += (tireEquil - tireT) * 0.29;
  }

  // Projected 22 km Endurance time & FSG Endurance+Efficiency combined score anchored to 282.69 pts @ 3.12 kWh
  const effectiveEnergy = input.energyBudgetKwh + totalRegenOffset(input.regenMaxKw);
  const energyTimeScale = Math.pow(3.12 / Math.max(2.65, effectiveEnergy), 0.145);
  const thermalDerateS = peakMotor > 115 ? (peakMotor - 115) * 1.45 : 0;
  const projectedEnduranceTimeS = BASE_ENDURANCE_TIME_S * energyTimeScale + thermalDerateS;

  const deltaTimeS = projectedEnduranceTimeS - BASE_ENDURANCE_TIME_S;
  const effDeltaPts = (3.12 - input.energyBudgetKwh) * 28.5;
  const endDeltaPts = -deltaTimeS * 0.42;
  const fsgCombinedPts = 282.69 + endDeltaPts + effDeltaPts;

  return {
    laps,
    totalEnergyUsedKwh: input.energyBudgetKwh,
    totalRegenKwh: cumRegen,
    minTerminalVoltageV: minVoltage,
    peakMotorTempC: peakMotor,
    peakInverterTempC: peakInv,
    peakCellTempC: peakCell,
    lapsInOptimalTireWindow: optimalTireLaps,
    projectedEnduranceTimeS,
    fsgCombinedPts,
    fsgDeltaVsSweetSpotPts: fsgCombinedPts - 282.69,
    thermalDerateWarning: peakMotor > 115 || peakInverterTempCExceeded(peakInv) || peakCell > 58,
    hvMinVoltageSafe: minVoltage >= 432,
  };
}

function totalRegenOffset(regenMaxKw: number): number {
  return ((regenMaxKw - 18) / 25) * 0.12;
}

function peakInverterTempCExceeded(invT: number): boolean {
  return invT > 78;
}
