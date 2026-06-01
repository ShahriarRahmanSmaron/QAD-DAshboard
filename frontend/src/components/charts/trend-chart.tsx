"use client";

/**
 * MD08-1: Visualization Foundation — TrendChart
 *
 * Reusable time-series chart supporting line, multi-line, area, and stacked area.
 * Renders operational trend data over time with tooltips, legends, and responsive sizing.
 */

import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { TimeSeriesDataset } from "./types";
import { ChartTooltip } from "./chart-tooltip";
import { useChartTheme } from "./use-chart-theme";

type TrendChartVariant = "line" | "multi-line" | "area" | "stacked-area";

type TrendChartProps = {
  data: TimeSeriesDataset;
  variant?: TrendChartVariant;
  title?: string;
  height?: number;
  showLegend?: boolean;
  showGrid?: boolean;
  formatValue?: (value: number) => string;
  formatDate?: (date: string) => string;
};

function defaultFormatDate(date: string): string {
  try {
    const d = new Date(date);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return date;
  }
}

export function TrendChart({
  data,
  variant = "line",
  title,
  height = 300,
  showLegend = true,
  showGrid = true,
  formatValue,
  formatDate = defaultFormatDate,
}: TrendChartProps) {
  const { theme, getColor } = useChartTheme();

  if (!data.points.length) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-border bg-card p-6" style={{ height }}>
        <p className="text-sm text-muted-foreground">No trend data available</p>
      </div>
    );
  }

  const isArea = variant === "area" || variant === "stacked-area";
  const isStacked = variant === "stacked-area";
  const ChartComponent = isArea ? AreaChart : LineChart;

  return (
    <div className="w-full rounded-lg border border-border bg-card p-4">
      {title && (
        <h3 className="mb-3 text-sm font-semibold text-foreground">{title}</h3>
      )}
      <ResponsiveContainer width="100%" height={height}>
        <ChartComponent data={data.points} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
          {showGrid && (
            <CartesianGrid
              strokeDasharray="3 3"
              stroke={theme.gridColor}
              vertical={false}
            />
          )}
          <XAxis
            dataKey="date"
            tickFormatter={formatDate}
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
          <Tooltip content={<ChartTooltip formatValue={formatValue} />} />
          {showLegend && data.seriesKeys.length > 1 && (
            <Legend
              wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
            />
          )}
          {data.seriesKeys.map((key, index) =>
            isArea ? (
              <Area
                key={key}
                type="monotone"
                dataKey={key}
                name={data.seriesLabels[key] ?? key}
                stroke={data.seriesColors?.[key] ?? getColor(index)}
                fill={data.seriesColors?.[key] ?? getColor(index)}
                fillOpacity={0.15}
                strokeWidth={2}
                stackId={isStacked ? "stack" : undefined}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2 }}
              />
            ) : (
              <Line
                key={key}
                type="monotone"
                dataKey={key}
                name={data.seriesLabels[key] ?? key}
                stroke={data.seriesColors?.[key] ?? getColor(index)}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2 }}
              />
            ),
          )}
        </ChartComponent>
      </ResponsiveContainer>
    </div>
  );
}
