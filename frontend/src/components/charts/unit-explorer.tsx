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
import { BuyerComparisonView } from "./buyer-comparison-view";
import { ArrowUp, ArrowDown } from "lucide-react";

import type { OperationalTrendResponse } from "@/lib/reports/types";
import type { DateComparisonRow } from "./types";

type UnitExplorerProps = {
  selectedUnit: string | null;
  onUnitChange: (unit: string) => void;
  availableUnits: { value: string; label: string }[];
  metric: string;
  metricLabel: string;
  reportTypeId: string;
  dateWindow: { date_from?: string; date_to?: string };
  latestDate: string;
  previousDate: string | null;
  formatValue?: (value: number) => string;
  onBuyerClick?: (buyer: string) => void;
};

function UnitExplorerInner({
  selectedUnit,
  onUnitChange,
  availableUnits,
  metric,
  metricLabel,
  reportTypeId,
  dateWindow,
  latestDate,
  previousDate,
  formatValue,
  onBuyerClick,
}: UnitExplorerProps) {
  const [activeTab, setActiveTab] = React.useState<"overview" | "trends" | "contributions" | "history">("overview");
  const format = formatValue ?? ((v: number) => Math.round(v).toLocaleString());
  const containerRef = useRef<HTMLDivElement>(null);

  // Initialize selected unit if none selected
  useEffect(() => {
    if (!selectedUnit && availableUnits.length > 0 && availableUnits[0]) {
      onUnitChange(availableUnits[0].value);
    }
  }, [selectedUnit, availableUnits, onUnitChange]);

  const activeUnit = selectedUnit || (availableUnits[0]?.value ?? "");

  // 1. Unit History Query
  const unitHistoryQuery = useQuery({
    queryKey: ["unit-explorer", "history", activeUnit, metric, reportTypeId, dateWindow],
    queryFn: () =>
      getChartTimeSeries({
        metric,
        unit: activeUnit,
        report_type_id: reportTypeId || undefined,
        date_from: dateWindow.date_from,
        date_to: dateWindow.date_to,
        limit: 365,
      }),
    enabled: Boolean(activeUnit && metric),
    staleTime: 30_000,
  });

  // 2. Buyer Contribution Query (group by buyer)
  const buyerContribQuery = useQuery({
    queryKey: ["unit-explorer", "buyer-contrib", activeUnit, metric, reportTypeId, dateWindow],
    queryFn: () =>
      getChartTimeSeries({
        metric,
        unit: activeUnit,
        series_by: "buyer",
        report_type_id: reportTypeId || undefined,
        date_from: dateWindow.date_from,
        date_to: dateWindow.date_to,
        limit: 365,
      }),
    enabled: Boolean(activeUnit && metric),
    staleTime: 30_000,
  });

  // Phase 3: Unit KPI Card
  const kpiValue = useMemo(() => {
    if (!unitHistoryQuery.data) return null;
    return trendToLatestKpi(unitHistoryQuery.data, metricLabel);
  }, [unitHistoryQuery.data, metricLabel]);

  // Phase 4: Unit Trend Chart Dataset
  const trendDataset = useMemo(() => {
    if (!unitHistoryQuery.data) return null;
    // We can use trendToMultiSeries since it handles series mapping
    // But since there's no series_by, we might just map it as a single line
    const withSeriesBy = { ...unitHistoryQuery.data, series_by: "unit" as const };
    // Mutate the points to have series = activeUnit
    withSeriesBy.points = withSeriesBy.points.map(p => ({ ...p, series: activeUnit }));
    return trendToMultiSeries(withSeriesBy);
  }, [unitHistoryQuery.data, activeUnit]);

  // Phase 6: Buyer Contribution Trend
  const buyerTrendDataset = useMemo(() => {
    if (!buyerContribQuery.data) return null;
    return trendToMultiSeries(buyerContribQuery.data, { topN: 8 });
  }, [buyerContribQuery.data]);

  // Phase 7: Buyer Movers (Current vs First/Previous)
  // Let's use trendToDateComparison
  const moversDataset = useMemo(() => {
    if (!buyerContribQuery.data || !previousDate || !latestDate) return null;
    return trendToDateComparison(buyerContribQuery.data, latestDate, previousDate, { topN: 5 });
  }, [buyerContribQuery.data, latestDate, previousDate]);

  const increases = useMemo(() => {
    if (!moversDataset) return [];
    return [...moversDataset.rows].filter(r => r.difference > 0).sort((a, b) => b.difference - a.difference).slice(0, 5);
  }, [moversDataset]);

  const reductions = useMemo(() => {
    if (!moversDataset) return [];
    return [...moversDataset.rows].filter(r => r.difference < 0).sort((a, b) => a.difference - b.difference).slice(0, 5);
  }, [moversDataset]);

  // Phase 8: Unit History Table
  const historyTableRows = useMemo(() => {
    if (!unitHistoryQuery.data) return [];
    const points = [...unitHistoryQuery.data.points].sort((a, b) => b.report_date.localeCompare(a.report_date));
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
  }, [unitHistoryQuery.data]);

  const isLoading = unitHistoryQuery.isLoading || buyerContribQuery.isLoading;

  return (
    <div className="space-y-6" ref={containerRef}>
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-4">
        <div>
          <h2 className="text-xl font-bold text-foreground">Unit Explorer</h2>
          <p className="text-sm text-muted-foreground">Detailed investigation of unit performance</p>
        </div>
        <div className="flex items-center gap-3">
          <label className="text-sm font-medium text-foreground">Select Unit:</label>
          <select
            className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm"
            value={activeUnit}
            onChange={(e) => onUnitChange(e.target.value)}
          >
            {availableUnits.map((u) => (
              <option key={u.value} value={u.value}>
                {u.label}
              </option>
            ))}
          </select>
          <ChartExportButtons containerRef={containerRef} filename={`UnitExplorer_${activeUnit}`} />
        </div>
      </div>

      {/* Styled Segmented Tabs */}
      <div className="flex border-b border-border gap-1.5 pb-0.5">
        {(["overview", "trends", "contributions", "history"] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-semibold capitalize transition-all border-b-2 -mb-[3px] ${
              activeTab === tab
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {isLoading && (
        <div className="flex h-32 items-center justify-center rounded-lg border border-border bg-card">
          <p className="text-sm text-muted-foreground animate-pulse">Loading {activeUnit} data...</p>
        </div>
      )}

      {!isLoading && (
        <>
          {/* OVERVIEW TAB */}
          {activeTab === "overview" && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {kpiValue && (
                <KpiCard
                  kpi={kpiValue}
                  formatValue={(v) => (typeof v === "number" ? format(v) : v)}
                  showSparkline
                />
              )}
              
              {/* Top Contributing Buyer */}
              {buyerContribQuery.data && (
                <TopContributingBuyerCard 
                  data={buyerContribQuery.data} 
                  latestDate={latestDate} 
                  formatValue={format} 
                />
              )}
              
              {/* Largest Buyer Increase */}
              <BuyerMoverCard type="increase" mover={increases[0]} formatValue={format} onBuyerClick={onBuyerClick} />
              
              {/* Largest Buyer Reduction */}
              <BuyerMoverCard type="reduction" mover={reductions[0]} formatValue={format} onBuyerClick={onBuyerClick} />
            </div>
          )}

          {/* TRENDS TAB */}
          {activeTab === "trends" && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Phase 4: Unit Trend Chart */}
              <div className="rounded-lg border border-border bg-card shadow-sm">
                <div className="p-4 border-b border-border">
                  <h3 className="text-sm font-semibold">{activeUnit} — {metricLabel} Trend</h3>
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

              {/* Phase 6: Buyer Contribution Trend */}
              <div className="rounded-lg border border-border bg-card shadow-sm">
                <div className="p-4 border-b border-border">
                  <h3 className="text-sm font-semibold">Buyer Contribution Trend for {activeUnit}</h3>
                </div>
                <div className="p-4">
                  {buyerTrendDataset && (
                    <MultiSeriesTrend
                      data={buyerTrendDataset}
                      title=""
                      formatValue={format}
                    />
                  )}
                </div>
              </div>
            </div>
          )}

          {/* CONTRIBUTIONS TAB */}
          {activeTab === "contributions" && (
            <div className="rounded-lg border border-border bg-card shadow-sm">
              {buyerContribQuery.data && previousDate && (
                <BuyerComparisonView
                  buyerTrend={buyerContribQuery.data}
                  currentDate={latestDate}
                  previousDate={previousDate}
                  formatValue={format}
                  title={`Buyer Contribution inside ${activeUnit}`}
                />
              )}
            </div>
          )}

          {/* HISTORY TAB */}
          {activeTab === "history" && (
            <div className="space-y-6">
              {/* Phase 7: Buyer Movers inside Unit */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="rounded-lg border border-border bg-card shadow-sm p-4">
                  <h3 className="text-sm font-semibold text-red-600 mb-3">Largest Buyer Increases</h3>
                  <MoversTable movers={increases} formatValue={format} onBuyerClick={onBuyerClick} />
                </div>
                <div className="rounded-lg border border-border bg-card shadow-sm p-4">
                  <h3 className="text-sm font-semibold text-green-600 mb-3">Largest Buyer Reductions</h3>
                  <MoversTable movers={reductions} formatValue={format} onBuyerClick={onBuyerClick} />
                </div>
              </div>

              {/* Phase 8: Unit History Table */}
              <div className="rounded-lg border border-border bg-card shadow-sm p-4">
                <h3 className="text-sm font-semibold mb-3">Unit History Table: {activeUnit}</h3>
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
            </div>
          )}
        </>
      )}
    </div>
  );
}

export const UnitExplorer = React.memo(UnitExplorerInner);

type TopContributingBuyerCardProps = {
  data: OperationalTrendResponse | undefined;
  latestDate: string;
  formatValue: (v: number) => string;
};

function TopContributingBuyerCard({ data, latestDate, formatValue }: TopContributingBuyerCardProps) {
  const { topBuyer, share, value } = useMemo(() => {
    if (!data || !data.points) return { topBuyer: null, share: null, value: null };
    let total = 0;
    const buyerMap = new Map<string, number>();
    for (const point of data.points) {
      if (point.report_date === latestDate) {
        const v = Number(point.numeric_total);
        total += v;
        if (point.series == null) continue;
        const b = point.series || "Unknown";
        buyerMap.set(b, (buyerMap.get(b) || 0) + v);
      }
    }
    if (total === 0) return { topBuyer: null, share: null, value: null };
    
    let topBuyer = null;
    let maxVal = 0;
    for (const [b, v] of buyerMap.entries()) {
      if (v > maxVal) {
        maxVal = v;
        topBuyer = b;
      }
    }
    const share = (maxVal / total) * 100;
    return { topBuyer, share, value: maxVal };
  }, [data, latestDate]);

  if (!topBuyer) return <div className="rounded-lg border border-border bg-card p-4"><p className="text-sm text-muted-foreground">No top buyer data</p></div>;

  return (
    <div className="rounded-lg border border-border bg-card p-4 flex flex-col justify-between shadow-sm">
      <h3 className="text-xs font-semibold uppercase text-muted-foreground">Top Contributing Buyer</h3>
      <div className="mt-2 text-xl font-bold text-foreground truncate" title={topBuyer}>{topBuyer}</div>
      <div className="mt-1 text-sm text-muted-foreground flex items-center gap-2">
        <span className="font-semibold text-foreground">{formatValue(value)}</span>
        <span className="text-xs">({share?.toFixed(1)}% share)</span>
      </div>
    </div>
  );
}

type BuyerMoverCardProps = {
  type: "increase" | "reduction";
  mover?: DateComparisonRow;
  formatValue: (v: number) => string;
  onBuyerClick?: (buyer: string) => void;
};

function BuyerMoverCard({ type, mover, formatValue, onBuyerClick }: BuyerMoverCardProps) {
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
      <h3 className="text-xs font-semibold uppercase text-muted-foreground">Largest Buyer {type}</h3>
      <div 
        className="mt-2 text-xl font-bold text-foreground truncate cursor-pointer hover:text-primary hover:underline" 
        title={mover.label}
        onClick={() => onBuyerClick?.(mover.key)}
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

type MoversTableProps = {
  movers: DateComparisonRow[];
  formatValue: (v: number) => string;
  onBuyerClick?: (buyer: string) => void;
};

function MoversTable({ movers, formatValue, onBuyerClick }: MoversTableProps) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border text-left uppercase text-muted-foreground">
            <th className="px-2 py-2">Buyer</th>
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
                  onClick={() => onBuyerClick?.(m.key)}
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
