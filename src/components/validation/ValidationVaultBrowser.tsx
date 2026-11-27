import React, { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Maximize2,
  Printer,
  Search,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { VaultCatalogResponse, VaultFigure, VaultSuite } from "../../types";
import { fetchVaultCatalog, getVaultFigureUrl } from "../../services/apiClient";
import { useTelemetryStore } from "../../state/telemetryStore";
import { SplitPane } from "../layout/SplitPane";
import { InstrumentHeader } from "../shared/PrecisionControl";

const AUDIT_HEADLINE_KPIS = [
  { label: "TeR26 Correlation", value: "98.4%", detail: "OOS ωz R²=0.9539" },
  { label: "3D Engine Parity", value: "0.529%", detail: "14-DOF Python/Godot" },
  { label: "C99 SIL Error", value: "0.0 abs", detail: "Bit-exact controller" },
  { label: "STM32F405 CPU", value: "6.12%", detail: "200 Hz ECU budget" },
  { label: "Python Pytest", value: "32 / 32", detail: "Unit & parity gates" },
  { label: "Godot Assertions", value: "882 / 882", detail: "MirenaSim regression" },
];

export function ValidationVaultBrowser() {
  const { forceOfflineMode, backendLive } = useTelemetryStore();

  const [catalog, setCatalog] = useState<VaultCatalogResponse | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [selectedTag, setSelectedTag] = useState<string>("ALL");
  const [selectedSuiteCode, setSelectedSuiteCode] = useState<string>("01");
  const [dossierSelection, setDossierSelection] = useState<string[]>(["01", "02", "08", "09", "10"]);

  const [viewerItem, setViewerItem] = useState<{ suite: VaultSuite; figure: VaultFigure } | null>(
    null
  );
  const [imgFailed, setImgFailed] = useState<boolean>(false);
  const [zoomScale, setZoomScale] = useState<number>(1);

  useEffect(() => {
    let active = true;
    fetchVaultCatalog(forceOfflineMode).then((res) => {
      if (!active) return;
      setCatalog(res.data);
    });
    return () => {
      active = false;
    };
  }, [forceOfflineMode]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setViewerItem(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const tags = useMemo(() => {
    if (!catalog) return ["ALL"];
    return ["ALL", ...Array.from(new Set(catalog.suites.map((s) => s.tag)))];
  }, [catalog]);

  const filteredSuites = useMemo(() => {
    if (!catalog) return [];
    const q = searchQuery.trim().toLowerCase();
    return catalog.suites.filter((s) => {
      if (selectedTag !== "ALL" && s.tag !== selectedTag) return false;
      if (!q) return true;
      const hay = `${s.code} ${s.title} ${s.subtitle} ${s.tag} ${s.kpis
        .map((k) => `${k.label} ${k.value}`)
        .join(" ")} ${s.figures.map((f) => f.title).join(" ")}`.toLowerCase();
      return hay.includes(q);
    });
  }, [catalog, searchQuery, selectedTag]);

  const selectedSuite = useMemo(() => {
    if (!catalog) return null;
    return catalog.suites.find((s) => s.code === selectedSuiteCode) ?? filteredSuites[0] ?? null;
  }, [catalog, filteredSuites, selectedSuiteCode]);

  const toggleDossierSuite = (code: string) => {
    setDossierSelection((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code].sort()
    );
  };

  const dossierSuites = useMemo(() => {
    if (!catalog) return [];
    return catalog.suites.filter((s) => dossierSelection.includes(s.code));
  }, [catalog, dossierSelection]);

  const openViewer = (suite: VaultSuite, figure: VaultFigure) => {
    setImgFailed(!backendLive || forceOfflineMode);
    setZoomScale(1);
    setViewerItem({ suite, figure });
  };

  if (!catalog) {
    return (
      <div className="machined-panel w-full h-full flex items-center justify-center text-[11.5px] font-mono text-[#94A3B8]">
        Loading TeR27 Validation Vault catalog...
      </div>
    );
  }

  return (
    <div className="w-full h-full min-h-0 flex flex-col gap-1.5 overflow-hidden">
      {/* Interactive Screen Workspace */}
      <div className="w-full h-full min-h-0 flex flex-col gap-1.5 no-print">
        {/* Top KPI Parity Banner */}
        <div className="machined-panel shrink-0 overflow-hidden">
          <InstrumentHeader
            title="Engineering Validation Vault"
            subtitle={`${catalog.n_suites} Suites · ${catalog.total_pngs} Figures (${catalog.total_png_size_mb.toFixed(1)} MB) · ${catalog.standard}`}
            right={
              <button
                type="button"
                onClick={() => window.print()}
                className="h-[21px] px-2.5 rounded-[3px] bg-[#C5A059] hover:bg-[#DFBE78] text-[#07080B] font-semibold text-[10px] flex items-center gap-1 cursor-pointer transition-colors"
              >
                <Printer className="w-3 h-3" />
                Print Design Dossier ({dossierSelection.length})
              </button>
            }
          />
          <div className="grid grid-cols-3 lg:grid-cols-6 gap-1.5 p-1.5 bg-[#0C0E14]">
            {AUDIT_HEADLINE_KPIS.map((kpi) => (
              <div
                key={kpi.label}
                className="rounded-[3px] bg-[#141720] border border-[#222633] px-2.5 py-1.5 flex items-baseline justify-between gap-2"
              >
                <div className="min-w-0">
                  <div className="text-[9.5px] text-[#7E8899] truncate">{kpi.label}</div>
                  <div className="text-[9px] font-mono text-[#64748B] truncate">{kpi.detail}</div>
                </div>
                <div className="font-mono text-[12.5px] font-semibold text-[#34D399] tabular shrink-0">
                  {kpi.value}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Main 62% / 38% Split: Filterable Suite + Inspector vs Interactive Dossier Builder */}
        <div className="flex-1 min-h-0 overflow-hidden">
          <SplitPane
            direction="horizontal"
            initialRatio={0.62}
            minRatio={0.48}
            maxRatio={0.74}
            first={
              <SplitPane
                direction="horizontal"
                initialRatio={0.42}
                minRatio={0.30}
                maxRatio={0.56}
                first={
                  <div className="machined-panel w-full h-full min-h-0 flex flex-col overflow-hidden">
                    <InstrumentHeader
                      title="Validation Suites (01–10)"
                      right={
                        <span className="font-mono text-[9.5px] text-[#7E8899]">
                          {filteredSuites.length}/{catalog.n_suites}
                        </span>
                      }
                    />
                    <div className="p-1.5 space-y-1.5 border-b border-[#222633] bg-[#0F1116] shrink-0">
                      <div className="flex items-center gap-1.5 bg-[#08090C] border border-[#222633] focus-within:border-[#C5A059] px-2 h-[25px] rounded-[3px]">
                        <Search className="w-3 h-3 text-[#64748B] shrink-0" />
                        <input
                          type="text"
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          placeholder="Filter suites, KPIs, figures..."
                          className="w-full bg-transparent text-[#ECEFF4] text-[10.5px] outline-none placeholder:text-[#64748B]"
                        />
                      </div>
                      <div className="flex items-center gap-1 overflow-x-auto pb-0.5">
                        {tags.map((tag) => (
                          <button
                            key={tag}
                            type="button"
                            onClick={() => setSelectedTag(tag)}
                            className={`h-[19px] px-1.5 rounded-[2px] text-[9.5px] font-medium whitespace-nowrap cursor-pointer border transition-colors ${
                              selectedTag === tag
                                ? "bg-[#C5A059]/16 border-[#C5A059]/45 text-[#DFBE78]"
                                : "bg-[#141720] border-[#222633] text-[#7E8899] hover:text-[#ECEFF4]"
                            }`}
                          >
                            {tag === "ALL" ? "All" : tag}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="flex-1 min-h-0 overflow-y-auto p-1.5 space-y-1 bg-[#08090C]">
                      {filteredSuites.map((suite) => {
                        const isActive = selectedSuite?.code === suite.code;
                        const inDossier = dossierSelection.includes(suite.code);
                        return (
                          <div
                            key={suite.code}
                            onClick={() => setSelectedSuiteCode(suite.code)}
                            className={`p-2 rounded-[3px] border cursor-pointer transition-colors ${
                              isActive
                                ? "bg-[#171C28] border-[#C5A059]/55"
                                : "bg-[#11141B] border-[#222633] hover:bg-[#151923]"
                            }`}
                          >
                            <div className="flex items-start justify-between gap-1.5">
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <span
                                    className={`font-mono text-[9.5px] font-semibold px-1 py-[0.5px] rounded-[2px] ${
                                      isActive
                                        ? "bg-[#C5A059]/20 text-[#DFBE78]"
                                        : "bg-[#08090C] text-[#94A3B8]"
                                    }`}
                                  >
                                    {suite.code}
                                  </span>
                                  <span className="text-[9px] font-mono text-[#7E8899] truncate">
                                    {suite.tag} · {suite.n_figures} figs
                                  </span>
                                </div>
                                <div className="text-[11px] font-semibold text-[#ECEFF4] mt-1 leading-tight">
                                  {suite.title}
                                </div>
                              </div>

                              <label
                                onClick={(e) => e.stopPropagation()}
                                title="Include in Design Dossier"
                                className="flex items-center gap-1 text-[9px] font-mono text-[#7E8899] shrink-0 cursor-pointer pt-0.5"
                              >
                                <input
                                  type="checkbox"
                                  checked={inDossier}
                                  onChange={() => toggleDossierSuite(suite.code)}
                                  className="accent-[#C5A059]"
                                />
                              </label>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                }
                second={
                  selectedSuite ? (
                    <div className="machined-panel w-full h-full min-h-0 flex flex-col overflow-hidden">
                      <InstrumentHeader
                        title={`Suite ${selectedSuite.code} · ${selectedSuite.title}`}
                        right={
                          <span className="font-mono text-[9.5px] text-[#7E8899] truncate max-w-[120px]">
                            {selectedSuite.folder}
                          </span>
                        }
                      />
                      <div className="flex-1 min-h-0 overflow-y-auto p-2.5 space-y-2.5 bg-[#08090C]">
                        <p className="text-[11px] text-[#94A3B8] m-0 leading-snug">
                          {selectedSuite.subtitle}
                        </p>

                        <div className="grid grid-cols-2 gap-1.5">
                          {selectedSuite.kpis.map((kpi) => (
                            <div
                              key={kpi.label}
                              className="rounded-[3px] bg-[#141720] border border-[#222633] px-2.5 py-1.5"
                            >
                              <div className="text-[9.5px] text-[#7E8899] truncate">{kpi.label}</div>
                              <div className="flex items-center justify-between gap-1.5 mt-0.5">
                                <span className="font-mono text-[11.5px] font-semibold text-[#ECEFF4] tabular">
                                  {kpi.value}
                                </span>
                                <span className="status-pill status-pill-nominal !text-[8.5px] !px-1 !py-0">
                                  <CheckCircle2 className="w-2.5 h-2.5" />
                                  {kpi.status}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>

                        <div className="rounded-[3px] bg-[#0F1116] border border-[#222633] px-2.5 py-1.5 flex items-center justify-between gap-2 text-[10px]">
                          <span className="text-[#7E8899] shrink-0">Metrics JSON</span>
                          <span className="font-mono text-[#CBD5E1] truncate">
                            {catalog.vault_root}/{selectedSuite.primary_metrics_json ?? "—"}
                          </span>
                        </div>

                        <div className="space-y-1.5">
                          <div className="text-[10px] font-mono uppercase text-[#7E8899]">
                            300-DPI Figure Artifacts ({selectedSuite.figures.length})
                          </div>
                          <div className="grid grid-cols-1 gap-1.5">
                            {selectedSuite.figures.map((fig) => (
                              <button
                                key={fig.filename}
                                type="button"
                                onClick={() => openViewer(selectedSuite, fig)}
                                className="rounded-[3px] bg-[#141720] border border-[#222633] hover:border-[#C5A059]/55 hover:bg-[#191E2A] text-left p-2 cursor-pointer transition-colors group"
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <div className="text-[11px] font-semibold text-[#ECEFF4] group-hover:text-[#DFBE78] leading-snug">
                                    {fig.title}
                                  </div>
                                  <Maximize2 className="w-3 h-3 text-[#7E8899] group-hover:text-[#DFBE78] shrink-0 mt-0.5" />
                                </div>
                                <div className="flex items-center justify-between gap-2 font-mono text-[9.5px] text-[#7E8899] mt-1">
                                  <span className="truncate text-[#C5A059]">{fig.rel_path}</span>
                                  <span className="shrink-0">
                                    {fig.width_px}×{fig.height_px} · {fig.size_kb.toFixed(0)}KB
                                  </span>
                                </div>
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : null
                }
              />
            }
            second={
              <div className="machined-panel w-full h-full min-h-0 flex flex-col overflow-hidden">
                <InstrumentHeader
                  title="Design Event Dossier Builder"
                  subtitle={`${dossierSelection.length}/${catalog.n_suites} suites`}
                  right={
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setDossierSelection(["01", "02", "08", "09", "10"])}
                        className="h-[20px] px-1.5 rounded-[2px] bg-[#151820] border border-[#222633] text-[9.5px] text-[#94A3B8] hover:text-[#ECEFF4] cursor-pointer"
                      >
                        Core 5
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setDossierSelection(catalog.suites.map((s) => s.code))
                        }
                        className="h-[20px] px-1.5 rounded-[2px] bg-[#151820] border border-[#222633] text-[9.5px] text-[#94A3B8] hover:text-[#DFBE78] cursor-pointer"
                      >
                        All
                      </button>
                    </div>
                  }
                />

                <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-2 bg-[#08090C]">
                  {dossierSuites.length === 0 ? (
                    <div className="text-center font-mono text-[10.5px] text-[#64748B] py-8">
                      Check one or more suites on the left to assemble the Formula Student Design Event Dossier.
                    </div>
                  ) : (
                    dossierSuites.map((suite) => (
                      <div
                        key={suite.code}
                        className="rounded-[3px] bg-[#141720] border border-[#222633] p-2 space-y-1.5"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[11px] font-semibold text-[#DFBE78] truncate">
                            Suite {suite.code} — {suite.title}
                          </span>
                          <button
                            type="button"
                            onClick={() => toggleDossierSuite(suite.code)}
                            className="text-[#64748B] hover:text-[#F87171] cursor-pointer shrink-0"
                            title="Remove from Dossier"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                        <div className="grid grid-cols-2 gap-1">
                          {suite.kpis.slice(0, 4).map((kpi) => (
                            <div
                              key={kpi.label}
                              className="rounded-[2px] bg-[#08090C] border border-[#1E222E] px-2 py-1 flex items-center justify-between gap-1"
                            >
                              <span className="text-[9px] text-[#7E8899] truncate">
                                {kpi.label}
                              </span>
                              <span className="font-mono text-[10px] text-[#34D399] font-semibold shrink-0 tabular">
                                {kpi.value}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))
                  )}
                </div>

                <div className="p-2 bg-[#0F1116] border-t border-[#222633] flex items-center justify-between gap-2 shrink-0">
                  <span className="font-mono text-[9.5px] text-[#7E8899] truncate">
                    Ready for @media print export
                  </span>
                  <button
                    type="button"
                    disabled={dossierSuites.length === 0}
                    onClick={() => window.print()}
                    className="h-[24px] px-2.5 rounded-[3px] bg-[#C5A059] hover:bg-[#DFBE78] text-[#07080B] font-semibold text-[10px] flex items-center gap-1 cursor-pointer disabled:opacity-45 shrink-0"
                  >
                    <Printer className="w-3 h-3" />
                    Export PDF / Print
                  </button>
                </div>
              </div>
            }
          />
        </div>
      </div>

      {/* Distraction-Free Dark Lightbox Artifact Viewer */}
      {viewerItem ? (
        <div
          className="fixed inset-0 z-50 bg-[#050609]/92 flex flex-col no-print"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setViewerItem(null);
          }}
        >
          <div className="h-[40px] shrink-0 bg-[#0F1116] border-b border-[#222633] px-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <span className="status-pill status-pill-gold font-mono text-[10px]">
                Suite {viewerItem.suite.code}
              </span>
              <span className="text-[12px] font-semibold text-[#ECEFF4] truncate">
                {viewerItem.figure.title}
              </span>
              <span className="font-mono text-[10px] text-[#7E8899] shrink-0">
                {viewerItem.figure.width_px}×{viewerItem.figure.height_px} px ·{" "}
                {viewerItem.figure.size_kb.toFixed(1)} KB
              </span>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {!imgFailed ? (
                <div className="seg-track">
                  <button
                    type="button"
                    onClick={() => setZoomScale((z) => Math.max(0.5, z - 0.25))}
                    className="seg-btn"
                    title="Zoom Out"
                  >
                    <ZoomOut className="w-3.5 h-3.5" />
                  </button>
                  <span className="font-mono text-[10px] text-[#ECEFF4] px-2">
                    {Math.round(zoomScale * 100)}%
                  </span>
                  <button
                    type="button"
                    onClick={() => setZoomScale((z) => Math.min(3, z + 0.25))}
                    className="seg-btn"
                    title="Zoom In"
                  >
                    <ZoomIn className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : null}
              <button
                type="button"
                onClick={() => setViewerItem(null)}
                className="w-6 h-6 rounded-[3px] flex items-center justify-center bg-[#151820] border border-[#222633] text-[#ECEFF4] hover:border-[#C5A059]/45 hover:text-[#DFBE78] cursor-pointer"
                title="Close (Esc)"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-auto flex items-center justify-center p-5">
            {!imgFailed ? (
              <img
                src={getVaultFigureUrl(viewerItem.figure.rel_path)}
                alt={viewerItem.figure.title}
                referrerPolicy="no-referrer"
                onError={() => setImgFailed(true)}
                style={{ transform: `scale(${zoomScale})`, transformOrigin: "center center" }}
                className="max-w-full max-h-full rounded-[4px] border border-[#222633] shadow-[0_20px_50px_rgba(0,0,0,0.7)] transition-transform"
              />
            ) : (
              <div className="machined-panel w-[720px] max-w-full overflow-hidden shadow-[0_24px_60px_rgba(0,0,0,0.7)]">
                <InstrumentHeader
                  title="Offline Artifact Specification Card · 300-DPI Figure"
                  right={
                    <span className="status-pill status-pill-caution !text-[9.5px]">
                      Local Backend Required for PNG
                    </span>
                  }
                />
                <div className="p-4 space-y-3">
                  <div>
                    <h3 className="text-[14px] font-semibold text-[#ECEFF4] m-0">
                      {viewerItem.figure.title}
                    </h3>
                    <div className="text-[11px] text-[#7E8899] mt-0.5">
                      Suite {viewerItem.suite.code}: {viewerItem.suite.title}
                    </div>
                  </div>

                  <div className="rounded-[3px] bg-[#08090C] border border-[#222633] p-3 space-y-1.5 text-[10.5px]">
                    <div className="flex justify-between gap-3">
                      <span className="text-[#7E8899]">Backend Asset Path</span>
                      <span className="font-mono text-[#DFBE78] text-right">
                        {catalog.vault_root}/{viewerItem.figure.rel_path}
                      </span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-[#7E8899]">Native Resolution</span>
                      <span className="font-mono text-[#ECEFF4]">
                        {viewerItem.figure.width_px} × {viewerItem.figure.height_px} px (300 DPI)
                      </span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-[#7E8899]">File Size</span>
                      <span className="font-mono text-[#ECEFF4]">
                        {viewerItem.figure.size_kb.toFixed(1)} KB
                      </span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-[#7E8899]">Primary Metrics Source</span>
                      <span className="font-mono text-[#ECEFF4]">
                        {viewerItem.suite.primary_metrics_json ?? "N/A"}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-1.5">
                    {viewerItem.suite.kpis.map((kpi) => (
                      <div
                        key={kpi.label}
                        className="rounded-[3px] bg-[#141720] border border-[#222633] px-2.5 py-1.5 flex items-center justify-between gap-2"
                      >
                        <span className="text-[10.5px] text-[#94A3B8]">{kpi.label}</span>
                        <span className="font-mono text-[11px] text-[#34D399] font-semibold">
                          {kpi.value}
                        </span>
                      </div>
                    ))}
                  </div>

                  <div className="text-[10.5px] text-[#7E8899] border-t border-[#222633] pt-2.5">
                    Start the local FastAPI server (
                    <code className="text-[#DFBE78]">
                      python3 ter27.py api --host 0.0.0.0 --port 8000
                    </code>
                    ) to stream native 300-DPI PNG artifacts directly.
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {/* Printable Design Event Dossier */}
      <div className="print-only print-sheet">
        <div style={{ borderBottom: "2px solid #000", paddingBottom: "6px", marginBottom: "10px" }}>
          <h1 style={{ margin: 0, fontSize: "16px", fontWeight: 700 }}>
            TECNUN eRACING // TeR27 4WD ENGINEERING DESIGN EVENT VALIDATION DOSSIER
          </h1>
          <div style={{ fontSize: "10px" }}>
            Standard: {catalog.standard} | Generated: {catalog.generated_utc}
          </div>
        </div>

        <table style={{ marginBottom: "12px" }}>
          <thead>
            <tr>
              {AUDIT_HEADLINE_KPIS.map((k) => (
                <th key={k.label}>{k.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              {AUDIT_HEADLINE_KPIS.map((k) => (
                <td key={k.label}>
                  <strong>{k.value}</strong> ({k.detail})
                </td>
              ))}
            </tr>
          </tbody>
        </table>

        {dossierSuites.map((suite) => (
          <div key={suite.code} style={{ marginBottom: "10px", pageBreakInside: "avoid" }}>
            <h2 style={{ fontSize: "12px", margin: "0 0 3px 0" }}>
              Suite {suite.code} — {suite.title} [{suite.tag}]
            </h2>
            <div style={{ fontSize: "9px", marginBottom: "4px" }}>{suite.subtitle}</div>
            <table>
              <thead>
                <tr>
                  <th>Metric</th>
                  <th>Verified Value</th>
                  <th>Gate Status</th>
                </tr>
              </thead>
              <tbody>
                {suite.kpis.map((kpi) => (
                  <tr key={kpi.label}>
                    <td>{kpi.label}</td>
                    <td>{kpi.value}</td>
                    <td>{kpi.status.toUpperCase()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  );
}
