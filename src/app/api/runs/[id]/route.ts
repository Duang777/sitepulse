import { getRun, isActive } from "@/lib/runner";
import { deleteRun } from "@/lib/store";
import { assertSameOrigin } from "@/lib/security";
import { apiError, noCache } from "@/lib/http";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, { params }: Context) {
  try {
    const { id } = await params;
    const run = await getRun(id);
    return run ? Response.json(run, { headers: noCache }) : Response.json({ error: "找不到这轮巡检" }, { status: 404 });
  } catch (error) { return apiError(error); }
}
export async function DELETE(request: Request, { params }: Context) {
  try {
    assertSameOrigin(request);
    const { id } = await params;
    if (isActive(id)) return Response.json({ error: "请先取消任务并等待浏览器停止，再删除记录" }, { status: 409 });
    await deleteRun(id);
    return Response.json({ deleted: true });
  } catch (error) { return apiError(error); }
}
