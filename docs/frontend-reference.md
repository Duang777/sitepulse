# 多站点巡检：用户公开收藏的前端项目调研

调研日期：2026-10-19（Asia/Shanghai）。GitHub 用户由主任务确认是 [Duang777](https://github.com/Duang777)，随后读取 `users/Duang777/starred?per_page=100` 并分页筛选。用户澄清希望参考的是收藏项目，本文已以公开 Starred 项目替换最初对其自有仓库的误读。只读取公开源码与许可证，没有查看私人浏览器状态。

## 五个已确认收藏的参考

| 收藏项目 | 读取的实际文件 | 对巡检产品的价值 | 许可证 / 复用决定 |
| --- | --- | --- | --- |
| [Agent Prism](https://github.com/evilmartians/agent-prism) | `packages/ui/src/components/theme/theme.css`、`SpanCard/SpanCard.tsx`、`LICENSE` | 已选中 trace 与右侧详情、每次尝试的时间/状态/展开记录，语义化 emerald/red/amber 状态 | MIT；当前只借鉴组织方式与语义色，不复制 trace SDK，避免强绑 Agent span 数据结构。 |
| [Cult UI](https://github.com/nolly-studio/cult-ui) | `apps/www/styles/globals.css`、`components/ui/badge.tsx`、`LICENSE.md` | token 驱动的中性表面；Badge 的 default/secondary/destructive/outline/ghost variants | MIT；从真实 variant 设计参考状态层级。动画按钮不适合持续巡检，不添加装饰性依赖。 |
| [Creative Tim UI](https://github.com/creativetimofficial/ui) | `apps/www/styles/globals.css`、`registry/creative-tim/ui/button.tsx`、`LICENSE.md` | button size/variant、icon shrink、disabled/focus/invalid 状态；统一 radius scale | MIT；native Button/CSS 重写对应交互，不引入 Radix Slot 与 CVA。若后续直接复制，需要保留版权声明。 |
| [Awesome shadcn/ui](https://github.com/birobirobiro/awesome-shadcn-ui) | `src/app/globals.css`、实际组件树、`LICENSE` | 组件生态索引与实际 neutral token，作为筛选来源；不能把集合中的第三方项目都视为同一许可证 | 索引仓库 MIT，内容源项目单独核实。当前仅参考统一 token 策略。 |
| [React Bits](https://github.com/DavidHDev/react-bits) | `src/ts-default/Animations/FadeContent/FadeContent.tsx`、`LICENSE.md` | 提供 mount/scroll/once 和 reduced motion 可思考的组件边界；实际 FadeContent 引入 GSAP + ScrollTrigger | 实际为 MIT + Commons Clause，GitHub API 为 NOASSERTION，不能误称纯 MIT。巡检无需滚动动画，未复制组件或新增 GSAP。 |

## 实际设计 token 证据

Agent Prism 在 light 模式声明以下 OKLCH 通道，应用时外层为 `oklch(...)`：

- 背景 `1 0 0`；正文 `21% 0.034 264.665`；次级背景 `96.7% 0.003 264.542`。
- 边框 `92.8% 0.006 264.531`，弱边框 `96.7% 0.003 264.542`。
- 成功 `69.6% 0.17 162.48`，成功底 `97.9% 0.021 166.113`，成功文字 `50.8% 0.118 165.612`。
- 错误 `63.7% 0.237 25.331`，错误底 `97.1% 0.013 17.38`。
- 警告 `79.5% 0.184 86.047`，警告底 `98.7% 0.026 102.212`，警告文字 `55.4% 0.135 66.442`。
- 源品牌为紫色 `60.6% 0.25 292.717`。本产品选翠绿行动色，不复制 Agent Prism 品牌。

Cult UI 实际 `--primary: oklch(0.205 0 0)`、`--secondary: oklch(0.97 0 0)`、`--border: oklch(0.94 0 0)`、`--radius: 0.625rem`。其彩色 gradient token 仅用于特定 demo，本产品不用。

Creative Tim UI 实际 `--radius: 0.625rem`，派生 small 为 `radius - 4px`、medium 为 `radius - 2px`。Button 默认 h-9、小尺寸 h-8、icon size-9，包含 outline/secondary/ghost/destructive/link variant 和明确 disabled/focus/invalid 状态。

Awesome shadcn/ui 实际 `--background: oklch(1 0 0)`、`--foreground: oklch(0.141 0.005 285.823)`、`--border: oklch(0.92 0.004 286.32)`、`--radius: 0.625rem`；是其索引站点的设计，不是全部收录组件的设计。

## 产品落地的选择

最终采用 **浅色运维工作台**：冷灰画布、近白工作面、翠绿主操作、红/琥珀语义状态，小圆角与细线分隔。冷灰绿色方向在用户澄清前已开始实现，此处保留作为本产品设计选择；参考依据改为收藏项目的 Button/Badge 变体与 trace 证据组织，不把自有项目作主结论。

布局为 220px 左侧导航与工作区、真实指标横带、异常优先表格、页面证据详情；窄屏将导航改为横向标签、表格独立滚动、详情下置。交互代码当前均为本产品原生实现，只有 lucide 图标依赖，无第三方组件源代码复制。

## 对齐目标与验证要求

1. 批量导入应显示合法数量、无效行与重复项，支持仅网址和 `名称 | 网址 | 分组 | 期望文字`。
2. 本次访问状态、HTTP code、导航耗时、DOM/Load 与证据采集总耗时必须区分。
3. 重试恢复保留第一次失败，不能将恢复记录涂成一直正常。
4. 所有理由、截图、尝试时间和最终 URL 来自真实 API；演示明确为「受控场景 · 真实执行」。
5. 历史样本不足显示真实空态，不用伪造趋势数据填充设计。
6. 页面必须运行验证 320/375/1280、空态、创建/导入、实时任务、结果详情、历史与报告。

本调研核实了实际源码与许可证，没有运行以上五个收藏项目或测量其性能。实现验收以本项目真实运行与截图为证据。
