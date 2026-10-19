# SitePulse

SitePulse 用真实 Chromium 批量访问公开网页，把本次访问状态、浏览器加载耗时、失败记录和页面截图集中到一份可导出的巡检报告中。它适合先找出值得继续检查的网站，再由人确认业务原因。

每个站点都在独立浏览器上下文中访问。SitePulse 不登录、不填表、不提交，也不保存 Cookie 或请求头。失败只对可恢复的网络和服务错误复验一次，报告会保留首次失败和复验结果。

## Start the demo

Install the locked dependencies.

```bash
bun install --frozen-lockfile
```

Copy the environment template. You can leave the Lexmount variables empty to use the local browser.

```bash
cp .env.example .env.local
```

Start the app.

```bash
bun run dev
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000) and select **演示巡检**. The six controlled pages run in a real local Chromium session. They cover a healthy page, a slow page, a persistent server failure, a failure that recovers on retry, a failed text assertion, and a page with a script error.

## Inspect your own list

Select **新建巡检** and paste one site per line. Use the extended format when you need a name, group, or text assertion.

```text
https://example.com
MDN 文档 | https://developer.mozilla.org/zh-CN/ | 开发文档
Playwright | https://playwright.dev | 开发文档 | Playwright
```

The task accepts 1 to 50 public HTTP or HTTPS URLs. SitePulse rejects credentials in URLs, nonstandard ports, loopback and private addresses, and sensitive query parameters. The browser stops non-GET and non-HEAD requests, embedded page navigation, popup navigation, downloads, WebSocket connections, and page dialogs.

When a run finishes, use **导出报告** to download an HTML, JSON, or CSV report. The HTML report embeds the captured PNGs, so it opens without the running app. Run records and screenshots are stored under `SITEPULSE_DATA_DIR` and can be deleted from **巡检历史** after a task finishes.

## Keep the workspace local

The provided scripts bind the service to `127.0.0.1`. Keep that boundary. This version has no user authentication or public capability links, so do not put the workspace API behind a public reverse proxy. To share a result, download the self-contained HTML report and share that file instead.

## Use Lexmount

Set both variables in `.env.local`, then restart the app.

```dotenv
LEXMOUNT_API_KEY=your-key
LEXMOUNT_PROJECT_ID=your-project-id
```

Select **Lexmount 云浏览器** in **巡检设置** or in the task's execution options. The app creates one recorded cloud session for the batch and connects to it through Playwright. When the SDK provides a session inspector URL, the evidence panel links to that exact session. The installed SDK does not expose a standalone Replay URL, so the app does not claim that a replay exists when it cannot verify one.

## Verify the project

Run the unit and browser integration tests.

```bash
bun run test
```

Check types and the production build.

```bash
bun run typecheck
bun run build
```

For an end-to-end API, report, cancellation, and browser check, start the dev server and run:

```bash
bun run verify
```

The latest recorded result is in [docs/verification.md](docs/verification.md). The status rules, retry policy, timing definitions, and history baseline are in [docs/algorithm.md](docs/algorithm.md).

## Limits

One browser observation does not prove uptime, user experience, or a performance regression. A successful HTTP response only proves that the page responded and the configured assertions passed. Use a dedicated, repeated test for performance conclusions.

SitePulse validates each URL before Chromium continues the request. The current browser-layer guard does not pin DNS answers between that validation and Chromium's own DNS lookup. Run SitePulse only in an environment where its browser cannot reach private networks until an egress proxy or DNS pinning layer is added.
