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

export type DateRange = "7d" | "30d" | "custom";

export type DateRangeValue = {
  range: DateRange;
  dateFrom?: string;
  dateTo?: string;
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
