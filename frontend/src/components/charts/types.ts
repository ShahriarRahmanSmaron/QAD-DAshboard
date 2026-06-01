/**
 * MD08-1: Visualization Foundation — Chart Types
 *
 * Shared type definitions for the reusable chart engine.
 * These types are chart-library-agnostic so adapters can transform
 * operational fact query results into renderable datasets.
 */

// ---------------------------------------------------------------------------
// Core dataset types
// ---------------------------------------------------------------------------

export type ChartDataPoint = {
  label: string;
  value: number;
  date?: string;
  series?: string;
  metadata?: Record<string, unknown>;
};

export type ChartSeries = {
  key: string;
  label: string;
  color?: string;
  data: ChartDataPoint[];
};

export type ChartDataset = {
  series: ChartSeries[];
  labels: string[];
  domain?: [number, number];
};

// ---------------------------------------------------------------------------
// Time series (trend) dataset
// ---------------------------------------------------------------------------

export type TimeSeriesPoint = {
  date: string;
  [seriesKey: string]: string | number | null | undefined;
};

export type TimeSeriesDataset = {
  points: TimeSeriesPoint[];
  seriesKeys: string[];
  seriesLabels: Record<string, string>;
  seriesColors?: Record<string, string>;
};

// ---------------------------------------------------------------------------
// Grouped totals (ranking / distribution)
// ---------------------------------------------------------------------------

export type GroupedTotalItem = {
  key: string;
  label: string;
  value: number;
  percentage?: number;
  metadata?: Record<string, unknown>;
};

export type GroupedTotalsDataset = {
  items: GroupedTotalItem[];
  total: number;
  groupBy: string;
};

// ---------------------------------------------------------------------------
// KPI dataset
// ---------------------------------------------------------------------------

export type KpiValue = {
  label: string;
  value: number | string;
  unit?: string;
  delta?: number | null;
  deltaPercent?: number | null;
  direction?: "up" | "down" | "flat";
  previousValue?: number | string | null;
  sparkline?: number[];
};

// ---------------------------------------------------------------------------
// Chart configuration
// ---------------------------------------------------------------------------

export type ChartType =
  | "line"
  | "multi-line"
  | "area"
  | "stacked-area"
  | "bar"
  | "stacked-bar"
  | "pie"
  | "kpi";

export type DateRange = "7d" | "14d" | "30d" | "90d" | "custom";

export type DateRangeValue = {
  range: DateRange;
  dateFrom?: string;
  dateTo?: string;
};

// ---------------------------------------------------------------------------
// MD08-3A: Date-aware dashboard datasets
// ---------------------------------------------------------------------------

/**
 * Comparison mode for the date-aware dashboard.
 *   latest-previous — latest report date vs the prior report date
 *   selected-dates  — an explicit set of report dates the user picked
 *   trend           — every report date in the active range
 */
export type DashboardComparisonMode = "latest-previous" | "selected-dates" | "trend";

/** Dimension a chart groups by when report date is treated as a series. */
export type GroupDimension = "unit" | "buyer" | "section";

/** Toggle for stacked-area composition rendering. */
export type StackMode = "absolute" | "percentage";

/**
 * Grouped multi-series dataset for grouped bar charts.
 * Each point is one category (e.g. a unit) carrying one value per series
 * (e.g. one value per report date). Values are never summed across dates.
 */
export type GroupedSeriesPoint = {
  category: string;
} & Record<string, string | number>;

export type GroupedSeriesDataset = {
  points: GroupedSeriesPoint[];
  categories: string[];
  seriesKeys: string[];
  seriesLabels: Record<string, string>;
  categoryDimension: string;
};

/** Single heatmap cell (row × column intersection). */
export type HeatmapCell = {
  row: string;
  column: string;
  value: number;
};

export type HeatmapDataset = {
  rows: string[];
  columns: string[];
  columnLabels: Record<string, string>;
  matrix: Record<string, Record<string, number>>;
  min: number;
  max: number;
  rowDimension: string;
};

/** One row of a two-date comparison (per group, e.g. per unit). */
export type DateComparisonRow = {
  key: string;
  label: string;
  currentValue: number;
  previousValue: number;
  difference: number;
  differencePercent: number | null;
  direction: "up" | "down" | "flat";
};

export type DateComparisonDataset = {
  currentDate: string;
  previousDate: string;
  dimension: string;
  rows: DateComparisonRow[];
};

export type ChartConfig = {
  type: ChartType;
  title?: string;
  subtitle?: string;
  showLegend?: boolean;
  showTooltip?: boolean;
  animate?: boolean;
  height?: number;
  dateRange?: DateRangeValue;
};
