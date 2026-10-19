import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { openBrowser, localBrowserAvailable } from "../src/lib/browser";
import { inspectSite } from "../src/lib/inspector";
import { runInputSchema } from "../src/lib/contracts";

test("真实浏览器：逐跳安全检查、一次恢复、内容断言和证据文件", { timeout: 60000 }, async (t) => {
  if (!await localBrowserAvailable()) { t.skip("未安装本地 Chromium；运行 bun run browser:install 后复跑。"); return; }
  const hits: string[] = [];
  let flaky = 0;
  const server = createServer((request, response) => {
    const url = request.url ?? "";
    hits.push(url);
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    if (url === "/api/fixtures/healthy") {
      response.writeHead(302, { location: "/private" }); response.end();
    } else if (url === "/api/fixtures/flaky" && flaky++ === 0) {
      response.writeHead(503); response.end("temporary failure");
    } else if (url === "/api/fixtures/content") {
      response.end('<html><body>public text <input value="private input" style="position:fixed;left:30px;top:80px;width:200px;height:40px"><iframe src="/private"></iframe><script>fetch("/private", {method:"POST"})</script></body></html>');
    } else if (url === "/api/fixtures/console") {
      response.end('<html><body>readable<script>console.error("token=do-not-publish")</script></body></html>');
    } else {
      response.end("<html><body>recovered page</body></html>");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fixture server 未启动");
  const origin = `http://127.0.0.1:${address.port}`;
  const dataDir = await mkdtemp(join(tmpdir(), "sitepulse-browser-"));
  const session = await openBrowser("local");
  const config = runInputSchema.parse({ demo: true, sites: [{ id: "redirect", name: "redirect", url: `${origin}/api/fixtures/healthy` }] });
  const inspect = (path: string, expectedText = "") => inspectSite({
    site: { id: path, name: path, group: "测试", expectedText, url: `${origin}/api/fixtures/${path}` },
    runId: "browser-test", config, browser: session.browser, dataDir, history: [], demoOrigin: origin,
  });
  try {
    const redirect = await inspect("healthy");
    assert.equal(redirect.status, "failed");
    assert.equal(redirect.attempts[0]?.failureCode, "SECURITY");
    assert.equal(redirect.attempts.length, 1);
    assert.equal(hits.includes("/private"), false, "私有redirect目标不应收到真实请求");
    const recovered = await inspect("flaky");
    assert.equal(recovered.status, "unstable");
    assert.equal(recovered.attempts.length, 2);
    assert.equal(recovered.attempts[0]?.httpStatus, 503);
    assert.equal(recovered.attempts[1]?.httpStatus, 200);
    assert.ok(recovered.attempts.every((attempt) => attempt.screenshot !== null));
    assert.notEqual(recovered.attempts[0]?.screenshot, recovered.attempts[1]?.screenshot);
    const screenshot = recovered.attempts[1]?.screenshot;
    assert.ok(screenshot);
    const png = await readFile(join(dataDir, "browser-test", basename(screenshot)));
    assert.equal(png.subarray(1, 4).toString(), "PNG");
    assert.ok((recovered.attempts[1]?.durationMs ?? 0) >= (recovered.attempts[1]?.navigationMs ?? 0));
    const content = await inspect("content", "missing expected text");
    assert.equal(content.status, "failed");
    assert.equal(content.attempts[0]?.failureCode, "ASSERTION");
    assert.equal(content.attempts.length, 1);
    assert.equal(hits.includes("/private"), false, "iframe和POST不应送往服务端");
    const contentScreenshot = content.attempts[0]?.screenshot;
    assert.ok(contentScreenshot);
    const maskedPng = await readFile(join(dataDir, "browser-test", basename(contentScreenshot)));
    const verificationContext = await session.browser.newContext();
    try {
      const evidencePage = await verificationContext.newPage();
      const pixel = await evidencePage.evaluate(async (base64) => {
        const image = new Image();
        image.src = `data:image/png;base64,${base64}`;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.width; canvas.height = image.height;
        const drawing = canvas.getContext("2d");
        if (!drawing) throw new Error("截图核验画布不可用");
        drawing.drawImage(image, 0, 0);
        return [...drawing.getImageData(100, 100, 1, 1).data];
      }, maskedPng.toString("base64"));
      assert.deepEqual(pixel, [51, 65, 85, 255], "截图中输入框应被实际遮挡颜色覆盖");
    } finally { await verificationContext.close(); }
    const consoleResult = await inspect("console");
    assert.equal(consoleResult.status, "warning");
    assert.equal(JSON.stringify(consoleResult).includes("do-not-publish"), false);
    assert.equal(session.browser.contexts().length, 0, "每次巡检的隔离context都应被清理");
  } finally {
    await session.close();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(dataDir, { recursive: true, force: true });
  }
});
