"use client";

import { ChartNoAxesColumn, ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";
import type { ArchiveMap } from "@/lib/catalog";

const PREVIEW_ROWS = 3;
const percentage = new Intl.NumberFormat("zh-CN", { style: "percent", maximumFractionDigits: 1 });

export function MapDistribution({ maps, total }: { maps: ArchiveMap[]; total: number }) {
  const [expanded, setExpanded] = useState(false);
  const Icon = expanded ? ChevronUp : ChevronDown;
  return <section className="panel distributions" aria-labelledby="distribution-title">
    <div className="section-head">
      <h2 id="distribution-title"><ChartNoAxesColumn size={16} className="accent" aria-hidden="true" />地图分布</h2>
    </div>
    {maps.length === 0 ? <p className="empty-inline">暂无地图统计。</p> : <table aria-labelledby="distribution-title">
      <thead><tr><th scope="col">地图</th><th scope="col">场次</th><th scope="col">占比</th></tr></thead>
      <tbody>
        {maps.slice(0, PREVIEW_ROWS).map(({ code, name, count }) => <tr key={code}>
          <th scope="row">{name}</th><td className="mono">{count}</td><td className="mono">{percentage.format(count / total)}</td>
        </tr>)}
      </tbody>
      {maps.length > PREVIEW_ROWS && <tbody id="distribution-more" hidden={!expanded}>
        {maps.slice(PREVIEW_ROWS).map(({ code, name, count }) => <tr key={code}>
          <th scope="row">{name}</th><td className="mono">{count}</td><td className="mono">{percentage.format(count / total)}</td>
        </tr>)}
      </tbody>}
    </table>}
    {maps.length > PREVIEW_ROWS && <button type="button" className="button button-outline more-maps"
      aria-controls="distribution-more" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
      {expanded ? "收起" : "查看更多"}<Icon size={14} aria-hidden="true" />
    </button>}
  </section>;
}
