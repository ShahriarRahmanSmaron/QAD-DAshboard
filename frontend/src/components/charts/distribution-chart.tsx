"use client";

/**
 * MD08-1: Visualization Foundation — DistributionChart
 *
 * Pie/donut chart for showing proportional distribution across categories.
 */

import { useRef } from "react";
import {
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import type { GroupedTotalsDataset } from "./types";
import { useChartTheme } from "./use-chart-theme";
import { ChartExportButtons } from "./export-buttons";

type DistributionChartProps = {
  data: GroupedTotalsDataset;
  title?: string;
  height?: number;
  showLegend?: boolean;
  maxItems?: number;
  innerRadius?: number;
  formatValue?: (value: number) => string;
};

function DistributionTooltip({
  active,
  payload,
  formatValue,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; payload: { percentage: number } }>;
  formatValue?: (value: number) => string;
}) {
  if (!active || !payload?.length) return null;
  const entry = payload[0];
  if (!entry) return null;
  const format = formatValue ?? ((v: number) => v.toLocaleString());

  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 shadow-md">
      <p className="text-sm font-medium text-foreground">{entry.name}</p>
      <p className="text-xs text-muted-foreground">
        {format(entry.value)} ({entry.payload.percentage.toFixed(1)}%)
      </p>
    </div>
  );
}

export function DistributionChart({
  data,
  title,
  height = 300,
  showLegend = true,
  maxItems = 8,
  innerRadius = 60,
  formatValue,
}: DistributionChartProps) {
  const { getColor } = useChartTheme();
  const containerRef = useRef<HTMLDivElement>(null);

  const items = data.items.slice(0, maxItems);

  if (!items.length) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-border bg-card p-6" style={{ height }}>
        <p className="text-sm text-muted-foreground">No distribution data available</p>
      </div>
    );
  }

  const chartData = items.map((item) => ({
    name: item.label,
    value: item.value,
    percentage: item.percentage ?? 0,
  }));

  return (
    <div ref={containerRef} className="w-full rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-3 gap-2">
        {title && (
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        )}
        <ChartExportButtons containerRef={containerRef} filename={title} />
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          <Pie
            data={chartData}
            cx="50%"
            cy="50%"
            innerRadius={innerRadius}
            outerRadius={innerRadius + 40}
            dataKey="value"
            nameKey="name"
            paddingAngle={2}
            strokeWidth={0}
          >
            {chartData.map((_, index) => (
              <Cell key={`cell-${index}`} fill={getColor(index)} />
            ))}
          </Pie>
          <Tooltip content={<DistributionTooltip formatValue={formatValue} />} />
          {showLegend && (
            <Legend
              layout="vertical"
              align="right"
              verticalAlign="middle"
              wrapperStyle={{ fontSize: 12 }}
            />
          )}
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
