"use client";

import { RadarChart } from "echarts/charts";
import { RadarComponent } from "echarts/components";
import { init, use, type EChartsType } from "echarts/core";
import { SVGRenderer } from "echarts/renderers";
import { useEffect, useRef } from "react";
import styles from "./match-radar.module.css";

use([RadarChart, RadarComponent, SVGRenderer]);

export type RadarAxis = {
  name: string;
  description: string;
  values: (number | null)[];
  max: number;
  digits: number;
  unit?: string;
};

export function formatRadarValue(axis: RadarAxis, index: number) {
  const value = axis.values[index];
  return value == null ? "—" : value.toFixed(axis.digits) + (axis.unit ?? "");
}

function radius(chart: EChartsType) {
  return Math.max(1, Math.min(chart.getHeight() / 2 - 40, chart.getWidth() / 2 - 86));
}

export function MatchRadarChart({ axes, names }: { axes: RadarAxis[]; names: (string | undefined)[] }) {
  const container = useRef<HTMLDivElement>(null);
  const instance = useRef<EChartsType>(null);

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const chart = init(element, undefined, { renderer: "svg" });
    instance.current = chart;
    const observer = new ResizeObserver(() => {
      chart.resize();
      chart.setOption({ radar: { radius: radius(chart) } });
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      chart.dispose();
      instance.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = instance.current;
    if (!chart) return;
    const theme = getComputedStyle(chart.getDom());
    const color = [theme.getPropertyValue("--blue").trim(), theme.getPropertyValue("--red").trim()];
    const text = theme.getPropertyValue("--text").trim();
    const line = theme.getPropertyValue("--line").trim();
    const byName = new Map(axes.map((axis) => [axis.name, axis]));
    const badge = (index: number) => ({
      color: text,
      borderColor: color[index],
      borderWidth: 1,
      borderRadius: 2,
      padding: [1, 3],
      lineHeight: 20,
      fontFamily: theme.getPropertyValue("--mono").trim(),
      fontSize: 12,
    });

    chart.setOption({
      animation: false,
      radar: {
        indicator: axes.map(({ name, max }) => ({ name, min: 0, max })),
        startAngle: 67.5,
        radius: radius(chart),
        splitNumber: 5,
        splitArea: { show: false },
        splitLine: { lineStyle: { color: line } },
        axisLine: { lineStyle: { color: line } },
        axisNameGap: 8,
        axisName: {
          color: text,
          fontFamily: theme.fontFamily,
          fontSize: 12,
          lineHeight: 17,
          rich: { first: badge(0), second: badge(1) },
          formatter(name: string) {
            const axis = byName.get(name);
            if (!axis) return name;
            const first = `{first|${formatRadarValue(axis, 0)}}`;
            return `${name}\n${first}${names[1] ? `  {second|${formatRadarValue(axis, 1)}}` : ""}`;
          },
        },
      },
      series: [{
        type: "radar",
        silent: true,
        data: names.flatMap((name, index) => name ? [{
          name,
          value: axes.map((axis) => axis.values[index]),
          symbol: index === 0 ? "circle" : "diamond",
          symbolSize: 5,
          itemStyle: { color: color[index] },
          lineStyle: { color: color[index], width: 2, type: index === 0 ? "solid" : "dashed" },
          areaStyle: { color: color[index], opacity: 0.13 },
        }] : []),
      }],
    }, { notMerge: true });
  }, [axes, names]);

  const description = names.flatMap((name, index) => name ? [
    `${name}，${axes.map((axis) => `${axis.description} ${formatRadarValue(axis, index)}`).join("，")}`,
  ] : []).join("。");

  return <div role="img" aria-label={`选手雷达图。各指标使用本场统一刻度。${description}`}>
    <div className={styles.chart} ref={container} aria-hidden="true" />
  </div>;
}
