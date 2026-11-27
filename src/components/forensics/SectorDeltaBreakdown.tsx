import React, { useMemo, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import type { TrajectorySample } from "../../types";
import { InstrumentHeader } from "../shared/PrecisionControl";

export interface SectorMetricRow {
  id: number;
  name: string;
  phase: "Braking" | "Entry" | "Apex" | "Exit";
  sStartM: number;
  sEndM: number;
  apexSpeedADriverKmh: number;
  apexSpeedBRefKmh: number;
  apexSpeedDeltaKmh: number;
  peakAyG: number;
  deltaTimeS: number;
}

interface SectorDeltaBreakdownProps {
  driverTrace: TrajectorySample[];
  refTrace: TrajectorySample[];
  onSelectSectorRange: (sStart: number, sEnd: number) => void;
  headerRight?: React.ReactNode;
}

type SortKey = "id" | "phase" | "apexSpeedDeltaKmh" | "peakAyG" | "deltaTimeS";

export function computeSectorBreakdown(
  driverTrace: TrajectorySample[],
  refTrace: TrajectorySample[]
): SectorMetricRow[] {
  if (driverTrace.length < 16) return [];

  const nSectors = 8;
  const maxS = driverTrace[driverTrace.length - 1].s_m;
  const sectorLen = maxS / nSectors;
  const rows: SectorMetricRow[] = [];

  for (let i = 0; i < nSectors; i++) {
    const sStart = i * sectorLen;
    const sEnd = (i + 1) * sectorLen;
    const segA = driverTrace.filter((p) => p.s_m >= sStart && p.s_m <= sEnd);
    const segB = refTrace.filter((p) => p.s_m >= sStart && p.s_m <= sEnd);
    if (segA.length < 2) continue;

    let minVxA = Infinity;
    let peakAy = 0;
    let avgAx = 0;
    const firstAy = Math.abs(segA[0].ay_g);
    const lastAy = Math.abs(segA[segA.length - 1].ay_g);

    for (const p of segA) {
      if (p.vx_mps < minVxA) minVxA = p.vx_mps;
      if (Math.abs(p.ay_g) > peakAy) peakAy = Math.abs(p.ay_g);
      avgAx += p.ax_g;
    }
    avgAx /= segA.length;

    let minVxB = minVxA;
    if (segB.length > 0) {
      minVxB = Math.min(...segB.map((p) => p.vx_mps));
    }

    let phase: SectorMetricRow["phase"] = "Apex";
    if (avgAx < -0.18) phase = "Braking";
    else if (avgAx > 0.14) phase = "Exit";
    else if (lastAy > firstAy + 0.18) phase = "Entry";
    else phase = "Apex";

    const dtStart = segA[0].delta_t_s;
    const dtEnd = segA[segA.length - 1].delta_t_s;
    const sectorDt = dtEnd - dtStart;

    rows.push({
      id: i + 1,
      name: `S${i + 1} (${sStart.toFixed(0)}–${sEnd.toFixed(0)}m)`,
      phase,
      sStartM: sStart,
      sEndM: sEnd,
      apexSpeedADriverKmh: minVxA * 3.6,
      apexSpeedBRefKmh: minVxB * 3.6,
      apexSpeedDeltaKmh: (minVxA - minVxB) * 3.6,
      peakAyG: peakAy,
      deltaTimeS: sectorDt,
    });
  }
  return rows;
}

function phaseBadgeClass(phase: SectorMetricRow["phase"]): string {
  switch (phase) {
    case "Braking":
      return "bg-[#DC2626]/14 text-[#F87171]";
    case "Entry":
      return "bg-[#38BDF8]/12 text-[#38BDF8]";
    case "Exit":
      return "bg-[#10B981]/12 text-[#34D399]";
    default:
      return "bg-[#C5A059]/14 text-[#DFBE78]";
  }
}

export function SectorDeltaBreakdown({
  driverTrace,
  refTrace,
  onSelectSectorRange,
  headerRight,
}: SectorDeltaBreakdownProps) {
  const [sortKey, setSortKey] = useState<SortKey>("id");
  const [sortAsc, setSortAsc] = useState<boolean>(true);

  const rows = useMemo(
    () => computeSectorBreakdown(driverTrace, refTrace),
    [driverTrace, refTrace]
  );

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === "string" && typeof bv === "string") {
        return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      return sortAsc ? Number(av) - Number(bv) : Number(bv) - Number(av);
    });
    return copy;
  }, [rows, sortAsc, sortKey]);

  const onHeaderClick = (key: SortKey) => {
    if (sortKey === key) setSortAsc((prev) => !prev);
    else {
      setSortKey(key);
      setSortAsc(key === "id");
    }
  };

  const renderSortIcon = (key: SortKey) => {
    if (sortKey !== key) return null;
    return sortAsc ? (
      <ArrowUp className="w-2.5 h-2.5 inline ml-0.5 text-[#DFBE78]" />
    ) : (
      <ArrowDown className="w-2.5 h-2.5 inline ml-0.5 text-[#DFBE78]" />
    );
  };

  return (
    <div className="machined-panel flex flex-col w-full h-full min-h-0 overflow-hidden">
      <InstrumentHeader
        title="Sector & Phase Delta"
        subtitle={`${rows.length} segments`}
        right={headerRight}
      />

      <div className="flex-1 min-h-0 overflow-auto bg-[#08090C]">
        <table className="w-full border-collapse text-[10.5px]">
          <thead className="sticky top-0 bg-[#12151D] text-[#7E8899] border-b border-[#222633] z-10">
            <tr>
              <th
                onClick={() => onHeaderClick("id")}
                className="text-left px-2 py-1.5 font-medium cursor-pointer hover:text-[#ECEFF4]"
              >
                Sector{renderSortIcon("id")}
              </th>
              <th
                onClick={() => onHeaderClick("phase")}
                className="text-left px-2 py-1.5 font-medium cursor-pointer hover:text-[#ECEFF4]"
              >
                Phase{renderSortIcon("phase")}
              </th>
              <th
                onClick={() => onHeaderClick("apexSpeedDeltaKmh")}
                className="text-right px-2 py-1.5 font-medium cursor-pointer hover:text-[#ECEFF4]"
              >
                ΔV Apex{renderSortIcon("apexSpeedDeltaKmh")}
              </th>
              <th
                onClick={() => onHeaderClick("peakAyG")}
                className="text-right px-2 py-1.5 font-medium cursor-pointer hover:text-[#ECEFF4]"
              >
                |ay|{renderSortIcon("peakAyG")}
              </th>
              <th
                onClick={() => onHeaderClick("deltaTimeS")}
                className="text-right px-2 py-1.5 font-medium cursor-pointer hover:text-[#ECEFF4]"
              >
                Δt{renderSortIcon("deltaTimeS")}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#181C26]">
            {sorted.map((row) => {
              const faster = row.deltaTimeS <= 0;
              return (
                <tr
                  key={row.id}
                  onClick={() => onSelectSectorRange(row.sStartM, row.sEndM)}
                  className="hover:bg-[#141822] cursor-pointer transition-colors"
                >
                  <td className="px-2 py-1.5 font-mono text-[#ECEFF4] font-medium whitespace-nowrap">
                    {row.name}
                  </td>
                  <td className="px-2 py-1.5">
                    <span
                      className={`inline-flex items-center px-1.5 py-[1px] rounded-[2px] text-[9.5px] font-medium ${phaseBadgeClass(
                        row.phase
                      )}`}
                    >
                      {row.phase}
                    </span>
                  </td>
                  <td
                    className={`px-2 py-1.5 text-right font-mono tabular ${
                      row.apexSpeedDeltaKmh >= 0 ? "text-[#34D399]" : "text-[#FBBF24]"
                    }`}
                  >
                    {row.apexSpeedDeltaKmh >= 0 ? "+" : ""}
                    {row.apexSpeedDeltaKmh.toFixed(1)}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono text-[#DFBE78] tabular">
                    {row.peakAyG.toFixed(2)}g
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <span
                      className={`status-pill !text-[9.5px] !px-1.5 !py-0 font-mono tabular ${
                        faster ? "status-pill-nominal" : "status-pill-limit"
                      }`}
                    >
                      {row.deltaTimeS >= 0 ? "+" : ""}
                      {row.deltaTimeS.toFixed(3)}s
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
