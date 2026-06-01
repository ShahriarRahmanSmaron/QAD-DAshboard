"use client";

import React, { useState, useMemo } from "react";
import { ArrowUpDown, ArrowUp, ArrowDown, Minus, Info } from "lucide-react";
import type { DateComparisonDataset, DateComparisonRow } from "./types";
import { formatShortDate } from "./adapters";

type UnitPerformanceMatrixProps = {
  data: DateComparisonDataset;
  onUnitClick: (unit: string) => void;
  formatValue?: (value: number) => string;
  title?: string;
};

type SortField = "unit" | "prev" | "curr" | "delta" | "percent";
type SortDirection = "asc" | "desc";
type ViewOption = "all" | "top10" | "top10-others";

export function UnitPerformanceMatrix({
  data,
  onUnitClick,
  formatValue,
  title = "Unit Performance Matrix",
}: UnitPerformanceMatrixProps) {
  const format = formatValue ?? ((v: number) => Math.round(v).toLocaleString());

  const [viewOption, setViewOption] = useState<ViewOption>("all");
  const [sortField, setSortField] = useState<SortField>("delta");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  // Handle header click for sorting
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection("desc"); // Default to desc for numeric, could be asc
    }
  };

  // Icon for sorting header
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

  // Process and filter the dataset based on view option and sorting
  const processedRows = useMemo(() => {
    const rawRows = [...data.rows];
    const totalUnits = rawRows.length;

    // Rank units by Current Value descending first to establish Top 10
    const rankedRows = [...rawRows].sort((a, b) => b.currentValue - a.currentValue);

    let displayRows: DateComparisonRow[] = [];

    if (viewOption === "all" || totalUnits <= 15) {
      displayRows = [...rawRows];
    } else if (viewOption === "top10") {
      displayRows = rankedRows.slice(0, 10);
    } else if (viewOption === "top10-others") {
      const top10 = rankedRows.slice(0, 10);
      const remaining = rankedRows.slice(10);

      if (remaining.length > 0) {
        let prevSum = 0;
        let currSum = 0;
        for (const r of remaining) {
          prevSum += r.previousValue;
          currSum += r.currentValue;
        }
        const diffSum = currSum - prevSum;
        const diffPercentSum = prevSum !== 0 ? (diffSum / prevSum) * 100 : null;

        const othersRow: DateComparisonRow = {
          key: "others-aggregate",
          label: `Others (${remaining.length} units)`,
          currentValue: currSum,
          previousValue: prevSum,
          difference: diffSum,
          differencePercent: diffPercentSum,
          direction: diffSum > 0 ? "up" : diffSum < 0 ? "down" : "flat",
        };
        displayRows = [...top10, othersRow];
      } else {
        displayRows = [...top10];
      }
    }

    // Now sort the displayRows according to sortField and sortDirection
    displayRows.sort((a, b) => {
      let valA: string | number = 0;
      let valB: string | number = 0;

      // Ensure "Others" row always stays at the bottom regardless of sort
      if (a.key === "others-aggregate") return 1;
      if (b.key === "others-aggregate") return -1;

      switch (sortField) {
        case "unit":
          valA = a.label;
          valB = b.label;
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
        return sortDirection === "asc"
          ? valA.localeCompare(valB)
          : valB.localeCompare(valA);
      } else {
        return sortDirection === "asc"
          ? (valA as number) - (valB as number)
          : (valB as number) - (valA as number);
      }
    });

    return displayRows;
  }, [data.rows, viewOption, sortField, sortDirection]);

  const directionColorClass = (dir: "up" | "down" | "flat") => {
    switch (dir) {
      case "up":
        return "text-red-600 dark:text-red-400 font-semibold"; // Backlog growth = deterioration (Red)
      case "down":
        return "text-green-600 dark:text-green-400 font-semibold"; // Backlog shrink = improvement (Green)
      default:
        return "text-muted-foreground";
    }
  };

  const DirectionIndicatorIcon = ({ dir }: { dir: "up" | "down" | "flat" }) => {
    switch (dir) {
      case "up":
        return <ArrowUp className="h-3 w-3 text-red-600 dark:text-red-400 inline mr-0.5" />;
      case "down":
        return <ArrowDown className="h-3 w-3 text-green-600 dark:text-green-400 inline mr-0.5" />;
      default:
        return <Minus className="h-3 w-3 text-muted-foreground inline mr-0.5" />;
    }
  };

  return (
    <div className="w-full rounded-lg border border-border bg-card p-4">
      {/* Table Header Controls */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-3 border-b border-border/55 pb-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          <p className="text-[11px] text-muted-foreground">
            {formatShortDate(data.previousDate)} vs {formatShortDate(data.currentDate)} · Click rows for details
          </p>
        </div>

        {/* View Options Selector if total units > 15 */}
        {data.rows.length > 15 && (
          <div className="flex items-center gap-1 rounded-md border border-input bg-background p-0.5 text-xs font-medium shadow-sm">
            <button
              onClick={() => setViewOption("all")}
              className={`rounded px-2.5 py-1 transition-colors ${
                viewOption === "all"
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Show All
            </button>
            <button
              onClick={() => setViewOption("top10")}
              className={`rounded px-2.5 py-1 transition-colors ${
                viewOption === "top10"
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Top 10
            </button>
            <button
              onClick={() => setViewOption("top10-others")}
              className={`rounded px-2.5 py-1 transition-colors ${
                viewOption === "top10-others"
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Top 10 + Others
            </button>
          </div>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
              <th
                onClick={() => handleSort("unit")}
                className="px-4 py-2.5 text-left font-semibold cursor-pointer hover:text-foreground select-none"
              >
                Unit <SortIcon field="unit" />
              </th>
              <th
                onClick={() => handleSort("prev")}
                className="px-4 py-2.5 text-right font-semibold cursor-pointer hover:text-foreground select-none"
              >
                {formatShortDate(data.previousDate)} <SortIcon field="prev" />
              </th>
              <th
                onClick={() => handleSort("curr")}
                className="px-4 py-2.5 text-right font-semibold cursor-pointer hover:text-foreground select-none"
              >
                {formatShortDate(data.currentDate)} <SortIcon field="curr" />
              </th>
              <th
                onClick={() => handleSort("delta")}
                className="px-4 py-2.5 text-right font-semibold cursor-pointer hover:text-foreground select-none"
              >
                Delta <SortIcon field="delta" />
              </th>
              <th
                onClick={() => handleSort("percent")}
                className="px-4 py-2.5 text-right font-semibold cursor-pointer hover:text-foreground select-none"
              >
                % Change <SortIcon field="percent" />
              </th>
            </tr>
          </thead>
          <tbody>
            {processedRows.map((row) => {
              const isAggregate = row.key === "others-aggregate";
              return (
                <tr
                  key={row.key}
                  onClick={() => !isAggregate && onUnitClick(row.label)}
                  className={`border-b border-border/60 last:border-0 hover:bg-muted/40 transition-colors ${
                    isAggregate
                      ? "bg-muted/10 font-medium"
                      : "cursor-pointer"
                  }`}
                >
                  <td className="px-4 py-2.5 font-medium text-foreground flex items-center gap-1.5">
                    {row.label}
                    {!isAggregate && (
                      <Info className="h-3.5 w-3.5 text-muted-foreground/60 opacity-0 group-hover:opacity-100 hover:text-primary transition-opacity" />
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                    {format(row.previousValue)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-foreground">
                    {format(row.currentValue)}
                  </td>
                  <td
                    className={`px-4 py-2.5 text-right tabular-nums font-semibold ${directionColorClass(
                      row.direction
                    )}`}
                  >
                    <DirectionIndicatorIcon dir={row.direction} />
                    {row.difference > 0 ? "+" : ""}
                    {format(row.difference)}
                  </td>
                  <td
                    className={`px-4 py-2.5 text-right tabular-nums ${directionColorClass(
                      row.direction
                    )}`}
                  >
                    {row.differencePercent === null
                      ? "—"
                      : `${row.differencePercent > 0 ? "+" : ""}${row.differencePercent.toFixed(1)}%`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
