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
  GroupedTotalItem,
  GroupedTotalsDataset,
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
 */
export function trendToTimeSeries(
  trend: OperationalTrendResponse,
  seriesLabel?: string,
): TimeSeriesDataset {
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
