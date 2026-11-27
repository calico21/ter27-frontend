import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Download,
  MessageSquarePlus,
  RotateCcw,
  Sliders,
  Trash2,
} from "lucide-react";
import type {
  SessionABComparisonResponse,
  SessionSummary,
  TrajectorySample,
} from "../../types";
import { fetchSessionComparison, fetchSessionsList } from "../../services/apiClient";
import { useTelemetryStore } from "../../state/telemetryStore";
import { SplitPane } from "../layout/SplitPane";
import { SectorDeltaBreakdown } from "./SectorDeltaBreakdown";

type AxisMode = "s_m" | "t_s";
type MapColorMode = "speed" | "delta_t" | "ay_g" | "ax_g" | "util";
type TraceChannelKey =
  | "vx_mps"
  | "ay_g"
  | "ax_g"
  | "beta_deg"
  | "steer_deg"
  | "mz_tv_nm"
  | "delta_t_s";

interface ChannelSpec {
  key: TraceChannelKey;
  label: string;
  unit: string;
  scale?: number;
}

const ALL_CHANNELS: ChannelSpec[] = [
  { key: "vx_mps", label: "Velocity vx", unit: "km/h", scale: 3.6 },
  { key: "delta_t_s", label: "Delta Time", unit: "s", scale: 1 },
  { key: "ay_g", label: "Lateral Accel ay", unit: "g", scale: 1 },
  { key: "ax_g", label: "Longitudinal Accel ax", unit: "g", scale: 1 },
  { key: "beta_deg", label: "Sideslip β", unit: "deg", scale: 1 },
  { key: "steer_deg", label: "Steer Angle", unit: "deg", scale: 1 },
  { key: "mz_tv_nm", label: "TV Yaw Moment Mz", unit: "Nm", scale: 1 },
];

interface EngineeringNote {
  id: string;
  sessionId: string;
  distanceM: number;
  text: string;
  createdAt: string;
}

const NOTES_STORAGE_KEY = "ter27_forensics_notes_v1";

function loadNotes(): EngineeringNote[] {
  try {
    const raw = window.localStorage.getItem(NOTES_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as EngineeringNote[]) : [];
  } catch {
    return [];
  }
}

function saveNotes(notes: EngineeringNote[]): void {
  try {
    window.localStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify(notes));
  } catch {
    // Ignore storage quota errors
  }
}

function sampleValue(sample: TrajectorySample, ch: ChannelSpec): number {
  return sample[ch.key] * (ch.scale ?? 1);
}

function findNearestByX(
  trace: TrajectorySample[],
  axis: AxisMode,
  xVal: number
): TrajectorySample | null {
  if (trace.length === 0) return null;
  let lo = 0;
  let hi = trace.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (trace[mid][axis] <= xVal) lo = mid;
    else hi = mid;
  }
  return Math.abs(trace[lo][axis] - xVal) <= Math.abs(trace[hi][axis] - xVal)
    ? trace[lo]
    : trace[hi];
}

function colorRamp(norm: number, mode: MapColorMode): string {
  const t = Math.max(0, Math.min(1, norm));
  if (mode === "delta_t") {
    return t < 0.45 ? "#34D399" : t > 0.55 ? "#EF4444" : "#C5A059";
  }
  if (mode === "ax_g") {
    return t < 0.42 ? "#EF4444" : t > 0.56 ? "#34D399" : "#C5A059";
  }
  if (mode === "util") {
    return t > 0.9 ? "#EF4444" : t > 0.75 ? "#F59E0B" : "#34D399";
  }
  if (t < 0.33) return "#38BDF8";
  if (t < 0.68) return "#34D399";
  if (t < 0.88) return "#DFBE78";
  return "#EF4444";
}

export function SessionABComparator() {
  const { forceOfflineMode, cursor, setCursor, seekPlayback, pushToast } = useTelemetryStore();

  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string>("");
  const [comparison, setComparison] = useState<SessionABComparisonResponse | null>(null);
  const [axisMode, setAxisMode] = useState<AxisMode>("s_m");
  const [mapColorMode, setMapColorMode] = useState<MapColorMode>("speed");
  const [activeChannels, setActiveChannels] = useState<TraceChannelKey[]>([
    "vx_mps",
    "delta_t_s",
    "ay_g",
    "beta_deg",
    "mz_tv_nm",
  ]);
  const [drawerOpen, setDrawerOpen] = useState<boolean>(false);

  const [zoomRange, setZoomRange] = useState<[number, number] | null>(null);
  const [markerMode, setMarkerMode] = useState<"zoom" | "markerA" | "markerB">("zoom");
  const [hoverX, setHoverX] = useState<number | null>(null);
  const [hoverPx, setHoverPx] = useState<{ x: number; width: number } | null>(null);
  const [dragStartPx, setDragStartPx] = useState<number | null>(null);
  const [dragCurrPx, setDragCurrPx] = useState<number | null>(null);

  const [notes, setNotes] = useState<EngineeringNote[]>(() => loadNotes());
  const [noteInput, setNoteInput] = useState<string>("");
  const [showNoteForm, setShowNoteForm] = useState<boolean>(false);

  const traceCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const traceContainerRef = useRef<HTMLDivElement | null>(null);
  const mapCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const ggCanvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let active = true;
    fetchSessionsList(forceOfflineMode).then((res) => {
      if (!active) return;
      setSessions(res.data.sessions);
      if (res.data.sessions.length > 0 && !selectedSessionId) {
        setSelectedSessionId(res.data.sessions[0].session_id);
      }
    });
    return () => {
      active = false;
    };
  }, [forceOfflineMode, selectedSessionId]);

  useEffect(() => {
    if (!selectedSessionId) return;
    let active = true;
    fetchSessionComparison(selectedSessionId, forceOfflineMode).then((res) => {
      if (!active) return;
      setComparison(res.data);
      setZoomRange(null);
      setCursor((c) => ({ ...c, markerA: null, markerB: null }));
    });
    return () => {
      active = false;
    };
  }, [forceOfflineMode, selectedSessionId, setCursor]);

  const driverTrace = comparison?.driver_trace ?? [];
  const refTrace = comparison?.casadi_reference_trace ?? [];

  const fullDomain = useMemo<[number, number]>(() => {
    if (driverTrace.length < 2) return [0, 100];
    return [driverTrace[0][axisMode], driverTrace[driverTrace.length - 1][axisMode]];
  }, [axisMode, driverTrace]);

  const viewDomain = zoomRange ?? fullDomain;

  const activeChannelSpecs = useMemo(
    () =>
      activeChannels
        .map((k) => ALL_CHANNELS.find((c) => c.key === k))
        .filter((c): c is ChannelSpec => Boolean(c)),
    [activeChannels]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && zoomRange) {
        setZoomRange(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoomRange]);

  const markerStats = useMemo(() => {
    if (cursor.markerA === null || cursor.markerB === null || driverTrace.length < 2) return null;
    const xLo = Math.min(cursor.markerA, cursor.markerB);
    const xHi = Math.max(cursor.markerA, cursor.markerB);
    const segA = driverTrace.filter((p) => p[axisMode] >= xLo && p[axisMode] <= xHi);
    const segB = refTrace.filter((p) => p[axisMode] >= xLo && p[axisMode] <= xHi);
    if (segA.length === 0) return null;

    const deltaS = segA[segA.length - 1].s_m - segA[0].s_m;
    const deltaT = segA[segA.length - 1].t_s - segA[0].t_s;
    const ch = activeChannelSpecs[0] ?? ALL_CHANNELS[0];
    const valsA = segA.map((p) => sampleValue(p, ch));
    const valsB = segB.length > 0 ? segB.map((p) => sampleValue(p, ch)) : valsA;

    const mean = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / Math.max(1, arr.length);
    const meanA = mean(valsA);
    const meanB = mean(valsB);

    return {
      channelLabel: `${ch.label} (${ch.unit})`,
      deltaS,
      deltaT,
      minA: Math.min(...valsA),
      maxA: Math.max(...valsA),
      meanA,
      meanB,
      diffMean: meanA - meanB,
    };
  }, [activeChannelSpecs, axisMode, cursor.markerA, cursor.markerB, driverTrace, refTrace]);

  const sessionNotes = useMemo(
    () => notes.filter((n) => !selectedSessionId || n.sessionId === selectedSessionId),
    [notes, selectedSessionId]
  );

  // Floating hover inspector data
  const hoverSnapshot = useMemo(() => {
    if (hoverX === null || !hoverPx || driverTrace.length < 2) return null;
    const sA = findNearestByX(driverTrace, axisMode, hoverX);
    const sB = findNearestByX(refTrace, axisMode, hoverX);
    if (!sA || !sB) return null;
    return { sA, sB, pxX: hoverPx.x, width: hoverPx.width };
  }, [axisMode, driverTrace, hoverPx, hoverX, refTrace]);

  // Draw Stacked A/B HTML5 Canvas Traces
  useEffect(() => {
    const canvas = traceCanvasRef.current;
    const container = traceContainerRef.current;
    if (!canvas || !container || driverTrace.length < 2) return;

    const render = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = container.clientWidth;
      const height = container.clientHeight;
      if (width < 40 || height < 40) return;

      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);

      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.save();
      ctx.scale(dpr, dpr);

      ctx.fillStyle = "#0B0D12";
      ctx.fillRect(0, 0, width, height);

      const padLeft = 54;
      const padRight = 14;
      const axisFootH = 24;
      const plotW = Math.max(40, width - padLeft - padRight);
      const nLanes = Math.max(1, activeChannelSpecs.length);
      const laneH = (height - axisFootH) / nLanes;
      const [xMin, xMax] = viewDomain;
      const xSpan = Math.max(1e-4, xMax - xMin);

      const xToPx = (xv: number) => padLeft + ((xv - xMin) / xSpan) * plotW;

      // Shaded marker range [markerA, markerB]
      if (cursor.markerA !== null && cursor.markerB !== null) {
        const pxA = xToPx(Math.min(cursor.markerA, cursor.markerB));
        const pxB = xToPx(Math.max(cursor.markerA, cursor.markerB));
        ctx.fillStyle = "rgba(197, 160, 89, 0.08)";
        ctx.fillRect(
          Math.max(padLeft, pxA),
          0,
          Math.max(0, pxB - Math.max(padLeft, pxA)),
          height - axisFootH
        );
      }

      activeChannelSpecs.forEach((ch, idx) => {
        const y0 = idx * laneH;
        const headH = 22;
        const innerTop = y0 + headH + 4;
        const innerBot = y0 + laneH - 7;
        const innerH = Math.max(18, innerBot - innerTop);

        let minV = Infinity;
        let maxV = -Infinity;
        for (const p of driverTrace) {
          if (p[axisMode] < xMin || p[axisMode] > xMax) continue;
          const v = sampleValue(p, ch);
          if (v < minV) minV = v;
          if (v > maxV) maxV = v;
        }
        for (const p of refTrace) {
          if (p[axisMode] < xMin || p[axisMode] > xMax) continue;
          const v = sampleValue(p, ch);
          if (v < minV) minV = v;
          if (v > maxV) maxV = v;
        }
        if (!Number.isFinite(minV) || !Number.isFinite(maxV) || Math.abs(maxV - minV) < 1e-4) {
          minV = -1;
          maxV = 1;
        }
        const padV = (maxV - minV) * 0.14;
        minV -= padV;
        maxV += padV;

        // Subtle lane header tint & divider
        ctx.fillStyle = "rgba(255, 255, 255, 0.018)";
        ctx.fillRect(0, y0, width, headH);
        if (idx > 0) {
          ctx.strokeStyle = "rgba(255, 255, 255, 0.06)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(0, Math.round(y0) + 0.5);
          ctx.lineTo(width, Math.round(y0) + 0.5);
          ctx.stroke();
        }

        ctx.fillStyle = "#94A3B8";
        ctx.font = '600 10.5px "Plus Jakarta Sans", sans-serif';
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(`${ch.label} (${ch.unit})`, 12, y0 + headH / 2);

        // Subtle dashed Y gridlines
        ctx.font = '9.5px "JetBrains Mono", monospace';
        ctx.textAlign = "right";
        const ticks = minV < 0 && maxV > 0 ? [minV, 0, maxV] : [minV, (minV + maxV) / 2, maxV];
        for (const tk of ticks) {
          const py = innerBot - ((tk - minV) / (maxV - minV)) * innerH;
          const isZero = Math.abs(tk) < 1e-4;
          ctx.save();
          ctx.strokeStyle = isZero
            ? "rgba(255, 255, 255, 0.11)"
            : "rgba(255, 255, 255, 0.045)";
          if (!isZero) ctx.setLineDash([3, 4]);
          ctx.beginPath();
          ctx.moveTo(padLeft, Math.round(py) + 0.5);
          ctx.lineTo(padLeft + plotW, Math.round(py) + 0.5);
          ctx.stroke();
          ctx.restore();

          ctx.fillStyle = isZero ? "#94A3B8" : "#64748B";
          ctx.fillText(tk.toFixed(1), padLeft - 7, py);
        }

        const buildPoints = (trace: TrajectorySample[]) => {
          const pts: Array<[number, number]> = [];
          for (let i = 0; i < trace.length; i++) {
            const p = trace[i];
            const xv = p[axisMode];
            if (xv < xMin || xv > xMax) continue;
            const px = xToPx(xv);
            const py = innerBot - ((sampleValue(p, ch) - minV) / (maxV - minV)) * innerH;
            pts.push([px, py]);
          }
          return pts;
        };

        const ptsA = buildPoints(driverTrace);
        const ptsB = buildPoints(refTrace);

        // Soft vertical gradient fill under Driver Trace A
        if (ptsA.length > 1) {
          ctx.save();
          const grad = ctx.createLinearGradient(0, innerTop, 0, innerBot);
          grad.addColorStop(0, "rgba(197, 160, 89, 0.16)");
          grad.addColorStop(1, "rgba(197, 160, 89, 0.0)");
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.moveTo(ptsA[0][0], innerBot);
          for (const [px, py] of ptsA) ctx.lineTo(px, py);
          ctx.lineTo(ptsA[ptsA.length - 1][0], innerBot);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }

        const strokePoints = (pts: Array<[number, number]>, color: string, lw: number) => {
          if (pts.length < 2) return;
          ctx.save();
          ctx.strokeStyle = color;
          ctx.lineWidth = lw;
          ctx.lineJoin = "round";
          ctx.lineCap = "round";
          ctx.beginPath();
          ctx.moveTo(pts[0][0], pts[0][1]);
          for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
          ctx.stroke();
          ctx.restore();
        };

        strokePoints(ptsB, "#38BDF8", 1.55);
        strokePoints(ptsA, "#DFBE78", 1.9);

        // Right-aligned live A/B numeric readout on lane header
        const activeX = hoverX ?? (axisMode === "s_m" ? cursor.cursorDistanceM : cursor.cursorTimeS);
        const sA = findNearestByX(driverTrace, axisMode, activeX);
        const sB = findNearestByX(refTrace, axisMode, activeX);
        if (sA && sB) {
          const vA = sampleValue(sA, ch);
          const vB = sampleValue(sB, ch);
          const diff = vA - vB;
          ctx.font = '500 10px "JetBrains Mono", monospace';
          ctx.textAlign = "right";
          ctx.fillStyle = "#CBD5E1";
          ctx.fillText(
            `A ${vA.toFixed(2)}   B ${vB.toFixed(2)}   Δ ${diff >= 0 ? "+" : ""}${diff.toFixed(2)} ${ch.unit}`,
            width - 12,
            y0 + headH / 2
          );
        }
      });

      // Bottom X axis ruler
      const axisY = height - axisFootH;
      ctx.fillStyle = "#11141B";
      ctx.fillRect(0, axisY, width, axisFootH);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.06)";
      ctx.beginPath();
      ctx.moveTo(0, axisY + 0.5);
      ctx.lineTo(width, axisY + 0.5);
      ctx.stroke();

      ctx.font = '10px "JetBrains Mono", monospace';
      ctx.fillStyle = "#64748B";
      ctx.textBaseline = "middle";
      for (let g = 0; g <= 6; g++) {
        const xv = xMin + (xSpan * g) / 6;
        const px = xToPx(xv);
        ctx.textAlign = g === 6 ? "right" : g === 0 ? "left" : "center";
        ctx.fillText(`${xv.toFixed(1)} ${axisMode === "s_m" ? "m" : "s"}`, px, axisY + axisFootH / 2);
      }

      // Engineering annotations markers
      if (axisMode === "s_m") {
        for (const note of sessionNotes) {
          if (note.distanceM < xMin || note.distanceM > xMax) continue;
          const nx = xToPx(note.distanceM);
          ctx.save();
          ctx.strokeStyle = "#F59E0B";
          ctx.setLineDash([2, 3]);
          ctx.beginPath();
          ctx.moveTo(Math.round(nx) + 0.5, 0);
          ctx.lineTo(Math.round(nx) + 0.5, axisY);
          ctx.stroke();
          ctx.restore();
        }
      }

      // Markers A and B vertical lines
      if (cursor.markerA !== null && cursor.markerA >= xMin && cursor.markerA <= xMax) {
        const px = xToPx(cursor.markerA);
        ctx.strokeStyle = "#DFBE78";
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(Math.round(px) + 0.5, 0);
        ctx.lineTo(Math.round(px) + 0.5, axisY);
        ctx.stroke();
      }
      if (cursor.markerB !== null && cursor.markerB >= xMin && cursor.markerB <= xMax) {
        const px = xToPx(cursor.markerB);
        ctx.strokeStyle = "#38BDF8";
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(Math.round(px) + 0.5, 0);
        ctx.lineTo(Math.round(px) + 0.5, axisY);
        ctx.stroke();
      }

      // Global synchronized cursor crosshair
      const currX = hoverX ?? (axisMode === "s_m" ? cursor.cursorDistanceM : cursor.cursorTimeS);
      if (currX >= xMin && currX <= xMax) {
        const cx = xToPx(currX);
        ctx.save();
        ctx.strokeStyle = "rgba(241, 245, 249, 0.72)";
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(Math.round(cx) + 0.5, 0);
        ctx.lineTo(Math.round(cx) + 0.5, axisY);
        ctx.stroke();
        ctx.restore();
      }

      // Drag-zoom selection band
      if (dragStartPx !== null && dragCurrPx !== null) {
        const left = Math.min(dragStartPx, dragCurrPx);
        const wSel = Math.abs(dragCurrPx - dragStartPx);
        ctx.fillStyle = "rgba(197, 160, 89, 0.16)";
        ctx.fillRect(left, 0, wSel, axisY);
        ctx.strokeStyle = "#DFBE78";
        ctx.lineWidth = 1;
        ctx.strokeRect(left, 0, wSel, axisY);
      }

      ctx.restore();
    };

    render();
    const ro = new ResizeObserver(render);
    ro.observe(container);
    return () => ro.disconnect();
  }, [
    activeChannelSpecs,
    axisMode,
    cursor.cursorDistanceM,
    cursor.cursorTimeS,
    cursor.markerA,
    cursor.markerB,
    dragCurrPx,
    dragStartPx,
    driverTrace,
    hoverX,
    refTrace,
    sessionNotes,
    viewDomain,
  ]);

  // Draw Synchronized 2D Track Map
  useEffect(() => {
    const canvas = mapCanvasRef.current;
    if (!canvas || driverTrace.length < 2) return;

    const render = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = canvas.clientWidth || 260;
      const h = canvas.clientHeight || 200;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.fillStyle = "#0B0D12";
      ctx.fillRect(0, 0, w, h);

      let minX = Infinity,
        maxX = -Infinity,
        minY = Infinity,
        maxY = -Infinity;
      let minSpd = Infinity,
        maxSpd = -Infinity;
      for (const p of driverTrace) {
        if (p.x_m < minX) minX = p.x_m;
        if (p.x_m > maxX) maxX = p.x_m;
        if (p.y_m < minY) minY = p.y_m;
        if (p.y_m > maxY) maxY = p.y_m;
        if (p.vx_mps < minSpd) minSpd = p.vx_mps;
        if (p.vx_mps > maxSpd) maxSpd = p.vx_mps;
      }

      const pad = 22;
      const spanX = Math.max(1, maxX - minX);
      const spanY = Math.max(1, maxY - minY);
      const scale = Math.min((w - pad * 2) / spanX, (h - pad * 2) / spanY);
      const offX = (w - spanX * scale) / 2;
      const offY = (h - spanY * scale) / 2;

      const toScreen = (x: number, y: number) => ({
        sx: offX + (x - minX) * scale,
        sy: h - (offY + (y - minY) * scale),
      });

      const [vMin, vMax] = viewDomain;

      // Subtle asphalt ribbon underpath
      ctx.strokeStyle = "rgba(255, 255, 255, 0.06)";
      ctx.lineWidth = 6;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      driverTrace.forEach((p, i) => {
        const { sx, sy } = toScreen(p.x_m, p.y_m);
        if (i === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      });
      ctx.stroke();

      // Colored velocity / delta track segments
      for (let i = 1; i < driverTrace.length; i++) {
        const p0 = driverTrace[i - 1];
        const p1 = driverTrace[i];
        const inZoom = p1[axisMode] >= vMin && p1[axisMode] <= vMax;
        const a = toScreen(p0.x_m, p0.y_m);
        const b = toScreen(p1.x_m, p1.y_m);

        let norm = 0.5;
        if (mapColorMode === "speed") {
          norm = (p1.vx_mps - minSpd) / Math.max(0.1, maxSpd - minSpd);
        } else if (mapColorMode === "delta_t") {
          norm = 0.5 + p1.delta_t_s * 2.5;
        } else if (mapColorMode === "ay_g") {
          norm = Math.abs(p1.ay_g) / 1.8;
        } else if (mapColorMode === "ax_g") {
          norm = (p1.ax_g + 1.2) / 2.4;
        } else {
          norm = Math.hypot(p1.ax_g, p1.ay_g) / 1.8;
        }

        ctx.strokeStyle = inZoom ? colorRamp(norm, mapColorMode) : "rgba(148,163,184,0.14)";
        ctx.lineWidth = inZoom ? 2.8 : 1.4;
        ctx.beginPath();
        ctx.moveTo(a.sx, a.sy);
        ctx.lineTo(b.sx, b.sy);
        ctx.stroke();
      }

      // Active synchronized position marker with subtle gold ring
      const currSample = findNearestByX(
        driverTrace,
        axisMode,
        hoverX ?? (axisMode === "s_m" ? cursor.cursorDistanceM : cursor.cursorTimeS)
      );
      if (currSample) {
        const pt = toScreen(currSample.x_m, currSample.y_m);
        ctx.fillStyle = "rgba(223, 190, 120, 0.22)";
        ctx.beginPath();
        ctx.arc(pt.sx, pt.sy, 10, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = "#DFBE78";
        ctx.lineWidth = 1.75;
        ctx.beginPath();
        ctx.arc(pt.sx, pt.sy, 7, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = "#F1F5F9";
        ctx.beginPath();
        ctx.arc(pt.sx, pt.sy, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    };

    render();
    const ro = new ResizeObserver(render);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [
    axisMode,
    cursor.cursorDistanceM,
    cursor.cursorTimeS,
    driverTrace,
    hoverX,
    mapColorMode,
    viewDomain,
  ]);

  // Draw Interactive g-g Traction Diagram
  useEffect(() => {
    const canvas = ggCanvasRef.current;
    if (!canvas || driverTrace.length < 2) return;

    const render = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = canvas.clientWidth || 220;
      const h = canvas.clientHeight || 200;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.fillStyle = "#0B0D12";
      ctx.fillRect(0, 0, w, h);

      const cx = w / 2;
      const cy = h / 2;
      const maxR = Math.max(30, Math.min(w, h) * 0.42);
      const maxG = 2.0;

      // Concentric g rings
      ctx.font = '9px "JetBrains Mono", monospace';
      for (const gRing of [0.5, 1.0, 1.5, 2.0]) {
        const r = (gRing / maxG) * maxR;
        ctx.save();
        ctx.strokeStyle =
          gRing === 1.5 ? "rgba(197, 160, 89, 0.25)" : "rgba(255, 255, 255, 0.06)";
        if (gRing !== 2.0) ctx.setLineDash([2, 4]);
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();

        ctx.fillStyle = "#64748B";
        ctx.fillText(`${gRing.toFixed(1)}g`, cx + 4, cy - r + 9);
      }

      // Crosshairs
      ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
      ctx.beginPath();
      ctx.moveTo(cx - maxR, cy);
      ctx.lineTo(cx + maxR, cy);
      ctx.moveTo(cx, cy - maxR);
      ctx.lineTo(cx, cy + maxR);
      ctx.stroke();

      const [vMin, vMax] = viewDomain;
      const isZoomed = zoomRange !== null;

      // Background points
      for (let i = 0; i < driverTrace.length; i += 2) {
        const p = driverTrace[i];
        const inSeg = p[axisMode] >= vMin && p[axisMode] <= vMax;
        if (inSeg && isZoomed) continue;
        const px = cx + (p.ay_g / maxG) * maxR;
        const py = cy - (p.ax_g / maxG) * maxR;
        ctx.fillStyle = isZoomed ? "rgba(148, 163, 184, 0.16)" : "rgba(56, 189, 248, 0.38)";
        ctx.beginPath();
        ctx.arc(px, py, 1.4, 0, Math.PI * 2);
        ctx.fill();
      }

      // Active segment points in warm gold
      for (let i = 0; i < driverTrace.length; i++) {
        const p = driverTrace[i];
        if (p[axisMode] < vMin || p[axisMode] > vMax) continue;
        const px = cx + (p.ay_g / maxG) * maxR;
        const py = cy - (p.ax_g / maxG) * maxR;
        ctx.fillStyle = "rgba(223, 190, 120, 0.85)";
        ctx.beginPath();
        ctx.arc(px, py, 1.7, 0, Math.PI * 2);
        ctx.fill();
      }

      // Current cursor point
      const curr = findNearestByX(
        driverTrace,
        axisMode,
        hoverX ?? (axisMode === "s_m" ? cursor.cursorDistanceM : cursor.cursorTimeS)
      );
      if (curr) {
        const px = cx + (curr.ay_g / maxG) * maxR;
        const py = cy - (curr.ax_g / maxG) * maxR;
        ctx.strokeStyle = "#DFBE78";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(px, py, 6, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = "#F1F5F9";
        ctx.beginPath();
        ctx.arc(px, py, 3, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    };

    render();
    const ro = new ResizeObserver(render);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [axisMode, cursor.cursorDistanceM, cursor.cursorTimeS, driverTrace, hoverX, viewDomain, zoomRange]);

  const pxToXVal = useCallback(
    (clientX: number, rect: DOMRect) => {
      const padLeft = 54;
      const padRight = 14;
      const plotW = Math.max(1, rect.width - padLeft - padRight);
      const norm = Math.max(0, Math.min(1, (clientX - rect.left - padLeft) / plotW));
      return viewDomain[0] + norm * (viewDomain[1] - viewDomain[0]);
    },
    [viewDomain]
  );

  const handleTraceMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const xVal = pxToXVal(e.clientX, rect);

    if (e.shiftKey || markerMode === "markerA") {
      setCursor((c) => ({ ...c, markerA: xVal }));
      return;
    }
    if (e.altKey || markerMode === "markerB") {
      setCursor((c) => ({ ...c, markerB: xVal }));
      return;
    }

    setDragStartPx(e.clientX - rect.left);
    setDragCurrPx(e.clientX - rect.left);
  };

  const handleTraceMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const xVal = pxToXVal(e.clientX, rect);
    setHoverX(xVal);
    setHoverPx({ x: e.clientX - rect.left, width: rect.width });
    const nearest = findNearestByX(driverTrace, axisMode, xVal);
    if (nearest) {
      setCursor((c) => ({
        ...c,
        cursorDistanceM: nearest.s_m,
        cursorTimeS: nearest.t_s,
      }));
    }
    if (dragStartPx !== null) {
      setDragCurrPx(e.clientX - rect.left);
    }
  };

  const handleTraceMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (dragStartPx === null || dragCurrPx === null) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pxDelta = Math.abs(dragCurrPx - dragStartPx);
    if (pxDelta > 14) {
      const a = pxToXVal(rect.left + Math.min(dragStartPx, dragCurrPx), rect);
      const b = pxToXVal(rect.left + Math.max(dragStartPx, dragCurrPx), rect);
      if (b - a > 0.2) {
        setZoomRange([a, b]);
      }
    } else {
      const xVal = pxToXVal(e.clientX, rect);
      const nearest = findNearestByX(driverTrace, axisMode, xVal);
      if (nearest && driverTrace.length > 1) {
        const dur = driverTrace[driverTrace.length - 1].t_s;
        if (dur > 0) seekPlayback(nearest.t_s / dur);
      }
    }
    setDragStartPx(null);
    setDragCurrPx(null);
  };

  const handleTraceWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const [xMin, xMax] = viewDomain;
    const span = xMax - xMin;
    const fullSpan = fullDomain[1] - fullDomain[0];
    if (span >= fullSpan * 0.999) return;
    const shift = Math.sign(e.deltaY) * span * 0.14;
    let nextMin = xMin + shift;
    let nextMax = xMax + shift;
    if (nextMin < fullDomain[0]) {
      nextMin = fullDomain[0];
      nextMax = nextMin + span;
    }
    if (nextMax > fullDomain[1]) {
      nextMax = fullDomain[1];
      nextMin = nextMax - span;
    }
    setZoomRange([nextMin, nextMax]);
  };

  const handleMapHover = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (driverTrace.length < 2) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    for (const p of driverTrace) {
      if (p.x_m < minX) minX = p.x_m;
      if (p.x_m > maxX) maxX = p.x_m;
      if (p.y_m < minY) minY = p.y_m;
      if (p.y_m > maxY) maxY = p.y_m;
    }
    const pad = 22;
    const spanX = Math.max(1, maxX - minX);
    const spanY = Math.max(1, maxY - minY);
    const scale = Math.min((rect.width - pad * 2) / spanX, (rect.height - pad * 2) / spanY);
    const offX = (rect.width - spanX * scale) / 2;
    const offY = (rect.height - spanY * scale) / 2;

    let best: TrajectorySample | null = null;
    let bestD2 = Infinity;
    for (const p of driverTrace) {
      const sx = offX + (p.x_m - minX) * scale;
      const sy = rect.height - (offY + (p.y_m - minY) * scale);
      const d2 = (sx - mx) * (sx - mx) + (sy - my) * (sy - my);
      if (d2 < bestD2) {
        bestD2 = d2;
        best = p;
      }
    }
    if (best) {
      setHoverX(best[axisMode]);
      setCursor((c) => ({ ...c, cursorDistanceM: best!.s_m, cursorTimeS: best!.t_s }));
    }
  };

  const toggleChannel = (key: TraceChannelKey) => {
    setActiveChannels((prev) =>
      prev.includes(key) ? (prev.length > 1 ? prev.filter((k) => k !== key) : prev) : [...prev, key]
    );
  };

  const moveChannel = (key: TraceChannelKey, dir: -1 | 1) => {
    setActiveChannels((prev) => {
      const idx = prev.indexOf(key);
      const nextIdx = idx + dir;
      if (idx < 0 || nextIdx < 0 || nextIdx >= prev.length) return prev;
      const copy = [...prev];
      const [item] = copy.splice(idx, 1);
      copy.splice(nextIdx, 0, item);
      return copy;
    });
  };

  const addEngineeringNote = () => {
    const trimmed = noteInput.trim();
    if (!trimmed) return;
    const newNote: EngineeringNote = {
      id: `note-${Date.now()}`,
      sessionId: selectedSessionId || "default",
      distanceM: Number(cursor.cursorDistanceM.toFixed(1)),
      text: trimmed,
      createdAt: new Date().toISOString(),
    };
    const updated = [...notes, newNote];
    setNotes(updated);
    saveNotes(updated);
    setNoteInput("");
    setShowNoteForm(false);
    pushToast({
      level: "nominal",
      title: `Annotation Saved @ s = ${newNote.distanceM} m`,
      detail: trimmed,
    });
  };

  const deleteNote = (id: string) => {
    const updated = notes.filter((n) => n.id !== id);
    setNotes(updated);
    saveNotes(updated);
  };

  const exportNotes = (format: "json" | "csv") => {
    const content =
      format === "json"
        ? JSON.stringify(sessionNotes, null, 2)
        : [
            "session_id,distance_m,created_at,note",
            ...sessionNotes.map(
              (n) => `"${n.sessionId}",${n.distanceM},"${n.createdAt}","${n.text.replace(/"/g, '""')}"`
            ),
          ].join("\n");
    const blob = new Blob([content], {
      type: format === "json" ? "application/json" : "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ter27_forensics_notes.${format}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="w-full h-full min-h-0 flex flex-col gap-2 overflow-hidden">
      {/* Forensics Control Header Bar */}
      <div className="machined-panel shrink-0 px-3.5 py-2 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="panel-title-label">Session A/B Forensics</span>
          <select
            value={selectedSessionId}
            onChange={(e) => setSelectedSessionId(e.target.value)}
            className="h-[28px] bg-[#0B0D12] border border-white/[0.08] text-[#F1F5F9] text-[11.5px] px-2.5 rounded-[5px] max-w-[320px] outline-none hover:border-white/[0.16] transition-colors"
          >
            {sessions.map((s) => (
              <option key={s.session_id} value={s.session_id} className="bg-[#11141B]">
                {s.title}
              </option>
            ))}
          </select>

          <div className="flex items-center gap-2 text-[11px]">
            <span className="status-pill status-pill-gold">
              <span className="w-2 h-0.5 rounded-full bg-[#DFBE78]" />
              Trace A · Driver / 14-DOF
            </span>
            <span className="status-pill bg-[#38BDF8]/12 text-[#38BDF8]">
              <span className="w-2 h-0.5 rounded-full bg-[#38BDF8]" />
              Trace B · CasADi Optimal
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="seg-track" role="group" aria-label="X-axis mode">
            <button
              type="button"
              data-active={axisMode === "s_m" ? "true" : "false"}
              onClick={() => {
                setAxisMode("s_m");
                setZoomRange(null);
              }}
              className="seg-btn"
            >
              Distance s
            </button>
            <button
              type="button"
              data-active={axisMode === "t_s" ? "true" : "false"}
              onClick={() => {
                setAxisMode("t_s");
                setZoomRange(null);
              }}
              className="seg-btn"
            >
              Time t
            </button>
          </div>

          <div className="seg-track" role="group" aria-label="Cursor interaction mode">
            {(
              [
                { id: "zoom", label: "Drag Zoom" },
                { id: "markerA", label: "Set A" },
                { id: "markerB", label: "Set B" },
              ] as const
            ).map((m) => (
              <button
                key={m.id}
                type="button"
                data-active={markerMode === m.id ? "true" : "false"}
                onClick={() => setMarkerMode(m.id)}
                className="seg-btn"
              >
                {m.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => {
              setZoomRange(null);
              setCursor((c) => ({ ...c, markerA: null, markerB: null }));
            }}
            className="flex items-center gap-1.5 h-[28px] px-2.5 rounded-[5px] bg-[#161A23] border border-white/[0.08] text-[11px] font-medium text-[#E2E8F0] hover:border-[#C5A059]/45 hover:text-[#DFBE78] cursor-pointer transition-colors"
          >
            <RotateCcw className="w-3 h-3" />
            Reset
          </button>

          <button
            type="button"
            onClick={() => setDrawerOpen((o) => !o)}
            className={`flex items-center gap-1.5 h-[28px] px-2.5 rounded-[5px] border text-[11px] font-medium cursor-pointer transition-colors ${
              drawerOpen
                ? "border-[#C5A059]/45 bg-[#C5A059]/12 text-[#DFBE78]"
                : "border-white/[0.08] bg-[#161A23] text-[#E2E8F0] hover:border-white/[0.18]"
            }`}
          >
            <Sliders className="w-3 h-3" />
            Channels ({activeChannels.length})
          </button>

          <button
            type="button"
            onClick={() => setShowNoteForm((v) => !v)}
            className="flex items-center gap-1.5 h-[28px] px-2.5 rounded-[5px] border border-[#C5A059]/35 bg-[#C5A059]/10 text-[#DFBE78] hover:bg-[#C5A059]/18 text-[11px] font-medium cursor-pointer transition-colors"
          >
            <MessageSquarePlus className="w-3 h-3" />
            Note @ {cursor.cursorDistanceM.toFixed(0)} m
          </button>
        </div>
      </div>

      {/* Range A-B Marker Summary Banner */}
      {markerStats ? (
        <div className="machined-card shrink-0 px-3.5 py-2 flex items-center justify-between gap-4 flex-wrap text-[11px]">
          <span className="font-semibold text-[#DFBE78]">
            Range A–B · {markerStats.channelLabel}
          </span>
          <div className="flex items-center gap-4 font-mono tabular text-[#E2E8F0]">
            <span>Δs {markerStats.deltaS.toFixed(2)} m</span>
            <span>Δt {markerStats.deltaT.toFixed(3)} s</span>
            <span>Min A {markerStats.minA.toFixed(2)}</span>
            <span>Max A {markerStats.maxA.toFixed(2)}</span>
            <span>Mean A {markerStats.meanA.toFixed(2)}</span>
            <span className="text-[#38BDF8]">Mean B {markerStats.meanB.toFixed(2)}</span>
            <span className="status-pill status-pill-gold">
              ΔMean {markerStats.diffMean >= 0 ? "+" : ""}
              {markerStats.diffMean.toFixed(2)}
            </span>
          </div>
        </div>
      ) : null}

      {/* Inline Annotation Entry Bar */}
      {showNoteForm ? (
        <div className="machined-card shrink-0 px-3.5 py-2 border-[#C5A059]/45 flex items-center gap-2.5 text-[11.5px]">
          <span className="font-mono text-[#DFBE78] shrink-0">
            s = {cursor.cursorDistanceM.toFixed(1)} m
          </span>
          <input
            type="text"
            value={noteInput}
            onChange={(e) => setNoteInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addEngineeringNote();
            }}
            placeholder='Add setup observation (e.g. "Entry understeer T4 — test +0.15° front toe-out")'
            className="flex-1 h-[28px] bg-[#0B0D12] border border-white/[0.09] rounded-[5px] px-2.5 text-[#F1F5F9] placeholder-[#64748B] outline-none focus:border-[#C5A059]/60"
          />
          <button
            type="button"
            onClick={addEngineeringNote}
            className="h-[28px] px-3 rounded-[5px] bg-[#C5A059] hover:bg-[#DFBE78] text-[#07080B] font-semibold text-[11px] cursor-pointer transition-colors"
          >
            Save Note
          </button>
        </div>
      ) : null}

      {/* Main Split Forensics Stage */}
      <div className="flex-1 min-h-0 flex gap-2 overflow-hidden relative">
        {drawerOpen ? (
          <div className="machined-panel w-[236px] shrink-0 flex flex-col overflow-hidden">
            <div className="panel-header-bar">
              <span className="panel-title-label">Channel Order</span>
            </div>
            <div className="p-2.5 space-y-1.5 overflow-y-auto">
              {ALL_CHANNELS.map((ch) => {
                const idx = activeChannels.indexOf(ch.key);
                const enabled = idx >= 0;
                return (
                  <div
                    key={ch.key}
                    className="machined-card flex items-center justify-between gap-1.5 px-2.5 py-1.5 text-[11px]"
                  >
                    <label className="flex items-center gap-2 cursor-pointer truncate">
                      <input
                        type="checkbox"
                        checked={enabled}
                        onChange={() => toggleChannel(ch.key)}
                        className="accent-[#C5A059]"
                      />
                      <span className={enabled ? "text-[#F1F5F9] font-medium" : "text-[#64748B]"}>
                        {ch.label}
                      </span>
                    </label>
                    {enabled ? (
                      <div className="flex items-center gap-0.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => moveChannel(ch.key, -1)}
                          className="p-1 rounded text-[#94A3B8] hover:text-[#F1F5F9] hover:bg-white/[0.06] cursor-pointer"
                        >
                          <ArrowUp className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveChannel(ch.key, 1)}
                          className="p-1 rounded text-[#94A3B8] hover:text-[#F1F5F9] hover:bg-white/[0.06] cursor-pointer"
                        >
                          <ArrowDown className="w-3 h-3" />
                        </button>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>

            <div className="panel-header-bar border-t border-white/[0.06] mt-1">
              <span className="panel-title-label">Annotations ({sessionNotes.length})</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => exportNotes("json")}
                  className="text-[10.5px] font-medium text-[#94A3B8] hover:text-[#DFBE78] cursor-pointer"
                >
                  JSON
                </button>
                <button
                  type="button"
                  onClick={() => exportNotes("csv")}
                  className="text-[10.5px] font-medium text-[#94A3B8] hover:text-[#DFBE78] cursor-pointer flex items-center gap-1"
                >
                  <Download className="w-3 h-3" />
                  CSV
                </button>
              </div>
            </div>
            <div className="p-2.5 space-y-1.5 flex-1 overflow-y-auto">
              {sessionNotes.length === 0 ? (
                <div className="text-[11px] text-[#64748B]">No annotations saved for this session.</div>
              ) : (
                sessionNotes.map((n) => (
                  <div key={n.id} className="machined-card p-2 text-[11px]">
                    <div className="flex items-center justify-between">
                      <button
                        type="button"
                        onClick={() => {
                          setAxisMode("s_m");
                          setZoomRange([Math.max(0, n.distanceM - 12), n.distanceM + 12]);
                        }}
                        className="font-mono text-[10.5px] text-[#DFBE78] hover:underline cursor-pointer"
                      >
                        s = {n.distanceM.toFixed(1)} m
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteNote(n.id)}
                        className="text-[#64748B] hover:text-[#F87171] cursor-pointer"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                    <div className="text-[#E2E8F0] mt-1 leading-snug">{n.text}</div>
                  </div>
                ))
              )}
            </div>
          </div>
        ) : null}

        <div className="flex-1 min-w-0 min-h-0">
          <SplitPane
            direction="horizontal"
            initialRatio={0.63}
            minRatio={0.35}
            maxRatio={0.78}
            first={
              <SplitPane
                direction="vertical"
                initialRatio={0.67}
                minRatio={0.35}
                maxRatio={0.82}
                first={
                  <div
                    ref={traceContainerRef}
                    className="machined-panel w-full h-full min-h-0 relative overflow-hidden"
                  >
                    <canvas
                      ref={traceCanvasRef}
                      onMouseDown={handleTraceMouseDown}
                      onMouseMove={handleTraceMouseMove}
                      onMouseUp={handleTraceMouseUp}
                      onMouseLeave={() => {
                        setHoverX(null);
                        setHoverPx(null);
                        setDragStartPx(null);
                        setDragCurrPx(null);
                      }}
                      onDoubleClick={() => setZoomRange(null)}
                      onWheel={handleTraceWheel}
                      className="block w-full h-full cursor-crosshair"
                    />

                    {/* Floating A/B Crosshair Readout Popover */}
                    {hoverSnapshot && dragStartPx === null ? (
                      <div
                        className="pointer-events-none absolute top-3 z-20 w-[230px] rounded-[6px] bg-[#141821]/95 border border-white/[0.11] shadow-[0_12px_28px_rgba(0,0,0,0.55)] p-2.5 text-[10.5px]"
                        style={{
                          left:
                            hoverSnapshot.pxX + 248 > hoverSnapshot.width
                              ? Math.max(58, hoverSnapshot.pxX - 242)
                              : hoverSnapshot.pxX + 14,
                        }}
                      >
                        <div className="flex items-center justify-between pb-1.5 mb-1.5 border-b border-white/[0.07]">
                          <span className="font-semibold text-[#F1F5F9]">A / B Cursor</span>
                          <span className="font-mono text-[10px] text-[#DFBE78] tabular">
                            {hoverSnapshot.sA.s_m.toFixed(1)} m · {hoverSnapshot.sA.t_s.toFixed(2)} s
                          </span>
                        </div>
                        <div className="space-y-1 font-mono text-[10px] tabular">
                          {activeChannelSpecs.map((ch) => {
                            const vA = sampleValue(hoverSnapshot.sA, ch);
                            const vB = sampleValue(hoverSnapshot.sB, ch);
                            const d = vA - vB;
                            return (
                              <div key={ch.key} className="flex items-center justify-between gap-2">
                                <span className="text-[#94A3B8] truncate">{ch.label}</span>
                                <span className="text-right whitespace-nowrap">
                                  <span className="text-[#DFBE78]">{vA.toFixed(1)}</span>
                                  <span className="text-[#64748B]"> / </span>
                                  <span className="text-[#38BDF8]">{vB.toFixed(1)}</span>
                                  <span
                                    className={`ml-1.5 ${
                                      d >= 0 ? "text-[#34D399]" : "text-[#F87171]"
                                    }`}
                                  >
                                    ({d >= 0 ? "+" : ""}
                                    {d.toFixed(1)})
                                  </span>
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}
                  </div>
                }
                second={
                  <SectorDeltaBreakdown
                    driverTrace={driverTrace}
                    refTrace={refTrace}
                    onSelectSectorRange={(sStart, sEnd) => {
                      setAxisMode("s_m");
                      setZoomRange([sStart, sEnd]);
                    }}
                  />
                }
              />
            }
            second={
              <SplitPane
                direction="vertical"
                initialRatio={0.55}
                minRatio={0.3}
                maxRatio={0.75}
                first={
                  <div className="machined-panel flex flex-col w-full h-full min-h-0 overflow-hidden">
                    <div className="panel-header-bar gap-2">
                      <span className="panel-title-label">2D Track Map</span>
                      <div className="seg-track">
                        {(
                          [
                            { id: "speed", label: "Speed" },
                            { id: "delta_t", label: "Δt" },
                            { id: "ay_g", label: "|ay|" },
                            { id: "ax_g", label: "ax" },
                          ] as const
                        ).map((m) => (
                          <button
                            key={m.id}
                            type="button"
                            data-active={mapColorMode === m.id ? "true" : "false"}
                            onClick={() => setMapColorMode(m.id)}
                            className="seg-btn"
                          >
                            {m.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="flex-1 min-h-0 relative">
                      <canvas
                        ref={mapCanvasRef}
                        onMouseMove={handleMapHover}
                        onMouseLeave={() => setHoverX(null)}
                        className="block w-full h-full cursor-crosshair"
                      />
                    </div>
                  </div>
                }
                second={
                  <div className="machined-panel flex flex-col w-full h-full min-h-0 overflow-hidden">
                    <div className="panel-header-bar">
                      <span className="panel-title-label">g-g Traction Envelope</span>
                      <span className="status-pill status-pill-muted font-mono text-[10px]">
                        {zoomRange ? "Zoomed Segment" : "Full Lap"}
                      </span>
                    </div>
                    <div className="flex-1 min-h-0 relative">
                      <canvas ref={ggCanvasRef} className="block w-full h-full" />
                    </div>
                  </div>
                }
              />
            }
          />
        </div>
      </div>
    </div>
  );
}
