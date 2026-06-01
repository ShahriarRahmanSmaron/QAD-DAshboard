"use client";

/**
 * MD08-1: Visualization Foundation — KpiCard
 *
 * Compact card displaying a single KPI value with optional delta indicator
 * and sparkline. Supports light/dark mode.
 */

import { Area, AreaChart, ResponsiveContainer } from "recharts";
import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import type { KpiValue } from "./types";
import { useChartTheme } from "./use-chart-theme";

type KpiCardProps = {
  kpi: KpiValue;
  formatValue?: (value: number | string) => string;
  showSparkline?: boolean;
};

function DirectionIcon({ direction }: { direction: "up" | "down" | "flat" }) {
  switch (direction) {
    case "up":
      return <ArrowUp className="h-3.5 w-3.5" />;
    case "down":
      return <ArrowDown className="h-3.5 w-3.5" />;
    default:
      return <Minus className="h-3.5 w-3.5" />;
  }
}

function directionColor(direction: "up" | "down" | "flat"): string {
  switch (direction) {
    case "up":
      return "text-green-600 dark:text-green-400";
    case "down":
      return "text-red-600 dark:text-red-400";
    default:
      return "text-muted-foreground";
  }
}

export function KpiCard({ kpi, formatValue, showSparkline = true }: KpiCardProps) {
  const { getColor } = useChartTheme();
  const format = formatValue ?? ((v: number | string) => {
    if (typeof v === "number") return v.toLocaleString();
    return v;
  });

  const sparklineData = kpi.sparkline?.map((value, index) => ({
    index,
    value,
  }));

  return (
    <div className="relative overflow-hidden rounded-lg border border-border bg-card p-4">
      {/* Sparkline background */}
      {showSparkline && sparklineData && sparklineData.length > 1 && (
        <div className="absolute inset-x-0 bottom-0 h-16 opacity-20">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={sparklineData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
              <Area
                type="monotone"
                dataKey="value"
                stroke={getColor(0)}
                fill={getColor(0)}
                fillOpacity={0.3}
                strokeWidth={1.5}
                dot={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Content */}
      <div className="relative z-10">
        <p className="text-xs font-medium text-muted-foreground">{kpi.label}</p>
        <p className="mt-1 text-2xl font-bold text-foreground">
          {format(kpi.value)}
          {kpi.unit && (
            <span className="ml-1 text-sm font-normal text-muted-foreground">
              {kpi.unit}
            </span>
          )}
        </p>

        {/* Delta indicator */}
        {kpi.direction && kpi.direction !== "flat" && (
          <div className={`mt-1.5 flex items-center gap-1 text-xs font-medium ${directionColor(kpi.direction)}`}>
            <DirectionIcon direction={kpi.direction} />
            {kpi.deltaPercent !== null && kpi.deltaPercent !== undefined && (
              <span>{Math.abs(kpi.deltaPercent).toFixed(1)}%</span>
            )}
            {kpi.delta !== null && kpi.delta !== undefined && (
              <span className="text-muted-foreground">
                ({kpi.delta > 0 ? "+" : ""}{format(kpi.delta)})
              </span>
            )}
          </div>
        )}
        {kpi.direction === "flat" && kpi.previousValue !== null && kpi.previousValue !== undefined && (
          <div className={`mt-1.5 flex items-center gap-1 text-xs font-medium ${directionColor("flat")}`}>
            <DirectionIcon direction="flat" />
            <span>No change</span>
          </div>
        )}
      </div>
    </div>
  );
}
