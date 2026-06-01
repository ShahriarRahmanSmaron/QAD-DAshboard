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

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { GroupedSeriesDataset } from "./types";
import { ChartTooltip } from "./chart-tooltip";
import { useChartTheme } from "./use-chart-theme";

type GroupedBarChartProps = {
  data: GroupedSeriesDataset;
  title?: string;
  height?: number;
  showLegend?: boolean;
  showGrid?: boolean;
  stacked?: boolean;
  formatValue?: (value: number) => string;
};

export function GroupedBarChart({
  data,
  title,
  height = 360,
  showLegend = true,
  showGrid = true,
  stacked = false,
  formatValue,
}: GroupedBarChartProps) {
  const { theme, getColor } = useChartTheme();

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

  return (
    <div className="w-full rounded-lg border border-border bg-card p-4">
      {title && (
        <h3 className="mb-3 text-sm font-semibold text-foreground">{title}</h3>
      )}
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
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
