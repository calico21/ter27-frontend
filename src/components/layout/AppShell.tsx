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
    <div className="w-screen h-screen overflow-hidden flex flex-col bg-[#07080B] text-[#F1F5F9]">
      <TopStatusBar />
      <div className="flex-1 min-h-0 flex overflow-hidden">
        <SidebarNav activeRoute={activeRoute} onSelectRoute={setActiveRoute} />
        <main className="flex-1 min-w-0 min-h-0 overflow-hidden bg-[#07080B] p-2 flex flex-col">
          {children}
        </main>
      </div>

      {/* Elevated non-blocking toast notifications */}
      {toasts.length > 0 ? (
        <div className="fixed bottom-4 right-4 z-40 flex flex-col gap-2 w-[360px] max-w-[90vw] no-print">
          {toasts.map((t) => {
            const accent =
              t.level === "nominal"
                ? "bg-[#10B981]"
                : t.level === "caution"
                  ? "bg-[#D97706]"
                  : t.level === "limit"
                    ? "bg-[#EF4444]"
                    : "bg-[#C5A059]";
            return (
              <div
                key={t.id}
                className="relative overflow-hidden bg-[#161A23] border border-white/[0.09] rounded-[6px] pl-3.5 pr-2.5 py-2.5 flex items-start justify-between gap-2.5 shadow-[0_12px_32px_rgba(0,0,0,0.55)]"
              >
                <span className={`absolute left-0 top-0 bottom-0 w-[3px] ${accent}`} />
                <div className="min-w-0">
                  <div className="text-[12px] font-semibold text-[#F1F5F9] truncate">{t.title}</div>
                  <div className="text-[11px] text-[#94A3B8] leading-snug mt-0.5">{t.detail}</div>
                </div>
                <button
                  type="button"
                  onClick={() => dismissToast(t.id)}
                  aria-label="Dismiss notification"
                  className="text-[#64748B] hover:text-[#F1F5F9] p-0.5 rounded-[4px] hover:bg-white/[0.06] cursor-pointer shrink-0"
                >
                  <X className="w-3.5 h-3.5" />
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
