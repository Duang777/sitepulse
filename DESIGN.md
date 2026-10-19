# SitePulse visual system

## 1. Visual theme
明亮冷灰的巡检操作台，组件和证据组织参考用户收藏的 Cult UI、Creative Tim UI 和 Agent Prism，源码与许可证记录见 docs/frontend-reference.md。以状态横带、异常优先表格和证据详情建立信息层级，所有指标来自真实运行，没有虚构统计。

## 2. Palette
canvas `oklch(96.5% 0.006 235)`；surface `oklch(99% 0.003 235)`；line `oklch(87% 0.01 235)`；text `oklch(24% 0.018 245)`；muted `oklch(52% 0.018 245)`；accent `oklch(48% 0.12 164)`；danger `oklch(50% 0.16 25)`。绿色同时表示可执行操作与正常状态，红色表示确实失败，琥珀表示进一步检查。

## 3. Typography
系统字体：SF Pro Text、PingFang SC、Noto Sans SC。标题 24px/700，章节 15px/650，正文 13px，元数据 11px。时间、HTTP code 和耗时使用 SFMono-Regular 与 tabular-nums。中文不压缩字距。

## 4. Components
按钮圆角 6px，工作面 8px，徽章 4px。按钮正常为描边或翠绿实色，hover 只改变背景，press scale(0.97)，disabled 降低不透明度。状态必有图标与文本。表格行可选中，右侧证据保持上下文；创建任务与批量导入使用原生 dialog 焦点锁。

## 5. Layout
桌面 220px 左栏，工作区宽度自由扩展。指标横带平铺，工作区采用表格 + 340px 证据栏。间距 4/8/12/16/24/32px。结果标题直接解释该页用途。

## 6. Depth
背景色阶和细线构建层级；主区无卡片阴影。仅焦点对话框有轻阴影。截图放在带浏览器地址栏的证据工作面。

## 7. Rules
不使用装饰渐变、玻璃、营销 hero、AI 图像或整页同款卡片。运行趋势样本不足显示真实空态。首字节与 DOM 就绪和总耗时分开。重试后的恢复不掩盖首次故障。报告和原始证据使用真实 API 下载。

## 8. Responsive
1100px 以下证据置于表格下方；760px 以下左栏改为顶端品牌与四项导航，表格使用独立横向滚动容器。375/320px 下标题与操作分行；编辑输入保持 16px 防止移动端缩放。交互目标至少 36px，主要触控动作 40px。支持 reduced-motion 和清晰 focus-visible。

## 9. Follow-up guide
创建指标横带：surface `oklch(99% 0.003 235)`，底线 `oklch(87% 0.01 235)` 1px，数值 28px/650，标签 11px/500，不加单独卡片阴影。
创建失败记录：danger `oklch(50% 0.16 25)` 图标与文本，背景 `oklch(96% 0.03 25)`，圆角 4px，正文 12px/500，元数据 SFMono-Regular 11px。
创建主操作按钮：accent `oklch(48% 0.12 164)`，white 文本 13px/600，圆角 6px，40px 高度，press scale(0.97)，focus 2px 翠绿 outline。
