/**
 * MD08-3A: Dashboard date intelligence helpers.
 *
 * Report dates are a first-class analytical dimension. These helpers resolve
 * the active date window and the dates each visualization should render —
 * anchored to the *latest available report date* rather than the calendar
 * "today", so the dashboard never goes blank just because no workbook was
 * uploaded on the current calendar day.
 */

import type {
  DashboardComparisonMode,
  DateRange,
  GroupDimension,
} from "@/components/charts/types";

export const METRIC_KEYS = {
  T_STOCK: "t_stock",
  WAIT_FOR_TEST: "wait_for_test",
  WAIT_FOR_SHADE: "wait_for_shade",
  WAIT_FOR_RFD: "wait_for_rfd",
} as const;

/** Preferred ordering for KPI cards when these metrics exist in the data. */
export const PREFERRED_KPI_METRICS: string[] = [
  METRIC_KEYS.T_STOCK,
  METRIC_KEYS.WAIT_FOR_TEST,
  METRIC_KEYS.WAIT_FOR_SHADE,
  METRIC_KEYS.WAIT_FOR_RFD,
];

export const DATE_RANGE_OPTIONS: { value: DateRange; label: string }[] = [
  { value: "7d", label: "Last 7 Days" },
  { value: "14d", label: "Last 14 Days" },
  { value: "30d", label: "Last 30 Days" },
  { value: "90d", label: "Last 90 Days" },
  { value: "custom", label: "Custom Range" },
];

export const COMPARISON_MODE_OPTIONS: {
  value: DashboardComparisonMode;
  label: string;
}[] = [
  { value: "latest-previous", label: "Latest vs Previous" },
  { value: "selected-dates", label: "Custom Date Comparison" },
  { value: "trend", label: "Trend Analysis" },
];

export const GROUP_DIMENSION_OPTIONS: { value: GroupDimension; label: string }[] = [
  { value: "unit", label: "Unit" },
  { value: "buyer", label: "Buyer" },
  { value: "section", label: "Section" },
];

const RANGE_DAYS: Record<Exclude<DateRange, "custom">, number> = {
  "7d": 7,
  "14d": 14,
  "30d": 30,
  "90d": 90,
};

/** Subtract ``days`` from an ISO yyyy-mm-dd date, returning ISO. */
export function subtractDays(iso: string, days: number): string {
  const parts = iso.split("-").map((p) => parseInt(p, 10));
  const y = parts[0] ?? 1970;
  const m = parts[1] ?? 1;
  const d = parts[2] ?? 1;
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().split("T")[0] ?? iso;
}

export function todayISO(): string {
  return new Date().toISOString().split("T")[0] ?? "";
}

/**
 * Resolve the API date window for the active range.
 *
 * Presets are anchored to ``anchorDate`` (the latest report date present in
 * the data) when available so historical workbooks are always in range.
 */
export function resolveDateWindow(
  range: DateRange,
  anchorDate: string | null,
  custom: { from?: string; to?: string },
): { date_from?: string; date_to?: string } {
  if (range === "custom") {
    return { date_from: custom.from || undefined, date_to: custom.to || undefined };
  }
  const anchor = anchorDate ?? todayISO();
  const days = RANGE_DAYS[range];
  return { date_from: subtractDays(anchor, days), date_to: anchor };
}

/**
 * Filter a sorted-ascending list of available dates down to those that fall
 * within the resolved window.
 */
export function datesInWindow(
  availableDates: string[],
  window: { date_from?: string; date_to?: string },
): string[] {
  return availableDates.filter((d) => {
    if (window.date_from && d < window.date_from) return false;
    if (window.date_to && d > window.date_to) return false;
    return true;
  });
}

/**
 * Decide which report dates each comparison-sensitive visualization should use.
 *
 *   latest-previous → the two most-recent dates in the window
 *   selected-dates  → the user's explicit picks (clamped to the window)
 *   trend           → every date in the window
 */
export function resolveEffectiveDates(
  mode: DashboardComparisonMode,
  windowDates: string[],
  selectedDates: string[],
): string[] {
  if (mode === "trend") return windowDates;
  if (mode === "selected-dates") {
    const allow = new Set(windowDates);
    const picked = selectedDates.filter((d) => allow.has(d)).sort((a, b) => a.localeCompare(b));
    return picked.length ? picked : windowDates.slice(-2);
  }
  // latest-previous
  return windowDates.slice(-2);
}

/**
 * Resolve the (previous, current) pair for two-date comparisons. Uses the two
 * most-recent effective dates.
 */
export function resolveComparisonPair(
  effectiveDates: string[],
): { current: string | null; previous: string | null } {
  const sorted = [...effectiveDates].sort((a, b) => a.localeCompare(b));
  const current = sorted[sorted.length - 1] ?? null;
  const previous = sorted.length > 1 ? sorted[sorted.length - 2] ?? null : null;
  return { current, previous };
}

/** Pick up to ``limit`` KPI metric keys, preferring the WF core metrics. */
export function resolveKpiMetrics(
  available: { value: string; label: string }[],
  limit = 4,
): { value: string; label: string }[] {
  const byKey = new Map(available.map((m) => [m.value, m]));
  const ordered: { value: string; label: string }[] = [];
  for (const key of PREFERRED_KPI_METRICS) {
    const found = byKey.get(key);
    if (found) {
      ordered.push(found);
      byKey.delete(key);
    }
  }
  for (const remaining of byKey.values()) {
    ordered.push(remaining);
  }
  return ordered.slice(0, limit);
}
