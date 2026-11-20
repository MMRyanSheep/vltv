import type { Metadata } from "next";
import { Shell } from "@/components/shell";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "VLTV 战绩档案", template: "%s | VLTV 战绩档案" },
  description: "基于本地无畏契约回放的比赛记录与选手统计。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body><Shell>{children}</Shell></body>
    </html>
  );
}
