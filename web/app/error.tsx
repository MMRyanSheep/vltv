"use client";

import { RefreshCw } from "lucide-react";

export default function ArchiveError({ reset }: { reset: () => void }) {
  return <section className="panel status-panel">
    <h1>暂时无法读取档案</h1>
    <p>请确认 Axum 服务和 PostgreSQL 已启动。</p>
    <button className="button button-primary" onClick={reset}><RefreshCw size={16} /> 重试</button>
  </section>;
}
