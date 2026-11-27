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
import { InstrumentHeader } from "../shared/PrecisionControl";
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
  { key: "ax_g", label: "Long. Accel ax", unit: "g", scale: 1 },
  { key: "beta_deg", label: "Sideslip β", unit: "deg", scale: 1 },
  { key: "steer_deg", label: "Steer Angle", unit: "deg", scale: 1 },
  { key: "mz_tv_nm", label: "TV Moment Mz", unit: "Nm", scale: 1 },
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
    return t < 0.45 ? "#10B981" : t > 0.55 ? "#DC2626" : "#C5A059";
  }
  if (mode === "ax_g") {
    return t < 0.42 ? "#DC2626" : t > 0.56 ? "#10B981" : "#C5A059";
  }
  if (mode === "util") {
    return t > 0.9 ? "#DC2626" : t > 0.75 ? "#D97706" : "#10B981";
  }
  if (t < 0.33) return "#38BDF8";
  if (t < 0.68) return "#10B981";
  if (t < 0.88) return "#DFBE78";
  return "#DC2626";
}

export function SessionABComparator() {
  const { forceOfflineMode, cursor, setCursor, seekPlayback, pushToast } = useTelemetryStore();

  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string>("");
  const [comparison, setComparison] = useState<SessionABComparisonResponse | null>(null);
  const [axisMode, setAxisMode] = useState<AxisMode>("s_m");
  const [mapColorMode, setMapColorMode] = useState<MapColorMode>("speed");
  const [rightBottomTab, setRightBottomTab] = useState<"sectors" | "notes">("sectors");
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

      ctx.fillStyle = "#08090C";
      ctx.fillRect(0, 0, width, height);

      const padLeft = 52;
      const padRight = 12;
      const axisFootH = 22;
      const plotW = Math.max(40, width - padLeft - padRight);
      const nLanes = Math.max(1, activeChannelSpecs.length);
      const laneH = (height - axisFootH) / nLanes;
      const [xMin, xMax] = viewDomain;
      const xSpan = Math.max(1e-4, xMax - xMin);

      const xToPx = (xv: number) => padLeft + ((xv - xMin) / xSpan) * plotW;

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
        const headH = 20;
        const innerTop = y0 + headH + 4;
        const innerBot = y0 + laneH - 6;
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

        ctx.fillStyle = "rgba(255, 255, 255, 0.018)";
        ctx.fillRect(0, y0, width, headH);
        if (idx > 0) {
          ctx.strokeStyle = "#222633";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(0, Math.round(y0) + 0.5);
          ctx.lineTo(width, Math.round(y0) + 0.5);
          ctx.stroke();
        }

        ctx.fillStyle = "#94A3B8";
        ctx.font = '600 10px "Inter", sans-serif';
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(`${ch.label} (${ch.unit})`, 10, y0 + headH / 2);

        ctx.font = '9.5px "JetBrains Mono", monospace';
        ctx.textAlign = "right";
        const ticks = minV < 0 && maxV > 0 ? [minV, 0, maxV] : [minV, (minV + maxV) / 2, maxV];
        for (const tk of ticks) {
          const py = innerBot - ((tk - minV) / (maxV - minV)) * innerH;
          const isZero = Math.abs(tk) < 1e-4;
          ctx.save();
          ctx.strokeStyle = isZero
            ? "rgba(255, 255, 255, 0.12)"
            : "rgba(255, 255, 255, 0.045)";
          if (!isZero) ctx.setLineDash([3, 4]);
          ctx.beginPath();
          ctx.moveTo(padLeft, Math.round(py) + 0.5);
          ctx.lineTo(padLeft + plotW, Math.round(py) + 0.5);
          ctx.stroke();
          ctx.restore();

          ctx.fillStyle = isZero ? "#94A3B8" : "#64748B";
          ctx.fillText(tk.toFixed(1), padLeft - 6, py);
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
        strokePoints(ptsA, "#C5A059", 1.9);

        const activeX = hoverX ?? (axisMode === "s_m" ? cursor.cursorDistanceM : cursor.cursorTimeS);
        const sA = findNearestByX(driverTrace, axisMode, activeX);
        const sB = findNearestByX(refTrace, axisMode, activeX);
        if (sA && sB) {
          const vA = sampleValue(sA, ch);
          const vB = sampleValue(sB, ch);
          const diff = vA - vB;
          ctx.font = '500 9.5px "JetBrains Mono", monospace';
          ctx.textAlign = "right";
          ctx.fillStyle = "#CBD5E1";
          ctx.fillText(
            `A ${vA.toFixed(2)}  B ${vB.toFixed(2)}  Δ ${diff >= 0 ? "+" : ""}${diff.toFixed(2)} ${ch.unit}`,
            width - 10,
            y0 + headH / 2
          );
        }
      });

      const axisY = height - axisFootH;
      ctx.fillStyle = "#0F1116";
      ctx.fillRect(0, axisY, width, axisFootH);
      ctx.strokeStyle = "#222633";
      ctx.beginPath();
      ctx.moveTo(0, axisY + 0.5);
      ctx.lineTo(width, axisY + 0.5);
      ctx.stroke();

      ctx.font = '9.5px "JetBrains Mono", monospace';
      ctx.fillStyle = "#64748B";
      ctx.textBaseline = "middle";
      for (let g = 0; g <= 6; g++) {
        const xv = xMin + (xSpan * g) / 6;
        const px = xToPx(xv);
        ctx.textAlign = g === 6 ? "right" : g === 0 ? "left" : "center";
        ctx.fillText(`${xv.toFixed(1)} ${axisMode === "s_m" ? "m" : "s"}`, px, axisY + axisFootH / 2);
      }

      if (axisMode === "s_m") {
        for (const note of sessionNotes) {
          if (note.distanceM < xMin || note.distanceM > xMax) continue;
          const nx = xToPx(note.distanceM);
          ctx.save();
          ctx.strokeStyle = "#D97706";
          ctx.setLineDash([2, 3]);
          ctx.beginPath();
          ctx.moveTo(Math.round(nx) + 0.5, 0);
          ctx.lineTo(Math.round(nx) + 0.5, axisY);
          ctx.stroke();
          ctx.restore();
        }
      }

      if (cursor.markerA !== null && cursor.markerA >= xMin && cursor.markerA <= xMax) {
        const px = xToPx(cursor.markerA);
        ctx.strokeStyle = "#C5A059";
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

      const currX = hoverX ?? (axisMode === "s_m" ? cursor.cursorDistanceM : cursor.cursorTimeS);
      if (currX >= xMin && currX <= xMax) {
        const cx = xToPx(currX);
        ctx.save();
        ctx.strokeStyle = "rgba(236, 239, 244, 0.72)";
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(Math.round(cx) + 0.5, 0);
        ctx.lineTo(Math.round(cx) + 0.5, axisY);
        ctx.stroke();
        ctx.restore();
      }

      if (dragStartPx !== null && dragCurrPx !== null) {
        const left = Math.min(dragStartPx, dragCurrPx);
        const wSel = Math.abs(dragCurrPx - dragStartPx);
        ctx.fillStyle = "rgba(197, 160, 89, 0.16)";
        ctx.fillRect(left, 0, wSel, axisY);
        ctx.strokeStyle = "#C5A059";
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
      const parent = canvas.parentElement;
      if (!parent) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = parent.clientWidth;
      const h = parent.clientHeight;
      if (w < 40 || h < 40) return;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.fillStyle = "#08090C";
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

      const pad = 18;
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

      ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
      ctx.lineWidth = 5;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      driverTrace.forEach((p, i) => {
        const { sx, sy } = toScreen(p.x_m, p.y_m);
        if (i === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      });
      ctx.stroke();

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
        ctx.lineWidth = inZoom ? 2.6 : 1.3;
        ctx.beginPath();
        ctx.moveTo(a.sx, a.sy);
        ctx.lineTo(b.sx, b.sy);
        ctx.stroke();
      }

      const currSample = findNearestByX(
        driverTrace,
        axisMode,
        hoverX ?? (axisMode === "s_m" ? cursor.cursorDistanceM : cursor.cursorTimeS)
      );
      if (currSample) {
        const pt = toScreen(currSample.x_m, currSample.y_m);
        ctx.strokeStyle = "#C5A059";
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(pt.sx, pt.sy, 6.5, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = "#ECEFF4";
        ctx.beginPath();
        ctx.arc(pt.sx, pt.sy, 2.8, 0, Math.PI * 2);
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
      const parent = canvas.parentElement;
      if (!parent) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = parent.clientWidth;
      const h = parent.clientHeight;
      if (w < 40 || h < 40) return;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.fillStyle = "#08090C";
      ctx.fillRect(0, 0, w, h);

      const cx = w / 2;
      const cy = h / 2;
      const maxR = Math.max(26, Math.min(w, h) * 0.42);
      const maxG = 2.0;

      ctx.font = '9px "JetBrains Mono", monospace';
      for (const gRing of [0.5, 1.0, 1.5, 2.0]) {
        const r = (gRing / maxG) * maxR;
        ctx.save();
        ctx.strokeStyle =
          gRing === 1.5 ? "rgba(197, 160, 89, 0.25)" : "rgba(255, 255, 255, 0.055)";
        if (gRing !== 2.0) ctx.setLineDash([2, 4]);
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();

        ctx.fillStyle = "#64748B";
        ctx.fillText(`${gRing.toFixed(1)}g`, cx + 3, cy - r + 9);
      }

      ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
      ctx.beginPath();
      ctx.moveTo(cx - maxR, cy);
      ctx.lineTo(cx + maxR, cy);
      ctx.moveTo(cx, cy - maxR);
      ctx.lineTo(cx, cy + maxR);
      ctx.stroke();

      const [vMin, vMax] = viewDomain;
      const isZoomed = zoomRange !== null;

      for (let i = 0; i < driverTrace.length; i += 2) {
        const p = driverTrace[i];
        const inSeg = p[axisMode] >= vMin && p[axisMode] <= vMax;
        if (inSeg && isZoomed) continue;
        const px = cx + (p.ay_g / maxG) * maxR;
        const py = cy - (p.ax_g / maxG) * maxR;
        ctx.fillStyle = isZoomed ? "rgba(148, 163, 184, 0.14)" : "rgba(56, 189, 248, 0.36)";
        ctx.beginPath();
        ctx.arc(px, py, 1.4, 0, Math.PI * 2);
        ctx.fill();
      }

      for (let i = 0; i < driverTrace.length; i++) {
        const p = driverTrace[i];
        if (p[axisMode] < vMin || p[axisMode] > vMax) continue;
        const px = cx + (p.ay_g / maxG) * maxR;
        const py = cy - (p.ax_g / maxG) * maxR;
        ctx.fillStyle = "rgba(197, 160, 89, 0.85)";
        ctx.beginPath();
        ctx.arc(px, py, 1.6, 0, Math.PI * 2);
        ctx.fill();
      }

      const curr = findNearestByX(
        driverTrace,
        axisMode,
        hoverX ?? (axisMode === "s_m" ? cursor.cursorDistanceM : cursor.cursorTimeS)
      );
      if (curr) {
        const px = cx + (curr.ay_g / maxG) * maxR;
        const py = cy - (curr.ax_g / maxG) * maxR;
        ctx.strokeStyle = "#C5A059";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(px, py, 5.5, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = "#ECEFF4";
        ctx.beginPath();
        ctx.arc(px, py, 2.6, 0, Math.PI * 2);
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
    viewDomain,
    zoomRange,
  ]);

  const pxToXVal = useCallback(
    (clientX: number, rect: DOMRect) => {
      const padLeft = 52;
      const padRight = 12;
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
    const pad = 18;
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
    setRightBottomTab("notes");
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
              (n) =>
                `"${n.sessionId}",${n.distanceM},"${n.createdAt}","${n.text.replace(/"/g, '""')}"`
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
    <div className="w-full h-full min-h-0 flex flex-col gap-1.5 overflow-hidden">
      {/* Compact Single-Row Forensics Toolbar */}
      <div className="machined-panel shrink-0 overflow-hidden">
        <div className="inst-header !h-[32px] gap-2">
          <div className="flex items-center gap-2 min-w-0 flex-1 overflow-hidden">
            <span className="panel-title-label shrink-0">Lap Forensics A/B</span>
            <select
              value={selectedSessionId}
              onChange={(e) => setSelectedSessionId(e.target.value)}
              className="h-[22px] bg-[#08090C] border border-[#222633] text-[#ECEFF4] text-[10.5px] px-2 rounded-[3px] max-w-[260px] min-w-[140px] outline-none focus:border-[#C5A059]"
            >
              {sessions.map((s) => (
                <option key={s.session_id} value={s.session_id} className="bg-[#0F1116]">
                  {s.title}
                </option>
              ))}
            </select>
            <span className="hidden xl:inline-flex items-center gap-1.5 font-mono text-[9.5px] text-[#DFBE78] shrink-0">
              <span className="w-2 h-[2px] bg-[#C5A059]" />A Driver
            </span>
            <span className="hidden xl:inline-flex items-center gap-1.5 font-mono text-[9.5px] text-[#38BDF8] shrink-0">
              <span className="w-2 h-[2px] bg-[#38BDF8]" />B CasADi
            </span>
          </div>

          <div className="flex items-center gap-1.5 shrink-0 flex-nowrap">
            <div className="seg-track">
              <button
                type="button"
                data-active={axisMode === "s_m" ? "true" : "false"}
                onClick={() => {
                  setAxisMode("s_m");
                  setZoomRange(null);
                }}
                className="seg-btn"
              >
                Dist s
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

            <div className="seg-track">
              {(
                [
                  { id: "zoom", label: "Zoom" },
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
              className="h-[22px] px-2 rounded-[3px] bg-[#151820] border border-[#222633] text-[10px] font-medium text-[#CBD5E1] hover:border-[#C5A059]/45 hover:text-[#DFBE78] flex items-center gap-1 cursor-pointer"
            >
              <RotateCcw className="w-2.5 h-2.5" />
              Reset
            </button>

            <button
              type="button"
              onClick={() => setDrawerOpen((o) => !o)}
              className={`h-[22px] px-2 rounded-[3px] border text-[10px] font-medium flex items-center gap-1 cursor-pointer ${
                drawerOpen
                  ? "border-[#C5A059]/50 bg-[#C5A059]/14 text-[#DFBE78]"
                  : "border-[#222633] bg-[#151820] text-[#CBD5E1] hover:border-[#343B4E]"
              }`}
            >
              <Sliders className="w-2.5 h-2.5" />
              Ch ({activeChannels.length})
            </button>

            <button
              type="button"
              onClick={() => setShowNoteForm((v) => !v)}
              className="h-[22px] px-2 rounded-[3px] border border-[#C5A059]/40 bg-[#C5A059]/12 text-[#DFBE78] hover:bg-[#C5A059]/20 text-[10px] font-medium flex items-center gap-1 cursor-pointer"
            >
              <MessageSquarePlus className="w-2.5 h-2.5" />
              Note @{cursor.cursorDistanceM.toFixed(0)}m
            </button>
          </div>
        </div>

        {/* Optional Dual A-B Marker Stats Bar */}
        {markerStats ? (
          <div className="h-[24px] px-3 bg-[#0F1116] border-t border-[#222633] flex items-center justify-between gap-3 text-[10px] font-mono tabular">
            <span className="text-[#DFBE78] font-semibold">
              A–B · {markerStats.channelLabel}
            </span>
            <div className="flex items-center gap-3 text-[#CBD5E1]">
              <span>Δs {markerStats.deltaS.toFixed(1)}m</span>
              <span>Δt {markerStats.deltaT.toFixed(3)}s</span>
              <span>Mean A {markerStats.meanA.toFixed(2)}</span>
              <span className="text-[#38BDF8]">Mean B {markerStats.meanB.toFixed(2)}</span>
              <span className="text-[#DFBE78]">
                ΔMean {markerStats.diffMean >= 0 ? "+" : ""}
                {markerStats.diffMean.toFixed(2)}
              </span>
            </div>
          </div>
        ) : null}

        {/* Optional Inline Note Form */}
        {showNoteForm ? (
          <div className="px-2.5 py-1.5 bg-[#0F1116] border-t border-[#C5A059]/35 flex items-center gap-2 text-[10.5px]">
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
              placeholder="Add distance-anchored engineering observation..."
              className="flex-1 h-[24px] bg-[#08090C] border border-[#222633] rounded-[3px] px-2 text-[#ECEFF4] placeholder-[#64748B] outline-none focus:border-[#C5A059]"
            />
            <button
              type="button"
              onClick={addEngineeringNote}
              className="h-[24px] px-2.5 rounded-[3px] bg-[#C5A059] hover:bg-[#DFBE78] text-[#07080B] font-semibold text-[10px] cursor-pointer"
            >
              Save
            </button>
          </div>
        ) : null}
      </div>

      {/* Main 64% / 36% Forensics Split Stage */}
      <div className="flex-1 min-h-0 flex gap-1.5 overflow-hidden">
        {drawerOpen ? (
          <div className="machined-panel w-[214px] shrink-0 flex flex-col overflow-hidden">
            <InstrumentHeader title="Channel Picker" />
            <div className="p-1.5 space-y-1 overflow-y-auto">
              {ALL_CHANNELS.map((ch) => {
                const idx = activeChannels.indexOf(ch.key);
                const enabled = idx >= 0;
                return (
                  <div
                    key={ch.key}
                    className="h-[26px] rounded-[3px] bg-[#141720] border border-[#222633] flex items-center justify-between gap-1 px-2 text-[10.5px]"
                  >
                    <label className="flex items-center gap-1.5 cursor-pointer truncate">
                      <input
                        type="checkbox"
                        checked={enabled}
                        onChange={() => toggleChannel(ch.key)}
                        className="accent-[#C5A059]"
                      />
                      <span className={enabled ? "text-[#ECEFF4]" : "text-[#64748B]"}>
                        {ch.label}
                      </span>
                    </label>
                    {enabled ? (
                      <div className="flex items-center shrink-0">
                        <button
                          type="button"
                          onClick={() => moveChannel(ch.key, -1)}
                          className="p-0.5 text-[#7E8899] hover:text-[#ECEFF4] cursor-pointer"
                        >
                          <ArrowUp className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveChannel(ch.key, 1)}
                          className="p-0.5 text-[#7E8899] hover:text-[#ECEFF4] cursor-pointer"
                        >
                          <ArrowDown className="w-3 h-3" />
                        </button>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        <div className="flex-1 min-w-0 min-h-0">
          <SplitPane
            direction="horizontal"
            initialRatio={0.64}
            minRatio={0.44}
            maxRatio={0.76}
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

                {hoverSnapshot && dragStartPx === null ? (
                  <div
                    className="pointer-events-none absolute top-2.5 z-20 w-[215px] rounded-[3px] bg-[#0F1116]/95 border border-[#2A3040] shadow-[0_10px_24px_rgba(0,0,0,0.6)] p-2 text-[10px]"
                    style={{
                      left:
                        hoverSnapshot.pxX + 230 > hoverSnapshot.width
                          ? Math.max(54, hoverSnapshot.pxX - 226)
                          : hoverSnapshot.pxX + 12,
                    }}
                  >
                    <div className="flex items-center justify-between pb-1 mb-1 border-b border-[#222633]">
                      <span className="font-semibold text-[#ECEFF4]">A / B Cursor</span>
                      <span className="font-mono text-[#DFBE78] tabular">
                        {hoverSnapshot.sA.s_m.toFixed(1)}m · {hoverSnapshot.sA.t_s.toFixed(2)}s
                      </span>
                    </div>
                    <div className="space-y-0.5 font-mono tabular">
                      {activeChannelSpecs.map((ch) => {
                        const vA = sampleValue(hoverSnapshot.sA, ch);
                        const vB = sampleValue(hoverSnapshot.sB, ch);
                        const d = vA - vB;
                        return (
                          <div key={ch.key} className="flex items-center justify-between gap-1.5">
                            <span className="text-[#7E8899] truncate">{ch.label}</span>
                            <span className="text-right whitespace-nowrap">
                              <span className="text-[#DFBE78]">{vA.toFixed(1)}</span>
                              <span className="text-[#475569]">/</span>
                              <span className="text-[#38BDF8]">{vB.toFixed(1)}</span>
                              <span
                                className={`ml-1 ${
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
              <SplitPane
                direction="vertical"
                initialRatio={0.48}
                minRatio={0.32}
                maxRatio={0.66}
                first={
                  <div className="w-full h-full min-h-0 grid grid-cols-2 gap-1.5 overflow-hidden">
                    <div className="machined-panel flex flex-col min-h-0 overflow-hidden">
                      <InstrumentHeader
                        title="2D Track Map"
                        right={
                          <div className="seg-track">
                            {(
                              [
                                { id: "speed", label: "v" },
                                { id: "delta_t", label: "Δt" },
                                { id: "ay_g", label: "ay" },
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
                        }
                      />
                      <div className="flex-1 min-h-0 relative bg-[#08090C]">
                        <canvas
                          ref={mapCanvasRef}
                          onMouseMove={handleMapHover}
                          onMouseLeave={() => setHoverX(null)}
                          className="block w-full h-full cursor-crosshair"
                        />
                      </div>
                    </div>

                    <div className="machined-panel flex flex-col min-h-0 overflow-hidden">
                      <InstrumentHeader
                        title="g-g Envelope"
                        right={
                          <span className="font-mono text-[9.5px] text-[#7E8899]">
                            {zoomRange ? "Zoom" : "Full"}
                          </span>
                        }
                      />
                      <div className="flex-1 min-h-0 relative bg-[#08090C]">
                        <canvas ref={ggCanvasRef} className="block w-full h-full" />
                      </div>
                    </div>
                  </div>
                }
                second={
                  rightBottomTab === "sectors" ? (
                    <SectorDeltaBreakdown
                      driverTrace={driverTrace}
                      refTrace={refTrace}
                      onSelectSectorRange={(sStart, sEnd) => {
                        setAxisMode("s_m");
                        setZoomRange([sStart, sEnd]);
                      }}
                      headerRight={
                        <div className="seg-track">
                          <button
                            type="button"
                            data-active="true"
                            onClick={() => setRightBottomTab("sectors")}
                            className="seg-btn"
                          >
                            Sectors
                          </button>
                          <button
                            type="button"
                            data-active="false"
                            onClick={() => setRightBottomTab("notes")}
                            className="seg-btn"
                          >
                            Notes ({sessionNotes.length})
                          </button>
                        </div>
                      }
                    />
                  ) : (
                    <div className="machined-panel flex flex-col w-full h-full min-h-0 overflow-hidden">
                      <InstrumentHeader
                        title="Distance-Anchored Notes"
                        right={
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => exportNotes("csv")}
                              className="h-[20px] px-1.5 rounded-[2px] bg-[#151820] border border-[#222633] text-[9.5px] text-[#94A3B8] hover:text-[#DFBE78] flex items-center gap-1 cursor-pointer"
                            >
                              <Download className="w-2.5 h-2.5" />
                              CSV
                            </button>
                            <div className="seg-track">
                              <button
                                type="button"
                                data-active="false"
                                onClick={() => setRightBottomTab("sectors")}
                                className="seg-btn"
                              >
                                Sectors
                              </button>
                              <button
                                type="button"
                                data-active="true"
                                onClick={() => setRightBottomTab("notes")}
                                className="seg-btn"
                              >
                                Notes ({sessionNotes.length})
                              </button>
                            </div>
                          </div>
                        }
                      />
                      <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1.5 bg-[#08090C]">
                        {sessionNotes.length === 0 ? (
                          <div className="text-center font-mono text-[10.5px] text-[#64748B] py-6">
                            No annotations saved for this session. Click &quot;Note&quot; above to anchor one at the active cursor.
                          </div>
                        ) : (
                          sessionNotes.map((n) => (
                            <div
                              key={n.id}
                              className="rounded-[3px] bg-[#141720] border border-[#222633] p-2 text-[10.5px]"
                            >
                              <div className="flex items-center justify-between">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setAxisMode("s_m");
                                    setZoomRange([Math.max(0, n.distanceM - 12), n.distanceM + 12]);
                                  }}
                                  className="font-mono text-[10px] text-[#DFBE78] hover:underline cursor-pointer"
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
                              <div className="text-[#ECEFF4] mt-1 leading-snug">{n.text}</div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  )
                }
              />
            }
          />
        </div>
      </div>
    </div>
  );
}
