import React, { useEffect, useMemo, useState } from "react";
import {
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
  { label: "TeR26 Yaw Correlation", value: "98.4%", detail: "OOS wz R^2 = 0.9539" },
  { label: "Python-Godot 3D Parity", value: "0.529%", detail: "14-DOF closed-loop" },
  { label: "C99 SIL Error", value: "0.0 abs", detail: "Bit-exact controller" },
  { label: "STM32F405 CPU @ 200Hz", value: "6.12%", detail: "Real-time ECU budget" },
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

  // Full-screen artifact viewer state
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
    return (
      catalog.suites.find((s) => s.code === selectedSuiteCode) ?? filteredSuites[0] ?? null
    );
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
      <div className="w-full h-full flex items-center justify-center bg-[#08090C] font-mono text-[11px] text-[#7E8799]">
        Loading TeR27 Validation Vault catalog...
      </div>
    );
  }

  return (
    <div className="w-full h-full min-h-0 flex flex-col overflow-hidden bg-[#08090C]">
      {/* Screen Interactive Workspace */}
      <div className="w-full h-full min-h-0 flex flex-col no-print">
        {/* Top Audit & Parity KPI Strip */}
        <div className="shrink-0 bg-[#0F1116] border-b border-[#222633]">
          <div className="panel-header-bar gap-2">
            <div className="flex items-center gap-2">
              <span className="panel-title-label">
                Validation Vault // {catalog.n_suites} Suites · {catalog.total_pngs} Figures (
                {catalog.total_png_size_mb.toFixed(1)} MB)
              </span>
              <span className="text-[10px] font-mono text-[#7E8799]">{catalog.standard}</span>
            </div>

            <div className="flex items-center gap-1.5 font-mono text-[10px]">
              <button
                type="button"
                onClick={() => setDossierPreviewOpen((v) => !v)}
                className={`flex items-center gap-1 px-2 py-0.5 border rounded-[2px] cursor-pointer ${
                  dossierPreviewOpen
                    ? "border-[#C5A059] text-[#C5A059] bg-[#1B1F2A]"
                    : "border-[#222633] bg-[#08090C] text-[#ECEFF4]"
                }`}
              >
                <FileText className="w-3 h-3" />
                Design Event Dossier ({dossierSelection.length})
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className="flex items-center gap-1 px-2 py-0.5 bg-[#C5A059] text-[#08090C] font-semibold rounded-[2px] cursor-pointer"
              >
                <Printer className="w-3 h-3" />
                Print Dossier
              </button>
            </div>
          </div>

          <div className="grid grid-cols-6 divide-x divide-[#222633] bg-[#151820] font-mono">
            {AUDIT_HEADLINE_KPIS.map((kpi) => (
              <div key={kpi.label} className="px-2.5 py-1.5">
                <div className="text-[9px] text-[#7E8799] uppercase truncate">{kpi.label}</div>
                <div className="text-[13px] font-semibold text-[#10B981] mt-0.5">{kpi.value}</div>
                <div className="text-[9px] text-[#7E8799] truncate">{kpi.detail}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Search & Tag Filter Bar */}
        <div className="shrink-0 bg-[#0F1116] border-b border-[#222633] px-2.5 py-1.5 flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 bg-[#08090C] border border-[#222633] px-2 py-0.5 rounded-[2px] w-[280px]">
            <Search className="w-3 h-3 text-[#7E8799]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search suites, KPIs, or figure titles..."
              className="w-full bg-transparent text-[#ECEFF4] font-mono text-[11px] outline-none placeholder:text-[#7E8799]"
            />
          </div>

          <div className="flex items-center gap-1 flex-wrap font-mono text-[10px]">
            {tags.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => setSelectedTag(tag)}
                className={`px-2 py-0.5 border rounded-[2px] cursor-pointer ${
                  selectedTag === tag
                    ? "border-[#C5A059] text-[#C5A059] bg-[#1B1F2A]"
                    : "border-[#222633] text-[#7E8799] bg-[#08090C] hover:text-[#ECEFF4]"
                }`}
              >
                {tag}
              </button>
            ))}
          </div>
        </div>

        {/* Main SplitPane: Suite Browser List + Detailed Metric & Figure Drawer */}
        <div className="flex-1 min-h-0 overflow-hidden">
          {dossierPreviewOpen ? (
            <div className="w-full h-full overflow-y-auto p-4 bg-[#08090C]">
              <div className="max-w-[960px] mx-auto bg-[#0F1116] border border-[#222633] p-4 space-y-4">
                <div className="flex items-center justify-between border-b border-[#222633] pb-2">
                  <div>
                    <h2 className="text-[14px] font-semibold text-[#ECEFF4] m-0">
                      TeR27 4WD — Formula Student Engineering Design Event Dossier
                    </h2>
                    <div className="text-[10px] font-mono text-[#7E8799] mt-0.5">
                      Selected Suites: {dossierSuites.map((s) => s.code).join(", ")} · Generated{" "}
                      {catalog.generated_utc}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDossierPreviewOpen(false)}
                    className="px-2 py-1 text-[10px] font-mono border border-[#222633] text-[#ECEFF4] hover:border-[#C5A059] cursor-pointer"
                  >
                    Return to Vault
                  </button>
                </div>

                {dossierSuites.map((suite) => (
                  <div key={suite.code} className="border border-[#222633] bg-[#151820] p-3 space-y-2">
                    <div className="flex items-baseline justify-between">
                      <div className="text-[12px] font-semibold text-[#C5A059]">
                        Suite {suite.code} — {suite.title}
                      </div>
                      <span className="text-[10px] font-mono text-[#7E8799]">{suite.tag}</span>
                    </div>
                    <p className="text-[11px] text-[#7E8799] m-0">{suite.subtitle}</p>
                    <div className="grid grid-cols-5 gap-2 pt-1 font-mono text-[10px]">
                      {suite.kpis.map((kpi) => (
                        <div key={kpi.label} className="bg-[#0F1116] border border-[#222633] px-2 py-1">
                          <div className="text-[9px] text-[#7E8799] truncate">{kpi.label}</div>
                          <div className="text-[#10B981] font-semibold">{kpi.value}</div>
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
              initialRatio={0.44}
              minRatio={0.3}
              maxRatio={0.62}
              first={
                <div className="w-full h-full min-h-0 overflow-y-auto divide-y divide-[#222633] bg-[#0F1116]">
                  {filteredSuites.map((suite) => {
                    const isActive = selectedSuite?.code === suite.code;
                    const inDossier = dossierSelection.includes(suite.code);
                    return (
                      <div
                        key={suite.code}
                        onClick={() => setSelectedSuiteCode(suite.code)}
                        className={`p-2.5 cursor-pointer transition-colors ${
                          isActive ? "bg-[#1B1F2A]" : "bg-[#0F1116] hover:bg-[#151820]"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 font-mono text-[10px]">
                              <span
                                className={
                                  isActive
                                    ? "text-[#C5A059] font-semibold"
                                    : "text-[#7E8799] font-semibold"
                                }
                              >
                                SUITE {suite.code}
                              </span>
                              <span className="text-[#7E8799]">/</span>
                              <span className="text-[#7E8799]">{suite.tag}</span>
                              <span className="text-[#7E8799]">/</span>
                              <span className="text-[#ECEFF4]">{suite.n_figures} FIGS</span>
                            </div>
                            <div className="text-[12px] font-semibold text-[#ECEFF4] mt-0.5">
                              {suite.title}
                            </div>
                            <div className="text-[10px] text-[#7E8799] mt-0.5 line-clamp-2">
                              {suite.subtitle}
                            </div>
                          </div>

                          <label
                            onClick={(e) => e.stopPropagation()}
                            title="Include in Design Event Dossier"
                            className="flex items-center gap-1 text-[9px] font-mono text-[#7E8799] shrink-0 cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={inDossier}
                              onChange={() => toggleDossierSuite(suite.code)}
                              className="accent-[#C5A059]"
                            />
                            DOSSIER
                          </label>
                        </div>

                        {/* Unboxed typographic KPI summary */}
                        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[10px]">
                          {suite.kpis.slice(0, 3).map((kpi) => (
                            <span key={kpi.label} className="text-[#7E8799]">
                              {kpi.label}:{" "}
                              <strong className="text-[#10B981] font-medium">{kpi.value}</strong>
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
                  <div className="w-full h-full min-h-0 flex flex-col bg-[#08090C] overflow-y-auto">
                    <div className="panel-header-bar">
                      <span className="panel-title-label">
                        Suite {selectedSuite.code} Inspection — {selectedSuite.title}
                      </span>
                      <span className="text-[10px] font-mono text-[#7E8799]">
                        {selectedSuite.folder}
                      </span>
                    </div>

                    <div className="p-3 space-y-3">
                      <p className="text-[11px] text-[#7E8799] m-0 leading-relaxed">
                        {selectedSuite.subtitle}
                      </p>

                      {/* Verified KPI Matrix */}
                      <div className="grid grid-cols-3 gap-2 font-mono text-[10px]">
                        {selectedSuite.kpis.map((kpi) => (
                          <div
                            key={kpi.label}
                            className="bg-[#0F1116] border border-[#222633] px-2.5 py-1.5"
                          >
                            <div className="text-[9px] text-[#7E8799] uppercase">{kpi.label}</div>
                            <div className="flex items-baseline justify-between mt-0.5">
                              <span className="text-[12px] font-semibold text-[#ECEFF4]">
                                {kpi.value}
                              </span>
                              <span className="text-[9px] text-[#10B981]">
                                {kpi.status.toUpperCase()}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* Primary Metrics JSON & Data Files */}
                      <div className="bg-[#0F1116] border border-[#222633] px-2.5 py-1.5 font-mono text-[10px] text-[#7E8799]">
                        SOURCE METRICS:{" "}
                        <span className="text-[#ECEFF4]">
                          {catalog.vault_root}/{selectedSuite.primary_metrics_json ?? "—"}
                        </span>
                      </div>

                      {/* 300-DPI Figure Artifacts Grid */}
                      <div className="space-y-1.5">
                        <div className="text-[10px] font-semibold uppercase tracking-[0.06em] text-[#7E8799]">
                          300-DPI Engineering Artifacts ({selectedSuite.figures.length})
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          {selectedSuite.figures.map((fig) => (
                            <button
                              key={fig.filename}
                              type="button"
                              onClick={() => openViewer(selectedSuite, fig)}
                              className="text-left bg-[#0F1116] border border-[#222633] hover:border-[#C5A059] p-2.5 rounded-[2px] cursor-pointer transition-colors flex flex-col justify-between gap-2"
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="text-[11px] font-semibold text-[#ECEFF4] leading-snug">
                                  {fig.title}
                                </div>
                                <Maximize2 className="w-3 h-3 text-[#C5A059] shrink-0 mt-0.5" />
                              </div>

                              <div className="font-mono text-[9px] text-[#7E8799] space-y-0.5">
                                <div className="truncate text-[#C5A059]">
                                  {catalog.vault_root}/{fig.rel_path}
                                </div>
                                <div className="flex justify-between">
                                  <span>
                                    {fig.width_px} x {fig.height_px} px
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

      {/* Full-Screen Zoomable Artifact Viewer Modal */}
      {viewerItem ? (
        <div
          className="fixed inset-0 z-50 bg-black/85 flex flex-col no-print"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setViewerItem(null);
          }}
        >
          <div className="h-[36px] shrink-0 bg-[#0F1116] border-b border-[#222633] px-3 flex items-center justify-between font-mono text-[11px]">
            <div className="flex items-center gap-3 truncate">
              <span className="text-[#C5A059] font-semibold">
                SUITE {viewerItem.suite.code}
              </span>
              <span className="text-[#ECEFF4] truncate">{viewerItem.figure.title}</span>
              <span className="text-[#7E8799] text-[10px]">
                {viewerItem.figure.width_px} x {viewerItem.figure.height_px} px ·{" "}
                {viewerItem.figure.size_kb.toFixed(1)} KB
              </span>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {!imgFailed ? (
                <>
                  <button
                    type="button"
                    onClick={() => setZoomScale((z) => Math.max(0.5, z - 0.25))}
                    className="p-1 border border-[#222633] text-[#ECEFF4] hover:border-[#C5A059] cursor-pointer"
                  >
                    <ZoomOut className="w-3.5 h-3.5" />
                  </button>
                  <span className="text-[10px] w-[42px] text-center">
                    {Math.round(zoomScale * 100)}%
                  </span>
                  <button
                    type="button"
                    onClick={() => setZoomScale((z) => Math.min(3, z + 0.25))}
                    className="p-1 border border-[#222633] text-[#ECEFF4] hover:border-[#C5A059] cursor-pointer"
                  >
                    <ZoomIn className="w-3.5 h-3.5" />
                  </button>
                </>
              ) : null}
              <button
                type="button"
                onClick={() => setViewerItem(null)}
                className="p-1 border border-[#222633] text-[#ECEFF4] hover:border-[#C5A059] cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
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
                className="max-w-full max-h-full border border-[#222633] transition-transform"
              />
            ) : (
              /* Structured KPI Specification Card with Backend Figure Path (Confirmed Offline Mode) */
              <div className="w-[740px] max-w-full bg-[#0F1116] border border-[#222633] rounded-[2px] overflow-hidden font-mono">
                <div className="px-4 py-2.5 bg-[#151820] border-b border-[#222633] flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-[#C5A059]">
                    OFFLINE ARTIFACT SPECIFICATION CARD // 300 DPI FIGURE
                  </span>
                  <span className="text-[10px] text-[#D97706]">LOCAL BACKEND REQUIRED FOR PNG</span>
                </div>
                <div className="p-4 space-y-4 text-[11px]">
                  <div>
                    <div className="text-[14px] font-sans font-semibold text-[#ECEFF4]">
                      {viewerItem.figure.title}
                    </div>
                    <div className="text-[10px] text-[#7E8799] mt-1">
                      Suite {viewerItem.suite.code}: {viewerItem.suite.title}
                    </div>
                  </div>

                  <div className="bg-[#08090C] border border-[#222633] p-3 space-y-1.5 text-[10px]">
                    <div className="flex justify-between">
                      <span className="text-[#7E8799]">BACKEND ASSET PATH</span>
                      <span className="text-[#C5A059]">
                        {catalog.vault_root}/{viewerItem.figure.rel_path}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#7E8799]">NATIVE RESOLUTION</span>
                      <span className="text-[#ECEFF4]">
                        {viewerItem.figure.width_px} x {viewerItem.figure.height_px} px (300 DPI)
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#7E8799]">FILE SIZE</span>
                      <span className="text-[#ECEFF4]">
                        {viewerItem.figure.size_kb.toFixed(1)} KB
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#7E8799]">PRIMARY METRICS SOURCE</span>
                      <span className="text-[#ECEFF4]">
                        {viewerItem.suite.primary_metrics_json ?? "N/A"}
                      </span>
                    </div>
                  </div>

                  <div>
                    <div className="text-[10px] text-[#7E8799] uppercase mb-1.5">
                      Associated Suite {viewerItem.suite.code} Verified KPIs
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {viewerItem.suite.kpis.map((kpi) => (
                        <div
                          key={kpi.label}
                          className="bg-[#151820] border border-[#222633] px-3 py-2 flex items-center justify-between"
                        >
                          <span className="text-[#7E8799] text-[10px]">{kpi.label}</span>
                          <span className="text-[#10B981] font-semibold">{kpi.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="text-[10px] text-[#7E8799] border-t border-[#222633] pt-2.5">
                    Start the local FastAPI server (`python3 ter27.py api --host 0.0.0.0 --port 8000`)
                    and click Retry in the top bar to render the full 300-DPI PNG artifact directly in
                    this viewer.
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
