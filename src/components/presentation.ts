import { type Attempt, type InspectionRun, type SiteResult, type ResultStatus } from "../lib/contracts";

export const concernStatuses = new Set<ResultStatus>(["failed", "unstable", "slow", "warning"]);
export function duration(ms: number | null): string {
  if (ms === null) return "未记录";
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`;
}
export function date(value: string, full = false): string {
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", ...(full ? { second: "2-digit" } : {}), timeZone: "Asia/Shanghai" }).format(new Date(value));
}
export function domain(url: string): string {
  try { return new URL(url).host; } catch { return url; }
}
export function finalAttempt(result: SiteResult): Attempt | undefined { return result.attempts.at(-1); }
export function runLabel(run: InspectionRun): string {
  return { queued: "准备中", running: "巡检进行中", completed: "巡检已完成", cancelled: "已取消", failed: "运行失败" }[run.status];
}
