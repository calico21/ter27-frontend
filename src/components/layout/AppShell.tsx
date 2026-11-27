import React, { useEffect } from "react";
import { X } from "lucide-react";
import { WORKBENCH_ROUTES, WorkbenchRouteId } from "../../app/routes";
import { useTelemetryStore } from "../../state/telemetryStore";
import { TopStatusBar } from "./TopStatusBar";
import { SidebarNav } from "./SidebarNav";
import { CommandPalette } from "./CommandPalette";

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const {
    activeRoute,
    setActiveRoute,
    togglePlayPause,
    stepPlaybackFrame,
    setCommandPaletteOpen,
    commandPaletteOpen,
    toasts,
    dismissToast,
  } = useTelemetryStore();

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isInput =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCommandPaletteOpen((open) => !open);
        return;
      }

      if (e.key === "Escape") {
        if (commandPaletteOpen) {
          e.preventDefault();
          setCommandPaletteOpen(false);
        }
        return;
      }

      if (isInput || commandPaletteOpen) return;

      if (e.code === "Space") {
        e.preventDefault();
        togglePlayPause();
        return;
      }

      if (e.key === "[") {
        e.preventDefault();
        stepPlaybackFrame(-1);
        return;
      }

      if (e.key === "]") {
        e.preventDefault();
        stepPlaybackFrame(1);
        return;
      }

      const num = parseInt(e.key, 10);
      if (num >= 1 && num <= WORKBENCH_ROUTES.length && !e.altKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setActiveRoute(WORKBENCH_ROUTES[num - 1].id as WorkbenchRouteId);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    commandPaletteOpen,
    setActiveRoute,
    setCommandPaletteOpen,
    stepPlaybackFrame,
    togglePlayPause,
  ]);

  return (
    <div className="w-screen h-screen overflow-hidden flex flex-col bg-[#08090C] text-[#ECEFF4]">
      <TopStatusBar />
      <div className="flex-1 min-h-0 flex overflow-hidden">
        <SidebarNav activeRoute={activeRoute} onSelectRoute={setActiveRoute} />
        <main className="flex-1 min-w-0 min-h-0 overflow-hidden bg-[#08090C] flex flex-col">
          {children}
        </main>
      </div>

      {/* Non-blocking telemetry / UDP command toast stack */}
      {toasts.length > 0 ? (
        <div className="fixed bottom-3 right-3 z-40 flex flex-col gap-1.5 w-[340px] max-w-[90vw] no-print">
          {toasts.map((t) => {
            const borderColor =
              t.level === "nominal"
                ? "border-[#10B981]"
                : t.level === "caution"
                  ? "border-[#D97706]"
                  : t.level === "limit"
                    ? "border-[#DC2626]"
                    : "border-[#C5A059]";
            return (
              <div
                key={t.id}
                className={`bg-[#0F1116] border ${borderColor} rounded-[2px] px-2.5 py-2 flex items-start justify-between gap-2`}
              >
                <div className="min-w-0">
                  <div className="text-[11px] font-semibold text-[#ECEFF4] truncate">
                    {t.title}
                  </div>
                  <div className="text-[10px] font-mono text-[#7E8799] leading-snug mt-0.5">
                    {t.detail}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => dismissToast(t.id)}
                  aria-label="Dismiss notification"
                  className="text-[#7E8799] hover:text-[#ECEFF4] p-0.5 cursor-pointer shrink-0"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            );
          })}
        </div>
      ) : null}

      <CommandPalette />
    </div>
  );
}
