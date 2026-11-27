import React, { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  FileText,
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

const AUDIT_HEADLINE_KPIS = [
  { label: "TeR26 Yaw Correlation", value: "98.4%", detail: "OOS ωz R² = 0.9539" },
  { label: "Python–Godot Parity", value: "0.529%", detail: "14-DOF closed-loop" },
  { label: "C99 SIL Error", value: "0.0 abs", detail: "Bit-exact controller" },
  { label: "STM32F405 CPU", value: "6.12%", detail: "200 Hz ECU budget" },
  { label: "Python Test Suite", value: "32 / 32", detail: "pytest verification" },
  { label: "Godot Assertions", value: "882 / 882", detail: "MirenaSim parity gates" },
];

export function ValidationVaultBrowser() {
  const { forceOfflineMode, backendLive } = useTelemetryStore();

  const [catalog, setCatalog] = useState<VaultCatalogResponse | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [selectedTag, setSelectedTag] = useState<string>("ALL");
  const [selectedSuiteCode, setSelectedSuiteCode] = useState<string>("01");
  const [dossierSelection, setDossierSelection] = useState<string[]>(["01", "02", "08", "09", "10"]);
  const [dossierPreviewOpen, setDossierPreviewOpen] = useState<boolean>(false);

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
        setDossierPreviewOpen(false);
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
      <div className="machined-panel w-full h-full flex items-center justify-center text-[12px] text-[#94A3B8]">
        Loading TeR27 Validation Vault catalog...
      </div>
    );
  }

  return (
    <div className="w-full h-full min-h-0 flex flex-col gap-2 overflow-hidden">
      {/* Screen Interactive Workspace */}
      <div className="w-full h-full min-h-0 flex flex-col gap-2 no-print">
        {/* Executive Top Audit KPI Strip */}
        <div className="machined-panel shrink-0 overflow-hidden">
          <div className="panel-header-bar gap-3 flex-wrap">
            <div className="flex items-center gap-2.5 flex-wrap">
              <span className="panel-title-label">Engineering Validation Vault</span>
              <span className="status-pill status-pill-muted font-mono text-[10px]">
                {catalog.n_suites} Suites · {catalog.total_pngs} Figures (
                {catalog.total_png_size_mb.toFixed(1)} MB)
              </span>
              <span className="text-[11px] text-[#94A3B8] hidden lg:inline">
                {catalog.standard}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setDossierPreviewOpen((v) => !v)}
                className={`flex items-center gap-1.5 h-[28px] px-2.5 rounded-[5px] border text-[11px] font-medium cursor-pointer transition-colors ${
                  dossierPreviewOpen
                    ? "border-[#C5A059]/45 bg-[#C5A059]/12 text-[#DFBE78]"
                    : "border-white/[0.08] bg-[#161A23] text-[#E2E8F0] hover:border-white/[0.16]"
                }`}
              >
                <FileText className="w-3 h-3" />
                Design Dossier ({dossierSelection.length})
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className="flex items-center gap-1.5 h-[28px] px-3 rounded-[5px] bg-[#C5A059] hover:bg-[#DFBE78] text-[#07080B] font-semibold text-[11px] cursor-pointer transition-colors"
              >
                <Printer className="w-3 h-3" />
                Print Dossier
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2 p-2.5 bg-[#0E1118]">
            {AUDIT_HEADLINE_KPIS.map((kpi) => (
              <div key={kpi.label} className="machined-card px-3 py-2">
                <div className="text-[10.5px] text-[#94A3B8] truncate">{kpi.label}</div>
                <div className="font-mono text-[14px] font-semibold text-[#34D399] tabular mt-0.5">
                  {kpi.value}
                </div>
                <div className="text-[10px] text-[#64748B] truncate mt-0.5">{kpi.detail}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Search & Tag Filter Strip */}
        <div className="machined-panel shrink-0 px-3.5 py-2 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 bg-[#0B0D12] border border-white/[0.08] focus-within:border-[#C5A059]/50 px-2.5 h-[30px] rounded-[5px] w-[300px] transition-colors">
            <Search className="w-3.5 h-3.5 text-[#64748B] shrink-0" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search suites, KPIs, or figure titles..."
              className="w-full bg-transparent text-[#F1F5F9] text-[11.5px] outline-none placeholder:text-[#64748B]"
            />
          </div>

          <div className="seg-track flex-wrap">
            {tags.map((tag) => (
              <button
                key={tag}
                type="button"
                data-active={selectedTag === tag ? "true" : "false"}
                onClick={() => setSelectedTag(tag)}
                className="seg-btn"
              >
                {tag === "ALL" ? "All Suites" : tag}
              </button>
            ))}
          </div>
        </div>

        {/* Main SplitPane: Suite Catalog + Artifact Inspector */}
        <div className="flex-1 min-h-0 overflow-hidden">
          {dossierPreviewOpen ? (
            <div className="machined-panel w-full h-full overflow-y-auto p-5">
              <div className="max-w-[960px] mx-auto space-y-4">
                <div className="flex items-center justify-between border-b border-white/[0.07] pb-3">
                  <div>
                    <h2 className="text-[15px] font-semibold text-[#F1F5F9] m-0">
                      TeR27 4WD — Formula Student Engineering Design Dossier
                    </h2>
                    <div className="font-mono text-[11px] text-[#94A3B8] mt-1">
                      Included Suites: {dossierSuites.map((s) => s.code).join(", ")} · Generated{" "}
                      {catalog.generated_utc}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDossierPreviewOpen(false)}
                    className="h-[28px] px-3 rounded-[5px] border border-white/[0.1] bg-[#161A23] text-[11px] font-medium text-[#F1F5F9] hover:border-[#C5A059]/45 cursor-pointer"
                  >
                    Return to Vault
                  </button>
                </div>

                {dossierSuites.map((suite) => (
                  <div key={suite.code} className="machined-card p-4 space-y-2.5">
                    <div className="flex items-baseline justify-between gap-2">
                      <div className="text-[13px] font-semibold text-[#DFBE78]">
                        Suite {suite.code} — {suite.title}
                      </div>
                      <span className="status-pill status-pill-muted text-[10px]">{suite.tag}</span>
                    </div>
                    <p className="text-[11.5px] text-[#94A3B8] m-0">{suite.subtitle}</p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 pt-1">
                      {suite.kpis.map((kpi) => (
                        <div key={kpi.label} className="machined-well px-2.5 py-2">
                          <div className="text-[10px] text-[#94A3B8] truncate">{kpi.label}</div>
                          <div className="font-mono text-[12px] text-[#34D399] font-semibold mt-0.5">
                            {kpi.value}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <SplitPane
              direction="horizontal"
              initialRatio={0.43}
              minRatio={0.3}
              maxRatio={0.62}
              first={
                <div className="machined-panel w-full h-full min-h-0 overflow-y-auto p-2.5 space-y-2">
                  {filteredSuites.map((suite) => {
                    const isActive = selectedSuite?.code === suite.code;
                    const inDossier = dossierSelection.includes(suite.code);
                    return (
                      <div
                        key={suite.code}
                        onClick={() => setSelectedSuiteCode(suite.code)}
                        className={`p-3 rounded-[6px] border cursor-pointer transition-all ${
                          isActive
                            ? "bg-[#1A202D] border-[#C5A059]/45 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
                            : "bg-[#141821] border-white/[0.05] hover:bg-[#181D29] hover:border-white/[0.1]"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span
                                className={`font-mono text-[10.5px] font-semibold px-1.5 py-0.5 rounded-[4px] ${
                                  isActive
                                    ? "bg-[#C5A059]/18 text-[#DFBE78]"
                                    : "bg-[#0B0D12] text-[#94A3B8]"
                                }`}
                              >
                                Suite {suite.code}
                              </span>
                              <span className="status-pill status-pill-muted text-[10px]">
                                {suite.tag}
                              </span>
                              <span className="font-mono text-[10px] text-[#94A3B8]">
                                {suite.n_figures} figs
                              </span>
                            </div>
                            <div className="text-[12.5px] font-semibold text-[#F1F5F9] mt-1.5">
                              {suite.title}
                            </div>
                            <div className="text-[11px] text-[#94A3B8] mt-0.5 line-clamp-2 leading-relaxed">
                              {suite.subtitle}
                            </div>
                          </div>

                          <label
                            onClick={(e) => e.stopPropagation()}
                            title="Include in Design Event Dossier"
                            className="flex items-center gap-1.5 text-[10px] text-[#94A3B8] shrink-0 cursor-pointer pt-0.5"
                          >
                            <input
                              type="checkbox"
                              checked={inDossier}
                              onChange={() => toggleDossierSuite(suite.code)}
                              className="accent-[#C5A059]"
                            />
                            Dossier
                          </label>
                        </div>

                        <div className="mt-2.5 pt-2 border-t border-white/[0.05] flex flex-wrap gap-x-3 gap-y-1 text-[10.5px]">
                          {suite.kpis.slice(0, 3).map((kpi) => (
                            <span key={kpi.label} className="text-[#94A3B8]">
                              {kpi.label}:{" "}
                              <strong className="font-mono text-[#34D399] font-medium">
                                {kpi.value}
                              </strong>
                            </span>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              }
              second={
                selectedSuite ? (
                  <div className="machined-panel w-full h-full min-h-0 flex flex-col overflow-hidden">
                    <div className="panel-header-bar gap-2">
                      <span className="panel-title-label truncate">
                        Suite {selectedSuite.code} — {selectedSuite.title}
                      </span>
                      <span className="status-pill status-pill-muted font-mono text-[10px] shrink-0">
                        {selectedSuite.folder}
                      </span>
                    </div>

                    <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
                      <p className="text-[12px] text-[#94A3B8] m-0 leading-relaxed">
                        {selectedSuite.subtitle}
                      </p>

                      {/* Verified KPI Matrix */}
                      <div className="grid grid-cols-2 lg:grid-cols-3 gap-2.5">
                        {selectedSuite.kpis.map((kpi) => (
                          <div key={kpi.label} className="machined-card px-3 py-2.5">
                            <div className="text-[10.5px] text-[#94A3B8] truncate">{kpi.label}</div>
                            <div className="flex items-center justify-between gap-2 mt-1.5">
                              <span className="font-mono text-[13px] font-semibold text-[#F1F5F9] tabular">
                                {kpi.value}
                              </span>
                              <span className="status-pill status-pill-nominal text-[9.5px]">
                                <CheckCircle2 className="w-2.5 h-2.5" />
                                {kpi.status}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* Source Metrics Path */}
                      <div className="machined-well px-3 py-2 flex items-center justify-between gap-2 text-[11px]">
                        <span className="text-[#94A3B8] shrink-0">Source Metrics Artifact</span>
                        <span className="font-mono text-[10.5px] text-[#CBD5E1] truncate">
                          {catalog.vault_root}/{selectedSuite.primary_metrics_json ?? "—"}
                        </span>
                      </div>

                      {/* 300-DPI Figure Artifacts Grid */}
                      <div className="space-y-2">
                        <div className="text-[11.5px] font-semibold text-[#CBD5E1]">
                          300-DPI Engineering Artifacts ({selectedSuite.figures.length})
                        </div>
                        <div className="grid grid-cols-1 xl:grid-cols-2 gap-2.5">
                          {selectedSuite.figures.map((fig) => (
                            <button
                              key={fig.filename}
                              type="button"
                              onClick={() => openViewer(selectedSuite, fig)}
                              className="machined-card text-left hover:border-[#C5A059]/45 hover:bg-[#1B2130] p-3 cursor-pointer transition-all flex flex-col justify-between gap-2.5 group"
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="text-[12px] font-semibold text-[#F1F5F9] group-hover:text-[#DFBE78] transition-colors leading-snug">
                                  {fig.title}
                                </div>
                                <Maximize2 className="w-3.5 h-3.5 text-[#94A3B8] group-hover:text-[#DFBE78] shrink-0 mt-0.5 transition-colors" />
                              </div>

                              <div className="space-y-1 font-mono text-[10px] text-[#94A3B8]">
                                <div className="truncate text-[#C5A059]">
                                  {catalog.vault_root}/{fig.rel_path}
                                </div>
                                <div className="flex justify-between text-[#64748B]">
                                  <span>
                                    {fig.width_px} × {fig.height_px} px
                                  </span>
                                  <span>{fig.size_kb.toFixed(1)} KB</span>
                                </div>
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
          )}
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
          <div className="h-[46px] shrink-0 bg-[#11141B] border-b border-white/[0.08] px-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <span className="status-pill status-pill-gold font-mono text-[10.5px]">
                Suite {viewerItem.suite.code}
              </span>
              <span className="text-[12.5px] font-semibold text-[#F1F5F9] truncate">
                {viewerItem.figure.title}
              </span>
              <span className="font-mono text-[10.5px] text-[#94A3B8] shrink-0">
                {viewerItem.figure.width_px} × {viewerItem.figure.height_px} px ·{" "}
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
                  <span className="font-mono text-[10.5px] text-[#E2E8F0] px-2">
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
                className="w-7 h-7 rounded-[5px] flex items-center justify-center bg-[#161A23] border border-white/[0.08] text-[#E2E8F0] hover:border-[#C5A059]/45 hover:text-[#DFBE78] cursor-pointer"
                title="Close (Esc)"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-auto flex items-center justify-center p-6">
            {!imgFailed ? (
              <img
                src={getVaultFigureUrl(viewerItem.figure.rel_path)}
                alt={viewerItem.figure.title}
                referrerPolicy="no-referrer"
                onError={() => setImgFailed(true)}
                style={{ transform: `scale(${zoomScale})`, transformOrigin: "center center" }}
                className="max-w-full max-h-full rounded-[6px] border border-white/[0.1] shadow-[0_20px_50px_rgba(0,0,0,0.7)] transition-transform"
              />
            ) : (
              <div className="machined-panel w-[760px] max-w-full overflow-hidden shadow-[0_24px_60px_rgba(0,0,0,0.7)]">
                <div className="panel-header-bar">
                  <span className="panel-title-label">
                    Offline Artifact Specification Card · 300-DPI Figure
                  </span>
                  <span className="status-pill status-pill-caution text-[10.5px]">
                    Local Backend Required for PNG
                  </span>
                </div>
                <div className="p-5 space-y-4">
                  <div>
                    <h3 className="text-[15px] font-semibold text-[#F1F5F9] m-0">
                      {viewerItem.figure.title}
                    </h3>
                    <div className="text-[11.5px] text-[#94A3B8] mt-1">
                      Suite {viewerItem.suite.code}: {viewerItem.suite.title}
                    </div>
                  </div>

                  <div className="machined-well p-3.5 space-y-2 text-[11px]">
                    <div className="flex justify-between gap-3">
                      <span className="text-[#94A3B8]">Backend Asset Path</span>
                      <span className="font-mono text-[#DFBE78] text-right">
                        {catalog.vault_root}/{viewerItem.figure.rel_path}
                      </span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-[#94A3B8]">Native Resolution</span>
                      <span className="font-mono text-[#F1F5F9]">
                        {viewerItem.figure.width_px} × {viewerItem.figure.height_px} px (300 DPI)
                      </span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-[#94A3B8]">File Size</span>
                      <span className="font-mono text-[#F1F5F9]">
                        {viewerItem.figure.size_kb.toFixed(1)} KB
                      </span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-[#94A3B8]">Primary Metrics Source</span>
                      <span className="font-mono text-[#F1F5F9]">
                        {viewerItem.suite.primary_metrics_json ?? "N/A"}
                      </span>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="text-[11px] font-semibold text-[#CBD5E1]">
                      Associated Suite {viewerItem.suite.code} Verified KPIs
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {viewerItem.suite.kpis.map((kpi) => (
                        <div
                          key={kpi.label}
                          className="machined-card px-3 py-2 flex items-center justify-between gap-2"
                        >
                          <span className="text-[11px] text-[#94A3B8]">{kpi.label}</span>
                          <span className="font-mono text-[11.5px] text-[#34D399] font-semibold">
                            {kpi.value}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="text-[11px] text-[#94A3B8] border-t border-white/[0.06] pt-3">
                    Start the local FastAPI server (
                    <code className="text-[#DFBE78]">
                      python3 ter27.py api --host 0.0.0.0 --port 8000
                    </code>
                    ) and retry connection in the top bar to render the native 300-DPI PNG directly
                    in this viewer.
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
