import React from "react";
import {
  Activity,
  Box,
  CircleDot,
  GitCompare,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";
import { WorkbenchRouteId } from "../../app/routes";

interface SidebarNavProps {
  activeRoute: WorkbenchRouteId;
  onSelectRoute: (route: WorkbenchRouteId) => void;
}

const NAV_ITEMS: Array<{
  id: WorkbenchRouteId;
  label: string;
  shortcut: string;
  tooltip: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  {
    id: "live_pitwall",
    label: "Pitwall",
    shortcut: "1",
    tooltip: "Live Pitwall — 60 Hz Telemetry, Friction Circles & EKF (1)",
    icon: Activity,
  },
  {
    id: "forensics",
    label: "Forensics",
    shortcut: "2",
    tooltip: "Session Forensics — A/B Lap Analysis & Track Map (2)",
    icon: GitCompare,
  },
  {
    id: "digital_twin",
    label: "3D Twin",
    shortcut: "3",
    tooltip: "3D Spatial Digital Twin — Kinematics & Contact Forces (3)",
    icon: Box,
  },
  {
    id: "tire_lab",
    label: "Tire & TV",
    shortcut: "4",
    tooltip: "MF 6.2 Tire Lab & Torque Vectoring Stability Sandbox (4)",
    icon: CircleDot,
  },
  {
    id: "setup_matrix",
    label: "Setup & LTS",
    shortcut: "5",
    tooltip: "Trackside Setup Matrix, CasADi LTS & Points Strategy (5)",
    icon: SlidersHorizontal,
  },
  {
    id: "validation_vault",
    label: "Vault",
    shortcut: "6",
    tooltip: "Validation Vault & Design Event Dossier (6)",
    icon: ShieldCheck,
  },
];

export function SidebarNav({ activeRoute, onSelectRoute }: SidebarNavProps) {
  return (
    <aside
      aria-label="Workspace Navigation"
      className="w-[74px] shrink-0 bg-[#0D0F15] border-r border-white/[0.065] flex flex-col items-center py-2.5 px-1.5 gap-1.5 select-none no-print"
    >
      {NAV_ITEMS.map((item) => {
        const Icon = item.icon;
        const isActive = item.id === activeRoute;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelectRoute(item.id)}
            title={item.tooltip}
            className={`group relative w-full py-2 px-1 flex flex-col items-center justify-center gap-1 rounded-[6px] cursor-pointer transition-all ${
              isActive
                ? "bg-[#C5A059]/[0.12] text-[#DFBE78]"
                : "bg-transparent text-[#7E8799] hover:text-[#F1F5F9] hover:bg-white/[0.045]"
            }`}
          >
            {isActive ? (
              <span
                aria-hidden="true"
                className="absolute left-0 top-2 bottom-2 w-[2.5px] rounded-r-full bg-[#C5A059]"
              />
            ) : null}
            <Icon className="w-[17px] h-[17px]" />
            <span className="text-[10px] font-medium leading-tight tracking-[-0.01em] whitespace-nowrap">
              {item.label}
            </span>
          </button>
        );
      })}

      <div className="mt-auto pt-2 border-t border-white/[0.06] w-full flex flex-col items-center gap-0.5 text-center">
        <span
          title="ISO 8855 Vehicle Axis Convention: +X Forward, +Y Left, +Z Up"
          className="text-[9.5px] font-mono text-[#64748B]"
        >
          ISO 8855
        </span>
        <span className="text-[9px] text-[#475569]">60 Hz Bus</span>
      </div>
    </aside>
  );
}
