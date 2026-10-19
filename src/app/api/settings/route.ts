import { localBrowserAvailable } from "@/lib/browser";
import { noCache } from "@/lib/http";

export const runtime = "nodejs";
export async function GET() {
  return Response.json({
    lexmountConfigured: Boolean(process.env.LEXMOUNT_API_KEY && process.env.LEXMOUNT_PROJECT_ID),
    localBrowserAvailable: await localBrowserAvailable(),
    maxSites: 50, maxConcurrency: 4, version: "1.0.0",
  }, { headers: noCache });
}
