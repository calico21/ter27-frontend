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
    <div className="flex flex-col w-full h-full min-h-0 bg-[#0F1116] overflow-y-auto">
      <div className="panel-header-bar">
        <span className="panel-title-label">Asynchronous CasADi LTS Launcher</span>
        <span className="text-[10px] font-mono text-[#7E8799]">POST /api/simulation/run</span>
      </div>

      <div className="p-2.5 space-y-2.5 text-[11px]">
        <div className="grid grid-cols-2 gap-2 font-mono text-[10px]">
          <label className="space-y-0.5">
            <span className="text-[#7E8799] block">EVENT</span>
            <select
              value={event}
              onChange={(e) => setEvent(e.target.value as SimulationEventName)}
              className="w-full bg-[#08090C] border border-[#222633] text-[#ECEFF4] px-2 py-1 rounded-[2px]"
            >
              <option value="skidpad">skidpad</option>
              <option value="accel">accel (75 m)</option>
              <option value="autocross">autocross</option>
              <option value="endurance">endurance (22 km)</option>
            </select>
          </label>

          <label className="space-y-0.5">
            <span className="text-[#7E8799] block">GRIP PROFILE</span>
            <select
              value={gripProfile}
              onChange={(e) => setGripProfile(e.target.value as GripProfileName)}
              className="w-full bg-[#08090C] border border-[#222633] text-[#ECEFF4] px-2 py-1 rounded-[2px]"
            >
              <option value="FSG_RUBBERED">FSG_RUBBERED (0.57)</option>
              <option value="COLD_TEST_OCT">COLD_TEST_OCT (0.47)</option>
            </select>
          </label>

          <label className="space-y-0.5">
            <span className="text-[#7E8799] block">COMPOUND</span>
            <select
              value={compound}
              onChange={(e) => setCompound(e.target.value as TireCompoundName)}
              className="w-full bg-[#08090C] border border-[#222633] text-[#ECEFF4] px-2 py-1 rounded-[2px]"
            >
              <option value="R25B">Hoosier R25B</option>
              <option value="R20">Hoosier R20</option>
            </select>
          </label>

          <label className="space-y-0.5">
            <span className="text-[#7E8799] block">DRIVER ENVELOPE</span>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as SimulationModeName)}
              className="w-full bg-[#08090C] border border-[#222633] text-[#ECEFF4] px-2 py-1 rounded-[2px]"
            >
              <option value="human_achievable">human_achievable</option>
              <option value="theoretical_optimal">theoretical_optimal</option>
            </select>
          </label>
        </div>

        <div className="flex items-center justify-between gap-2 font-mono text-[10px]">
          <label className="flex items-center gap-1.5 cursor-pointer text-[#ECEFF4]">
            <input
              type="checkbox"
              checked={optimizeSetup}
              onChange={(e) => setOptimizeSetup(e.target.checked)}
              className="accent-[#C5A059]"
            />
            Co-Optimize Trackside Setup (7-DOF)
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer text-[#7E8799]">
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
          className="w-full flex items-center justify-center gap-1.5 py-1.5 bg-[#C5A059] hover:bg-[#D4B06A] text-[#08090C] font-mono text-[11px] font-semibold rounded-[2px] cursor-pointer disabled:opacity-50"
        >
          <Play className="w-3 h-3" />
          {launching ? "Submitting Job..." : "Launch CasADi Optimal Control Job"}
        </button>

        {/* Active Job Progress & Log Tail */}
        {activeJob ? (
          <div className="bg-[#08090C] border border-[#222633] p-2 space-y-1.5 font-mono text-[10px]">
            <div className="flex items-center justify-between">
              <span className="text-[#ECEFF4] font-semibold">{activeJob.job_id}</span>
              <span
                className={
                  activeJob.status === "completed"
                    ? "text-[#10B981]"
                    : activeJob.status === "failed"
                      ? "text-[#DC2626]"
                      : "text-[#C5A059]"
                }
              >
                {activeJob.status.toUpperCase()} ({activeJob.progress_pct}%)
              </span>
            </div>
            <div className="w-full h-1 bg-[#151820]">
              <div
                className="h-full bg-[#C5A059]"
                style={{ width: `${activeJob.progress_pct}%` }}
              />
            </div>
            <div className="max-h-[72px] overflow-y-auto text-[9px] text-[#7E8799] space-y-0.5">
              {activeJob.log_tail.map((line, i) => (
                <div key={i} className="truncate">
                  {line}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {/* Persistent Run History Table */}
        <div className="pt-1 border-t border-[#222633]">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-[#7E8799]">
              Run History ({history.length})
            </span>
            {history.length > 0 ? (
              <button
                type="button"
                onClick={() => {
                  setHistory([]);
                  saveHistory([]);
                }}
                className="text-[9px] font-mono text-[#7E8799] hover:text-[#DC2626] flex items-center gap-0.5 cursor-pointer"
              >
                <Trash2 className="w-2.5 h-2.5" />
                Clear
              </button>
            ) : null}
          </div>

          <div className="max-h-[135px] overflow-y-auto border border-[#222633]">
            <table className="w-full border-collapse font-mono text-[10px]">
              <thead className="bg-[#151820] text-[#7E8799] sticky top-0">
                <tr>
                  <th className="text-left px-1.5 py-1">EVENT</th>
                  <th className="text-left px-1.5 py-1">COMP</th>
                  <th className="text-right px-1.5 py-1">OPT TIME</th>
                  <th className="text-right px-1.5 py-1">STATUS</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#222633]">
                {history.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-2 py-2 text-center text-[#7E8799]">
                      No jobs executed yet.
                    </td>
                  </tr>
                ) : (
                  history.map((job) => {
                    const optT =
                      job.result && typeof job.result.optimal_time_s === "number"
                        ? `${job.result.optimal_time_s.toFixed(3)} s`
                        : "—";
                    return (
                      <tr key={job.job_id} className="hover:bg-[#1B1F2A]">
                        <td className="px-1.5 py-1 text-[#ECEFF4]">{job.event}</td>
                        <td className="px-1.5 py-1 text-[#7E8799]">{job.compound}</td>
                        <td className="px-1.5 py-1 text-right text-[#C5A059]">{optT}</td>
                        <td
                          className={`px-1.5 py-1 text-right ${
                            job.status === "completed" ? "text-[#10B981]" : "text-[#DC2626]"
                          }`}
                        >
                          {job.status.toUpperCase()}
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
