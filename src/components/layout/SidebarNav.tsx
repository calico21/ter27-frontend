import React, { useState } from "react";
import {
  WORKBENCH_PILLARS,
  WORKBENCH_ROUTES,
  WorkbenchRouteId,
} from "../../app/routes";
import { useTelemetryStore } from "../../state/telemetryStore";

interface SidebarNavProps {
  activeRoute: WorkbenchRouteId;
  onSelectRoute: (route: WorkbenchRouteId) => void;
}

/**
 * 12 bespoke geometric SVG engineering icons (18x18 viewBox, crisp 1.5px strokes).
 */
function WorkspaceIcon({ id }: { id: WorkbenchRouteId }) {
  switch (id) {
    case "live_pitwall":
      // Dual-trace oscilloscope waveform
      return (
        <svg viewBox="0 0 18 18" className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="2.5" width="14" height="13" rx="1.5" opacity="0.45" />
          <path d="M2.5 10.5H5L6.8 6L9.2 12.5L11.2 8.5L13 10.5H15.5" />
        </svg>
      );
    case "real_to_sim":
      // Bidirectional track-to-sim signal bridge
      return (
        <svg viewBox="0 0 18 18" className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="4.5" cy="9" r="2.2" />
          <circle cx="13.5" cy="9" r="2.2" />
          <path d="M6.7 7.5L11.3 7.5M10 6L11.5 7.5L10 9" />
          <path d="M11.3 10.5L6.7 10.5M8 9L6.5 10.5L8 12" />
        </svg>
      );
    case "forensics":
      // A/B lap delta overlay curves
      return (
        <svg viewBox="0 0 18 18" className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2.5 14.5H15.5" opacity="0.45" />
          <path d="M2.5 11.5C5 11.5 6 4.5 9.2 4.5C12 4.5 13 9 15.5 8" />
          <path d="M2.5 12.5C5.2 12.5 6.8 7 9.6 7C12.2 7 13.5 10.5 15.5 10" strokeDasharray="2 2" opacity="0.75" />
        </svg>
      );
    case "digital_twin":
      // Isometric 3D wireframe chassis cube
      return (
        <svg viewBox="0 0 18 18" className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 2.2L15 5.6V12.4L9 15.8L3 12.4V5.6L9 2.2Z" />
          <path d="M3 5.6L9 9L15 5.6M9 9V15.8" opacity="0.7" />
        </svg>
      );
    case "kinematics":
      // Double-wishbone SLA linkage & upright
      return (
        <svg viewBox="0 0 18 18" className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 5.5L11.5 4.2" />
          <path d="M3 12.5L12 13.5" />
          <path d="M11.5 4.2L12 13.5" />
          <path d="M4.5 12.5L9.5 6.8" opacity="0.65" />
          <rect x="13" y="4" width="2.5" height="10" rx="0.8" />
        </svg>
      );
    case "tire_lab":
      // Tire friction ellipse with crosshairs
      return (
        <svg viewBox="0 0 18 18" className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <ellipse cx="9" cy="9" rx="6.2" ry="4.8" />
          <path d="M9 2.5V15.5M2 9H16" opacity="0.45" />
          <path d="M9 9L12.8 6.4" />
          <circle cx="12.8" cy="6.4" r="1" fill="currentColor" />
        </svg>
      );
    case "torque_vectoring":
      // 4-wheel vectoring torque arrows around chassis CG
      return (
        <svg viewBox="0 0 18 18" className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="6.5" y="4.5" width="5" height="9" rx="1" opacity="0.55" />
          <path d="M3.5 7.5V4M2.3 5.2L3.5 4L4.7 5.2" />
          <path d="M14.5 9V3.2M13.3 4.4L14.5 3.2L15.7 4.4" />
          <path d="M3.5 14V11.2M14.5 14.5V10.5" />
        </svg>
      );
    case "ekf_faults":
      // Safety shield with interlock pulse / E-Stop supervisor
      return (
        <svg viewBox="0 0 18 18" className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 2.2L14.8 4.4V8.8C14.8 12.2 12.4 14.7 9 15.8C5.6 14.7 3.2 12.2 3.2 8.8V4.4L9 2.2Z" />
          <path d="M5.8 9.2H7.6L8.6 6.8L9.8 11.2L10.8 9.2H12.2" />
        </svg>
      );
    case "powertrain":
      // HV accumulator cell stack & discharge bolt
      return (
        <svg viewBox="0 0 18 18" className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2.5" y="4.5" width="11.5" height="9" rx="1.2" />
          <path d="M14 7.2H15.5V10.8H14" />
          <path d="M8.8 6.5L6.8 9.2H9.2L7.7 11.8" />
        </svg>
      );
    case "setup_matrix":
      // Precision 3-rail mechanical setup sliders
      return (
        <svg viewBox="0 0 18 18" className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 4.8H15M3 9H15M3 13.2H15" opacity="0.5" />
          <circle cx="6.5" cy="4.8" r="1.6" fill="#0C0E14" />
          <circle cx="11.8" cy="9" r="1.6" fill="#0C0E14" />
          <circle cx="7.8" cy="13.2" r="1.6" fill="#0C0E14" />
        </svg>
      );
    case "strategy":
      // Tornado sensitivity / CasADi trajectory optimization
      return (
        <svg viewBox="0 0 18 18" className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 2.5V15.5" opacity="0.45" />
          <path d="M4.2 5H14.5M5.8 8.8H13.2M7.2 12.6H11.6" strokeWidth="2.1" />
        </svg>
      );
    case "validation_vault":
      // Verification dossier checkmark ledger
      return (
        <svg viewBox="0 0 18 18" className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3.2" y="2.5" width="11.6" height="13" rx="1.2" />
          <path d="M6.2 9.2L8.2 11.2L12 7" />
          <path d="M6.2 5.2H11.8" opacity="0.5" />
        </svg>
      );
  }
}

export function SidebarNav({ activeRoute, onSelectRoute }: SidebarNavProps) {
  const { stopState, injectedSafetyFault } = useTelemetryStore();
  const [hovered, setHovered] = useState<{
    id: WorkbenchRouteId;
    label: string;
    groupTag: string;
    shortcut?: string;
    top: number;
  } | null>(null);

  const safetyAlertActive = stopState !== "NOMINAL" || injectedSafetyFault !== null;

  return (
    <aside
      aria-label="Workspace Navigation"
      className="relative w-[52px] shrink-0 bg-[#0C0E14] border-r border-[#222633] flex flex-col items-center py-2 select-none no-print z-30"
    >
      <div className="flex-1 min-h-0 w-full flex flex-col items-center overflow-y-auto overflow-x-hidden">
        {WORKBENCH_PILLARS.map((pillar, pIdx) => {
          const items = WORKBENCH_ROUTES.filter((r) => r.pillarId === pillar.id);
          return (
            <div
              key={pillar.id}
              className={`w-full flex flex-col items-center gap-1 ${
                pIdx > 0 ? "mt-2 pt-2 border-t border-[#222633]" : ""
              }`}
            >
              {items.map((item) => {
                const isActive = item.id === activeRoute;
                const isSafetyFault = item.id === "ekf_faults" && safetyAlertActive;
                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-label={`${item.label}${item.shortcut ? ` [${item.shortcut}]` : ""}`}
                    onClick={() => onSelectRoute(item.id)}
                    onMouseEnter={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      setHovered({
                        id: item.id,
                        label: item.label,
                        groupTag: item.groupTag,
                        shortcut: item.shortcut,
                        top: rect.top + rect.height / 2,
                      });
                    }}
                    onMouseLeave={() => setHovered(null)}
                    className={`relative w-[38px] h-[34px] flex items-center justify-center rounded-[4px] cursor-pointer transition-colors ${
                      isActive
                        ? "bg-[#181C26] text-[#C5A059]"
                        : isSafetyFault
                          ? "bg-[#DC2626]/15 text-[#F87171] hover:bg-[#DC2626]/25"
                          : "bg-transparent text-[#7E8799] hover:text-[#ECEFF4] hover:bg-[#151820]"
                    }`}
                  >
                    {isActive ? (
                      <span
                        aria-hidden="true"
                        className="absolute -left-[7px] top-1.5 bottom-1.5 w-[2px] bg-[#C5A059]"
                      />
                    ) : null}
                    <WorkspaceIcon id={item.id} />
                    {isSafetyFault ? (
                      <span
                        aria-hidden="true"
                        className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-[#EF4444]"
                      />
                    ) : null}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>

      {/* Subtle ISO 8855 anchor at rail foot */}
      <div className="shrink-0 pt-2 mt-1 w-full border-t border-[#222633] flex flex-col items-center">
        <span
          title="ISO 8855 (+X Forward, +Y Left, +Z Up)"
          className="font-mono text-[8.5px] tracking-tight text-[#64748B]"
        >
          ISO
        </span>
      </div>

      {/* Instant Crisp Floating Right Tooltip */}
      {hovered ? (
        <div
          role="tooltip"
          style={{ top: hovered.top }}
          className="pointer-events-none fixed left-[58px] -translate-y-1/2 z-50 px-2.5 py-1.5 rounded-[4px] bg-[#151820] border border-[#2A3040] shadow-[0_8px_24px_rgba(0,0,0,0.65)] whitespace-nowrap"
        >
          <div className="flex items-center gap-2">
            <span className="text-[11.5px] font-semibold text-[#ECEFF4]">{hovered.label}</span>
            {hovered.shortcut ? (
              <kbd className="font-mono text-[9.5px] px-1 py-0.2 rounded-[2px] bg-[#0B0D12] border border-[#222633] text-[#C5A059]">
                {hovered.shortcut}
              </kbd>
            ) : null}
          </div>
          <div className="text-[10px] text-[#7E8799] mt-0.5">{hovered.groupTag}</div>
        </div>
      ) : null}
    </aside>
  );
}
