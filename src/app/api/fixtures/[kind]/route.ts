import { setTimeout as delay } from "node:timers/promises";
import { demoKinds } from "@/lib/security";

export const dynamic = "force-dynamic";
declare global { var sitepulseFixtureAttempts: Map<string, number> | undefined; }
const attempts = globalThis.sitepulseFixtureAttempts ??= new Map<string, number>();

export async function GET(request: Request, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  if (!demoKinds.includes(kind)) return new Response("Not found", { status: 404 });
  if (kind === "slow") await delay(3800);
  const key = new URL(request.url).searchParams.get("batch") || "default";
  const attempt = kind === "flaky" ? (attempts.get(key) || 0) + 1 : 1;
  if (kind === "flaky") {
    if (attempts.size > 1000) attempts.clear();
    attempts.set(key, attempt);
  }
  const failure = kind === "failure" || (kind === "flaky" && attempt === 1);
  const titles: Record<string, string> = { healthy: "服务运行正常", slow: "文档已加载", failure: "服务暂时不可用", flaky: failure ? "报名入口暂时不可用" : "报名入口已恢复", content: "产品定价", console: "帮助中心" };
  const title = titles[kind];
  const content = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>*{box-sizing:border-box}body{margin:0;background:#f3f5f3;color:#173c30;font:16px -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif}header{padding:24px 42px;border-bottom:1px solid #dbe3dd;font-weight:700}main{max-width:780px;margin:90px auto;padding:40px}small{letter-spacing:2px;color:#627669}h1{font-size:44px;letter-spacing:-1px;margin:22px 0}p{line-height:1.8;color:#627669}.status{display:inline-block;padding:9px 14px;border-radius:6px;background:${failure ? "#fbe6e1" : "#e2eee4"};color:${failure ? "#ad3d2e" : "#22744c"}}section{border-top:1px solid #dbe3dd;margin-top:42px;padding-top:24px;display:flex;gap:30px}label{font-size:13px;color:#627669}input{display:block;margin-top:9px;padding:12px;border:1px solid #c5d2c8;border-radius:4px}</style></head><body><header>SitePulse <span style="font-weight:400;color:#627669">/ 受控巡检场景</span></header><main><small>LIVE INSPECTION FIXTURE</small><h1>${title}</h1><p>这是本服务提供的测试页面。访问、响应、耗时和截图均由浏览器实际采集，结果不预先填充。</p><div class="status">${failure ? "HTTP 503 · 请稍后重试" : kind === "slow" ? "模拟服务端延迟 3.8 秒" : kind === "content" ? "当前页面未提供购买入口" : "HTTP 200 · 页面已响应"}</div><section><div><label>示例输入，会在证据截图中遮挡<input value="sample-private-input" /></label></div><div><label>页面类型</label><p>${kind}</p></div></section></main>${kind === "console" ? '<script>setTimeout(()=>{console.error("HelpWidget: demo dependency failed to initialize")},20)</script>' : ""}</body></html>`;
  return new Response(content, { status: failure ? 503 : 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:" } });
}
