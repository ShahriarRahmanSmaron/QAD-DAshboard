"use client";

import { useQuery } from "@tanstack/react-query";
import {
  getActiveWorkbookSources,
  getOperationalAggregation,
  getOperationalComparison,
  getOperationalDimensions,
  getOperationalTrend,
  listOperationalFacts,
  listWorkbookInventory,
  traceOperationalFact,
  type OperationalAggregationParams,
  type OperationalComparisonParams,
  type OperationalQueryParams,
  type OperationalTrendParams,
  type WorkbookInventoryScope,
} from "@/lib/reports/api";

/**
 * Operational intelligence query hooks (MD07-2).
 *
 * Thin wrappers around the operational API so the query panel, fact viewer,
 * historical comparison, and traceability views all share consistent cache
 * keys and stale times. Kept separate from the report CRUD hooks to avoid
 * touching the workbook ingestion/reconstruction surface.
 */

const OPERATIONAL_STALE_TIME = 30_000;

export function useOperationalDimensions(
  reportTypeId?: string,
  dimFilters?: Record<string, string>,
) {
  return useQuery({
    queryKey: ["operations", "dimensions", reportTypeId ?? null, dimFilters ?? null],
    queryFn: () => getOperationalDimensions(reportTypeId, dimFilters),
    staleTime: 300_000,
    enabled: Boolean(reportTypeId),   // no fetch until report type chosen
  });
}

export function useOperationalFacts(params: OperationalQueryParams, enabled = true) {
  return useQuery({
    queryKey: ["operations", "facts", params],
    queryFn: () => listOperationalFacts(params),
    enabled,
    staleTime: OPERATIONAL_STALE_TIME,
  });
}

export function useOperationalAggregation(
  params: OperationalAggregationParams,
  enabled = true,
) {
  return useQuery({
    queryKey: ["operations", "aggregate", params],
    queryFn: () => getOperationalAggregation(params),
    enabled,
    staleTime: OPERATIONAL_STALE_TIME,
  });
}

export function useOperationalTrend(params: OperationalTrendParams | null) {
  return useQuery({
    queryKey: ["operations", "trend", params],
    queryFn: () => getOperationalTrend(params as OperationalTrendParams),
    enabled: Boolean(params?.metric),
    staleTime: OPERATIONAL_STALE_TIME,
  });
}

export function useOperationalComparison(params: OperationalComparisonParams | null) {
  return useQuery({
    queryKey: ["operations", "comparison", params],
    queryFn: () => getOperationalComparison(params as OperationalComparisonParams),
    enabled: Boolean(params?.metric && params?.current_date),
    staleTime: OPERATIONAL_STALE_TIME,
  });
}

export function useOperationalFactTrace(factId: string | null) {
  return useQuery({
    queryKey: ["operations", "trace", factId],
    queryFn: () => traceOperationalFact(factId as string),
    enabled: Boolean(factId),
    staleTime: OPERATIONAL_STALE_TIME,
  });
}

// ---------------------------------------------------------------------------
// MD07-3: Workbook governance hooks
// ---------------------------------------------------------------------------

export function useWorkbookInventory(scope: WorkbookInventoryScope = "all") {
  return useQuery({
    queryKey: ["workbooks", "inventory", scope],
    queryFn: () => listWorkbookInventory(scope),
    staleTime: OPERATIONAL_STALE_TIME,
  });
}

export function useActiveWorkbookSources() {
  return useQuery({
    queryKey: ["workbooks", "active-sources"],
    queryFn: getActiveWorkbookSources,
    staleTime: OPERATIONAL_STALE_TIME,
  });
}
