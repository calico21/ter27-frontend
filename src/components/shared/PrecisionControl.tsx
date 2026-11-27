import React from "react";

export interface PrecisionControlProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  decimals?: number;
  disabled?: boolean;
  accent?: string;
  onChange: (value: number) => void;
}

/**
 * Compact 30px machined parameter row matching Pitwall Live industrial ergonomics.
 * Left: parameter label, Center: thin brushed-gold track slider, Right: direct editable tabular monospace pill.
 */
export function PrecisionControl({
  label,
  value,
  min,
  max,
  step = 1,
  unit = "",
  decimals,
  disabled = false,
  accent = "#C5A059",
  onChange,
}: PrecisionControlProps) {
  const clamped = Math.max(min, Math.min(max, value));
  const pct = max > min ? ((clamped - min) / (max - min)) * 100 : 0;
  const resolvedDecimals =
    decimals !== undefined ? decimals : step < 0.1 ? 2 : step < 1 ? 1 : 0;

  return (
    <div
      className={`h-[30px] flex items-center gap-2 px-2 rounded-[3px] bg-[#141720] border border-[#222633] transition-colors ${
        disabled ? "opacity-45 pointer-events-none" : "hover:border-[#2E3446]"
      }`}
    >
      <span
        className="text-[10.5px] font-medium text-[#CBD5E1] whitespace-nowrap truncate w-[94px] shrink-0"
        title={label}
      >
        {label}
      </span>

      <div className="flex-1 min-w-[44px] flex items-center">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          value={clamped}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="eng-slider"
          style={{
            height: "3px",
            background: `linear-gradient(to right, ${accent} ${pct}%, #222633 ${pct}%)`,
          }}
        />
      </div>

      <div className="flex items-center gap-1 shrink-0">
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          value={Number(clamped.toFixed(resolvedDecimals))}
          onChange={(e) => {
            const parsed = parseFloat(e.target.value);
            if (!Number.isNaN(parsed)) {
              onChange(Math.max(min, Math.min(max, parsed)));
            }
          }}
          className="w-[52px] h-[21px] px-1.5 rounded-[2px] bg-[#08090C] border border-[#222633] text-right font-mono text-[10.5px] font-medium text-[#ECEFF4] tabular outline-none focus:border-[#C5A059]"
        />
        {unit ? (
          <span className="font-mono text-[9.5px] text-[#7E8899] w-[26px] text-left truncate shrink-0">
            {unit}
          </span>
        ) : null}
      </div>
    </div>
  );
}

export interface InstrumentHeaderProps {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}

export function InstrumentHeader({ title, subtitle, right }: InstrumentHeaderProps) {
  return (
    <div className="inst-header">
      <div className="flex items-center gap-2 min-w-0 overflow-hidden">
        <span className="panel-title-label truncate">{title}</span>
        {subtitle ? (
          <span className="text-[10px] font-mono text-[#7E8899] truncate hidden sm:inline">
            · {subtitle}
          </span>
        ) : null}
      </div>
      {right ? <div className="flex items-center gap-1.5 shrink-0">{right}</div> : null}
    </div>
  );
}
