/**
 * MD08-1: Visualization Foundation — Chart API Client
 *
 * Dedicated API functions for the chart query endpoints.
 * These wrap the /api/charts/* proxy routes.
 */

import type {
  OperationalAggregationResponse,
  OperationalTrendResponse,
} from "@/lib/reports/types";

type ApiErrorBody = {
  detail?: string;
  message?: string;
};

async function request<TResponse>(
  path: string,
  options: Omit<RequestInit, "body"> & { body?: unknown } = {},
) {
  const { body, headers, ...init } = options;
  const response = await fetch(path, {
    ...init,
    body: body ? JSON.stringify(body) : undefined,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
  });

  if (!response.ok) {
    let message = "Request failed.";
    try {
      const data = (await response.json()) as ApiErrorBody;
      message = data.detail ?? data.message ?? message;
    } catch {
      message = `Request failed with status ${response.status}.`;
    }
    throw new Error(message);
  }

  return response.json() as Promise<TResponse>;
}

function toQueryString(params: Record<string, unknown> = {}): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item === undefined || item === null || item === "") continue;
        query.append(key, String(item));
      }
      continue;
    }
    query.set(key, String(value));
  }
  return query.toString();
}

// ---------------------------------------------------------------------------
// Chart API types
// ---------------------------------------------------------------------------

export type ChartTimeSeriesParams = {
  metric: string;
  buyer?: string;
  unit?: string;
  section?: string;
  report_type_id?: string;
  date_from?: string;
  date_to?: string;
  classification?: string;
  limit?: number;
};

export type ChartGroupedParams = {
  group_by?: string[];
  buyer?: string;
  unit?: string;
  metric?: string;
  section?: string;
  report_type_id?: string;
  report_date?: string;
  date_from?: string;
  date_to?: string;
  classification?: string;
};

export type ChartRankingsParams = {
  rank_by?: "buyer" | "unit" | "metric" | "section";
  metric?: string;
  section?: string;
  report_type_id?: string;
  date_from?: string;
  date_to?: string;
  classification?: string;
  limit?: number;
};

export type ChartDistributionParams = {
  distribute_by?: "buyer" | "unit" | "metric" | "section";
  buyer?: string;
  unit?: string;
  section?: string;
  report_type_id?: string;
  date_from?: string;
  date_to?: string;
  classification?: string;
};

// ---------------------------------------------------------------------------
// Chart API functions
// ---------------------------------------------------------------------------

export function getChartTimeSeries(params: ChartTimeSeriesParams) {
  const query = toQueryString(params);
  return request<OperationalTrendResponse>(
    `/api/charts/time-series${query ? `?${query}` : ""}`,
  );
}

export function getChartGrouped(params: ChartGroupedParams) {
  const query = toQueryString(params);
  return request<OperationalAggregationResponse>(
    `/api/charts/grouped${query ? `?${query}` : ""}`,
  );
}

export function getChartRankings(params: ChartRankingsParams) {
  const query = toQueryString(params);
  return request<OperationalAggregationResponse>(
    `/api/charts/rankings${query ? `?${query}` : ""}`,
  );
}

export function getChartDistribution(params: ChartDistributionParams) {
  const query = toQueryString(params);
  return request<OperationalAggregationResponse>(
    `/api/charts/distribution${query ? `?${query}` : ""}`,
  );
}
