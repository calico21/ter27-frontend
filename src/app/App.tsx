import React from "react";
import { AppProviders } from "./providers";
import { useTelemetryStore } from "../state/telemetryStore";
import { AppShell } from "../components/layout/AppShell";
import { LivePitwallView } from "../components/telemetry/LivePitwallView";
import { RealToSimInjector } from "../components/real_to_sim/RealToSimInjector";
import { SessionABComparator } from "../components/forensics/SessionABComparator";
import { Vehicle3DViewport } from "../components/digital_twin/Vehicle3DViewport";
import { SuspensionKinematicsLab } from "../components/kinematics/SuspensionKinematicsLab";
import { TireModelExplorer } from "../components/tire_lab/TireModelExplorer";
import { TorqueVectoringStudio } from "../components/control/TorqueVectoringStudio";
import { VehicleHealthSupervisor } from "../components/safety/VehicleHealthSupervisor";
import { HvThermalStrategyView } from "../components/powertrain/HvThermalStrategyView";
import { TracksideSetupMatrix } from "../components/setup_matrix/TracksideSetupMatrix";
import { CompetitionStrategyView } from "../components/strategy/CompetitionStrategyView";
import { ValidationVaultBrowser } from "../components/validation/ValidationVaultBrowser";

function WorkbenchRouter() {
  const { activeRoute } = useTelemetryStore();

  switch (activeRoute) {
    case "live_pitwall":
      return <LivePitwallView />;
    case "real_to_sim":
      return <RealToSimInjector />;
    case "forensics":
      return <SessionABComparator />;
    case "digital_twin":
      return <Vehicle3DViewport />;
    case "kinematics":
      return <SuspensionKinematicsLab />;
    case "tire_lab":
      return <TireModelExplorer />;
    case "torque_vectoring":
      return <TorqueVectoringStudio />;
    case "ekf_faults":
      return <VehicleHealthSupervisor />;
    case "powertrain":
      return <HvThermalStrategyView />;
    case "setup_matrix":
      return <TracksideSetupMatrix />;
    case "strategy":
      return <CompetitionStrategyView />;
    case "validation_vault":
      return <ValidationVaultBrowser />;
    default:
      return <LivePitwallView />;
  }
}

export function App() {
  return (
    <AppProviders>
      <AppShell>
        <WorkbenchRouter />
      </AppShell>
    </AppProviders>
  );
}
