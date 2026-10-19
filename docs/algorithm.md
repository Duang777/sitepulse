# 多站点巡检算法与验证口径

本文件描述首版的可实现规则。状态、耗时和优先级由程序根据访问证据计算，不调用模型评分。数字阈值属于默认配置或工程启发式，未经过大规模站点基准校准。

## 1. 输入与一次尝试

输入包含 1 至 50 个站点，每个站点保存名称、URL、分组和可选的预期文字。运行配置包括浏览器 provider、导航 timeout、slowThreshold、concurrency 和是否重试。URL 只接受 HTTP/HTTPS，禁止凭据 URL 和非公开目标；去重只删除 fragment、规范化 URL，不删除 query，不把不同路径合并成同一个站点。

一次 `Attempt` 独立保存开始与结束时间、总尝试耗时、导航耗时、TTFB、DOMContentLoaded、load、主文档 HTTP 状态、最终 URL、title、断言、console 错误、请求失败、截图和机器可读 failureCode。失败也写记录；截图缺失保留原因，不构造截图地址。页面运行期间只访问和读取，不填表、不登录、不主动提交。

在新浏览器上下文中注册事件后导航至 `DOMContentLoaded`，最多再等待 load 1500 ms，然后检查主文档状态、可见内容和可选文字，读取 Navigation Timing 并采集截图。导航指标在额外等待之前结束计时。不能以 `goto` 没抛错作为 HTTP 成功的证明；[Playwright 官方文档](https://playwright.dev/docs/api/class-page#page-goto) 明确说明 404/500 不会自动抛错。`response` 收集 HTTP 子资源错误，`requestfailed` 收集网络错误，二者不能互相替代。

## 2. 有限并发与按域限流

默认全局并发 3，配置范围为 1 至 4。每个 hostname 至多一个在途尝试；同域两次尝试开始之间至少间隔 750 ms，包括重试。以上是保守的工程默认值，不是性能测试结论。hostname 限制不声称能够限制同一公司所有子域，也不覆盖页面自身发出的全部子资源请求。

调度器从待执行队列选择当前可执行的站点，避免等待同域的任务占据全局槽位；不同域可以继续执行。每次尝试结束在 `finally` 中释放域名和全局许可。重试在同站点工作单元内等待 750 ms 后执行，并继续持有该域许可，不能与同域其他任务并发。等待期间占据该工作单元，因此重试较多时实际批量吞吐会降低。

```text
ready(job) = globalActive < concurrency
             AND hostActive[hostname] == 0
             AND now >= hostNextStart[hostname]

start(job): reserve global and host slots
            hostNextStart = now + 750 ms
finish(job): release both slots in finally
```

这与 [Gatus semaphore](https://github.com/TwiN/gatus/blob/a911d7296f33edf14693785bef373e3d4a8579a3/watchdog/endpoint.go) 和 [changedetection.io worker pool](https://github.com/dgtlmoon/changedetection.io/blob/804876fdd189f7d2aa8152f165e1965c56b77d51/changedetectionio/worker_pool.py) 的在途工作限制一致；按域规则是本项目增加的约束。限制并发减小资源争用，但不能消除浏览器、网络和远端服务器波动。

取消后不领取新任务，未开始项显示已取消，在途导航尽快中断并写已有证据。浏览器创建或云会话连接失败属于执行器错误，运行级别标为失败。当前未完成站点也显示 failed，但没有 attempt 且 reason 为“执行器未完成访问”；这些项没有网站可达性证据，不能描述成全部网站网络故障。

## 3. 一次受控重试

每站点最多两次尝试。只有第一次发生可恢复的技术失败、用户开启 retry 且任务未取消时，才运行第二次。第一次记录不可覆盖。重试保持相同 URL、provider、视口、timeout 和断言，使用干净上下文，不能通过移除规则让结果变绿。

| 第一次结果 | 重试 | 理由 |
| --- | --- | --- |
| DNS 解析、连接失败或导航 timeout | 一次 | 可能是短暂网络问题，保留原 failureCode |
| 主文档 HTTP 429 | 等待 750 ms 后一次 | 短期限流，当前未解析 Retry-After，公开报告需注明此限制 |
| 主文档 HTTP 5xx | 一次 | 可能是暂时服务故障 |
| HTTP 400/401/403/404 等其他 4xx | 不重试 | 输入、权限和资源缺失一般不会因立即复验恢复 |
| 预期文字缺失、URL 安全规则阻止 | 不重试 | 固定断言或边界失败，重试不能放宽要求 |
| 仅子资源错误、console error、慢页面 | 不重试 | 记录需要检查或加载缓慢，没有硬失败不触发恢复 |
| 取消、执行器连接失败 | 不重试 | 用户已取消或没有有效浏览器环境 |

复验仍失败保留两次独立错误；复验成功归为 `unstable`，中文显示“偶发故障”。这描述两次观察，没有证明网站长期不稳定。[Uptime Kuma monitor](https://github.com/louislam/uptime-kuma/blob/b092505f894d66669b67f46e1da72b51016eceab/server/model/monitor.js) 的 retry/pending 分离是状态表达参考，具体一次上限和错误列表由本项目定义。

## 4. 状态分类

主文档最终 HTTP 200 至 399 且必要断言通过，才算此次访问通过；正常浏览器重定向会进入最后文档，若仍返回 3xx 也保留实际状态。204 等无正文响应不能假定能展示正常页面。当前基础内容断言要求正文文本或媒体元素；仅有隐藏媒体可能仍通过，因此不能把这条断言称为完整渲染验证。重定向后记录最终 URL 和最终主文档状态。确认失败的断言优先于慢页面或子资源警告。

| 最终状态 | 条件 | 证据示例 |
| --- | --- | --- |
| `failed` 访问失败 | 最后尝试硬失败 | HTTP 404、两次导航 timeout、预期文字缺失 |
| `unstable` 偶发故障 | 第一次硬失败，第二次通过或警告 | 第一次 503，复验 200 |
| `slow` 加载缓慢 | 最后访问通过，超过绝对阈值 | 导航 4200 ms，绝对阈值 3000 ms |
| `warning` 需要检查 | 主文档通过，但有子资源错误、console error、证据采集问题或仅超过历史阈值 | 页面 200，脚本请求 404 |
| `healthy` 正常 | 主文档与断言通过，无上列情况 | 页面 200，导航 650 ms |
| `pending/running/cancelled` | 尚未开始、在途或取消 | 运行过程状态，不进入健康率分母 |

状态有优先级，次要问题仍保留在 reasons 和 attempts 中。页面主文档 200 只能证明访问成功；没有业务断言时，不宣称按钮、表单或核心业务可用。

## 5. 耗时口径与聚合

- `navigationMs`：调用 `page.goto` 至其 `DOMContentLoaded` 返回的时钟差耗时，是首版慢页面分类的统一口径。它可能包含浏览器通信成本，不是 Core Web Vitals。
- `ttfbMs`：Navigation Timing 的 `responseStart - requestStart`，字段无有效值时为 null，不能用 0 冒充测量值。
- `domContentLoadedMs`：Navigation Timing 的 `domContentLoadedEventEnd - startTime`，与 navigationMs 同时展示并注明差异。
- `loadMs`：仅当 `loadEventEnd` 已发生时读取；DOM 已完成而 load 尚未发生时为 null。
- `durationMs`：一次尝试全流程，含断言和截图；不能标成页面加载耗时。运行总时间另含队列、重试间隔和浏览器启动。

站点列表展示最后有效尝试的导航耗时，同时让用户查看首次尝试。汇总导航中位数只纳入有有效指标的最终通过/警告访问，附样本数量。建议健康率按实际得到访问结果的站点计算，偶发故障与慢页面不能计入正常数；取消和执行器未访问项没有可达性证据，不能据此判断网站状态。批量平均或分位数描述这一组采样结果，不代表真实用户整体性能或全时段 uptime。

若显示 P95，使用排序后 `ceil(0.95*n)-1` 的 nearest-rank 方法，并显示 n；小样本下 P95 接近最大值，不能过度解释。默认面板只需中位数和慢页面数量。

[Lighthouse variability](https://github.com/GoogleChrome/lighthouse/blob/d8617feba207eebd46ae17fb4d6b137b71723010/docs/variability.md) 说明页面、网络、硬件和资源争用都会改变测量结果。该巡检的有限并发适合筛查，需要证明性能回归时应单页、同环境多次测量。

## 6. 历史基线：median + MAD

历史只选同一规范 URL、provider 和测量配置的首轮成功访问；重试成功不混入基线，当前访问不参与计算。当前隔离键包含 URL、预期文字、provider、demo、导航 timeout 和并发；视口与 waitUntil 在实现中固定。不能把本地与云端或演示与真实运行混在一起。浏览器版本或运行环境暂未持久化，软件升级后需要删除旧基线或单独复测。首版保留最近 30 个同口径有效样本，至少 5 个才计算异常阈值。样本不足显示“历史样本不足”，`medianMs/madMs/thresholdMs` 为 null，不显示“历史正常”。

```text
m = median(history.navigationMs)
MAD = median(abs(x - m) for x in history)
robustSpread = 1.4826 * MAD
margin = max(3.5 * robustSpread, 300 ms, 0.5 * m)
historyThreshold = m + margin
anomalous = current.navigationMs > historyThreshold
absoluteSlow = current.navigationMs > slowThresholdMs
```

[NIST 的 modified Z-score](https://www.itl.nist.gov/div898/handbook/eda/section3/eda35h.htm) 为 `0.6745 * (x - median) / MAD`，绝对值大于 3.5 标为潜在异常。上面的 `1.4826` 约为 `1/0.6745`，因此 MAD 部分近似等价于单侧慢异常阈值。300 ms 和 50% 两个下限是本项目防止小幅波动误报的工程规则，5 个样本也只是启动基线的最低条件，没有统计显著性保证。网页耗时常偏态，输出必须叫“潜在变慢，建议复核”，不能声称检测到代码回归。

MAD 为 0 时仍使用绝对/比例下限，避免除以零。只检测变慢，不因变快告警。基线污染和长期性能漂移仍可能发生，可通过删除旧记录或未来版本的窗口策略调整，首版不宣称能自动发现根因。

例子是假设输入，用于解释规则，不是实测：历史 `[900, 950, 1000, 1050, 1100]` ms，median 1000，MAD 50，MAD 项约 259.5，margin 取 500，因此历史阈值 1500 ms。当前 1700 ms 超出历史阈值但没有超过默认绝对阈值 3000 ms，标为需要检查并显示本次值、样本数、中位数与异常阈值。当前 1400 ms 不触发历史规则，即便 modified Z-score 较大，工程下限避免小幅绝对波动直接告警。

## 7. 可解释优先级

优先级是排队检查顺序，不能称为 AI 风险预测或故障概率。基础分明确公开：

| 状态 | 基础分 | 建议动作 |
| --- | --- | --- |
| 访问失败 | 100 | 检查最后失败码、页面截图与断言 |
| 偶发故障 | 75 | 比较首次与复验，必要时再次单页检查 |
| 加载缓慢 | 55 | 检查绝对阈值、历史样本和页面指标 |
| 需要检查 | 35 | 检查子资源、console 和证据缺口 |
| 正常 | 0 | 无需优先处理 |

命中历史潜在变慢规则额外加 15 分，上限 100；原本正常项转为需要检查，分值为 15，其他状态保留。未命中历史规则的页面警告是 35 分，比单独历史变化更优先。同分保持输入顺序的稳定排序。每个分值都附 reasons，如“HTTP 503，两次访问失败”“第一次 timeout，复验成功”“本次 1700 ms，历史阈值 1500 ms，5 个样本”。基础状态规则优先于耗时，额外历史分不会让一个正常页面排在已确认失败前面。UI 先显示状态与原因，分值可仅用于内部排序。

## 8. 有意义的验证场景

| 可控场景 | 观察结果 | 需要确认的证据 |
| --- | --- | --- |
| 正常公开静态页 | 正常 | 200、title、有效导航指标、截图 |
| 延迟页面 | 加载缓慢 | 真实等待触发阈值，截图成本不改变导航值 |
| HTTP 404 | 访问失败且不重试 | `goto` 正常返回但断言失败，一条 attempt |
| 第一次 503、第二次 200 | 偶发故障 | 两条 attempt，首次错误未覆盖 |
| 主文档 200、脚本/图片 404 | 需要检查 | HTTP 与网络通道都能收集，主文档成功 |
| 预期文字缺失 | 访问失败且不放宽规则 | 断言名称与实际页面内容 |
| 7 个同域任务和不同域任务混合 | 同域串行，其他域继续 | 实际在途计数、开始间隔、finally 释放 |
| 取消、浏览器连接失败 | 已取消或执行器失败 | 后续任务不启动，不把未访问网页报告为故障 |
| 基线不足、MAD=0、极端样本 | 正确解释而无 NaN | 样本量、median、MAD、阈值、异常判断 |
| 历史/JSON/HTML 导出 | 值一致 | 原始结果未因筛选、排序或重试丢失 |

测试记录区分真实浏览器集成验证、纯算法测试和源码检查。一次本地运行不能证明 Lexmount Replay 可用；没有云凭据时明确记录未运行。该算法规格仍需与最终代码核对，任何未实现的配置隔离或 Retry-After 行为应在交付时作为缺口注明。
