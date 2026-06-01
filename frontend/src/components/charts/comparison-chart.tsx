"use client";

/**
 * MD08-1: Visualization Foundation — ComparisonChart
 *
 * Reusable bar chart for comparing values across groups (buyers, units, dates).
 * Supports bar and stacked bar variants.
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
import type { GroupedTotalsDataset } from "./types";
import { ChartTooltip } from "./chart-tooltip";
import { useChartTheme } from "./use-chart-theme";

type ComparisonChartVariant = "bar" | "stacked-bar";

type ComparisonChartProps = {
  data: GroupedTotalsDataset;
  variant?: ComparisonChartVariant;
  title?: string;
  height?: number;
  showLegend?: boolean;
  showGrid?: boolean;
  maxItems?: number;
  formatValue?: (value: number) => string;
  layout?: "vertical" | "horizontal";
};

export function ComparisonChart({
  data,
  variant = "bar",
  title,
  height = 300,
  showLegend = false,
  showGrid = true,
  maxItems = 10,
  formatValue,
  layout = "horizontal",
}: ComparisonChartProps) {
  const { theme, getColor } = useChartTheme();

  const items = data.items.slice(0, maxItems);

  if (!items.length) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-border bg-card p-6" style={{ height }}>
        <p className="text-sm text-muted-foreground">No comparison data available</p>
      </div>
    );
  }

  const chartData = items.map((item) => ({
    name: item.label,
    value: item.value,
  }));

  const isVertical = layout === "vertical";

  return (
    <div className="w-full rounded-lg border border-border bg-card p-4">
      {title && (
        <h3 className="mb-3 text-sm font-semibold text-foreground">{title}</h3>
      )}
      <ResponsiveContainer width="100%" height={height}>
        <BarChart
          data={chartData}
          layout={isVertical ? "vertical" : "horizontal"}
          margin={{ top: 8, right: 16, left: isVertical ? 80 : 0, bottom: 0 }}
        >
          {showGrid && (
            <CartesianGrid
              strokeDasharray="3 3"
              stroke={theme.gridColor}
              horizontal={!isVertical}
              vertical={isVertical}
            />
          )}
          {isVertical ? (
            <>
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
                width={76}
              />
            </>
          ) : (
            <>
              <XAxis
                dataKey="name"
                stroke={theme.axisColor}
                tick={{ fill: theme.axisLabelColor, fontSize: 11 }}
                tickLine={false}
                axisLine={{ stroke: theme.axisColor }}
              />
              <YAxis
                stroke={theme.axisColor}
                tick={{ fill: theme.axisLabelColor, fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: number) => formatValue?.(v) ?? v.toLocaleString()}
              />
            </>
          )}
          <Tooltip content={<ChartTooltip formatValue={formatValue} />} />
          {showLegend && <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />}
          <Bar
            dataKey="value"
            name={data.groupBy}
            fill={getColor(0)}
            radius={[4, 4, 0, 0]}
            stackId={variant === "stacked-bar" ? "stack" : undefined}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
