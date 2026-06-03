"use client";

/**
 * MD08-3A: Grouped Bar Chart
 *
 * Renders one category (e.g. a unit) with a separate bar per report date,
 * so managers compare dates side-by-side instead of seeing a summed total.
 *
 * Each report date is its own color series. Legend, tooltip, responsive
 * sizing and light/dark mode are all supported by reusing the chart theme.
 */

import { useRef } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { GroupedSeriesDataset } from "./types";
import { ChartTooltip } from "./chart-tooltip";
import { useChartTheme } from "./use-chart-theme";
import { ChartExportButtons } from "./export-buttons";

type GroupedBarChartProps = {
  data: GroupedSeriesDataset;
  title?: string;
  height?: number;
  showLegend?: boolean;
  showGrid?: boolean;
  stacked?: boolean;
  formatValue?: (value: number) => string;
  focusUnit?: string;
  onCategoryClick?: (category: string) => void;
};

export function GroupedBarChart({
  data,
  title,
  height = 360,
  showLegend = true,
  showGrid = true,
  stacked = false,
  formatValue,
  focusUnit,
  onCategoryClick,
}: GroupedBarChartProps) {
  const { theme, getColor } = useChartTheme();
  const containerRef = useRef<HTMLDivElement>(null);

  if (!data.points.length || !data.seriesKeys.length) {
    return (
      <div
        className="flex items-center justify-center rounded-lg border border-border bg-card p-6"
        style={{ height }}
      >
        <p className="text-sm text-muted-foreground">No comparison data available</p>
      </div>
    );
  }

  const isAnyUnitFocused = focusUnit && focusUnit !== "all";

  return (
    <div ref={containerRef} className="w-full rounded-lg border border-border bg-card p-4" data-chart-mode="grouped-bars">
      <div className="flex items-center justify-between mb-3 gap-2">
        {title && (
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        )}
        <ChartExportButtons containerRef={containerRef} filename={title} />
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart
          data={data.points}
          margin={{ top: 8, right: 16, left: 0, bottom: 0 }}
        >
          {showGrid && (
            <CartesianGrid
              strokeDasharray="3 3"
              stroke={theme.gridColor}
              vertical={false}
            />
          )}
          <XAxis
            dataKey="category"
            stroke={theme.axisColor}
            tick={{ fill: theme.axisLabelColor, fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: theme.axisColor }}
            interval={0}
            angle={data.points.length > 6 ? -25 : 0}
            textAnchor={data.points.length > 6 ? "end" : "middle"}
            height={data.points.length > 6 ? 60 : 30}
          />
          <YAxis
            stroke={theme.axisColor}
            tick={{ fill: theme.axisLabelColor, fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => formatValue?.(v) ?? v.toLocaleString()}
          />
          <Tooltip
            cursor={{ fill: theme.gridColor }}
            content={<ChartTooltip formatValue={formatValue} />}
          />
          {showLegend && <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />}
          {data.seriesKeys.map((key, index) => (
            <Bar
              key={key}
              dataKey={key}
              name={data.seriesLabels[key] ?? key}
              fill={getColor(index)}
              radius={[4, 4, 0, 0]}
              stackId={stacked ? "stack" : undefined}
              maxBarSize={64}
              onClick={(state) => {
                const s = state as { category?: string } | null;
                if (s && s.category) {
                  onCategoryClick?.(s.category);
                }
              }}
              className="cursor-pointer"
            >
              {data.points.map((entry, entryIdx) => {
                const isFocused = !isAnyUnitFocused || entry.category === focusUnit;
                return (
                  <Cell
                    key={`cell-${entryIdx}`}
                    fill={getColor(index)}
                    fillOpacity={isFocused ? 1.0 : 0.15}
                  />
                );
              })}
            </Bar>
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
