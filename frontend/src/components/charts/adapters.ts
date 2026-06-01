/**
 * MD08-1: Visualization Foundation — Chart Data Adapters
 *
 * Convert operational fact query results into chart datasets.
 * Supports: date series, buyer series, unit series, metric series.
 */

import type {
  OperationalAggregationResponse,
  OperationalComparisonResponse,
  OperationalTrendResponse,
} from "@/lib/reports/types";
import type {
  DateComparisonDataset,
  DateComparisonRow,
  GroupedSeriesDataset,
  GroupedSeriesPoint,
  GroupedTotalItem,
  GroupedTotalsDataset,
  HeatmapDataset,
  KpiValue,
  TimeSeriesDataset,
  TimeSeriesPoint,
} from "./types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toNumber(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return value;
  const parsed = parseFloat(value);
  return isNaN(parsed) ? 0 : parsed;
}

// ---------------------------------------------------------------------------
// Date series adapter (trend → time series)
// ---------------------------------------------------------------------------

/**
 * Convert an OperationalTrendResponse into a TimeSeriesDataset.
 * Each point becomes a date entry with the metric's numeric_total.
 *
 * MD08-2A: When the response contains multi-series data (series_by is set),
 * each unique series value becomes its own series key, producing one line/area
 * per secondary dimension value (e.g. one line per unit).
 */
export function trendToTimeSeries(
  trend: OperationalTrendResponse,
  seriesLabel?: string,
): TimeSeriesDataset {
  // MD08-2A: multi-series mode — group by series value
  if (trend.series_by && trend.points.some((p) => p.series != null)) {
    const dateMap = new Map<string, TimeSeriesPoint>();
    const seriesKeys: string[] = [];
    const seriesLabels: Record<string, string> = {};
    const seenSeries = new Set<string>();

    for (const point of trend.points) {
      const key = point.series ?? "unknown";
      if (!seenSeries.has(key)) {
        seenSeries.add(key);
        seriesKeys.push(key);
        seriesLabels[key] = key;
      }

      const existing = dateMap.get(point.report_date);
      if (existing) {
        existing[key] = toNumber(point.numeric_total);
      } else {
        dateMap.set(point.report_date, {
          date: point.report_date,
          [key]: toNumber(point.numeric_total),
        });
      }
    }

    const points = Array.from(dateMap.values()).sort((a, b) =>
      a.date.localeCompare(b.date),
    );

    return { points, seriesKeys, seriesLabels };
  }

  // Single-series mode (original behavior)
  const key = trend.metric_key;
  const label = seriesLabel ?? trend.metric_key;

  const points: TimeSeriesPoint[] = trend.points.map((point) => ({
    date: point.report_date,
    [key]: toNumber(point.numeric_total),
  }));

  return {
    points,
    seriesKeys: [key],
    seriesLabels: { [key]: label },
  };
}

/**
 * MD08-2A: Convert a multi-series trend response into a GroupedTotalsDataset
 * suitable for bar/pie charts while preserving date grain.
 *
 * Each item in the result is labeled as "series (date)" so the chart shows
 * one bar/slice per (dimension_value, date) combination. Values are never
 * aggregated across dates.
 */
export function trendToGroupedByDate(
  trend: OperationalTrendResponse,
  groupKey: string,
): GroupedTotalsDataset {
  const items: GroupedTotalItem[] = [];
  let grandTotal = 0;

  for (const point of trend.points) {
    const value = toNumber(point.numeric_total);
    const seriesValue = point.series ?? trend.metric_key;
    const dateLabel = point.report_date;
    const label = `${seriesValue} (${dateLabel})`;
    grandTotal += value;
    items.push({
      key: label,
      label,
      value,
      percentage: 0,
    });
  }

  // Compute percentages now that we have the grand total
  for (const item of items) {
    item.percentage = grandTotal > 0 ? (item.value / grandTotal) * 100 : 0;
  }

  // Sort descending by value for ranking-style display
  items.sort((a, b) => b.value - a.value);

  return {
    items,
    total: grandTotal,
    groupBy: groupKey,
  };
}

/**
 * Merge multiple trend responses into a single multi-series time series.
 * Useful for comparing the same metric across buyers or units.
 */
export function mergeTrendsToTimeSeries(
  trends: Array<{ trend: OperationalTrendResponse; label: string; key: string }>,
): TimeSeriesDataset {
  const dateMap = new Map<string, TimeSeriesPoint>();
  const seriesKeys: string[] = [];
  const seriesLabels: Record<string, string> = {};

  for (const { trend, label, key } of trends) {
    seriesKeys.push(key);
    seriesLabels[key] = label;

    for (const point of trend.points) {
      const existing = dateMap.get(point.report_date);
      if (existing) {
        existing[key] = toNumber(point.numeric_total);
      } else {
        dateMap.set(point.report_date, {
          date: point.report_date,
          [key]: toNumber(point.numeric_total),
        });
      }
    }
  }

  const points = Array.from(dateMap.values()).sort((a, b) =>
    a.date.localeCompare(b.date),
  );

  return { points, seriesKeys, seriesLabels };
}

// ---------------------------------------------------------------------------
// Buyer series adapter (aggregation grouped by buyer → ranking)
// ---------------------------------------------------------------------------

export function aggregationToGroupedTotals(
  aggregation: OperationalAggregationResponse,
  groupKey: string,
): GroupedTotalsDataset {
  const grandTotal = toNumber(aggregation.totals.numeric_total);

  const items: GroupedTotalItem[] = aggregation.rows
    .map((row) => {
      const value = toNumber(row.numeric_total);
      const label = String(row.group[groupKey] ?? "Unknown");
      return {
        key: label,
        label,
        value,
        percentage: grandTotal > 0 ? (value / grandTotal) * 100 : 0,
      };
    })
    .sort((a, b) => b.value - a.value);

  return {
    items,
    total: grandTotal,
    groupBy: groupKey,
  };
}

/**
 * Convert aggregation grouped by buyer into a buyer ranking dataset.
 */
export function aggregationToBuyerRanking(
  aggregation: OperationalAggregationResponse,
): GroupedTotalsDataset {
  return aggregationToGroupedTotals(aggregation, "buyer");
}

/**
 * Convert aggregation grouped by unit into a unit ranking dataset.
 */
export function aggregationToUnitRanking(
  aggregation: OperationalAggregationResponse,
): GroupedTotalsDataset {
  return aggregationToGroupedTotals(aggregation, "unit");
}

/**
 * Convert aggregation grouped by metric into a metric distribution dataset.
 */
export function aggregationToMetricDistribution(
  aggregation: OperationalAggregationResponse,
): GroupedTotalsDataset {
  return aggregationToGroupedTotals(aggregation, "metric");
}

// ---------------------------------------------------------------------------
// KPI adapter (comparison → KPI value)
// ---------------------------------------------------------------------------

/**
 * Convert an OperationalComparisonResponse into a KpiValue.
 */
export function comparisonToKpi(
  comparison: OperationalComparisonResponse,
  label?: string,
): KpiValue {
  return {
    label: label ?? comparison.metric_key,
    value: toNumber(comparison.current.numeric_total),
    delta: comparison.delta !== null ? toNumber(comparison.delta) : null,
    deltaPercent: comparison.delta_percent,
    direction: comparison.direction,
    previousValue:
      comparison.previous.numeric_total !== null
        ? toNumber(comparison.previous.numeric_total)
        : null,
  };
}

/**
 * Convert a trend response into sparkline data (array of numbers).
 */
export function trendToSparkline(trend: OperationalTrendResponse): number[] {
  return trend.points.map((p) => toNumber(p.numeric_total));
}

// ---------------------------------------------------------------------------
// MD08-3A: Date-aware adapters
//
// These adapters treat report_date as a first-class analytical dimension.
// They consume a multi-series trend response (series_by set to the grouping
// dimension) and reshape it so each report date is preserved as its own
// series / column / comparison side. Values are NEVER summed across dates.
// ---------------------------------------------------------------------------

/** Format an ISO date (yyyy-mm-dd) as a short "18-May" style label. */
export function formatShortDate(iso: string): string {
  try {
    const [y, m, d] = iso.split("-").map((p) => parseInt(p, 10));
    if (!y || !m || !d) return iso;
    const date = new Date(Date.UTC(y, m - 1, d));
    const day = date.getUTCDate();
    const month = date.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
    return `${day}-${month}`;
  } catch {
    return iso;
  }
}

/**
 * Collect the distinct report dates present in a trend response, sorted
 * ascending. Optionally restrict to an explicit allow-list of dates.
 */
export function trendDates(
  trend: OperationalTrendResponse,
  allowed?: string[],
): string[] {
  const allow = allowed && allowed.length ? new Set(allowed) : null;
  const seen = new Set<string>();
  for (const point of trend.points) {
    if (allow && !allow.has(point.report_date)) continue;
    seen.add(point.report_date);
  }
  return Array.from(seen).sort((a, b) => a.localeCompare(b));
}

/**
 * Convert a multi-series trend (series_by = group dimension) into a grouped
 * dataset where each category (e.g. a unit) carries one bar per report date.
 *
 * Example: metric = wait_for_test, series_by = unit, dates = [18-May, 20-May]
 *   → category HTL-02 → { "2024-05-18": 18729, "2024-05-20": 16153 }
 *
 * Dates are kept as distinct series, so the grouped bar chart shows one bar
 * per (unit, date) — never a summed total.
 */
export function trendToGroupedSeriesByDate(
  trend: OperationalTrendResponse,
  options: { selectedDates?: string[]; topN?: number } = {},
): GroupedSeriesDataset {
  const dimension = trend.series_by ?? "series";
  const dates = trendDates(trend, options.selectedDates);
  const seriesLabels: Record<string, string> = {};
  for (const date of dates) seriesLabels[date] = formatShortDate(date);

  const allowDates = new Set(dates);
  const categoryMap = new Map<string, GroupedSeriesPoint>();
  const categoryTotals = new Map<string, number>();

  for (const point of trend.points) {
    if (!allowDates.has(point.report_date)) continue;
    const category = point.series ?? trend.metric_key;
    const value = toNumber(point.numeric_total);

    let entry = categoryMap.get(category);
    if (!entry) {
      entry = { category };
      for (const date of dates) entry[date] = 0;
      categoryMap.set(category, entry);
    }
    entry[point.report_date] = value;
    categoryTotals.set(category, (categoryTotals.get(category) ?? 0) + value);
  }

  let categories = Array.from(categoryMap.keys());
  // Rank categories by total magnitude so the most significant show first.
  categories.sort(
    (a, b) => (categoryTotals.get(b) ?? 0) - (categoryTotals.get(a) ?? 0),
  );
  if (options.topN && options.topN > 0) {
    categories = categories.slice(0, options.topN);
  }

  const points = categories.map((c) => categoryMap.get(c) as GroupedSeriesPoint);

  return {
    points,
    categories,
    seriesKeys: dates,
    seriesLabels,
    categoryDimension: dimension,
  };
}

/**
 * Convert a multi-series trend into a TimeSeriesDataset where each group value
 * (e.g. each unit) is its own line/area series and report dates run along the
 * X axis. This is the multi-series trend used by Phase 2 / Phase 5.
 */
export function trendToMultiSeries(
  trend: OperationalTrendResponse,
  options: { selectedDates?: string[]; topN?: number } = {},
): TimeSeriesDataset {
  const dates = trendDates(trend, options.selectedDates);
  const allowDates = new Set(dates);

  const seriesTotals = new Map<string, number>();
  for (const point of trend.points) {
    if (!allowDates.has(point.report_date)) continue;
    const key = point.series ?? trend.metric_key;
    seriesTotals.set(key, (seriesTotals.get(key) ?? 0) + toNumber(point.numeric_total));
  }

  let seriesKeys = Array.from(seriesTotals.keys()).sort(
    (a, b) => (seriesTotals.get(b) ?? 0) - (seriesTotals.get(a) ?? 0),
  );
  if (options.topN && options.topN > 0) {
    seriesKeys = seriesKeys.slice(0, options.topN);
  }
  const allowedSeries = new Set(seriesKeys);

  const seriesLabels: Record<string, string> = {};
  for (const key of seriesKeys) seriesLabels[key] = key;

  const dateMap = new Map<string, TimeSeriesPoint>();
  for (const date of dates) {
    const base: TimeSeriesPoint = { date };
    for (const key of seriesKeys) base[key] = 0;
    dateMap.set(date, base);
  }

  for (const point of trend.points) {
    if (!allowDates.has(point.report_date)) continue;
    const key = point.series ?? trend.metric_key;
    if (!allowedSeries.has(key)) continue;
    const entry = dateMap.get(point.report_date);
    if (entry) entry[key] = toNumber(point.numeric_total);
  }

  const points = Array.from(dateMap.values()).sort((a, b) =>
    a.date.localeCompare(b.date),
  );

  return { points, seriesKeys, seriesLabels };
}

/**
 * Build a Unit × Date (row × column) heatmap from a multi-series trend.
 * Rows are the grouping dimension values; columns are report dates.
 */
export function trendToHeatmap(
  trend: OperationalTrendResponse,
  options: { selectedDates?: string[]; topN?: number } = {},
): HeatmapDataset {
  const dimension = trend.series_by ?? "series";
  const columns = trendDates(trend, options.selectedDates);
  const allowDates = new Set(columns);
  const columnLabels: Record<string, string> = {};
  for (const col of columns) columnLabels[col] = formatShortDate(col);

  const matrix: Record<string, Record<string, number>> = {};
  const rowTotals = new Map<string, number>();
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  for (const point of trend.points) {
    if (!allowDates.has(point.report_date)) continue;
    const row = point.series ?? trend.metric_key;
    const value = toNumber(point.numeric_total);
    if (!matrix[row]) {
      matrix[row] = {};
      for (const col of columns) matrix[row][col] = 0;
    }
    matrix[row][point.report_date] = value;
    rowTotals.set(row, (rowTotals.get(row) ?? 0) + value);
  }

  let rows = Object.keys(matrix).sort(
    (a, b) => (rowTotals.get(b) ?? 0) - (rowTotals.get(a) ?? 0),
  );
  if (options.topN && options.topN > 0) {
    rows = rows.slice(0, options.topN);
  }

  // Recompute min/max over the visible rows only.
  for (const row of rows) {
    for (const col of columns) {
      const value = matrix[row]?.[col] ?? 0;
      if (value < min) min = value;
      if (value > max) max = value;
    }
  }
  if (!isFinite(min)) min = 0;
  if (!isFinite(max)) max = 0;

  return { rows, columns, columnLabels, matrix, min, max, rowDimension: dimension };
}

/**
 * Build a per-group date comparison (current date vs previous date) from a
 * multi-series trend. Each row is one group value with its current/previous
 * values, absolute difference, percentage difference and trend direction.
 */
export function trendToDateComparison(
  trend: OperationalTrendResponse,
  currentDate: string,
  previousDate: string,
  options: { topN?: number } = {},
): DateComparisonDataset {
  const dimension = trend.series_by ?? "series";
  const current = new Map<string, number>();
  const previous = new Map<string, number>();
  const groups = new Set<string>();

  for (const point of trend.points) {
    const group = point.series ?? trend.metric_key;
    const value = toNumber(point.numeric_total);
    if (point.report_date === currentDate) {
      current.set(group, (current.get(group) ?? 0) + value);
      groups.add(group);
    } else if (point.report_date === previousDate) {
      previous.set(group, (previous.get(group) ?? 0) + value);
      groups.add(group);
    }
  }

  const rows: DateComparisonRow[] = Array.from(groups).map((group) => {
    const currentValue = current.get(group) ?? 0;
    const previousValue = previous.get(group) ?? 0;
    const difference = currentValue - previousValue;
    const differencePercent =
      previousValue !== 0 ? (difference / previousValue) * 100 : null;
    const direction: "up" | "down" | "flat" =
      difference > 0 ? "up" : difference < 0 ? "down" : "flat";
    return {
      key: group,
      label: group,
      currentValue,
      previousValue,
      difference,
      differencePercent,
      direction,
    };
  });

  rows.sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference));
  const limited = options.topN && options.topN > 0 ? rows.slice(0, options.topN) : rows;

  return {
    currentDate,
    previousDate,
    dimension,
    rows: limited,
  };
}

/**
 * Compute a KPI value comparing a metric's total on the latest report date
 * against the previous report date, directly from a trend response.
 *
 * This replaces the broken "today vs yesterday" KPI logic: report dates are
 * resolved from the actual data, so cards never show 0 just because the
 * calendar "today" has no facts.
 */
export function trendToLatestKpi(
  trend: OperationalTrendResponse,
  label: string,
): KpiValue {
  // Aggregate per report date (across all series for the metric total).
  const byDate = new Map<string, number>();
  for (const point of trend.points) {
    byDate.set(
      point.report_date,
      (byDate.get(point.report_date) ?? 0) + toNumber(point.numeric_total),
    );
  }

  const dates = Array.from(byDate.keys()).sort((a, b) => a.localeCompare(b));
  const latestDate = dates[dates.length - 1];
  if (!latestDate) {
    return { label, value: "—", direction: "flat" };
  }

  const previousDate = dates.length > 1 ? dates[dates.length - 2] ?? null : null;
  const currentValue = byDate.get(latestDate) ?? 0;
  const previousValue = previousDate !== null ? byDate.get(previousDate) ?? 0 : null;

  let delta: number | null = null;
  let deltaPercent: number | null = null;
  let direction: "up" | "down" | "flat" = "flat";
  if (previousValue !== null) {
    delta = currentValue - previousValue;
    deltaPercent = previousValue !== 0 ? (delta / previousValue) * 100 : null;
    direction = delta > 0 ? "up" : delta < 0 ? "down" : "flat";
  }

  // Sparkline across the available report dates.
  const sparkline = dates.map((d) => byDate.get(d) ?? 0);

  return {
    label,
    value: currentValue,
    delta,
    deltaPercent,
    direction,
    previousValue,
    sparkline,
  };
}
