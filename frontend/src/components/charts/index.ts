/**
 * MD08-1: Visualization Foundation — Chart Component Library
 *
 * Reusable chart engine for the QAD Platform.
 * All chart components support tooltips, legends, responsive resizing,
 * and light/dark mode.
 */

// Components
export { TrendChart } from "./trend-chart";
export { ComparisonChart } from "./comparison-chart";
export { RankingChart } from "./ranking-chart";
export { DistributionChart } from "./distribution-chart";
export { KpiCard } from "./kpi-card";
export { ChartTooltip } from "./chart-tooltip";
export { ChartDemo } from "./chart-demo";
export { ChartBuilderPage } from "./chart-builder-page";
export { ChartExportButtons } from "./export-buttons";
// MD08-3A: date-aware dashboard components
export { GroupedBarChart } from "./grouped-bar-chart";
export { MultiSeriesTrend } from "./multi-series-trend";
export { StackedAreaTrend } from "./stacked-area-trend";
export { HeatmapChart } from "./heatmap-chart";
export { DateComparisonView } from "./date-comparison-view";

// Hooks
export {
  useTrendChart,
  useRankingChart,
  useDistributionChart,
  useKpiChart,
} from "./use-chart-data";

// Adapters
export {
  trendToTimeSeries,
  mergeTrendsToTimeSeries,
  aggregationToGroupedTotals,
  aggregationToBuyerRanking,
  aggregationToUnitRanking,
  aggregationToMetricDistribution,
  comparisonToKpi,
  trendToSparkline,
  // MD08-3A: date-aware adapters
  formatShortDate,
  trendDates,
  trendToGroupedSeriesByDate,
  trendToMultiSeries,
  trendToHeatmap,
  trendToDateComparison,
  trendToLatestKpi,
} from "./adapters";

// Theme
export { useChartTheme } from "./use-chart-theme";
export { getChartTheme, getSeriesColor, CHART_COLORS, CHART_COLORS_DARK } from "./theme";

// Types
export type {
  ChartDataPoint,
  ChartSeries,
  ChartDataset,
  TimeSeriesPoint,
  TimeSeriesDataset,
  GroupedTotalItem,
  GroupedTotalsDataset,
  KpiValue,
  ChartType,
  ChartConfig,
  DateRange,
  DateRangeValue,
  // MD08-3A: date-aware dashboard types
  DashboardComparisonMode,
  GroupDimension,
  StackMode,
  GroupedSeriesPoint,
  GroupedSeriesDataset,
  HeatmapCell,
  HeatmapDataset,
  DateComparisonRow,
  DateComparisonDataset,
} from "./types";
