import React from "react";
import { TelemetryProvider } from "../state/telemetryStore";

export function AppProviders({ children }: { children: React.ReactNode }) {
  return <TelemetryProvider>{children}</TelemetryProvider>;
}
