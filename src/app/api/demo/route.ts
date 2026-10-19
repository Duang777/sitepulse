import { randomUUID } from "node:crypto";
import type { Site } from "@/lib/contracts";
import { noCache } from "@/lib/http";

async function warmFixtureRoute(origin: string): Promise<void> {
  try {
    const response = await fetch(new URL("/api/fixtures/healthy?warmup=1", origin), { cache: "no-store" });
    await response.text();
  } catch {
    // The real browser run still produces the evidence if a development warm-up fails.
  }
}

export async function GET(request: Request) {
  const origin = new URL(request.url).origin;
  await warmFixtureRoute(origin);
  const batch = randomUUID();
  const examples = [
    { kind: "healthy", name: "产品首页", group: "正常页面", expectedText: "服务运行正常" },
    { kind: "slow", name: "开发文档", group: "性能异常", expectedText: "文档已加载" },
    { kind: "failure", name: "服务状态页", group: "访问异常", expectedText: "" },
    { kind: "flaky", name: "活动报名页", group: "偶发故障", expectedText: "报名入口已恢复" },
    { kind: "content", name: "产品定价页", group: "内容断言", expectedText: "立即购买" },
    { kind: "console", name: "用户帮助页", group: "前端异常", expectedText: "帮助中心" },
  ];
  const sites: Site[] = examples.map((example) => ({ id: randomUUID(), name: example.name, group: example.group, expectedText: example.expectedText, url: `${origin}/api/fixtures/${example.kind}?batch=${batch}` }));
  return Response.json({ sites }, { headers: noCache });
}
