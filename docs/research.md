# 多站点巡检助手：开源调研与实现取舍

调研日期：2026-10-19，Asia/Shanghai。目标是批量访问用户关注的公开网站，汇总访问状态、加载耗时和失败记录，优先展示值得继续检查的页面。首版做一个 Next.js 服务，使用本地 JSON 和截图存储，支持本地 Chromium 和 Lexmount 云浏览器。

## 对产品最有用的结论

把一次巡检做成可复核的异常清单。首页回答三个问题：哪些页面访问失败，哪些页面明显变慢，点开后能看到什么证据。每次尝试保留 HTTP 状态、最终 URL、时间、断言、错误和截图，重试成功也显示首次失败。

Uptime Kuma 值得参考状态历史和紧凑工作台；Gatus 值得参考条件断言和错误明细；changedetection.io 值得参考浏览器取证和分离采集器；Checkly 值得参考网络错误的测试方法；Lighthouse 值得参考指标口径与测量限制。首版独立实现这些机制，不接入五套系统，也不复制未知许可证的教程代码。

## 仓库与许可证核验

下表来自公开 GitHub 仓库 API、实际 LICENSE 和固定提交的 README/实现文件。许可证是所核验提交的状态，后续复用仍需检查具体文件和第三方 NOTICE。没有依据星数或作者营销描述评估项目。

| 项目 | 核验提交 | 许可证 | 合适的参考点 | 首版取舍 |
| --- | --- | --- | --- | --- |
| [Uptime Kuma](https://github.com/louislam/uptime-kuma) | `b092505f894d66669b67f46e1da72b51016eceab` | MIT | HTTP/关键词/JSON 条件监测，heartbeat 历史，重试 pending 状态，状态页和耗时趋势 | 学习状态表达和记录结构；不移植 Vue、Socket.IO、数据库和通知系统 |
| [Gatus](https://github.com/TwiN/gatus) | `a911d7296f33edf14693785bef373e3d4a8579a3` | Apache-2.0 | 显式条件列表，状态码/响应时间/正文条件，逐条结果，限制并发的 semaphore | 用结构化 TS 条件实现少量必要断言；不复制 Go 表达式解析器和告警后台 |
| [changedetection.io](https://github.com/dgtlmoon/changedetection.io) | `804876fdd189f7d2aa8152f165e1965c56b77d51` | Apache-2.0 | HTTP 与 Playwright 采集器分开，截图和文字差异，CSS/XPath 选区，worker 队列 | 借鉴采集器与证据组织；正文变化检测留作后续，不引入 Python、多进程和通知系统 |
| [Checkly Playwright examples](https://github.com/checkly/playwright-examples) | `a42e8e455e53172155165d206700aba5143433ed` | 未声明 | 404 链接检查，`response` 监听，失败请求 JSON 附件，Playwright steps | 参考测试思路，独立实现；仓库没有 LICENSE，不能视作授权复制的组件库 |
| [Lighthouse](https://github.com/GoogleChrome/lighthouse) | `d8617feba207eebd46ae17fb4d6b137b71723010` | Apache-2.0 | 独立 gather/audit/report，HTML+JSON 报告，明确性能测量波动，多次测量聚合 | 参考测量定义和报告结构；不把一次巡检叫作 Lighthouse 审计或性能评分 |

上述四个有许可证的项目都不是 GPL/AGPL。研究结果不授权复制任何仓库的全部代码；实际采用依赖时以安装版本和相关许可证为准。

## 每个项目如何改变设计

### Uptime Kuma：失败不是一个最终布尔值

[README](https://github.com/louislam/uptime-kuma/blob/b092505f894d66669b67f46e1da72b51016eceab/README.md) 明确包含 HTTP、关键词、JSON Query 等类型，以及状态页与 Ping 图表。[monitor 实现](https://github.com/louislam/uptime-kuma/blob/b092505f894d66669b67f46e1da72b51016eceab/server/model/monitor.js) 在重试窗口使用 `PENDING`，记录重试次数和间隔；[heartbeat model](https://github.com/louislam/uptime-kuma/blob/b092505f894d66669b67f46e1da72b51016eceab/server/model/heartbeat.js) 表达一次探测记录。

本项目改成一次批量任务下的多次 attempt。第一次网络失败、第二次成功归为偶发故障，报告同时保留两次结果。访问失败详情提供重试原因、次数和恢复后的页面，而不是让绿色状态覆盖第一张失败截图。

### Gatus：规则失败要说出是哪一条

[Gatus 条件示例](https://github.com/TwiN/gatus/blob/a911d7296f33edf14693785bef373e3d4a8579a3/README.md#conditions) 同时要求状态 200、正文包含目标内容、响应小于设定值。[Result 结构](https://github.com/TwiN/gatus/blob/a911d7296f33edf14693785bef373e3d4a8579a3/config/endpoint/result.go) 分别存状态、duration、errors、conditionResults、success 和 timestamp；[watchdog](https://github.com/TwiN/gatus/blob/a911d7296f33edf14693785bef373e3d4a8579a3/watchdog/endpoint.go) 通过 semaphore 控制同时执行的任务。

首版只提供 HTTP 状态、可选预期文字和加载阈值，不开放字符串表达式执行。报告中展示通过与失败的规则，让用户知道失败来自 404、正文缺失还是加载超时。任务执行与条件判断分离，便于独立验证分类逻辑。

### changedetection.io：采集成本与证据成本分开

[README](https://github.com/dgtlmoon/changedetection.io/blob/804876fdd189f7d2aa8152f165e1965c56b77d51/README.md) 区分轻量 HTTP fetcher 和 JavaScript 浏览器 fetcher，包含截图、选择器和变化对比。[Playwright 采集器](https://github.com/dgtlmoon/changedetection.io/blob/804876fdd189f7d2aa8152f165e1965c56b77d51/changedetectionio/content_fetchers/playwright.py) 单独处理截图，并对页面再次导航后的最新主文档响应做判断；[worker pool](https://github.com/dgtlmoon/changedetection.io/blob/804876fdd189f7d2aa8152f165e1965c56b77d51/changedetectionio/worker_pool.py) 维护任务处理中状态。

本项目把浏览器启动、排队、页面导航和截图分别记录。截图失败不等于网站访问失败。浏览器厂商或采集器更换时不复用旧性能基线；采集器故障则报告“巡检执行失败”，不能把整批站点归为故障。

### Checkly：HTTP 错误与网络失败是两条通道

[404 检查示例](https://github.com/checkly/playwright-examples/blob/a42e8e455e53172155165d206700aba5143433ed/404-detection/tests/no-404s.spec.ts) 检查链接响应并附加 checked-links；[network-monitoring fixture](https://github.com/checkly/playwright-examples/blob/a42e8e455e53172155165d206700aba5143433ed/network-monitoring/tests/base.ts) 监听 `response` 并保存状态大于等于 400 的请求。示例提醒防火墙可能拦截普通请求，因此 HTTP 请求结果不能完全替代浏览器访问。

[Playwright 官方 Page 文档](https://playwright.dev/docs/api/class-page#page-goto) 明确说明：`goto` 不会因 404/500 自动抛错；HTTP 404/503 仍会触发 `requestfinished`，而不是 `requestfailed`。本项目必须显式检查主文档状态，同时收集 `response` 与 `requestfailed`。子资源失败属于需要检查，不能一律判为网站不可访问。

### Lighthouse：测量证据也要说明限制

[Variability 文档](https://github.com/GoogleChrome/lighthouse/blob/d8617feba207eebd46ae17fb4d6b137b71723010/docs/variability.md) 列出网络、页面随机内容、硬件和资源争用的影响，并明确不应在同机器并发采集多份 Lighthouse 报告。[Throttling 文档](https://github.com/GoogleChrome/lighthouse/blob/d8617feba207eebd46ae17fb4d6b137b71723010/docs/throttling.md) 区分模拟、DevTools 和包级限速，结果不是同一个口径。

本项目默认测量实际浏览器导航至 DOMContentLoaded 的耗时，记录采集位置和浏览器模式，不给综合性能分。批量有限并发适合筛出问题，不能保证排除资源争用。需要确认某个页面的性能变化时应单独复测，保持相同环境，读取多个样本。

## 交互应围绕异常清单组织

主区使用可排序的站点表格；访问失败、偶发故障、慢页面和需要检查分别显示；行详情展示截图、最终 URL、每次尝试、失败原因、耗时口径和断言。筛选只影响视图，导出保留完整原始结果。运行中给出真实完成数，不展示虚构历史数据；演示场景明确标为演示。

组件与视觉方向由 [frontend-reference.md](./frontend-reference.md) 记录，这份调研不重复前端仓库判断。优先保持数据密度、状态辨识、窄屏可读、键盘可用和真实证据入口。

## 算法参考与来源

- 并发限制：Gatus semaphore 和 changedetection.io worker queue 支持限制在途工作；本项目额外做按 hostname 限流，其默认值由工程判断确定。
- 一次受控重试：Uptime Kuma 的 retry/pending 分离说明状态转换的价值；具体可重试错误列表和一次上限由本项目定义。
- 异常检测：[NIST 潜在异常值说明](https://www.itl.nist.gov/div898/handbook/eda/section3/eda35h.htm) 给出 median absolute deviation 和 modified Z-score，并提醒异常标记需要进一步调查，不能当作因果判断。本项目使用 median/MAD 的可解释阈值，具体参数见 [algorithm.md](./algorithm.md)。
- 性能聚合：Lighthouse 建议读取多次测量的 median/percentile 并保持环境一致，不能从一个慢样本宣称回归。

## 已验证与未验证

已读取 5 个公开仓库的固定提交、4 份 LICENSE、README 和有关实现文件，并核对 Playwright 与 NIST 原始说明。Checkly 教程仓库的完整源码树未发现 LICENSE，GitHub API 的 license 也为空。本次没有执行这 5 个项目，也没有测量或比较它们的速度、误报率和云费用。

本产品仍需用可控的正常页、慢页面、HTTP 404、503 后恢复、子资源失败、预期文字缺失和取消场景验证真实行为。Lexmount 连接和 Replay 需要有效凭据才能证实；没有真实云端运行时，不把本地 Chromium 测试描述成 Lexmount 证明。
