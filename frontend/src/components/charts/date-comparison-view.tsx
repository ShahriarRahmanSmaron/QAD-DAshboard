"use client";

/**
 * MD08-3A: Date Comparison View
 *
 * Dedicated current-date vs previous-date comparison for a metric, broken
 * down per group (e.g. per unit). Shows current value, previous value,
 * absolute difference and percentage difference with color-coded direction:
 *   green = increase, red = decrease, neutral = unchanged.
 */

import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import type { DateComparisonDataset } from "./types";
import { formatShortDate } from "./adapters";

type DateComparisonViewProps = {
  data: DateComparisonDataset;
  title?: string;
  formatValue?: (value: number) => string;
};

function directionClasses(direction: "up" | "down" | "flat"): string {
  switch (direction) {
    case "up":
      return "text-green-600 dark:text-green-400";
    case "down":
      return "text-red-600 dark:text-red-400";
    default:
      return "text-muted-foreground";
  }
}

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

export function DateComparisonView({
  data,
  title,
  formatValue,
}: DateComparisonViewProps) {
  const format = formatValue ?? ((v: number) => v.toLocaleString());

  if (!data.rows.length) {
    return (
      <div className="flex h-[200px] items-center justify-center rounded-lg border border-border bg-card p-6">
        <p className="text-sm text-muted-foreground">No comparison data available</p>
      </div>
    );
  }

  return (
    <div className="w-full overflow-hidden rounded-lg border border-border bg-card">
      {title && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          <p className="text-xs text-muted-foreground">
            {formatShortDate(data.previousDate)} → {formatShortDate(data.currentDate)}
          </p>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-2 text-left font-medium">
                {data.dimension}
              </th>
              <th className="px-4 py-2 text-right font-medium">
                {formatShortDate(data.previousDate)}
              </th>
              <th className="px-4 py-2 text-right font-medium">
                {formatShortDate(data.currentDate)}
              </th>
              <th className="px-4 py-2 text-right font-medium">Difference</th>
              <th className="px-4 py-2 text-right font-medium">%</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row) => (
              <tr
                key={row.key}
                className="border-b border-border/60 last:border-0 hover:bg-muted/40"
              >
                <td className="px-4 py-2 font-medium text-foreground">{row.label}</td>
                <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                  {format(row.previousValue)}
                </td>
                <td className="px-4 py-2 text-right tabular-nums font-semibold text-foreground">
                  {format(row.currentValue)}
                </td>
                <td
                  className={`px-4 py-2 text-right tabular-nums font-medium ${directionClasses(row.direction)}`}
                >
                  <span className="inline-flex items-center justify-end gap-1">
                    <DirectionIcon direction={row.direction} />
                    {row.difference > 0 ? "+" : ""}
                    {format(row.difference)}
                  </span>
                </td>
                <td
                  className={`px-4 py-2 text-right tabular-nums font-medium ${directionClasses(row.direction)}`}
                >
                  {row.differencePercent === null
                    ? "—"
                    : `${row.differencePercent > 0 ? "+" : ""}${row.differencePercent.toFixed(2)}%`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
