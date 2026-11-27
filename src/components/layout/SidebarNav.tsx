import React from "react";
import {
  Activity,
  Box,
  CircleDot,
  GitCompare,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";
import { WORKBENCH_ROUTES, WorkbenchRouteId } from "../../app/routes";

interface SidebarNavProps {
  activeRoute: WorkbenchRouteId;
  onSelectRoute: (route: WorkbenchRouteId) => void;
}

const ROUTE_ICONS: Record<WorkbenchRouteId, React.ComponentType<{ className?: string }>> = {
  live_pitwall: Activity,
  forensics: GitCompare,
  digital_twin: Box,
  tire_lab: CircleDot,
  setup_matrix: SlidersHorizontal,
  validation_vault: ShieldCheck,
};

export function SidebarNav({ activeRoute, onSelectRoute }: SidebarNavProps) {
  return (
    <aside
      aria-label="Workspace Navigation"
      className="w-[48px] shrink-0 bg-[#0F1116] border-r border-[#222633] flex flex-col items-center py-1.5 gap-1 select-none no-print"
    >
      {WORKBENCH_ROUTES.map((route, idx) => {
        const Icon = ROUTE_ICONS[route.id];
        const isActive = route.id === activeRoute;
        return (
          <button
            key={route.id}
            type="button"
            onClick={() => onSelectRoute(route.id)}
            title={`${idx + 1}. ${route.label} — ${route.description}`}
            className={`relative w-[40px] h-[42px] flex flex-col items-center justify-center gap-0.5 rounded-[2px] border cursor-pointer transition-colors ${
              isActive
                ? "bg-[#1B1F2A] border-[#C5A059] text-[#C5A059]"
                : "bg-transparent border-transparent text-[#7E8799] hover:text-[#ECEFF4] hover:bg-[#151820]"
            }`}
          >
            <Icon className="w-4 h-4" />
            <span className="text-[9px] font-mono leading-none">{idx + 1}</span>
          </button>
        );
      })}

      <div className="mt-auto pb-1 flex flex-col items-center gap-1 text-[9px] font-mono text-[#7E8799]">
        <span title="ISO 8855 Coordinate Frame: +X forward, +Y left, +Z up">ISO</span>
        <span>8855</span>
      </div>
    </aside>
  );
}
