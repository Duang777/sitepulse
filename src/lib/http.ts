import { ZodError } from "zod";
import { redactText } from "./security";

export function apiError(error: unknown, status = 400): Response {
  const message = error instanceof ZodError ? error.issues.map((issue) => `${issue.path.join(".")}：${issue.message}`).join("；") : error instanceof Error ? error.message : "请求失败";
  return Response.json({ error: redactText(message) }, { status });
}

export const noCache = { "Cache-Control": "no-store" };
