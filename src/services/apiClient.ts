import type {
  ApplySetupRequest,
  ApplySetupResponse,
  CornerHardpoints3D,
  HealthResponse,
  SessionABComparisonResponse,
  SessionsListResponse,
  SetupsMatrixResponse,
  SimulationJobStatusResponse,
  SimulationRunRequest,
  TireEvaluateRequest,
  TireEvaluateResponse,
  VaultCatalogResponse,
  VehicleOverviewResponse,
} from "../types";

import mockDilComparison from "../../mock_data/dil_session_comparison.json";
import mockSetupsMatrix from "../../mock_data/trackside_setups_matrix.json";
import mockVaultCatalog from "../../mock_data/validation_vault_catalog.json";
import { evaluateTireOfflineMF62 } from "./tirePhysics";

const DEFAULT_API_BASE = "http://localhost:8000";
const REQUEST_TIMEOUT_MS = 1500;
const HARDPOINTS_STORAGE_KEY = "ter27_confirmed_hardpoints_v1";

export function getApiBaseUrl(): string {
  const envBase =
    (import.meta as unknown as { env?: Record<string, string | undefined> }).env
      ?.VITE_TER27_API_URL ?? DEFAULT_API_BASE;
  return envBase.replace(/\/$/, "");
}

export interface ApiResult<T> {
  data: T;
  live: boolean;
  latencyMs?: number;
}

export interface ConfirmedHardpointsOverride {
  front_left_hardpoints: CornerHardpoints3D;
  rear_left_hardpoints: CornerHardpoints3D;
  anti_dive_front?: number;
  anti_squat_rear?: number;
  sourceLabel?: string;
}

export function loadSavedConfirmedHardpoints(): ConfirmedHardpointsOverride | null {
  try {
    const raw = window.localStorage.getItem(HARDPOINTS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ConfirmedHardpointsOverride;
    if (parsed?.front_left_hardpoints && parsed?.rear_left_hardpoints) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export function saveConfirmedHardpoints(override: ConfirmedHardpointsOverride | null): void {
  try {
    if (!override) {
      window.localStorage.removeItem(HARDPOINTS_STORAGE_KEY);
    } else {
      window.localStorage.setItem(HARDPOINTS_STORAGE_KEY, JSON.stringify(override));
    }
  } catch {
    // Ignore storage quota issues
  }
}

export function hasNonZeroHardpoints(corner: CornerHardpoints3D | undefined | null): boolean {
  if (!corner) return false;
  const pts = [
    corner.lca_front,
    corner.lca_rear,
    corner.lbj,
    corner.uca_front,
    corner.uca_rear,
    corner.ubj,
  ];
  return pts.some((p) => Array.isArray(p) && p.length === 3 && (p[0] !== 0 || p[1] !== 0 || p[2] !== 0));
}

async function fetchJsonWithFallback<T>(
  path: string,
  fallback: T,
  init?: RequestInit,
  forceOffline = false
): Promise<ApiResult<T>> {
  if (forceOffline) {
    return { data: fallback, live: false };
  }
  const t0 = performance.now();
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${getApiBaseUrl()}${path}`, {
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      ...init,
    });
    window.clearTimeout(timer);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const payload = (await res.json()) as T;
    return { data: payload, live: true, latencyMs: Math.round(performance.now() - t0) };
  } catch {
    window.clearTimeout(timer);
    return { data: fallback, live: false };
  }
}

export function fetchHealth(forceOffline = false): Promise<ApiResult<HealthResponse>> {
  const fallback: HealthResponse = {
    status: "ok",
    version: "1.0.0",
    udp_connected: false,
    telemetry_source: "synthetic_fallback",
    active_ws_clients: 0,
    godot_udp_port: 9876,
    godot_cmd_port: 9877,
    grip_profiles: { COLD_TEST_OCT: 0.47, FSG_RUBBERED: 0.57 },
  };
  return fetchJsonWithFallback<HealthResponse>("/api/health", fallback, undefined, forceOffline);
}

export async function fetchVehicleOverview(
  forceOffline = false
): Promise<ApiResult<VehicleOverviewResponse>> {
  const emptyCorner: CornerHardpoints3D = {
    lca_front: [0, 0, 0],
    lca_rear: [0, 0, 0],
    lbj: [0, 0, 0],
    uca_front: [0, 0, 0],
    uca_rear: [0, 0, 0],
    ubj: [0, 0, 0],
    pushrod_wishbone: [0, 0, 0],
    pushrod_rocker: [0, 0, 0],
    tie_outer: [0, 0, 0],
    tie_inner: [0, 0, 0],
    wheel_center: [0, 0, 0],
    contact_patch: [0, 0, 0],
    damper_chassis: [0, 0, 0],
    damper_rocker: [0, 0, 0],
    rocker_axis_p1: [0, 0, 0],
    rocker_pivot: [0, 0, 0],
    arb_link_rocker: [0, 0, 0],
    arb_arm_tip: [0, 0, 0],
    arb_chassis_piv: [0, 0, 0],
    spring_stiffness_n_m: 35000,
  };

  const fallback: VehicleOverviewResponse = {
    vehicle_id: "ter27_4wd",
    display_name: "TeR27 4WD Formula Student EV",
    drive_type: "4WD",
    params: {
      mass_kg: 263.0,
      sprung_mass_kg: 223.0,
      unsprung_mass_total_kg: 40.0,
      wheelbase_m: 1.54,
      track_front_m: 1.24,
      track_rear_m: 1.22,
      cg_height_m: 0.285,
      front_weight_dist: 0.48,
      ixx_kgm2: 32.0,
      iyy_kgm2: 95.0,
      izz_total_kgm2: 112.0,
      cl_a_m2: 2.35,
      cd_a_m2: 1.05,
      aero_balance_front: 0.45,
      wheel_radius_m: 0.203,
      tire_compound: "R25B",
      p_dc_max_kw: 80.0,
      p_dc_regen_max_kw: 25.0,
      motor_peak_torque_nm: 21.0,
      gear_ratio: 13.5,
      battery_capacity_kwh: 6.8,
      battery_nominal_v: 540.0,
    },
    suspension: {
      use_3d_kinematics: true,
      frame: "ISO_8855",
      spring_stiffness_front_n_m: 35000,
      spring_stiffness_rear_n_m: 48000,
      motion_ratio_front: 0.92,
      motion_ratio_rear: 0.92,
      arb_stiffness_front_nm_rad: 4500,
      arb_stiffness_rear_nm_rad: 5500,
      lltd_elastic_front: 0.4474,
      static_camber_front_deg: -2.0,
      static_camber_rear_deg: -1.5,
      caster_deg: 5.0,
      kpi_deg: 6.5,
      anti_dive_front: 0.569,
      anti_squat_rear: 0.412,
      front_left_hardpoints: emptyCorner,
      rear_left_hardpoints: { ...emptyCorner, spring_stiffness_n_m: 48000 },
    },
    grip_profiles: [
      {
        name: "COLD_TEST_OCT",
        env_mu_scale: 0.47,
        env_aero_cl_scale: 1.0,
        lambda_muy_target: 0.47,
        track_temp_c: 18,
        tire_temp_c: 35,
      },
      {
        name: "FSG_RUBBERED",
        env_mu_scale: 0.57,
        env_aero_cl_scale: 1.0,
        lambda_muy_target: 0.57,
        track_temp_c: 32,
        tire_temp_c: 75,
      },
    ],
    setup_bounds: {
      lltd: [0.35, 0.62],
      camber_f_deg: [-2.5, -0.2],
      camber_r_deg: [-2.2, -0.2],
      toe_f_deg: [-0.5, 0.5],
      toe_r_deg: [0.0, 0.6],
      brake_bias: [0.55, 0.78],
      rake_mm: [-8.0, 8.0],
    },
    validation_status: {
      vault_suites: 10,
      total_figures: 67,
      cold_test_oct_lambda_muy: 0.47,
      fsg_rubbered_lambda_muy: 0.57,
      skidpad_reference_time_s: 4.6072,
      autocross_reference_time_s: 67.1057,
      endurance_22km_time_s: 1358.9964,
      status: "OFFLINE_FALLBACK",
    },
  };

  const result = await fetchJsonWithFallback<VehicleOverviewResponse>(
    "/api/vehicle/overview",
    fallback,
    undefined,
    forceOffline
  );

  // If offline (or backend returns zeroed hardpoints), merge any user-imported confirmed hardpoints
  if (!hasNonZeroHardpoints(result.data.suspension.front_left_hardpoints)) {
    const saved = loadSavedConfirmedHardpoints();
    if (saved) {
      result.data = {
        ...result.data,
        suspension: {
          ...result.data.suspension,
          front_left_hardpoints: saved.front_left_hardpoints,
          rear_left_hardpoints: saved.rear_left_hardpoints,
          anti_dive_front: saved.anti_dive_front ?? result.data.suspension.anti_dive_front,
          anti_squat_rear: saved.anti_squat_rear ?? result.data.suspension.anti_squat_rear,
        },
      };
    }
  }

  return result;
}

export function fetchSessionsList(forceOffline = false): Promise<ApiResult<SessionsListResponse>> {
  const sample = mockDilComparison as unknown as SessionABComparisonResponse;
  const baseSession = sample.session;
  const fallback: SessionsListResponse = {
    sessions: [
      baseSession,
      {
        session_id: "casadi_optimal_skidpad_fsg_rubbered",
        title: "CasADi-IPOPT Optimal Skidpad Reference (FSG_RUBBERED)",
        kind: "casadi_reference",
        track_or_event: "skidpad",
        grip_profile: "FSG_RUBBERED",
        n_samples: baseSession.n_samples,
        duration_s: baseSession.duration_s,
        source_path: "outputs/validation_vault/09_ter27_skidpad_deep_dive/casadi_skidpad_reference.json",
      },
    ],
    total_count: 2,
  };
  return fetchJsonWithFallback<SessionsListResponse>("/api/sessions", fallback, undefined, forceOffline);
}

export function fetchSessionComparison(
  sessionId: string,
  forceOffline = false
): Promise<ApiResult<SessionABComparisonResponse>> {
  const base = mockDilComparison as unknown as SessionABComparisonResponse;
  const fallback: SessionABComparisonResponse =
    sessionId === "casadi_optimal_skidpad_fsg_rubbered"
      ? {
          ...base,
          session: {
            ...base.session,
            session_id: "casadi_optimal_skidpad_fsg_rubbered",
            title: "CasADi-IPOPT Optimal Skidpad Reference (FSG_RUBBERED)",
            kind: "casadi_reference",
          },
          driver_trace: base.casadi_reference_trace,
          casadi_reference_trace: base.driver_trace,
        }
      : base;

  return fetchJsonWithFallback<SessionABComparisonResponse>(
    `/api/sessions/${encodeURIComponent(sessionId)}`,
    fallback,
    undefined,
    forceOffline
  );
}

export function evaluateTireModel(
  req: TireEvaluateRequest,
  forceOffline = false
): Promise<ApiResult<TireEvaluateResponse>> {
  const fallback = evaluateTireOfflineMF62(req);
  return fetchJsonWithFallback<TireEvaluateResponse>(
    "/api/tires/evaluate",
    fallback,
    {
      method: "POST",
      body: JSON.stringify(req),
    },
    forceOffline
  );
}

export function fetchSetupsMatrix(forceOffline = false): Promise<ApiResult<SetupsMatrixResponse>> {
  const fallback = mockSetupsMatrix as unknown as SetupsMatrixResponse;
  return fetchJsonWithFallback<SetupsMatrixResponse>("/api/setups", fallback, undefined, forceOffline);
}

export function applySetupPreset(
  req: ApplySetupRequest,
  forceOffline = false
): Promise<ApiResult<ApplySetupResponse>> {
  const fallback: ApplySetupResponse = {
    acknowledged: true,
    udp_dispatched: false,
    mirena_sim_online: false,
    target_host: "127.0.0.1",
    target_port: 9877,
    command_payload: req as unknown as Record<string, unknown>,
    message:
      "Backend offline (mock mode): setup payload validated and staged locally; start FastAPI on :8000 for live UDP 9877 dispatch.",
  };
  return fetchJsonWithFallback<ApplySetupResponse>(
    "/api/setups/apply",
    fallback,
    {
      method: "POST",
      body: JSON.stringify(req),
    },
    forceOffline
  );
}

export function launchSimulationJob(
  req: SimulationRunRequest,
  forceOffline = false
): Promise<ApiResult<SimulationJobStatusResponse>> {
  const setups = mockSetupsMatrix as unknown as SetupsMatrixResponse;
  const event = req.event ?? "skidpad";
  const matchedGain = setups.optimization_gains.find((g) => g.event === event);
  const nowIso = new Date().toISOString();
  const jobId = `offline-${event}-${Date.now().toString(36)}`;

  const fallback: SimulationJobStatusResponse = {
    job_id: jobId,
    event,
    grip_profile: req.grip_profile ?? "FSG_RUBBERED",
    compound: req.compound ?? "R25B",
    optimize_setup: req.optimize_setup ?? false,
    status: "queued",
    progress_pct: 0,
    created_at_utc: nowIso,
    started_at_utc: null,
    finished_at_utc: null,
    command: [
      "python3",
      "ter27.py",
      "lts",
      "--event",
      event,
      "--grip",
      req.grip_profile ?? "FSG_RUBBERED",
      "--compound",
      req.compound ?? "R25B",
      ...(req.optimize_setup ? ["--optimize-setup"] : []),
      ...(req.dry_run ? ["--dry-run"] : []),
    ],
    result: matchedGain
      ? {
          mode: "offline_cached_reference",
          provenance: "SIMULATED (cached CasADi reference from trackside_setups_matrix.json)",
          base_time_s: matchedGain.base_time_s,
          optimal_time_s: matchedGain.optimal_time_s,
          delta_time_s: matchedGain.delta_time_s,
          delta_pct: matchedGain.delta_pct,
        }
      : { mode: "offline_cached_reference" },
    error: null,
    log_tail: [
      `[${nowIso}] FastAPI offline -> serving cached CasADi validated dry-run envelope for ${event}.`,
      `[IPOPT] Grip=${req.grip_profile ?? "FSG_RUBBERED"} Compound=${req.compound ?? "R25B"} N=${req.n_intervals ?? 120} max_iter=${req.max_iter ?? 300}`,
    ],
  };

  return fetchJsonWithFallback<SimulationJobStatusResponse>(
    "/api/simulation/run",
    fallback,
    {
      method: "POST",
      body: JSON.stringify(req),
    },
    forceOffline
  );
}

export function pollSimulationStatus(
  jobId: string,
  existing?: SimulationJobStatusResponse,
  forceOffline = false
): Promise<ApiResult<SimulationJobStatusResponse>> {
  const nextPct = existing ? Math.min(100, existing.progress_pct + 34) : 100;
  const done = nextPct >= 100;
  const nowIso = new Date().toISOString();

  const fallback: SimulationJobStatusResponse = existing
    ? {
        ...existing,
        status: done ? "completed" : "running",
        progress_pct: nextPct,
        started_at_utc: existing.started_at_utc ?? nowIso,
        finished_at_utc: done ? nowIso : null,
        log_tail: [
          ...existing.log_tail.slice(-6),
          done
            ? `[${nowIso}] Optimal solution retrieved (cached reference). Exit code 0.`
            : `[${nowIso}] Collocation iteration progress ${nextPct}% (offline dry-run)...`,
        ],
      }
    : {
        job_id: jobId,
        event: "skidpad",
        grip_profile: "FSG_RUBBERED",
        compound: "R25B",
        optimize_setup: false,
        status: "completed",
        progress_pct: 100,
        created_at_utc: nowIso,
        started_at_utc: nowIso,
        finished_at_utc: nowIso,
        command: ["offline-dry-run"],
        result: { mode: "offline_cached_reference" },
        error: null,
        log_tail: ["Offline cached simulation completed."],
      };

  return fetchJsonWithFallback<SimulationJobStatusResponse>(
    `/api/simulation/status/${encodeURIComponent(jobId)}`,
    fallback,
    undefined,
    forceOffline
  );
}

export function fetchVaultCatalog(forceOffline = false): Promise<ApiResult<VaultCatalogResponse>> {
  const fallback = mockVaultCatalog as unknown as VaultCatalogResponse;
  return fetchJsonWithFallback<VaultCatalogResponse>("/api/vault/catalog", fallback, undefined, forceOffline);
}

export function getVaultFigureUrl(relPath: string): string {
  return `${getApiBaseUrl()}/outputs/validation_vault/${relPath}`;
}
