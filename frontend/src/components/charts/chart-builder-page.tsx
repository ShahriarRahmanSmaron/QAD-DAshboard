"use client";

/**
 * MD08-2: Dynamic Chart Builder
 *
 * Production-facing chart page that allows users to generate charts from
 * operational data without writing code. Reuses the MD08-1 visualization
 * foundation directly — no demo routes, no hardcoded metrics.
 *
 * Controls:
 *   1. Report Type — dynamic from active workbook sources
 *   2. Metric — dynamic from selected report type
 *   3. Dimension — Buyer, Unit, Section, Date
 *   4. Chart Type — Line, Area, Stacked Area, Bar, Stacked Bar, Pie
 *   5. Date Range — Last 7 Days, Last 30 Days, Custom
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { listReportTypes } from "@/lib/reports/api";
import { useOperationalDimensions } from "@/lib/reports/operational-hooks";
import {
  getChartTimeSeries,
} from "@/lib/charts/api";
import { TrendChart } from "./trend-chart";
import { ComparisonChart } from "./comparison-chart";
import { RankingChart } from "./ranking-chart";
import { DistributionChart } from "./distribution-chart";
import {
  trendToTimeSeries,
  trendToGroupedByDate,
} from "./adapters";
import type { DateRange, DateRangeValue, TimeSeriesDataset, GroupedTotalsDataset } from "./types";
import type {
  OperationalDimensionOption,
  ReportTypeOption,
} from "@/lib/reports/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ChartTypeOption = "line" | "area" | "stacked-area" | "bar" | "stacked-bar" | "pie";
type DimensionOption = "buyer" | "unit" | "section" | "date";

const CHART_TYPE_OPTIONS: { value: ChartTypeOption; label: string }[] = [
  { value: "line", label: "Line" },
  { value: "area", label: "Area" },
  { value: "stacked-area", label: "Stacked Area" },
  { value: "bar", label: "Bar" },
  { value: "stacked-bar", label: "Stacked Bar" },
  { value: "pie", label: "Pie" },
];

const DIMENSION_OPTIONS: { value: DimensionOption; label: string }[] = [
  { value: "buyer", label: "Buyer" },
  { value: "unit", label: "Unit" },
  { value: "section", label: "Section" },
  { value: "date", label: "Date" },
];

const DATE_RANGE_OPTIONS: { value: DateRange; label: string }[] = [
  { value: "7d", label: "Last 7 Days" },
  { value: "30d", label: "Last 30 Days" },
  { value: "custom", label: "Custom" },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function dateRangeToApiParams(dateRange: DateRangeValue): {
  date_from?: string;
  date_to?: string;
} {
  if (dateRange.range === "custom") {
    return { date_from: dateRange.dateFrom, date_to: dateRange.dateTo };
  }
  const now = new Date();
  const days = dateRange.range === "7d" ? 7 : 30;
  const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return { date_from: from.toISOString().split("T")[0] };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ChartBuilderPage() {
  // Control state
  const [selectedReportTypeId, setSelectedReportTypeId] = useState<string>("");
  const [selectedMetric, setSelectedMetric] = useState<string>("");
  const [selectedDimension, setSelectedDimension] = useState<DimensionOption>("date");
  const [selectedChartType, setSelectedChartType] = useState<ChartTypeOption>("line");
  const [dateRange, setDateRange] = useState<DateRangeValue>({ range: "30d" });
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  // Fetch report types
  const reportTypesQuery = useQuery({
    queryKey: ["report-types"],
    queryFn: listReportTypes,
    staleTime: 60_000,
  });

  // Fetch dimensions scoped to selected report type
  const dimensionsQuery = useOperationalDimensions(selectedReportTypeId || undefined);

  // Reset metric when report type changes
  useEffect(() => {
    setSelectedMetric("");
  }, [selectedReportTypeId]);

  // Apply custom date range
  const effectiveDateRange: DateRangeValue = useMemo(() => {
    if (dateRange.range === "custom") {
      return { range: "custom", dateFrom: customFrom, dateTo: customTo };
    }
    return dateRange;
  }, [dateRange, customFrom, customTo]);

  // Determine if we can generate a chart
  const canGenerate = Boolean(selectedMetric);

  // ---------------------------------------------------------------------------
  // Chart data query
  // ---------------------------------------------------------------------------

  const chartQueryKey = useMemo(
    () => [
      "chart-builder",
      selectedReportTypeId,
      selectedMetric,
      selectedDimension,
      selectedChartType,
      effectiveDateRange,
    ],
    [selectedReportTypeId, selectedMetric, selectedDimension, selectedChartType, effectiveDateRange],
  );

  const chartQuery = useQuery({
    queryKey: chartQueryKey,
    queryFn: async () => {
      const dateParams = dateRangeToApiParams(effectiveDateRange);
      const reportTypeParam = selectedReportTypeId || undefined;

      // Date dimension → time series endpoint
      if (selectedDimension === "date") {
        const trend = await getChartTimeSeries({
          metric: selectedMetric,
          report_type_id: reportTypeParam,
          ...dateParams,
        });
        const dataset = trendToTimeSeries(trend, selectedMetric);
        return { kind: "timeseries" as const, dataset };
      }

      // MD08-2A: All non-date dimensions use the time-series endpoint with
      // series_by to preserve date grain. Each date remains a separate data
      // point — values are never aggregated across dates.
      const trend = await getChartTimeSeries({
        metric: selectedMetric,
        report_type_id: reportTypeParam,
        series_by: selectedDimension as "buyer" | "unit" | "section",
        ...dateParams,
      });

      // For line/area/stacked-area → render as multi-series time-series
      if (
        selectedChartType === "line" ||
        selectedChartType === "area" ||
        selectedChartType === "stacked-area"
      ) {
        const dataset = trendToTimeSeries(trend, selectedMetric);
        return { kind: "timeseries" as const, dataset };
      }

      // For bar/stacked-bar/pie → convert multi-series trend into grouped
      // totals with date-qualified labels so each bar/slice is per-date.
      const dataset = trendToGroupedByDate(trend, selectedDimension);
      return { kind: "grouped" as const, dataset };
    },
    enabled: canGenerate,
    staleTime: 30_000,
  });

  // ---------------------------------------------------------------------------
  // Derived data
  // ---------------------------------------------------------------------------

  const reportTypes: ReportTypeOption[] = reportTypesQuery.data?.report_types ?? [];
  const metrics: OperationalDimensionOption[] = dimensionsQuery.data?.metrics ?? [];
  const selectedReportTypeName = reportTypes.find((rt) => rt.id === selectedReportTypeId)?.name;
  const selectedMetricLabel = metrics.find((m) => m.value === selectedMetric)?.label ?? selectedMetric;

  // Build chart title
  const chartTitle = useMemo(() => {
    const parts: string[] = [];
    if (selectedReportTypeName) parts.push(selectedReportTypeName);
    if (selectedMetricLabel) parts.push(selectedMetricLabel);
    if (selectedDimension !== "date") {
      parts.push(`by ${DIMENSION_OPTIONS.find((d) => d.value === selectedDimension)?.label ?? selectedDimension}`);
    }
    return parts.join(" — ") || "Chart";
  }, [selectedReportTypeName, selectedMetricLabel, selectedDimension]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Chart Builder</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Generate charts from operational data dynamically.
        </p>
      </div>

      {/* Controls */}
      <div className="grid grid-cols-1 gap-4 rounded-lg border border-border bg-card p-4 sm:grid-cols-2 lg:grid-cols-5">
        {/* 1. Report Type */}
        <ControlGroup label="Report Type">
          <select
            value={selectedReportTypeId}
            onChange={(e) => setSelectedReportTypeId(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="">All Report Types</option>
            {reportTypes.map((rt) => (
              <option key={rt.id} value={rt.id}>
                {rt.name}
              </option>
            ))}
          </select>
        </ControlGroup>

        {/* 2. Metric */}
        <ControlGroup label="Metric">
          <select
            value={selectedMetric}
            onChange={(e) => setSelectedMetric(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="">Select metric…</option>
            {metrics.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </ControlGroup>

        {/* 3. Dimension */}
        <ControlGroup label="Dimension">
          <select
            value={selectedDimension}
            onChange={(e) => setSelectedDimension(e.target.value as DimensionOption)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          >
            {DIMENSION_OPTIONS.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
        </ControlGroup>

        {/* 4. Chart Type */}
        <ControlGroup label="Chart Type">
          <select
            value={selectedChartType}
            onChange={(e) => setSelectedChartType(e.target.value as ChartTypeOption)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          >
            {CHART_TYPE_OPTIONS.map((ct) => (
              <option key={ct.value} value={ct.value}>
                {ct.label}
              </option>
            ))}
          </select>
        </ControlGroup>

        {/* 5. Date Range */}
        <ControlGroup label="Date Range">
          <select
            value={dateRange.range}
            onChange={(e) => setDateRange({ range: e.target.value as DateRange })}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          >
            {DATE_RANGE_OPTIONS.map((dr) => (
              <option key={dr.value} value={dr.value}>
                {dr.label}
              </option>
            ))}
          </select>
        </ControlGroup>
      </div>

      {/* Custom date range inputs */}
      {dateRange.range === "custom" && (
        <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3">
          <label className="text-xs font-medium text-muted-foreground">From</label>
          <input
            type="date"
            value={customFrom}
            onChange={(e) => setCustomFrom(e.target.value)}
            className="rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <label className="text-xs font-medium text-muted-foreground">To</label>
          <input
            type="date"
            value={customTo}
            onChange={(e) => setCustomTo(e.target.value)}
            className="rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
      )}

      {/* Chart output */}
      <div className="min-h-[400px]">
        {!canGenerate && (
          <div className="flex h-[400px] items-center justify-center rounded-lg border border-dashed border-border bg-card/50">
            <p className="text-sm text-muted-foreground">
              Select a metric to generate a chart.
            </p>
          </div>
        )}

        {canGenerate && chartQuery.isLoading && <ChartSkeleton />}

        {canGenerate && chartQuery.isError && (
          <div className="flex h-[400px] items-center justify-center rounded-lg border border-destructive/30 bg-destructive/5">
            <p className="text-sm text-destructive">
              {chartQuery.error instanceof Error
                ? chartQuery.error.message
                : "Failed to load chart data."}
            </p>
          </div>
        )}

        {canGenerate && chartQuery.data && (
          <ChartRenderer
            kind={chartQuery.data.kind}
            dataset={chartQuery.data.dataset}
            chartType={selectedChartType}
            title={chartTitle}
            dimension={selectedDimension}
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ControlGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

function ChartSkeleton() {
  return (
    <div className="animate-pulse rounded-lg border border-border bg-card p-4">
      <div className="mb-3 h-4 w-48 rounded bg-muted" />
      <div className="h-[350px] rounded bg-muted/50" />
    </div>
  );
}

type ChartRendererProps = {
  kind: "timeseries" | "grouped";
  dataset: TimeSeriesDataset | GroupedTotalsDataset;
  chartType: ChartTypeOption;
  title: string;
  dimension: DimensionOption;
};

function ChartRenderer({ kind, dataset, chartType, title }: ChartRendererProps) {
  if (kind === "timeseries") {
    const tsDataset = dataset as TimeSeriesDataset;
    const variant =
      chartType === "area"
        ? "area"
        : chartType === "stacked-area"
          ? "stacked-area"
          : "line";
    return <TrendChart data={tsDataset} title={title} variant={variant} height={400} />;
  }

  // Grouped dataset
  const groupedDataset = dataset as GroupedTotalsDataset;

  if (chartType === "pie") {
    return <DistributionChart data={groupedDataset} title={title} height={400} />;
  }

  if (chartType === "bar" || chartType === "stacked-bar") {
    return (
      <RankingChart
        data={groupedDataset}
        title={title}
        maxItems={15}
        colorByIndex
      />
    );
  }

  // Line/Area/Stacked Area on a non-date dimension → show as comparison bar chart
  return (
    <ComparisonChart
      data={groupedDataset}
      title={title}
      variant="bar"
      height={400}
      maxItems={15}
    />
  );
}
