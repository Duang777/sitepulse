import { readFile } from "node:fs/promises";
import path from "node:path";
import { runDirectory } from "@/lib/store";
import { apiError } from "@/lib/http";

export const runtime = "nodejs";
export async function GET(_request: Request, { params }: { params: Promise<{ id: string; file: string }> }) {
  try {
    const { id, file } = await params;
    if (!/^[a-zA-Z0-9_-]+\.png$/.test(file)) return Response.json({ error: "无效截图名称" }, { status: 400 });
    const png = await readFile(path.join(runDirectory(id), file));
    return new Response(png, { headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" } });
  } catch (error) { return apiError(error, 404); }
}
