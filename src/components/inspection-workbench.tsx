"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { z } from "zod";
import {
  Activity, ArrowDown, ArrowDownToLine, ArrowLeft, ArrowRight, Check,
  CheckCircle2, ChevronDown, ChevronRight, Circle, Clock3, Cloud, Code2,
  ExternalLink, FileCheck2, FileText, Folder, Globe2, History, LayoutDashboard,
  ListFilter, LoaderCircle, Monitor, MoreHorizontal, Play, Plus, Radar, RefreshCw,
  Search, Settings2, ShieldCheck, Square, Trash2, Upload, Wifi, X, XCircle, AlertTriangle,
} from "lucide-react";
import {
  runInputSchema, runSchema, settingsSchema, siteSchema, statusLabels,
  type AppSettings, type Attempt, type InspectionRun, type ResultStatus,
  type RunInput, type Site, type SiteResult,
} from "../lib/contracts";

import { Evidence } from "./evidence-panel";
import { Metric, Empty, Status, ReportMenu, SearchInput } from "./workbench-primitives";
import { Settings, OptionFields } from "./workbench-settings";
import { duration, date, domain, finalAttempt, runLabel, concernStatuses } from "./presentation";

type View = "overview" | "sites" | "history" | "settings";
type Options = Pick<RunInput, "provider" | "timeoutMs" | "slowThresholdMs" | "concurrency" | "retry">;
type DialogMode = "run" | "import" | null;
const defaultOptions: Options = { provider: "local", timeoutMs: 15000, slowThresholdMs: 3000, concurrency: 3, retry: true };
const optionsSchema = runInputSchema.pick({ provider: true, timeoutMs: true, slowThresholdMs: true, concurrency: true, retry: true });
const terminalStatuses = new Set<InspectionRun["status"]>(["completed", "cancelled", "failed"]);
const navigation = [
  { id: "overview", label: "巡检总览", icon: LayoutDashboard },
  { id: "sites", label: "关注站点", icon: Globe2 },
  { id: "history", label: "巡检历史", icon: History },
  { id: "settings", label: "巡检设置", icon: Settings2 },
] satisfies { id: View; label: string; icon: typeof Activity }[];

async function api<T>(url: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const value: unknown = await response.json();
  if (!response.ok) {
    const error = z.object({ error: z.string().optional() }).safeParse(value);
    throw new Error(error.success ? error.data.error ?? `请求失败 (${response.status})` : `请求失败 (${response.status})`);
  }
  return schema.parse(value);
}
function textFromError(error: unknown): string { return error instanceof Error ? error.message : "请求未完成，请重试"; }

function splitCSV(line: string): string[] {
  const cells: string[] = [];
  let cell = "", quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (char === "," && !quoted) { cells.push(cell.trim()); cell = ""; }
    else cell += char;
  }
  cells.push(cell.trim());
  return cells;
}

function parseSites(text: string): { sites: Site[]; errors: string[]; duplicates: number } {
  const sites: Site[] = [], errors: string[] = [], seen = new Set<string>();
  let duplicates = 0;
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    if (/^(name|名称)\s*[,|]/i.test(line)) return;
    const parts = line.includes("|") ? line.split("|").map((part) => part.trim()) : line.startsWith("http") ? [line] : splitCSV(line);
    const rawUrl = parts.length === 1 ? parts[0] : parts[1];
    if (!rawUrl) { errors.push(`第 ${index + 1} 行：缺少网址`); return; }
    let url: URL;
    try { url = new URL(rawUrl); } catch { errors.push(`第 ${index + 1} 行：请输入完整的 http(s) 网址`); return; }
    if (!["http:", "https:"].includes(url.protocol)) { errors.push(`第 ${index + 1} 行：只支持 http(s) 网址`); return; }
    url.hash = "";
    if (seen.has(url.href)) { duplicates++; return; }
    const parsed = siteSchema.safeParse({ id: `site-${index}-${url.host}`, name: parts.length === 1 ? url.hostname : parts[0], url: url.href, group: parts[2] || "未分组", expectedText: parts[3] || "" });
    if (!parsed.success) { errors.push(`第 ${index + 1} 行：名称或字段超出限制`); return; }
    seen.add(url.href);
    sites.push(parsed.data);
  });
  if (sites.length > 50) errors.push("每次最多巡检 50 个站点，请拆分任务");
  return { sites, errors, duplicates };
}

export function InspectionWorkbench() {
  const [view, setView] = useState<View>("overview");
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [runs, setRuns] = useState<InspectionRun[]>([]);
  const [activeRun, setActiveRun] = useState<InspectionRun | null>(null);
  const [sites, setSites] = useState<Site[]>([]);
  const [options, setOptions] = useState<Options>(defaultOptions);
  const [initialized, setInitialized] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState("priority");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogMode>(null);
  const [draft, setDraft] = useState("");
  const [taskName, setTaskName] = useState("站点巡检");
  const [saveSites, setSaveSites] = useState(true);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      const stored = localStorage.getItem("sitewatch.sites");
      if (stored) setSites(z.array(siteSchema).parse(JSON.parse(stored)));
      const storedOptions = localStorage.getItem("sitewatch.options");
      if (storedOptions) setOptions(optionsSchema.parse(JSON.parse(storedOptions)));
    } catch { setNotice("本地保存格式已变化，请重新导入站点"); }
    void Promise.all([api("/api/settings", settingsSchema), api("/api/runs", z.array(runSchema))])
      .then(([nextSettings, nextRuns]) => {
        setSettings(nextSettings); setRuns(nextRuns);
        if (nextRuns[0]) setActiveRun(nextRuns[0]);
      }).catch((cause: unknown) => setError(textFromError(cause))).finally(() => setInitialized(true));
  }, []);

  useEffect(() => {
    if (!initialized) return;
    try { localStorage.setItem("sitewatch.sites", JSON.stringify(sites)); localStorage.setItem("sitewatch.options", JSON.stringify(options)); }
    catch { setError("浏览器无法保存关注站点，请导出或检查存储空间"); }
  }, [sites, options, initialized]);

  useEffect(() => {
    if (!activeRun || terminalStatuses.has(activeRun.status)) return;
    const id = activeRun.id;
    let stopped = false, inFlight = false;
    const poll = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const next = await api(`/api/runs/${encodeURIComponent(id)}`, runSchema);
        if (!stopped) { setActiveRun(next); setRuns((current) => current.map((run) => run.id === next.id ? next : run)); }
      } catch (cause) { if (!stopped) setError(textFromError(cause)); }
      finally { inFlight = false; }
    };
    const timer = window.setInterval(() => { void poll(); }, 1000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [activeRun?.id, activeRun?.status]);

  useEffect(() => {
    const node = dialogRef.current;
    if (dialog && node && !node.open) node.showModal();
    if (!dialog && node?.open) node.close();
  }, [dialog]);

  const parsed = useMemo(() => parseSites(draft), [draft]);
  const running = activeRun !== null && !terminalStatuses.has(activeRun.status);
  const completedCount = activeRun?.results.filter((result) => !["pending", "running"].includes(result.status)).length ?? 0;
  const concernCount = activeRun?.results.filter((result) => concernStatuses.has(result.status)).length ?? 0;
  const healthyCount = activeRun?.results.filter((result) => result.status === "healthy").length ?? 0;
  const measured = activeRun?.results.flatMap((result) => result.durationMs === null ? [] : [result.durationMs]) ?? [];
  const meanDuration = measured.length ? measured.reduce((a, b) => a + b, 0) / measured.length : null;
  const visibleResults = useMemo(() => (activeRun?.results ?? []).filter((result) => {
    const matches = `${result.site.name} ${result.site.url} ${result.site.group}`.toLowerCase().includes(search.toLowerCase());
    return matches && (filter === "all" || filter === "concern" && concernStatuses.has(result.status) || filter === result.status);
  }).toSorted((a, b) => sort === "duration" ? (b.durationMs ?? -1) - (a.durationMs ?? -1) : sort === "name" ? a.site.name.localeCompare(b.site.name) : b.priority - a.priority), [activeRun, search, filter, sort]);
  const selected = activeRun?.results.find((result) => result.site.id === selectedId) ?? visibleResults[0];
  const visibleSites = sites.filter((site) => `${site.name} ${site.url} ${site.group}`.toLowerCase().includes(search.toLowerCase()));
  const visibleRuns = runs.filter((run) => `${run.name} ${run.id}`.toLowerCase().includes(search.toLowerCase()));
  const historical = runs.filter((run) => run.status === "completed").slice(0, 7).toReversed();

  function navigate(next: View) { setView(next); setSearch(""); setError(null); }
  function openDialog(mode: Exclude<DialogMode, null>, selectedSites?: Site[]) {
    setDraft((selectedSites ?? sites).map((site) => `${site.name} | ${site.url} | ${site.group} | ${site.expectedText}`).join("\n"));
    setTaskName("站点巡检"); setDialogError(null); setSaveSites(true); setDialog(mode);
  }
  function mergeSites(next: Site[]) {
    setSites((current) => {
      const urls = new Set(current.map((site) => site.url));
      return [...current, ...next.filter((site) => !urls.has(site.url)).map((site) => ({ ...site, id: crypto.randomUUID() }))];
    });
  }
  async function startRun(nextSites: Site[], name: string, demo = false) {
    setBusy(true); setError(null);
    try {
      const input = runInputSchema.parse({ ...options, provider: demo ? "local" : options.provider, name, sites: nextSites, demo });
      const run = await api("/api/runs", runSchema, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
      setActiveRun(run); setRuns((current) => [run, ...current]); setView("overview"); setSelectedId(null); setSearch(""); setFilter("all"); setDialog(null);
      setNotice(demo ? "演示场景已启动：全部指标和截图来自本次真实浏览器执行" : "任务已启动，可以在结果列表中查看实时进度");
    } catch (cause) { const message = textFromError(cause); setError(message); setDialogError(message); }
    finally { setBusy(false); }
  }
  async function startDemo() {
    setBusy(true); setError(null);
    try {
      const demo = await api("/api/demo", z.object({ sites: z.array(siteSchema) }));
      await startRun(demo.sites, "公开演示 · 六类巡检场景", true);
    } catch (cause) { setError(textFromError(cause)); setBusy(false); }
  }
  async function cancelRun() {
    if (!activeRun) return;
    setBusy(true);
    try {
      const next = await api(`/api/runs/${encodeURIComponent(activeRun.id)}/cancel`, runSchema, { method: "POST" });
      setActiveRun(next); setRuns((current) => current.map((run) => run.id === next.id ? next : run));
    } catch (cause) { setError(textFromError(cause)); } finally { setBusy(false); }
  }
  async function removeRun(run: InspectionRun) {
    if (!window.confirm(`删除「${run.name}」及截图记录？此操作无法恢复。`)) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/runs/${encodeURIComponent(run.id)}`, { method: "DELETE" });
      if (!response.ok) throw new Error("删除失败，请确认任务已经结束");
      setRuns((current) => current.filter((item) => item.id !== run.id));
      if (activeRun?.id === run.id) setActiveRun(null);
      setNotice("已删除运行记录和证据文件");
    } catch (cause) { setError(textFromError(cause)); } finally { setBusy(false); }
  }
  function submitDialog() {
    if (!parsed.sites.length || parsed.errors.length) { setDialogError(parsed.errors[0] ?? "请至少添加一个有效网址"); return; }
    if (dialog === "import") { mergeSites(parsed.sites); setDialog(null); setNotice(`已导入 ${parsed.sites.length} 个站点，重复网址自动合并`); }
    else {
      if (!taskName.trim()) { setDialogError("请输入任务名称"); return; }
      if (saveSites) mergeSites(parsed.sites);
      void startRun(parsed.sites, taskName.trim());
    }
  }
  async function readFile(file: File | undefined) {
    if (!file) return;
    if (file.size > 250000) { setDialogError("导入文件请小于 250 KB"); return; }
    try { setDraft(await file.text()); setDialogError(null); } catch { setDialogError("文件读取失败，请粘贴内容导入"); }
  }

  return <div className="workbench">
    <a className="skip-link" href="#main-content">跳转到工作区</a>
    <aside className="sidebar">
      <a href="/" className="brand" aria-label="SitePulse 多站点巡检首页"><span className="brand-icon"><Radar size={24} /></span><span><strong lang="en">SitePulse<span className="brand-period">.</span></strong><small>多站点巡检助手</small></span></a>
      <div className="workspace-label"><span className="workspace-avatar">W</span><span>我的巡检工作台<small>本地工作空间</small></span><ChevronDown size={13} /></div>
      <span className="nav-caption">工作空间</span>
      <nav aria-label="主导航">{navigation.map(({ id, label, icon: Icon }) => <button key={id} className={`nav-item ${view === id ? "is-active" : ""}`} onClick={() => navigate(id)} aria-current={view === id ? "page" : undefined}><Icon size={17} /><span>{label}</span>{id === "sites" && <span className="nav-count">{sites.length}</span>}{id === "history" && runs.length > 0 && <span className="nav-count">{runs.length}</span>}</button>)}</nav>
      <div className="sidebar-note"><ShieldCheck size={16} /><strong>只读巡检，证据可查</strong><p>访问公开页面，记录加载表现。不会登录、填表或提交操作。</p></div>
      <div className="sidebar-bottom"><span className={`connection-dot ${initialized && !error ? "connected" : ""}`} /><span>{initialized ? "本地工作空间" : "连接工作空间"}</span><span className="version">v{settings?.version ?? "0.1"}</span></div>
    </aside>

    <div className="main-shell">
      <header className="topbar"><div className="breadcrumb"><span>工作空间</span><ChevronRight size={13} /><strong>{navigation.find((item) => item.id === view)?.label}</strong></div><div className="topbar-right"><span className="local-tag"><Monitor size={13} />{options.provider === "lexmount" ? "Lexmount 云浏览器" : "本地 Chromium"}</span><span className="topbar-avatar">D</span></div></header>
      <main id="main-content" className="main-content" tabIndex={-1}>
        <div className="page-heading"><div><div className="eyebrow"><span className="green-line" />WEBSITE OBSERVABILITY</div><h1>{view === "overview" ? "每一个站点，都有迹可循。" : view === "sites" ? "关注站点" : view === "history" ? "巡检历史" : "巡检设置"}</h1><p>{view === "overview" ? "批量访问、定位异常，用真实浏览器证据判断下一步。" : view === "sites" ? "整理需要关注的网址，为下一次巡检准备好清单。" : view === "history" ? "回看每次访问的结果、失败记录与页面证据。" : "选择执行环境，调整超时、并发与失败复验策略。"}</p></div><div className="heading-actions">{view === "sites" ? <><button className="button" onClick={() => openDialog("import")}><Upload size={15} />导入站点</button><button className="button primary" onClick={() => openDialog("run")} disabled={!sites.length || busy || running}><Play size={14} />巡检全部</button></> : view !== "settings" && <><button className="button" onClick={() => { void startDemo(); }} disabled={busy || running}><Play size={14} />演示巡检</button><button className="button primary" onClick={() => openDialog("run")} disabled={busy || running}><Plus size={16} />新建巡检</button></>}</div></div>

        {error && <div className="message error" role="alert"><AlertTriangle size={16} /><span>{error}</span><button onClick={() => setError(null)} aria-label="关闭错误提示"><X size={15} /></button></div>}
        {notice && <div className="message notice" role="status"><CheckCircle2 size={15} /><span>{notice}</span><button onClick={() => setNotice(null)} aria-label="关闭通知"><X size={15} /></button></div>}

        {!initialized ? <div className="loading-state"><LoaderCircle size={23} className="spin" /><p>正在读取巡检工作空间</p></div> : view === "overview" ? <>
          <section className="metrics-strip" aria-label="本次巡检概况">
            <Metric icon={<Globe2 size={15} />} label="本次访问站点" value={activeRun ? String(activeRun.results.length) : "0"} hint={activeRun ? `${completedCount} 个已完成` : "等待首次巡检"} />
            <Metric icon={<CheckCircle2 size={15} />} label="访问正常" value={String(healthyCount)} hint={activeRun && completedCount ? `${Math.round(healthyCount / completedCount * 100)}% 已完成站点` : "尚无访问结果"} tone="green" />
            <Metric icon={<AlertTriangle size={15} />} label="值得进一步检查" value={String(concernCount)} hint="失败、缓慢与异常页面" tone={concernCount ? "amber" : undefined} />
            <Metric icon={<Clock3 size={15} />} label="平均巡检耗时" value={meanDuration === null ? "—" : duration(meanDuration)} hint={measured.length ? `${measured.length} 个已记录样本` : "真实访问后生成"} />
          </section>

          {activeRun ? <>
            <div className="run-heading"><div><span className={`run-state ${running ? "is-running" : ""}`}>{running ? <LoaderCircle size={13} className="spin" /> : <CheckCircle2 size={13} />}{runLabel(activeRun)}</span><h2>{activeRun.name}</h2><span className="run-time">{date(activeRun.createdAt)}</span>{activeRun.demo && <span className="demo-tag">演示场景 · 真实执行</span>}</div><div className="run-actions">{running ? <button className="button compact" disabled={busy} onClick={() => { void cancelRun(); }}><Square size={12} />停止巡检</button> : <><button className="button compact" disabled={busy || !concernCount} onClick={() => { void startRun(activeRun.results.filter((result) => concernStatuses.has(result.status)).map((result) => result.site), `${activeRun.name} · 异常复检`, activeRun.demo); }}><RefreshCw size={13} />复检异常</button><ReportMenu run={activeRun} /></>}</div></div>
            {activeRun.error && <div className="message error"><AlertTriangle size={15} />{activeRun.error}</div>}
            <div className="run-progress" aria-label={`已完成 ${completedCount} / ${activeRun.results.length} 个站点`}><span style={{ width: `${activeRun.results.length ? completedCount / activeRun.results.length * 100 : 0}%` }} /></div>
            <div className="results-layout"><section className="results-panel"><div className="table-toolbar"><div className="filter-tabs"><button className={filter === "all" ? "selected" : ""} onClick={() => setFilter("all")}>全部站点 <span>{activeRun.results.length}</span></button><button className={filter === "concern" ? "selected" : ""} onClick={() => setFilter("concern")}>需要检查 <span>{concernCount}</span></button></div><div className="table-tools"><SearchInput value={search} onChange={setSearch} /><label className="sort-label"><ListFilter size={14} /><select aria-label="结果排序" value={sort} onChange={(event) => setSort(event.target.value)}><option value="priority">异常优先</option><option value="duration">耗时最长</option><option value="name">名称顺序</option></select></label></div></div>
              {visibleResults.length ? <><div className="table-scroll" tabIndex={0} aria-label="巡检结果表格，可横向滚动查看全部列"><table className="results-table"><thead><tr><th>站点 / 网址</th><th>访问状态</th><th className="numeric">加载耗时 <ArrowDown size={11} /></th><th className="numeric">HTTP</th><th>检查提示</th><th><span className="sr-only">查看证据</span></th></tr></thead><tbody>{visibleResults.map((result) => <tr key={result.site.id} className={selected?.site.id === result.site.id ? "selected-row" : ""}><td><button className="site-select" onClick={() => setSelectedId(result.site.id)}><span className={`site-icon ${result.status === "failed" ? "site-icon-failed" : ""}`}><Globe2 size={16} /></span><span><strong>{result.site.name}</strong><small>{domain(result.site.url)}<span className="site-group">{result.site.group}</span></small></span></button></td><td><Status status={result.status} />{result.attempts.length > 1 && <span className="retry-note">已复验 {result.attempts.length - 1} 次</span>}</td><td className="numeric"><span className="duration-cell">{duration(result.durationMs)}</span>{result.durationMs !== null && <span className="duration-track"><span style={{ width: `${Math.min(result.durationMs / activeRun.config.slowThresholdMs * 50, 100)}%` }} className={concernStatuses.has(result.status) ? "is-slow" : ""} /></span>}</td><td className="numeric mono">{finalAttempt(result)?.httpStatus ?? "—"}</td><td className="reason-cell">{result.reasons[0] ?? (result.status === "running" ? "正在采集浏览器证据" : result.status === "pending" ? "等待执行队列" : "无异常信号")}<small>{result.baseline.samples ? `${result.baseline.samples} 个历史基线样本` : "历史基线尚未建立"}</small></td><td><button className="icon-button" aria-label={`查看 ${result.site.name} 的证据`} onClick={() => setSelectedId(result.site.id)}><ChevronRight size={15} /></button></td></tr>)}</tbody></table></div><p className="mobile-scroll-hint" aria-hidden="true">向左滑动查看 HTTP、检查提示与证据</p></> : <Empty title="没有匹配的站点" kind="search">调整搜索或筛选条件，原始巡检结果仍然保留。</Empty>}
              <div className="table-footer"><span><span className="tiny-dot" />每个结果均附原始访问记录</span><span>显示 {visibleResults.length} / {activeRun.results.length} 项</span></div>
            </section>{selected && <Evidence result={selected} run={activeRun} />}</div>
          </> : <section className="first-run-panel"><div className="section-caption"><FileCheck2 size={16} /><span>从一次真实巡检开始</span><span className="caption-number">01</span></div><Empty title="把值得关注的网站，放进同一张清单。" action={<><button className="button primary" onClick={() => openDialog("run")}><Plus size={15} />创建首次巡检</button><button className="text-button" disabled={busy} onClick={() => { void startDemo(); }}>先试试真实演示 <ArrowRight size={14} /></button></>}>添加公开网址，或运行六个受控场景。访问状态、加载耗时和失败记录会在这里逐项出现。</Empty><div className="first-run-features"><span><Monitor size={16} />真实 Chromium 访问</span><span><RefreshCw size={16} />失败后受控复验</span><span><FileText size={16} />可导出证据报告</span></div></section>}

          <section className="history-overview"><div className="section-title"><div><h2>最近巡检趋势</h2><p>从已完成的任务查看异常分布，演示运行也会明确标记。</p></div><button className="text-button" onClick={() => navigate("history")}>查看全部历史 <ArrowRight size={14} /></button></div>{historical.length >= 2 ? <div className="history-bars">{historical.map((run) => { const concerns = run.results.filter((result) => concernStatuses.has(result.status)).length; return <button key={run.id} onClick={() => { setActiveRun(run); setSelectedId(null); }} title={`${run.name}：${concerns} 个需要检查 / ${run.results.length} 个站点`}><span className="history-bar-track"><span style={{ height: `${run.results.length ? (run.results.length - concerns) / Math.max(...historical.map((item) => item.results.length)) * 100 : 0}%` }} /><i style={{ height: `${concerns / Math.max(...historical.map((item) => item.results.length)) * 100}%` }} /></span><strong>{run.results.length}<small> / {concerns} 异常</small></strong><time>{date(run.createdAt)}</time>{run.demo && <em>演示</em>}</button>})}</div> : <div className="trend-empty"><Activity size={20} /><span>完成至少两次巡检后，显示真实趋势</span><span className="trend-empty-lines" aria-hidden="true"><i /><i /><i /><i /><i /><i /><i /></span></div>}</section>
        </> : view === "sites" ? <section className="management-panel"><div className="table-toolbar"><span className="section-label"><Folder size={16} />关注清单 <strong>{sites.length}</strong></span><SearchInput value={search} onChange={setSearch} /></div>{sites.length ? visibleSites.length ? <div className="table-scroll"><table><thead><tr><th>站点 / 网址</th><th>分组</th><th>内容断言</th><th>操作</th></tr></thead><tbody>{visibleSites.map((site) => <tr key={site.id}><td><div className="site-select"><span className="site-icon"><Globe2 size={16} /></span><span><strong>{site.name}</strong><a href={site.url} target="_blank" rel="noreferrer">{site.url} <ExternalLink size={10} /></a></span></div></td><td><span className="group-tag">{site.group}</span></td><td className="assertion-text">{site.expectedText || "未设置"}</td><td><div className="inline-actions"><button className="icon-button" aria-label={`巡检 ${site.name}`} disabled={running || busy} onClick={() => openDialog("run", [site])}><Play size={14} /></button><button className="icon-button danger-button" aria-label={`删除 ${site.name}`} onClick={() => setSites((current) => current.filter((item) => item.id !== site.id))}><Trash2 size={14} /></button></div></td></tr>)}</tbody></table></div> : <Empty title="没有找到这个站点" kind="search">试试网址、名称或分组关键词。</Empty> : <Empty title="建立你的关注清单" action={<button className="button primary" onClick={() => openDialog("import")}><Plus size={15} />添加 / 导入站点</button>}>支持逐行粘贴网址，也可导入带有名称、分组与内容断言的 TXT / CSV 文件。</Empty>}<div className="table-footer"><span>关注清单保存在当前浏览器，可随时删除。</span><button className="text-button" onClick={() => openDialog("import")}><Plus size={13} />添加站点</button></div></section> : view === "history" ? <section className="management-panel"><div className="table-toolbar"><span className="section-label"><History size={16} />运行记录 <strong>{runs.length}</strong></span><SearchInput value={search} onChange={setSearch} /></div>{visibleRuns.length ? <div className="table-scroll"><table className="history-table"><thead><tr><th>巡检任务</th><th>开始时间</th><th className="numeric">站点</th><th className="numeric">需检查</th><th>状态</th><th>报告 / 操作</th></tr></thead><tbody>{visibleRuns.map((run) => <tr key={run.id}><td><button className="run-name-button" onClick={() => { setActiveRun(run); setSelectedId(null); navigate("overview"); }}><span className="site-icon"><FileCheck2 size={17} /></span><span><strong>{run.name}</strong><small>{run.provider === "lexmount" ? "Lexmount 云浏览器" : "本地 Chromium"}{run.demo ? " · 演示场景" : ""}</small></span></button></td><td className="mono">{date(run.createdAt)}</td><td className="numeric mono">{run.results.length}</td><td className="numeric mono">{run.results.filter((result) => concernStatuses.has(result.status)).length}</td><td><span className={`run-state ${!terminalStatuses.has(run.status) ? "is-running" : ""}`}>{runLabel(run)}</span></td><td><div className="inline-actions"><a className="icon-button" href={`/api/runs/${encodeURIComponent(run.id)}/report?format=html`} aria-label={`下载 ${run.name} HTML 报告`}><ArrowDownToLine size={15} /></a><button className="icon-button" aria-label={`重新执行 ${run.name}`} disabled={running || busy} onClick={() => { void startRun(run.config.sites, `${run.name} · 再次巡检`, run.demo); }}><RefreshCw size={14} /></button><button className="icon-button danger-button" aria-label={`删除 ${run.name}`} disabled={!terminalStatuses.has(run.status) || busy} onClick={() => { void removeRun(run); }}><Trash2 size={14} /></button></div></td></tr>)}</tbody></table></div> : <Empty title={runs.length ? "没有匹配的运行记录" : "第一份巡检记录，等你开始"} kind="history" action={!runs.length && <button className="button primary" onClick={() => openDialog("run")}><Plus size={15} />新建巡检</button>}>每次任务的状态、失败复验和截图会保存在本机，方便回看与导出。</Empty>}<div className="table-footer"><span>运行记录和证据存于本地文件目录。</span><span>{visibleRuns.length} 条记录</span></div></section> : <Settings options={options} onChange={setOptions} settings={settings} />}
        <footer className="content-footer"><span><Radar size={13} />SitePulse · 让异常有依据</span><span>只读访问 <span>·</span> 本地证据 <span>·</span> 可删除记录</span></footer>
      </main>
    </div>

    <dialog ref={dialogRef} className="task-dialog" onCancel={() => setDialog(null)} onClose={() => setDialog(null)} aria-labelledby="dialog-title"><form onSubmit={(event) => { event.preventDefault(); submitDialog(); }}><div className="dialog-heading"><div><span className="eyebrow">{dialog === "import" ? "WATCHLIST" : "NEW INSPECTION"}</span><h2 id="dialog-title">{dialog === "import" ? "添加关注站点" : "创建一次巡检"}</h2></div><button type="button" className="icon-button" onClick={() => setDialog(null)} aria-label="关闭对话框"><X size={19} /></button></div><div className="dialog-body">{dialog === "run" && <label className="field-label">任务名称<input autoFocus value={taskName} maxLength={100} onChange={(event) => setTaskName(event.target.value)} placeholder="例如：产品官网周一巡检" /></label>}<div className="field-heading"><label htmlFor="site-input">站点清单</label><button type="button" className="text-button" onClick={() => fileRef.current?.click()}><Upload size={13} />导入 TXT / CSV</button><input ref={fileRef} className="sr-only" type="file" accept=".txt,.csv,text/plain,text/csv" onChange={(event) => { void readFile(event.target.files?.[0]); event.target.value = ""; }} /></div><textarea id="site-input" autoFocus={dialog === "import"} value={draft} onChange={(event) => { setDraft(event.target.value); setDialogError(null); }} spellCheck={false} placeholder={"https://example.com\nMDN 文档 | https://developer.mozilla.org/zh-CN/ | 开发文档\nPlaywright | https://playwright.dev | 开发文档 | Playwright"} rows={7} /><p className="input-help">每行一个网址，或使用 <code>名称 | 网址 | 分组 | 期望出现的文字</code>。最多 50 个站点。</p><div className="import-preview"><span><CheckCircle2 size={14} />{parsed.sites.length} 个有效站点</span>{parsed.duplicates > 0 && <span>{parsed.duplicates} 个重复已合并</span>}{parsed.errors.length > 0 && <span className="danger-text">{parsed.errors.length} 项需要修改</span>}</div>{parsed.errors.length > 0 && <ul className="validation-errors">{parsed.errors.slice(0, 4).map((message) => <li key={message}>{message}</li>)}</ul>}{dialog === "run" && <><details className="execution-options"><summary><Settings2 size={14} />执行选项<span>{options.provider === "local" ? "本地" : "云端"} · {options.concurrency} 并发 · {options.timeoutMs / 1000}s 超时</span><ChevronDown size={14} /></summary><OptionFields options={options} onChange={setOptions} settings={settings} /></details><label className="checkbox-label"><input type="checkbox" checked={saveSites} onChange={(event) => setSaveSites(event.target.checked)} />将新网址保存到关注站点</label></>}{dialogError && <p className="form-error" role="alert">{dialogError}</p>}</div><div className="dialog-footer"><span><ShieldCheck size={14} />只读访问，不执行登录或提交</span><button type="submit" className="button primary" disabled={busy || !parsed.sites.length || !!parsed.errors.length}>{busy ? <LoaderCircle size={14} className="spin" /> : dialog === "import" ? <Plus size={15} /> : <Play size={14} />}{dialog === "import" ? "添加到关注站点" : "开始巡检"}</button></div></form></dialog>
  </div>;
}
