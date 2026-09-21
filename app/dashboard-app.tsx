"use client";

import { useMemo, useRef, useState } from "react";
import {
  allocatedTripCost,
  farmNames,
  shedEconomics,
  sheds,
  tripCost,
  trips,
  type FarmName,
} from "./data";

type View = "Overview" | "Projects" | "Trips & costs" | "Scenario analysis" | "Data quality";

const views: { label: View; icon: string }[] = [
  { label: "Overview", icon: "OV" },
  { label: "Projects", icon: "PR" },
  { label: "Trips & costs", icon: "TC" },
  { label: "Scenario analysis", icon: "SA" },
  { label: "Data quality", icon: "DQ" },
];

const aud = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
  maximumFractionDigits: 0,
});

const compactAud = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
  notation: "compact",
  maximumFractionDigits: 1,
});

function pct(value: number) {
  return `${value.toFixed(1)}%`;
}

export function DashboardApp() {
  const [view, setView] = useState<View>("Overview");
  const [farm, setFarm] = useState<"All farms" | FarmName>("All farms");
  const [tripId, setTripId] = useState("All trips");
  const [period, setPeriod] = useState("All time");
  const [importOpen, setImportOpen] = useState(false);

  const availableTrips = useMemo(
    () => trips.filter((trip) => farm === "All farms" || trip.farm === farm),
    [farm],
  );
  const filteredSheds = useMemo(
    () => sheds.filter((shed) =>
      (farm === "All farms" || shed.farm === farm) &&
      (tripId === "All trips" || shed.tripId === tripId) &&
      (period === "All time" || shed.completionDate.startsWith(period))),
    [farm, tripId, period],
  );

  function changeFarm(value: "All farms" | FarmName) {
    setFarm(value);
    setTripId("All trips");
  }

  return (
    <div className="app-shell">
      <Sidebar active={view} onChange={setView} />
      <main className="main">
        <Topbar onImport={() => setImportOpen(true)} onExport={() => exportReport(filteredSheds)} />
        <div className="content">
          <MobileTabs active={view} onChange={setView} />
          <PageHeading view={view}>
            {(view === "Overview" || view === "Projects" || view === "Trips & costs") && (
              <Filters
                farm={farm}
                tripId={tripId}
                period={period}
                availableTrips={availableTrips}
                onFarmChange={changeFarm}
                onTripChange={setTripId}
                onPeriodChange={setPeriod}
              />
            )}
          </PageHeading>
          {view === "Overview" && <Overview records={filteredSheds} />}
          {view === "Projects" && <Projects records={filteredSheds} />}
          {view === "Trips & costs" && <TripsAndCosts farm={farm} selectedTrip={tripId} />}
          {view === "Scenario analysis" && <ScenarioAnalysis />}
          {view === "Data quality" && <DataQuality />}
        </div>
      </main>
      {importOpen && <ImportModal onClose={() => setImportOpen(false)} />}
    </div>
  );
}

function Sidebar({ active, onChange }: { active: View; onChange: (view: View) => void }) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">FK</div>
        <div><div className="brand-name">Filokreto</div><div className="brand-subtitle">Margin Intelligence</div></div>
      </div>
      <div className="nav-label">Workspace</div>
      <nav className="side-nav" aria-label="Primary navigation">
        {views.map((item) => (
          <button className={`nav-item ${active === item.label ? "active" : ""}`} key={item.label} onClick={() => onChange(item.label)} type="button">
            <span className="nav-icon" aria-hidden="true">{item.icon}</span><span>{item.label}</span>
          </button>
        ))}
      </nav>
      <div className="sidebar-foot">
        <div className="sync-card">
          <div className="sync-row"><span>System ready</span><span className="status-dot" aria-hidden="true" /></div>
          <p>Illustrative project data<br />Last model refresh: 21 Sep 2026</p>
        </div>
      </div>
    </aside>
  );
}

function Topbar({ onImport, onExport }: { onImport: () => void; onExport: () => void }) {
  return (
    <header className="topbar">
      <div className="mobile-brand"><span className="brand-mark">FK</span>Filokreto</div>
      <div className="breadcrumb">Australian operations&nbsp; / &nbsp;<strong>Margin monitor</strong></div>
      <div className="top-actions">
        <button className="button secondary" type="button" onClick={onExport}>Export report</button>
        <button className="button primary" type="button" onClick={onImport}>Import data</button>
        <div className="user-chip"><div className="avatar">FM</div><div className="user-copy"><strong>Filokreto Director</strong><span>Management access</span></div></div>
      </div>
    </header>
  );
}

function MobileTabs({ active, onChange }: { active: View; onChange: (view: View) => void }) {
  return (
    <nav className="mobile-tabs" aria-label="Dashboard sections">
      {views.map((item) => <button className={`mobile-tab ${active === item.label ? "active" : ""}`} key={item.label} onClick={() => onChange(item.label)} type="button">{item.label}</button>)}
    </nav>
  );
}

function PageHeading({ view, children }: { view: View; children?: React.ReactNode }) {
  const copy: Record<View, { eyebrow: string; title: string; subtitle: string }> = {
    Overview: { eyebrow: "Decision overview", title: "Australian operations", subtitle: "Logistics-inclusive performance across 52 completed floor units." },
    Projects: { eyebrow: "Portfolio detail", title: "Farm and shed performance", subtitle: "Trace every completed floor from contract revenue to final margin." },
    "Trips & costs": { eyebrow: "Allocation model", title: "Trips and shared costs", subtitle: "See how crew-trip costs are distributed across each delivery batch." },
    "Scenario analysis": { eyebrow: "Planning tool", title: "Batch-size simulator", subtitle: "Model the margin effect of completing one to six sheds per trip." },
    "Data quality": { eyebrow: "Model assurance", title: "Data quality and reconciliation", subtitle: "Monitor the checks that keep margin reporting accurate and repeatable." },
  };
  return (
    <div className="page-heading">
      <div><p className="eyebrow">{copy[view].eyebrow}</p><h1>{copy[view].title}</h1><p className="page-subtitle">{copy[view].subtitle}</p></div>
      {children}
    </div>
  );
}

function Filters({ farm, tripId, period, availableTrips, onFarmChange, onTripChange, onPeriodChange }: {
  farm: "All farms" | FarmName;
  tripId: string;
  period: string;
  availableTrips: typeof trips;
  onFarmChange: (value: "All farms" | FarmName) => void;
  onTripChange: (value: string) => void;
  onPeriodChange: (value: string) => void;
}) {
  return (
    <div className="filter-bar" aria-label="Dashboard filters">
      <div className="select-wrap"><select value={farm} onChange={(event) => onFarmChange(event.target.value as "All farms" | FarmName)} aria-label="Filter by farm"><option>All farms</option>{farmNames.map((name) => <option key={name}>{name}</option>)}</select></div>
      <div className="select-wrap"><select value={tripId} onChange={(event) => onTripChange(event.target.value)} aria-label="Filter by trip"><option>All trips</option>{availableTrips.map((trip) => <option key={trip.id}>{trip.id}</option>)}</select></div>
      <div className="select-wrap"><select value={period} onChange={(event) => onPeriodChange(event.target.value)} aria-label="Filter by period"><option>All time</option><option>2024</option><option>2025</option></select></div>
    </div>
  );
}

function Overview({ records }: { records: typeof sheds }) {
  const model = useMemo(() => summarize(records), [records]);
  const farmRows = useMemo(() => Array.from(new Set(records.map((record) => record.farm))).map((name) => ({ name, ...summarize(records.filter((item) => item.farm === name)) })), [records]);
  if (!records.length) return <div className="panel empty-note">No records match the selected filters.</div>;
  const directShare = model.totalCost ? (model.directCost / model.totalCost) * 100 : 0;

  return (
    <>
      <div className="metrics-grid">
        <Metric label="Contract revenue" value={compactAud.format(model.revenue)} note={`${records.length} completed floor units`} delta="GST exclusive" accent="#2b8064" />
        <Metric label="Total cost" value={compactAud.format(model.totalCost)} note={`${pct(directShare)} direct floor cost`} delta="AUD normalized" accent="#edae49" />
        <Metric label="Gross margin" value={pct(model.marginPct)} note={`${compactAud.format(model.margin)} contribution`} delta={`${Math.abs(model.marginPct - 50).toFixed(1)} pts below target`} warning accent="#d85d4c" />
        <Metric label="Cost per shed" value={compactAud.format(model.totalCost / records.length)} note={`${compactAud.format(model.logistics / records.length)} shared costs`} delta="Allocated by trip" accent="#758b7f" />
      </div>
      <div className="overview-grid">
        <section className="panel">
          <div className="panel-header"><div><h2>Margin by farm</h2><p>Gross margin after allocated logistics and labour</p></div><div className="legend"><span style={{ "--legend-color": "#215342" } as React.CSSProperties}>Actual</span><span style={{ "--legend-color": "#edae49" } as React.CSSProperties}>50% target</span></div></div>
          <div className="farm-chart">
            {farmRows.map((row) => (
              <div className="farm-row" key={row.name}>
                <div className="farm-name">{row.name}<span>{row.count} sheds</span></div>
                <div className="bar-track"><div className="bar-fill" style={{ width: `${Math.min(row.marginPct / 0.6, 100)}%` }} /><div className="bar-target" title="50% target" /></div>
                <div className="bar-value">{pct(row.marginPct)}</div>
              </div>
            ))}
          </div>
        </section>
        <section className="panel">
          <div className="panel-header"><div><h2>Cost composition</h2><p>Direct versus trip-allocated costs</p></div></div>
          <div className="cost-visual">
            <div className="donut" style={{ "--direct": `${directShare}%` } as React.CSSProperties}><div className="donut-copy"><strong>{pct(directShare)}</strong><span>direct cost</span></div></div>
            <div className="cost-list">
              <div className="cost-line"><span>Direct floor costs</span><strong>{compactAud.format(model.directCost)}</strong></div>
              <div className="cost-line"><span>Allocated trip costs</span><strong>{compactAud.format(model.logistics)}</strong></div>
              <div className="cost-line"><span>Cost-to-revenue ratio</span><strong>{pct(100 - model.marginPct)}</strong></div>
            </div>
          </div>
        </section>
      </div>
      <ProjectTable records={records.slice(0, 7)} title="Recent completed sheds" subtitle="Per-shed cost and margin after trip allocation" />
    </>
  );
}

function Metric({ label, value, note, delta, warning, accent }: { label: string; value: string; note: string; delta: string; warning?: boolean; accent: string }) {
  return <article className="metric-card" style={{ "--accent": accent } as React.CSSProperties}><div className="metric-top"><span>{label}</span><span className={`delta ${warning ? "warn" : ""}`}>{delta}</span></div><div className="metric-value">{value}</div><div className="metric-note">{note}</div></article>;
}

function Projects({ records }: { records: typeof sheds }) {
  const [query, setQuery] = useState("");
  const visible = records.filter((record) => `${record.id} ${record.farm} ${record.tripId}`.toLowerCase().includes(query.toLowerCase()));
  const totals = summarize(records);
  return (
    <>
      <div className="project-summary">
        <div className="summary-item"><span>Floor units</span><strong>{records.length}</strong></div>
        <div className="summary-item"><span>Farms</span><strong>{new Set(records.map((item) => item.farm)).size}</strong></div>
        <div className="summary-item"><span>Total area</span><strong>{Math.round(records.reduce((sum, item) => sum + item.areaSqm, 0) / 1000)}k m²</strong></div>
        <div className="summary-item"><span>Margin</span><strong>{pct(totals.marginPct)}</strong></div>
      </div>
      <div className="panel table-panel"><div className="panel-header"><div><h2>Project register</h2><p>{visible.length} matching records</p></div><input className="search-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search shed or trip" aria-label="Search projects" /></div><ProjectRows records={visible} /></div>
    </>
  );
}

function ProjectTable({ records, title, subtitle }: { records: typeof sheds; title: string; subtitle: string }) {
  return <section className="panel table-panel"><div className="panel-header"><div><h2>{title}</h2><p>{subtitle}</p></div><span className="delta">Illustrative data</span></div><ProjectRows records={records} /></section>;
}

function ProjectRows({ records }: { records: typeof sheds }) {
  if (!records.length) return <div className="empty-note">No project records found.</div>;
  return (
    <div className="data-table-wrap"><table className="data-table">
      <thead><tr><th>Shed</th><th>Farm</th><th>Trip</th><th>Revenue</th><th>Total cost</th><th>Margin</th><th>Status</th></tr></thead>
      <tbody>{records.map((shed) => {
        const economics = shedEconomics(shed);
        return <tr key={shed.id}><td className="id-cell">{shed.id}<span className="sub-cell">{shed.areaSqm.toLocaleString()} m²</span></td><td>{shed.farm}</td><td>{shed.tripId}</td><td>{aud.format(shed.revenue)}</td><td>{aud.format(economics.totalCost)}</td><td><span className={`margin-pill ${economics.marginPct >= 50 ? "good" : "low"}`}>{pct(economics.marginPct)}</span></td><td><span className="status-pill complete">Complete</span></td></tr>;
      })}</tbody>
    </table></div>
  );
}

function TripsAndCosts({ farm, selectedTrip }: { farm: "All farms" | FarmName; selectedTrip: string }) {
  const visibleTrips = trips.filter((trip) => (farm === "All farms" || trip.farm === farm) && (selectedTrip === "All trips" || trip.id === selectedTrip));
  const total = visibleTrips.reduce((sum, trip) => sum + tripCost(trip), 0);
  const components = [
    ["NZ labour", visibleTrips.reduce((sum, item) => sum + item.nzLabour, 0)],
    ["AU-side costs", visibleTrips.reduce((sum, item) => sum + item.auCost, 0)],
    ["Flights", visibleTrips.reduce((sum, item) => sum + item.flightCost, 0)],
    ["Accommodation", visibleTrips.reduce((sum, item) => sum + item.accommodation, 0)],
    ["Allowances", visibleTrips.reduce((sum, item) => sum + item.allowance, 0)],
  ] as const;
  return (
    <div className="section-grid">
      <section className="panel"><div className="panel-header"><div><h2>Trip allocation register</h2><p>Shared cost divided evenly by completed sheds</p></div><span className="delta">{visibleTrips.length} trips</span></div>
        {visibleTrips.map((trip) => <article className="trip-card" key={trip.id}><div className="trip-card-top"><div><h3>{trip.id} · {trip.farm}</h3><p>{formatDate(trip.startDate)} – {formatDate(trip.endDate)}</p></div><span className="status-pill complete">Reconciled</span></div><div className="trip-stats"><div className="trip-stat"><span>Batch</span><strong>{trip.batchSize} sheds</strong></div><div className="trip-stat"><span>Shared cost</span><strong>{aud.format(tripCost(trip))}</strong></div><div className="trip-stat"><span>Per shed</span><strong>{aud.format(allocatedTripCost(trip))}</strong></div></div></article>)}
      </section>
      <section className="panel"><div className="panel-header"><div><h2>Shared-cost breakdown</h2><p>{compactAud.format(total)} allocated across the selected trips</p></div></div><div className="farm-chart">
        {components.map(([label, value]) => <div className="farm-row" key={label}><div className="farm-name">{label}<span>{total ? pct((value / total) * 100) : "0.0%"} of trip cost</span></div><div className="bar-track"><div className="bar-fill" style={{ width: `${total ? (value / total) * 100 : 0}%` }} /></div><div className="bar-value">{compactAud.format(value)}</div></div>)}
      </div></section>
    </div>
  );
}

function ScenarioAnalysis() {
  const [batch, setBatch] = useState(4);
  const [revenue, setRevenue] = useState(88500);
  const [direct, setDirect] = useState(45800);
  const [trip, setTrip] = useState(32500);
  const costPerShed = direct + trip / batch;
  const margin = revenue - costPerShed;
  const marginPct = (margin / revenue) * 100;
  const gap = marginPct - 50;
  const scenarios = Array.from({ length: 6 }, (_, index) => ({ size: index + 1, value: ((revenue - direct - trip / (index + 1)) / revenue) * 100 }));
  return (
    <div className="scenario-layout">
      <section className="panel"><div className="panel-header"><div><h2>Scenario assumptions</h2><p>Adjust the commercial and trip inputs</p></div></div>
        <RangeControl label="Sheds completed per trip" value={`${batch}`} min={1} max={6} step={1} current={batch} onChange={setBatch} />
        <RangeControl label="Revenue per shed" value={aud.format(revenue)} min={70000} max={110000} step={500} current={revenue} onChange={setRevenue} />
        <RangeControl label="Direct cost per shed" value={aud.format(direct)} min={30000} max={60000} step={500} current={direct} onChange={setDirect} />
        <RangeControl label="Fixed trip cost" value={aud.format(trip)} min={10000} max={50000} step={500} current={trip} onChange={setTrip} />
      </section>
      <section className="panel scenario-result"><div className="scenario-kicker">Projected gross margin</div><div className="scenario-big">{pct(marginPct)}</div><div className="scenario-caption">{gap >= 0 ? `${gap.toFixed(1)} points above` : `${Math.abs(gap).toFixed(1)} points below`} the 50% target</div>
        <div className="scenario-cards"><div className="scenario-mini"><span>Cost per shed</span><strong>{aud.format(costPerShed)}</strong></div><div className="scenario-mini"><span>Margin per shed</span><strong>{aud.format(margin)}</strong></div><div className="scenario-mini"><span>Trip cost per shed</span><strong>{aud.format(trip / batch)}</strong></div></div>
        <div className="scenario-bars" aria-label="Projected margin by batch size">{scenarios.map((scenario) => <div className="scenario-bar-wrap" key={scenario.size} title={`${scenario.size} sheds: ${pct(scenario.value)}`}><div className={`scenario-bar ${scenario.size === batch ? "active" : ""}`} style={{ height: `${Math.max(8, scenario.value * 2.4)}px` }} /><span>{scenario.size}</span></div>)}</div>
      </section>
    </div>
  );
}

function RangeControl({ label, value, min, max, step, current, onChange }: { label: string; value: string; min: number; max: number; step: number; current: number; onChange: (value: number) => void }) {
  return <div className="control-group"><div className="control-row"><label>{label}</label><span className="control-value">{value}</span></div><input className="range" type="range" min={min} max={max} step={step} value={current} onChange={(event) => onChange(Number(event.target.value))} aria-label={label} /></div>;
}

function DataQuality() {
  const checks = [
    ["Unique shed identifiers", "52 of 52 records have a valid Shed ID"],
    ["Trip linkage", "Every completed shed maps to one crew trip"],
    ["FX rate coverage", "Monthly NZD-to-AUD reference rates are present"],
    ["GST treatment", "All imported values are marked GST exclusive"],
    ["Allocation reconciliation", "Allocated trip totals equal source trip costs"],
    ["Repeatability", "Repeated model refreshes produce identical totals"],
  ];
  return (
    <><div className="quality-grid"><article className="quality-card"><div className="quality-icon">AC</div><strong>100%</strong><p>Records pass required identity and relationship checks.</p></article><article className="quality-card"><div className="quality-icon">±</div><strong>0.0%</strong><p>Current reconciliation variance across the illustrative dataset.</p></article><article className="quality-card"><div className="quality-icon">FX</div><strong>18</strong><p>Monthly exchange-rate periods ready for NZD conversion.</p></article></div>
      <section className="panel"><div className="panel-header"><div><h2>Validation controls</h2><p>Checks run before records enter margin reporting</p></div><span className="delta">All checks passed</span></div><div className="check-list">{checks.map(([title, description]) => <div className="check-item" key={title}><span className="check-mark" aria-hidden="true">✓</span><div className="check-copy"><strong>{title}</strong><span>{description}</span></div><span className="check-state">Passed</span></div>)}</div></section></>
  );
}

function ImportModal({ onClose }: { onClose: () => void }) {
  const [source, setSource] = useState("Shed master");
  const [fileName, setFileName] = useState("");
  const [staged, setStaged] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const sources = [["Shed master", "Revenue and direct costs"], ["Trip log", "Flights, labour and allowances"], ["NZ invoices", "Intercompany NZD records"], ["AU Xero costs", "Australian-side expenses"], ["FX rates", "Monthly conversion rates"]];
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="import-title"><div className="modal-header"><div><h2 id="import-title">Import source data</h2><p>Select the dataset, then attach its latest Excel or CSV export.</p></div><button className="close-button" type="button" onClick={onClose} aria-label="Close import dialog">×</button></div>
        <div className="modal-body"><div className="source-grid">{sources.map(([title, description]) => <button className={`source-option ${source === title ? "selected" : ""}`} type="button" key={title} onClick={() => setSource(title)}><strong>{title}</strong><span>{description}</span></button>)}</div>
          <div className="drop-zone"><strong>{source} file</strong><span>Accepted formats: .xlsx and .csv</span><input ref={fileRef} type="file" accept=".xlsx,.csv" hidden onChange={(event) => { setFileName(event.target.files?.[0]?.name ?? ""); setStaged(false); }} /><button className="button secondary" type="button" onClick={() => fileRef.current?.click()}>Choose file</button>{fileName && <div className="file-name">Ready to validate: {fileName}</div>}{fileName && <button className="button primary import-action" type="button" onClick={() => setStaged(true)}>Stage for validation</button>}{staged && <div className="staged-note">File staged. Persistent import processing will be connected to the approved database.</div>}</div>
        </div>
      </section>
    </div>
  );
}

function summarize(records: typeof sheds) {
  return records.reduce((summary, shed) => {
    const economics = shedEconomics(shed);
    summary.count += 1;
    summary.revenue += shed.revenue;
    summary.directCost += shed.directCost;
    summary.logistics += economics.logistics;
    summary.totalCost += economics.totalCost;
    summary.margin += economics.margin;
    summary.marginPct = summary.revenue ? (summary.margin / summary.revenue) * 100 : 0;
    return summary;
  }, { count: 0, revenue: 0, directCost: 0, logistics: 0, totalCost: 0, margin: 0, marginPct: 0 });
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}

function exportReport(records: typeof sheds) {
  const header = ["Shed ID", "Farm", "Trip ID", "Area sqm", "Revenue AUD", "Direct Cost AUD", "Allocated Trip Cost AUD", "Total Cost AUD", "Margin AUD", "Margin Percent"];
  const rows = records.map((shed) => {
    const economics = shedEconomics(shed);
    return [shed.id, shed.farm, shed.tripId, shed.areaSqm, shed.revenue, shed.directCost, economics.logistics.toFixed(2), economics.totalCost.toFixed(2), economics.margin.toFixed(2), economics.marginPct.toFixed(2)];
  });
  const csv = [header, ...rows].map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "filokreto-margin-report.csv";
  link.click();
  URL.revokeObjectURL(url);
}
