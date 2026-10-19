import { getRun } from "@/lib/runner";
import { reportCsv, reportHtml } from "@/lib/report";
import { apiError } from "@/lib/http";

export const runtime = "nodejs";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const run = await getRun((await params).id);
    if (!run) return Response.json({ error: "找不到这轮巡检" }, { status: 404 });
    const format = new URL(request.url).searchParams.get("format") || "html";
    if (!["html", "json", "csv"].includes(format)) return Response.json({ error: "只支持 HTML、JSON 或 CSV 报告" }, { status: 400 });
    const body = format === "json" ? JSON.stringify(run, null, 2) : format === "csv" ? reportCsv(run) : await reportHtml(run);
    const mime = format === "json" ? "application/json" : format === "csv" ? "text/csv" : "text/html";
    return new Response(body, { headers: { "Content-Type": `${mime}; charset=utf-8`, "Content-Disposition": `attachment; filename="sitepulse-${run.id}.${format}"`, "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'", "X-Content-Type-Options": "nosniff" } });
  } catch (error) { return apiError(error, 500); }
}
