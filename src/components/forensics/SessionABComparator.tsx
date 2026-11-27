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
  { key: "beta_deg", label: "Sideslip beta", unit: "deg", scale: 1 },
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

function findNearestByX(trace: TrajectorySample[], axis: AxisMode, xVal: number): TrajectorySample | null {
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
    // Green faster (<0.5) to Red slower (>0.5)
    return t < 0.45 ? "#10B981" : t > 0.55 ? "#DC2626" : "#C5A059";
  }
  if (mode === "ax_g") {
    // Braking red (<0.42), coasting muted gold, throttle green
    return t < 0.42 ? "#DC2626" : t > 0.56 ? "#10B981" : "#C5A059";
  }
  if (mode === "util") {
    return t > 0.9 ? "#DC2626" : t > 0.75 ? "#D97706" : "#10B981";
  }
  // Speed / Lateral G: muted steel -> cyan -> gold -> red peak
  if (t < 0.33) return "#38BDF8";
  if (t < 0.68) return "#10B981";
  if (t < 0.88) return "#C5A059";
  return "#DC2626";
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

  // Zoom range in current axis units
  const [zoomRange, setZoomRange] = useState<[number, number] | null>(null);
  const [markerMode, setMarkerMode] = useState<"zoom" | "markerA" | "markerB">("zoom");
  const [hoverX, setHoverX] = useState<number | null>(null);
  const [dragStartPx, setDragStartPx] = useState<number | null>(null);
  const [dragCurrPx, setDragCurrPx] = useState<number | null>(null);

  // Engineering Annotations persisted in localStorage
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

  // ESC resets zoom cleanly
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && zoomRange) {
        setZoomRange(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoomRange]);

  // Dual A/B marker statistics inside [markerA, markerB]
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
      channelLabel: `${ch.label} [${ch.unit}]`,
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

      const padLeft = 58;
      const padRight = 14;
      const plotW = Math.max(40, width - padLeft - padRight);
      const nLanes = Math.max(1, activeChannelSpecs.length);
      const laneH = (height - 20) / nLanes;
      const [xMin, xMax] = viewDomain;
      const xSpan = Math.max(1e-4, xMax - xMin);

      const xToPx = (xv: number) => padLeft + ((xv - xMin) / xSpan) * plotW;

      // Shaded marker range [markerA, markerB]
      if (cursor.markerA !== null && cursor.markerB !== null) {
        const pxA = xToPx(Math.min(cursor.markerA, cursor.markerB));
        const pxB = xToPx(Math.max(cursor.markerA, cursor.markerB));
        ctx.fillStyle = "rgba(197, 160, 89, 0.08)";
        ctx.fillRect(Math.max(padLeft, pxA), 0, Math.max(0, pxB - Math.max(padLeft, pxA)), height - 20);
      }

      // Draw lanes
      activeChannelSpecs.forEach((ch, idx) => {
        const y0 = idx * laneH;
        const headH = 16;
        const innerTop = y0 + headH + 2;
        const innerBot = y0 + laneH - 6;
        const innerH = Math.max(16, innerBot - innerTop);

        // Compute visible min/max across A and B
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
        const padV = (maxV - minV) * 0.1;
        minV -= padV;
        maxV += padV;

        // Lane border & header
        ctx.fillStyle = "#0F1116";
        ctx.fillRect(0, y0, width, headH);
        if (idx > 0) {
          ctx.strokeStyle = "#222633";
          ctx.beginPath();
          ctx.moveTo(0, y0 + 0.5);
          ctx.lineTo(width, y0 + 0.5);
          ctx.stroke();
        }

        ctx.fillStyle = "#7E8799";
        ctx.font = '600 9px "IBM Plex Sans", sans-serif';
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(`${ch.label.toUpperCase()} [${ch.unit}]`, 8, y0 + headH / 2);

        // Y-axis min / mid / max ticks
        ctx.font = '9px "JetBrains Mono", monospace';
        ctx.textAlign = "right";
        const ticks = [minV, (minV + maxV) / 2, maxV];
        for (const tk of ticks) {
          const py = innerBot - ((tk - minV) / (maxV - minV)) * innerH;
          ctx.strokeStyle = "#181C26";
          ctx.beginPath();
          ctx.moveTo(padLeft, Math.round(py) + 0.5);
          ctx.lineTo(padLeft + plotW, Math.round(py) + 0.5);
          ctx.stroke();
          ctx.fillStyle = "#7E8799";
          ctx.fillText(tk.toFixed(1), padLeft - 6, py);
        }

        // Draw Trace B (Reference CasADi - #38BDF8)
        const drawLine = (trace: TrajectorySample[], color: string, lineWidth: number) => {
          ctx.strokeStyle = color;
          ctx.lineWidth = lineWidth;
          ctx.beginPath();
          let started = false;
          for (let i = 0; i < trace.length; i++) {
            const p = trace[i];
            const xv = p[axisMode];
            if (xv < xMin || xv > xMax) continue;
            const px = xToPx(xv);
            const py = innerBot - ((sampleValue(p, ch) - minV) / (maxV - minV)) * innerH;
            if (!started) {
              ctx.moveTo(px, py);
              started = true;
            } else {
              ctx.lineTo(px, py);
            }
          }
          ctx.stroke();
        };

        drawLine(refTrace, "#38BDF8", 1.25);
        drawLine(driverTrace, "#C5A059", 1.5);

        // Cursor numeric readout on lane header
        const activeX = hoverX ?? (axisMode === "s_m" ? cursor.cursorDistanceM : cursor.cursorTimeS);
        const sA = findNearestByX(driverTrace, axisMode, activeX);
        const sB = findNearestByX(refTrace, axisMode, activeX);
        if (sA && sB) {
          const vA = sampleValue(sA, ch);
          const vB = sampleValue(sB, ch);
          const diff = vA - vB;
          ctx.font = '10px "JetBrains Mono", monospace';
          ctx.textAlign = "right";
          ctx.fillStyle = "#ECEFF4";
          ctx.fillText(
            `A ${vA.toFixed(2)}  |  B ${vB.toFixed(2)}  |  d ${diff >= 0 ? "+" : ""}${diff.toFixed(2)} ${ch.unit}`,
            width - 8,
            y0 + headH / 2
          );
        }
      });

      // Bottom X axis ruler
      const axisY = height - 20;
      ctx.fillStyle = "#0F1116";
      ctx.fillRect(0, axisY, width, 20);
      ctx.strokeStyle = "#222633";
      ctx.beginPath();
      ctx.moveTo(0, axisY + 0.5);
      ctx.lineTo(width, axisY + 0.5);
      ctx.stroke();

      ctx.font = '10px "JetBrains Mono", monospace';
      ctx.fillStyle = "#7E8799";
      ctx.textBaseline = "middle";
      for (let g = 0; g <= 6; g++) {
        const xv = xMin + (xSpan * g) / 6;
        const px = xToPx(xv);
        ctx.textAlign = g === 6 ? "right" : g === 0 ? "left" : "center";
        ctx.fillText(`${xv.toFixed(1)}${axisMode === "s_m" ? "m" : "s"}`, px, axisY + 10);
      }

      // Engineering annotations ticks (when distance axis is active)
      if (axisMode === "s_m") {
        for (const note of sessionNotes) {
          if (note.distanceM < xMin || note.distanceM > xMax) continue;
          const nx = xToPx(note.distanceM);
          ctx.strokeStyle = "#D97706";
          ctx.setLineDash([2, 2]);
          ctx.beginPath();
          ctx.moveTo(Math.round(nx) + 0.5, 0);
          ctx.lineTo(Math.round(nx) + 0.5, axisY);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }

      // Markers A and B vertical lines
      if (cursor.markerA !== null && cursor.markerA >= xMin && cursor.markerA <= xMax) {
        const px = xToPx(cursor.markerA);
        ctx.strokeStyle = "#C5A059";
        ctx.lineWidth = 1.25;
        ctx.beginPath();
        ctx.moveTo(Math.round(px) + 0.5, 0);
        ctx.lineTo(Math.round(px) + 0.5, axisY);
        ctx.stroke();
      }
      if (cursor.markerB !== null && cursor.markerB >= xMin && cursor.markerB <= xMax) {
        const px = xToPx(cursor.markerB);
        ctx.strokeStyle = "#38BDF8";
        ctx.lineWidth = 1.25;
        ctx.beginPath();
        ctx.moveTo(Math.round(px) + 0.5, 0);
        ctx.lineTo(Math.round(px) + 0.5, axisY);
        ctx.stroke();
      }

      // Synchronized Global Cursor crosshair
      const currX = hoverX ?? (axisMode === "s_m" ? cursor.cursorDistanceM : cursor.cursorTimeS);
      if (currX >= xMin && currX <= xMax) {
        const cx = xToPx(currX);
        ctx.strokeStyle = "#ECEFF4";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(Math.round(cx) + 0.5, 0);
        ctx.lineTo(Math.round(cx) + 0.5, axisY);
        ctx.stroke();
      }

      // Drag-zoom selection overlay
      if (dragStartPx !== null && dragCurrPx !== null) {
        const left = Math.min(dragStartPx, dragCurrPx);
        const wSel = Math.abs(dragCurrPx - dragStartPx);
        ctx.fillStyle = "rgba(197, 160, 89, 0.16)";
        ctx.fillRect(left, 0, wSel, axisY);
        ctx.strokeStyle = "#C5A059";
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

      // Subtle reference path underneath
      ctx.strokeStyle = "#1E2330";
      ctx.lineWidth = 4;
      ctx.beginPath();
      driverTrace.forEach((p, i) => {
        const { sx, sy } = toScreen(p.x_m, p.y_m);
        if (i === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      });
      ctx.stroke();

      // Colored track segments
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

        ctx.strokeStyle = inZoom ? colorRamp(norm, mapColorMode) : "#222633";
        ctx.lineWidth = inZoom ? 2.4 : 1.2;
        ctx.beginPath();
        ctx.moveTo(a.sx, a.sy);
        ctx.lineTo(b.sx, b.sy);
        ctx.stroke();
      }

      // Active cursor marker on track
      const currSample = findNearestByX(
        driverTrace,
        axisMode,
        hoverX ?? (axisMode === "s_m" ? cursor.cursorDistanceM : cursor.cursorTimeS)
      );
      if (currSample) {
        const pt = toScreen(currSample.x_m, currSample.y_m);
        ctx.fillStyle = "#ECEFF4";
        ctx.beginPath();
        ctx.arc(pt.sx, pt.sy, 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#C5A059";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(pt.sx, pt.sy, 7.5, 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.restore();
    };

    render();
    const ro = new ResizeObserver(render);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [axisMode, cursor.cursorDistanceM, cursor.cursorTimeS, driverTrace, hoverX, mapColorMode, viewDomain]);

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
      ctx.fillStyle = "#08090C";
      ctx.fillRect(0, 0, w, h);

      const cx = w / 2;
      const cy = h / 2;
      const maxR = Math.max(30, Math.min(w, h) * 0.41);
      const maxG = 2.0;

      // Concentric 0.5g, 1.0g, 1.5g, 2.0g rings
      ctx.font = '9px "JetBrains Mono", monospace';
      for (const gRing of [0.5, 1.0, 1.5, 2.0]) {
        const r = (gRing / maxG) * maxR;
        ctx.strokeStyle = gRing === 1.5 ? "#2C3347" : "#181C26";
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = "#7E8799";
        ctx.fillText(`${gRing.toFixed(1)}g`, cx + 3, cy - r + 9);
      }

      // Crosshairs
      ctx.strokeStyle = "#222633";
      ctx.beginPath();
      ctx.moveTo(cx - maxR, cy);
      ctx.lineTo(cx + maxR, cy);
      ctx.moveTo(cx, cy - maxR);
      ctx.lineTo(cx, cy + maxR);
      ctx.stroke();

      const [vMin, vMax] = viewDomain;
      const isZoomed = zoomRange !== null;

      // Full lap dimmed points first
      for (let i = 0; i < driverTrace.length; i += 2) {
        const p = driverTrace[i];
        const inSeg = p[axisMode] >= vMin && p[axisMode] <= vMax;
        if (inSeg && isZoomed) continue;
        const px = cx + (p.ay_g / maxG) * maxR;
        const py = cy - (p.ax_g / maxG) * maxR;
        ctx.fillStyle = isZoomed ? "rgba(126, 135, 153, 0.22)" : "rgba(56, 189, 248, 0.42)";
        ctx.fillRect(px - 1, py - 1, 2, 2);
      }

      // Highlighted zoomed segment points in Brushed Gold
      for (let i = 0; i < driverTrace.length; i++) {
        const p = driverTrace[i];
        if (p[axisMode] < vMin || p[axisMode] > vMax) continue;
        const px = cx + (p.ay_g / maxG) * maxR;
        const py = cy - (p.ax_g / maxG) * maxR;
        ctx.fillStyle = "#C5A059";
        ctx.fillRect(px - 1.25, py - 1.25, 2.5, 2.5);
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
        ctx.fillStyle = "#ECEFF4";
        ctx.beginPath();
        ctx.arc(px, py, 3.5, 0, Math.PI * 2);
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
      const padLeft = 58;
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
      // Single click syncs global playback timeline to this exact point
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
    <div className="w-full h-full min-h-0 flex flex-col overflow-hidden bg-[#08090C]">
      {/* Forensics Control Ribbon */}
      <div className="shrink-0 bg-[#0F1116] border-b border-[#222633] px-2.5 py-1.5 flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="panel-title-label">Session A/B Forensics</span>
          <select
            value={selectedSessionId}
            onChange={(e) => setSelectedSessionId(e.target.value)}
            className="bg-[#151820] border border-[#222633] text-[#ECEFF4] font-mono text-[11px] px-2 py-0.5 rounded-[2px] max-w-[340px]"
          >
            {sessions.map((s) => (
              <option key={s.session_id} value={s.session_id}>
                {s.title}
              </option>
            ))}
          </select>
          <span className="text-[10px] font-mono text-[#C5A059]">A: Driver / 14-DOF</span>
          <span className="text-[10px] font-mono text-[#38BDF8]">B: CasADi Optimal</span>
        </div>

        <div className="flex items-center gap-1.5 font-mono text-[10px]">
          <div className="flex border border-[#222633] rounded-[2px] bg-[#08090C]">
            <button
              type="button"
              onClick={() => {
                setAxisMode("s_m");
                setZoomRange(null);
              }}
              className={`px-2 py-0.5 cursor-pointer ${
                axisMode === "s_m" ? "bg-[#1B1F2A] text-[#C5A059]" : "text-[#7E8799]"
              }`}
            >
              DIST s [m]
            </button>
            <button
              type="button"
              onClick={() => {
                setAxisMode("t_s");
                setZoomRange(null);
              }}
              className={`px-2 py-0.5 cursor-pointer ${
                axisMode === "t_s" ? "bg-[#1B1F2A] text-[#C5A059]" : "text-[#7E8799]"
              }`}
            >
              TIME t [s]
            </button>
          </div>

          <div className="flex border border-[#222633] rounded-[2px] bg-[#08090C]">
            {(
              [
                { id: "zoom", label: "DRAG ZOOM" },
                { id: "markerA", label: "SET A" },
                { id: "markerB", label: "SET B" },
              ] as const
            ).map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setMarkerMode(m.id)}
                className={`px-2 py-0.5 cursor-pointer ${
                  markerMode === m.id ? "bg-[#1B1F2A] text-[#C5A059]" : "text-[#7E8799]"
                }`}
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
            className="flex items-center gap-1 px-2 py-0.5 border border-[#222633] bg-[#151820] text-[#ECEFF4] hover:border-[#C5A059] rounded-[2px] cursor-pointer"
          >
            <RotateCcw className="w-2.5 h-2.5" />
            Reset
          </button>

          <button
            type="button"
            onClick={() => setDrawerOpen((o) => !o)}
            className={`flex items-center gap-1 px-2 py-0.5 border rounded-[2px] cursor-pointer ${
              drawerOpen
                ? "border-[#C5A059] text-[#C5A059] bg-[#1B1F2A]"
                : "border-[#222633] bg-[#151820] text-[#ECEFF4]"
            }`}
          >
            <Sliders className="w-2.5 h-2.5" />
            Channels ({activeChannels.length})
          </button>

          <button
            type="button"
            onClick={() => setShowNoteForm((v) => !v)}
            className="flex items-center gap-1 px-2 py-0.5 border border-[#222633] bg-[#151820] text-[#C5A059] hover:border-[#C5A059] rounded-[2px] cursor-pointer"
          >
            <MessageSquarePlus className="w-2.5 h-2.5" />
            Note @ {cursor.cursorDistanceM.toFixed(0)}m
          </button>
        </div>
      </div>

      {/* Inline Marker Statistics Strip */}
      {markerStats ? (
        <div className="shrink-0 bg-[#151820] border-b border-[#222633] px-3 py-1 flex items-center justify-between gap-3 font-mono text-[10px]">
          <span className="text-[#C5A059] font-semibold">
            RANGE A-B ({markerStats.channelLabel})
          </span>
          <div className="flex items-center gap-4 text-[#ECEFF4]">
            <span>Delta s: {markerStats.deltaS.toFixed(2)} m</span>
            <span>Delta t: {markerStats.deltaT.toFixed(3)} s</span>
            <span>Min A: {markerStats.minA.toFixed(2)}</span>
            <span>Max A: {markerStats.maxA.toFixed(2)}</span>
            <span>Mean A: {markerStats.meanA.toFixed(2)}</span>
            <span className="text-[#38BDF8]">Mean B: {markerStats.meanB.toFixed(2)}</span>
            <span className="text-[#C5A059]">
              Mean (A-B): {markerStats.diffMean >= 0 ? "+" : ""}
              {markerStats.diffMean.toFixed(2)}
            </span>
          </div>
        </div>
      ) : null}

      {/* Inline Annotation Input Bar */}
      {showNoteForm ? (
        <div className="shrink-0 bg-[#151820] border-b border-[#C5A059] px-3 py-1.5 flex items-center gap-2 font-mono text-[11px]">
          <span className="text-[#C5A059] shrink-0">
            s = {cursor.cursorDistanceM.toFixed(1)} m:
          </span>
          <input
            type="text"
            value={noteInput}
            onChange={(e) => setNoteInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addEngineeringNote();
            }}
            placeholder='e.g. "Entry understeer T4 - test +0.15 deg front toe-out"'
            className="flex-1 bg-[#08090C] border border-[#222633] px-2 py-0.5 text-[#ECEFF4] outline-none"
          />
          <button
            type="button"
            onClick={addEngineeringNote}
            className="px-2.5 py-0.5 bg-[#C5A059] text-[#08090C] font-semibold rounded-[2px] cursor-pointer"
          >
            Save Note
          </button>
        </div>
      ) : null}

      {/* Main Resizable Forensics Body */}
      <div className="flex-1 min-h-0 flex overflow-hidden relative">
        {/* Optional Channel Selector Drawer */}
        {drawerOpen ? (
          <div className="w-[215px] shrink-0 bg-[#0F1116] border-r border-[#222633] flex flex-col overflow-y-auto">
            <div className="panel-header-bar">
              <span className="panel-title-label">Channel Order</span>
            </div>
            <div className="p-2 space-y-1">
              {ALL_CHANNELS.map((ch) => {
                const idx = activeChannels.indexOf(ch.key);
                const enabled = idx >= 0;
                return (
                  <div
                    key={ch.key}
                    className="flex items-center justify-between gap-1 px-1.5 py-1 bg-[#151820] border border-[#222633] text-[10px] font-mono"
                  >
                    <label className="flex items-center gap-1.5 cursor-pointer truncate">
                      <input
                        type="checkbox"
                        checked={enabled}
                        onChange={() => toggleChannel(ch.key)}
                        className="accent-[#C5A059]"
                      />
                      <span className={enabled ? "text-[#ECEFF4]" : "text-[#7E8799]"}>
                        {ch.label}
                      </span>
                    </label>
                    {enabled ? (
                      <div className="flex items-center gap-0.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => moveChannel(ch.key, -1)}
                          className="p-0.5 text-[#7E8799] hover:text-[#ECEFF4] cursor-pointer"
                        >
                          <ArrowUp className="w-2.5 h-2.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveChannel(ch.key, 1)}
                          className="p-0.5 text-[#7E8799] hover:text-[#ECEFF4] cursor-pointer"
                        >
                          <ArrowDown className="w-2.5 h-2.5" />
                        </button>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>

            {/* Saved Engineering Annotations */}
            <div className="panel-header-bar border-t border-[#222633] mt-2">
              <span className="panel-title-label">Annotations ({sessionNotes.length})</span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => exportNotes("json")}
                  title="Export JSON"
                  className="text-[9px] font-mono text-[#7E8799] hover:text-[#C5A059] cursor-pointer"
                >
                  JSON
                </button>
                <button
                  type="button"
                  onClick={() => exportNotes("csv")}
                  title="Export CSV"
                  className="text-[9px] font-mono text-[#7E8799] hover:text-[#C5A059] cursor-pointer flex items-center gap-0.5"
                >
                  <Download className="w-2.5 h-2.5" />
                  CSV
                </button>
              </div>
            </div>
            <div className="p-2 space-y-1.5 flex-1 overflow-y-auto">
              {sessionNotes.length === 0 ? (
                <div className="text-[10px] font-mono text-[#7E8799]">
                  No notes attached yet.
                </div>
              ) : (
                sessionNotes.map((n) => (
                  <div
                    key={n.id}
                    className="bg-[#151820] border border-[#222633] p-1.5 text-[10px] font-mono"
                  >
                    <div className="flex items-center justify-between text-[#C5A059]">
                      <button
                        type="button"
                        onClick={() => {
                          setAxisMode("s_m");
                          setZoomRange([Math.max(0, n.distanceM - 12), n.distanceM + 12]);
                        }}
                        className="hover:underline cursor-pointer"
                      >
                        s = {n.distanceM.toFixed(1)} m
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteNote(n.id)}
                        className="text-[#7E8799] hover:text-[#DC2626] cursor-pointer"
                      >
                        <Trash2 className="w-2.5 h-2.5" />
                      </button>
                    </div>
                    <div className="text-[#ECEFF4] mt-0.5 leading-snug">{n.text}</div>
                  </div>
                ))
              )}
            </div>
          </div>
        ) : null}

        <div className="flex-1 min-w-0 min-h-0">
          <SplitPane
            direction="horizontal"
            initialRatio={0.62}
            minRatio={0.35}
            maxRatio={0.78}
            first={
              <SplitPane
                direction="vertical"
                initialRatio={0.68}
                minRatio={0.35}
                maxRatio={0.82}
                first={
                  <div
                    ref={traceContainerRef}
                    className="w-full h-full min-h-0 relative bg-[#08090C]"
                  >
                    <canvas
                      ref={traceCanvasRef}
                      onMouseDown={handleTraceMouseDown}
                      onMouseMove={handleTraceMouseMove}
                      onMouseUp={handleTraceMouseUp}
                      onMouseLeave={() => {
                        setHoverX(null);
                        setDragStartPx(null);
                        setDragCurrPx(null);
                      }}
                      onDoubleClick={() => setZoomRange(null)}
                      onWheel={handleTraceWheel}
                      className="block w-full h-full cursor-crosshair"
                    />
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
                initialRatio={0.54}
                minRatio={0.3}
                maxRatio={0.75}
                first={
                  <div className="flex flex-col w-full h-full min-h-0 bg-[#0F1116]">
                    <div className="panel-header-bar gap-2">
                      <span className="panel-title-label">2D Track Map</span>
                      <select
                        value={mapColorMode}
                        onChange={(e) => setMapColorMode(e.target.value as MapColorMode)}
                        className="bg-[#08090C] border border-[#222633] text-[#ECEFF4] font-mono text-[10px] px-1.5 py-0.5 rounded-[2px]"
                      >
                        <option value="speed">Color: Speed</option>
                        <option value="delta_t">Color: Delta-Time</option>
                        <option value="ay_g">Color: Lateral G</option>
                        <option value="ax_g">Color: Throttle / Brake</option>
                        <option value="util">Color: Tire Utilization</option>
                      </select>
                    </div>
                    <div className="flex-1 min-h-0 relative p-1">
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
                  <div className="flex flex-col w-full h-full min-h-0 bg-[#0F1116]">
                    <div className="panel-header-bar">
                      <span className="panel-title-label">g-g Traction Diagram (ax vs ay)</span>
                      <span className="text-[10px] font-mono text-[#C5A059]">
                        {zoomRange ? "SEGMENT HIGHLIGHTED" : "FULL LAP"}
                      </span>
                    </div>
                    <div className="flex-1 min-h-0 relative p-1">
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
