"use client";

/**
 * MD08-3 / MD08-3A / MD08-5: WF Test & Shade Dashboard — Date-Aware Edition
 *
 * Report dates are treated as a first-class analytical dimension. Nothing is
 * summed across report dates unless cumulative mode is intentionally chosen.
 *
 * Sections:
 *   0. Global Date Controls (Phase 1)
 *   1. Executive Summary & Insight Callouts (Phase 1 & Feedback)
 *   2. Historical Comparison KPI Cards — latest report date vs previous (Phase 2 & 7)
 *   3. Smart Trend - grouped bars if < 7 dates, lines if >= 7 dates (Phase 2 & 5)
 *   4. Buyer Analysis - Grouped Horizontal Bar Chart + Comparison Table (Phase 3 & Feedback)
 *   5. Unit Analysis - Sortable Unit Performance Matrix + Drilldown (Phase 4 & Feedback)
 *   6. Top Movers Section - Clickable Largest Increases & Reductions (Phase 6 & Feedback)
 *   7. Date Comparison View — current vs previous, per group
 *   8. Stacked Area Trend — operational load composition
 *   9. Delta Heatmap (at bottom) (Phase 7)
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileSpreadsheet, Printer } from "lucide-react";
import { getChartTimeSeries } from "@/lib/charts/api";
import { listReportTypes } from "@/lib/reports/api";
import { useOperationalDimensions } from "@/lib/reports/operational-hooks";
import { downloadBinary, queryString, auditClientExport } from "@/lib/export/downloads";
import {
  trendToGroupedSeriesByDate,
  trendToMultiSeries,
  trendToHeatmap,
  trendToDateComparison,
  trendToLatestKpi,
  trendToGroupedByDate,
  formatShortDate,
} from "@/components/charts/adapters";
import { GroupedBarChart } from "@/components/charts/grouped-bar-chart";
import { MultiSeriesTrend } from "@/components/charts/multi-series-trend";
import { StackedAreaTrend } from "@/components/charts/stacked-area-trend";
import { HeatmapChart } from "@/components/charts/heatmap-chart";
import { DateComparisonView } from "@/components/charts/date-comparison-view";
import { KpiCard } from "@/components/charts/kpi-card";
import type { OperationalTrendResponse } from "@/lib/reports/types";
import type { AuthUser } from "@/lib/auth/types";
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
  COMPARISON_MODE_OPTIONS,
} from "./dashboard-utils";

// Optimized Components
import { UnitPerformanceMatrix } from "@/components/charts/unit-performance-matrix";
import { UnitDrilldownModal } from "@/components/charts/unit-drilldown-modal";
import { BuyerComparisonView } from "@/components/charts/buyer-comparison-view";

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

export function WfTestDashboard({ user }: { user?: AuthUser }) {
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
  const dashboardRef = useRef<HTMLDivElement>(null);
  const [timestamp, setTimestamp] = useState("");
  const [drilldownUnit, setDrilldownUnit] = useState<string | null>(null);

  useEffect(() => {
    setTimestamp(new Date().toLocaleString());
  }, []);

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

  // Initialize selectedDates if in Custom Date Comparison with < 2 dates
  useEffect(() => {
    if (state.comparisonMode === "selected-dates" && windowDates.length >= 2) {
      const isValid = state.selectedDates.length === 2 && state.selectedDates.every((d) => windowDates.includes(d));
      if (!isValid) {
        const lastTwo = windowDates.slice(-2);
        patch({ selectedDates: lastTwo });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.comparisonMode, windowDates, state.selectedDates]);

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

  const buyerTrendQuery = useQuery({
    queryKey: [
      "wf-dash",
      "buyer-trend",
      state.reportTypeId,
      state.metric,
      dateWindow,
    ],
    queryFn: () =>
      getChartTimeSeries({
        metric: state.metric,
        report_type_id: state.reportTypeId || undefined,
        series_by: "buyer",
        date_from: dateWindow.date_from,
        date_to: dateWindow.date_to,
        limit: 365,
      }),
    enabled: Boolean(state.metric),
    staleTime: STALE_TIME,
  });

  const unitTrendQuery = useQuery({
    queryKey: [
      "wf-dash",
      "unit-trend",
      state.reportTypeId,
      state.metric,
      dateWindow,
    ],
    queryFn: () =>
      getChartTimeSeries({
        metric: state.metric,
        report_type_id: state.reportTypeId || undefined,
        series_by: "unit",
        date_from: dateWindow.date_from,
        date_to: dateWindow.date_to,
        limit: 365,
      }),
    enabled: Boolean(state.metric),
    staleTime: STALE_TIME,
  });

  // KPI cards: latest vs previous report date per core metric, locked to Unit series for drivers
  const kpiMetrics = useMemo(() => resolveKpiMetrics(metrics, 4), [metrics]);

  const kpiQuery = useQuery({
    queryKey: [
      "wf-dash",
      "kpi",
      state.reportTypeId,
      kpiMetrics.map((m) => m.value),
      dateWindow,
      "unit", // Locked to unit
    ],
    queryFn: async () => {
      const results = await Promise.all(
        kpiMetrics.map((m) =>
          getChartTimeSeries({
            metric: m.value,
            report_type_id: state.reportTypeId || undefined,
            series_by: "unit", // Lock primary drivers to unit operations
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

  // Locked unit comparison dataset for Executive Summary and Matrix
  const unitComparisonDataset = useMemo(() => {
    if (!unitTrendQuery.data || !comparisonPair.current || !comparisonPair.previous) {
      return null;
    }
    return trendToDateComparison(
      unitTrendQuery.data,
      comparisonPair.current,
      comparisonPair.previous,
      { topN: 0 } // Get all units
    );
  }, [unitTrendQuery.data, comparisonPair]);

  // Executive summary stats
  const tStockKpi = useMemo(() => {
    const found = kpiQuery.data?.find((d) => d.trend.metric_key === "t_stock");
    return found ? trendToLatestKpi(found.trend, found.label) : null;
  }, [kpiQuery.data]);

  const wftKpi = useMemo(() => {
    const found = kpiQuery.data?.find((d) => d.trend.metric_key === "wait_for_test");
    return found ? trendToLatestKpi(found.trend, found.label) : null;
  }, [kpiQuery.data]);

  const largestContributor = useMemo(() => {
    if (!unitComparisonDataset || !unitComparisonDataset.rows.length) return null;
    const pos = unitComparisonDataset.rows.filter((r) => r.difference > 0);
    if (!pos.length) return null;
    return [...pos].sort((a, b) => b.difference - a.difference)[0] ?? null;
  }, [unitComparisonDataset]);

  const largestReduction = useMemo(() => {
    if (!unitComparisonDataset || !unitComparisonDataset.rows.length) return null;
    const neg = unitComparisonDataset.rows.filter((r) => r.difference < 0);
    if (!neg.length) return null;
    return [...neg].sort((a, b) => a.difference - b.difference)[0] ?? null;
  }, [unitComparisonDataset]);

  // Insight Callouts: Cap at 3 increases, 3 reductions, and 2 stable units
  const insightCallouts = useMemo(() => {
    if (!unitComparisonDataset) return [];
    const rows = unitComparisonDataset.rows;

    const increases = rows
      .filter((r) => r.difference > 0)
      .sort((a, b) => b.difference - a.difference)
      .slice(0, 3)
      .map(
        (r) =>
          `• ${r.label} backlog increased by ${formatValue(r.difference)} kg (${
            r.differencePercent ? `+${r.differencePercent.toFixed(1)}%` : ""
          })`
      );

    const reductions = rows
      .filter((r) => r.difference < 0)
      .sort((a, b) => a.difference - b.difference)
      .slice(0, 3)
      .map(
        (r) =>
          `• ${r.label} reduced backlog by ${formatValue(Math.abs(r.difference))} kg (${
            r.differencePercent ? `${r.differencePercent.toFixed(1)}%` : ""
          })`
      );

    // Stable units: small absolute percentage change
    const stable = rows
      .filter((r) => r.previousValue > 0 && Math.abs(r.differencePercent ?? 0) <= 3)
      .sort((a, b) => Math.abs(a.differencePercent ?? 0) - Math.abs(b.differencePercent ?? 0))
      .slice(0, 2)
      .map(
        (r) =>
          `• ${r.label} remained stable (changed only ${
            r.differencePercent ? `${r.differencePercent > 0 ? "+" : ""}${r.differencePercent.toFixed(1)}%` : "0%"
          })`
      );

    return [...increases, ...reductions, ...stable];
  }, [unitComparisonDataset]);

  // movers list for Section 6
  const moversData = useMemo(() => {
    if (!comparisonDataset) return { increases: [], reductions: [] };
    const rows = comparisonDataset.rows;
    const increases = rows.filter((r) => r.difference > 0).sort((a, b) => b.difference - a.difference).slice(0, 5);
    const reductions = rows.filter((r) => r.difference < 0).sort((a, b) => a.difference - b.difference).slice(0, 5);
    return { increases, reductions };
  }, [comparisonDataset]);

  const isLoading = groupedTrendQuery.isLoading || dimensionsQuery.isLoading;
  const hasData = Boolean(groupedTrend && groupedTrend.points.length);
  const activeReportType = reportTypes.find((rt) => rt.id === state.reportTypeId)?.name ?? "All Report Types";

  const trendExportQuery = queryString({
    metric: state.metric,
    report_type_id: state.reportTypeId || undefined,
    series_by: state.groupDimension,
    date_from: dateWindow.date_from,
    date_to: dateWindow.date_to,
    limit: 365,
  });

  function exportDashboardPdf() {
    const originalTitle = document.title;
    const safeRt = activeReportType.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    const today = new Date().toISOString().split("T")[0];
    
    document.title = `${safeRt}_Dashboard_${today}`;
    document.body.dataset.printTitle = "wf-test-dashboard";
    
    void auditClientExport(
      "dashboard.pdf_export",
      "pdf",
      activeReportType,
      {
        report_type_id: state.reportTypeId,
        metric: state.metric,
        date_range: state.dateRange,
        custom_from: state.customFrom,
        custom_to: state.customTo,
        comparison_mode: state.comparisonMode,
        group_dimension: state.groupDimension,
        selected_dates: state.selectedDates,
      }
    );

    window.print();
    window.setTimeout(() => {
      document.title = originalTitle;
      delete document.body.dataset.printTitle;
    }, 1000);
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">
            WF Test &amp; Shade Dashboard
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Date-aware operational analysis. Report dates are compared, never summed.
          </p>
        </div>
        <div className="print-hidden flex flex-wrap gap-2">
          <button
            className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-background px-3 text-sm font-medium text-foreground shadow-sm transition hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!state.metric}
            onClick={() =>
              void downloadBinary(
                `/api/charts/time-series/export.xlsx${trendExportQuery ? `?${trendExportQuery}` : ""}`,
                "wf-test-dashboard-dataset.xlsx",
              )
            }
            type="button"
          >
            <FileSpreadsheet className="size-4" />
            Dataset
          </button>
          <button
            className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-background px-3 text-sm font-medium text-foreground shadow-sm transition hover:bg-secondary"
            onClick={exportDashboardPdf}
            type="button"
          >
            <Printer className="size-4" />
            PDF
          </button>
        </div>
      </div>

      <div className="dashboard-print-area space-y-8" ref={dashboardRef}>
        <div className="hidden print:block border-b border-border pb-4 mb-4">
          <h1 className="text-3xl font-bold text-foreground">
            WF Test &amp; Shade Dashboard
          </h1>
          <div className="mt-4 grid grid-cols-2 gap-x-8 gap-y-2 text-sm text-muted-foreground">
            <div>
              <span className="font-semibold text-foreground">Report Type: </span>
              {activeReportType}
            </div>
            <div>
              <span className="font-semibold text-foreground">Date Range: </span>
              {dateWindow.date_from ?? "Start"} to {dateWindow.date_to ?? "Latest"}
            </div>
            <div>
              <span className="font-semibold text-foreground">Generated: </span>
              {timestamp}
            </div>
            <div>
              <span className="font-semibold text-foreground">User: </span>
              {user?.full_name || user?.email || "System User"}
            </div>
          </div>
          
          <div className="mt-4 border-t border-dashed border-border pt-3 text-xs text-muted-foreground">
            <div className="font-semibold text-foreground mb-1 text-sm">Applied Filters:</div>
            <div className="grid grid-cols-2 gap-x-8 gap-y-1">
              <div><span className="font-medium text-foreground">Metric:</span> {metricLabel}</div>
              <div><span className="font-medium text-foreground">Comparison Mode:</span> {COMPARISON_MODE_OPTIONS.find(o => o.value === state.comparisonMode)?.label ?? state.comparisonMode}</div>
              <div><span className="font-medium text-foreground">Group Dimension:</span> {groupLabel(dim)}</div>
              {state.comparisonMode === "selected-dates" && (
                <div><span className="font-medium text-foreground">Selected Dates:</span> {effectiveDates.map(formatShortDate).join(", ")}</div>
              )}
            </div>
          </div>
        </div>

        {/* Phase 1: Global Date Controls */}
        <div className="print-hidden">
          <DashboardControls
            state={state}
            reportTypes={reportTypes}
            metrics={metrics}
            availableDates={windowDates}
            onChange={patch}
          />
        </div>

        {/* Phase 1: Executive Summary */}
        {comparisonPair.current && (
          <div className="rounded-lg border border-border bg-card p-5 grid grid-cols-1 lg:grid-cols-3 gap-6 shadow-sm">
            {/* Overview */}
            <div className="space-y-3.5 lg:col-span-1 lg:border-r lg:border-border/60 lg:pr-6">
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Executive Overview</h3>
              <div className="space-y-2.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground font-medium">Report Type:</span>
                  <span className="font-semibold text-foreground">{activeReportType}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground font-medium">Active Metric:</span>
                  <span className="font-semibold text-foreground">{metricLabel}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground font-medium">Latest Report:</span>
                  <span className="font-semibold text-foreground">{formatShortDate(comparisonPair.current)} ({comparisonPair.current})</span>
                </div>
                {comparisonPair.previous && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground font-medium">Previous Report:</span>
                    <span className="font-semibold text-foreground">{formatShortDate(comparisonPair.previous)} ({comparisonPair.previous})</span>
                  </div>
                )}
              </div>
            </div>

            {/* Key KPI Stats */}
            <div className="space-y-3.5 lg:col-span-1 lg:border-r lg:border-border/60 lg:pr-6">
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Key Operational Metrics</h3>
              <div className="space-y-2.5 text-xs">
                {tStockKpi && (
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground font-medium">Total Stock (T/Stock):</span>
                    <div className="text-right">
                      <span className="font-bold text-foreground">{formatValue(tStockKpi.value as number)}</span>
                      {tStockKpi.deltaPercent !== null && tStockKpi.deltaPercent !== undefined && (
                        <span className={`ml-1.5 text-xs font-bold ${tStockKpi.deltaPercent > 0 ? "text-red-500" : "text-green-500"}`}>
                          ({tStockKpi.deltaPercent > 0 ? "+" : ""}{tStockKpi.deltaPercent.toFixed(1)}%)
                        </span>
                      )}
                    </div>
                  </div>
                )}
                {wftKpi && (
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground font-medium">Wait For Test:</span>
                    <div className="text-right">
                      <span className="font-bold text-foreground">{formatValue(wftKpi.value as number)}</span>
                      {wftKpi.delta !== null && wftKpi.delta !== undefined && (
                        <span className={`ml-1.5 text-xs font-bold ${wftKpi.delta > 0 ? "text-red-500" : "text-green-500"}`}>
                          ({wftKpi.delta > 0 ? "+" : ""}{formatValue(wftKpi.delta)})
                        </span>
                      )}
                    </div>
                  </div>
                )}
                {largestContributor && (
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground font-medium">Largest Contributor:</span>
                    <div className="text-right">
                      <span className="font-bold text-foreground">{largestContributor.label}</span>
                      <span className="ml-1.5 text-xs font-bold text-red-500">
                        (+{formatValue(largestContributor.difference)} kg)
                      </span>
                    </div>
                  </div>
                )}
                {largestReduction && (
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground font-medium">Largest Reduction:</span>
                    <div className="text-right">
                      <span className="font-bold text-foreground">{largestReduction.label}</span>
                      <span className="ml-1.5 text-xs font-bold text-green-500">
                        ({formatValue(largestReduction.difference)} kg)
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Management Insights */}
            <div className="space-y-3 lg:col-span-1">
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Management Insights</h3>
              {insightCallouts.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">No key backlog fluctuations detected in this period.</p>
              ) : (
                <div className="space-y-1.5 max-h-[120px] overflow-y-auto pr-1">
                  {insightCallouts.map((callout, i) => (
                    <div key={`callout-${i}`} className="text-xs text-foreground font-semibold leading-relaxed">
                      {callout}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

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
        {isLoading && <ChartSkeleton label="Loading dashboard..." />}

        {!isLoading && !hasData && (
          <div className="flex h-[300px] items-center justify-center rounded-lg border border-dashed border-border bg-card/50">
            <p className="text-sm text-muted-foreground">
              No operational data for the selected metric and date range.
            </p>
          </div>
        )}

        {!isLoading && hasData && (
          <>
            {/* Phase 2 & 5: Smart Trend Visualization */}
            <section>
              <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-muted-foreground">
                {metricLabel} Trend &amp; Date Comparison by {groupLabel(dim)}
              </h2>
              {displayDates.length < 7 ? (
                groupedBarDataset && (
                  <GroupedBarChart
                    data={groupedBarDataset}
                    title={`${metricLabel} by ${groupLabel(dim)} — Date Comparison (< 7 dates)`}
                    formatValue={formatValue}
                  />
                )
              ) : (
                multiSeriesDataset && (
                  <MultiSeriesTrend
                    data={multiSeriesDataset}
                    title={`${metricLabel} Trend per ${groupLabel(dim)} (>= 7 dates)`}
                    formatValue={formatValue}
                  />
                )
              )}
            </section>

            {/* Buyer Analysis Section */}
            <section>
              {buyerTrendQuery.data && comparisonPair.current && (
                <BuyerComparisonView
                  buyerTrend={buyerTrendQuery.data}
                  currentDate={comparisonPair.current}
                  previousDate={comparisonPair.previous}
                  formatValue={formatValue}
                  title="Buyer Analysis"
                />
              )}
            </section>

            {/* Unit Analysis Section */}
            <section>
              {unitComparisonDataset ? (
                <UnitPerformanceMatrix
                  data={unitComparisonDataset}
                  onUnitClick={(unit) => setDrilldownUnit(unit)}
                  formatValue={formatValue}
                  title="Unit Analysis"
                />
              ) : (
                <div className="h-[200px] flex items-center justify-center rounded-lg border border-dashed border-border bg-card/50">
                  <p className="text-sm text-muted-foreground">Loading unit rankings...</p>
                </div>
              )}
            </section>

            {/* Phase 6: Top Movers Section */}
            <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Table 1: Largest Increases */}
              <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
                <h3 className="text-sm font-semibold text-foreground mb-3 text-red-600 dark:text-red-400">
                  Largest Increases (Top 5 {groupLabel(dim)}s)
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border text-left uppercase text-muted-foreground">
                        <th className="px-3 py-2 font-semibold">Entity</th>
                        <th className="px-3 py-2 text-right font-semibold">Previous</th>
                        <th className="px-3 py-2 text-right font-semibold">Current</th>
                        <th className="px-3 py-2 text-right font-semibold">Delta</th>
                        <th className="px-3 py-2 text-right font-semibold">%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {moversData.increases.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="px-3 py-4 text-center text-muted-foreground italic">
                            No increases detected.
                          </td>
                        </tr>
                      ) : (
                        moversData.increases.map((row) => (
                          <tr
                            key={row.key}
                            onClick={() => dim === "unit" && setDrilldownUnit(row.label)}
                            className={`border-b border-border/50 last:border-0 hover:bg-muted/40 transition-colors ${
                              dim === "unit" ? "cursor-pointer" : ""
                            }`}
                          >
                            <td className="px-3 py-2.5 font-medium text-foreground">{row.label}</td>
                            <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{formatValue(row.previousValue)}</td>
                            <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-foreground">{formatValue(row.currentValue)}</td>
                            <td className="px-3 py-2.5 text-right tabular-nums font-bold text-red-600 dark:text-red-400">+{formatValue(row.difference)}</td>
                            <td className="px-3 py-2.5 text-right tabular-nums text-red-600 dark:text-red-400">
                              {row.differencePercent !== null ? `+${row.differencePercent.toFixed(1)}%` : "—"}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Table 2: Largest Reductions */}
              <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
                <h3 className="text-sm font-semibold text-foreground mb-3 text-green-600 dark:text-green-400">
                  Largest Reductions (Top 5 {groupLabel(dim)}s)
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border text-left uppercase text-muted-foreground">
                        <th className="px-3 py-2 font-semibold">Entity</th>
                        <th className="px-3 py-2 text-right font-semibold">Previous</th>
                        <th className="px-3 py-2 text-right font-semibold">Current</th>
                        <th className="px-3 py-2 text-right font-semibold">Delta</th>
                        <th className="px-3 py-2 text-right font-semibold">%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {moversData.reductions.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="px-3 py-4 text-center text-muted-foreground italic">
                            No reductions detected.
                          </td>
                        </tr>
                      ) : (
                        moversData.reductions.map((row) => (
                          <tr
                            key={row.key}
                            onClick={() => dim === "unit" && setDrilldownUnit(row.label)}
                            className={`border-b border-border/50 last:border-0 hover:bg-muted/40 transition-colors ${
                              dim === "unit" ? "cursor-pointer" : ""
                            }`}
                          >
                            <td className="px-3 py-2.5 font-medium text-foreground">{row.label}</td>
                            <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{formatValue(row.previousValue)}</td>
                            <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-foreground">{formatValue(row.currentValue)}</td>
                            <td className="px-3 py-2.5 text-right tabular-nums font-bold text-green-600 dark:text-green-400">{formatValue(row.difference)}</td>
                            <td className="px-3 py-2.5 text-right tabular-nums text-green-600 dark:text-green-400">
                              {row.differencePercent !== null ? `${row.differencePercent.toFixed(1)}%` : "—"}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>

            {/* General Date Comparison View for Active Group Dimension */}
            <section>
              <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-muted-foreground">
                {metricLabel} — Current vs Previous Date for {groupLabel(dim)}
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

            {/* Delta Heatmap (at bottom) */}
            <section>
              <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-muted-foreground">
                {groupLabel(dim)} vs Date Delta Heatmap
              </h2>
              {heatmapDataset && (
                <HeatmapChart
                  data={heatmapDataset}
                  title={`${metricLabel} — backlog changes between adjacent report dates`}
                  formatValue={formatValue}
                />
              )}
            </section>
          </>
        )}
      </div>

      {/* Unit Detail Drilldown Modal */}
      {comparisonPair.current && (
        <UnitDrilldownModal
          isOpen={Boolean(drilldownUnit)}
          onClose={() => setDrilldownUnit(null)}
          unit={drilldownUnit || ""}
          metric={state.metric}
          metricLabel={metricLabel}
          reportTypeId={state.reportTypeId}
          dateWindow={dateWindow}
          latestDate={comparisonPair.current}
          previousDate={comparisonPair.previous}
          formatValue={formatValue}
        />
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
