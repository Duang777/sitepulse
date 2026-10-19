# SitePulse 独立验证记录

执行时间：2026/10/19 15:54:27，Asia/Shanghai。

通过真实 Next.js API 创建任务，由服务端本地 Chromium 实际访问页面。报告通过另一个隔离 Chromium 上下文打开。验证脚本不会取消或删除其他人的任务。

本脚本实际执行 15 项断言场景：Passed 15，Failed 0。测试文件数是独立单元测试命令的输出口径，不以这些场景数代替。

| 分类 | 场景 | 结果 |
| --- | --- | --- |
| Passed | 设置与输入契约 | 本地 Chromium 可用，版本 1.0.0，最多 50 个站点 |
| Passed | 活动任务禁止删除 | DELETE 返回 409，未删除在途记录 |
| Passed | 真实场景：产品首页 | healthy，1 次尝试，导航 683 ms |
| Passed | 真实场景：开发文档 | slow，1 次尝试，导航 4087 ms |
| Passed | 真实场景：服务状态页 | failed，2 次尝试，导航 424 ms |
| Passed | 真实场景：活动报名页 | unstable，2 次尝试，导航 114 ms |
| Passed | 真实场景：产品定价页 | failed，1 次尝试，导航 581 ms |
| Passed | 真实场景：用户帮助页 | warning，1 次尝试，导航 182 ms |
| Passed | 首次 503 与恢复证据并存 | 两次独立尝试均保留，503 没有被 200 覆盖 |
| Passed | 所有尝试截图是真实 PNG | 8 张 PNG 可通过相应任务的证据 API 读取 |
| Passed | HTML、JSON、CSV 报告与原始结果一致 | HTML 内嵌全部 PNG，JSON 通过 schema 且一致，CSV 6 行，非法格式被拒绝 |
| Passed | 隔离浏览器打开离线 HTML 报告 | 6 个场景区块与所有图片均成功渲染，无需原服务图片路径 |
| Passed | 私有地址、跨 Origin 与无效输入被拒绝 | 私有地址 400，跨 Origin 400，无效 schema 400 |
| Passed | 取消保留终态，未开始任务取消，完成后可删除 | 取消任务终态可读，pending 项没有伪造访问记录，删除后 GET 404 |
| Passed | 真实公开站点记录完整且不预设成功 | https://example.com/ 实际结果 healthy，HTTP 200，1 次尝试 |
| Inspected | 公开网站本次观察 | 页面响应、内容断言与资源检查通过。 |
| Not run | Lexmount 会话与 Replay | 本脚本只运行本地 Chromium，没有把本地访问或 SDK 检查当成云端验证 |
| Not run | 桌面与窄屏工作台视觉 | 由主任务独立检查真实 Web UI；本脚本只打开离线 HTML 报告 |

受控演示任务：`09143470-59ec-4af6-b4bc-e8e3e5f1f60f`，6 个实际访问场景，最终状态 completed。保留于本地历史供复核。

公开站点：https://example.com/，任务 `6ed05c3e-873e-4b7b-83b8-44e6f720cd01`，状态 completed，站点结果 healthy，HTTP 200。该结果只描述本次观察，不预设外站必须成功。

## 范围与限制

本脚本验证 API、真实浏览器访问、截图可读取、报告内容和取消/删除流程。它未代替桌面与窄屏 UI 的人工视觉检查，未用公开站点可达性证明整体服务稳定，也未宣称截图脱敏能覆盖所有个人信息。Lexmount 真实会话与 Replay 单独记录，未运行时不能称为已通过。

同端口的 `127.0.0.1`、`localhost` 和 IPv6 环回地址按本机同源处理。其他 Origin 仍会被任务修改接口拒绝。

重跑：启动服务后执行 `bun run verify`。可通过 `SITEPULSE_VERIFY_ORIGIN` 与 `SITEPULSE_VERIFY_PUBLIC_URL` 指定验证目标。
