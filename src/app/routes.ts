export type WorkbenchRouteId =
  | "live_pitwall"
  | "real_to_sim"
  | "forensics"
  | "digital_twin"
  | "kinematics"
  | "tire_lab"
  | "torque_vectoring"
  | "ekf_faults"
  | "powertrain"
  | "setup_matrix"
  | "strategy"
  | "validation_vault";

export type PillarId = 1 | 2 | 3 | 4;

export interface WorkbenchPillar {
  id: PillarId;
  roman: string;
  title: string;
}

export interface WorkbenchRouteSpec {
  id: WorkbenchRouteId;
  index: number;
  pillarId: PillarId;
  groupTag: string;
  path: string;
  label: string;
  shortLabel: string;
  shortcut?: string;
  description: string;
}

export const WORKBENCH_PILLARS: WorkbenchPillar[] = [
  { id: 1, roman: "I", title: "Trackside & Sim" },
  { id: 2, roman: "II", title: "Chassis & Tires" },
  { id: 3, roman: "III", title: "Control, Safety & HV" },
  { id: 4, roman: "IV", title: "Strategy & Validation" },
];

export const WORKBENCH_ROUTES: WorkbenchRouteSpec[] = [
  // Group 1 (Trackside & Sim)
  {
    id: "live_pitwall",
    index: 1,
    pillarId: 1,
    groupTag: "Trackside & Sim",
    path: "/pitwall",
    label: "Pitwall Live",
    shortLabel: "Pitwall",
    shortcut: "1",
    description: "60 Hz 14-DOF telemetry stream, universal signal oscilloscopes, and 2x2 friction circles",
  },
  {
    id: "real_to_sim",
    index: 2,
    pillarId: 1,
    groupTag: "Trackside & Sim",
    path: "/real-to-sim",
    label: "Real-to-Sim Injector",
    shortLabel: "Real-to-Sim",
    shortcut: "2",
    description: "Track telemetry ingestion, FR/RL sensor audit, lap trimmer, and MirenaSim UDP ghost dispatch",
  },
  {
    id: "forensics",
    index: 3,
    pillarId: 1,
    groupTag: "Trackside & Sim",
    path: "/forensics",
    label: "Lap Forensics (A/B)",
    shortLabel: "Forensics",
    shortcut: "3",
    description: "Session A/B comparison, CasADi reference overlay, circuit map, and sector deltas",
  },

  // Group 2 (Chassis & Tires)
  {
    id: "digital_twin",
    index: 4,
    pillarId: 2,
    groupTag: "Chassis & Tires",
    path: "/twin",
    label: "3D Digital Twin",
    shortLabel: "3D Twin",
    shortcut: "4",
    description: "Interactive 3D double-wishbone kinematics, wheel travel, tire force vectors, and ISO 8855 hardpoints",
  },
  {
    id: "kinematics",
    index: 5,
    pillarId: 2,
    groupTag: "Chassis & Tires",
    path: "/kinematics",
    label: "Suspension Kinematics",
    shortLabel: "Kinematics",
    shortcut: "5",
    description: "Heave/roll/pitch/steer sweeps, camber gain, Ackermann, roll center migration, and LLTD calculator",
  },
  {
    id: "tire_lab",
    index: 6,
    pillarId: 2,
    groupTag: "Chassis & Tires",
    path: "/tires",
    label: "Tire Lab (MF 6.2 + PINN)",
    shortLabel: "Tire Lab",
    shortcut: "6",
    description: "Hoosier 16.0x7.5-10 R25B/R20 Pacejka MF 6.2 curves, friction ellipses, and Hybrid PINN benchmarks",
  },

  // Group 3 (Control, Safety & HV)
  {
    id: "torque_vectoring",
    index: 7,
    pillarId: 3,
    groupTag: "Control, Safety & HV",
    path: "/control",
    label: "4WD Torque Vectoring",
    shortLabel: "Torque Vec",
    shortcut: "7",
    description: "200 Hz AL-QP yaw phase-plane portrait, 4-wheel allocation, regen trail-braking, and fight monitor",
  },
  {
    id: "ekf_faults",
    index: 8,
    pillarId: 3,
    groupTag: "Control, Safety & HV",
    path: "/safety-supervisor",
    label: "Safety & E-Stop Supervisor",
    shortLabel: "Safety & E-Stop",
    shortcut: "8",
    description: "Real-time sensor plausibility, APPS/BSPD/EKF interlocks, pre-fault freeze-frame, and E-STOP console",
  },
  {
    id: "powertrain",
    index: 9,
    pillarId: 3,
    groupTag: "Control, Safety & HV",
    path: "/powertrain",
    label: "HV Accumulator & Thermal",
    shortLabel: "HV & Thermal",
    shortcut: "9",
    description: "22 km Endurance HV energy planner, 80 kW voltage sag, motor/inverter thermal, and tire warm-up",
  },

  // Group 4 (Strategy & Validation)
  {
    id: "setup_matrix",
    index: 10,
    pillarId: 4,
    groupTag: "Strategy & Validation",
    path: "/setup",
    label: "Setup Matrix & Pit Sheet",
    shortLabel: "Setup Matrix",
    shortcut: "0",
    description: "Differential setup matrix, bounds-validated draft, cold-to-hot pressure tool, and printable pit sheet",
  },
  {
    id: "strategy",
    index: 11,
    pillarId: 4,
    groupTag: "Strategy & Validation",
    path: "/strategy",
    label: "CasADi LTS & Aero/Points",
    shortLabel: "LTS & Points",
    description: "CasADi-IPOPT simulation launcher, aero map rake explorer, and FSG / FS Spain Tornado sensitivity",
  },
  {
    id: "validation_vault",
    index: 12,
    pillarId: 4,
    groupTag: "Strategy & Validation",
    path: "/validation",
    label: "Validation Vault & Dossier",
    shortLabel: "Vault",
    description: "10-suite verification catalog, 67 300-DPI figures, and printable FSG Design Event dossier",
  },
];
