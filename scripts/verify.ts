import assert from "node:assert/strict";
import { access, mkdir, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import path from "node:path";
import { chromium, request, type APIRequestContext } from "playwright";
import { z } from "zod";
import { runInputSchema, runSchema, settingsSchema, siteSchema, type InspectionRun } from "../src/lib/contracts";

const origin = process.env.SITEPULSE_VERIFY_ORIGIN || "http://127.0.0.1:3000";
const publicUrl = process.env.SITEPULSE_VERIFY_PUBLIC_URL || "https://example.com/";
const output = path.resolve("docs/verification.md");
const cases: { name: string; status: "Passed" | "Inspected" | "Not run" | "Failed"; detail: string }[] = [];
const ownedRuns = new Set<string>();
let demoRun: InspectionRun | undefined;
let publicRun: InspectionRun | undefined;

function record(name: string, status: "Passed" | "Inspected" | "Not run" | "Failed", detail: string): void {
  cases.push({ name, status, detail });
  process.stdout.write(`${status}: ${name} · ${detail}\n`);
}

async function check(name: string, work: () => Promise<string> | string): Promise<void> {
  try { record(name, "Passed", await work()); }
  catch (error) {
    record(name, "Failed", error instanceof Error ? error.message : String(error));
    throw error;
  }
}

async function getRun(api: APIRequestContext, id: string): Promise<InspectionRun> {
  const response = await api.get(`/api/runs/${id}`);
  assert.equal(response.status(), 200);
  return runSchema.parse(await response.json());
}

async function waitForRun(api: APIRequestContext, id: string): Promise<InspectionRun> {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const run = await getRun(api, id);
    if (!["queued", "running"].includes(run.status)) return run;
    await delay(350);
  }
  throw new Error(`任务 ${id} 在 90 秒内未进入终态`);
}

async function startRun(api: APIRequestContext, config: z.input<typeof runInputSchema>): Promise<InspectionRun> {
  const response = await api.post("/api/runs", { data: runInputSchema.parse(config) });
  assert.equal(response.status(), 202, await response.text());
  const run = runSchema.parse(await response.json());
  ownedRuns.add(run.id);
  return run;
}

async function executablePath(): Promise<string> {
  const candidates = [process.env.SITEPULSE_CHROME_PATH, process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", chromium.executablePath()];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try { await access(candidate, constants.X_OK); return candidate; } catch { /* Try another installed executable. */ }
  }
  throw new Error("独立报告验证未找到 Chromium");
}

async function saveReceipt(): Promise<void> {
  const passed = cases.filter((item) => item.status === "Passed").length;
  const failed = cases.filter((item) => item.status === "Failed").length;
  const lines = ["# SitePulse 独立验证记录", "", `执行时间：${new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}，Asia/Shanghai。`, "",
    "通过真实 Next.js API 创建任务，由服务端本地 Chromium 实际访问页面。报告通过另一个隔离 Chromium 上下文打开。验证脚本不会取消或删除其他人的任务。", "",
    `本脚本实际执行 ${passed + failed} 项断言场景：Passed ${passed}，Failed ${failed}。测试文件数是独立单元测试命令的输出口径，不以这些场景数代替。`, "",
    "| 分类 | 场景 | 结果 |", "| --- | --- | --- |",
    ...cases.map((item) => `| ${item.status} | ${item.name.replaceAll("|", "\\|")} | ${item.detail.replaceAll("|", "\\|").replaceAll("\n", " ")} |`), "",
    demoRun ? `受控演示任务：\`${demoRun.id}\`，${demoRun.results.length} 个实际访问场景，最终状态 ${demoRun.status}。保留于本地历史供复核。` : "受控演示任务未完成。", "",
    publicRun ? `公开站点：${publicUrl}，任务 \`${publicRun.id}\`，状态 ${publicRun.status}，站点结果 ${publicRun.results[0]?.status ?? "无结果"}，HTTP ${publicRun.results[0]?.attempts.at(-1)?.httpStatus ?? "无响应"}。该结果只描述本次观察，不预设外站必须成功。` : "公开站点尚未运行。", "",
    "## 范围与限制", "",
    "本脚本验证 API、真实浏览器访问、截图可读取、报告内容和取消/删除流程。它未代替桌面与窄屏 UI 的人工视觉检查，未用公开站点可达性证明整体服务稳定，也未宣称截图脱敏能覆盖所有个人信息。Lexmount 真实会话与 Replay 单独记录，未运行时不能称为已通过。", "",
    "同端口的 `127.0.0.1`、`localhost` 和 IPv6 环回地址按本机同源处理。其他 Origin 仍会被任务修改接口拒绝。", "", "重跑：启动服务后执行 `bun run verify`。可通过 `SITEPULSE_VERIFY_ORIGIN` 与 `SITEPULSE_VERIFY_PUBLIC_URL` 指定验证目标。", ""];
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, lines.join("\n"));
}

const api = await request.newContext({ baseURL: origin, extraHTTPHeaders: { Origin: origin }, timeout: 20_000 });
try {
  await check("设置与输入契约", async () => {
    const response = await api.get("/api/settings");
    assert.equal(response.status(), 200);
    const settings = settingsSchema.parse(await response.json());
    assert.equal(settings.localBrowserAvailable, true);
    assert.equal(settings.maxSites, 50);
    const existing = z.array(runSchema).parse(await (await api.get("/api/runs")).json());
    assert.ok(!existing.some((run) => ["queued", "running"].includes(run.status)), "其他巡检正在执行，避免抢占其任务窗口");
    return `本地 Chromium 可用，版本 ${settings.version}，最多 ${settings.maxSites} 个站点`;
  });
  const response = await api.get("/api/demo");
  assert.equal(response.status(), 200);
  const demo = z.object({ sites: z.array(siteSchema).length(6) }).parse(await response.json());
  const config = runInputSchema.parse({ name: "独立验证 · 六类真实浏览器场景", sites: demo.sites, provider: "local", demo: true, timeoutMs: 15_000, slowThresholdMs: 3000, concurrency: 3, retry: true });
  process.stdout.write("API 巡检窗口开始：六类受控页面。\n");
  const started = await startRun(api, config);
  await check("活动任务禁止删除", async () => {
    const deletion = await api.delete(`/api/runs/${started.id}`);
    assert.equal(deletion.status(), 409);
    return "DELETE 返回 409，未删除在途记录";
  });
  demoRun = await waitForRun(api, started.id);
  assert.equal(demoRun.status, "completed", demoRun.error ?? "受控任务未正常完成");
  const expected = new Map([
    ["产品首页", "healthy"], ["开发文档", "slow"], ["服务状态页", "failed"],
    ["活动报名页", "unstable"], ["产品定价页", "failed"], ["用户帮助页", "warning"],
  ]);
  for (const result of demoRun.results) {
    await check(`真实场景：${result.site.name}`, () => {
      assert.equal(result.status, expected.get(result.site.name), JSON.stringify({ status: result.status, reasons: result.reasons }));
      assert.ok(result.attempts.length > 0);
      assert.ok(result.attempts.every((attempt) => attempt.durationMs >= (attempt.navigationMs ?? 0)));
      if (result.status === "slow") assert.ok((result.durationMs ?? 0) > 3000);
      if (result.site.name === "产品定价页") assert.equal(result.attempts.length, 1, "内容断言失败不可通过重试放宽规则");
      return `${result.status}，${result.attempts.length} 次尝试，导航 ${Math.round(result.durationMs ?? 0)} ms`;
    });
  }
  await check("首次 503 与恢复证据并存", () => {
    const recovered = demoRun?.results.find((result) => result.site.name === "活动报名页");
    assert.ok(recovered);
    assert.equal(recovered.attempts.length, 2);
    assert.equal(recovered.attempts[0]?.httpStatus, 503);
    assert.equal(recovered.attempts[0]?.outcome, "failed");
    assert.equal(recovered.attempts[1]?.httpStatus, 200);
    assert.notEqual(recovered.attempts[1]?.outcome, "failed");
    assert.ok(recovered.reasons.some((reason) => reason.includes("首次")));
    return "两次独立尝试均保留，503 没有被 200 覆盖";
  });
  const screenshotPaths: string[] = [];
  await check("所有尝试截图是真实 PNG", async () => {
    assert.ok(demoRun);
    for (const result of demoRun.results) for (const attempt of result.attempts) {
      assert.ok(attempt.screenshot, `${result.site.name} 第 ${attempt.number} 次缺少截图`);
      assert.match(attempt.screenshot, new RegExp(`^/api/runs/${demoRun.id}/evidence/[a-zA-Z0-9_-]+\\.png$`));
      const evidence = await api.get(attempt.screenshot);
      assert.equal(evidence.status(), 200);
      assert.match(evidence.headers()["content-type"] ?? "", /image\/png/);
      assert.deepEqual([...(await evidence.body()).subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
      screenshotPaths.push(attempt.screenshot);
    }
    return `${screenshotPaths.length} 张 PNG 可通过相应任务的证据 API 读取`;
  });
  let reportHtml = "";
  await check("HTML、JSON、CSV 报告与原始结果一致", async () => {
    assert.ok(demoRun);
    const html = await api.get(`/api/runs/${demoRun.id}/report?format=html`);
    assert.equal(html.status(), 200);
    reportHtml = await html.text();
    assert.equal((reportHtml.match(/src="data:image\/png;base64,/g) ?? []).length, screenshotPaths.length);
    assert.ok(!reportHtml.includes('src="/api/'), "可分享 HTML 不应依赖本机图片地址");
    for (const result of demoRun.results) assert.ok(reportHtml.includes(result.site.name));
    const json = await api.get(`/api/runs/${demoRun.id}/report?format=json`);
    assert.equal(json.status(), 200);
    assert.deepEqual(runSchema.parse(await json.json()), demoRun);
    const csv = await api.get(`/api/runs/${demoRun.id}/report?format=csv`);
    assert.equal(csv.status(), 200);
    const rows = (await csv.text()).trim().split("\r\n");
    assert.equal(rows.length, demoRun.results.length + 1);
    assert.ok(rows[0]?.includes("尝试次数"));
    const invalid = await api.get(`/api/runs/${demoRun.id}/report?format=xml`);
    assert.equal(invalid.status(), 400);
    return "HTML 内嵌全部 PNG，JSON 通过 schema 且一致，CSV 6 行，非法格式被拒绝";
  });
  await check("隔离浏览器打开离线 HTML 报告", async () => {
    const browser = await chromium.launch({ executablePath: await executablePath(), headless: true });
    try {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const page = await context.newPage();
      await page.setContent(reportHtml, { waitUntil: "load" });
      assert.equal(await page.locator("main > section").count(), 6);
      await page.locator("details").evaluateAll((elements) => elements.forEach((element) => { if (element instanceof HTMLDetailsElement) element.open = true; }));
      assert.equal(await page.locator("img").count(), screenshotPaths.length);
      assert.ok(await page.locator("img").evaluateAll((images) => images.every((image) => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0)));
      assert.equal(await page.title(), `${config.name} · SitePulse 核验报告`);
      await context.close();
    } finally { await browser.close(); }
    return "6 个场景区块与所有图片均成功渲染，无需原服务图片路径";
  });
  process.stdout.write("API 六类受控巡检窗口结束。\n");
  await check("私有地址、跨 Origin 与无效输入被拒绝", async () => {
    const privateResponse = await api.post("/api/runs", { data: { ...config, demo: false, sites: [{ id: "private", name: "内网负测", url: "http://127.0.0.1/", group: "验证", expectedText: "" }] } });
    assert.ok([400, 403].includes(privateResponse.status()));
    const crossOrigin = await api.post("/api/runs", { headers: { Origin: "https://outside.invalid" }, data: config });
    assert.ok([400, 403].includes(crossOrigin.status()));
    const invalid = await api.post("/api/runs", { data: { ...config, sites: [], concurrency: 0 } });
    assert.equal(invalid.status(), 400);
    return `私有地址 ${privateResponse.status()}，跨 Origin ${crossOrigin.status()}，无效 schema ${invalid.status()}`;
  });
  process.stdout.write("API 巡检窗口开始：取消与删除。\n");
  await check("取消保留终态，未开始任务取消，完成后可删除", async () => {
    const nextDemo = z.object({ sites: z.array(siteSchema) }).parse(await (await api.get("/api/demo")).json());
    const slow = nextDemo.sites.find((site) => new URL(site.url).pathname.endsWith("/slow"));
    assert.ok(slow);
    const others = nextDemo.sites.filter((site) => site.id !== slow.id);
    const cancellation = await startRun(api, { ...config, name: "独立验证 · 取消流程", concurrency: 1, sites: [slow, ...others] });
    const deadline = Date.now() + 10_000;
    let current = await getRun(api, cancellation.id);
    while (!current.results.some((result) => result.status === "running") && Date.now() < deadline) { await delay(100); current = await getRun(api, cancellation.id); }
    assert.ok(current.results.some((result) => result.status === "running"), "取消前应确认至少一个访问在途");
    const cancel = await api.post(`/api/runs/${cancellation.id}/cancel`);
    assert.equal(cancel.status(), 200);
    const cancelled = await waitForRun(api, cancellation.id);
    assert.equal(cancelled.status, "cancelled");
    assert.ok(cancelled.results.every((result) => result.status === "cancelled"));
    assert.ok(cancelled.results.some((result) => result.attempts.length === 0));
    const deletion = await api.delete(`/api/runs/${cancelled.id}`);
    assert.equal(deletion.status(), 200);
    assert.equal((await api.get(`/api/runs/${cancelled.id}`)).status(), 404);
    ownedRuns.delete(cancelled.id);
    return "取消任务终态可读，pending 项没有伪造访问记录，删除后 GET 404";
  });
  process.stdout.write("API 取消与删除窗口结束。\n");
  process.stdout.write("API 巡检窗口开始：真实公开网站。\n");
  const external = await startRun(api, { ...config, name: "独立验证 · 真实公开网站", demo: false, concurrency: 1,
    sites: [{ id: "public-example", name: "公开站点访问", url: publicUrl, group: "真实公开站点", expectedText: "" }] });
  publicRun = await waitForRun(api, external.id);
  await check("真实公开站点记录完整且不预设成功", () => {
    assert.ok(publicRun);
    assert.equal(publicRun.status, "completed", publicRun.error ?? "执行器失败");
    const result = publicRun.results[0];
    assert.ok(result);
    assert.ok(result.attempts.length > 0 && result.attempts.length <= 2);
    assert.ok(["healthy", "warning", "slow", "unstable", "failed"].includes(result.status));
    if (result.status === "failed") assert.ok(result.attempts.at(-1)?.error);
    return `${publicUrl} 实际结果 ${result.status}，HTTP ${result.attempts.at(-1)?.httpStatus ?? "无响应"}，${result.attempts.length} 次尝试`;
  });
  record("公开网站本次观察", "Inspected", publicRun.results[0]?.reasons.join("；") || "无额外问题");
  process.stdout.write("API 真实公开网站窗口结束。\n");
  record("Lexmount 会话与 Replay", "Not run", "本脚本只运行本地 Chromium，没有把本地访问或 SDK 检查当成云端验证");
  record("桌面与窄屏工作台视觉", "Not run", "由主任务独立检查真实 Web UI；本脚本只打开离线 HTML 报告");
} catch (error) {
  if (!cases.some((item) => item.status === "Failed")) record("验证中断", "Failed", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  for (const id of ownedRuns) {
    try {
      const run = await getRun(api, id);
      if (["queued", "running"].includes(run.status)) { await api.post(`/api/runs/${id}/cancel`); await waitForRun(api, id); }
    } catch { /* Preserve a failed run for review; do not touch other runs. */ }
  }
  await saveReceipt();
  await api.dispose();
  process.stdout.write(`验证记录：${output}\n`);
}
