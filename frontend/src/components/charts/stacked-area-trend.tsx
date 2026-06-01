"use client";

/**
 * MD08-3A: Stacked Area Trend (Operational Trend Composition)
 *
 * Shows the contribution of each group (e.g. unit) to the total operational
 * load over time. Supports an Absolute / Percentage toggle:
 *   Absolute   — raw metric totals stacked
 *   Percentage — each date normalized to 100% so share-of-total is visible
 */

import { useMemo, useRef, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { TimeSeriesDataset, TimeSeriesPoint, StackMode } from "./types";
import { ChartTooltip } from "./chart-tooltip";
import { useChartTheme } from "./use-chart-theme";
import { formatShortDate } from "./adapters";
import { ChartExportButtons } from "./export-buttons";

type StackedAreaTrendProps = {
  data: TimeSeriesDataset;
  title?: string;
  height?: number;
  formatValue?: (value: number) => string;
};

function toPercentage(data: TimeSeriesDataset): TimeSeriesDataset {
  const points: TimeSeriesPoint[] = data.points.map((point) => {
    let total = 0;
    for (const key of data.seriesKeys) {
      total += Number(point[key] ?? 0);
    }
    const next: TimeSeriesPoint = { date: point.date };
    for (const key of data.seriesKeys) {
      const value = Number(point[key] ?? 0);
      next[key] = total > 0 ? (value / total) * 100 : 0;
    }
    return next;
  });
  return { ...data, points };
}

export function StackedAreaTrend({
  data,
  title,
  height = 360,
  formatValue,
}: StackedAreaTrendProps) {
  const { theme, getColor } = useChartTheme();
  const [mode, setMode] = useState<StackMode>("absolute");
  const containerRef = useRef<HTMLDivElement>(null);

  const renderData = useMemo(
    () => (mode === "percentage" ? toPercentage(data) : data),
    [data, mode],
  );

  const formatY =
    mode === "percentage"
      ? (v: number) => `${v.toFixed(0)}%`
      : (v: number) => formatValue?.(v) ?? v.toLocaleString();

  const formatTooltip =
    mode === "percentage"
      ? (v: number) => `${v.toFixed(1)}%`
      : (v: number) => formatValue?.(v) ?? v.toLocaleString();

  if (!data.points.length || !data.seriesKeys.length) {
    return (
      <div
        className="flex items-center justify-center rounded-lg border border-border bg-card p-6"
        style={{ height }}
      >
        <p className="text-sm text-muted-foreground">No composition data available</p>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="w-full rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        {title && <h3 className="text-sm font-semibold text-foreground">{title}</h3>}
        <div className="flex items-center gap-3">
          <div className="inline-flex rounded-md border border-border p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setMode("absolute")}
              className={`rounded px-2 py-1 font-medium transition-colors ${
                mode === "absolute"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Absolute
            </button>
            <button
              type="button"
              onClick={() => setMode("percentage")}
              className={`rounded px-2 py-1 font-medium transition-colors ${
                mode === "percentage"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Percentage
            </button>
          </div>
          <ChartExportButtons containerRef={containerRef} filename={title} />
        </div>
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart
          data={renderData.points}
          margin={{ top: 8, right: 16, left: 0, bottom: 0 }}
          stackOffset={mode === "percentage" ? "expand" : undefined}
        >
          <CartesianGrid strokeDasharray="3 3" stroke={theme.gridColor} vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={formatShortDate}
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
            domain={mode === "percentage" ? [0, 100] : undefined}
            tickFormatter={formatY}
          />
          <Tooltip
            content={<ChartTooltip formatValue={formatTooltip} />}
            labelFormatter={(label) => formatShortDate(String(label))}
          />
          <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
          {renderData.seriesKeys.map((key, index) => (
            <Area
              key={key}
              type="monotone"
              dataKey={key}
              name={renderData.seriesLabels[key] ?? key}
              stroke={getColor(index)}
              fill={getColor(index)}
              fillOpacity={0.4}
              strokeWidth={1.5}
              stackId="stack"
              dot={false}
              activeDot={{ r: 3, strokeWidth: 2 }}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
