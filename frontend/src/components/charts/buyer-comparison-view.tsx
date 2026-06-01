"use client";

import React, { useMemo, useState, useRef } from "react";
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
import { ArrowUp, ArrowDown, Minus } from "lucide-react";
import type { OperationalTrendResponse } from "@/lib/reports/types";
import { useChartTheme } from "./use-chart-theme";
import { ChartTooltip } from "./chart-tooltip";
import { formatShortDate } from "./adapters";
import { ChartExportButtons } from "./export-buttons";

type BuyerComparisonViewProps = {
  buyerTrend: OperationalTrendResponse;
  currentDate: string;
  previousDate: string | null;
  formatValue?: (value: number) => string;
  title?: string;
};

type SortField = "current" | "delta" | "percent";

export function BuyerComparisonView({
  buyerTrend,
  currentDate,
  previousDate,
  formatValue,
  title = "Buyer Comparison View",
}: BuyerComparisonViewProps) {
  const { theme, getColor, isDark } = useChartTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const [sortBy, setSortBy] = useState<SortField>("current");

  const format = formatValue ?? ((v: number) => Math.round(v).toLocaleString());

  const processedData = useMemo(() => {
    if (!buyerTrend || !buyerTrend.points) return [];

    const prevDate = previousDate || "";
    const currDate = currentDate;

    const buyerMap = new Map<string, { prev: number; curr: number }>();
    const buyers = new Set<string>();

    for (const point of buyerTrend.points) {
      const buyer = point.series;
      if (!buyer) continue;
      buyers.add(buyer);

      const val = parseFloat(String(point.numeric_total || 0));
      let entry = buyerMap.get(buyer);
      if (!entry) {
        entry = { prev: 0, curr: 0 };
        buyerMap.set(buyer, entry);
      }

      if (point.report_date === prevDate) {
        entry.prev += val;
      } else if (point.report_date === currDate) {
        entry.curr += val;
      }
    }

    const list = Array.from(buyers).map((buyer) => {
      const entry = buyerMap.get(buyer) || { prev: 0, curr: 0 };
      const difference = entry.curr - entry.prev;
      const differencePercent = entry.prev !== 0 ? (difference / entry.prev) * 100 : null;

      return {
        buyer,
        prevVal: entry.prev,
        currVal: entry.curr,
        difference,
        differencePercent,
      };
    });

    // Sort by criteria
    list.sort((a, b) => {
      if (sortBy === "current") {
        return b.currVal - a.currVal;
      } else if (sortBy === "delta") {
        return Math.abs(b.difference) - Math.abs(a.difference);
      } else {
        const pctA = Math.abs(a.differencePercent ?? 0);
        const pctB = Math.abs(b.differencePercent ?? 0);
        return pctB - pctA;
      }
    });

    // Limit to Top 10
    return list.slice(0, 10);
  }, [buyerTrend, currentDate, previousDate, sortBy]);

  const prevLabel = previousDate ? formatShortDate(previousDate) : "Previous";
  const currLabel = formatShortDate(currentDate);

  const totalWidth = 600;
  const totalHeight = 50 + processedData.length * 22 + 20;

  // Prepare data format for Recharts
  const chartData = useMemo(() => {
    // Recharts vertical layout renders bottom-to-top, so reverse the array for display
    return [...processedData].reverse().map((item) => ({
      buyer: item.buyer,
      [prevLabel]: item.prevVal,
      [currLabel]: item.currVal,
    }));
  }, [processedData, prevLabel, currLabel]);

  if (!processedData.length) {
    return (
      <div className="flex h-[200px] items-center justify-center rounded-lg border border-border bg-card p-6">
        <p className="text-sm text-muted-foreground">No buyer comparison data available</p>
      </div>
    );
  }

  const directionColorClass = (val: number) => {
    if (val > 0) return "text-red-600 dark:text-red-400 font-semibold"; // Backlog increase
    if (val < 0) return "text-green-600 dark:text-green-400 font-semibold"; // Backlog reduction
    return "text-muted-foreground";
  };

  const DirectionIcon = ({ val }: { val: number }) => {
    if (val > 0) return <ArrowUp className="h-3 w-3 text-red-600 dark:text-red-400 inline mr-0.5" />;
    if (val < 0) return <ArrowDown className="h-3 w-3 text-green-600 dark:text-green-400 inline mr-0.5" />;
    return <Minus className="h-3 w-3 text-muted-foreground inline mr-0.5" />;
  };

  return (
    <div ref={containerRef} className="w-full rounded-lg border border-border bg-card p-4 space-y-5">
      {/* Header controls */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/55 pb-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          <p className="text-[11px] text-muted-foreground">
            Top 10 Buyers by selected metric · {prevLabel} vs {currLabel}
          </p>
        </div>

        <div className="flex items-center gap-3 print-hidden">
          {/* Sort selector */}
          <div className="flex items-center gap-1 rounded-md border border-input bg-background p-0.5 text-xs font-medium shadow-sm">
            <span className="px-2 text-muted-foreground text-[11px]">Sort By:</span>
            <button
              onClick={() => setSortBy("current")}
              className={`rounded px-2.5 py-1 transition-colors ${
                sortBy === "current"
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Current Value
            </button>
            <button
              onClick={() => setSortBy("delta")}
              className={`rounded px-2.5 py-1 transition-colors ${
                sortBy === "delta"
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Delta
            </button>
            <button
              onClick={() => setSortBy("percent")}
              className={`rounded px-2.5 py-1 transition-colors ${
                sortBy === "percent"
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Percent Change
            </button>
          </div>

          <ChartExportButtons containerRef={containerRef} filename={title} />
        </div>
      </div>

      {/* Grouped Horizontal Bar Chart */}
      <div className="h-[340px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={chartData}
            layout="vertical"
            margin={{ top: 5, right: 25, left: 20, bottom: 5 }}
          >
            {theme.gridColor && (
              <CartesianGrid
                strokeDasharray="3 3"
                stroke={theme.gridColor}
                horizontal={false}
                vertical={true}
              />
            )}
            <XAxis
              type="number"
              stroke={theme.axisColor}
              tick={{ fill: theme.axisLabelColor, fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: number) => format(v)}
            />
            <YAxis
              type="category"
              dataKey="buyer"
              stroke={theme.axisColor}
              tick={{ fill: theme.axisLabelColor, fontSize: 11, fontWeight: "500" }}
              tickLine={false}
              axisLine={false}
              width={100}
            />
            <Tooltip
              cursor={{ fill: theme.gridColor, opacity: 0.15 }}
              content={<ChartTooltip formatValue={format} />}
            />
            <Legend wrapperStyle={{ fontSize: 12, paddingTop: 6 }} />
            <Bar
              dataKey={prevLabel}
              fill={getColor(1)} // Second color for previous date
              radius={[0, 4, 4, 0]}
              maxBarSize={14}
            />
            <Bar
              dataKey={currLabel}
              fill={getColor(0)} // First color for current date
              radius={[0, 4, 4, 0]}
              maxBarSize={14}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Comparison Table */}
      <div className="overflow-x-auto border-t border-border/40 pt-4">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border text-left uppercase tracking-wider text-muted-foreground font-semibold">
              <th className="px-4 py-2 font-semibold">Buyer</th>
              <th className="px-4 py-2 text-right font-semibold">{prevLabel}</th>
              <th className="px-4 py-2 text-right font-semibold">{currLabel}</th>
              <th className="px-4 py-2 text-right font-semibold">Delta</th>
              <th className="px-4 py-2 text-right font-semibold">% Change</th>
            </tr>
          </thead>
          <tbody>
            {processedData.map((row) => (
              <tr
                key={row.buyer}
                className="border-b border-border/50 last:border-0 hover:bg-muted/30 transition-colors"
              >
                <td className="px-4 py-2.5 font-medium text-foreground">{row.buyer}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                  {format(row.prevVal)}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-foreground">
                  {format(row.currVal)}
                </td>
                <td
                  className={`px-4 py-2.5 text-right tabular-nums font-semibold ${directionColorClass(
                    row.difference
                  )}`}
                >
                  <DirectionIcon val={row.difference} />
                  {row.difference > 0 ? "+" : ""}
                  {format(row.difference)}
                </td>
                <td
                  className={`px-4 py-2.5 text-right tabular-nums ${directionColorClass(
                    row.difference
                  )}`}
                >
                  {row.differencePercent === null
                    ? "—"
                    : `${row.differencePercent > 0 ? "+" : ""}${row.differencePercent.toFixed(1)}%`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Hidden SVG replica for client-side PNG/JPEG/SVG export */}
      <div className="hidden" aria-hidden="true">
        <svg
          width={totalWidth}
          height={totalHeight}
          viewBox={`0 0 ${totalWidth} ${totalHeight}`}
          xmlns="http://www.w3.org/2000/svg"
          style={{ backgroundColor: isDark ? "#1e293b" : "#ffffff" }}
        >
          {/* Title */}
          <text
            x={10}
            y={20}
            fill={isDark ? "#f8fafc" : "#0f172a"}
            fontSize={12}
            fontWeight="bold"
          >
            {title} ({prevLabel} vs {currLabel})
          </text>

          {/* Table Headers */}
          <text x={10} y={45} fill={isDark ? "#94a3b8" : "#64748b"} fontSize={9} fontWeight="600">Buyer</text>
          <text x={220} y={45} fill={isDark ? "#94a3b8" : "#64748b"} fontSize={9} fontWeight="600" textAnchor="end">{prevLabel}</text>
          <text x={320} y={45} fill={isDark ? "#94a3b8" : "#64748b"} fontSize={9} fontWeight="600" textAnchor="end">{currLabel}</text>
          <text x={420} y={45} fill={isDark ? "#94a3b8" : "#64748b"} fontSize={9} fontWeight="600" textAnchor="end">Delta</text>
          <text x={500} y={45} fill={isDark ? "#94a3b8" : "#64748b"} fontSize={9} fontWeight="600" textAnchor="end">%</text>

          {/* Rows */}
          {processedData.map((row, i) => {
            const y = 65 + i * 22;
            const diffColor = row.difference > 0 ? "#ef4444" : row.difference < 0 ? "#22c55e" : "#64748b";
            return (
              <g key={row.buyer}>
                <text x={10} y={y} fill={isDark ? "#f8fafc" : "#0f172a"} fontSize={9} fontWeight="500">{row.buyer}</text>
                <text x={220} y={y} fill={isDark ? "#94a3b8" : "#64748b"} fontSize={9} textAnchor="end">{format(row.prevVal)}</text>
                <text x={320} y={y} fill={isDark ? "#f8fafc" : "#0f172a"} fontSize={9} fontWeight="600" textAnchor="end">{format(row.currVal)}</text>
                <text x={420} y={y} fill={diffColor} fontSize={9} fontWeight="600" textAnchor="end">
                  {row.difference > 0 ? "+" : ""}{format(row.difference)}
                </text>
                <text x={500} y={y} fill={diffColor} fontSize={9} textAnchor="end">
                  {row.differencePercent === null ? "—" : `${row.differencePercent > 0 ? "+" : ""}${row.differencePercent.toFixed(1)}%`}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
