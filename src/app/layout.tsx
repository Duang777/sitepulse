import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SitePulse · 多站点巡检助手",
  description: "批量访问关注的网站，汇总访问状态、加载耗时和失败证据，快速找到值得进一步检查的页面。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
