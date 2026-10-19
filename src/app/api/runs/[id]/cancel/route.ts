import { cancelRun } from "@/lib/runner";
import { assertSameOrigin } from "@/lib/security";
import { apiError } from "@/lib/http";

export const runtime = "nodejs";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const run = await cancelRun((await params).id);
    return run ? Response.json(run) : Response.json({ error: "找不到这轮巡检" }, { status: 404 });
  } catch (error) { return apiError(error); }
}
