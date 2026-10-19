import { runInputSchema } from "@/lib/contracts";
import { listRuns } from "@/lib/store";
import { createRun, getRun } from "@/lib/runner";
import { assertSameOrigin } from "@/lib/security";
import { apiError, noCache } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const runs = await listRuns();
    const current = await Promise.all(runs.map((run) => getRun(run.id)));
    return Response.json(current.filter(Boolean), { headers: noCache });
  } catch (error) { return apiError(error, 500); }
}
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const config = runInputSchema.parse(await request.json());
    const run = await createRun(config, new URL(request.url).origin);
    return Response.json(run, { status: 202, headers: noCache });
  } catch (error) { return apiError(error); }
}
