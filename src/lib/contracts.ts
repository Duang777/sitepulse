import { z } from "zod";

export const siteSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().min(1).max(100),
  url: z.string().url().max(2048),
  group: z.string().max(60).default("未分组"),
  expectedText: z.string().max(200).default(""),
});
export type Site = z.infer<typeof siteSchema>;

export const runInputSchema = z.object({
  name: z.string().min(1).max(100).default("站点巡检"),
  sites: z.array(siteSchema).min(1).max(50),
  provider: z.enum(["local", "lexmount"]).default("local"),
  timeoutMs: z.number().int().min(1000).max(60000).default(15000),
  slowThresholdMs: z.number().int().min(100).max(60000).default(3000),
  concurrency: z.number().int().min(1).max(4).default(3),
  retry: z.boolean().default(true),
  demo: z.boolean().default(false),
});
export type RunInput = z.infer<typeof runInputSchema>;
export const resultStatusSchema = z.enum(["healthy", "slow", "failed", "unstable", "warning", "pending", "running", "cancelled"]);
export type ResultStatus = z.infer<typeof resultStatusSchema>;

export const attemptSchema = z.object({
  number: z.number().int(),
  startedAt: z.string(),
  finishedAt: z.string(),
  durationMs: z.number(),
  navigationMs: z.number().nullable(),
  ttfbMs: z.number().nullable(),
  domContentLoadedMs: z.number().nullable(),
  loadMs: z.number().nullable(),
  httpStatus: z.number().nullable(),
  finalUrl: z.string(),
  title: z.string(),
  screenshot: z.string().nullable(),
  outcome: z.enum(["passed", "failed", "warning"]),
  failureCode: z.string().nullable(),
  error: z.string().nullable(),
  consoleErrors: z.array(z.string()),
  requestFailures: z.array(z.object({ url: z.string(), reason: z.string() })),
  assertions: z.array(z.object({ name: z.string(), passed: z.boolean(), detail: z.string() })),
});
export type Attempt = z.infer<typeof attemptSchema>;

export const siteResultSchema = z.object({
  site: siteSchema,
  status: resultStatusSchema,
  attempts: z.array(attemptSchema),
  durationMs: z.number().nullable(),
  priority: z.number(),
  reasons: z.array(z.string()),
  baseline: z.object({ samples: z.number(), medianMs: z.number().nullable(), madMs: z.number().nullable(), thresholdMs: z.number().nullable(), anomalous: z.boolean() }),
});
export type SiteResult = z.infer<typeof siteResultSchema>;

export const runSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(["queued", "running", "completed", "cancelled", "failed"]),
  createdAt: z.string(),
  finishedAt: z.string().nullable(),
  provider: z.enum(["local", "lexmount"]),
  demo: z.boolean(),
  config: runInputSchema,
  results: z.array(siteResultSchema),
  sessionId: z.string().nullable(),
  inspectUrl: z.string().nullable(),
  replayUrl: z.string().nullable(),
  error: z.string().nullable(),
});
export type InspectionRun = z.infer<typeof runSchema>;

export const settingsSchema = z.object({
  lexmountConfigured: z.boolean(),
  localBrowserAvailable: z.boolean(),
  maxSites: z.number(),
  maxConcurrency: z.number(),
  version: z.string(),
});
export type AppSettings = z.infer<typeof settingsSchema>;

export const statusLabels: Record<ResultStatus, string> = {
  healthy: "正常", slow: "加载缓慢", failed: "访问失败", unstable: "偶发故障", warning: "需要检查", pending: "等待中", running: "巡检中", cancelled: "已取消",
};
