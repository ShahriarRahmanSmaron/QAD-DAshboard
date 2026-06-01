"use client";

/**
 * MD08-3 / MD08-3A: WF Test & Shade Dashboard — Date-Aware Edition
 *
 * Report dates are treated as a first-class analytical dimension. Nothing is
 * summed across report dates unless cumulative mode is intentionally chosen.
 *
 * Sections:
 *   0. Global Date Controls (Phase 1)
 *   1. Historical Comparison KPI Cards — latest report date vs previous (Phase 7)
 *   2. Multi-Series Trend — one line per unit/buyer/section (Phase 2)
 *   3. Grouped Bar — one bar per report date, per category (Phase 3)
 *   4. Date Comparison View — current vs previous, per group (Phase 4)
 *   5. Stacked Area Trend — operational load composition (Phase 5)
 *   6. Unit × Date Heatmap (Phase 6)
 *
 * The entire data layer (Phase 8) is built on the multi-series time-series
 * endpoint, which preserves the report-date grain. Existing MD08-1 chart
 * infrastructure and MD08-2 chart builder are untouched.
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getChartTimeSeries } from "@/lib/charts/api";
import { listReportTypes } from "@/lib/reports/api";
import { useOperationalDimensions } from "@/lib/reports/operational-hooks";
import {
  trendToGroupedSeriesByDate,
  trendToMultiSeries,
  trendToHeatmap,
  trendToDateComparison,
  trendToLatestKpi,
} from "@/components/charts/adapters";
import { GroupedBarChart } from "@/components/charts/grouped-bar-chart";
import { MultiSeriesTrend } from "@/components/charts/multi-series-trend";
import { StackedAreaTrend } from "@/components/charts/stacked-area-trend";
import { HeatmapChart } from "@/components/charts/heatmap-chart";
import { DateComparisonView } from "@/components/charts/date-comparison-view";
import { KpiCard } from "@/components/charts/kpi-card";
import type { OperationalTrendResponse } from "@/lib/reports/types";
import {
  DashboardControls,
  type DashboardControlsState,
} from "./dashboard-controls";
import {
  GROUP_DIMENSION_OPTIONS,
  datesInWindow,
  resolveComparisonPair,
  resolveDateWindow,
  resolveEffectiveDates,
  resolveKpiMetrics,
} from "./dashboard-utils";

const STALE_TIME = 30_000;
const TOP_N = 8;

function formatValue(v: number): string {
  return Math.round(v).toLocaleString();
}

function groupLabel(dimension: string): string {
  return (
    GROUP_DIMENSION_OPTIONS.find((g) => g.value === dimension)?.label ?? dimension
  );
}

export function WfTestDashboard() {
  // ---------------------------------------------------------------------------
  // Control state
  // ---------------------------------------------------------------------------
  const [state, setState] = useState<DashboardControlsState>({
    reportTypeId: "",
    metric: "",
    dateRange: "30d",
    customFrom: "",
    customTo: "",
    comparisonMode: "latest-previous",
    groupDimension: "unit",
    selectedDates: [],
  });

  function patch(p: Partial<DashboardControlsState>) {
    setState((prev) => ({ ...prev, ...p }));
  }

  // ---------------------------------------------------------------------------
  // Registry + dimensions (dynamic — no hardcoding)
  // ---------------------------------------------------------------------------
  const reportTypesQuery = useQuery({
    queryKey: ["report-types"],
    queryFn: listReportTypes,
    staleTime: 60_000,
  });

  const dimensionsQuery = useOperationalDimensions(state.reportTypeId || undefined);

  const reportTypes = reportTypesQuery.data?.report_types ?? [];
  const metrics = useMemo(
    () => dimensionsQuery.data?.metrics ?? [],
    [dimensionsQuery.data],
  );

  // Available report dates, ascending.
  const availableDates = useMemo(() => {
    const raw = dimensionsQuery.data?.dates ?? [];
    return raw.map((d) => d.value).sort((a, b) => a.localeCompare(b));
  }, [dimensionsQuery.data]);

  const anchorDate: string | null = availableDates.length
    ? availableDates[availableDates.length - 1] ?? null
    : null;

  // Default the metric once dimensions load (prefer Wait For Test, else first).
  useEffect(() => {
    if (!metrics.length) return;
    const first = metrics[0];
    if (!first) return;
    if (!state.metric) {
      const preferred = metrics.find((m) => m.value === "wait_for_test") ?? first;
      patch({ metric: preferred.value });
    } else if (!metrics.some((m) => m.value === state.metric)) {
      // Reset an invalid metric when the report type changes.
      patch({ metric: first.value });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metrics]);

  // ---------------------------------------------------------------------------
  // Resolve the active date window + dates each visualization should render
  // ---------------------------------------------------------------------------
  const dateWindow = useMemo(
    () =>
      resolveDateWindow(state.dateRange, anchorDate, {
        from: state.customFrom,
        to: state.customTo,
      }),
    [state.dateRange, anchorDate, state.customFrom, state.customTo],
  );

  const windowDates = useMemo(
    () => datesInWindow(availableDates, dateWindow),
    [availableDates, dateWindow],
  );

  const effectiveDates = useMemo(
    () =>
      resolveEffectiveDates(state.comparisonMode, windowDates, state.selectedDates),
    [state.comparisonMode, windowDates, state.selectedDates],
  );

  // Dates shown by trend/composition/heatmap. In Selected Dates mode these
  // honor the user's explicit picks; otherwise the full window is shown so
  // trends remain continuous.
  const displayDates = useMemo(
    () => (state.comparisonMode === "selected-dates" ? effectiveDates : windowDates),
    [state.comparisonMode, effectiveDates, windowDates],
  );

  const comparisonPair = useMemo(
    () => resolveComparisonPair(effectiveDates),
    [effectiveDates],
  );

  // ---------------------------------------------------------------------------
  // Phase 8 data layer — one grouped (multi-series) trend feeds every chart.
  // series_by = group dimension; report-date grain is always preserved.
  // ---------------------------------------------------------------------------
  const groupedTrendQuery = useQuery({
    queryKey: [
      "wf-dash",
      "grouped-trend",
      state.reportTypeId,
      state.metric,
      state.groupDimension,
      dateWindow,
    ],
    queryFn: () =>
      getChartTimeSeries({
        metric: state.metric,
        report_type_id: state.reportTypeId || undefined,
        series_by: state.groupDimension,
        date_from: dateWindow.date_from,
        date_to: dateWindow.date_to,
        limit: 365,
      }),
    enabled: Boolean(state.metric),
    staleTime: STALE_TIME,
  });

  // KPI cards (Phase 7): latest vs previous report date per core metric.
  const kpiMetrics = useMemo(() => resolveKpiMetrics(metrics, 4), [metrics]);

  const kpiQuery = useQuery({
    queryKey: [
      "wf-dash",
      "kpi",
      state.reportTypeId,
      kpiMetrics.map((m) => m.value),
      dateWindow,
    ],
    queryFn: async () => {
      const results = await Promise.all(
        kpiMetrics.map((m) =>
          getChartTimeSeries({
            metric: m.value,
            report_type_id: state.reportTypeId || undefined,
            date_from: dateWindow.date_from,
            date_to: dateWindow.date_to,
            limit: 365,
          }).then((trend) => ({ trend, label: m.label })),
        ),
      );
      return results;
    },
    enabled: kpiMetrics.length > 0,
    staleTime: STALE_TIME,
  });

  // ---------------------------------------------------------------------------
  // Derived datasets
  // ---------------------------------------------------------------------------
  const groupedTrend: OperationalTrendResponse | undefined = groupedTrendQuery.data;
  const metricLabel =
    metrics.find((m) => m.value === state.metric)?.label ?? state.metric;
  const dim = state.groupDimension;

  const multiSeriesDataset = useMemo(() => {
    if (!groupedTrend) return null;
    return trendToMultiSeries(groupedTrend, { selectedDates: displayDates, topN: TOP_N });
  }, [groupedTrend, displayDates]);

  const groupedBarDataset = useMemo(() => {
    if (!groupedTrend) return null;
    return trendToGroupedSeriesByDate(groupedTrend, {
      selectedDates: effectiveDates,
      topN: TOP_N,
    });
  }, [groupedTrend, effectiveDates]);

  const heatmapDataset = useMemo(() => {
    if (!groupedTrend) return null;
    return trendToHeatmap(groupedTrend, { selectedDates: displayDates, topN: TOP_N });
  }, [groupedTrend, displayDates]);

  const comparisonDataset = useMemo(() => {
    if (!groupedTrend || !comparisonPair.current || !comparisonPair.previous) {
      return null;
    }
    return trendToDateComparison(
      groupedTrend,
      comparisonPair.current,
      comparisonPair.previous,
      { topN: 20 },
    );
  }, [groupedTrend, comparisonPair]);

  const isLoading = groupedTrendQuery.isLoading || dimensionsQuery.isLoading;
  const hasData = Boolean(groupedTrend && groupedTrend.points.length);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-foreground">
          WF Test &amp; Shade Dashboard
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Date-aware operational analysis. Report dates are compared, never summed.
        </p>
      </div>

      {/* Phase 1: Global Date Controls */}
      <DashboardControls
        state={state}
        reportTypes={reportTypes}
        metrics={metrics}
        availableDates={windowDates}
        onChange={patch}
      />

      {/* Phase 7: Historical Comparison KPI Cards (latest vs previous date) */}
      <section>
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-muted-foreground">
          Latest vs Previous Report Date
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {kpiQuery.isLoading
            ? kpiMetrics.map((m) => <KpiSkeleton key={m.value} />)
            : (kpiQuery.data ?? []).map(({ trend, label }) => (
                <KpiCard
                  key={label}
                  kpi={trendToLatestKpi(trend, label)}
                  formatValue={(v) =>
                    typeof v === "number" ? formatValue(v) : v
                  }
                  showSparkline
                />
              ))}
        </div>
      </section>

      {/* Empty / loading state for the metric-driven charts */}
      {isLoading && <ChartSkeleton label="Loading dashboard…" />}

      {!isLoading && !hasData && (
        <div className="flex h-[300px] items-center justify-center rounded-lg border border-dashed border-border bg-card/50">
          <p className="text-sm text-muted-foreground">
            No operational data for the selected metric and date range.
          </p>
        </div>
      )}

      {!isLoading && hasData && (
        <>
          {/* Phase 2: Multi-Series Trend */}
          <section>
            <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-muted-foreground">
              {metricLabel} Trend by {groupLabel(dim)}
            </h2>
            {multiSeriesDataset && (
              <MultiSeriesTrend
                data={multiSeriesDataset}
                title={`${metricLabel} — one line per ${groupLabel(dim).toLowerCase()}`}
                formatValue={formatValue}
              />
            )}
          </section>

          {/* Phase 3: Grouped Bar — one bar per report date */}
          <section>
            <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-muted-foreground">
              {metricLabel} by {groupLabel(dim)} — Date Comparison
            </h2>
            {groupedBarDataset && (
              <GroupedBarChart
                data={groupedBarDataset}
                title={`${metricLabel} per ${groupLabel(dim).toLowerCase()}, each report date a separate bar`}
                formatValue={formatValue}
              />
            )}
          </section>

          {/* Phase 4: Date Comparison View */}
          <section>
            <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-muted-foreground">
              {metricLabel} — Current vs Previous Date
            </h2>
            {comparisonDataset ? (
              <DateComparisonView
                data={comparisonDataset}
                title={`${metricLabel} by ${groupLabel(dim).toLowerCase()}`}
                formatValue={formatValue}
              />
            ) : (
              <div className="flex h-[160px] items-center justify-center rounded-lg border border-dashed border-border bg-card/50">
                <p className="text-sm text-muted-foreground">
                  Two report dates are required for comparison. Widen the date
                  range or select more dates.
                </p>
              </div>
            )}
          </section>

          {/* Phase 5: Stacked Area Trend — composition */}
          <section>
            <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-muted-foreground">
              Operational Trend Composition
            </h2>
            {multiSeriesDataset && (
              <StackedAreaTrend
                data={multiSeriesDataset}
                title={`${metricLabel} contribution by ${groupLabel(dim).toLowerCase()}`}
                formatValue={formatValue}
              />
            )}
          </section>

          {/* Phase 6: Heatmap — group × date */}
          <section>
            <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-muted-foreground">
              {groupLabel(dim)} vs Date Heatmap
            </h2>
            {heatmapDataset && (
              <HeatmapChart
                data={heatmapDataset}
                title={`${metricLabel} — color intensity by value`}
                formatValue={formatValue}
              />
            )}
          </section>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skeletons
// ---------------------------------------------------------------------------

function KpiSkeleton() {
  return (
    <div className="animate-pulse rounded-lg border border-border bg-card p-4">
      <div className="h-3 w-20 rounded bg-muted" />
      <div className="mt-2 h-7 w-16 rounded bg-muted" />
    </div>
  );
}

function ChartSkeleton({ label }: { label: string }) {
  return (
    <div className="animate-pulse rounded-lg border border-border bg-card p-4">
      <div className="mb-3 h-4 w-48 rounded bg-muted" />
      <div className="flex h-[300px] items-center justify-center rounded bg-muted/40">
        <span className="text-sm text-muted-foreground">{label}</span>
      </div>
    </div>
  );
}
