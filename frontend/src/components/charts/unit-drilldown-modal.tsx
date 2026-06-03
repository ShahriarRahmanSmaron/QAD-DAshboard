"use client";

import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { X, ArrowUpDown, ArrowUp, ArrowDown, Loader2 } from "lucide-react";
import { getChartTimeSeries } from "@/lib/charts/api";
import { formatShortDate } from "./adapters";

type UnitDrilldownModalProps = {
  isOpen: boolean;
  onClose: () => void;
  unit: string;
  metric: string;
  metricLabel: string;
  reportTypeId: string;
  dateWindow: { date_from?: string; date_to?: string };
  latestDate: string;
  previousDate: string | null;
  formatValue?: (value: number) => string;
};

type SortField = "buyer" | "prev" | "curr" | "delta" | "percent";
type SortDirection = "asc" | "desc";

export function UnitDrilldownModal({
  isOpen,
  onClose,
  unit,
  metric,
  metricLabel,
  reportTypeId,
  dateWindow,
  latestDate,
  previousDate,
  formatValue,
}: UnitDrilldownModalProps) {
  const format = formatValue ?? ((v: number) => Math.round(v).toLocaleString());

  const [sortField, setSortField] = useState<SortField>("curr");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  // Query backend for this unit's time series grouped by buyer
  const { data: trendData, isLoading } = useQuery({
    queryKey: ["unit-drilldown", unit, metric, reportTypeId, dateWindow],
    queryFn: () =>
      getChartTimeSeries({
        metric,
        unit,
        series_by: "buyer",
        report_type_id: reportTypeId || undefined,
        date_from: dateWindow.date_from,
        date_to: dateWindow.date_to,
        limit: 365,
      }),
    enabled: isOpen && !!unit && !!metric,
    staleTime: 30_000,
  });

  // Transform raw buyer points into previous/current comparison format
  const rows = useMemo(() => {
    if (!trendData || !trendData.points) return [];

    const buyerData = new Map<string, { prev: number; curr: number }>();
    const buyers = new Set<string>();

    for (const point of trendData.points) {
      const buyer = point.series;
      if (!buyer) continue;
      buyers.add(buyer);

      const val = parseFloat(String(point.numeric_total || 0));
      let entry = buyerData.get(buyer);
      if (!entry) {
        entry = { prev: 0, curr: 0 };
        buyerData.set(buyer, entry);
      }

      if (previousDate && point.report_date === previousDate) {
        entry.prev += val;
      } else if (point.report_date === latestDate) {
        entry.curr += val;
      }
    }

    const result = Array.from(buyers).map((buyer) => {
      const entry = buyerData.get(buyer) || { prev: 0, curr: 0 };
      const difference = entry.curr - entry.prev;
      const differencePercent = entry.prev !== 0 ? (difference / entry.prev) * 100 : null;
      const direction: "up" | "down" | "flat" =
        difference > 0 ? "up" : difference < 0 ? "down" : "flat";

      return {
        buyer,
        previousValue: entry.prev,
        currentValue: entry.curr,
        difference,
        differencePercent,
        direction,
      };
    });

    // Sort according to local state
    result.sort((a, b) => {
      let valA: string | number = 0;
      let valB: string | number = 0;

      switch (sortField) {
        case "buyer":
          valA = a.buyer;
          valB = b.buyer;
          break;
        case "prev":
          valA = a.previousValue;
          valB = b.previousValue;
          break;
        case "curr":
          valA = a.currentValue;
          valB = b.currentValue;
          break;
        case "delta":
          valA = a.difference;
          valB = b.difference;
          break;
        case "percent":
          valA = a.differencePercent ?? 0;
          valB = b.differencePercent ?? 0;
          break;
      }

      if (typeof valA === "string" && typeof valB === "string") {
        return sortDirection === "asc" ? valA.localeCompare(valB) : valB.localeCompare(valA);
      } else {
        return sortDirection === "asc"
          ? (valA as number) - (valB as number)
          : (valB as number) - (valA as number);
      }
    });

    return result;
  }, [trendData, latestDate, previousDate, sortField, sortDirection]);

  if (!isOpen) return null;

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection("desc");
    }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) {
      return <ArrowUpDown className="ml-1 h-3 w-3 inline opacity-50" />;
    }
    return sortDirection === "asc" ? (
      <ArrowUp className="ml-1 h-3 w-3 inline text-primary" />
    ) : (
      <ArrowDown className="ml-1 h-3 w-3 inline text-primary" />
    );
  };

  const directionColorClass = (dir: "up" | "down" | "flat") => {
    switch (dir) {
      case "up":
        return "text-red-600 dark:text-red-400 font-semibold";
      case "down":
        return "text-green-600 dark:text-green-400 font-semibold";
      default:
        return "text-muted-foreground";
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm transition-opacity">
      <div className="relative w-full max-w-3xl overflow-hidden rounded-lg border border-border bg-card shadow-lg flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-border px-6 py-4">
          <div>
            <h2 className="text-lg font-bold text-foreground">
              Unit Detail Drilldown: {unit}
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Top Buyers contributing to {unit}&apos;s {metricLabel} backlog
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
          >
            <X className="h-4.5 w-4.5 text-muted-foreground" />
            <span className="sr-only">Close</span>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {isLoading ? (
            <div className="flex h-48 flex-col items-center justify-center gap-2">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Analyzing buyer backlog contributions...</p>
            </div>
          ) : rows.length === 0 ? (
            <div className="flex h-36 items-center justify-center rounded-lg border border-dashed border-border bg-muted/20">
              <p className="text-sm text-muted-foreground">No buyer contributions found for this unit.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground select-none">
                    <th
                      onClick={() => handleSort("buyer")}
                      className="px-4 py-2.5 text-left font-semibold cursor-pointer hover:text-foreground"
                    >
                      Buyer <SortIcon field="buyer" />
                    </th>
                    <th
                      onClick={() => handleSort("prev")}
                      className="px-4 py-2.5 text-right font-semibold cursor-pointer hover:text-foreground"
                    >
                      {previousDate ? formatShortDate(previousDate) : "Previous"} <SortIcon field="prev" />
                    </th>
                    <th
                      onClick={() => handleSort("curr")}
                      className="px-4 py-2.5 text-right font-semibold cursor-pointer hover:text-foreground"
                    >
                      {formatShortDate(latestDate)} <SortIcon field="curr" />
                    </th>
                    <th
                      onClick={() => handleSort("delta")}
                      className="px-4 py-2.5 text-right font-semibold cursor-pointer hover:text-foreground"
                    >
                      Delta <SortIcon field="delta" />
                    </th>
                    <th
                      onClick={() => handleSort("percent")}
                      className="px-4 py-2.5 text-right font-semibold cursor-pointer hover:text-foreground"
                    >
                      % Change <SortIcon field="percent" />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr
                      key={row.buyer}
                      className="border-b border-border/60 last:border-0 hover:bg-muted/40 transition-colors"
                    >
                      <td className="px-4 py-3 font-medium text-foreground">{row.buyer}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                        {format(row.previousValue)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums font-semibold text-foreground">
                        {format(row.currentValue)}
                      </td>
                      <td
                        className={`px-4 py-3 text-right tabular-nums font-semibold ${directionColorClass(
                          row.direction
                        )}`}
                      >
                        {row.difference > 0 ? "+" : ""}
                        {format(row.difference)}
                      </td>
                      <td
                        className={`px-4 py-3 text-right tabular-nums ${directionColorClass(
                          row.direction
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
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-border px-6 py-4 bg-muted/10 flex justify-end">
          <button
            onClick={onClose}
            className="inline-flex h-9 items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
