import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join, basename } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import type { Browser, BrowserContext, Page } from "playwright";
import type { Attempt, RunInput, Site, SiteResult } from "./contracts";
import { analyzeSite, shouldRetry } from "./analysis";
import { redactText, redactUrl, validatePublicUrl } from "./security";

const pausedRequestSchema = z.object({
  requestId: z.string(),
  frameId: z.string(),
  resourceType: z.string(),
  request: z.object({ url: z.string(), method: z.string() }),
});

type InspectSiteInput = {
  site: Site;
  runId: string;
  config: RunInput;
  browser: Browser;
  dataDir: string;
  history: readonly number[];
  signal?: AbortSignal;
  demoOrigin?: string;
};

function cancellationError(): Error {
  return new Error("用户取消巡检。");
}

async function createInspectionContext({ browser, signal }: Pick<InspectSiteInput, "browser" | "signal">): Promise<BrowserContext> {
  const created = browser.newContext({
    viewport: { width: 1440, height: 900 }, locale: "zh-CN", timezoneId: "Asia/Shanghai",
    serviceWorkers: "block", acceptDownloads: false, ignoreHTTPSErrors: false,
  });
  if (!signal) return created;
  void created.then((context) => {
    if (signal.aborted) void context.close().catch(() => undefined);
  }, () => undefined);
  if (signal.aborted) throw cancellationError();
  return new Promise<BrowserContext>((resolve, reject) => {
    const rejectCancelled = () => reject(cancellationError());
    signal.addEventListener("abort", rejectCancelled, { once: true });
    void created.then((context) => {
      signal.removeEventListener("abort", rejectCancelled);
      if (signal.aborted) {
        void context.close().catch(() => undefined);
        reject(cancellationError());
        return;
      }
      resolve(context);
    }, (error: unknown) => {
      signal.removeEventListener("abort", rejectCancelled);
      reject(error);
    });
  });
}

function errorMessage(error: unknown): string {
  return redactText(error instanceof Error ? error.message : String(error)).slice(0, 2000);
}

function classifyFailure(error: unknown, blockedDocument: boolean, cancelled: boolean): string {
  if (cancelled) return "CANCELLED";
  if (blockedDocument) return "SECURITY";
  const message = error instanceof Error ? error.message : String(error);
  if (/timeout/i.test(message)) return "TIMEOUT";
  if (/ERR_NAME_NOT_RESOLVED|DNS|ENOTFOUND/i.test(message)) return "DNS";
  if (/ERR_CERT|ERR_SSL|CERTIFICATE|TLS/i.test(message)) return "SSL";
  if (/ERR_|ECONN|connection|socket|net::/i.test(message)) return "NETWORK";
  return "BROWSER";
}

async function collectTiming(page: Page): Promise<Pick<Attempt, "ttfbMs" | "domContentLoadedMs" | "loadMs">> {
  return page.evaluate(() => {
    const entry = performance.getEntriesByType("navigation").at(0);
    if (!(entry instanceof PerformanceNavigationTiming)) return { ttfbMs: null, domContentLoadedMs: null, loadMs: null };
    return {
      ttfbMs: entry.responseStart > 0 && entry.requestStart > 0 ? entry.responseStart - entry.requestStart : null,
      domContentLoadedMs: entry.domContentLoadedEventEnd > 0 ? entry.domContentLoadedEventEnd - entry.startTime : null,
      loadMs: entry.loadEventEnd > 0 ? entry.loadEventEnd - entry.startTime : null,
    };
  });
}

async function inspectAttempt(input: InspectSiteInput, number: number): Promise<Attempt> {
  const { site, config, browser, signal } = input;
  const start = Date.now();
  const attempt: Attempt = {
    number, startedAt: new Date(start).toISOString(), finishedAt: new Date(start).toISOString(), durationMs: 0,
    navigationMs: null, ttfbMs: null, domContentLoadedMs: null, loadMs: null,
    httpStatus: null, finalUrl: redactUrl(site.url), title: "", screenshot: null,
    outcome: "passed", failureCode: null, error: null, consoleErrors: [], requestFailures: [], assertions: [],
  };
  let context: BrowserContext | undefined;
  let page: Page | undefined;
  let blockedDocument = false;
  let collecting = true;
  const demoOrigin = input.demoOrigin ?? process.env.SITEPULSE_DEMO_ORIGIN;
  const securityOptions = { allowDemo: config.demo, demoOrigin };
  const addRequestFailure = (url: string, reason: string) => {
    if (!collecting) return;
    const safeUrl = redactUrl(url);
    const safeReason = redactText(reason).slice(0, 1000);
    if (attempt.requestFailures.some((failure) => failure.url === safeUrl && failure.reason === safeReason)) return;
    if (attempt.requestFailures.length < 20) attempt.requestFailures.push({ url: safeUrl, reason: safeReason });
  };
  const cancel = () => { void context?.close().catch(() => undefined); };

  try {
    if (signal?.aborted) throw cancellationError();
    try {
      await validatePublicUrl(site.url, securityOptions);
    } catch (error) {
      blockedDocument = true;
      throw error;
    }
    context = await createInspectionContext({ browser, signal });
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) throw cancellationError();
    await context.route("**/*", async (route) => {
      const request = route.request();
      try {
        if (request.method() !== "GET" && request.method() !== "HEAD") throw new Error(`只读巡检阻止 ${request.method()} 请求。`);
        if (request.isNavigationRequest() && request.frame() !== page?.mainFrame()) throw new Error("首版巡检只读取主页面，嵌入页面与弹窗导航已阻止。");
        await validatePublicUrl(request.url(), securityOptions);
      } catch (error) {
        if (request.isNavigationRequest() && request.frame() === page?.mainFrame()) blockedDocument = true;
        addRequestFailure(request.url(), `安全策略：${errorMessage(error)}`);
        await route.abort("blockedbyclient").catch(() => undefined);
        return;
      }
      await route.continue().catch(() => undefined);
    });
    await context.routeWebSocket("**/*", (socket) => {
      addRequestFailure(socket.url(), "只读巡检不建立 WebSocket 连接。");
      socket.close();
    });
    page = await context.newPage();
    context.on("page", (openedPage) => {
      if (openedPage !== page) void openedPage.close().catch(() => undefined);
    });
    const cdp = await context.newCDPSession(page);
    cdp.on("Fetch.requestPaused", async (event: unknown) => {
      const parsed = pausedRequestSchema.safeParse(event);
      if (!parsed.success) return;
      const paused = parsed.data;
      try {
        if (!["GET", "HEAD"].includes(paused.request.method)) throw new Error(`只读巡检阻止 ${paused.request.method} 请求。`);
        await validatePublicUrl(paused.request.url, securityOptions);
      } catch (error) {
        if (paused.resourceType === "Document") blockedDocument = true;
        addRequestFailure(paused.request.url, `安全策略：${errorMessage(error)}`);
        await cdp.send("Fetch.failRequest", { requestId: paused.requestId, errorReason: "BlockedByClient" }).catch(() => undefined);
        return;
      }
      await cdp.send("Fetch.continueRequest", { requestId: paused.requestId }).catch(() => undefined);
    });
    await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] });
    page.setDefaultTimeout(5000);
    page.on("console", (message) => {
      if (message.type() === "error" && attempt.consoleErrors.length < 20) attempt.consoleErrors.push(redactText(message.text()).slice(0, 1000));
    });
    page.on("pageerror", (error) => {
      if (attempt.consoleErrors.length < 20) attempt.consoleErrors.push(errorMessage(error));
    });
    page.on("dialog", (dialog) => {
      addRequestFailure(page?.url() ?? site.url, "只读巡检已关闭页面对话框，未确认任何操作。");
      void dialog.dismiss().catch(() => undefined);
    });
    page.on("requestfailed", (request) => {
      addRequestFailure(request.url(), request.failure()?.errorText ?? "请求失败");
    });
    page.on("response", (response) => {
      if (response.status() >= 400 && response.request().resourceType() !== "document") addRequestFailure(response.url(), `HTTP ${response.status()}`);
    });
    const navigationStart = Date.now();
    let response: Awaited<ReturnType<Page["goto"]>>;
    try {
      response = await page.goto(site.url, { waitUntil: "domcontentloaded", timeout: config.timeoutMs });
    } finally {
      attempt.navigationMs = Date.now() - navigationStart;
      attempt.finalUrl = redactUrl(page.url());
    }
    attempt.httpStatus = response?.status() ?? null;
    await page.waitForLoadState("load", { timeout: 1500 }).catch(() => undefined);
    Object.assign(attempt, await collectTiming(page));
    attempt.title = redactText(await page.title()).slice(0, 300);
    const httpPassed = attempt.httpStatus !== null && attempt.httpStatus >= 200 && attempt.httpStatus < 400;
    attempt.assertions.push({ name: "HTTP 响应", passed: httpPassed, detail: attempt.httpStatus === null ? "未取得 HTTP 响应。" : `HTTP ${attempt.httpStatus}` });
    if (!httpPassed) {
      attempt.outcome = "failed";
      attempt.failureCode = "HTTP";
      attempt.error = `页面返回 HTTP ${attempt.httpStatus ?? "未知"}。`;
    }
    const bodyText = await page.locator("body").innerText({ timeout: 3000 }).catch(() => "");
    const rendered = bodyText.trim().length > 0 || await page.locator("img, canvas, video, svg").count() > 0;
    attempt.assertions.push({ name: "页面内容", passed: rendered, detail: rendered ? "页面包含可见文本或媒体内容。" : "页面未展示可见文本或媒体。" });
    if (!rendered && attempt.outcome !== "failed") {
      attempt.outcome = "failed";
      attempt.failureCode = "ASSERTION";
      attempt.error = "页面响应成功，但内容为空。";
    }
    if (site.expectedText) {
      const passed = bodyText.includes(site.expectedText);
      attempt.assertions.push({ name: "预期内容", passed, detail: passed ? `找到「${redactText(site.expectedText)}」。` : `未找到「${redactText(site.expectedText)}」。` });
      if (!passed && attempt.outcome !== "failed") {
        attempt.outcome = "failed";
        attempt.failureCode = "ASSERTION";
        attempt.error = "页面可访问，但预期内容断言未通过。";
      }
    }
  } catch (error) {
    attempt.outcome = "failed";
    attempt.failureCode = classifyFailure(error, blockedDocument, signal?.aborted ?? false);
    attempt.error = errorMessage(error);
    if (page && !page.isClosed()) {
      attempt.finalUrl = redactUrl(page.url());
      Object.assign(attempt, await collectTiming(page).catch(() => ({ ttfbMs: null, domContentLoadedMs: null, loadMs: null })));
      attempt.title = redactText(await page.title().catch(() => "")).slice(0, 300);
    }
  } finally {
    if (page && !page.isClosed() && !signal?.aborted) {
      try {
        if (basename(input.runId) !== input.runId) throw new Error("非法运行编号。");
        const directory = join(input.dataDir, input.runId);
        await mkdir(directory, { recursive: true });
        const siteHash = createHash("sha256").update(site.id).digest("hex").slice(0, 16);
        const filename = `${siteHash}-attempt-${number}.png`;
        await page.screenshot({
          path: join(directory, filename), timeout: 5000, animations: "disabled", fullPage: false,
          mask: page.frames().map((frame) => frame.locator("input, textarea, [contenteditable], [data-private], [data-sensitive]")), maskColor: "#334155",
        });
        attempt.screenshot = `/api/runs/${encodeURIComponent(input.runId)}/evidence/${filename}`;
      } catch (error) {
        if (attempt.outcome === "passed") attempt.outcome = "warning";
        attempt.assertions.push({ name: "截图证据", passed: false, detail: errorMessage(error) });
      }
    }
    signal?.removeEventListener("abort", cancel);
    collecting = false;
    await context?.close().catch(() => undefined);
    if (attempt.outcome === "passed" && (attempt.consoleErrors.length || attempt.requestFailures.length)) attempt.outcome = "warning";
    attempt.durationMs = Date.now() - start;
    attempt.finishedAt = new Date().toISOString();
  }
  return attempt;
}

export async function inspectSite(input: InspectSiteInput): Promise<SiteResult> {
  const attempts = [await inspectAttempt(input, 1)];
  const first = attempts[0];
  if (first && input.config.retry && !input.signal?.aborted && shouldRetry(first)) {
    await delay(750, undefined, { signal: input.signal }).catch(() => undefined);
    if (!input.signal?.aborted) attempts.push(await inspectAttempt(input, 2));
  }
  const result = analyzeSite(input.site, attempts, input.config, input.history);
  if (input.signal?.aborted && result.status !== "cancelled") {
    result.status = "cancelled";
    result.priority = 0;
    result.reasons.unshift("巡检已取消，尚未进行的重试已停止；已采集证据保留。");
  }
  return result;
}
