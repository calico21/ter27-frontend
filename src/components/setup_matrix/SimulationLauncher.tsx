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
import { InstrumentHeader } from "../shared/PrecisionControl";

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
        const next = [activeJob, ...prev.filter((j) => j.job_id !== activeJob.job_id)].slice(
          0,
          20
        );
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
      <InstrumentHeader
        title="CasADi LTS Launcher"
        right={
          <span className="status-pill status-pill-muted !text-[9.5px] font-mono">IPOPT</span>
        }
      />

      <div className="p-2 space-y-2 border-b border-[#222633] bg-[#0F1116] shrink-0 text-[11px]">
        <div className="grid grid-cols-2 gap-1.5">
          <label className="space-y-0.5">
            <span className="text-[9.5px] font-mono text-[#7E8899] block">Event</span>
            <select
              value={event}
              onChange={(e) => setEvent(e.target.value as SimulationEventName)}
              className="w-full h-[26px] bg-[#08090C] border border-[#222633] text-[#ECEFF4] px-2 rounded-[3px] text-[10.5px] outline-none focus:border-[#C5A059]"
            >
              <option value="skidpad" className="bg-[#0F1116]">Skidpad</option>
              <option value="accel" className="bg-[#0F1116]">Acceleration (75 m)</option>
              <option value="autocross" className="bg-[#0F1116]">Autocross</option>
              <option value="endurance" className="bg-[#0F1116]">Endurance (22 km)</option>
            </select>
          </label>

          <label className="space-y-0.5">
            <span className="text-[9.5px] font-mono text-[#7E8899] block">Grip Surface</span>
            <select
              value={gripProfile}
              onChange={(e) => setGripProfile(e.target.value as GripProfileName)}
              className="w-full h-[26px] bg-[#08090C] border border-[#222633] text-[#ECEFF4] px-2 rounded-[3px] text-[10.5px] outline-none focus:border-[#C5A059]"
            >
              <option value="FSG_RUBBERED" className="bg-[#0F1116]">FSG Rubbered (0.57)</option>
              <option value="COLD_TEST_OCT" className="bg-[#0F1116]">Cold Oct (0.47)</option>
            </select>
          </label>

          <label className="space-y-0.5">
            <span className="text-[9.5px] font-mono text-[#7E8899] block">Compound</span>
            <select
              value={compound}
              onChange={(e) => setCompound(e.target.value as TireCompoundName)}
              className="w-full h-[26px] bg-[#08090C] border border-[#222633] text-[#ECEFF4] px-2 rounded-[3px] text-[10.5px] outline-none focus:border-[#C5A059]"
            >
              <option value="R25B" className="bg-[#0F1116]">Hoosier R25B</option>
              <option value="R20" className="bg-[#0F1116]">Hoosier R20</option>
            </select>
          </label>

          <label className="space-y-0.5">
            <span className="text-[9.5px] font-mono text-[#7E8899] block">Driver Envelope</span>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as SimulationModeName)}
              className="w-full h-[26px] bg-[#08090C] border border-[#222633] text-[#ECEFF4] px-2 rounded-[3px] text-[10.5px] outline-none focus:border-[#C5A059]"
            >
              <option value="human_achievable" className="bg-[#0F1116]">Human Achievable</option>
              <option value="theoretical_optimal" className="bg-[#0F1116]">Theoretical Opt.</option>
            </select>
          </label>
        </div>

        <div className="flex items-center justify-between gap-2 text-[10.5px]">
          <label className="flex items-center gap-1.5 cursor-pointer text-[#CBD5E1]">
            <input
              type="checkbox"
              checked={optimizeSetup}
              onChange={(e) => setOptimizeSetup(e.target.checked)}
              className="accent-[#C5A059]"
            />
            Co-Opt Setup (7-DOF)
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer text-[#94A3B8]">
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
          className="w-full flex items-center justify-center gap-1.5 h-[28px] bg-[#C5A059] hover:bg-[#DFBE78] text-[#07080B] text-[11px] font-semibold rounded-[3px] cursor-pointer disabled:opacity-50 transition-colors"
        >
          <Play className="w-3 h-3 fill-current" />
          {launching ? "Submitting Job..." : "Run CasADi Optimal Control"}
        </button>

        {activeJob ? (
          <div className="rounded-[3px] bg-[#08090C] border border-[#222633] p-2 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-[10px] font-semibold text-[#ECEFF4] truncate">
                {activeJob.job_id}
              </span>
              <span
                className={`status-pill font-mono !text-[9px] ${
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
            <div className="w-full h-1 rounded-[1px] bg-[#151820] overflow-hidden">
              <div
                className="h-full bg-[#C5A059] transition-all duration-300"
                style={{ width: `${activeJob.progress_pct}%` }}
              />
            </div>
            <div className="max-h-[60px] overflow-y-auto font-mono text-[9.5px] text-[#7E8899] space-y-0.5 leading-tight">
              {activeJob.log_tail.map((line, i) => (
                <div key={i} className="truncate">
                  {line}
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      {/* Persistent Run History */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <div className="h-[24px] px-2.5 flex items-center justify-between bg-[#12151D] border-b border-[#222633] shrink-0">
          <span className="text-[10px] font-medium text-[#94A3B8]">
            Solver Run History ({history.length})
          </span>
          {history.length > 0 ? (
            <button
              type="button"
              onClick={() => {
                setHistory([]);
                saveHistory([]);
              }}
              className="text-[9.5px] text-[#7E8899] hover:text-[#F87171] flex items-center gap-1 cursor-pointer"
            >
              <Trash2 className="w-2.5 h-2.5" />
              Clear
            </button>
          ) : null}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto bg-[#08090C]">
          <table className="w-full border-collapse text-[10.5px]">
            <thead className="bg-[#0F1116] text-[#7E8899] sticky top-0 border-b border-[#222633]">
              <tr>
                <th className="text-left px-2.5 py-1 font-medium">Event</th>
                <th className="text-left px-2 py-1 font-medium">Tire</th>
                <th className="text-right px-2 py-1 font-medium">Optimal</th>
                <th className="text-right px-2.5 py-1 font-medium">State</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#181C26]">
              {history.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-3 py-4 text-center text-[#64748B] font-mono text-[10px]">
                    No CasADi optimization runs queued yet.
                  </td>
                </tr>
              ) : (
                history.map((job) => {
                  const optT =
                    job.result && typeof job.result.optimal_time_s === "number"
                      ? `${job.result.optimal_time_s.toFixed(3)} s`
                      : "—";
                  return (
                    <tr key={job.job_id} className="hover:bg-[#141822] transition-colors">
                      <td className="px-2.5 py-1.5 text-[#ECEFF4] capitalize">{job.event}</td>
                      <td className="px-2 py-1.5 font-mono text-[10px] text-[#94A3B8]">
                        {job.compound}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono text-[10px] text-[#DFBE78] tabular">
                        {optT}
                      </td>
                      <td className="px-2.5 py-1.5 text-right">
                        <span
                          className={`status-pill !text-[9px] !px-1.5 !py-0 ${
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
  );
}
