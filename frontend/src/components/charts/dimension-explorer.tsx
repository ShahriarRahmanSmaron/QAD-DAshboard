"use client";

import React, { useMemo, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { getChartTimeSeries } from "@/lib/charts/api";
import {
  formatShortDate,
  trendToMultiSeries,
  trendToGroupedSeriesByDate,
} from "./adapters";
import { MultiSeriesTrend } from "./multi-series-trend";
import { GroupedBarChart } from "./grouped-bar-chart";
import { ChartExportButtons } from "./export-buttons";

type DimensionExplorerProps = {
  dimensionKey: string;
  dimensionLabel: string;
  contributionDimensionKey: string;
  contributionDimensionLabel: string;
  selectedVal: string | null;
  onValChange: (val: string) => void;
  availableVals: { value: string; label: string }[];
  metric: string;
  metricLabel: string;
  reportTypeId: string;
  dateWindow: { date_from?: string; date_to?: string };
  latestDate: string;
  previousDate: string | null;
  formatValue?: (value: number) => string;
  onCategoryClick?: (dimension: string, key: string) => void;
};

function DimensionExplorerInner({
  dimensionKey,
  dimensionLabel,
  contributionDimensionKey,
  contributionDimensionLabel,
  selectedVal,
  onValChange,
  availableVals,
  metric,
  metricLabel,
  reportTypeId,
  dateWindow,
  latestDate,
  previousDate,
  formatValue,
}: DimensionExplorerProps) {
  const isPct = metricLabel.toLowerCase().includes("percent") || metricLabel.toLowerCase().includes("pct") || metricLabel.includes("%");
  const defaultFormat = (v: number) => {
    return isPct ? `${v.toFixed(2)}%` : Math.round(v).toLocaleString();
  };
  const format = formatValue ?? defaultFormat;
  const containerRef = useRef<HTMLDivElement>(null);

  // Initialize selected value if none selected
  useEffect(() => {
    if (!selectedVal && availableVals.length > 0 && availableVals[0]) {
      onValChange(availableVals[0].value);
    }
  }, [selectedVal, availableVals, onValChange]);

  const activeVal = selectedVal || (availableVals[0]?.value ?? "");

  // 1. History Query for selected dimension value
  const historyQuery = useQuery({
    queryKey: ["dimension-explorer", "history", dimensionKey, activeVal, metric, reportTypeId, dateWindow],
    queryFn: () =>
      getChartTimeSeries({
        metric,
        [dimensionKey]: activeVal,
        report_type_id: reportTypeId || undefined,
        date_from: dateWindow.date_from,
        date_to: dateWindow.date_to,
        limit: 365,
      }),
    enabled: Boolean(activeVal && metric),
    staleTime: 30_000,
  });

  // 2. Contribution Query (group by contributionDimensionKey)
  const contribQuery = useQuery({
    queryKey: ["dimension-explorer", "contrib", dimensionKey, activeVal, contributionDimensionKey, metric, reportTypeId, dateWindow],
    queryFn: () =>
      getChartTimeSeries({
        metric,
        [dimensionKey]: activeVal,
        series_by: contributionDimensionKey as any,
        report_type_id: reportTypeId || undefined,
        date_from: dateWindow.date_from,
        date_to: dateWindow.date_to,
        limit: 365,
      }),
    enabled: Boolean(activeVal && metric && contributionDimensionKey),
    staleTime: 30_000,
  });

  // Trend Chart Dataset
  const trendDataset = useMemo(() => {
    if (!historyQuery.data) return null;
    const withSeriesBy = { ...historyQuery.data, series_by: dimensionKey as any };
    withSeriesBy.points = withSeriesBy.points.map(p => ({ ...p, series: activeVal }));
    return trendToMultiSeries(withSeriesBy);
  }, [historyQuery.data, activeVal, dimensionKey]);

  // Bar Chart Comparison Dates list
  const effectiveDates = useMemo(() => {
    const dates: string[] = [];
    if (previousDate) dates.push(previousDate);
    if (latestDate) dates.push(latestDate);
    return dates.sort((a, b) => a.localeCompare(b));
  }, [latestDate, previousDate]);

  const isLoading = historyQuery.isLoading || contribQuery.isLoading;

  return (
    <div className="space-y-6" ref={containerRef}>
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-4">
        <div>
          <h2 className="text-xl font-bold text-foreground">{dimensionLabel} Explorer</h2>
          <p className="text-sm text-muted-foreground">Detailed investigation of {dimensionLabel.toLowerCase()} performance</p>
        </div>
        <div className="flex items-center gap-3 font-semibold">
          <label className="text-sm font-medium text-foreground">Select {dimensionLabel}:</label>
          <select
            className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm"
            value={activeVal}
            onChange={(e) => onValChange(e.target.value)}
          >
            {availableVals.map((u) => (
              <option key={u.value} value={u.value}>
                {u.label}
              </option>
            ))}
          </select>
          <ChartExportButtons containerRef={containerRef} filename={`${dimensionKey}Explorer_${activeVal}`} />
        </div>
      </div>

      {isLoading && (
        <div className="flex h-32 items-center justify-center rounded-lg border border-border bg-card">
          <p className="text-sm text-muted-foreground animate-pulse">Loading {activeVal} data...</p>
        </div>
      )}

      {!isLoading && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Trend Chart (Line) */}
          <div className="rounded-lg border border-border bg-card shadow-sm p-4 space-y-3">
            <h3 className="text-sm font-bold text-foreground">{activeVal} — {metricLabel} Trend</h3>
            {trendDataset && (
              <MultiSeriesTrend
                data={trendDataset}
                title=""
                formatValue={format}
              />
            )}
          </div>

          {/* Contribution Chart (Bar) */}
          <div className="rounded-lg border border-border bg-card shadow-sm p-4 space-y-3">
            <h3 className="text-sm font-bold text-foreground">{contributionDimensionLabel} Contribution inside {activeVal}</h3>
            {contribQuery.data && (
              <GroupedBarChart
                data={trendToGroupedSeriesByDate(contribQuery.data, { selectedDates: effectiveDates })}
                title=""
                formatValue={format}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export const DimensionExplorer = React.memo(DimensionExplorerInner);
