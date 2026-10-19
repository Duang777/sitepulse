import { test } from "node:test";
import assert from "node:assert/strict";
import { assertSameOrigin, isPublicAddress, redactInspectUrl, redactText, redactUrl, validatePublicUrl } from "../src/lib/security";
import { escapeHtml, reportCsv } from "../src/lib/report";
import { runSchema } from "../src/lib/contracts";

test("public URL policy blocks private, mapped IPv6, metadata and alternate ports", async () => {
  for (const address of ["127.0.0.1", "10.1.2.3", "169.254.169.254", "192.168.2.1", "::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "fc00::1", "fe80::1", "64:ff9b::a00:1"]) assert.equal(isPublicAddress(address), false, address);
  assert.equal(isPublicAddress("8.8.8.8"), true);
  assert.equal(isPublicAddress("2606:4700:4700::1111"), true);
  for (const url of ["http://127.0.0.1", "http://[::ffff:7f00:1]", "http://169.254.169.254", "https://example.com:9000", "file:///etc/passwd", "https://user:pass@example.com"]) await assert.rejects(validatePublicUrl(url));
});

test("demo exception permits only the six fixture paths on the current origin", async () => {
  const options = { allowDemo: true, demoOrigin: "http://127.0.0.1:3000" };
  await validatePublicUrl("http://127.0.0.1:3000/api/fixtures/healthy", options);
  for (const url of ["http://127.0.0.1:3000/api/settings", "http://127.0.0.1:3001/api/fixtures/healthy", "http://127.0.0.1:3000/api/fixtures/healthy/../../settings"]) await assert.rejects(validatePublicUrl(url, options));
});

test("redaction removes URL credentials, sensitive query values and bearer tokens", () => {
  const safe = redactUrl("https://user:password@example.com/path?api_key=private-key&token=secret-token&q=public#private-fragment");
  assert.ok(!safe.includes("private-key") && !safe.includes("secret-token") && !safe.includes("private-fragment") && !safe.includes("user:"));
  assert.ok(safe.includes("q=public"));
  assert.ok(!redactText("Authorization=secret-header Bearer abc.def.ghi").includes("secret-header"));
  assert.ok(!redactText("Bearer abc.def.ghi").includes("abc.def.ghi"));
});

test("Lexmount inspect link retains only the session locator", () => {
  const inspectUrl = redactInspectUrl("https://api.lexmount.test/inspect?session_id=session-123&token=private#recording");
  assert.equal(inspectUrl, "https://api.lexmount.test/inspect?session_id=session-123");
});

test("mutations reject cross-site browser origins", () => {
  assert.throws(() => assertSameOrigin(new Request("http://127.0.0.1:3000/api/runs", { headers: { origin: "https://hostile.example" } })));
  assert.doesNotThrow(() => assertSameOrigin(new Request("http://127.0.0.1:3000/api/runs", { headers: { origin: "http://127.0.0.1:3000" } })));
  assert.doesNotThrow(() => assertSameOrigin(new Request("http://localhost:3000/api/runs", { headers: { origin: "http://127.0.0.1:3000" } })));
});

test("HTML and CSV exports neutralize markup and spreadsheet formula inputs", () => {
  assert.equal(escapeHtml('<script>alert("x")</script>'), "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
  const run = runSchema.parse({ id: "123", name: "test", status: "completed", createdAt: "now", finishedAt: "now", provider: "local", demo: false, config: { sites: [{ id: "x", name: "=HYPERLINK(1)", url: "https://example.com" }] }, results: [{ site: { id: "x", name: "=HYPERLINK(1)", url: "https://example.com" }, status: "healthy", attempts: [], durationMs: null, priority: 0, reasons: [], baseline: { samples: 0, medianMs: null, madMs: null, thresholdMs: null, anomalous: false } }], sessionId: null, inspectUrl: null, replayUrl: null, error: null });
  assert.ok(reportCsv(run).includes("'=HYPERLINK(1)"));
});
