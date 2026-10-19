import type { Attempt, RunInput, Site, SiteResult } from "./contracts";

export function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle];
  if (upper === undefined) return null;
  const lower = sorted[middle - 1];
  return sorted.length % 2 || lower === undefined ? upper : (lower + upper) / 2;
}

export function historicalBaseline(history: readonly number[], currentMs: number | null): SiteResult["baseline"] {
  const samples = history.filter((value) => Number.isFinite(value) && value >= 0);
  if (samples.length < 5) return { samples: samples.length, medianMs: null, madMs: null, thresholdMs: null, anomalous: false };
  const medianMs = median(samples);
  if (medianMs === null) return { samples: samples.length, medianMs: null, madMs: null, thresholdMs: null, anomalous: false };
  const madMs = median(samples.map((value) => Math.abs(value - medianMs))) ?? 0;
  const thresholdMs = medianMs + Math.max(3.5 * 1.4826 * madMs, 300, medianMs * 0.5);
  return { samples: samples.length, medianMs, madMs, thresholdMs, anomalous: currentMs !== null && currentMs > thresholdMs };
}

export function analyzeSite(site: Site, attempts: readonly Attempt[], config: Pick<RunInput, "slowThresholdMs">, history: readonly number[] = []): SiteResult {
  const latest = attempts.at(-1);
  const durationMs = latest?.navigationMs ?? null;
  const baseline = historicalBaseline(history, durationMs);
  const reasons: string[] = [];
  let status: SiteResult["status"] = "pending";
  let priority = 0;

  if (latest?.failureCode === "CANCELLED") {
    status = "cancelled";
    reasons.push("用户取消巡检。");
  } else if (latest?.outcome === "failed") {
    status = "failed";
    priority = 100;
    reasons.push(latest.error ?? `访问失败：${latest.failureCode ?? "未知原因"}`);
  } else if (latest && attempts.some((attempt) => attempt.outcome === "failed")) {
    status = "unstable";
    priority = 75;
    reasons.push("首次访问失败，一次独立重试后恢复；首次失败证据已保留。");
  } else if (latest && durationMs !== null && durationMs > config.slowThresholdMs) {
    status = "slow";
    priority = 55;
    reasons.push(`页面导航 ${Math.round(durationMs)} ms，超过设定的 ${config.slowThresholdMs} ms。`);
  } else if (latest?.outcome === "warning") {
    status = "warning";
    priority = 35;
  } else if (latest) {
    status = "healthy";
  }

  if (latest?.consoleErrors.length) reasons.push(`捕获 ${latest.consoleErrors.length} 条页面脚本错误，建议检查具体证据。`);
  if (latest?.requestFailures.length) reasons.push(`捕获 ${latest.requestFailures.length} 条资源失败或被安全策略阻止的请求。`);
  if (latest?.outcome === "warning" && !reasons.length) reasons.push("页面可访问，但证据采集或页面检查存在警告。");
  if (baseline.anomalous && durationMs !== null && baseline.medianMs !== null && baseline.thresholdMs !== null) {
    priority = Math.min(100, priority + 15);
    if (status === "healthy") status = "warning";
    reasons.push(`本次导航比历史基线慢：${Math.round(durationMs)} ms；${baseline.samples} 次成功样本中位数 ${Math.round(baseline.medianMs)} ms，潜在异常门槛 ${Math.round(baseline.thresholdMs)} ms。`);
  }
  if (status === "healthy") reasons.push("页面响应、内容断言与资源检查通过。");
  return { site, status, attempts: [...attempts], durationMs, priority, reasons, baseline };
}

export function prioritizeResults(results: readonly SiteResult[]): SiteResult[] {
  return [...results].sort((a, b) => b.priority - a.priority);
}

export function shouldRetry(attempt: Attempt): boolean {
  if (attempt.outcome !== "failed") return false;
  if (attempt.failureCode === "HTTP") return attempt.httpStatus === 429 || (attempt.httpStatus !== null && attempt.httpStatus >= 500);
  return attempt.failureCode === "TIMEOUT" || attempt.failureCode === "DNS" || attempt.failureCode === "NETWORK";
}
