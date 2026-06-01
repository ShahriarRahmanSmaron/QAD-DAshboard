"use client";

/**
 * MD08-1: Visualization Foundation — Chart Demo / Verification
 *
 * Demonstrates all chart types with live operational data:
 * - HTL-02 Wait For Test trend
 * - NEXT Wait For Test trend
 * - Buyer ranking chart
 * - Unit ranking chart
 * - KPI card rendering
 *
 * This is NOT a dashboard page — it's a verification component.
 */

import { useState } from "react";
import { TrendChart } from "./trend-chart";
import { RankingChart } from "./ranking-chart";
import { DistributionChart } from "./distribution-chart";
import { KpiCard } from "./kpi-card";
import { ComparisonChart } from "./comparison-chart";
import { useTrendChart, useRankingChart, useKpiChart } from "./use-chart-data";
import type { DateRange, DateRangeValue } from "./types";

const DATE_RANGE_OPTIONS: { label: string; value: DateRange }[] = [
  { label: "Last 7 days", value: "7d" },
  { label: "Last 30 days", value: "30d" },
];

export function ChartDemo() {
  const [dateRange, setDateRange] = useState<DateRangeValue>({ range: "30d" });

  // HTL-02 Wait For Test trend
  const htl02Trend = useTrendChart({
    metric: "wait_for_test",
    section: "htl-02",
    dateRange,
    label: "HTL-02 Wait For Test",
  });

  // NEXT Wait For Test trend
  const nextTrend = useTrendChart({
    metric: "wait_for_test",
    section: "next",
    dateRange,
    label: "NEXT Wait For Test",
  });

  // Buyer ranking
  const buyerRanking = useRankingChart({
    groupBy: "buyer",
    dateRange,
  });

  // Unit ranking
  const unitRanking = useRankingChart({
    groupBy: "unit",
    dateRange,
  });

  // KPI card
  const today = new Date().toISOString().split("T")[0] ?? "";
  const kpi = useKpiChart(
    today
      ? {
          metric: "wait_for_test",
          currentDate: today,
          label: "Wait For Test (Total)",
          sparklineDateRange: dateRange,
        }
      : null,
  );

  return (
    <div className="space-y-6 p-4">
      {/* Date range selector */}
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-muted-foreground">Range:</span>
        {DATE_RANGE_OPTIONS.map((option) => (
          <button
            key={option.value}
            onClick={() => setDateRange({ range: option.value })}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              dateRange.range === option.value
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-secondary-foreground hover:bg-accent"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {kpi.data && <KpiCard kpi={kpi.data} />}
        {kpi.isLoading && (
          <div className="animate-pulse rounded-lg border border-border bg-card p-4">
            <div className="h-4 w-24 rounded bg-muted" />
            <div className="mt-2 h-8 w-16 rounded bg-muted" />
          </div>
        )}
      </div>

      {/* Trend charts */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {htl02Trend.isLoading && <ChartSkeleton />}
        {htl02Trend.data && (
          <TrendChart
            data={htl02Trend.data.dataset}
            title="HTL-02 Wait For Test Trend"
            variant="area"
          />
        )}

        {nextTrend.isLoading && <ChartSkeleton />}
        {nextTrend.data && (
          <TrendChart
            data={nextTrend.data.dataset}
            title="NEXT Wait For Test Trend"
            variant="line"
          />
        )}
      </div>

      {/* Ranking charts */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {buyerRanking.isLoading && <ChartSkeleton />}
        {buyerRanking.data && (
          <RankingChart
            data={buyerRanking.data.dataset}
            title="Buyer Ranking"
            maxItems={8}
          />
        )}

        {unitRanking.isLoading && <ChartSkeleton />}
        {unitRanking.data && (
          <UnitRankingSection data={unitRanking.data.dataset} />
        )}
      </div>

      {/* Distribution + Comparison */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {buyerRanking.data && (
          <DistributionChart
            data={buyerRanking.data.dataset}
            title="Buyer Distribution"
            maxItems={6}
          />
        )}
        {unitRanking.data && (
          <ComparisonChart
            data={unitRanking.data.dataset}
            title="Unit Comparison"
            layout="horizontal"
            maxItems={8}
          />
        )}
      </div>
    </div>
  );
}

function UnitRankingSection({ data }: { data: import("./types").GroupedTotalsDataset }) {
  return (
    <RankingChart
      data={data}
      title="Unit Ranking"
      maxItems={8}
      colorByIndex
    />
  );
}

function ChartSkeleton() {
  return (
    <div className="animate-pulse rounded-lg border border-border bg-card p-4">
      <div className="mb-3 h-4 w-32 rounded bg-muted" />
      <div className="h-[300px] rounded bg-muted/50" />
    </div>
  );
}
