import type { ReactNode } from "react";
import { CheckCircle2, XCircle, LoaderCircle, AlertTriangle, Circle, History, Search, Radar, X, ArrowDownToLine, ChevronDown, FileText } from "lucide-react";
import { statusLabels, type ResultStatus, type InspectionRun } from "../lib/contracts";
import { concernStatuses } from "./presentation";

export function Status({ status }: { status: ResultStatus }) {
  const Icon = status === "healthy" ? CheckCircle2 : status === "failed" ? XCircle : status === "running" ? LoaderCircle : concernStatuses.has(status) ? AlertTriangle : Circle;
  return <span className={`status status-${status}`}><Icon size={13} className={status === "running" ? "spin" : ""} />{statusLabels[status]}</span>;
}
export function Empty({ title, children, action, kind = "sites" }: { title: string; children: ReactNode; action?: ReactNode; kind?: "sites" | "history" | "search" }) {
  return <div className="empty-state">
    <div className="empty-visual" aria-hidden="true">
      <div className="empty-row"><span className="empty-dot" /><span /><i /></div>
      <div className="empty-row"><span className="empty-dot" /><span /><i /></div>
      <div className="empty-row"><span className="empty-dot" /><span /><i /></div>
      <div className="empty-symbol">{kind === "history" ? <History size={24} /> : kind === "search" ? <Search size={24} /> : <Radar size={25} />}</div>
    </div>
    <h2>{title}</h2><p>{children}</p>{action && <div className="empty-actions">{action}</div>}
  </div>;
}

export function Metric({ icon, label, value, hint, tone }: { icon: ReactNode; label: string; value: string; hint: string; tone?: string }) {
  return <div className={`metric ${tone ?? ""}`}><span className="metric-label">{icon}{label}</span><strong>{value}</strong><small>{hint}</small></div>;
}
export function SearchInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <label className="search-box"><Search size={14} /><input aria-label="搜索名称、网址或分组" placeholder="搜索站点 / 名称" value={value} onChange={(event) => onChange(event.target.value)} />{value && <button type="button" aria-label="清除搜索" onClick={() => onChange("")}><X size={13} /></button>}</label>;
}
export function ReportMenu({ run }: { run: InspectionRun }) {
  return <details className="report-menu"><summary className="button compact"><ArrowDownToLine size={13} />导出报告<ChevronDown size={12} /></summary><div>{["html", "json", "csv"].map((format) => <a key={format} href={`/api/runs/${encodeURIComponent(run.id)}/report?format=${format}`}><FileText size={13} />{format.toUpperCase()} 报告<ArrowDownToLine size={12} /></a>)}</div></details>;
}
