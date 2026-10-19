import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { type InspectionRun, type RunInput, type SiteResult } from "./contracts";
import { openBrowser } from "./browser";
import { inspectSite } from "./inspector";
import { dataDir, listRuns, readRun, saveRun } from "./store";
import { redactText, redactUrl, validatePublicUrl } from "./security";

type ActiveRun = { run: InspectionRun; controller: AbortController; writes: Promise<void> };
declare global { var sitepulseActiveRuns: Map<string, ActiveRun> | undefined; }
const activeRuns = globalThis.sitepulseActiveRuns ??= new Map<string, ActiveRun>();

function persist(active: ActiveRun): Promise<void> {
  const snapshot = structuredClone(active.run);
  active.writes = active.writes.then(() => saveRun(snapshot));
  return active.writes;
}

function pendingResult(site: RunInput["sites"][number]): SiteResult {
  return { site, status: "pending", attempts: [], durationMs: null, priority: 0, reasons: [], baseline: { samples: 0, medianMs: null, madMs: null, thresholdMs: null, anomalous: false } };
}

export async function createRun(config: RunInput, demoOrigin: string): Promise<InspectionRun> {
  if (activeRuns.size) throw new Error("已有巡检正在执行，请等待完成或取消后再开始");
  if (config.demo && config.provider !== "local") throw new Error("受控演示场景需使用本地 Chromium");
  if (new Set(config.sites.map((site) => site.id)).size !== config.sites.length) throw new Error("站点 ID 不能重复");
  if (new Set(config.sites.map((site) => site.url)).size !== config.sites.length) throw new Error("同一个网址在一轮巡检中只能出现一次");
  for (const site of config.sites) {
    await validatePublicUrl(site.url, { allowDemo: config.demo, demoOrigin });
    const url = new URL(site.url);
    if ([...url.searchParams.keys()].some((key) => /key|token|secret|password|passwd|cookie|auth|session|code|signature|credential/i.test(key))) throw new Error("公开巡检的网址不能包含密钥或登录凭据，请移除敏感查询参数");
    site.url = redactUrl(site.url);
  }
  // Validate the whole batch before claiming the process-local execution slot.
  if (activeRuns.size) throw new Error("已有巡检正在执行，请等待完成或取消后再开始");
  const run: InspectionRun = {
    id: randomUUID(), name: config.name, status: "queued", createdAt: new Date().toISOString(), finishedAt: null,
    provider: config.provider, demo: config.demo, config, results: config.sites.map(pendingResult),
    sessionId: null, inspectUrl: null, replayUrl: null, error: null,
  };
  const active: ActiveRun = { run, controller: new AbortController(), writes: Promise.resolve() };
  activeRuns.set(run.id, active);
  try { await persist(active); } catch (error) { activeRuns.delete(run.id); throw error; }
  void execute(active, demoOrigin);
  return structuredClone(run);
}

export async function getRun(id: string): Promise<InspectionRun | null> {
  const active = activeRuns.get(id);
  if (active) return structuredClone(active.run);
  const run = await readRun(id);
  if (run && (run.status === "queued" || run.status === "running")) {
    run.status = "failed";
    run.error = "服务已重启，上一次巡检中断；已有证据已保留，请重新执行。";
    run.finishedAt = new Date().toISOString();
    for (const result of run.results) if (["pending", "running"].includes(result.status)) {
      result.status = "failed";
      result.priority = 100;
      result.reasons = ["服务重启导致此站点未完成访问"];
    }
    await saveRun(run);
  }
  return run;
}

export async function cancelRun(id: string): Promise<InspectionRun | null> {
  const active = activeRuns.get(id);
  if (!active) return readRun(id);
  active.controller.abort();
  return structuredClone(active.run);
}

export function isActive(id: string): boolean { return activeRuns.has(id); }

async function execute(active: ActiveRun, demoOrigin: string): Promise<void> {
  const { run, controller } = active;
  let session: Awaited<ReturnType<typeof openBrowser>> | undefined;
  let terminalStatus: Extract<InspectionRun["status"], "completed" | "cancelled" | "failed"> = "failed";
  try {
    run.status = "running";
    await persist(active);
    const historicalRuns = (await listRuns()).filter((past) => past.id !== run.id && past.provider === run.provider && past.status === "completed" && past.demo === run.demo && past.config.timeoutMs === run.config.timeoutMs && past.config.concurrency === run.config.concurrency).slice(0, 50);
    const openedSession = await openBrowser(run.provider);
    session = openedSession;
    run.sessionId = session.sessionId;
    run.inspectUrl = session.inspectUrl;
    run.replayUrl = session.replayUrl;
    await persist(active);
    const busyHosts = new Set<string>();
    const lastStarted = new Map<string, number>();
    const queue = run.results.map((_, index) => index);
    const worker = async () => {
      while (queue.length && !controller.signal.aborted) {
        const position = queue.findIndex((index) => {
          const host = new URL(run.results[index].site.url).hostname;
          return !busyHosts.has(host) && Date.now() - (lastStarted.get(host) ?? 0) >= 750;
        });
        if (position < 0) { await delay(100); continue; }
        const [index] = queue.splice(position, 1);
        const site = run.results[index].site;
        const host = new URL(site.url).hostname;
        busyHosts.add(host);
        lastStarted.set(host, Date.now());
        try {
          run.results[index].status = "running";
          await persist(active);
          const history = historicalRuns.flatMap((past) => {
            const first = past.results.find((result) => result.site.url === site.url && result.site.expectedText === site.expectedText)?.attempts[0];
            return first?.outcome === "passed" && first.navigationMs !== null ? [first.navigationMs] : [];
          }).slice(0, 30);
          run.results[index] = await inspectSite({ site, runId: run.id, config: run.config, browser: openedSession.browser, dataDir, history, signal: controller.signal, demoOrigin });
          await persist(active);
        } finally { busyHosts.delete(host); }
      }
    };
    await Promise.all(Array.from({ length: run.config.concurrency }, worker));
    terminalStatus = controller.signal.aborted ? "cancelled" : "completed";
  } catch (error) {
    terminalStatus = controller.signal.aborted ? "cancelled" : "failed";
    run.error = redactText(error instanceof Error ? error.message : "巡检执行失败");
  } finally {
    for (const result of run.results) if (["pending", "running"].includes(result.status)) {
      result.status = terminalStatus === "cancelled" ? "cancelled" : "failed";
      result.priority = terminalStatus === "cancelled" ? 0 : 100;
      result.reasons = [terminalStatus === "cancelled" ? "任务已取消，未完成访问" : "执行器未完成访问，请查看任务错误"];
    }
    try { await session?.close(); } catch (error) { run.error = redactText(`浏览器清理失败：${error instanceof Error ? error.message : "未知错误"}`); }
    run.finishedAt = new Date().toISOString();
    run.status = terminalStatus;
    try { await persist(active); } catch (error) { process.stderr.write(`巡检记录保存失败：${redactText(error instanceof Error ? error.message : "未知错误")}\n`); }
    activeRuns.delete(run.id);
  }
}
