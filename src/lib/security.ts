import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

const blocked = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
  ["224.0.0.0", 4], ["240.0.0.0", 4],
] satisfies [string, number][]) blocked.addSubnet(address, prefix, "ipv4");
for (const [address, prefix] of [
  ["::", 128], ["::1", 128], ["::", 96], ["64:ff9b::", 96], ["64:ff9b:1::", 48],
  ["100::", 64], ["2001::", 23], ["2002::", 16], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8],
] satisfies [string, number][]) blocked.addSubnet(address, prefix, "ipv6");

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  return family === 4 ? !blocked.check(address, "ipv4") : family === 6 ? !blocked.check(address, "ipv6") : false;
}

export async function validatePublicUrl(raw: string, options: { allowDemo?: boolean; demoOrigin?: string } = {}): Promise<URL> {
  const url = new URL(raw);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("只允许 HTTP / HTTPS 网页");
  if (url.username || url.password) throw new Error("网址不能包含账号或密码");
  if (options.allowDemo && options.demoOrigin && url.origin === options.demoOrigin && /^\/api\/fixtures\/(healthy|slow|failure|flaky|content|console)$/.test(url.pathname)) return url;
  if (url.port && !["80", "443"].includes(url.port)) throw new Error("公开巡检只允许标准网页端口");
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) throw new Error("禁止访问本机或内网站点");
  const addresses = isIP(hostname) ? [{ address: hostname }] : await lookup(hostname, { all: true });
  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) throw new Error("禁止访问私有、保留或链路本地网络地址");
  return url;
}

export function redactUrl(raw: string): string {
  try {
    const url = new URL(raw);
    url.username = "";
    url.password = "";
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/key|token|secret|password|passwd|cookie|auth|session|code|signature|credential/i.test(key)) url.searchParams.set(key, "[REDACTED]");
    }
    return url.toString();
  } catch { return redactText(raw); }
}

/**
 * A Lexmount inspector link needs its opaque session identifier to locate the
 * recorded browser session. Keep that one routing parameter while stripping
 * credentials and every other query value before the link reaches the UI.
 */
export function redactInspectUrl(raw: string): string {
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol)) return redactText(raw);
    url.username = '';
    url.password = '';
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) if (key !== 'session_id') url.searchParams.delete(key);
    return url.toString();
  } catch {
    return redactText(raw);
  }
}

export function redactText(raw: string): string {
  let text = raw.slice(0, 2000);
  for (const key of [process.env.LEXMOUNT_API_KEY, process.env.LEXMOUNT_PROJECT_ID]) if (key && key.length > 3) text = text.split(key).join("[REDACTED]");
  return text
    .replace(/Bearer\s+[\w.\-]+/gi, "Bearer [REDACTED]")
    .replace(/((?:api[_-]?key|access[_-]?token|token|password|secret|authorization|cookie)\s*[=:]\s*)[^\s,;&]+/gi, "$1[REDACTED]")
    .replace(/([?&](?:token|key|secret|password|auth|code|session_id)=)[^&\s]+/gi, "$1[REDACTED]");
}

export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin) return;
  const expected = new URL(request.url);
  const supplied = new URL(origin);
  if (supplied.origin === expected.origin) return;
  const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
  if (supplied.protocol === expected.protocol && supplied.port === expected.port && loopbackHosts.has(supplied.hostname) && loopbackHosts.has(expected.hostname)) return;
  throw new Error("不允许跨站修改巡检任务");
}

export const demoKinds = ["healthy", "slow", "failure", "flaky", "content", "console"] satisfies string[];
