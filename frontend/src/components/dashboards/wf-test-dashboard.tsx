"use client";

/**
 * MD08-3 / MD08-3A / MD08-5: WF Test & Shade Dashboard — Date-Aware Edition
 *
 * Report dates are treated as a first-class analytical dimension. Nothing is
 * summed across report dates unless cumulative mode is intentionally chosen.
 *
 * Sections:
 *   0. Global Date Controls (Phase 1)
 *   1. Executive Summary & Insight Callouts (Phase 1 & Feedback)
 *   2. Historical Comparison KPI Cards — latest report date vs previous (Phase 2 & 7)
 *   3. Smart Trend - grouped bars if < 7 dates, lines if >= 7 dates (Phase 2 & 5)
 *   4. Buyer Analysis - Grouped Horizontal Bar Chart + Comparison Table (Phase 3 & Feedback)
 *   5. Unit Analysis - Sortable Unit Performance Matrix + Drilldown (Phase 4 & Feedback)
 *   6. Top Movers Section - Clickable Largest Increases & Reductions (Phase 6 & Feedback)
 *   7. Date Comparison View — current vs previous, per group
 *   8. Stacked Area Trend — operational load composition
 *   9. Delta Heatmap (at bottom) (Phase 7)
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileSpreadsheet, Printer } from "lucide-react";
import { getChartTimeSeries } from "@/lib/charts/api";
import { listReportTypes } from "@/lib/reports/api";
import { useOperationalDimensions } from "@/lib/reports/operational-hooks";
import { downloadBinary, queryString, auditClientExport } from "@/lib/export/downloads";
import {
  trendToGroupedSeriesByDate,
  trendToMultiSeries,
  trendToHeatmap,
  trendToDateComparison,
  trendToLatestKpi,
  formatShortDate,
} from "@/components/charts/adapters";
import { GroupedBarChart } from "@/components/charts/grouped-bar-chart";
import { MultiSeriesTrend } from "@/components/charts/multi-series-trend";
import { StackedAreaTrend } from "@/components/charts/stacked-area-trend";
import { HeatmapChart } from "@/components/charts/heatmap-chart";
import { KpiCard } from "@/components/charts/kpi-card";
import type { OperationalTrendResponse } from "@/lib/reports/types";
import type { AuthUser } from "@/lib/auth/types";
import {
  DashboardControls,
  type DashboardControlsState,
} from "./dashboard-controls";
import {
  GROUP_DIMENSION_OPTIONS,
  datesInWindow,
  resolveDateWindow,
  resolveKpiMetrics,
} from "./dashboard-utils";

// Optimized Components
import { UnitExplorer } from "@/components/charts/unit-explorer";
import { BuyerExplorer } from "@/components/charts/buyer-explorer";

const STALE_TIME = 30_000;
const TOP_N = 8;

function toNumber(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return value;
  const parsed = parseFloat(value);
  return isNaN(parsed) ? 0 : parsed;
}

function formatValue(v: number): string {
  return Math.round(v).toLocaleString();
}

function groupLabel(dimension: string): string {
  return (
    GROUP_DIMENSION_OPTIONS.find((g) => g.value === dimension)?.label ?? dimension
  );
}

export function WfTestDashboard({ user }: { user?: AuthUser }) {
  // ---------------------------------------------------------------------------
  // Control state
  // ---------------------------------------------------------------------------
  const [state, setState] = useState<DashboardControlsState>({
    reportTypeId: "",
    metric: "",
    dateRange: "30d",
    customFrom: "",
    customTo: "",
    groupDimension: "unit",
    selectedCurrentDate: "",
    selectedComparisonDate: "",
  });
  const dashboardRef = useRef<HTMLDivElement>(null);
  const [timestamp, setTimestamp] = useState("");
  // Explorer States
  const [explorerUnit, setExplorerUnit] = useState<string | null>(null);
  const [explorerBuyer, setExplorerBuyer] = useState<string | null>(null);
  
  // Collapse/Expand States (default collapsed)
  const [unitExplorerExpanded, setUnitExplorerExpanded] = useState(false);
  const [buyerExplorerExpanded, setBuyerExplorerExpanded] = useState(false);
  const [insightsExpanded, setInsightsExpanded] = useState(false);

  const unitExplorerRef = useRef<HTMLDivElement>(null);
  const buyerExplorerRef = useRef<HTMLDivElement>(null);

  const [unitHistoricalControls, setUnitHistoricalControls] = useState({
    vizMode: "bars" as "bars" | "lines",
    userSelectedVizMode: null as "bars" | "lines" | null,
    unitVisibility: "all" as "all" | "top5" | "top10",
    focusUnit: "all",
    dateScope: "full" as "full" | "comparison",
  });


  useEffect(() => {
    setTimestamp(new Date().toLocaleString());
  }, []);

  function handleUnitClick(unit: string) {
    setExplorerUnit(unit);
    setUnitExplorerExpanded(true);
    setTimeout(() => {
      if (unitExplorerRef.current) {
        unitExplorerRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }, 100);
  }

  function handleBuyerClick(buyer: string) {
    setExplorerBuyer(buyer);
    setBuyerExplorerExpanded(true);
    setTimeout(() => {
      if (buyerExplorerRef.current) {
        buyerExplorerRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }, 100);
  }

  function patch(p: Partial<DashboardControlsState>) {
    setState((prev) => ({ ...prev, ...p }));
  }

  // ---------------------------------------------------------------------------
  // Registry + dimensions (dynamic — no hardcoding)
  // ---------------------------------------------------------------------------
  const reportTypesQuery = useQuery({
    queryKey: ["report-types"],
    queryFn: listReportTypes,
    staleTime: 60_000,
  });

  const dimensionsQuery = useOperationalDimensions(state.reportTypeId || undefined);

  const reportTypes = reportTypesQuery.data?.report_types ?? [];
  const metrics = useMemo(
    () => dimensionsQuery.data?.metrics ?? [],
    [dimensionsQuery.data],
  );

  // Available report dates, ascending.
  const availableDates = useMemo(() => {
    const raw = dimensionsQuery.data?.dates ?? [];
    return raw.map((d) => d.value).sort((a, b) => a.localeCompare(b));
  }, [dimensionsQuery.data]);

  const anchorDate: string | null = availableDates.length
    ? availableDates[availableDates.length - 1] ?? null
    : null;

  // Initialize and validate selectedCurrentDate / selectedComparisonDate
  useEffect(() => {
    if (!availableDates.length) return;
    const latest = availableDates[availableDates.length - 1];
    const previous = availableDates.length > 1 ? availableDates[availableDates.length - 2] : "";

    const hasValidCurrent = state.selectedCurrentDate && availableDates.includes(state.selectedCurrentDate);
    const hasValidComparison = state.selectedComparisonDate && availableDates.includes(state.selectedComparisonDate);

    const patchPayload: Partial<DashboardControlsState> = {};

    if (!hasValidCurrent && latest) {
      patchPayload.selectedCurrentDate = latest;
    }
    if (!hasValidComparison && previous) {
      patchPayload.selectedComparisonDate = previous;
    } else if (!hasValidComparison && !previous && latest) {
      patchPayload.selectedComparisonDate = "";
    }

    // Validation: current and comparison cannot be identical
    const nextCurrent = patchPayload.selectedCurrentDate !== undefined ? patchPayload.selectedCurrentDate : state.selectedCurrentDate;
    const nextComparison = patchPayload.selectedComparisonDate !== undefined ? patchPayload.selectedComparisonDate : state.selectedComparisonDate;
    
    if (nextCurrent && nextCurrent === nextComparison) {
      const otherIndex = availableDates.indexOf(nextCurrent);
      const nextValid = otherIndex > 0 ? availableDates[otherIndex - 1] : (otherIndex < availableDates.length - 1 ? availableDates[otherIndex + 1] : "");
      patchPayload.selectedComparisonDate = nextValid;
    }

    if (Object.keys(patchPayload).length > 0) {
      setState((prev) => ({ ...prev, ...patchPayload }));
    }
  }, [availableDates, state.selectedCurrentDate, state.selectedComparisonDate]);

  // Default the metric once dimensions load (prefer Wait For Test, else first).
  useEffect(() => {
    if (!metrics.length) return;
    const first = metrics[0];
    if (!first) return;
    if (!state.metric) {
      const preferred = metrics.find((m) => m.value === "wait_for_test") ?? first;
      patch({ metric: preferred.value });
    } else if (!metrics.some((m) => m.value === state.metric)) {
      // Reset an invalid metric when the report type changes.
      patch({ metric: first.value });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metrics]);

  // ---------------------------------------------------------------------------
  // Resolve the active date window + dates each visualization should render
  // ---------------------------------------------------------------------------
  const dateWindow = useMemo(
    () =>
      resolveDateWindow(state.dateRange, anchorDate, {
        from: state.customFrom,
        to: state.customTo,
      }),
    [state.dateRange, anchorDate, state.customFrom, state.customTo],
  );

  const windowDates = useMemo(
    () => datesInWindow(availableDates, dateWindow),
    [availableDates, dateWindow],
  );


  const effectiveDates = useMemo(
    () => {
      const dates: string[] = [];
      if (state.selectedComparisonDate) dates.push(state.selectedComparisonDate);
      if (state.selectedCurrentDate) dates.push(state.selectedCurrentDate);
      return dates.sort((a, b) => a.localeCompare(b));
    },
    [state.selectedCurrentDate, state.selectedComparisonDate],
  );

  // Dates shown by trend/composition/heatmap. Trend charts remain unchanged
  // and continue using the selected date range.
  const displayDates = windowDates;

  const comparisonPair = useMemo(
    () => ({
      current: state.selectedCurrentDate || null,
      previous: state.selectedComparisonDate || null,
    }),
    [state.selectedCurrentDate, state.selectedComparisonDate],
  );

  // ---------------------------------------------------------------------------
  // Phase 8 data layer — one grouped (multi-series) trend feeds every chart.
  // series_by = group dimension; report-date grain is always preserved.
  // ---------------------------------------------------------------------------
  const groupedTrendQuery = useQuery({
    queryKey: [
      "wf-dash",
      "grouped-trend",
      state.reportTypeId,
      state.metric,
      state.groupDimension,
      dateWindow,
    ],
    queryFn: () =>
      getChartTimeSeries({
        metric: state.metric,
        report_type_id: state.reportTypeId || undefined,
        series_by: state.groupDimension,
        date_from: dateWindow.date_from,
        date_to: dateWindow.date_to,
        limit: 365,
      }),
    enabled: Boolean(state.metric),
    staleTime: STALE_TIME,
  });

  const buyerTrendQuery = useQuery({
    queryKey: [
      "wf-dash",
      "buyer-trend",
      state.reportTypeId,
      state.metric,
      dateWindow,
    ],
    queryFn: () =>
      getChartTimeSeries({
        metric: state.metric,
        report_type_id: state.reportTypeId || undefined,
        series_by: "buyer",
        date_from: dateWindow.date_from,
        date_to: dateWindow.date_to,
        limit: 365,
      }),
    enabled: Boolean(state.metric),
    staleTime: STALE_TIME,
  });

  const unitTrendQuery = useQuery({
    queryKey: [
      "wf-dash",
      "unit-trend",
      state.reportTypeId,
      state.metric,
      dateWindow,
    ],
    queryFn: () =>
      getChartTimeSeries({
        metric: state.metric,
        report_type_id: state.reportTypeId || undefined,
        series_by: "unit",
        date_from: dateWindow.date_from,
        date_to: dateWindow.date_to,
        limit: 365,
      }),
    enabled: Boolean(state.metric),
    staleTime: STALE_TIME,
  });

  // KPI cards: latest vs previous report date per core metric, locked to Unit series for drivers
  const kpiMetrics = useMemo(() => resolveKpiMetrics(metrics, 4), [metrics]);

  const kpiQuery = useQuery({
    queryKey: [
      "wf-dash",
      "kpi",
      state.reportTypeId,
      kpiMetrics.map((m) => m.value),
      dateWindow,
      "unit", // Locked to unit
    ],
    queryFn: async () => {
      const results = await Promise.all(
        kpiMetrics.map((m) =>
          getChartTimeSeries({
            metric: m.value,
            report_type_id: state.reportTypeId || undefined,
            series_by: "unit", // Lock primary drivers to unit operations
            date_from: dateWindow.date_from,
            date_to: dateWindow.date_to,
            limit: 365,
          }).then((trend) => ({ trend, label: m.label })),
        ),
      );
      return results;
    },
    enabled: kpiMetrics.length > 0,
    staleTime: STALE_TIME,
  });

  // ---------------------------------------------------------------------------
  // Derived datasets
  // ---------------------------------------------------------------------------
  const groupedTrend: OperationalTrendResponse | undefined = groupedTrendQuery.data;
  const metricLabel =
    metrics.find((m) => m.value === state.metric)?.label ?? state.metric;
  const dim = state.groupDimension;

  const multiSeriesDataset = useMemo(() => {
    if (!groupedTrend) return null;
    return trendToMultiSeries(groupedTrend, { selectedDates: displayDates, topN: TOP_N });
  }, [groupedTrend, displayDates]);

  const groupedBarDataset = useMemo(() => {
    if (!groupedTrend) return null;
    return trendToGroupedSeriesByDate(groupedTrend, {
      selectedDates: effectiveDates,
      topN: TOP_N,
    });
  }, [groupedTrend, effectiveDates]);

  const heatmapDataset = useMemo(() => {
    if (!groupedTrend) return null;
    return trendToHeatmap(groupedTrend, { selectedDates: displayDates, topN: TOP_N });
  }, [groupedTrend, displayDates]);

  // comparisonDataset was removed since we no longer use DateComparisonView

  // Locked unit comparison dataset for Executive Summary and Matrix
  const unitComparisonDataset = useMemo(() => {
    if (!unitTrendQuery.data || !comparisonPair.current || !comparisonPair.previous) {
      return null;
    }
    return trendToDateComparison(
      unitTrendQuery.data,
      comparisonPair.current,
      comparisonPair.previous,
      { topN: 0 } // Get all units
    );
  }, [unitTrendQuery.data, comparisonPair]);

  const availableUnits = useMemo(() => {
    return unitComparisonDataset?.rows.map((r) => ({
      value: r.key,
      label: r.label,
    })) ?? [];
  }, [unitComparisonDataset]);

  const availableBuyers = useMemo(() => {
    if (!buyerTrendQuery.data) return [];
    const buyers = new Set<string>();
    for (const pt of buyerTrendQuery.data.points) {
      if (pt.series) buyers.add(pt.series);
    }
    return Array.from(buyers).map((b) => ({ value: b, label: b }));
  }, [buyerTrendQuery.data]);

  // Explorer Selection Persistence Hooks
  useEffect(() => {
    if (explorerUnit && availableUnits.length > 0) {
      const exists = availableUnits.some((u) => u.value === explorerUnit);
      if (!exists) {
        setExplorerUnit(null);
      }
    }
  }, [availableUnits, explorerUnit]);

  useEffect(() => {
    if (explorerBuyer && availableBuyers.length > 0) {
      const exists = availableBuyers.some((b) => b.value === explorerBuyer);
      if (!exists) {
        setExplorerBuyer(null);
      }
    }
  }, [availableBuyers, explorerBuyer]);

  // Executive summary stats
  const tStockKpi = useMemo(() => {
    const found = kpiQuery.data?.find((d) => d.trend.metric_key === "t_stock");
    return found ? trendToLatestKpi(found.trend, found.label, {
      currentDate: state.selectedCurrentDate,
      previousDate: state.selectedComparisonDate,
    }) : null;
  }, [kpiQuery.data, state.selectedCurrentDate, state.selectedComparisonDate]);

  const wftKpi = useMemo(() => {
    const found = kpiQuery.data?.find((d) => d.trend.metric_key === "wait_for_test");
    return found ? trendToLatestKpi(found.trend, found.label, {
      currentDate: state.selectedCurrentDate,
      previousDate: state.selectedComparisonDate,
    }) : null;
  }, [kpiQuery.data, state.selectedCurrentDate, state.selectedComparisonDate]);

  const largestContributor = useMemo(() => {
    if (!unitComparisonDataset || !unitComparisonDataset.rows.length) return null;
    const pos = unitComparisonDataset.rows.filter((r) => r.difference > 0);
    if (!pos.length) return null;
    return [...pos].sort((a, b) => b.difference - a.difference)[0] ?? null;
  }, [unitComparisonDataset]);

  const largestReduction = useMemo(() => {
    if (!unitComparisonDataset || !unitComparisonDataset.rows.length) return null;
    const neg = unitComparisonDataset.rows.filter((r) => r.difference < 0);
    if (!neg.length) return null;
    return [...neg].sort((a, b) => a.difference - b.difference)[0] ?? null;
  }, [unitComparisonDataset]);

  const buyerComparisonDataset = useMemo(() => {
    if (!buyerTrendQuery.data || !comparisonPair.current || !comparisonPair.previous) {
      return null;
    }
    return trendToDateComparison(
      buyerTrendQuery.data,
      comparisonPair.current,
      comparisonPair.previous,
      { topN: 0 } // Get all buyers
    );
  }, [buyerTrendQuery.data, comparisonPair]);

  const largestBuyerIncrease = useMemo(() => {
    if (!buyerComparisonDataset || !buyerComparisonDataset.rows.length) return null;
    const pos = buyerComparisonDataset.rows.filter((r) => r.difference > 0);
    if (!pos.length) return null;
    return [...pos].sort((a, b) => b.difference - a.difference)[0] ?? null;
  }, [buyerComparisonDataset]);

  const largestBuyerReduction = useMemo(() => {
    if (!buyerComparisonDataset || !buyerComparisonDataset.rows.length) return null;
    const neg = buyerComparisonDataset.rows.filter((r) => r.difference < 0);
    if (!neg.length) return null;
    return [...neg].sort((a, b) => a.difference - b.difference)[0] ?? null;
  }, [buyerComparisonDataset]);

  // Insight Callouts: Cap at 3 increases, 3 reductions, and 2 stable units
  const insightCallouts = useMemo(() => {
    if (!unitComparisonDataset) return [];
    const rows = unitComparisonDataset.rows;

    const increases = rows
      .filter((r) => r.difference > 0)
      .sort((a, b) => b.difference - a.difference)
      .slice(0, 3)
      .map(
        (r) =>
          `• ${r.label} backlog increased by ${formatValue(r.difference)} kg (${
            r.differencePercent ? `+${r.differencePercent.toFixed(1)}%` : ""
          })`
      );

    const reductions = rows
      .filter((r) => r.difference < 0)
      .sort((a, b) => a.difference - b.difference)
      .slice(0, 3)
      .map(
        (r) =>
          `• ${r.label} reduced backlog by ${formatValue(Math.abs(r.difference))} kg (${
            r.differencePercent ? `${r.differencePercent.toFixed(1)}%` : ""
          })`
      );

    // Stable units: small absolute percentage change
    const stable = rows
      .filter((r) => r.previousValue > 0 && Math.abs(r.differencePercent ?? 0) <= 3)
      .sort((a, b) => Math.abs(a.differencePercent ?? 0) - Math.abs(b.differencePercent ?? 0))
      .slice(0, 2)
      .map(
        (r) =>
          `• ${r.label} remained stable (changed only ${
            r.differencePercent ? `${r.differencePercent > 0 ? "+" : ""}${r.differencePercent.toFixed(1)}%` : "0%"
          })`
      );

    return [...increases, ...reductions, ...stable];
  }, [unitComparisonDataset]);

  // Movers list calculation has been moved inside UnitExplorer where it is needed.

  // ---------------------------------------------------------------------------
  // Unit Historical Comparison calculations & filters
  // ---------------------------------------------------------------------------
  const unitComparisonDates = useMemo(() => {
    if (unitHistoricalControls.dateScope === "comparison") {
      return effectiveDates;
    }
    return displayDates;
  }, [unitHistoricalControls.dateScope, effectiveDates, displayDates]);

  const comparisonDatesCount = unitComparisonDates.length;

  useEffect(() => {
    if (unitHistoricalControls.userSelectedVizMode !== null) {
      setUnitHistoricalControls(prev => ({
        ...prev,
        vizMode: prev.userSelectedVizMode || "bars"
      }));
    } else {
      setUnitHistoricalControls(prev => ({
        ...prev,
        vizMode: comparisonDatesCount <= 7 ? "bars" : "lines"
      }));
    }
  }, [comparisonDatesCount, unitHistoricalControls.userSelectedVizMode]);

  const allUnitNames = useMemo(() => {
    if (!unitTrendQuery.data) return [];
    const names = new Set<string>();
    for (const point of unitTrendQuery.data.points) {
      if (point.series) {
        names.add(point.series);
      }
    }
    return Array.from(names).sort();
  }, [unitTrendQuery.data]);

  const latestScopeDate = useMemo(() => {
    if (!unitComparisonDates.length) return null;
    return unitComparisonDates[unitComparisonDates.length - 1];
  }, [unitComparisonDates]);

  const rankedUnits = useMemo(() => {
    if (!unitTrendQuery.data || !latestScopeDate) return [];
    const unitValues = new Map<string, number>();
    for (const point of unitTrendQuery.data.points) {
      if (point.report_date === latestScopeDate && point.series) {
        unitValues.set(point.series, (unitValues.get(point.series) ?? 0) + toNumber(point.numeric_total));
      }
    }
    allUnitNames.forEach(name => {
      if (!unitValues.has(name)) {
        unitValues.set(name, 0);
      }
    });
    return Array.from(unitValues.entries())
      .sort((a, b) => b[1] - a[1])
      .map(entry => entry[0]);
  }, [unitTrendQuery.data, latestScopeDate, allUnitNames]);

  const filteredUnitTrend = useMemo(() => {
    if (!unitTrendQuery.data) return undefined;
    const allowedUnits = new Set<string>();
    if (unitHistoricalControls.unitVisibility === "top5") {
      rankedUnits.slice(0, 5).forEach(u => allowedUnits.add(u));
    } else if (unitHistoricalControls.unitVisibility === "top10") {
      rankedUnits.slice(0, 10).forEach(u => allowedUnits.add(u));
    } else {
      allUnitNames.forEach(u => allowedUnits.add(u));
    }
    
    const filteredPoints = unitTrendQuery.data.points.filter(p => p.series && allowedUnits.has(p.series));
    return {
      ...unitTrendQuery.data,
      points: filteredPoints,
    };
  }, [unitTrendQuery.data, unitHistoricalControls.unitVisibility, rankedUnits, allUnitNames]);

  const unitGroupedBarDataset = useMemo(() => {
    if (!filteredUnitTrend) return null;
    return trendToGroupedSeriesByDate(filteredUnitTrend, {
      selectedDates: unitComparisonDates,
    });
  }, [filteredUnitTrend, unitComparisonDates]);

  const unitMultiSeriesDataset = useMemo(() => {
    if (!filteredUnitTrend) return null;
    return trendToMultiSeries(filteredUnitTrend, {
      selectedDates: unitComparisonDates,
    });
  }, [filteredUnitTrend, unitComparisonDates]);

  const unitInsights = useMemo(() => {
    if (!unitTrendQuery.data || unitComparisonDates.length < 2) return null;
    const firstDate = unitComparisonDates[0];
    const lastDate = unitComparisonDates[unitComparisonDates.length - 1];

    const firstValues = new Map<string, number>();
    const lastValues = new Map<string, number>();

    for (const point of unitTrendQuery.data.points) {
      if (!point.series) continue;
      const val = toNumber(point.numeric_total);
      if (point.report_date === firstDate) {
        firstValues.set(point.series, (firstValues.get(point.series) ?? 0) + val);
      } else if (point.report_date === lastDate) {
        lastValues.set(point.series, (lastValues.get(point.series) ?? 0) + val);
      }
    }

    const results: Array<{
      unit: string;
      firstVal: number;
      lastVal: number;
      delta: number;
      pct: number | null;
      presentInBoth: boolean;
    }> = [];

    allUnitNames.forEach(unit => {
      const firstVal = firstValues.get(unit);
      const lastVal = lastValues.get(unit);
      const firstExists = firstVal !== undefined;
      const lastExists = lastVal !== undefined;
      const fVal = firstVal ?? 0;
      const lVal = lastVal ?? 0;
      const delta = lVal - fVal;
      const pct = fVal > 0 ? (delta / fVal) * 100 : null;

      results.push({
        unit,
        firstVal: fVal,
        lastVal: lVal,
        delta,
        pct,
        presentInBoth: firstExists && lastExists,
      });
    });

    const increases = results.filter(r => r.delta > 0).sort((a, b) => b.delta - a.delta);
    const largestIncrease = increases[0] ?? null;

    const reductions = results.filter(r => r.delta < 0).sort((a, b) => a.delta - b.delta);
    const largestReduction = reductions[0] ?? null;

    const stableCandidates = results.filter(r => r.presentInBoth);
    const mostStable = [...stableCandidates].sort((a, b) => {
      const pctA = a.firstVal === 0 ? (a.lastVal === 0 ? 0 : null) : Math.abs(a.pct ?? 0);
      const pctB = b.firstVal === 0 ? (b.lastVal === 0 ? 0 : null) : Math.abs(b.pct ?? 0);

      if (pctA !== null && pctB !== null) {
        if (pctA !== pctB) return pctA - pctB;
      } else if (pctA !== null) {
        return -1;
      } else if (pctB !== null) {
        return 1;
      }
      return Math.abs(a.delta) - Math.abs(b.delta);
    })[0] ?? null;

    return {
      largestIncrease,
      largestReduction,
      mostStable,
      firstDate,
      lastDate,
    };
  }, [unitTrendQuery.data, unitComparisonDates, allUnitNames]);

  const isLoading = groupedTrendQuery.isLoading || dimensionsQuery.isLoading || unitTrendQuery.isLoading;
  const hasData = Boolean(groupedTrend && groupedTrend.points.length);
  const activeReportType = reportTypes.find((rt) => rt.id === state.reportTypeId)?.name ?? "All Report Types";

  const trendExportQuery = queryString({
    metric: state.metric,
    report_type_id: state.reportTypeId || undefined,
    series_by: state.groupDimension,
    date_from: dateWindow.date_from,
    date_to: dateWindow.date_to,
    limit: 365,
  });

  function exportDashboardPdf() {
    const originalTitle = document.title;
    const safeRt = activeReportType.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    const today = new Date().toISOString().split("T")[0];
    
    document.title = `${safeRt}_Dashboard_${today}`;
    document.body.dataset.printTitle = "wf-test-dashboard";
    
    void auditClientExport(
      "dashboard.pdf_export",
      "pdf",
      activeReportType,
      {
        report_type_id: state.reportTypeId,
        metric: state.metric,
        date_range: state.dateRange,
        custom_from: state.customFrom,
        custom_to: state.customTo,
        group_dimension: state.groupDimension,
        current_report_date: state.selectedCurrentDate,
        comparison_report_date: state.selectedComparisonDate,
      }
    );

    window.print();
    window.setTimeout(() => {
      document.title = originalTitle;
      delete document.body.dataset.printTitle;
    }, 1000);
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">
            WF Test &amp; Shade Dashboard
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Date-aware operational analysis. Report dates are compared, never summed.
          </p>
        </div>
        <div className="print-hidden flex flex-wrap gap-2">
          <button
            className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-background px-3 text-sm font-medium text-foreground shadow-sm transition hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!state.metric}
            onClick={() =>
              void downloadBinary(
                `/api/charts/time-series/export.xlsx${trendExportQuery ? `?${trendExportQuery}` : ""}`,
                "wf-test-dashboard-dataset.xlsx",
              )
            }
            type="button"
          >
            <FileSpreadsheet className="size-4" />
            Dataset
          </button>
          <button
            className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-background px-3 text-sm font-medium text-foreground shadow-sm transition hover:bg-secondary"
            onClick={exportDashboardPdf}
            type="button"
          >
            <Printer className="size-4" />
            PDF
          </button>
        </div>
      </div>

      <div className="dashboard-print-area space-y-8" ref={dashboardRef}>
        <div className="hidden print:block border-b border-border pb-4 mb-4">
          <h1 className="text-3xl font-bold text-foreground">
            WF Test &amp; Shade Dashboard
          </h1>
          <div className="mt-4 grid grid-cols-2 gap-x-8 gap-y-2 text-sm text-muted-foreground">
            <div>
              <span className="font-semibold text-foreground">Report Type: </span>
              {activeReportType}
            </div>
            <div>
              <span className="font-semibold text-foreground">Date Range: </span>
              {dateWindow.date_from ?? "Start"} to {dateWindow.date_to ?? "Latest"}
            </div>
            <div>
              <span className="font-semibold text-foreground">Generated: </span>
              {timestamp}
            </div>
            <div>
              <span className="font-semibold text-foreground">User: </span>
              {user?.full_name || user?.email || "System User"}
            </div>
          </div>
          
          <div className="mt-4 border-t border-dashed border-border pt-3 text-xs text-muted-foreground">
            <div className="font-semibold text-foreground mb-1 text-sm">Applied Filters:</div>
            <div className="grid grid-cols-2 gap-x-8 gap-y-1">
              <div><span className="font-medium text-foreground">Metric:</span> {metricLabel}</div>
              <div><span className="font-medium text-foreground">Group Dimension:</span> {groupLabel(dim)}</div>
              <div><span className="font-medium text-foreground">Current Report Date:</span> {state.selectedCurrentDate ? `${formatShortDate(state.selectedCurrentDate)} (${state.selectedCurrentDate})` : "None"}</div>
              <div><span className="font-medium text-foreground">Comparison Report Date:</span> {state.selectedComparisonDate ? `${formatShortDate(state.selectedComparisonDate)} (${state.selectedComparisonDate})` : "None"}</div>
            </div>
          </div>
        </div>

        {/* Phase 1: Global Date Controls */}
        <div className="print-hidden">
          <DashboardControls
            state={state}
            reportTypes={reportTypes}
            metrics={metrics}
            availableDates={availableDates}
            onChange={patch}
          />
        </div>

        {/* Phase 1: Executive Summary */}
        {comparisonPair.current && (
          <div className="rounded-lg border border-border bg-card p-5 grid grid-cols-1 lg:grid-cols-3 gap-6 shadow-sm">
            {/* Overview */}
            <div className="space-y-3.5 lg:col-span-1 lg:border-r lg:border-border/60 lg:pr-6">
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Executive Overview</h3>
              <div className="space-y-2.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground font-medium">Report Type:</span>
                  <span className="font-semibold text-foreground">{activeReportType}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground font-medium">Active Metric:</span>
                  <span className="font-semibold text-foreground">{metricLabel}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground font-medium">Latest Report:</span>
                  <span className="font-semibold text-foreground">{formatShortDate(comparisonPair.current)} ({comparisonPair.current})</span>
                </div>
                {comparisonPair.previous && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground font-medium">Previous Report:</span>
                    <span className="font-semibold text-foreground">{formatShortDate(comparisonPair.previous)} ({comparisonPair.previous})</span>
                  </div>
                )}
                {tStockKpi && (
                  <div className="flex justify-between items-center border-t border-border/40 pt-2 mt-2">
                    <span className="text-muted-foreground font-medium">Total Stock:</span>
                    <div className="text-right">
                      <span className="font-bold text-foreground">{formatValue(tStockKpi.value as number)}</span>
                      {tStockKpi.deltaPercent !== null && tStockKpi.deltaPercent !== undefined && (
                        <span className={`ml-1.5 text-xs font-bold ${tStockKpi.deltaPercent > 0 ? "text-red-500" : "text-green-500"}`}>
                          ({tStockKpi.deltaPercent > 0 ? "+" : ""}{tStockKpi.deltaPercent.toFixed(1)}%)
                        </span>
                      )}
                    </div>
                  </div>
                )}
                {wftKpi && (
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground font-medium">Wait For Test:</span>
                    <div className="text-right">
                      <span className="font-bold text-foreground">{formatValue(wftKpi.value as number)}</span>
                      {wftKpi.delta !== null && wftKpi.delta !== undefined && (
                        <span className={`ml-1.5 text-xs font-bold ${wftKpi.delta > 0 ? "text-red-500" : "text-green-500"}`}>
                          ({wftKpi.delta > 0 ? "+" : ""}{formatValue(wftKpi.delta)})
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Key Drivers Grid */}
            <div className="lg:col-span-2 space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Key Drivers (vs Previous)</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Card 1: Largest Unit Increase */}
                <div className="rounded-lg border border-border bg-card/45 p-3 flex flex-col justify-between shadow-sm">
                  <div className="text-[10px] font-bold uppercase text-muted-foreground">Largest Unit Increase</div>
                  <div className="mt-1 flex items-baseline justify-between gap-2">
                    <span className="font-semibold text-sm text-foreground truncate max-w-[120px]" title={largestContributor?.label ?? "N/A"}>
                      {largestContributor?.label ?? "N/A"}
                    </span>
                    {largestContributor && (
                      <span className="text-xs font-bold text-red-500 bg-red-500/10 px-1.5 py-0.5 rounded">
                        +{formatValue(largestContributor.difference)} kg
                      </span>
                    )}
                  </div>
                </div>

                {/* Card 2: Largest Unit Reduction */}
                <div className="rounded-lg border border-border bg-card/45 p-3 flex flex-col justify-between shadow-sm">
                  <div className="text-[10px] font-bold uppercase text-muted-foreground">Largest Unit Reduction</div>
                  <div className="mt-1 flex items-baseline justify-between gap-2">
                    <span className="font-semibold text-sm text-foreground truncate max-w-[120px]" title={largestReduction?.label ?? "N/A"}>
                      {largestReduction?.label ?? "N/A"}
                    </span>
                    {largestReduction && (
                      <span className="text-xs font-bold text-green-500 bg-green-500/10 px-1.5 py-0.5 rounded">
                        {formatValue(largestReduction.difference)} kg
                      </span>
                    )}
                  </div>
                </div>

                {/* Card 3: Largest Buyer Increase */}
                <div className="rounded-lg border border-border bg-card/45 p-3 flex flex-col justify-between shadow-sm">
                  <div className="text-[10px] font-bold uppercase text-muted-foreground">Largest Buyer Increase</div>
                  <div className="mt-1 flex items-baseline justify-between gap-2">
                    <span className="font-semibold text-sm text-foreground truncate max-w-[120px]" title={largestBuyerIncrease?.label ?? "N/A"}>
                      {largestBuyerIncrease?.label ?? "N/A"}
                    </span>
                    {largestBuyerIncrease && (
                      <span className="text-xs font-bold text-red-500 bg-red-500/10 px-1.5 py-0.5 rounded">
                        +{formatValue(largestBuyerIncrease.difference)} kg
                      </span>
                    )}
                  </div>
                </div>

                {/* Card 4: Largest Buyer Reduction */}
                <div className="rounded-lg border border-border bg-card/45 p-3 flex flex-col justify-between shadow-sm">
                  <div className="text-[10px] font-bold uppercase text-muted-foreground">Largest Buyer Reduction</div>
                  <div className="mt-1 flex items-baseline justify-between gap-2">
                    <span className="font-semibold text-sm text-foreground truncate max-w-[120px]" title={largestBuyerReduction?.label ?? "N/A"}>
                      {largestBuyerReduction?.label ?? "N/A"}
                    </span>
                    {largestBuyerReduction && (
                      <span className="text-xs font-bold text-green-500 bg-green-500/10 px-1.5 py-0.5 rounded">
                        {formatValue(largestBuyerReduction.difference)} kg
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Detailed Insights collapsible view */}
            <div className="lg:col-span-3 border-t border-border/60 pt-3">
              <button
                type="button"
                onClick={() => setInsightsExpanded(!insightsExpanded)}
                className="flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline transition-colors"
              >
                <span>{insightsExpanded ? "Hide Detailed Insights" : "Show Detailed Insights"}</span>
                <span className={`transition-transform duration-200 text-[10px] ${insightsExpanded ? "rotate-180" : ""}`}>
                  ▼
                </span>
              </button>
              {insightsExpanded && (
                <div className="mt-3 rounded-md bg-secondary/20 p-3.5 border border-border/40">
                  {insightCallouts.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic">No key backlog fluctuations detected in this period.</p>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2">
                      {insightCallouts.map((callout, i) => (
                        <div key={`callout-${i}`} className="text-xs text-foreground font-medium leading-relaxed">
                          {callout}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Phase 7: Historical Comparison KPI Cards (selected vs comparison date) */}
        <section>
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-muted-foreground">
            Selected vs Comparison Report Date
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {kpiQuery.isLoading
              ? kpiMetrics.map((m) => <KpiSkeleton key={m.value} />)
              : (kpiQuery.data ?? []).map(({ trend, label }) => (
                  <KpiCard
                    key={label}
                    kpi={trendToLatestKpi(trend, label, {
                      currentDate: state.selectedCurrentDate,
                      previousDate: state.selectedComparisonDate,
                    })}
                    formatValue={(v) =>
                      typeof v === "number" ? formatValue(v) : v
                    }
                    showSparkline
                  />
                ))}
          </div>
        </section>

        {/* Unit Historical Comparison Restoration Section */}
        <section className="rounded-lg border border-border bg-card p-5 shadow-sm space-y-6" data-focus-unit={unitHistoricalControls.focusUnit} data-unit-visibility={unitHistoricalControls.unitVisibility} data-date-scope={unitHistoricalControls.dateScope}>
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/55 pb-3">
            <div>
              <h2 className="text-lg font-semibold text-foreground">Unit Historical Comparison</h2>
              <p className="text-xs text-muted-foreground">
                Compare operational units across report dates.
              </p>
            </div>
            
            {/* Control Panel */}
            <div className="print-hidden flex flex-wrap items-center gap-3 text-xs font-medium">
              {/* Date Scope */}
              <div className="flex items-center gap-1 rounded-md border border-input bg-background p-0.5 shadow-sm">
                <button
                  type="button"
                  onClick={() => setUnitHistoricalControls(prev => ({ ...prev, dateScope: "full" }))}
                  className={`rounded px-2.5 py-1 transition-colors ${
                    unitHistoricalControls.dateScope === "full"
                      ? "bg-secondary text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Trend View
                </button>
                <button
                  type="button"
                  onClick={() => setUnitHistoricalControls(prev => ({ ...prev, dateScope: "comparison" }))}
                  className={`rounded px-2.5 py-1 transition-colors ${
                    unitHistoricalControls.dateScope === "comparison"
                      ? "bg-secondary text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Comparison View
                </button>
              </div>

              {/* Viz Mode */}
              <div className="flex items-center gap-1 rounded-md border border-input bg-background p-0.5 shadow-sm">
                <button
                  type="button"
                  onClick={() => setUnitHistoricalControls(prev => ({ ...prev, vizMode: "bars", userSelectedVizMode: "bars" }))}
                  className={`rounded px-2.5 py-1 transition-colors ${
                    unitHistoricalControls.vizMode === "bars"
                      ? "bg-secondary text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Grouped Bars
                </button>
                <button
                  type="button"
                  onClick={() => setUnitHistoricalControls(prev => ({ ...prev, vizMode: "lines", userSelectedVizMode: "lines" }))}
                  className={`rounded px-2.5 py-1 transition-colors ${
                    unitHistoricalControls.vizMode === "lines"
                      ? "bg-secondary text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Trend Lines
                </button>
              </div>

              {/* Unit Visibility Limit */}
              <div className="flex items-center gap-1 rounded-md border border-input bg-background p-0.5 shadow-sm">
                <button
                  type="button"
                  onClick={() => setUnitHistoricalControls(prev => ({ ...prev, unitVisibility: "all" }))}
                  className={`rounded px-2.5 py-1 transition-colors ${
                    unitHistoricalControls.unitVisibility === "all"
                      ? "bg-secondary text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  All Units
                </button>
                <button
                  type="button"
                  onClick={() => setUnitHistoricalControls(prev => ({ ...prev, unitVisibility: "top5" }))}
                  className={`rounded px-2.5 py-1 transition-colors ${
                    unitHistoricalControls.unitVisibility === "top5"
                      ? "bg-secondary text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Top 5
                </button>
                <button
                  type="button"
                  onClick={() => setUnitHistoricalControls(prev => ({ ...prev, unitVisibility: "top10" }))}
                  className={`rounded px-2.5 py-1 transition-colors ${
                    unitHistoricalControls.unitVisibility === "top10"
                      ? "bg-secondary text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Top 10
                </button>
              </div>

              {/* Focus Unit Dropdown */}
              <div className="flex items-center gap-1.5">
                <span className="text-muted-foreground">Focus:</span>
                <select
                  value={unitHistoricalControls.focusUnit}
                  onChange={(e) => setUnitHistoricalControls(prev => ({ ...prev, focusUnit: e.target.value }))}
                  className="rounded-md border border-input bg-background px-2 py-1 text-xs shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="all">All Units</option>
                  {allUnitNames.map(name => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Executive Insight Cards */}
          {unitInsights && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {/* Largest Increase Card */}
              <div
                onClick={() => unitInsights.largestIncrease && handleUnitClick(unitInsights.largestIncrease.unit)}
                className="cursor-pointer rounded-lg border border-border bg-card p-4 hover:shadow-md transition hover:border-red-500/50 flex flex-col justify-between"
              >
                <div>
                  <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Largest Increase</span>
                  {unitInsights.largestIncrease ? (
                    <div className="mt-1">
                      <div className="text-lg font-bold text-foreground">{unitInsights.largestIncrease.unit}</div>
                      <div className="text-sm font-semibold text-red-600 dark:text-red-400">
                        +{formatValue(unitInsights.largestIncrease.delta)} kg
                        {unitInsights.largestIncrease.pct !== null && (
                          <span className="ml-1 text-xs font-bold">({unitInsights.largestIncrease.pct > 0 ? "+" : ""}{unitInsights.largestIncrease.pct.toFixed(1)}%)</span>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="mt-2 text-xs text-muted-foreground italic">No increases detected</div>
                  )}
                </div>
                <div className="mt-4 text-[10px] font-semibold text-primary/80 hover:text-primary transition flex items-center gap-1">
                  <span>[View Details]</span>
                </div>
              </div>

              {/* Largest Reduction Card */}
              <div
                onClick={() => unitInsights.largestReduction && handleUnitClick(unitInsights.largestReduction.unit)}
                className="cursor-pointer rounded-lg border border-border bg-card p-4 hover:shadow-md transition hover:border-green-500/50 flex flex-col justify-between"
              >
                <div>
                  <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Largest Reduction</span>
                  {unitInsights.largestReduction ? (
                    <div className="mt-1">
                      <div className="text-lg font-bold text-foreground">{unitInsights.largestReduction.unit}</div>
                      <div className="text-sm font-semibold text-green-600 dark:text-green-400">
                        {formatValue(unitInsights.largestReduction.delta)} kg
                        {unitInsights.largestReduction.pct !== null && (
                          <span className="ml-1 text-xs font-bold">({unitInsights.largestReduction.pct.toFixed(1)}%)</span>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="mt-2 text-xs text-muted-foreground italic">No reductions detected</div>
                  )}
                </div>
                <div className="mt-4 text-[10px] font-semibold text-primary/80 hover:text-primary transition flex items-center gap-1">
                  <span>[View Details]</span>
                </div>
              </div>

              {/* Most Stable Card */}
              <div
                onClick={() => unitInsights.mostStable && handleUnitClick(unitInsights.mostStable.unit)}
                className="cursor-pointer rounded-lg border border-border bg-card p-4 hover:shadow-md transition hover:border-blue-500/50 flex flex-col justify-between"
              >
                <div>
                  <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Most Stable</span>
                  {unitInsights.mostStable ? (
                    <div className="mt-1">
                      <div className="text-lg font-bold text-foreground">{unitInsights.mostStable.unit}</div>
                      <div className="text-sm font-semibold text-blue-600 dark:text-blue-400">
                        {unitInsights.mostStable.delta >= 0 ? "+" : ""}{formatValue(unitInsights.mostStable.delta)} kg
                        {unitInsights.mostStable.pct !== null ? (
                          <span className="ml-1 text-xs font-bold">({unitInsights.mostStable.pct >= 0 ? "+" : ""}{unitInsights.mostStable.pct.toFixed(1)}%)</span>
                        ) : (
                          <span className="ml-1 text-xs font-bold">(0.0%)</span>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="mt-2 text-xs text-muted-foreground italic">No stable candidates</div>
                  )}
                </div>
                <div className="mt-4 text-[10px] font-semibold text-primary/80 hover:text-primary transition flex items-center gap-1">
                  <span>[View Details]</span>
                </div>
              </div>
            </div>
          )}

          {/* Chart Rendering */}
          {unitHistoricalControls.vizMode === "bars" ? (
            unitGroupedBarDataset && (
              <GroupedBarChart
                data={unitGroupedBarDataset}
                title={`${metricLabel} Comparison by Unit`}
                formatValue={formatValue}
                focusUnit={unitHistoricalControls.focusUnit}
                onCategoryClick={handleUnitClick}
              />
            )
          ) : (
            unitMultiSeriesDataset && (
              <MultiSeriesTrend
                data={unitMultiSeriesDataset}
                title={`${metricLabel} Trend by Unit`}
                formatValue={formatValue}
                focusUnit={unitHistoricalControls.focusUnit}
                onSeriesClick={handleUnitClick}
              />
            )
          )}
        </section>

        {/* Empty / loading state for the metric-driven charts */}
        {isLoading && <ChartSkeleton label="Loading dashboard..." />}

        {!isLoading && !hasData && (
          <div className="flex h-[300px] items-center justify-center rounded-lg border border-dashed border-border bg-card/50">
            <p className="text-sm text-muted-foreground">
              No operational data for the selected metric and date range.
            </p>
          </div>
        )}

        {!isLoading && hasData && (
          <>
            {/* Phase 2 & 5: Smart Trend Visualization */}
            <section>
              <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-muted-foreground">
                {metricLabel} Trend &amp; Date Comparison by {groupLabel(dim)}
              </h2>
              {displayDates.length < 7 ? (
                groupedBarDataset && (
                  <GroupedBarChart
                    data={groupedBarDataset}
                    title={`${metricLabel} by ${groupLabel(dim)} — Date Comparison (< 7 dates)`}
                    formatValue={formatValue}
                  />
                )
              ) : (
                multiSeriesDataset && (
                  <MultiSeriesTrend
                    data={multiSeriesDataset}
                    title={`${metricLabel} Trend per ${groupLabel(dim)} (>= 7 dates)`}
                    formatValue={formatValue}
                  />
                )
              )}
            </section>

            {/* Unit Explorer Section */}
            <section ref={unitExplorerRef} className="scroll-mt-6">
              <details
                open={unitExplorerExpanded}
                onToggle={(e) => setUnitExplorerExpanded(e.currentTarget.open)}
                className="group rounded-lg border border-border bg-card shadow-sm open:pb-4"
              >
                <summary className="flex cursor-pointer items-center justify-between p-4 font-semibold text-foreground select-none">
                  <div className="flex flex-col">
                    <span className="text-base font-bold">Unit Explorer</span>
                    <span className="text-xs text-muted-foreground font-normal">Detailed investigation of unit performance</span>
                  </div>
                  <span className="ml-4 transition-transform duration-200 group-open:rotate-180 text-muted-foreground">
                    ▼
                  </span>
                </summary>
                <div className="px-4 pt-2 border-t border-border mt-2">
                  <UnitExplorer
                    selectedUnit={explorerUnit}
                    onUnitChange={setExplorerUnit}
                    availableUnits={availableUnits}
                    metric={state.metric}
                    metricLabel={metricLabel}
                    reportTypeId={state.reportTypeId}
                    dateWindow={dateWindow}
                    latestDate={comparisonPair.current!}
                    previousDate={comparisonPair.previous}
                    formatValue={formatValue}
                    onBuyerClick={handleBuyerClick}
                  />
                </div>
              </details>
            </section>

            {/* Buyer Explorer Section */}
            <section ref={buyerExplorerRef} className="scroll-mt-6">
              <details
                open={buyerExplorerExpanded}
                onToggle={(e) => setBuyerExplorerExpanded(e.currentTarget.open)}
                className="group rounded-lg border border-border bg-card shadow-sm open:pb-4"
              >
                <summary className="flex cursor-pointer items-center justify-between p-4 font-semibold text-foreground select-none">
                  <div className="flex flex-col">
                    <span className="text-base font-bold">Buyer Explorer</span>
                    <span className="text-xs text-muted-foreground font-normal">Detailed investigation of buyer performance</span>
                  </div>
                  <span className="ml-4 transition-transform duration-200 group-open:rotate-180 text-muted-foreground">
                    ▼
                  </span>
                </summary>
                <div className="px-4 pt-2 border-t border-border mt-2">
                  <BuyerExplorer
                    selectedBuyer={explorerBuyer}
                    onBuyerChange={setExplorerBuyer}
                    onUnitClick={handleUnitClick}
                    availableBuyers={availableBuyers}
                    metric={state.metric}
                    metricLabel={metricLabel}
                    reportTypeId={state.reportTypeId}
                    dateWindow={dateWindow}
                    latestDate={comparisonPair.current!}
                    previousDate={comparisonPair.previous}
                    formatValue={formatValue}
                  />
                </div>
              </details>
            </section>


            {/* Phase 11: Diagnostics Section */}
            <details className="group rounded-lg border border-border bg-card shadow-sm open:pb-4">
              <summary className="flex cursor-pointer items-center justify-between p-4 font-semibold text-foreground select-none">
                Diagnostics
                <span className="ml-4 transition-transform duration-200 group-open:rotate-180 text-muted-foreground">
                  ▼
                </span>
              </summary>
              <div className="px-4 space-y-8 pt-2 border-t border-border mt-2">
                {/* Phase 5: Stacked Area Trend — composition */}
                <section>
                  <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-muted-foreground">
                    Operational Trend Composition
                  </h2>
                  {multiSeriesDataset && (
                    <StackedAreaTrend
                      data={multiSeriesDataset}
                      title={`${metricLabel} contribution by ${groupLabel(dim).toLowerCase()}`}
                      formatValue={formatValue}
                    />
                  )}
                </section>

                {/* Delta Heatmap (at bottom) */}
                <section>
                  <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-muted-foreground">
                    {groupLabel(dim)} vs Date Delta Heatmap
                  </h2>
                  {heatmapDataset && (
                    <HeatmapChart
                      data={heatmapDataset}
                      title={`${metricLabel} — backlog changes between adjacent report dates`}
                      formatValue={formatValue}
                    />
                  )}
                </section>
              </div>
            </details>
          </>
        )}
      </div>

    </div>
  );
}

// ---------------------------------------------------------------------------
// Skeletons
// ---------------------------------------------------------------------------

function KpiSkeleton() {
  return (
    <div className="animate-pulse rounded-lg border border-border bg-card p-4">
      <div className="h-3 w-20 rounded bg-muted" />
      <div className="mt-2 h-7 w-16 rounded bg-muted" />
    </div>
  );
}

function ChartSkeleton({ label }: { label: string }) {
  return (
    <div className="animate-pulse rounded-lg border border-border bg-card p-4">
      <div className="mb-3 h-4 w-48 rounded bg-muted" />
      <div className="flex h-[300px] items-center justify-center rounded bg-muted/40">
        <span className="text-sm text-muted-foreground">{label}</span>
      </div>
    </div>
  );
}
