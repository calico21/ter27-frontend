import React, { useEffect, useMemo, useRef, useState } from "react";

export interface ChartPoint {
  x: number;
  y: number;
}

export interface CanvasSeries {
  id: string;
  label: string;
  shortLabel?: string;
  unit?: string;
  color: string;
  points: ChartPoint[];
  axis?: "left" | "right";
  dashed?: boolean;
  fill?: boolean;
  lineWidth?: number;
  mode?: "line" | "scatter";
  pointRadius?: number;
  decimals?: number;
}

export interface CanvasReferenceLine {
  axis: "x" | "y" | "yRight";
  value: number;
  color: string;
  label?: string;
  dashed?: boolean;
}

export interface CanvasShadedBand {
  axis: "y" | "x";
  from: number;
  to: number;
  color: string;
  label?: string;
}

export interface TelemetryCanvasChartProps {
  title: string;
  subtitle?: string;
  xLabel?: string;
  yLabel?: string;
  yRightLabel?: string;
  series: CanvasSeries[];
  referenceLines?: CanvasReferenceLine[];
  bands?: CanvasShadedBand[];
  xDomain?: [number, number];
  yDomain?: [number, number];
  yRightDomain?: [number, number];
  highlightPeakOnPrimary?: boolean;
  peakUnit?: string;
  headerRight?: React.ReactNode;
  footerNote?: string;
  activeCursorX?: number | null;
  onHoverX?: (x: number | null) => void;
}

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace("#", "");
  if (clean.length !== 6) return `rgba(197, 160, 89, ${alpha})`;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function fmtTick(v: number): string {
  if (Math.abs(v) < 1e-4) return "0";
  if (Math.abs(v) >= 100) return v.toFixed(0);
  if (Math.abs(v) >= 10) return v.toFixed(1);
  return v.toFixed(2);
}

function findNearestPoint(points: ChartPoint[], targetX: number): ChartPoint | null {
  if (points.length === 0) return null;
  let best = points[0];
  let bestDist = Math.abs(points[0].x - targetX);
  for (let i = 1; i < points.length; i++) {
    const d = Math.abs(points[i].x - targetX);
    if (d < bestDist) {
      bestDist = d;
      best = points[i];
    }
  }
  return best;
}

/**
 * Unified High-DPI HTML5 Canvas Chart Engine matching Pitwall Live aesthetic:
 * matte-carbon well (#08090C), subtle dashed gridlines, anti-aliased 1.75px-2.0px curves
 * with subtle vertical gradient under-fills, dual Y-axis support, interactive hover crosshair,
 * and fixed-height 28px zero-wrap instrument header with fixed-width tabular readouts.
 */
export function TelemetryCanvasChart({
  title,
  subtitle,
  xLabel,
  yLabel,
  yRightLabel,
  series,
  referenceLines = [],
  bands = [],
  xDomain,
  yDomain,
  yRightDomain,
  highlightPeakOnPrimary = false,
  peakUnit = "",
  headerRight,
  footerNote,
  activeCursorX = null,
  onHoverX,
}: TelemetryCanvasChartProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [hoverX, setHoverX] = useState<number | null>(null);
  const [hoverPx, setHoverPx] = useState<{ x: number; w: number } | null>(null);

  const hasRightAxis = useMemo(
    () =>
      series.some((s) => s.axis === "right") ||
      referenceLines.some((r) => r.axis === "yRight") ||
      Boolean(yRightDomain),
    [referenceLines, series, yRightDomain]
  );

  // Compute chart domains cleanly
  const domains = useMemo(() => {
    let minX = Infinity;
    let maxX = -Infinity;
    let minYL = Infinity;
    let maxYL = -Infinity;
    let minYR = Infinity;
    let maxYR = -Infinity;

    for (const s of series) {
      for (const p of s.points) {
        if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (s.axis === "right") {
          if (p.y < minYR) minYR = p.y;
          if (p.y > maxYR) maxYR = p.y;
        } else {
          if (p.y < minYL) minYL = p.y;
          if (p.y > maxYL) maxYL = p.y;
        }
      }
    }

    if (!Number.isFinite(minX)) {
      minX = 0;
      maxX = 1;
    }
    if (!Number.isFinite(minYL)) {
      minYL = 0;
      maxYL = 1;
    }
    if (!Number.isFinite(minYR)) {
      minYR = 0;
      maxYR = 1;
    }

    const padL = Math.max(1e-3, (maxYL - minYL) * 0.13);
    const padR = Math.max(1e-3, (maxYR - minYR) * 0.13);

    return {
      x: xDomain ?? ([minX, maxX] as [number, number]),
      yL: yDomain ?? ([minYL - padL, maxYL + padL] as [number, number]),
      yR: yRightDomain ?? ([minYR - padR, maxYR + padR] as [number, number]),
    };
  }, [series, xDomain, yDomain, yRightDomain]);

  const effectiveCursorX = hoverX !== null ? hoverX : activeCursorX;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const render = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = parent.clientWidth;
      const h = parent.clientHeight;
      if (w < 40 || h < 40) return;

      if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
        canvas.width = Math.floor(w * dpr);
        canvas.height = Math.floor(h * dpr);
      }

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.save();
      ctx.scale(dpr, dpr);

      // Matte-carbon well
      ctx.fillStyle = "#08090C";
      ctx.fillRect(0, 0, w, h);

      const padL = 48;
      const padR = hasRightAxis ? 46 : 14;
      const padT = 10;
      const padB = 22;
      const pw = Math.max(20, w - padL - padR);
      const ph = Math.max(20, h - padT - padB);

      const [minX, maxX] = domains.x;
      const [minYL, maxYL] = domains.yL;
      const [minYR, maxYR] = domains.yR;

      const xOf = (x: number) => padL + ((x - minX) / Math.max(1e-6, maxX - minX)) * pw;
      const yLOf = (y: number) => padT + ph - ((y - minYL) / Math.max(1e-6, maxYL - minYL)) * ph;
      const yROf = (y: number) => padT + ph - ((y - minYR) / Math.max(1e-6, maxYR - minYR)) * ph;

      // Shaded reference bands
      for (const band of bands) {
        ctx.save();
        ctx.fillStyle = band.color;
        if (band.axis === "y") {
          const y1 = Math.max(padT, Math.min(padT + ph, yLOf(band.to)));
          const y2 = Math.max(padT, Math.min(padT + ph, yLOf(band.from)));
          ctx.fillRect(padL, y1, pw, Math.max(1, y2 - y1));
          if (band.label) {
            ctx.font = '9.5px "JetBrains Mono", monospace';
            ctx.fillStyle = "rgba(236, 239, 244, 0.55)";
            ctx.textAlign = "right";
            ctx.fillText(band.label, padL + pw - 5, y1 + 11);
          }
        } else {
          const x1 = Math.max(padL, Math.min(padL + pw, xOf(band.from)));
          const x2 = Math.max(padL, Math.min(padL + pw, xOf(band.to)));
          ctx.fillRect(x1, padT, Math.max(1, x2 - x1), ph);
        }
        ctx.restore();
      }

      // Subtle dashed horizontal gridlines
      ctx.font = '9.5px "JetBrains Mono", monospace';
      ctx.textBaseline = "middle";
      for (let i = 0; i <= 4; i++) {
        const yv = minYL + ((maxYL - minYL) * i) / 4;
        const py = yLOf(yv);
        ctx.save();
        ctx.strokeStyle = "rgba(255, 255, 255, 0.045)";
        ctx.setLineDash([3, 4]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(padL, Math.round(py) + 0.5);
        ctx.lineTo(padL + pw, Math.round(py) + 0.5);
        ctx.stroke();
        ctx.restore();

        ctx.fillStyle = "#64748B";
        ctx.textAlign = "right";
        ctx.fillText(fmtTick(yv), padL - 6, py);
      }

      // Subtle dashed vertical gridlines + X axis ticks
      for (let i = 0; i <= 4; i++) {
        const xv = minX + ((maxX - minX) * i) / 4;
        const px = xOf(xv);
        if (i > 0 && i < 4) {
          ctx.save();
          ctx.strokeStyle = "rgba(255, 255, 255, 0.035)";
          ctx.setLineDash([2, 5]);
          ctx.beginPath();
          ctx.moveTo(Math.round(px) + 0.5, padT);
          ctx.lineTo(Math.round(px) + 0.5, padT + ph);
          ctx.stroke();
          ctx.restore();
        }
        ctx.fillStyle = "#64748B";
        ctx.textAlign = i === 0 ? "left" : i === 4 ? "right" : "center";
        ctx.fillText(fmtTick(xv), px, h - 8);
      }

      // Right Y-axis ticks
      if (hasRightAxis) {
        const rightColor = series.find((s) => s.axis === "right")?.color ?? "#38BDF8";
        ctx.fillStyle = hexToRgba(rightColor, 0.8);
        ctx.textAlign = "left";
        for (let i = 0; i <= 4; i += 2) {
          const yv = minYR + ((maxYR - minYR) * i) / 4;
          ctx.fillText(fmtTick(yv), padL + pw + 6, yROf(yv));
        }
      }

      // Zero axes
      if (minX < 0 && maxX > 0) {
        const zx = xOf(0);
        ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(Math.round(zx) + 0.5, padT);
        ctx.lineTo(Math.round(zx) + 0.5, padT + ph);
        ctx.stroke();
      }
      if (minYL < 0 && maxYL > 0) {
        const zy = yLOf(0);
        ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(padL, Math.round(zy) + 0.5);
        ctx.lineTo(padL + pw, Math.round(zy) + 0.5);
        ctx.stroke();
      }

      // Reference lines
      for (const ref of referenceLines) {
        ctx.save();
        ctx.strokeStyle = ref.color;
        ctx.lineWidth = 1.1;
        if (ref.dashed !== false) ctx.setLineDash([4, 3]);
        ctx.beginPath();
        if (ref.axis === "x") {
          const rx = xOf(ref.value);
          if (rx >= padL && rx <= padL + pw) {
            ctx.moveTo(Math.round(rx) + 0.5, padT);
            ctx.lineTo(Math.round(rx) + 0.5, padT + ph);
            ctx.stroke();
            if (ref.label) {
              ctx.fillStyle = ref.color;
              ctx.textAlign = "left";
              ctx.fillText(ref.label, Math.min(padL + pw - 60, rx + 4), padT + 9);
            }
          }
        } else {
          const ry = ref.axis === "yRight" ? yROf(ref.value) : yLOf(ref.value);
          if (ry >= padT && ry <= padT + ph) {
            ctx.moveTo(padL, Math.round(ry) + 0.5);
            ctx.lineTo(padL + pw, Math.round(ry) + 0.5);
            ctx.stroke();
            if (ref.label) {
              ctx.fillStyle = ref.color;
              ctx.textAlign = "left";
              ctx.fillText(ref.label, padL + 6, Math.max(padT + 9, ry - 7));
            }
          }
        }
        ctx.restore();
      }

      // Plot series
      for (const s of series) {
        if (s.points.length === 0) continue;
        const yFn = s.axis === "right" ? yROf : yLOf;

        if (s.mode === "scatter") {
          ctx.save();
          ctx.fillStyle = s.color;
          const r = s.pointRadius ?? 2.2;
          for (const pt of s.points) {
            const px = xOf(pt.x);
            const py = yFn(pt.y);
            if (px < padL - 2 || px > padL + pw + 2 || py < padT - 2 || py > padT + ph + 2) continue;
            ctx.beginPath();
            ctx.arc(px, py, r, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.restore();
          continue;
        }

        if (s.points.length < 2) continue;

        if (s.fill) {
          ctx.save();
          const baseY =
            s.axis === "right"
              ? minYR < 0 && maxYR > 0
                ? yROf(0)
                : padT + ph
              : minYL < 0 && maxYL > 0
                ? yLOf(0)
                : padT + ph;
          const grad = ctx.createLinearGradient(0, padT, 0, padT + ph);
          grad.addColorStop(0, hexToRgba(s.color, 0.16));
          grad.addColorStop(0.55, hexToRgba(s.color, 0.025));
          grad.addColorStop(1, hexToRgba(s.color, 0.09));
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.moveTo(xOf(s.points[0].x), baseY);
          for (const pt of s.points) {
            ctx.lineTo(xOf(pt.x), yFn(pt.y));
          }
          ctx.lineTo(xOf(s.points[s.points.length - 1].x), baseY);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }

        ctx.save();
        ctx.strokeStyle = s.color;
        ctx.lineWidth = s.lineWidth ?? (s.fill ? 1.9 : 1.65);
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        if (s.dashed) ctx.setLineDash([5, 4]);
        ctx.beginPath();
        s.points.forEach((pt, idx) => {
          const px = xOf(pt.x);
          const py = yFn(pt.y);
          if (idx === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        });
        ctx.stroke();
        ctx.restore();
      }

      // Peak marker on primary line series
      const primaryLine = series.find((s) => s.mode !== "scatter" && s.points.length > 2);
      if (highlightPeakOnPrimary && primaryLine) {
        let best = primaryLine.points[0];
        for (const pt of primaryLine.points) {
          if (pt.y > best.y) best = pt;
        }
        const bx = xOf(best.x);
        const by = (primaryLine.axis === "right" ? yROf : yLOf)(best.y);
        ctx.save();
        ctx.strokeStyle = primaryLine.color;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(bx, by, 4.8, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = "#ECEFF4";
        ctx.beginPath();
        ctx.arc(bx, by, 2.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.font = '9.5px "JetBrains Mono", monospace';
        ctx.fillStyle = "#DFBE78";
        ctx.textAlign = bx > padL + pw * 0.72 ? "right" : "left";
        ctx.fillText(
          `Peak ${best.y.toFixed(Math.abs(best.y) >= 100 ? 0 : 1)}${peakUnit ? ` ${peakUnit}` : ""}`,
          bx > padL + pw * 0.72 ? bx - 8 : bx + 8,
          Math.max(padT + 10, by - 7)
        );
        ctx.restore();
      }

      // Active / Hover vertical crosshair
      if (effectiveCursorX !== null && effectiveCursorX >= minX && effectiveCursorX <= maxX) {
        const cx = xOf(effectiveCursorX);
        ctx.save();
        ctx.strokeStyle = "rgba(197, 160, 89, 0.78)";
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(Math.round(cx) + 0.5, padT);
        ctx.lineTo(Math.round(cx) + 0.5, padT + ph);
        ctx.stroke();
        ctx.restore();

        for (const s of series) {
          if (s.mode === "scatter" || s.points.length === 0) continue;
          const pt = findNearestPoint(s.points, effectiveCursorX);
          if (!pt) continue;
          const py = (s.axis === "right" ? yROf : yLOf)(pt.y);
          ctx.fillStyle = s.color;
          ctx.beginPath();
          ctx.arc(xOf(pt.x), py, 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Subtle footer axis labels
      if (xLabel || yLabel || yRightLabel) {
        ctx.font = '9px "JetBrains Mono", monospace';
        ctx.fillStyle = "#475569";
        if (xLabel) {
          ctx.textAlign = "center";
          ctx.fillText(xLabel, padL + pw / 2, h - 8);
        }
      }

      ctx.restore();
    };

    render();
    const ro = new ResizeObserver(render);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [
    bands,
    domains,
    effectiveCursorX,
    hasRightAxis,
    highlightPeakOnPrimary,
    peakUnit,
    referenceLines,
    series,
    xLabel,
    yLabel,
    yRightLabel,
  ]);

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const padL = 48;
    const padR = hasRightAxis ? 46 : 14;
    const pw = Math.max(1, rect.width - padL - padR);
    const rel = (e.clientX - rect.left - padL) / pw;
    if (rel >= 0 && rel <= 1) {
      const [minX, maxX] = domains.x;
      const valX = minX + rel * (maxX - minX);
      setHoverX(valX);
      setHoverPx({ x: e.clientX - rect.left, w: rect.width });
      onHoverX?.(valX);
    } else {
      setHoverX(null);
      setHoverPx(null);
      onHoverX?.(null);
    }
  };

  // Inline header live/cursor readouts for up to 3 primary line series
  const headerSeries = useMemo(
    () => series.filter((s) => s.mode !== "scatter").slice(0, 3),
    [series]
  );

  return (
    <div className="machined-panel flex flex-col w-full h-full min-h-0 overflow-hidden">
      <div className="inst-header">
        <div className="flex items-center gap-2 min-w-0 flex-1 overflow-hidden">
          <span className="panel-title-label truncate">{title}</span>
          {subtitle ? (
            <span className="text-[10px] font-mono text-[#7E8899] truncate hidden xl:inline">
              {subtitle}
            </span>
          ) : null}
        </div>

        <div className="flex items-center gap-1.5 shrink-0 flex-nowrap">
          {headerSeries.map((s) => {
            const pt =
              effectiveCursorX !== null
                ? findNearestPoint(s.points, effectiveCursorX)
                : s.points[s.points.length - 1] ?? null;
            const dec = s.decimals ?? (pt && Math.abs(pt.y) >= 100 ? 0 : 1);
            return (
              <div
                key={s.id}
                className="h-[20px] px-1.5 rounded-[2px] bg-[#151820] border border-[#222633] flex items-center gap-1 shrink-0"
              >
                <span
                  className="inline-block w-2 h-[2px] shrink-0"
                  style={{
                    backgroundColor: s.dashed ? "transparent" : s.color,
                    borderTop: s.dashed ? `2px dashed ${s.color}` : undefined,
                  }}
                />
                <span className="text-[9.5px] text-[#94A3B8] whitespace-nowrap">
                  {s.shortLabel ?? s.label}
                </span>
                {pt ? (
                  <span className="inline-block min-w-[6ch] text-right font-mono text-[10px] text-[#ECEFF4] tabular">
                    {pt.y.toFixed(dec)}
                  </span>
                ) : null}
              </div>
            );
          })}
          {headerRight}
        </div>
      </div>

      <div className="flex-1 min-h-0 relative overflow-hidden bg-[#08090C]">
        <canvas
          ref={canvasRef}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => {
            setHoverX(null);
            setHoverPx(null);
            onHoverX?.(null);
          }}
          className="block w-full h-full cursor-crosshair"
        />

        {/* Floating Dark-Elevated Hover Tooltip */}
        {hoverX !== null && hoverPx ? (
          <div
            className="pointer-events-none absolute top-2 z-20 min-w-[148px] max-w-[205px] rounded-[3px] bg-[#0F1116]/95 border border-[#2A3040] px-2.5 py-1.5 shadow-[0_8px_20px_rgba(0,0,0,0.6)]"
            style={{
              left:
                hoverPx.x + 175 > hoverPx.w
                  ? Math.max(52, hoverPx.x - 166)
                  : hoverPx.x + 12,
            }}
          >
            <div className="flex items-center justify-between gap-2 pb-1 mb-1 border-b border-[#222633] font-mono text-[9.5px]">
              <span className="text-[#7E8899]">{xLabel ?? "x"}</span>
              <span className="text-[#DFBE78] tabular">{hoverX.toFixed(2)}</span>
            </div>
            <div className="space-y-0.5">
              {series
                .filter((s) => s.mode !== "scatter")
                .slice(0, 5)
                .map((s) => {
                  const pt = findNearestPoint(s.points, hoverX);
                  if (!pt) return null;
                  const dec = s.decimals ?? (Math.abs(pt.y) >= 100 ? 0 : 2);
                  return (
                    <div
                      key={s.id}
                      className="flex items-center justify-between gap-2 font-mono text-[10px] tabular"
                    >
                      <span className="flex items-center gap-1.5 text-[#CBD5E1] truncate">
                        <span
                          className="w-1.5 h-1.5 rounded-full shrink-0"
                          style={{ backgroundColor: s.color }}
                        />
                        {s.shortLabel ?? s.label}
                      </span>
                      <span className="text-[#ECEFF4]">
                        {pt.y.toFixed(dec)}
                        {s.unit ? ` ${s.unit}` : ""}
                      </span>
                    </div>
                  );
                })}
            </div>
          </div>
        ) : null}
      </div>

      {footerNote ? (
        <div className="h-[22px] shrink-0 px-2.5 flex items-center justify-between bg-[#0F1116] border-t border-[#222633] font-mono text-[9.5px] text-[#7E8899] truncate">
          <span className="truncate">{footerNote}</span>
          {yLabel ? (
            <span className="shrink-0 ml-2">
              L: {yLabel}
              {yRightLabel ? ` · R: ${yRightLabel}` : ""}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
