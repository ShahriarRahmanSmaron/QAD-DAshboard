"use client";

/**
 * MD08-3A: Multi-Series Trend Chart
 *
 * Each unit (or buyer/section) becomes its own line so movement between
 * report dates is visible per unit instead of a single summed total line.
 *
 * Requirements: legend, hover tooltip, series toggle, responsive, light/dark.
 * The toggle is driven by clicking legend items, hiding/showing each series.
 */

import { useMemo, useRef, useState } from "react";
import {
  CartesianGrid,
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
import { formatShortDate } from "./adapters";
import { ChartExportButtons } from "./export-buttons";

type MultiSeriesTrendProps = {
  data: TimeSeriesDataset;
  title?: string;
  height?: number;
  formatValue?: (value: number) => string;
};

export function MultiSeriesTrend({
  data,
  title,
  height = 360,
  formatValue,
}: MultiSeriesTrendProps) {
  const { theme, getColor } = useChartTheme();
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const containerRef = useRef<HTMLDivElement>(null);

  const colorFor = useMemo(() => {
    const map: Record<string, string> = {};
    data.seriesKeys.forEach((key, index) => {
      map[key] = data.seriesColors?.[key] ?? getColor(index);
    });
    return map;
  }, [data.seriesKeys, data.seriesColors, getColor]);

  function toggle(key: string) {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  if (!data.points.length || !data.seriesKeys.length) {
    return (
      <div
        className="flex items-center justify-center rounded-lg border border-border bg-card p-6"
        style={{ height }}
      >
        <p className="text-sm text-muted-foreground">No trend data available</p>
      </div>
    );
  }

  const visibleKeys = data.seriesKeys.filter((key) => !hidden.has(key));

  return (
    <div ref={containerRef} className="w-full rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-3 gap-2">
        {title && (
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        )}
        <ChartExportButtons containerRef={containerRef} filename={title} />
      </div>

      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data.points} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
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
            tickFormatter={(v: number) => formatValue?.(v) ?? v.toLocaleString()}
          />
          <Tooltip
            content={<ChartTooltip formatValue={formatValue} />}
            labelFormatter={(label) => formatShortDate(String(label))}
          />
          {visibleKeys.map((key) => (
            <Line
              key={key}
              type="monotone"
              dataKey={key}
              name={data.seriesLabels[key] ?? key}
              stroke={colorFor[key]}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>

      {/* Interactive legend / series toggle */}
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
        {data.seriesKeys.map((key) => {
          const isHidden = hidden.has(key);
          return (
            <button
              key={key}
              type="button"
              onClick={() => toggle(key)}
              className={`flex items-center gap-1.5 text-xs font-medium transition-opacity ${
                isHidden ? "opacity-40" : "opacity-100"
              }`}
              title={isHidden ? "Show series" : "Hide series"}
            >
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: colorFor[key] }}
              />
              <span
                className={`text-foreground ${isHidden ? "line-through" : ""}`}
              >
                {data.seriesLabels[key] ?? key}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
