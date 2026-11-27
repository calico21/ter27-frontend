import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BookmarkPlus,
  Pause,
  Play,
  Plus,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import { useTelemetryStore } from "../../state/telemetryStore";
import {
  OSCILLOSCOPE_PRESETS,
  OscilloscopeChannelBinding,
  OscilloscopePreset,
  OscilloscopeTrackConfig,
  SIGNAL_MAP,
  SIGNAL_SUBSYSTEMS,
  SignalSubsystemId,
  VEHICLE_SIGNALS,
} from "../../services/vehicleSignalCatalog";

type TimebaseSec = 5 | 15 | 30 | 60;
const TIMEBASES: TimebaseSec[] = [5, 15, 30, 60];
const CUSTOM_PRESETS_KEY = "ter27_custom_oscilloscope_presets_v1";

const COLOR_SWATCHES = [
  "#F1F5F9",
  "#C5A059",
  "#38BDF8",
  "#34D399",
  "#D97706",
  "#EF4444",
  "#DFBE78",
  "#94A3B8",
];

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace("#", "");
  if (clean.length !== 6) return `rgba(241, 245, 249, ${alpha})`;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function computeNiceRange(
  minVal: number,
  maxVal: number,
  minSpan: number,
  symmetric: boolean,
  floorZero = false
): [number, number] {
  if (!Number.isFinite(minVal) || !Number.isFinite(maxVal)) {
    return symmetric ? [-minSpan / 2, minSpan / 2] : [0, minSpan];
  }
  if (symmetric) {
    const absMax = Math.max(Math.abs(minVal), Math.abs(maxVal), minSpan / 2);
    const padded = absMax * 1.15;
    return [-padded, padded];
  }
  let lo = floorZero ? Math.min(0, minVal) : minVal;
  let hi = maxVal;
  if (hi - lo < minSpan) {
    const mid = (lo + hi) / 2;
    lo = floorZero ? Math.max(0, mid - minSpan / 2) : mid - minSpan / 2;
    hi = lo + minSpan;
  }
  const pad = (hi - lo) * 0.14;
  return [floorZero ? Math.max(0, lo - pad * 0.35) : lo - pad, hi + pad];
}

function loadCustomPresets(): OscilloscopePreset[] {
  try {
    const raw = window.localStorage.getItem(CUSTOM_PRESETS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as OscilloscopePreset[];
  } catch {
    // ignore storage errors
  }
  return [];
}

function formatAxisTick(tick: number): string {
  if (Math.abs(tick) < 1e-4) return "0";
  if (Math.abs(tick) >= 100) return tick.toFixed(0);
  if (Math.abs(tick) >= 10) return tick.toFixed(1);
  return tick.toFixed(2);
}

function formatSignalReadout(val: number, decimals: number): string {
  if (!Number.isFinite(val)) return "---";
  const sign = val < 0 ? "-" : "";
  const absStr = Math.abs(val).toFixed(decimals);
  return `${sign}${absStr}`;
}

export function MultiChannelPlot() {
  const { ringBufferRef, frame, safetyOverlay, pushToast } = useTelemetryStore();

  const [customPresets, setCustomPresets] = useState<OscilloscopePreset[]>(() =>
    loadCustomPresets()
  );
  const allPresets = useMemo(
    () => [...OSCILLOSCOPE_PRESETS, ...customPresets],
    [customPresets]
  );

  const [activePresetId, setActivePresetId] = useState<string>(OSCILLOSCOPE_PRESETS[0].id);
  const [tracks, setTracks] = useState<OscilloscopeTrackConfig[]>(() =>
    OSCILLOSCOPE_PRESETS[0].tracks.map((t) => ({
      ...t,
      channels: t.channels.map((c) => ({ ...c })),
    }))
  );
  const [timebase, setTimebase] = useState<TimebaseSec>(15);
  const [frozen, setFrozen] = useState<boolean>(false);
  const [hoverNorm, setHoverNorm] = useState<number | null>(null);
  const [editingTrackId, setEditingTrackId] = useState<string | null>(null);

  // Signal Picker modal state
  const [signalQuery, setSignalQuery] = useState<string>("");
  const [subsystemFilter, setSubsystemFilter] = useState<SignalSubsystemId | "all">("all");
  const [savingPresetMode, setSavingPresetMode] = useState<boolean>(false);
  const [newPresetName, setNewPresetName] = useState<string>("");

  // DOM & canvas references
  const canvasMapRef = useRef<Map<string, HTMLCanvasElement>>(new Map());
  const smoothBoundsRef = useRef<Map<string, [number, number]>>(new Map());
  const tracksRef = useRef<OscilloscopeTrackConfig[]>(tracks);
  const timebaseRef = useRef<TimebaseSec>(timebase);
  const frozenRef = useRef<boolean>(frozen);
  const hoverNormRef = useRef<number | null>(hoverNorm);
  const safetyOverlayRef = useRef(safetyOverlay);

  tracksRef.current = tracks;
  timebaseRef.current = timebase;
  frozenRef.current = frozen;
  hoverNormRef.current = hoverNorm;
  safetyOverlayRef.current = safetyOverlay;

  const registerCanvas = useCallback((trackId: string, el: HTMLCanvasElement | null) => {
    if (el) {
      canvasMapRef.current.set(trackId, el);
    } else {
      canvasMapRef.current.delete(trackId);
    }
  }, []);

  const applyPreset = (presetId: string) => {
    const found = allPresets.find((p) => p.id === presetId);
    if (!found) return;
    setActivePresetId(found.id);
    smoothBoundsRef.current.clear();
    setTracks(
      found.tracks.map((t) => ({
        ...t,
        channels: t.channels.map((c) => ({ ...c })),
      }))
    );
  };

  const handleSaveCustomPreset = () => {
    const trimmed = newPresetName.trim();
    if (!trimmed) return;
    const preset: OscilloscopePreset = {
      id: `custom_${Date.now()}`,
      name: trimmed,
      tracks: tracks.map((t) => ({
        ...t,
        channels: t.channels.map((c) => ({ ...c })),
      })),
    };
    const next = [...customPresets, preset];
    setCustomPresets(next);
    setActivePresetId(preset.id);
    setSavingPresetMode(false);
    setNewPresetName("");
    try {
      window.localStorage.setItem(CUSTOM_PRESETS_KEY, JSON.stringify(next));
    } catch {
      // ignore storage errors
    }
    pushToast({
      level: "nominal",
      title: `Saved Preset: ${trimmed}`,
      detail: `${tracks.length} oscilloscope tracks persisted to local workstation profile.`,
    });
  };

  const handleAddTrack = () => {
    if (tracks.length >= 6) return;
    const nextIdx = tracks.length + 1;
    const newId = `track_${Date.now()}`;
    setTracks((prev) => [
      ...prev,
      {
        id: newId,
        title: `Custom Track ${nextIdx}`,
        channels: [{ signalId: "tv_mz_nm", axis: "left", color: "#C5A059", fill: true }],
      },
    ]);
    setEditingTrackId(newId);
  };

  const handleRemoveTrack = (trackId: string) => {
    if (tracks.length <= 2) return;
    setTracks((prev) => prev.filter((t) => t.id !== trackId));
    if (editingTrackId === trackId) setEditingTrackId(null);
  };

  const toggleSignalOnTrack = (trackId: string, signalId: string) => {
    const def = SIGNAL_MAP[signalId];
    if (!def) return;
    setTracks((prev) =>
      prev.map((track) => {
        if (track.id !== trackId) return track;
        const exists = track.channels.some((c) => c.signalId === signalId);
        if (exists) {
          return {
            ...track,
            channels: track.channels.filter((c) => c.signalId !== signalId),
          };
        }
        // Smart default: if units differ from existing left-axis signals, bind to right axis
        const firstLeft = track.channels.find((c) => c.axis === "left");
        const firstLeftDef = firstLeft ? SIGNAL_MAP[firstLeft.signalId] : null;
        const defaultAxis: "left" | "right" =
          firstLeftDef && firstLeftDef.unit !== def.unit ? "right" : "left";
        const usedColors = new Set(track.channels.map((c) => c.color));
        const chosenColor = usedColors.has(def.defaultColor)
          ? COLOR_SWATCHES.find((col) => !usedColors.has(col)) ?? def.defaultColor
          : def.defaultColor;
        return {
          ...track,
          channels: [
            ...track.channels,
            {
              signalId,
              axis: defaultAxis,
              color: chosenColor,
              fill: track.channels.length === 0,
            },
          ],
        };
      })
    );
  };

  const updateChannelBinding = (
    trackId: string,
    signalId: string,
    patch: Partial<OscilloscopeChannelBinding>
  ) => {
    setTracks((prev) =>
      prev.map((track) => {
        if (track.id !== trackId) return track;
        return {
          ...track,
          channels: track.channels.map((ch) =>
            ch.signalId === signalId ? { ...ch, ...patch } : ch
          ),
        };
      })
    );
  };

  const updateTrackTitle = (trackId: string, title: string) => {
    setTracks((prev) => prev.map((t) => (t.id === trackId ? { ...t, title } : t)));
  };

  // Single unified 60 fps canvas renderer across all stacked tracks
  useEffect(() => {
    let rafId = 0;

    const renderAllTracks = () => {
      const rb = ringBufferRef.current;
      const totalCount = rb.count;
      const tb = timebaseRef.current;
      const maxSamples = Math.min(totalCount, tb * 60);
      const startLogical = Math.max(0, totalCount - maxSamples);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const currentTracks = tracksRef.current;
      const safety = safetyOverlayRef.current;
      const hoverX = hoverNormRef.current;

      for (const track of currentTracks) {
        const canvas = canvasMapRef.current.get(track.id);
        if (!canvas) continue;
        const parent = canvas.parentElement;
        if (!parent) continue;

        const width = parent.clientWidth;
        const height = parent.clientHeight;
        if (width < 40 || height < 24) continue;

        const targetW = Math.floor(width * dpr);
        const targetH = Math.floor(height * dpr);
        if (canvas.width !== targetW || canvas.height !== targetH) {
          canvas.width = targetW;
          canvas.height = targetH;
        }

        const ctx = canvas.getContext("2d");
        if (!ctx) continue;

        ctx.save();
        ctx.scale(dpr, dpr);

        // Matte-carbon oscilloscope background
        ctx.fillStyle = "#08090C";
        ctx.fillRect(0, 0, width, height);

        const leftChannels = track.channels.filter((c) => c.axis === "left");
        const rightChannels = track.channels.filter((c) => c.axis === "right");
        const hasRight = rightChannels.length > 0;

        const padLeft = 50;
        const padRight = hasRight ? 48 : 14;
        const padTop = 7;
        const padBottom = 7;
        const plotW = Math.max(30, width - padLeft - padRight);
        const plotH = Math.max(14, height - padTop - padBottom);

        // Sample stride for clean crisp lines
        const stride = maxSamples > 1 ? Math.max(1, Math.floor(maxSamples / Math.max(220, plotW))) : 1;

        const computeAxisBounds = (
          axisKey: string,
          bindings: OscilloscopeChannelBinding[]
        ): [number, number] => {
          if (bindings.length === 0 || maxSamples < 2) {
            return [-1, 1];
          }
          let lo = Infinity;
          let hi = -Infinity;
          let anySymmetric = false;
          let allFloorZero = true;
          let maxMinSpan = 0.2;

          for (const b of bindings) {
            const def = SIGNAL_MAP[b.signalId];
            if (!def) continue;
            if (def.symmetric) anySymmetric = true;
            if (!def.floorZero) allFloorZero = false;
            if (def.minSpan > maxMinSpan) maxMinSpan = def.minSpan;

            for (let s = 0; s < maxSamples; s += stride) {
              const phys = rb.getPhysicalIndex(startLogical + s);
              const fr = rb.frames[phys];
              if (!fr) continue;
              const prevFr =
                s > 0 ? rb.frames[rb.getPhysicalIndex(startLogical + s - 1)] : null;
              const v = def.extract(fr, prevFr, safety);
              if (v < lo) lo = v;
              if (v > hi) hi = v;
            }
          }

          const target = computeNiceRange(lo, hi, maxMinSpan, anySymmetric, allFloorZero);
          const prev = smoothBoundsRef.current.get(axisKey);
          if (!prev) {
            smoothBoundsRef.current.set(axisKey, target);
            return target;
          }
          const next: [number, number] = [
            prev[0] + (target[0] - prev[0]) * 0.18,
            prev[1] + (target[1] - prev[1]) * 0.18,
          ];
          smoothBoundsRef.current.set(axisKey, next);
          return next;
        };

        const leftRange = computeAxisBounds(`${track.id}:L`, leftChannels);
        const rightRange = hasRight
          ? computeAxisBounds(`${track.id}:R`, rightChannels)
          : ([0, 1] as [number, number]);

        // Vertical timebase dashed gridlines (5 divisions)
        for (let g = 1; g < 5; g++) {
          const gx = padLeft + (plotW * g) / 5;
          ctx.save();
          ctx.strokeStyle = "rgba(255, 255, 255, 0.04)";
          ctx.setLineDash([2, 5]);
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(Math.round(gx) + 0.5, padTop);
          ctx.lineTo(Math.round(gx) + 0.5, padTop + plotH);
          ctx.stroke();
          ctx.restore();
        }

        // Left Y-axis gridlines & labels
        const [lMin, lMax] = leftRange;
        const leftTicks =
          lMin < 0 && lMax > 0 ? [lMin, 0, lMax] : [lMin, (lMin + lMax) / 2, lMax];

        ctx.font = '10px "JetBrains Mono", monospace';
        ctx.textBaseline = "middle";
        ctx.textAlign = "right";
        for (const tick of leftTicks) {
          const norm = (tick - lMin) / Math.max(1e-5, lMax - lMin);
          const py = padTop + plotH - norm * plotH;
          const isZero = Math.abs(tick) < 1e-4;

          ctx.save();
          ctx.strokeStyle = isZero
            ? "rgba(255, 255, 255, 0.12)"
            : "rgba(255, 255, 255, 0.045)";
          ctx.lineWidth = 1;
          if (!isZero) ctx.setLineDash([3, 4]);
          ctx.beginPath();
          ctx.moveTo(padLeft, Math.round(py) + 0.5);
          ctx.lineTo(padLeft + plotW, Math.round(py) + 0.5);
          ctx.stroke();
          ctx.restore();

          ctx.fillStyle = isZero ? "#94A3B8" : "#64748B";
          ctx.fillText(formatAxisTick(tick), padLeft - 6, py);
        }

        // Right Y-axis ticks (if right channels exist)
        if (hasRight) {
          const [rMin, rMax] = rightRange;
          const rightTicks =
            rMin < 0 && rMax > 0 ? [rMin, 0, rMax] : [rMin, (rMin + rMax) / 2, rMax];
          ctx.textAlign = "left";
          const rightAccent = rightChannels[0]?.color ?? "#C5A059";
          for (const tick of rightTicks) {
            const norm = (tick - rMin) / Math.max(1e-5, rMax - rMin);
            const py = padTop + plotH - norm * plotH;
            ctx.fillStyle = hexToRgba(rightAccent, 0.78);
            ctx.fillText(formatAxisTick(tick), padLeft + plotW + 6, py);
          }
        }

        // Draw channel waveforms
        if (maxSamples >= 2) {
          for (const binding of track.channels) {
            const def = SIGNAL_MAP[binding.signalId];
            if (!def) continue;
            const [sMin, sMax] = binding.axis === "right" ? rightRange : leftRange;
            const span = Math.max(1e-5, sMax - sMin);

            const pts: Array<[number, number]> = [];
            for (let s = 0; s < maxSamples; s += stride) {
              const phys = rb.getPhysicalIndex(startLogical + s);
              const fr = rb.frames[phys];
              if (!fr) continue;
              const prevFr =
                s > 0 ? rb.frames[rb.getPhysicalIndex(startLogical + s - 1)] : null;
              const val = def.extract(fr, prevFr, safety);
              const px = padLeft + (s / Math.max(1, maxSamples - 1)) * plotW;
              const norm = Math.max(0, Math.min(1, (val - sMin) / span));
              const py = padTop + plotH - norm * plotH;
              pts.push([px, py]);
            }

            // Reach exact right live edge
            const lastPhys = rb.getPhysicalIndex(startLogical + maxSamples - 1);
            const lastFr = rb.frames[lastPhys];
            if (lastFr && pts.length > 0) {
              const prevLastFr =
                maxSamples > 1
                  ? rb.frames[rb.getPhysicalIndex(startLogical + maxSamples - 2)]
                  : null;
              const lastVal = def.extract(lastFr, prevLastFr, safety);
              const lastNorm = Math.max(0, Math.min(1, (lastVal - sMin) / span));
              pts.push([padLeft + plotW, padTop + plotH - lastNorm * plotH]);
            }

            if (pts.length < 2) continue;

            if (binding.fill) {
              ctx.save();
              const grad = ctx.createLinearGradient(0, padTop, 0, padTop + plotH);
              grad.addColorStop(0, hexToRgba(binding.color, 0.14));
              grad.addColorStop(1, hexToRgba(binding.color, 0.0));
              ctx.fillStyle = grad;
              ctx.beginPath();
              ctx.moveTo(pts[0][0], padTop + plotH);
              for (const [px, py] of pts) ctx.lineTo(px, py);
              ctx.lineTo(pts[pts.length - 1][0], padTop + plotH);
              ctx.closePath();
              ctx.fill();
              ctx.restore();
            }

            ctx.save();
            ctx.strokeStyle = binding.color;
            ctx.lineWidth = binding.fill ? 1.75 : 1.5;
            ctx.lineJoin = "round";
            ctx.lineCap = "round";
            if (binding.dashed) ctx.setLineDash([5, 4]);
            ctx.beginPath();
            ctx.moveTo(pts[0][0], pts[0][1]);
            for (let i = 1; i < pts.length; i++) {
              ctx.lineTo(pts[i][0], pts[i][1]);
            }
            ctx.stroke();
            ctx.restore();
          }
        }

        // Synchronized vertical hover crosshair
        if (hoverX !== null && maxSamples > 1) {
          const cx = padLeft + hoverX * plotW;
          ctx.save();
          ctx.strokeStyle = "rgba(197, 160, 89, 0.78)";
          ctx.lineWidth = 1;
          ctx.setLineDash([3, 3]);
          ctx.beginPath();
          ctx.moveTo(Math.round(cx) + 0.5, 0);
          ctx.lineTo(Math.round(cx) + 0.5, height);
          ctx.stroke();
          ctx.restore();
        }

        ctx.restore();
      }

      if (!frozenRef.current) {
        rafId = requestAnimationFrame(renderAllTracks);
      }
    };

    rafId = requestAnimationFrame(renderAllTracks);
    return () => cancelAnimationFrame(rafId);
  }, [ringBufferRef, frozen, timebase, tracks, hoverNorm]);

  // Resolve active inspected frame (hover crosshair or latest live frame)
  const inspectedPair = useMemo(() => {
    const rb = ringBufferRef.current;
    const totalCount = rb.count;
    if (hoverNorm !== null && totalCount > 1) {
      const maxSamples = Math.min(totalCount, timebase * 60);
      const startLogical = Math.max(0, totalCount - maxSamples);
      const offset = Math.min(maxSamples - 1, Math.max(0, Math.round(hoverNorm * (maxSamples - 1))));
      const cur = rb.frames[rb.getPhysicalIndex(startLogical + offset)] ?? frame;
      const prev =
        offset > 0 ? rb.frames[rb.getPhysicalIndex(startLogical + offset - 1)] : null;
      return { cur, prev, secAgo: -((1 - hoverNorm) * timebase) };
    }
    const prevLatest =
      totalCount > 1 ? rb.frames[rb.getPhysicalIndex(totalCount - 2)] : null;
    return { cur: frame, prev: prevLatest, secAgo: null as number | null };
  }, [frame, hoverNorm, ringBufferRef, timebase]);

  const handleTrackMouseMove = (
    e: React.MouseEvent<HTMLCanvasElement>,
    hasRightAxis: boolean
  ) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const padLeft = 50;
    const padRight = hasRightAxis ? 48 : 14;
    const plotW = Math.max(1, rect.width - padLeft - padRight);
    const rel = (e.clientX - rect.left - padLeft) / plotW;
    if (rel >= 0 && rel <= 1) {
      setHoverNorm(rel);
    } else {
      setHoverNorm(null);
    }
  };

  const editingTrack = useMemo(
    () => tracks.find((t) => t.id === editingTrackId) ?? null,
    [tracks, editingTrackId]
  );

  const filteredSignals = useMemo(() => {
    const q = signalQuery.trim().toLowerCase();
    return VEHICLE_SIGNALS.filter((sig) => {
      if (subsystemFilter !== "all" && sig.subsystem !== subsystemFilter) return false;
      if (!q) return true;
      return (
        sig.label.toLowerCase().includes(q) ||
        sig.shortLabel.toLowerCase().includes(q) ||
        sig.id.toLowerCase().includes(q) ||
        sig.unit.toLowerCase().includes(q)
      );
    });
  }, [signalQuery, subsystemFilter]);

  return (
    <div className="machined-panel flex flex-col w-full h-full min-h-0 overflow-hidden relative">
      {/* Strict Single-Row Fixed Toolbar (h-[36px] flex-nowrap — NEVER wraps) */}
      <div className="h-[36px] shrink-0 flex items-center justify-between gap-2 px-3 bg-[#12151E] border-b border-[#222633] flex-nowrap overflow-hidden">
        <div className="flex items-center gap-2 min-w-0 flex-nowrap overflow-hidden">
          <span className="text-[12px] font-semibold text-[#ECEFF4] whitespace-nowrap shrink-0">
            Oscilloscopes
          </span>

          {/* Preset Selector */}
          <select
            aria-label="Oscilloscope channel preset"
            value={activePresetId}
            onChange={(e) => applyPreset(e.target.value)}
            className="h-[24px] max-w-[185px] px-2 rounded-[3px] bg-[#0B0D12] border border-[#222633] text-[11px] font-medium text-[#ECEFF4] outline-none focus:border-[#C5A059] cursor-pointer truncate"
          >
            {allPresets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>

          {/* Save Preset Trigger */}
          <button
            type="button"
            onClick={() => setSavingPresetMode((v) => !v)}
            title="Save current track layout as custom preset"
            className="h-[24px] px-1.5 rounded-[3px] bg-[#151820] border border-[#222633] text-[#94A3B8] hover:text-[#DFBE78] hover:border-[#C5A059]/50 flex items-center gap-1 text-[10.5px] shrink-0 cursor-pointer transition-colors"
          >
            <BookmarkPlus className="w-3.5 h-3.5" />
          </button>

          {/* Add Track Button (max 6) */}
          <button
            type="button"
            onClick={handleAddTrack}
            disabled={tracks.length >= 6}
            title="Add stacked oscilloscope track (2 to 6 lanes)"
            className="h-[24px] px-2 rounded-[3px] bg-[#151820] border border-[#222633] text-[10.5px] font-medium text-[#CBD5E1] hover:text-[#DFBE78] hover:border-[#C5A059]/50 disabled:opacity-35 disabled:cursor-not-allowed flex items-center gap-1 shrink-0 cursor-pointer transition-colors whitespace-nowrap"
          >
            <Plus className="w-3 h-3" />
            <span>Track ({tracks.length}/6)</span>
          </button>
        </div>

        <div className="flex items-center gap-1.5 shrink-0 flex-nowrap">
          {inspectedPair.secAgo !== null ? (
            <span className="font-mono text-[10.5px] text-[#DFBE78] tabular px-1.5 py-0.5 rounded-[3px] bg-[#C5A059]/12 border border-[#C5A059]/30 min-w-[6.5ch] text-right shrink-0">
              {inspectedPair.secAgo.toFixed(2)}s
            </span>
          ) : (
            <span className="font-mono text-[10px] text-[#64748B] tabular whitespace-nowrap shrink-0 hidden xl:inline">
              60 Hz · 88 ch
            </span>
          )}

          <div className="seg-track shrink-0" role="group" aria-label="Oscilloscope timebase">
            {TIMEBASES.map((tb) => (
              <button
                key={tb}
                type="button"
                data-active={timebase === tb ? "true" : "false"}
                onClick={() => setTimebase(tb)}
                className="seg-btn font-mono"
              >
                {tb}s
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setFrozen((f) => !f)}
            className={`flex items-center gap-1 h-[24px] px-2 text-[10.5px] font-medium rounded-[3px] border cursor-pointer shrink-0 transition-colors ${
              frozen
                ? "border-[#D97706]/50 bg-[#D97706]/15 text-[#FBBF24]"
                : "border-[#222633] bg-[#151820] text-[#E2E8F0] hover:border-[#C5A059]/50 hover:text-[#DFBE78]"
            }`}
          >
            {frozen ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
            <span>{frozen ? "Resume" : "Freeze"}</span>
          </button>
        </div>
      </div>

      {/* Optional inline Save Preset bar */}
      {savingPresetMode ? (
        <div className="h-[32px] shrink-0 flex items-center gap-2 px-3 bg-[#151820] border-b border-[#222633]">
          <span className="text-[11px] text-[#94A3B8] shrink-0">Preset Name:</span>
          <input
            type="text"
            value={newPresetName}
            onChange={(e) => setNewPresetName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSaveCustomPreset();
              if (e.key === "Escape") setSavingPresetMode(false);
            }}
            placeholder="e.g. FSG Endurance Thermal & TV"
            className="flex-1 h-[22px] px-2 rounded-[3px] bg-[#08090C] border border-[#222633] text-[11px] text-[#ECEFF4] outline-none focus:border-[#C5A059]"
            autoFocus
          />
          <button
            type="button"
            onClick={handleSaveCustomPreset}
            className="h-[22px] px-2.5 rounded-[3px] bg-[#C5A059] text-[#08090C] text-[10.5px] font-semibold cursor-pointer"
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => setSavingPresetMode(false)}
            className="h-[22px] px-1.5 rounded-[3px] text-[#94A3B8] hover:text-[#ECEFF4] cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : null}

      {/* Stacked Oscilloscope Tracks (2..6 flex-1 panes with ZERO-WRAP fixed 28px headers) */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden bg-[#08090C]">
        {tracks.map((track) => {
          const hasRightAxis = track.channels.some((c) => c.axis === "right");
          return (
            <div
              key={track.id}
              className="flex-1 min-h-0 flex flex-col border-b border-[#222633] last:border-b-0 overflow-hidden"
            >
              {/* Fixed-Height Zero-Wrap Track Header Bar (STRICT 28px, flex-nowrap, tabular fixed-width readouts) */}
              <div className="h-[28px] shrink-0 flex items-center justify-between gap-2 px-2.5 bg-[#10131B] border-b border-white/[0.04] flex-nowrap overflow-hidden">
                <div className="flex items-center gap-2 min-w-0 flex-1 flex-nowrap overflow-hidden">
                  <span
                    className="text-[11px] font-semibold text-[#CBD5E1] whitespace-nowrap truncate max-w-[160px] shrink-0"
                    title={track.title}
                  >
                    {track.title}
                  </span>

                  <div className="flex items-center gap-1 min-w-0 flex-nowrap overflow-hidden">
                    {track.channels.map((ch) => {
                      const def = SIGNAL_MAP[ch.signalId];
                      if (!def) return null;
                      const val = def.extract(
                        inspectedPair.cur,
                        inspectedPair.prev,
                        safetyOverlay
                      );
                      return (
                        <div
                          key={ch.signalId}
                          title={`${def.label} (${def.unit}) · ${ch.axis === "right" ? "Right" : "Left"} Y-Axis`}
                          className="shrink-0 h-[20px] px-1.5 rounded-[2px] bg-[#151820] border border-[#222633] flex items-center gap-1 flex-nowrap"
                        >
                          <span
                            className="inline-block w-2 h-[2px] shrink-0"
                            style={{
                              backgroundColor: ch.dashed ? "transparent" : ch.color,
                              borderTop: ch.dashed ? `2px dashed ${ch.color}` : undefined,
                            }}
                          />
                          <span className="text-[9.5px] font-mono text-[#64748B] shrink-0">
                            {ch.axis === "right" ? "R" : "L"}
                          </span>
                          <span className="text-[10px] font-medium text-[#94A3B8] whitespace-nowrap shrink-0">
                            {def.shortLabel}
                          </span>
                          {/* Fixed-width tabular monospace slot prevents width jitter & wrapping */}
                          <span
                            className={`inline-block min-w-[7.5ch] text-right font-mono text-[10.5px] font-medium tabular shrink-0 ${
                              inspectedPair.secAgo !== null ? "text-[#DFBE78]" : "text-[#ECEFF4]"
                            }`}
                          >
                            {formatSignalReadout(val, def.decimals)}
                          </span>
                          <span className="text-[9.5px] font-mono text-[#64748B] whitespace-nowrap shrink-0">
                            {def.unit}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Track Actions (Always pinned right, shrink-0) */}
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      setSignalQuery("");
                      setSubsystemFilter("all");
                      setEditingTrackId(track.id);
                    }}
                    className="h-[20px] px-1.5 rounded-[2px] bg-[#151820] border border-[#222633] text-[10px] font-medium text-[#CBD5E1] hover:border-[#C5A059]/60 hover:text-[#DFBE78] flex items-center gap-1 cursor-pointer transition-colors whitespace-nowrap"
                  >
                    <SlidersHorizontal className="w-2.5 h-2.5" />
                    <span>Signals</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRemoveTrack(track.id)}
                    disabled={tracks.length <= 2}
                    title="Remove oscilloscope track"
                    className="h-[20px] w-[20px] rounded-[2px] bg-[#151820] border border-[#222633] text-[#64748B] hover:text-[#F87171] hover:border-[#DC2626]/40 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center cursor-pointer transition-colors"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              </div>

              {/* Per-Track High-DPI Canvas */}
              <div className="flex-1 min-h-0 w-full relative overflow-hidden">
                <canvas
                  ref={(el) => registerCanvas(track.id, el)}
                  onMouseMove={(e) => handleTrackMouseMove(e, hasRightAxis)}
                  onMouseLeave={() => setHoverNorm(null)}
                  className="block w-full h-full cursor-crosshair"
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Synchronized Bottom Timebase Ruler */}
      <div className="h-[22px] shrink-0 flex items-center justify-between pl-[50px] pr-[14px] bg-[#0F1116] border-t border-[#222633] font-mono text-[10px] text-[#64748B] tabular select-none">
        {[0, 1, 2, 3, 4, 5].map((g) => {
          const secAgo = -Math.round((timebase * (5 - g)) / 5);
          return <span key={g}>{g === 5 ? "Now (0s)" : `${secAgo}s`}</span>;
        })}
      </div>

      {/* Universal Vehicle Signal Selector Modal (88 Signals across 7 Subsystems) */}
      {editingTrack ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setEditingTrackId(null);
          }}
        >
          <div className="w-[860px] max-w-[95vw] h-[580px] max-h-[88vh] bg-[#0F1116] border border-[#222633] rounded-[4px] flex flex-col overflow-hidden">
            {/* Modal Header */}
            <div className="h-[40px] shrink-0 px-4 bg-[#151820] border-b border-[#222633] flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <SlidersHorizontal className="w-4 h-4 text-[#C5A059] shrink-0" />
                <span className="text-[12.5px] font-semibold text-[#ECEFF4] whitespace-nowrap">
                  Configure Track Signals
                </span>
                <span className="text-[11px] font-mono text-[#7E8899] whitespace-nowrap">
                  {VEHICLE_SIGNALS.length} vehicle channels indexed
                </span>
              </div>
              <button
                type="button"
                onClick={() => setEditingTrackId(null)}
                className="h-[26px] px-2.5 rounded-[3px] bg-[#1B1F2A] border border-[#222633] text-[11px] font-medium text-[#ECEFF4] hover:border-[#C5A059] cursor-pointer"
              >
                Done
              </button>
            </div>

            {/* Modal Split Body */}
            <div className="flex-1 min-h-0 grid grid-cols-12 overflow-hidden">
              {/* Left 7 cols: Searchable Subsystem Tree */}
              <div className="col-span-7 flex flex-col min-h-0 border-r border-[#222633]">
                <div className="p-2.5 bg-[#12151E] border-b border-[#222633] space-y-2">
                  <div className="flex items-center gap-2 px-2.5 h-[30px] rounded-[3px] bg-[#08090C] border border-[#222633] focus-within:border-[#C5A059]">
                    <Search className="w-3.5 h-3.5 text-[#7E8899] shrink-0" />
                    <input
                      type="text"
                      value={signalQuery}
                      onChange={(e) => setSignalQuery(e.target.value)}
                      placeholder="Filter 88 signals (e.g. camber, slip, Fz, EKF, APPS, torque, V_pack)..."
                      className="w-full bg-transparent text-[11.5px] text-[#ECEFF4] outline-none placeholder:text-[#64748B]"
                      autoFocus
                    />
                    {signalQuery ? (
                      <button
                        type="button"
                        onClick={() => setSignalQuery("")}
                        className="text-[#64748B] hover:text-[#ECEFF4] cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    ) : null}
                  </div>

                  {/* Subsystem Filter Strip */}
                  <div className="flex items-center gap-1 flex-wrap">
                    <button
                      type="button"
                      onClick={() => setSubsystemFilter("all")}
                      className={`px-2 py-0.5 rounded-[2px] text-[10px] font-medium border cursor-pointer transition-colors ${
                        subsystemFilter === "all"
                          ? "bg-[#C5A059]/18 border-[#C5A059]/60 text-[#DFBE78]"
                          : "bg-[#151820] border-[#222633] text-[#94A3B8] hover:text-[#ECEFF4]"
                      }`}
                    >
                      All ({VEHICLE_SIGNALS.length})
                    </button>
                    {SIGNAL_SUBSYSTEMS.map((sub) => (
                      <button
                        key={sub.id}
                        type="button"
                        onClick={() => setSubsystemFilter(sub.id)}
                        className={`px-2 py-0.5 rounded-[2px] text-[10px] font-medium border cursor-pointer transition-colors ${
                          subsystemFilter === sub.id
                            ? "bg-[#C5A059]/18 border-[#C5A059]/60 text-[#DFBE78]"
                            : "bg-[#151820] border-[#222633] text-[#94A3B8] hover:text-[#ECEFF4]"
                        }`}
                      >
                        {sub.label.split(" ")[0]}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Grouped Signal List */}
                <div className="flex-1 min-h-0 overflow-y-auto p-2.5 space-y-3 bg-[#0B0D12]">
                  {SIGNAL_SUBSYSTEMS.map((sub) => {
                    const items = filteredSignals.filter((s) => s.subsystem === sub.id);
                    if (items.length === 0) return null;
                    return (
                      <div key={sub.id} className="space-y-1">
                        <div className="text-[10.5px] font-semibold text-[#C5A059] px-1.5 py-0.5 border-b border-[#222633]">
                          {sub.label}
                        </div>
                        <div className="space-y-0.5">
                          {items.map((sig) => {
                            const bound = editingTrack.channels.some(
                              (c) => c.signalId === sig.id
                            );
                            const liveVal = sig.extract(frame, null, safetyOverlay);
                            return (
                              <button
                                key={sig.id}
                                type="button"
                                onClick={() => toggleSignalOnTrack(editingTrack.id, sig.id)}
                                className={`w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-[3px] text-left border cursor-pointer transition-colors ${
                                  bound
                                    ? "bg-[#181C26] border-[#C5A059]/50 text-[#ECEFF4]"
                                    : "bg-transparent border-transparent hover:bg-[#151820] text-[#CBD5E1]"
                                }`}
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  <span
                                    className={`w-3.5 h-3.5 rounded-[2px] border flex items-center justify-center text-[9px] font-mono shrink-0 ${
                                      bound
                                        ? "bg-[#C5A059] border-[#C5A059] text-[#08090C] font-bold"
                                        : "border-[#333A4D] bg-[#08090C]"
                                    }`}
                                  >
                                    {bound ? "✓" : ""}
                                  </span>
                                  <span className="text-[11.5px] truncate">{sig.label}</span>
                                </div>
                                <div className="flex items-center gap-2 shrink-0 font-mono text-[10.5px] tabular">
                                  <span className="text-[#ECEFF4] min-w-[6.5ch] text-right">
                                    {formatSignalReadout(liveVal, sig.decimals)}
                                  </span>
                                  <span className="text-[#7E8899] w-[38px] text-right">
                                    {sig.unit}
                                  </span>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Right 5 cols: Active Track Bindings & Dual Y-Axis Assignment */}
              <div className="col-span-5 flex flex-col min-h-0 bg-[#0F1116]">
                <div className="p-3 border-b border-[#222633] space-y-1.5">
                  <label className="text-[10.5px] font-medium text-[#7E8899] block">
                    Track Header Title
                  </label>
                  <input
                    type="text"
                    value={editingTrack.title}
                    onChange={(e) => updateTrackTitle(editingTrack.id, e.target.value)}
                    className="w-full h-[28px] px-2.5 rounded-[3px] bg-[#08090C] border border-[#222633] text-[12px] text-[#ECEFF4] outline-none focus:border-[#C5A059]"
                  />
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2">
                  <div className="flex items-center justify-between text-[10.5px] text-[#7E8899]">
                    <span>Bound Channels ({editingTrack.channels.length})</span>
                    <span>Assign Independent L / R Y-Axis</span>
                  </div>

                  {editingTrack.channels.length === 0 ? (
                    <div className="p-6 text-center text-[11.5px] text-[#64748B] border border-dashed border-[#222633] rounded-[3px]">
                      Select any signals from the left catalog to plot on this track.
                    </div>
                  ) : (
                    editingTrack.channels.map((ch) => {
                      const def = SIGNAL_MAP[ch.signalId];
                      if (!def) return null;
                      return (
                        <div
                          key={ch.signalId}
                          className="p-2.5 rounded-[3px] bg-[#151820] border border-[#222633] space-y-2"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <div className="text-[11.5px] font-medium text-[#ECEFF4] truncate">
                                {def.label}
                              </div>
                              <div className="text-[10px] font-mono text-[#7E8899]">
                                {def.shortLabel} · [{def.unit}]
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => toggleSignalOnTrack(editingTrack.id, ch.signalId)}
                              className="p-1 text-[#64748B] hover:text-[#EF4444] cursor-pointer"
                              title="Remove channel"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>

                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            {/* Independent Left / Right Y-Axis Toggle */}
                            <div className="flex items-center rounded-[2px] border border-[#222633] overflow-hidden">
                              {(["left", "right"] as const).map((ax) => (
                                <button
                                  key={ax}
                                  type="button"
                                  onClick={() =>
                                    updateChannelBinding(editingTrack.id, ch.signalId, {
                                      axis: ax,
                                    })
                                  }
                                  className={`px-2 py-0.5 text-[10px] font-mono cursor-pointer transition-colors ${
                                    ch.axis === ax
                                      ? "bg-[#C5A059] text-[#08090C] font-semibold"
                                      : "bg-[#0B0D12] text-[#94A3B8] hover:text-[#ECEFF4]"
                                  }`}
                                >
                                  {ax === "left" ? "Left Y" : "Right Y"}
                                </button>
                              ))}
                            </div>

                            {/* Style toggles: Dashed / Fill */}
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() =>
                                  updateChannelBinding(editingTrack.id, ch.signalId, {
                                    dashed: !ch.dashed,
                                  })
                                }
                                className={`px-1.5 py-0.5 rounded-[2px] text-[10px] border cursor-pointer ${
                                  ch.dashed
                                    ? "bg-[#1B1F2A] border-[#C5A059]/60 text-[#DFBE78]"
                                    : "bg-[#0B0D12] border-[#222633] text-[#7E8899]"
                                }`}
                              >
                                Dash
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  updateChannelBinding(editingTrack.id, ch.signalId, {
                                    fill: !ch.fill,
                                  })
                                }
                                className={`px-1.5 py-0.5 rounded-[2px] text-[10px] border cursor-pointer ${
                                  ch.fill
                                    ? "bg-[#1B1F2A] border-[#C5A059]/60 text-[#DFBE78]"
                                    : "bg-[#0B0D12] border-[#222633] text-[#7E8899]"
                                }`}
                              >
                                Fill
                              </button>
                            </div>

                            {/* Color Swatch Picker */}
                            <div className="flex items-center gap-1">
                              {COLOR_SWATCHES.slice(0, 6).map((col) => (
                                <button
                                  key={col}
                                  type="button"
                                  onClick={() =>
                                    updateChannelBinding(editingTrack.id, ch.signalId, {
                                      color: col,
                                    })
                                  }
                                  className={`w-3.5 h-3.5 rounded-[2px] cursor-pointer border ${
                                    ch.color === col ? "border-white scale-110" : "border-black/40"
                                  }`}
                                  style={{ backgroundColor: col }}
                                  aria-label={`Set trace color ${col}`}
                                />
                              ))}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
