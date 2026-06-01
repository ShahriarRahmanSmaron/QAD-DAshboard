"use client";

/**
 * MD08-1: Visualization Foundation — Chart Data Hooks
 *
 * React Query hooks that fetch operational data and transform it into
 * chart-ready datasets using the adapters. These hooks reuse the existing
 * operational query layer — no new backend endpoints needed for basic charts.
 */

import { useQuery } from "@tanstack/react-query";
import {
  getOperationalAggregation,
  getOperationalComparison,
  getOperationalTrend,
  type OperationalAggregationParams,
  type OperationalComparisonParams,
  type OperationalTrendParams,
} from "@/lib/reports/api";
import {
  aggregationToBuyerRanking,
  aggregationToGroupedTotals,
  aggregationToUnitRanking,
  comparisonToKpi,
  trendToSparkline,
  trendToTimeSeries,
} from "./adapters";
import type { DateRangeValue } from "./types";

const CHART_STALE_TIME = 30_000;

// ---------------------------------------------------------------------------
// Date range helpers
// ---------------------------------------------------------------------------

function dateRangeToParams(dateRange?: DateRangeValue): { date_from?: string; date_to?: string } {
  if (!dateRange) return {};
  if (dateRange.range === "custom") {
    return { date_from: dateRange.dateFrom, date_to: dateRange.dateTo };
  }
  const now = new Date();
  const days = dateRange.range === "7d" ? 7 : 30;
  const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return { date_from: from.toISOString().split("T")[0] };
}

// ---------------------------------------------------------------------------
// Trend chart hook
// ---------------------------------------------------------------------------

export type UseTrendChartParams = {
  metric: string;
  buyer?: string;
  unit?: string;
  section?: string;
  reportTypeId?: string;
  dateRange?: DateRangeValue;
  limit?: number;
  label?: string;
};

export function useTrendChart(params: UseTrendChartParams | null) {
  const trendParams: OperationalTrendParams | null = params
    ? {
        metric: params.metric,
        buyer: params.buyer,
        unit: params.unit,
        section: params.section,
        report_type_id: params.reportTypeId,
        limit: params.limit,
        ...dateRangeToParams(params.dateRange),
      }
    : null;

  return useQuery({
    queryKey: ["chart", "trend", trendParams],
    queryFn: async () => {
      const trend = await getOperationalTrend(trendParams as OperationalTrendParams);
      return {
        raw: trend,
        dataset: trendToTimeSeries(trend, params?.label),
        sparkline: trendToSparkline(trend),
      };
    },
    enabled: Boolean(params?.metric),
    staleTime: CHART_STALE_TIME,
  });
}

// ---------------------------------------------------------------------------
// Ranking chart hook (buyer or unit)
// ---------------------------------------------------------------------------

export type UseRankingChartParams = {
  groupBy: "buyer" | "unit";
  metric?: string;
  section?: string;
  reportTypeId?: string;
  dateRange?: DateRangeValue;
};

export function useRankingChart(params: UseRankingChartParams | null) {
  const aggParams: OperationalAggregationParams | null = params
    ? {
        group_by: [params.groupBy],
        metric: params.metric,
        section: params.section,
        report_type_id: params.reportTypeId,
        ...dateRangeToParams(params.dateRange),
      }
    : null;

  return useQuery({
    queryKey: ["chart", "ranking", aggParams],
    queryFn: async () => {
      const aggregation = await getOperationalAggregation(aggParams as OperationalAggregationParams);
      const dataset =
        params?.groupBy === "buyer"
          ? aggregationToBuyerRanking(aggregation)
          : aggregationToUnitRanking(aggregation);
      return { raw: aggregation, dataset };
    },
    enabled: Boolean(params),
    staleTime: CHART_STALE_TIME,
  });
}

// ---------------------------------------------------------------------------
// Distribution chart hook
// ---------------------------------------------------------------------------

export type UseDistributionChartParams = {
  groupBy: string;
  metric?: string;
  section?: string;
  reportTypeId?: string;
  dateRange?: DateRangeValue;
};

export function useDistributionChart(params: UseDistributionChartParams | null) {
  const aggParams: OperationalAggregationParams | null = params
    ? {
        group_by: [params.groupBy],
        metric: params.metric,
        section: params.section,
        report_type_id: params.reportTypeId,
        ...dateRangeToParams(params.dateRange),
      }
    : null;

  return useQuery({
    queryKey: ["chart", "distribution", aggParams],
    queryFn: async () => {
      const aggregation = await getOperationalAggregation(aggParams as OperationalAggregationParams);
      return {
        raw: aggregation,
        dataset: aggregationToGroupedTotals(aggregation, params?.groupBy ?? "metric"),
      };
    },
    enabled: Boolean(params),
    staleTime: CHART_STALE_TIME,
  });
}

// ---------------------------------------------------------------------------
// KPI card hook
// ---------------------------------------------------------------------------

export type UseKpiChartParams = {
  metric: string;
  currentDate: string;
  previousDate?: string;
  buyer?: string;
  unit?: string;
  section?: string;
  reportTypeId?: string;
  label?: string;
  /** Optional trend params for sparkline */
  sparklineDateRange?: DateRangeValue;
};

export function useKpiChart(params: UseKpiChartParams | null) {
  const comparisonParams: OperationalComparisonParams | null = params
    ? {
        metric: params.metric,
        current_date: params.currentDate,
        previous_date: params.previousDate,
        buyer: params.buyer,
        unit: params.unit,
        section: params.section,
        report_type_id: params.reportTypeId,
      }
    : null;

  const sparklineTrendParams: OperationalTrendParams | null =
    params?.sparklineDateRange
      ? {
          metric: params.metric,
          buyer: params.buyer,
          unit: params.unit,
          section: params.section,
          report_type_id: params.reportTypeId,
          ...dateRangeToParams(params.sparklineDateRange),
        }
      : null;

  const comparisonQuery = useQuery({
    queryKey: ["chart", "kpi", "comparison", comparisonParams],
    queryFn: async () => {
      const comparison = await getOperationalComparison(comparisonParams as OperationalComparisonParams);
      return comparisonToKpi(comparison, params?.label);
    },
    enabled: Boolean(params?.metric && params?.currentDate),
    staleTime: CHART_STALE_TIME,
  });

  const sparklineQuery = useQuery({
    queryKey: ["chart", "kpi", "sparkline", sparklineTrendParams],
    queryFn: async () => {
      const trend = await getOperationalTrend(sparklineTrendParams as OperationalTrendParams);
      return trendToSparkline(trend);
    },
    enabled: Boolean(sparklineTrendParams?.metric),
    staleTime: CHART_STALE_TIME,
  });

  return {
    ...comparisonQuery,
    data: comparisonQuery.data
      ? { ...comparisonQuery.data, sparkline: sparklineQuery.data ?? undefined }
      : undefined,
    isLoading: comparisonQuery.isLoading || sparklineQuery.isLoading,
  };
}
