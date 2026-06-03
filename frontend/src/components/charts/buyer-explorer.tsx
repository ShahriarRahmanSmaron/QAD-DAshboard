"use client";

import React, { useMemo, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { getChartTimeSeries } from "@/lib/charts/api";
import {
  formatShortDate,
  trendToDateComparison,
  trendToLatestKpi,
  trendToMultiSeries,
} from "./adapters";
import { KpiCard } from "./kpi-card";
import { MultiSeriesTrend } from "./multi-series-trend";
import { ChartExportButtons } from "./export-buttons";
import { ArrowUp, ArrowDown, ArrowUpRight, ArrowDownRight, RefreshCw } from "lucide-react";

import type { OperationalTrendResponse } from "@/lib/reports/types";
import type { DateComparisonRow } from "./types";

type BuyerExplorerProps = {
  selectedBuyer: string | null;
  onBuyerChange: (buyer: string) => void;
  onUnitClick?: (unit: string) => void;
  availableBuyers: { value: string; label: string }[];
  metric: string;
  metricLabel: string;
  reportTypeId: string;
  dateWindow: { date_from?: string; date_to?: string };
  latestDate: string;
  previousDate: string | null;
  formatValue?: (value: number) => string;
};

export function BuyerExplorer({
  selectedBuyer,
  onBuyerChange,
  onUnitClick,
  availableBuyers,
  metric,
  metricLabel,
  reportTypeId,
  dateWindow,
  latestDate,
  previousDate,
  formatValue,
}: BuyerExplorerProps) {
  const format = formatValue ?? ((v: number) => Math.round(v).toLocaleString());
  const containerRef = useRef<HTMLDivElement>(null);

  // Initialize selected buyer if none selected
  useEffect(() => {
    if (!selectedBuyer && availableBuyers.length > 0 && availableBuyers[0]) {
      onBuyerChange(availableBuyers[0].value);
    }
  }, [selectedBuyer, availableBuyers, onBuyerChange]);

  const activeBuyer = selectedBuyer || (availableBuyers[0]?.value ?? "");

  // 1. Buyer History Query
  const buyerHistoryQuery = useQuery({
    queryKey: ["buyer-explorer", "history", activeBuyer, metric, reportTypeId, dateWindow],
    queryFn: () =>
      getChartTimeSeries({
        metric,
        buyer: activeBuyer,
        report_type_id: reportTypeId || undefined,
        date_from: dateWindow.date_from,
        date_to: dateWindow.date_to,
        limit: 365,
      }),
    enabled: Boolean(activeBuyer && metric),
    staleTime: 30_000,
  });

  // 2. Unit Contribution Query (group by unit)
  const unitContribQuery = useQuery({
    queryKey: ["buyer-explorer", "unit-contrib", activeBuyer, metric, reportTypeId, dateWindow],
    queryFn: () =>
      getChartTimeSeries({
        metric,
        buyer: activeBuyer,
        series_by: "unit",
        report_type_id: reportTypeId || undefined,
        date_from: dateWindow.date_from,
        date_to: dateWindow.date_to,
        limit: 365,
      }),
    enabled: Boolean(activeBuyer && metric),
    staleTime: 30_000,
  });

  // Primary Buyer KPI
  const kpiValue = useMemo(() => {
    if (!buyerHistoryQuery.data) return null;
    return trendToLatestKpi(buyerHistoryQuery.data, metricLabel);
  }, [buyerHistoryQuery.data, metricLabel]);

  // Buyer Trend Dataset
  const trendDataset = useMemo(() => {
    if (!buyerHistoryQuery.data) return null;
    const withSeriesBy = { ...buyerHistoryQuery.data, series_by: "buyer" as const };
    withSeriesBy.points = withSeriesBy.points.map(p => ({ ...p, series: activeBuyer }));
    return trendToMultiSeries(withSeriesBy);
  }, [buyerHistoryQuery.data, activeBuyer]);

  // Unit Contribution Trend Dataset
  const unitTrendDataset = useMemo(() => {
    if (!unitContribQuery.data) return null;
    return trendToMultiSeries(unitContribQuery.data, { topN: 8 });
  }, [unitContribQuery.data]);

  // Unit Movers (Current vs First/Previous)
  const moversDataset = useMemo(() => {
    if (!unitContribQuery.data || !previousDate || !latestDate) return null;
    return trendToDateComparison(unitContribQuery.data, latestDate, previousDate, { topN: 5 });
  }, [unitContribQuery.data, latestDate, previousDate]);

  const increases = useMemo(() => {
    if (!moversDataset) return [];
    return [...moversDataset.rows].filter(r => r.difference > 0).sort((a, b) => b.difference - a.difference).slice(0, 5);
  }, [moversDataset]);

  const reductions = useMemo(() => {
    if (!moversDataset) return [];
    return [...moversDataset.rows].filter(r => r.difference < 0).sort((a, b) => a.difference - b.difference).slice(0, 5);
  }, [moversDataset]);

  // History Table & Summary Rows
  const historyTableRows = useMemo(() => {
    if (!buyerHistoryQuery.data) return [];
    const points = [...buyerHistoryQuery.data.points].sort((a, b) => b.report_date.localeCompare(a.report_date));
    const rows = [];
    for (let i = 0; i < points.length; i++) {
      const current = points[i]!;
      const previous = i < points.length - 1 ? points[i + 1] : null;
      const currVal = Number(current.numeric_total);
      const prevVal = previous ? Number(previous.numeric_total) : null;
      let diff = null;
      let pct = null;
      let status = "Stable";
      
      if (prevVal !== null) {
        diff = currVal - prevVal;
        pct = prevVal !== 0 ? (diff / prevVal) * 100 : null;
        if (diff > 0) status = "Deteriorated";
        else if (diff < 0) status = "Improved";
      }

      rows.push({
        date: current!.report_date,
        value: currVal,
        diff,
        pct,
        status
      });
    }
    return rows;
  }, [buyerHistoryQuery.data]);

  // Calculate Summary Statistics
  const summaryStats = useMemo(() => {
    if (!historyTableRows.length) return null;
    const values = historyTableRows.map(r => r.value);
    const minVal = Math.min(...values);
    const maxVal = Math.max(...values);
    const avgVal = values.reduce((sum, v) => sum + v, 0) / values.length;
    const latestRow = historyTableRows[0];
    const firstRow = historyTableRows[historyTableRows.length - 1];

    let changeAbs = 0;
    let changePct = 0;
    if (latestRow && firstRow) {
      changeAbs = latestRow.value - firstRow.value;
      changePct = firstRow.value !== 0 ? (changeAbs / firstRow.value) * 100 : 0;
    }

    return {
      min: minVal,
      max: maxVal,
      avg: avgVal,
      latest: latestRow ? latestRow.value : 0,
      changeAbs,
      changePct,
      firstDate: firstRow ? firstRow.date : ""
    };
  }, [historyTableRows]);

  const isLoading = buyerHistoryQuery.isLoading || unitContribQuery.isLoading;

  return (
    <div className="space-y-6" ref={containerRef}>
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-4">
        <div>
          <h2 className="text-xl font-bold text-foreground">Buyer Explorer</h2>
          <p className="text-sm text-muted-foreground">Detailed investigation of buyer performance</p>
        </div>
        <div className="flex items-center gap-3">
          <label className="text-sm font-medium text-foreground">Select Buyer:</label>
          <select
            className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm"
            value={activeBuyer}
            onChange={(e) => onBuyerChange(e.target.value)}
          >
            {availableBuyers.map((b) => (
              <option key={b.value} value={b.value}>
                {b.label}
              </option>
            ))}
          </select>
          <ChartExportButtons containerRef={containerRef} filename={`${activeBuyer}_Explorer`} />
        </div>
      </div>

      {isLoading && (
        <div className="flex h-32 items-center justify-center rounded-lg border border-border bg-card">
          <p className="text-sm text-muted-foreground animate-pulse">Loading {activeBuyer} data...</p>
        </div>
      )}

      {!isLoading && (
        <>
          {/* Buyer Explorer Comparison Mode Header Card */}
          {previousDate && kpiValue && (
            <div className="rounded-lg border border-border/80 bg-accent/5 p-5 shadow-sm">
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-1.5">
                <RefreshCw className="size-3.5 text-primary" />
                Buyer Comparison Overview ({activeBuyer})
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="space-y-1">
                  <span className="text-xs text-muted-foreground font-medium">Previous ({formatShortDate(previousDate)})</span>
                  <div className="text-xl font-bold text-foreground">
                    {kpiValue.previousValue !== null ? format(kpiValue.previousValue as number) : "—"} <span className="text-xs text-muted-foreground">kg</span>
                  </div>
                </div>
                <div className="space-y-1">
                  <span className="text-xs text-muted-foreground font-medium">Current ({formatShortDate(latestDate)})</span>
                  <div className="text-xl font-bold text-foreground">
                    {kpiValue.value !== null ? format(kpiValue.value as number) : "—"} <span className="text-xs text-muted-foreground">kg</span>
                  </div>
                </div>
                <div className="space-y-1">
                  <span className="text-xs text-muted-foreground font-medium">Delta Absolute</span>
                  <div className={`text-xl font-bold flex items-center gap-1 ${
                    (kpiValue.delta ?? 0) > 0 ? "text-red-500" : (kpiValue.delta ?? 0) < 0 ? "text-green-500" : "text-foreground"
                  }`}>
                    {(kpiValue.delta ?? 0) > 0 ? <ArrowUpRight className="size-5" /> : (kpiValue.delta ?? 0) < 0 ? <ArrowDownRight className="size-5" /> : null}
                    {kpiValue.delta !== null && kpiValue.delta !== undefined ? `${kpiValue.delta > 0 ? "+" : ""}${format(kpiValue.delta)}` : "—"}
                  </div>
                </div>
                <div className="space-y-1">
                  <span className="text-xs text-muted-foreground font-medium">Percentage Change</span>
                  <div className={`text-xl font-bold ${
                    (kpiValue.deltaPercent ?? 0) > 0 ? "text-red-500" : (kpiValue.deltaPercent ?? 0) < 0 ? "text-green-500" : "text-foreground"
                  }`}>
                    {kpiValue.deltaPercent !== null && kpiValue.deltaPercent !== undefined
                      ? `${kpiValue.deltaPercent > 0 ? "+" : ""}${kpiValue.deltaPercent.toFixed(1)}%`
                      : "—"}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Buyer KPI Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {kpiValue && (
              <KpiCard
                kpi={kpiValue}
                formatValue={(v) => (typeof v === "number" ? format(v) : v)}
                showSparkline
              />
            )}

            {/* Top Contributing Unit Card */}
            {unitContribQuery.data && (
              <TopContributingUnitCard
                data={unitContribQuery.data}
                latestDate={latestDate}
                formatValue={format}
              />
            )}

            {/* Largest Unit Increase Card */}
            <UnitMoverCard type="increase" mover={increases[0]} formatValue={format} onUnitClick={onUnitClick} />

            {/* Largest Unit Reduction Card */}
            <UnitMoverCard type="reduction" mover={reductions[0]} formatValue={format} onUnitClick={onUnitClick} />
          </div>

          {/* Main charts section */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Buyer Trend Chart */}
            <div className="rounded-lg border border-border bg-card shadow-sm">
              <div className="p-4 border-b border-border flex justify-between items-center">
                <h3 className="text-sm font-semibold">{activeBuyer} — {metricLabel} Trend</h3>
                <ChartExportButtons containerRef={containerRef} filename={`${activeBuyer}_Trend_${latestDate}`} />
              </div>
              <div className="p-4">
                {trendDataset && (
                  <MultiSeriesTrend
                    data={trendDataset}
                    title=""
                    formatValue={format}
                  />
                )}
              </div>
            </div>

            {/* Unit Contribution to Buyer (Grouped/Comparison Chart) */}
            <div className="rounded-lg border border-border bg-card shadow-sm">
              <div className="p-4 border-b border-border flex justify-between items-center">
                <h3 className="text-sm font-semibold">Unit Contribution inside {activeBuyer}</h3>
                <ChartExportButtons containerRef={containerRef} filename={`${activeBuyer}_Unit_Contribution_${latestDate}`} />
              </div>
              <div className="p-4">
                {unitContribQuery.data && previousDate && (
                  <UnitComparisonSection
                    unitTrend={unitContribQuery.data}
                    currentDate={latestDate}
                    previousDate={previousDate}
                    formatValue={format}
                    onUnitClick={onUnitClick}
                  />
                )}
              </div>
            </div>
          </div>

          {/* Unit Contribution Trend */}
          <div className="rounded-lg border border-border bg-card shadow-sm">
            <div className="p-4 border-b border-border flex justify-between items-center">
              <h3 className="text-sm font-semibold">Unit Contribution Trend for {activeBuyer}</h3>
              <ChartExportButtons containerRef={containerRef} filename={`${activeBuyer}_Unit_Contribution_Trend`} />
            </div>
            <div className="p-4">
              {unitTrendDataset && (
                <MultiSeriesTrend
                  data={unitTrendDataset}
                  title=""
                  formatValue={format}
                />
              )}
            </div>
          </div>

          {/* Unit Movers Tables */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="rounded-lg border border-border bg-card shadow-sm p-4">
              <h3 className="text-sm font-semibold text-red-600 mb-3">Largest Unit Increases</h3>
              <UnitMoversTable movers={increases} formatValue={format} onUnitClick={onUnitClick} />
            </div>
            <div className="rounded-lg border border-border bg-card shadow-sm p-4">
              <h3 className="text-sm font-semibold text-green-600 mb-3">Largest Unit Reductions</h3>
              <UnitMoversTable movers={reductions} formatValue={format} onUnitClick={onUnitClick} />
            </div>
          </div>

          {/* Buyer History Table & Summary Row */}
          <div className="rounded-lg border border-border bg-card shadow-sm p-4">
            <div className="flex justify-between items-center mb-3">
              <h3 className="text-sm font-semibold">Buyer History Table: {activeBuyer}</h3>
              {summaryStats && (
                <div className="text-xs bg-muted/50 rounded-md px-3 py-1.5 flex flex-wrap gap-x-4 gap-y-1 font-medium text-muted-foreground border border-border/40">
                  <div>Min: <span className="font-bold text-foreground">{format(summaryStats.min)}</span></div>
                  <div>Max: <span className="font-bold text-foreground">{format(summaryStats.max)}</span></div>
                  <div>Avg: <span className="font-bold text-foreground">{format(summaryStats.avg)}</span></div>
                  <div>Latest: <span className="font-bold text-foreground">{format(summaryStats.latest)}</span></div>
                  <div>
                    Change vs First ({formatShortDate(summaryStats.firstDate)}):{" "}
                    <span className={`font-bold ${summaryStats.changeAbs > 0 ? "text-red-500" : summaryStats.changeAbs < 0 ? "text-green-500" : "text-foreground"}`}>
                      {summaryStats.changeAbs > 0 ? "+" : ""}{format(summaryStats.changeAbs)} ({summaryStats.changePct > 0 ? "+" : ""}{summaryStats.changePct.toFixed(1)}%)
                    </span>
                  </div>
                </div>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left uppercase text-muted-foreground text-xs">
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2 text-right">Value</th>
                    <th className="px-3 py-2 text-right">Delta</th>
                    <th className="px-3 py-2 text-right">% Change</th>
                    <th className="px-3 py-2 text-right">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {historyTableRows.map((row) => (
                    <tr key={row.date} className="border-b border-border/50 last:border-0 hover:bg-muted/40">
                      <td className="px-3 py-2.5 font-medium text-foreground">{formatShortDate(row.date)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-foreground">{format(row.value)}</td>
                      <td className={`px-3 py-2.5 text-right tabular-nums font-semibold ${row.diff && row.diff > 0 ? "text-red-500" : row.diff && row.diff < 0 ? "text-green-500" : "text-muted-foreground"}`}>
                        {row.diff !== null ? `${row.diff > 0 ? "+" : ""}${format(row.diff)}` : "—"}
                      </td>
                      <td className={`px-3 py-2.5 text-right tabular-nums ${row.diff && row.diff > 0 ? "text-red-500" : row.diff && row.diff < 0 ? "text-green-500" : "text-muted-foreground"}`}>
                        {row.pct !== null ? `${row.pct > 0 ? "+" : ""}${row.pct.toFixed(1)}%` : "—"}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${row.status === "Deteriorated" ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400" : row.status === "Improved" ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400" : "bg-muted text-muted-foreground"}`}>
                          {row.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helper Sub-Components
// ---------------------------------------------------------------------------

type TopContributingUnitCardProps = {
  data: OperationalTrendResponse;
  latestDate: string;
  formatValue: (v: number) => string;
};

function TopContributingUnitCard({ data, latestDate, formatValue }: TopContributingUnitCardProps) {
  const { topUnit, share, value } = useMemo(() => {
    if (!data || !data.points) return { topUnit: null, share: null, value: null };
    let total = 0;
    const unitMap = new Map<string, number>();
    for (const point of data.points) {
      if (point.report_date === latestDate) {
        const v = Number(point.numeric_total);
        total += v;
        const u = point.series || "Unknown";
        unitMap.set(u, (unitMap.get(u) || 0) + v);
      }
    }
    if (total === 0) return { topUnit: null, share: null, value: null };
    
    let topUnit = null;
    let maxVal = 0;
    for (const [u, v] of unitMap.entries()) {
      if (v > maxVal) {
        maxVal = v;
        topUnit = u;
      }
    }
    const share = (maxVal / total) * 100;
    return { topUnit, share, value: maxVal };
  }, [data, latestDate]);

  if (!topUnit) {
    return (
      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="text-xs font-semibold uppercase text-muted-foreground">Top Unit</h3>
        <p className="text-sm text-muted-foreground">No top unit data</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4 flex flex-col justify-between shadow-sm">
      <h3 className="text-xs font-semibold uppercase text-muted-foreground">Top Contributing Unit</h3>
      <div className="mt-2 text-xl font-bold text-foreground truncate" title={topUnit}>{topUnit}</div>
      <div className="mt-1 text-sm text-muted-foreground flex items-center gap-2">
        <span className="font-semibold text-foreground">{formatValue(value)}</span>
        <span className="text-xs">({share?.toFixed(1)}% share)</span>
      </div>
    </div>
  );
}

type UnitMoverCardProps = {
  type: "increase" | "reduction";
  mover?: DateComparisonRow;
  formatValue: (v: number) => string;
  onUnitClick?: (unit: string) => void;
};

function UnitMoverCard({ type, mover, formatValue, onUnitClick }: UnitMoverCardProps) {
  if (!mover) {
    return (
      <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <h3 className="text-xs font-semibold uppercase text-muted-foreground">Largest {type}</h3>
        <p className="mt-2 text-sm text-muted-foreground italic">No data</p>
      </div>
    );
  }

  const isInc = type === "increase";
  const color = isInc ? "text-red-500" : "text-green-500";
  const Icon = isInc ? ArrowUp : ArrowDown;

  return (
    <div className="rounded-lg border border-border bg-card p-4 flex flex-col justify-between shadow-sm">
      <h3 className="text-xs font-semibold uppercase text-muted-foreground">Largest Unit {type === "increase" ? "Increase" : "Reduction"}</h3>
      <div 
        className="mt-2 text-xl font-bold text-foreground truncate cursor-pointer hover:text-primary hover:underline" 
        title={mover.label}
        onClick={() => onUnitClick?.(mover.key)}
      >
        {mover.label}
      </div>
      <div className="mt-1 flex items-center gap-2">
        <span className={`text-sm font-bold flex items-center ${color}`}>
          <Icon className="w-3.5 h-3.5 mr-0.5" />
          {formatValue(Math.abs(mover.difference))}
        </span>
        <span className="text-xs text-muted-foreground">
          ({(mover.differencePercent ?? 0) > 0 ? "+" : ""}{mover.differencePercent?.toFixed(1)}%)
        </span>
      </div>
    </div>
  );
}

type UnitMoversTableProps = {
  movers: DateComparisonRow[];
  formatValue: (v: number) => string;
  onUnitClick?: (unit: string) => void;
};

function UnitMoversTable({ movers, formatValue, onUnitClick }: UnitMoversTableProps) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border text-left uppercase text-muted-foreground">
            <th className="px-2 py-2">Unit</th>
            <th className="px-2 py-2 text-right">Previous</th>
            <th className="px-2 py-2 text-right">Current</th>
            <th className="px-2 py-2 text-right">Delta</th>
            <th className="px-2 py-2 text-right">%</th>
          </tr>
        </thead>
        <tbody>
          {movers.length === 0 ? (
            <tr><td colSpan={5} className="py-3 text-center italic text-muted-foreground">No data</td></tr>
          ) : (
            movers.map((m) => (
              <tr key={m.key} className="border-b border-border/50 last:border-0 hover:bg-muted/30">
                <td 
                  className="px-2 py-2 font-medium cursor-pointer hover:text-primary hover:underline"
                  onClick={() => onUnitClick?.(m.key)}
                >
                  {m.label}
                </td>
                <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">{formatValue(m.previousValue)}</td>
                <td className="px-2 py-2 text-right tabular-nums font-semibold">{formatValue(m.currentValue)}</td>
                <td className={`px-2 py-2 text-right tabular-nums font-bold ${m.difference > 0 ? "text-red-500" : "text-green-500"}`}>
                  {m.difference > 0 ? "+" : ""}{formatValue(m.difference)}
                </td>
                <td className={`px-2 py-2 text-right tabular-nums ${m.difference > 0 ? "text-red-500" : "text-green-500"}`}>
                  {(m.differencePercent ?? 0) > 0 ? "+" : ""}{m.differencePercent?.toFixed(1)}%
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

type UnitComparisonSectionProps = {
  unitTrend: OperationalTrendResponse;
  currentDate: string;
  previousDate: string;
  formatValue: (v: number) => string;
  onUnitClick?: (unit: string) => void;
};

function UnitComparisonSection({
  unitTrend,
  currentDate,
  previousDate,
  formatValue,
  onUnitClick,
}: UnitComparisonSectionProps) {
  const comparison = useMemo(() => {
    return trendToDateComparison(unitTrend, currentDate, previousDate, { topN: 8 });
  }, [unitTrend, currentDate, previousDate]);

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border text-left uppercase text-muted-foreground font-semibold">
              <th className="px-2 py-2">Unit</th>
              <th className="px-2 py-2 text-right">{formatShortDate(previousDate)}</th>
              <th className="px-2 py-2 text-right">{formatShortDate(currentDate)}</th>
              <th className="px-2 py-2 text-right">Delta</th>
              <th className="px-2 py-2 text-right">%</th>
            </tr>
          </thead>
          <tbody>
            {comparison.rows.length === 0 ? (
              <tr><td colSpan={5} className="py-4 text-center italic text-muted-foreground">No unit comparison data available</td></tr>
            ) : (
              comparison.rows.map((row) => (
                <tr key={row.key} className="border-b border-border/50 last:border-0 hover:bg-muted/30">
                  <td 
                    className="px-2 py-2.5 font-medium cursor-pointer hover:text-primary hover:underline text-foreground"
                    onClick={() => onUnitClick?.(row.key)}
                  >
                    {row.label}
                  </td>
                  <td className="px-2 py-2.5 text-right tabular-nums text-muted-foreground">{formatValue(row.previousValue)}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums font-semibold text-foreground">{formatValue(row.currentValue)}</td>
                  <td className={`px-2 py-2.5 text-right tabular-nums font-bold ${row.difference > 0 ? "text-red-500" : "text-green-500"}`}>
                    {row.difference > 0 ? "+" : ""}{formatValue(row.difference)}
                  </td>
                  <td className={`px-2 py-2.5 text-right tabular-nums ${row.difference > 0 ? "text-red-500" : "text-green-500"}`}>
                    {row.differencePercent !== null ? `${row.differencePercent > 0 ? "+" : ""}${row.differencePercent.toFixed(1)}%` : "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
