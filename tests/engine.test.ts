import assert from "node:assert/strict";
import test from "node:test";
import type { Attempt, Site } from "../src/lib/contracts";
import { analyzeSite, historicalBaseline, prioritizeResults, shouldRetry } from "../src/lib/analysis";

const site: Site = { id: "test", name: "测试", url: "https://example.com", group: "测试组", expectedText: "" };
function attempt(overrides: Partial<Attempt> = {}): Attempt {
  return {
    number: 1, startedAt: "2026-10-19T00:00:00.000Z", finishedAt: "2026-10-19T00:00:01.000Z",
    durationMs: 1800, navigationMs: 1000, ttfbMs: 200, domContentLoadedMs: 1000, loadMs: 1200,
    httpStatus: 200, finalUrl: site.url, title: "Example", screenshot: null, outcome: "passed",
    failureCode: null, error: null, consoleErrors: [], requestFailures: [], assertions: [], ...overrides,
  };
}

test("历史样本不足时不把站点标为异常", () => {
  const baseline = historicalBaseline([1000, 1100, 900, 1000], 20000);
  assert.equal(baseline.samples, 4);
  assert.equal(baseline.anomalous, false);
  assert.equal(baseline.thresholdMs, null);
});

test("一个历史极值不污染正常基线，当前样本不加入基线", () => {
  const history = [980, 1000, 1010, 990, 1020, 1000, 90000];
  const baseline = historicalBaseline(history, 5000);
  assert.equal(baseline.samples, 7);
  assert.equal(baseline.medianMs, 1000);
  assert.equal(baseline.anomalous, true);
  assert.deepEqual(history, [980, 1000, 1010, 990, 1020, 1000, 90000]);
});

test("重复历史耗时的 MAD 为零时仍允许合理波动", () => {
  assert.equal(historicalBaseline([1000, 1000, 1000, 1000, 1000], 1200).anomalous, false);
  assert.equal(historicalBaseline([1000, 1000, 1000, 1000, 1000], 3000).anomalous, true);
});

test("截图开销不被当作网页加载缓慢", () => {
  const result = analyzeSite(site, [attempt({ durationMs: 9000 })], { slowThresholdMs: 3000 });
  assert.equal(result.status, "healthy");
  assert.equal(result.durationMs, 1000);
});

test("恢复后保留首次失败和解释，失败优先于恢复与缓慢", () => {
  const failed = attempt({ outcome: "failed", failureCode: "TIMEOUT", error: "页面超时。", navigationMs: 15000 });
  const recovered = analyzeSite(site, [failed, attempt({ number: 2 })], { slowThresholdMs: 3000 });
  const unavailable = analyzeSite(site, [failed], { slowThresholdMs: 3000 });
  const slow = analyzeSite(site, [attempt({ navigationMs: 4000 })], { slowThresholdMs: 3000 });
  assert.equal(recovered.status, "unstable");
  assert.equal(recovered.attempts.length, 2);
  assert.match(recovered.reasons[0] ?? "", /首次访问失败/);
  assert.deepEqual(prioritizeResults([slow, recovered, unavailable]).map((result) => result.status), ["failed", "unstable", "slow"]);
});

test("只对临时网络与服务故障进行一次重试，内容错误与权限失败不重试", () => {
  assert.equal(shouldRetry(attempt({ outcome: "failed", failureCode: "HTTP", httpStatus: 503 })), true);
  assert.equal(shouldRetry(attempt({ outcome: "failed", failureCode: "HTTP", httpStatus: 429 })), true);
  for (const status of [401, 403, 404]) assert.equal(shouldRetry(attempt({ outcome: "failed", failureCode: "HTTP", httpStatus: status })), false);
  for (const code of ["ASSERTION", "SECURITY", "SSL", "CANCELLED"]) assert.equal(shouldRetry(attempt({ outcome: "failed", failureCode: code })), false);
  assert.equal(shouldRetry(attempt({ outcome: "failed", failureCode: "TIMEOUT" })), true);
});

test("取消不会伪装成访问失败，相同优先级保持输入次序", () => {
  const cancelled = analyzeSite(site, [attempt({ outcome: "failed", failureCode: "CANCELLED" })], { slowThresholdMs: 3000 });
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.priority, 0);
  const a = analyzeSite({ ...site, id: "a" }, [attempt()], { slowThresholdMs: 3000 });
  const b = analyzeSite({ ...site, id: "b" }, [attempt()], { slowThresholdMs: 3000 });
  assert.deepEqual(prioritizeResults([b, a]).map((result) => result.site.id), ["b", "a"]);
});
