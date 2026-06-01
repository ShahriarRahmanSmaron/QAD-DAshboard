"use client";

/**
 * MD08-1: Visualization Foundation — RankingChart
 *
 * Horizontal bar chart optimized for ranking display (top N buyers, units, etc.).
 * Shows values with percentage bars for quick visual comparison.
 */

import { useRef } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { GroupedTotalsDataset } from "./types";
import { ChartTooltip } from "./chart-tooltip";
import { useChartTheme } from "./use-chart-theme";
import { ChartExportButtons } from "./export-buttons";

type RankingChartProps = {
  data: GroupedTotalsDataset;
  title?: string;
  height?: number;
  maxItems?: number;
  showGrid?: boolean;
  formatValue?: (value: number) => string;
  colorByIndex?: boolean;
};

export function RankingChart({
  data,
  title,
  height,
  maxItems = 10,
  showGrid = false,
  formatValue,
  colorByIndex = false,
}: RankingChartProps) {
  const { theme, getColor } = useChartTheme();
  const containerRef = useRef<HTMLDivElement>(null);

  const items = data.items.slice(0, maxItems);
  const computedHeight = height ?? Math.max(200, items.length * 36 + 40);

  if (!items.length) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-border bg-card p-6" style={{ height: 200 }}>
        <p className="text-sm text-muted-foreground">No ranking data available</p>
      </div>
    );
  }

  const chartData = items.map((item, index) => ({
    name: item.label,
    value: item.value,
    fill: colorByIndex ? getColor(index) : getColor(0),
  }));

  return (
    <div ref={containerRef} className="w-full rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-3 gap-2">
        {title && (
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        )}
        <ChartExportButtons containerRef={containerRef} filename={title} />
      </div>
      <ResponsiveContainer width="100%" height={computedHeight}>
        <BarChart
          data={chartData}
          layout="vertical"
          margin={{ top: 4, right: 16, left: 4, bottom: 0 }}
        >
          {showGrid && (
            <CartesianGrid
              strokeDasharray="3 3"
              stroke={theme.gridColor}
              horizontal={false}
            />
          )}
          <XAxis
            type="number"
            stroke={theme.axisColor}
            tick={{ fill: theme.axisLabelColor, fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => formatValue?.(v) ?? v.toLocaleString()}
          />
          <YAxis
            type="category"
            dataKey="name"
            stroke={theme.axisColor}
            tick={{ fill: theme.axisLabelColor, fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={100}
          />
          <Tooltip content={<ChartTooltip formatValue={formatValue} />} />
          <Bar
            dataKey="value"
            name={data.groupBy}
            radius={[0, 4, 4, 0]}
            fill={getColor(0)}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
