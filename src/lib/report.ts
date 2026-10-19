import { type InspectionRun, statusLabels } from "./contracts";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { runDirectory } from "./store";

export const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] || char);

export function reportCsv(run: InspectionRun): string {
  const field = (value: string | number | null) => {
    const text = String(value ?? "");
    const safe = /^[=+@\-\t\r]/.test(text) ? `'${text}` : text;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const rows = [["站点", "网址", "状态", "HTTP", "浏览器加载(ms)", "尝试次数", "优先级", "原因"], ...run.results.map((result) => [result.site.name, result.site.url, statusLabels[result.status], result.attempts.at(-1)?.httpStatus ?? "", result.durationMs ?? "", result.attempts.length, result.priority, result.reasons.join("；")])];
  return "\uFEFF" + rows.map((row) => row.map(field).join(",")).join("\r\n");
}

export async function reportHtml(run: InspectionRun): Promise<string> {
  const rows = await Promise.all([...run.results].sort((a, b) => b.priority - a.priority).map(async (result) => {
    const evidence = await Promise.all(result.attempts.map(async (attempt) => {
      let image = "";
      if (attempt.screenshot) {
        const file = attempt.screenshot.split("/").at(-1);
        if (file && /^[a-zA-Z0-9_-]+\.png$/.test(file)) {
          try { image = `<img alt="第 ${attempt.number} 次访问截图，输入区域已遮挡" src="data:image/png;base64,${(await readFile(path.join(runDirectory(run.id), file))).toString("base64")}" />`; } catch { image = "<p>截图文件不可用</p>"; }
        }
      }
      return `<details><summary>第 ${attempt.number} 次访问 · HTTP ${attempt.httpStatus ?? "无响应"} · 浏览器加载 ${attempt.navigationMs === null ? "未完成" : `${Math.round(attempt.navigationMs)} ms`}</summary><p>读取时间：${escapeHtml(attempt.startedAt)} · 总耗时 ${Math.round(attempt.durationMs)} ms</p><p>最终网址：${escapeHtml(attempt.finalUrl)}</p>${attempt.error ? `<p class="error">${escapeHtml(attempt.error)}</p>` : ""}<ul>${attempt.assertions.map((assertion) => `<li>${assertion.passed ? "通过" : "未通过"}：${escapeHtml(assertion.name)} · ${escapeHtml(assertion.detail)}</li>`).join("")}</ul>${attempt.consoleErrors.length ? `<pre>${escapeHtml(attempt.consoleErrors.join("\n"))}</pre>` : ""}${attempt.requestFailures.length ? `<pre>${escapeHtml(attempt.requestFailures.map((item) => `${item.url} · ${item.reason}`).join("\n"))}</pre>` : ""}${image}</details>`;
    }));
    return `<section><header><h2>${escapeHtml(result.site.name)}</h2><strong class="${result.status}">${statusLabels[result.status]}</strong></header><p><a href="${escapeHtml(result.site.url)}" rel="noreferrer">${escapeHtml(result.site.url)}</a></p><p>优先级 ${result.priority} / 100 · ${escapeHtml(result.reasons.join("；") || "未发现需要关注的异常")}</p><p>历史基线：${result.baseline.samples} 个样本${result.baseline.medianMs === null ? "，样本不足，未进行历史异常判断" : `，中位数 ${Math.round(result.baseline.medianMs)} ms，异常阈值 ${Math.round(result.baseline.thresholdMs ?? 0)} ms`}</p>${evidence.join("")}</section>`;
  }));
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(run.name)} · SitePulse 核验报告</title><style>body{margin:0;background:#f3f5f4;color:#23352c;font:15px/1.75 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif}main{max-width:1050px;margin:50px auto;padding:0 24px}h1{font-size:34px;letter-spacing:-1px}h2{margin:0;font-size:20px}section{background:#fff;margin:20px 0;padding:24px;border-radius:8px}header{display:flex;justify-content:space-between;gap:16px}a{color:#227650;word-break:break-all}p{color:#53645a}.failed,.unstable,.error{color:#b83f31}.slow,.warning{color:#976119}.healthy{color:#227650}details{border-top:1px solid #e0e5e1;padding:16px 0}summary{cursor:pointer;font-weight:600}img{max-width:100%;height:auto;border-radius:6px;margin-top:12px}pre{white-space:pre-wrap;word-break:break-word;background:#f3f5f4;padding:15px}@media print{details{display:block}details>*{display:block}}</style></head><body><main><p>SITEPULSE / 可核验巡检报告</p><h1>${escapeHtml(run.name)}</h1><p>${escapeHtml(run.createdAt)} · ${run.results.length} 个站点 · ${run.provider === "local" ? "本地 Chromium" : "Lexmount Chromium"}${run.demo ? " · 受控演示场景，实际浏览器执行" : ""} · ${escapeHtml(run.status)}</p><p>加载耗时为浏览器导航到 DOMContentLoaded；总耗时另计截图及证据采集。本报告保留首次失败与重试，输入区域已遮挡，未保存 Cookie 或请求头。优先级为规则排序，不代表风险概率。</p>${run.error ? `<p class="error">任务错误：${escapeHtml(run.error)}</p>` : ""}${run.replayUrl ? `<p><a href="${escapeHtml(run.replayUrl)}">Lexmount Replay</a></p>` : run.provider === "lexmount" ? "<p>当前 SDK 未返回可验证的 Replay 链接，此报告未生成回放地址。</p>" : ""}${rows.join("")}</main></body></html>`;
}
