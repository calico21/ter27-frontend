import React, { useEffect, useState } from "react";
import { Play, Trash2 } from "lucide-react";
import type {
  GripProfileName,
  SimulationEventName,
  SimulationJobStatusResponse,
  SimulationModeName,
  TireCompoundName,
} from "../../types";
import { launchSimulationJob, pollSimulationStatus } from "../../services/apiClient";
import { useTelemetryStore } from "../../state/telemetryStore";

const HISTORY_STORAGE_KEY = "ter27_casadi_job_history_v1";

function loadHistory(): SimulationJobStatusResponse[] {
  try {
    const raw = window.localStorage.getItem(HISTORY_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as SimulationJobStatusResponse[]) : [];
  } catch {
    return [];
  }
}

function saveHistory(jobs: SimulationJobStatusResponse[]): void {
  try {
    window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(jobs.slice(0, 20)));
  } catch {
    // Ignore quota errors
  }
}

export function SimulationLauncher() {
  const { forceOfflineMode, pushToast } = useTelemetryStore();

  const [event, setEvent] = useState<SimulationEventName>("skidpad");
  const [gripProfile, setGripProfile] = useState<GripProfileName>("FSG_RUBBERED");
  const [compound, setCompound] = useState<TireCompoundName>("R25B");
  const [mode, setMode] = useState<SimulationModeName>("human_achievable");
  const [optimizeSetup, setOptimizeSetup] = useState<boolean>(true);
  const [dryRun, setDryRun] = useState<boolean>(true);
  const [activeJob, setActiveJob] = useState<SimulationJobStatusResponse | null>(null);
  const [history, setHistory] = useState<SimulationJobStatusResponse[]>(() => loadHistory());
  const [launching, setLaunching] = useState<boolean>(false);

  useEffect(() => {
    if (!activeJob) return;
    if (activeJob.status === "completed" || activeJob.status === "failed") {
      setHistory((prev) => {
        const next = [activeJob, ...prev.filter((j) => j.job_id !== activeJob.job_id)].slice(0, 20);
        saveHistory(next);
        return next;
      });
      return;
    }

    const timer = window.setTimeout(async () => {
      const res = await pollSimulationStatus(activeJob.job_id, activeJob, forceOfflineMode);
      setActiveJob(res.data);
    }, 650);

    return () => window.clearTimeout(timer);
  }, [activeJob, forceOfflineMode]);

  const handleLaunch = async () => {
    setLaunching(true);
    const res = await launchSimulationJob(
      {
        event,
        grip_profile: gripProfile,
        compound,
        mode,
        optimize_setup: optimizeSetup,
        dry_run: dryRun,
        n_intervals: 120,
        max_iter: 300,
      },
      forceOfflineMode
    );
    setLaunching(false);
    setActiveJob(res.data);
    pushToast({
      level: res.live ? "nominal" : "info",
      title: `CasADi LTS Job Queued: ${event.toUpperCase()}`,
      detail: res.live
        ? `Job ${res.data.job_id} dispatched to IPOPT solver.`
        : `Offline cached reference job ${res.data.job_id} running dry-run verification.`,
    });
  };

  return (
    <div className="machined-panel flex flex-col w-full h-full min-h-0 overflow-hidden">
      <div className="panel-header-bar">
        <span className="panel-title-label">CasADi Optimal Control Launcher</span>
        <span className="status-pill status-pill-muted font-mono text-[10px]">
          IPOPT Solver
        </span>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-3.5 space-y-3.5 text-[11.5px]">
        <div className="grid grid-cols-2 gap-2.5">
          <label className="space-y-1">
            <span className="text-[10.5px] font-medium text-[#94A3B8] block">Event</span>
            <select
              value={event}
              onChange={(e) => setEvent(e.target.value as SimulationEventName)}
              className="w-full h-[30px] bg-[#0B0D12] border border-white/[0.08] text-[#F1F5F9] px-2.5 rounded-[5px] text-[11.5px] outline-none focus:border-[#C5A059]/60"
            >
              <option value="skidpad" className="bg-[#11141B]">Skidpad</option>
              <option value="accel" className="bg-[#11141B]">Acceleration (75 m)</option>
              <option value="autocross" className="bg-[#11141B]">Autocross</option>
              <option value="endurance" className="bg-[#11141B]">Endurance (22 km)</option>
            </select>
          </label>

          <label className="space-y-1">
            <span className="text-[10.5px] font-medium text-[#94A3B8] block">Grip Profile</span>
            <select
              value={gripProfile}
              onChange={(e) => setGripProfile(e.target.value as GripProfileName)}
              className="w-full h-[30px] bg-[#0B0D12] border border-white/[0.08] text-[#F1F5F9] px-2.5 rounded-[5px] text-[11.5px] outline-none focus:border-[#C5A059]/60"
            >
              <option value="FSG_RUBBERED" className="bg-[#11141B]">FSG Rubbered (0.57)</option>
              <option value="COLD_TEST_OCT" className="bg-[#11141B]">Cold Oct (0.47)</option>
            </select>
          </label>

          <label className="space-y-1">
            <span className="text-[10.5px] font-medium text-[#94A3B8] block">Tire Compound</span>
            <select
              value={compound}
              onChange={(e) => setCompound(e.target.value as TireCompoundName)}
              className="w-full h-[30px] bg-[#0B0D12] border border-white/[0.08] text-[#F1F5F9] px-2.5 rounded-[5px] text-[11.5px] outline-none focus:border-[#C5A059]/60"
            >
              <option value="R25B" className="bg-[#11141B]">Hoosier R25B</option>
              <option value="R20" className="bg-[#11141B]">Hoosier R20</option>
            </select>
          </label>

          <label className="space-y-1">
            <span className="text-[10.5px] font-medium text-[#94A3B8] block">Driver Envelope</span>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as SimulationModeName)}
              className="w-full h-[30px] bg-[#0B0D12] border border-white/[0.08] text-[#F1F5F9] px-2.5 rounded-[5px] text-[11.5px] outline-none focus:border-[#C5A059]/60"
            >
              <option value="human_achievable" className="bg-[#11141B]">Human Achievable</option>
              <option value="theoretical_optimal" className="bg-[#11141B]">Theoretical Optimal</option>
            </select>
          </label>
        </div>

        <div className="flex items-center justify-between gap-2 text-[11px]">
          <label className="flex items-center gap-2 cursor-pointer text-[#E2E8F0]">
            <input
              type="checkbox"
              checked={optimizeSetup}
              onChange={(e) => setOptimizeSetup(e.target.checked)}
              className="accent-[#C5A059]"
            />
            Co-Optimize Setup (7-DOF)
          </label>
          <label className="flex items-center gap-2 cursor-pointer text-[#94A3B8]">
            <input
              type="checkbox"
              checked={dryRun}
              onChange={(e) => setDryRun(e.target.checked)}
              className="accent-[#C5A059]"
            />
            Dry Run (Cached)
          </label>
        </div>

        <button
          type="button"
          disabled={launching}
          onClick={() => void handleLaunch()}
          className="w-full flex items-center justify-center gap-2 h-[34px] bg-[#C5A059] hover:bg-[#DFBE78] text-[#07080B] text-[11.5px] font-semibold rounded-[5px] cursor-pointer disabled:opacity-50 transition-colors shadow-[0_2px_10px_rgba(197,160,89,0.2)]"
        >
          <Play className="w-3.5 h-3.5 fill-current" />
          {launching ? "Submitting Optimization Job..." : "Run CasADi Optimal Control"}
        </button>

        {/* Active Job Progress & Console Tail */}
        {activeJob ? (
          <div className="machined-well p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-[11px] font-semibold text-[#F1F5F9]">
                {activeJob.job_id}
              </span>
              <span
                className={`status-pill font-mono text-[10px] ${
                  activeJob.status === "completed"
                    ? "status-pill-nominal"
                    : activeJob.status === "failed"
                      ? "status-pill-limit"
                      : "status-pill-gold"
                }`}
              >
                {activeJob.status} · {activeJob.progress_pct}%
              </span>
            </div>
            <div className="w-full h-1.5 rounded-full bg-[#161A23] overflow-hidden">
              <div
                className="h-full rounded-full bg-[#C5A059] transition-all duration-300"
                style={{ width: `${activeJob.progress_pct}%` }}
              />
            </div>
            <div className="max-h-[76px] overflow-y-auto font-mono text-[10px] text-[#94A3B8] space-y-0.5 leading-relaxed">
              {activeJob.log_tail.map((line, i) => (
                <div key={i} className="truncate">
                  {line}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {/* Persistent Run History */}
        <div className="pt-2 border-t border-white/[0.06] space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-[#CBD5E1]">
              Recent Runs ({history.length})
            </span>
            {history.length > 0 ? (
              <button
                type="button"
                onClick={() => {
                  setHistory([]);
                  saveHistory([]);
                }}
                className="text-[10.5px] text-[#94A3B8] hover:text-[#F87171] flex items-center gap-1 cursor-pointer"
              >
                <Trash2 className="w-3 h-3" />
                Clear
              </button>
            ) : null}
          </div>

          <div className="machined-well max-h-[145px] overflow-y-auto">
            <table className="w-full border-collapse text-[11px]">
              <thead className="bg-[#141822] text-[#94A3B8] sticky top-0 border-b border-white/[0.06]">
                <tr>
                  <th className="text-left px-2.5 py-1.5 font-medium">Event</th>
                  <th className="text-left px-2.5 py-1.5 font-medium">Compound</th>
                  <th className="text-right px-2.5 py-1.5 font-medium">Optimal</th>
                  <th className="text-right px-2.5 py-1.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.045]">
                {history.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-3 text-center text-[#64748B]">
                      No optimization jobs executed yet.
                    </td>
                  </tr>
                ) : (
                  history.map((job) => {
                    const optT =
                      job.result && typeof job.result.optimal_time_s === "number"
                        ? `${job.result.optimal_time_s.toFixed(3)} s`
                        : "—";
                    return (
                      <tr key={job.job_id} className="hover:bg-[#1A202C] transition-colors">
                        <td className="px-2.5 py-1.5 text-[#F1F5F9] capitalize">{job.event}</td>
                        <td className="px-2.5 py-1.5 font-mono text-[10.5px] text-[#94A3B8]">
                          {job.compound}
                        </td>
                        <td className="px-2.5 py-1.5 text-right font-mono text-[10.5px] text-[#DFBE78] tabular">
                          {optT}
                        </td>
                        <td className="px-2.5 py-1.5 text-right">
                          <span
                            className={`status-pill text-[9.5px] ${
                              job.status === "completed"
                                ? "status-pill-nominal"
                                : "status-pill-limit"
                            }`}
                          >
                            {job.status}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
