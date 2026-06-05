"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileSpreadsheet, Printer, Sliders, CalendarDays, RefreshCw, BarChart3, Database } from "lucide-react";
import { getChartTimeSeries } from "@/lib/charts/api";
import { listReportTypes } from "@/lib/reports/api";
import { useOperationalDimensions, useOperationalAggregation } from "@/lib/reports/operational-hooks";
import { downloadBinary, queryString, auditClientExport } from "@/lib/export/downloads";
import {
  trendToGroupedSeriesByDate,
  trendToMultiSeries,
  trendToDateComparison,
  trendToLatestKpi,
  formatShortDate,
  trendToHeatmap,
  UnitExplorer,
  BuyerExplorer,
  StackedAreaTrend,
  HeatmapChart,
} from "@/components/charts";
import { GroupedBarChart } from "@/components/charts/grouped-bar-chart";
import { MultiSeriesTrend } from "@/components/charts/multi-series-trend";
import { KpiCard } from "@/components/charts/kpi-card";
import type { OperationalTrendResponse, ReportTypeOption } from "@/lib/reports/types";
import type { AuthUser } from "@/lib/auth/types";
import { DashboardControls } from "./dashboard-controls";
import { resolveDateWindow, resolveKpiMetrics, datesInWindow } from "./dashboard-utils";
import { DimensionExplorer } from "@/components/charts/dimension-explorer";

const STALE_TIME = 30_000;
const TOP_N = 8;

function toNumber(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return value;
  const parsed = parseFloat(value);
  return isNaN(parsed) ? 0 : parsed;
}

export function DynamicDashboard({ user }: { user?: AuthUser }) {
  // ---------------------------------------------------------------------------
  // Control state
  // ---------------------------------------------------------------------------
  const [state, setState] = useState<Record<string, string>>({
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

  // Explorers Expanded States
  const [explorerStates, setExplorerStates] = useState<Record<string, boolean>>({
    unit: false,
    sub_unit: false,
    department: false,
    buyer: false,
  });

  // Selected Explorer Values
  const [explorerValues, setExplorerValues] = useState<Record<string, string | null>>({
    unit: null,
    sub_unit: null,
    department: null,
    buyer: null,
  });

  // WF Test & Shade specific states & refs
  const [explorerUnit, setExplorerUnit] = useState<string | null>(null);
  const [explorerBuyer, setExplorerBuyer] = useState<string | null>(null);
  const [unitExplorerExpanded, setUnitExplorerExpanded] = useState(false);
  const [buyerExplorerExpanded, setBuyerExplorerExpanded] = useState(false);
  const [insightsExpanded, setInsightsExpanded] = useState(false);
  const [diagnosticsExpanded, setDiagnosticsExpanded] = useState(false);

  const unitExplorerRef = useRef<HTMLDivElement>(null);
  const buyerExplorerRef = useRef<HTMLDivElement>(null);
  const unitHistoricalRef = useRef<HTMLDivElement>(null);

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

  function patch(p: Partial<typeof state>) {
    setState((prev) => {
      if (p.reportTypeId !== undefined && p.reportTypeId !== prev.reportTypeId) {
        // Clear all previous dimension/filter properties
        const cleared: Record<string, string> = {
          reportTypeId: p.reportTypeId,
          metric: "",
          dateRange: prev.dateRange || "30d",
          customFrom: "",
          customTo: "",
          groupDimension: "unit",
          selectedCurrentDate: "",
          selectedComparisonDate: "",
        };
        // Also clear any dynamic filters from manifest
        if (manifest) {
          manifest.dimensions.forEach((dim) => {
            cleared[dim.key] = "";
          });
        }
        return cleared;
      }

      const next = { ...prev };
      for (const [key, val] of Object.entries(p)) {
        if (val !== undefined) {
          next[key] = val;
        }
      }
      return next;
    });
  }

  // ---------------------------------------------------------------------------
  // Load Report Types & Selected Manifest
  // ---------------------------------------------------------------------------
  const reportTypesQuery = useQuery({
    queryKey: ["report-types"],
    queryFn: listReportTypes,
    staleTime: 60_000,
  });

  const reportTypes = useMemo(() => reportTypesQuery.data?.report_types ?? [], [reportTypesQuery.data]);

  const selectedReportType = useMemo(
    () => reportTypes.find((rt) => rt.id === state.reportTypeId),
    [reportTypes, state.reportTypeId]
  );

  const isWF = selectedReportType?.code.toLowerCase() === "wf_test_and_shade";

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

  const manifest = selectedReportType?.manifest ?? null;
  const dashboardConfig = manifest?.dashboard ?? null;

  // Dimension Flags
  const hasUnitDimension = useMemo(() => manifest?.dimensions.some(d => d.key === "unit") ?? false, [manifest]);
  const hasSubUnitDimension = useMemo(() => manifest?.dimensions.some(d => d.key === "sub_unit") ?? false, [manifest]);
  const hasDepartmentDimension = useMemo(() => manifest?.dimensions.some(d => d.key === "department") ?? false, [manifest]);
  const hasBuyerDimension = useMemo(() => manifest?.dimensions.some(d => d.key === "buyer") ?? false, [manifest]);

  // Cascading Dimension filters mapping
  const cascadingParentKeys = useMemo(() => {
    if (!manifest) return new Set<string>();
    return new Set(
      manifest.dimensions.filter((d) => d.depends_on).map((d) => d.depends_on!)
    );
  }, [manifest]);

  const dimFilters = useMemo(() => {
    const result: Record<string, string> = {};
    cascadingParentKeys.forEach((key) => {
      if (state[key]) result[key] = state[key];
    });
    return Object.keys(result).length > 0 ? result : undefined;
  }, [cascadingParentKeys, state]);

  // Load dimension values dynamically
  const dimensionsQuery = useOperationalDimensions(state.reportTypeId || undefined, dimFilters);
  const metrics = useMemo(() => dimensionsQuery.data?.dimensions?.metric ?? [], [dimensionsQuery.data]);
  const availableDates = useMemo(() => {
    const raw = dimensionsQuery.data?.dates ?? [];
    return raw.map((d) => d.value).sort((a, b) => a.localeCompare(b));
  }, [dimensionsQuery.data]);

  const anchorDate = availableDates.length ? availableDates[availableDates.length - 1] ?? null : null;

  // Initialize metric, dates, and dynamic landing state based on dashboard manifest
  useEffect(() => {
    if (!dashboardConfig || !availableDates.length) return;
    const latest = availableDates[availableDates.length - 1]!;
    const previous = availableDates.length > 1 ? availableDates[availableDates.length - 2]! : "";

    const patchPayload: Partial<typeof state> = {};

    // Dynamic Landing View configurations:
    if (!state.metric && dashboardConfig.primary_metrics?.length) {
      // Metric landing state
      const preferred = isWF ? (dashboardConfig.primary_metrics.find(m => m === "wait_for_test") || dashboardConfig.primary_metrics[0]) : dashboardConfig.primary_metrics[0];
      patchPayload.metric = preferred;
    }
    if (state.groupDimension === "unit" && dashboardConfig.default_group_by) {
      // Default landing groupDimension
      patchPayload.groupDimension = dashboardConfig.default_group_by;
    }
    if (!state.selectedCurrentDate && latest) {
      patchPayload.selectedCurrentDate = latest;
    }
    if (!state.selectedComparisonDate && previous) {
      patchPayload.selectedComparisonDate = previous;
    }

    if (Object.keys(patchPayload).length > 0) {
      patch(patchPayload);
    }
  }, [dashboardConfig, availableDates]);

  // Dynamic filter query params to pass to charts/aggregation
  const dynamicFilterParams = useMemo(() => {
    const params: Record<string, string> = {};
    if (!manifest) return params;
    for (const dim of manifest.dimensions) {
      if (dim.key !== "metric" && state[dim.key]) {
        params[dim.key] = state[dim.key] as string;
      }
    }
    return params;
  }, [manifest, state]);

  // Date range window
  const dateWindow = useMemo(
    () => resolveDateWindow(state.dateRange as any, anchorDate, { from: state.customFrom, to: state.customTo }),
    [state.dateRange, anchorDate, state.customFrom, state.customTo]
  );

  const windowDates = useMemo(() => datesInWindow(availableDates, dateWindow), [availableDates, dateWindow]);

  const effectiveDates = useMemo(() => {
    const dates: string[] = [];
    if (state.selectedComparisonDate) dates.push(state.selectedComparisonDate);
    if (state.selectedCurrentDate) dates.push(state.selectedCurrentDate);
    return dates.sort((a, b) => a.localeCompare(b));
  }, [state.selectedCurrentDate, state.selectedComparisonDate]);

  const comparisonPair = useMemo(
    () => ({ current: state.selectedCurrentDate || null, previous: state.selectedComparisonDate || null }),
    [state.selectedCurrentDate, state.selectedComparisonDate]
  );

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------
  const groupedTrendQuery = useQuery({
    queryKey: ["dashboard", "grouped-trend", state.reportTypeId, state.metric, state.groupDimension, dateWindow, dynamicFilterParams],
    queryFn: () =>
      getChartTimeSeries({
        metric: state.metric as string,
        report_type_id: state.reportTypeId || undefined,
        series_by: state.groupDimension as any,
        date_from: dateWindow.date_from,
        date_to: dateWindow.date_to,
        limit: 365,
        ...dynamicFilterParams,
      }),
    enabled: Boolean(state.metric && state.groupDimension && state.reportTypeId),
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
        metric: state.metric || "",
        report_type_id: state.reportTypeId || undefined,
        series_by: "buyer",
        date_from: dateWindow.date_from,
        date_to: dateWindow.date_to,
        limit: 365,
      }),
    enabled: isWF && Boolean(state.metric),
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
        metric: state.metric || "",
        report_type_id: state.reportTypeId || undefined,
        series_by: "unit",
        date_from: dateWindow.date_from,
        date_to: dateWindow.date_to,
        limit: 365,
      }),
    enabled: isWF && Boolean(state.metric),
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
    enabled: isWF && kpiMetrics.length > 0,
    staleTime: STALE_TIME,
  });

  // Coverage statistics queries (select distinct for Reporting Coverage section)
  const unitsReportingQuery = useOperationalAggregation({
    report_type_id: state.reportTypeId || undefined,
    report_date: state.selectedCurrentDate || undefined,
    group_by: ["unit"],
  }, Boolean(state.reportTypeId && state.selectedCurrentDate && hasUnitDimension));

  const subUnitsReportingQuery = useOperationalAggregation({
    report_type_id: state.reportTypeId || undefined,
    report_date: state.selectedCurrentDate || undefined,
    group_by: ["sub_unit"],
  }, Boolean(state.reportTypeId && state.selectedCurrentDate && hasSubUnitDimension));

  const departmentsReportingQuery = useOperationalAggregation({
    report_type_id: state.reportTypeId || undefined,
    report_date: state.selectedCurrentDate || undefined,
    group_by: ["department"],
  }, Boolean(state.reportTypeId && state.selectedCurrentDate && hasDepartmentDimension));

  const buyersReportingQuery = useOperationalAggregation({
    report_type_id: state.reportTypeId || undefined,
    report_date: state.selectedCurrentDate || undefined,
    group_by: ["buyer"],
  }, Boolean(state.reportTypeId && state.selectedCurrentDate && hasBuyerDimension));

  // Primary Metrics trend queries (to calculate Movers and Executive Summary values)
  const primaryMetricsTrendQueries = useQuery({
    queryKey: ["dashboard", "primary-trends", state.reportTypeId, dashboardConfig?.primary_metrics, dateWindow, dynamicFilterParams],
    queryFn: async () => {
      if (!dashboardConfig?.primary_metrics) return [];
      return Promise.all(
        dashboardConfig.primary_metrics.map((metricKey: string) =>
          getChartTimeSeries({
            metric: metricKey,
            report_type_id: state.reportTypeId || undefined,
            series_by: "unit", // default driver mapping
            date_from: dateWindow.date_from,
            date_to: dateWindow.date_to,
            limit: 365,
            ...dynamicFilterParams,
          }).then(trend => ({ trend, key: metricKey }))
        )
      );
    },
    enabled: Boolean(state.reportTypeId && dashboardConfig?.primary_metrics?.length),
    staleTime: STALE_TIME,
  });

  // Diagnostics: explicit widgets queries for PD Summary
  const diagnosticsPdQtyTrendQuery = useQuery({
    queryKey: ["dashboard", "diagnostics", "pd_qty", state.reportTypeId, dateWindow, dynamicFilterParams],
    queryFn: () => getChartTimeSeries({
      metric: "pd_qty",
      report_type_id: state.reportTypeId || undefined,
      series_by: "unit",
      date_from: dateWindow.date_from,
      date_to: dateWindow.date_to,
      limit: 365,
      ...dynamicFilterParams,
    }),
    enabled: Boolean(state.reportTypeId && selectedReportType?.code.toLowerCase() === "pd_summary"),
    staleTime: STALE_TIME,
  });

  const diagnosticsPdPercentTrendQuery = useQuery({
    queryKey: ["dashboard", "diagnostics", "pd_percent", state.reportTypeId, dateWindow, dynamicFilterParams],
    queryFn: () => getChartTimeSeries({
      metric: "pd_percent",
      report_type_id: state.reportTypeId || undefined,
      series_by: "unit",
      date_from: dateWindow.date_from,
      date_to: dateWindow.date_to,
      limit: 365,
      ...dynamicFilterParams,
    }),
    enabled: Boolean(state.reportTypeId && selectedReportType?.code.toLowerCase() === "pd_summary"),
    staleTime: STALE_TIME,
  });

  const diagnosticsPdQtySubUnitTrendQuery = useQuery({
    queryKey: ["dashboard", "diagnostics", "pd_qty_sub_unit", state.reportTypeId, dateWindow, dynamicFilterParams],
    queryFn: () => getChartTimeSeries({
      metric: "pd_qty",
      report_type_id: state.reportTypeId || undefined,
      series_by: "sub_unit",
      date_from: dateWindow.date_from,
      date_to: dateWindow.date_to,
      limit: 365,
      ...dynamicFilterParams,
    }),
    enabled: Boolean(state.reportTypeId && selectedReportType?.code.toLowerCase() === "pd_summary" && hasSubUnitDimension),
    staleTime: STALE_TIME,
  });

  // ---------------------------------------------------------------------------
  // Calculations
  // ---------------------------------------------------------------------------
  const currentWorkbookSource = useMemo(() => {
    if (!groupedTrendQuery.data || !state.selectedCurrentDate) return null;
    const pt = groupedTrendQuery.data.points.find(p => p.report_date === state.selectedCurrentDate);
    return pt?.workbook_names?.[0] || null;
  }, [groupedTrendQuery.data, state.selectedCurrentDate]);

  const factsLoaded = useMemo(() => {
    if (hasUnitDimension && unitsReportingQuery.data) {
      return unitsReportingQuery.data.totals.fact_count;
    }
    if (hasBuyerDimension && buyersReportingQuery.data) {
      return buyersReportingQuery.data.totals.fact_count;
    }
    return 0;
  }, [hasUnitDimension, unitsReportingQuery.data, hasBuyerDimension, buyersReportingQuery.data]);

  // Dynamic movers calculations
  const topMovers = useMemo(() => {
    const moversList: Array<{
      title: string;
      label: string;
      diff: number;
      pct: number | null;
      metric: string;
      color: "red" | "green";
    }> = [];

    if (!primaryMetricsTrendQueries.data || !comparisonPair.current || !comparisonPair.previous) return moversList;

    for (const { trend, key } of primaryMetricsTrendQueries.data) {
      const comparison = trendToDateComparison(trend, comparisonPair.current, comparisonPair.previous, { topN: 0 });
      if (!comparison || !comparison.rows.length) continue;

      const pos = comparison.rows.filter(r => r.difference > 0);
      const neg = comparison.rows.filter(r => r.difference < 0);

      const isPct = key.toLowerCase().includes("percent") || key.toLowerCase().includes("pct");
      const labelSuffix = isPct ? "%" : "";

      if (isPct) {
        // For PD%, reduction is an "Improvement" (green), increase is a "Decline" (red)
        const largestDecline = pos.length ? [...pos].sort((a, b) => b.difference - a.difference)[0] : null;
        const largestImprovement = neg.length ? [...neg].sort((a, b) => a.difference - b.difference)[0] : null;

        if (largestImprovement) {
          moversList.push({
            title: `Largest PD${labelSuffix} Improvement`,
            label: largestImprovement.label,
            diff: largestImprovement.difference,
            pct: largestImprovement.differencePercent,
            metric: key,
            color: "green",
          });
        }
        if (largestDecline) {
          moversList.push({
            title: `Largest PD${labelSuffix} Decline`,
            label: largestDecline.label,
            diff: largestDecline.difference,
            pct: largestDecline.differencePercent,
            metric: key,
            color: "red",
          });
        }
      } else {
        // Quantitative metrics
        const largestIncrease = pos.length ? [...pos].sort((a, b) => b.difference - a.difference)[0] : null;
        const largestReduction = neg.length ? [...neg].sort((a, b) => a.difference - b.difference)[0] : null;

        if (largestIncrease) {
          moversList.push({
            title: "Largest Increase",
            label: largestIncrease.label,
            diff: largestIncrease.difference,
            pct: largestIncrease.differencePercent,
            metric: key,
            color: "red",
          });
        }
        if (largestReduction) {
          moversList.push({
            title: "Largest Reduction",
            label: largestReduction.label,
            diff: largestReduction.difference,
            pct: largestReduction.differencePercent,
            metric: key,
            color: "green",
          });
        }
      }
    }

    return moversList.slice(0, 4);
  }, [primaryMetricsTrendQueries.data, comparisonPair]);

  // ---------------------------------------------------------------------------
  // Derived datasets for WF
  // ---------------------------------------------------------------------------
  const multiSeriesDataset = useMemo(() => {
    if (!groupedTrendQuery.data) return null;
    return trendToMultiSeries(groupedTrendQuery.data, { selectedDates: windowDates, topN: TOP_N });
  }, [groupedTrendQuery.data, windowDates]);

  const heatmapDataset = useMemo(() => {
    if (!groupedTrendQuery.data) return null;
    return trendToHeatmap(groupedTrendQuery.data, { selectedDates: windowDates, topN: TOP_N });
  }, [groupedTrendQuery.data, windowDates]);

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
          `• ${r.label} backlog increased by ${Math.round(r.difference).toLocaleString()} kg (${
            r.differencePercent ? `+${r.differencePercent.toFixed(1)}%` : ""
          })`
      );

    const reductions = rows
      .filter((r) => r.difference < 0)
      .sort((a, b) => a.difference - b.difference)
      .slice(0, 3)
      .map(
        (r) =>
          `• ${r.label} reduced backlog by ${Math.round(Math.abs(r.difference)).toLocaleString()} kg (${
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

  // ---------------------------------------------------------------------------
  // Unit Historical Comparison calculations & filters
  // ---------------------------------------------------------------------------
  const unitComparisonDates = useMemo(() => {
    if (unitHistoricalControls.dateScope === "comparison") {
      return effectiveDates;
    }
    return windowDates;
  }, [unitHistoricalControls.dateScope, effectiveDates, windowDates]);

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

    // Most Stable = smallest absolute percentage movement.
    const stableCandidates = results.filter(r =>
      r.presentInBoth && (r.firstVal > 0 || r.lastVal === 0)
    );
    const mostStable = [...stableCandidates].sort((a, b) => {
      const absPctA = a.firstVal === 0 ? 0 : Math.abs((a.lastVal - a.firstVal) / a.firstVal) * 100;
      const absPctB = b.firstVal === 0 ? 0 : Math.abs((b.lastVal - b.firstVal) / b.firstVal) * 100;
      if (absPctA !== absPctB) return absPctA - absPctB;
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

  // dynamic dimensions list based on dashboardConfig
  const activeDimensions = useMemo(() => {
    if (!dashboardConfig || !manifest) return [];
    return manifest.dimensions.filter(d => d.key !== "metric" && d.key !== "section" && dashboardConfig.dimensions.includes(d.key));
  }, [dashboardConfig, manifest]);

  const activeReportType = selectedReportType?.name ?? "All Report Types";
  const metricLabel = metrics.find((m: any) => m.value === state.metric)?.label ?? state.metric ?? "";

  const handleCategoryClick = (dimension: string, value: string) => {
    setExplorerValues(prev => ({ ...prev, [dimension]: value }));
    setExplorerStates(prev => ({ ...prev, [dimension]: true }));
    const refEl = document.getElementById(`${dimension}-analysis-section`);
    if (refEl) {
      refEl.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  const trendExportQuery = queryString({
    metric: state.metric,
    report_type_id: state.reportTypeId || undefined,
    series_by: state.groupDimension,
    date_from: dateWindow.date_from,
    date_to: dateWindow.date_to,
    limit: 365,
    ...dynamicFilterParams,
  });

  function exportDashboardPdf() {
    const originalTitle = document.title;
    const safeRt = activeReportType.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    const today = new Date().toISOString().split("T")[0];
    
    document.title = `${safeRt}_Dashboard_${today}`;
    document.body.dataset.printTitle = "qad-dashboard";
    
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

  const isLoading = groupedTrendQuery.isLoading || dimensionsQuery.isLoading || primaryMetricsTrendQueries.isLoading;

  return (
    <div className="space-y-8">
      {/* Dashboard Top Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">
            {activeReportType} Dashboard
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Operational dashboard and key metrics driven by metadata.
          </p>
        </div>
        <div className="print-hidden flex flex-wrap gap-2">
          <button
            className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-background px-3 text-sm font-medium text-foreground shadow-sm transition hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!state.metric}
            onClick={() =>
              void downloadBinary(
                `/api/charts/time-series/export.xlsx${trendExportQuery ? `?${trendExportQuery}` : ""}`,
                "qad-dashboard-dataset.xlsx",
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
        {/* Dynamic Filters Controls */}
        <div className="print-hidden">
          <DashboardControls
            state={state as any}
            reportTypes={reportTypes}
            metrics={metrics}
            availableDates={availableDates}
            onChange={patch}
            manifest={manifest}
            dimensionsData={dimensionsQuery.data}
          />
        </div>

        {/* Placeholder when no report type selected */}
        {!state.reportTypeId && (
          <div className="flex flex-col items-center justify-center border border-dashed border-border rounded-xl bg-card p-12 text-center shadow-sm">
            <Sliders className="size-10 text-muted-foreground/60 mb-3 animate-pulse" />
            <h3 className="text-lg font-bold text-foreground mb-1">Select a Report Type</h3>
            <p className="text-sm text-muted-foreground max-w-sm">
              Please choose a report type from the selection above to view key metrics, trends, and performance analyses.
            </p>
          </div>
        )}

        {/* Manifest Driven Render Pipeline */}
        {state.reportTypeId && dashboardConfig?.sections.map((sectionName: string) => {
          switch (sectionName) {
            case "executive_summary":
              if (isWF) {
                return (
                  comparisonPair.current && (
                    <div key={sectionName} className="rounded-lg border border-border bg-card p-5 grid grid-cols-1 lg:grid-cols-3 gap-6 shadow-sm">
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
                                <span className="font-bold text-foreground">{Math.round(tStockKpi.value as number).toLocaleString()}</span>
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
                                <span className="font-bold text-foreground">{Math.round(wftKpi.value as number).toLocaleString()}</span>
                                {wftKpi.delta !== null && wftKpi.delta !== undefined && (
                                  <span className={`ml-1.5 text-xs font-bold ${wftKpi.delta > 0 ? "text-red-500" : "text-green-500"}`}>
                                    ({wftKpi.delta > 0 ? "+" : ""}{Math.round(wftKpi.delta).toLocaleString()})
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
                          <div
                            className="rounded-lg border border-border bg-card/45 p-3 flex flex-col justify-between shadow-sm cursor-pointer hover:shadow-md transition hover:border-red-500/50"
                            onClick={() => largestContributor && handleUnitClick(largestContributor.key)}
                          >
                            <div className="text-[10px] font-bold uppercase text-muted-foreground">Largest Unit Increase</div>
                            <div className="mt-1 flex items-baseline justify-between gap-2">
                              <span className="font-semibold text-sm text-foreground truncate max-w-[120px]" title={largestContributor?.label ?? "N/A"}>
                                {largestContributor?.label ?? "N/A"}
                              </span>
                              {largestContributor && (
                                <span className="text-xs font-bold text-red-500 bg-red-500/10 px-1.5 py-0.5 rounded">
                                  +{Math.round(largestContributor.difference).toLocaleString()} kg
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Card 2: Largest Unit Reduction */}
                          <div
                            className="rounded-lg border border-border bg-card/45 p-3 flex flex-col justify-between shadow-sm cursor-pointer hover:shadow-md transition hover:border-green-500/50"
                            onClick={() => largestReduction && handleUnitClick(largestReduction.key)}
                          >
                            <div className="text-[10px] font-bold uppercase text-muted-foreground">Largest Unit Reduction</div>
                            <div className="mt-1 flex items-baseline justify-between gap-2">
                              <span className="font-semibold text-sm text-foreground truncate max-w-[120px]" title={largestReduction?.label ?? "N/A"}>
                                {largestReduction?.label ?? "N/A"}
                              </span>
                              {largestReduction && (
                                <span className="text-xs font-bold text-green-500 bg-green-500/10 px-1.5 py-0.5 rounded">
                                  {Math.round(largestReduction.difference).toLocaleString()} kg
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Card 3: Largest Buyer Increase */}
                          <div
                            className="rounded-lg border border-border bg-card/45 p-3 flex flex-col justify-between shadow-sm cursor-pointer hover:shadow-md transition hover:border-red-500/50"
                            onClick={() => largestBuyerIncrease && handleBuyerClick(largestBuyerIncrease.key)}
                          >
                            <div className="text-[10px] font-bold uppercase text-muted-foreground">Largest Buyer Increase</div>
                            <div className="mt-1 flex items-baseline justify-between gap-2">
                              <span className="font-semibold text-sm text-foreground truncate max-w-[120px]" title={largestBuyerIncrease?.label ?? "N/A"}>
                                {largestBuyerIncrease?.label ?? "N/A"}
                              </span>
                              {largestBuyerIncrease && (
                                <span className="text-xs font-bold text-red-500 bg-red-500/10 px-1.5 py-0.5 rounded">
                                  +{Math.round(largestBuyerIncrease.difference).toLocaleString()} kg
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Card 4: Largest Buyer Reduction */}
                          <div
                            className="rounded-lg border border-border bg-card/45 p-3 flex flex-col justify-between shadow-sm cursor-pointer hover:shadow-md transition hover:border-green-500/50"
                            onClick={() => largestBuyerReduction && handleBuyerClick(largestBuyerReduction.key)}
                          >
                            <div className="text-[10px] font-bold uppercase text-muted-foreground">Largest Buyer Reduction</div>
                            <div className="mt-1 flex items-baseline justify-between gap-2">
                              <span className="font-semibold text-sm text-foreground truncate max-w-[120px]" title={largestBuyerReduction?.label ?? "N/A"}>
                                {largestBuyerReduction?.label ?? "N/A"}
                              </span>
                              {largestBuyerReduction && (
                                <span className="text-xs font-bold text-green-500 bg-green-500/10 px-1.5 py-0.5 rounded">
                                  {Math.round(largestBuyerReduction.difference).toLocaleString()} kg
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
                  )
                );
              }
              return (
                <div key={sectionName} className="rounded-lg border border-border bg-card p-5 shadow-sm space-y-4">
                  {/* Executive Overview Top Row */}
                  <div className="flex flex-col md:flex-row justify-between items-start md:items-center border-b border-border/60 pb-4 mb-4 gap-4">
                    <div>
                      <h3 className="text-lg font-bold text-foreground">Executive Overview</h3>
                      <p className="text-xs text-muted-foreground">Immediate business status and reporting coverage.</p>
                    </div>
                    <div className="text-right text-xs space-y-1">
                      <div>
                        <span className="text-muted-foreground font-medium">Latest Report Date: </span>
                        <span className="font-semibold text-foreground">{formatShortDate(comparisonPair.current || "")}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground font-medium">Workbook Source: </span>
                        <span className="font-semibold text-foreground truncate max-w-[200px] inline-block align-bottom" title={currentWorkbookSource || "N/A"}>
                          {currentWorkbookSource || "N/A"}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground font-medium">Facts Loaded: </span>
                        <span className="font-semibold text-foreground">{factsLoaded}</span>
                      </div>
                    </div>
                  </div>

                  {/* Coverage KPIs grid */}
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5 mt-4">
                    {/* Primary Metrics (e.g. PD Qty, PD%) */}
                    {primaryMetricsTrendQueries.data?.map(({ trend, key }: { trend: OperationalTrendResponse; key: string }) => {
                      const kpi = trendToLatestKpi(trend, key === "pd_percent" ? "PD%" : (key === "pd_qty" ? "PD Qty(Kg)" : key), {
                        currentDate: state.selectedCurrentDate,
                        previousDate: state.selectedComparisonDate,
                      });
                      if (!kpi) return null;
                      const isPct = key.toLowerCase().includes("percent") || key.toLowerCase().includes("pct");
                      return (
                        <KpiCard
                          key={key}
                          kpi={kpi}
                          formatValue={(v) => (typeof v === "number" ? (isPct ? `${(v * 100).toFixed(2)}%` : Math.round(v).toLocaleString()) : v)}
                          showSparkline
                        />
                      );
                    })}

                    {/* Reporting Coverage Counts */}
                    {hasUnitDimension && (
                      <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
                        <div className="text-xs font-semibold uppercase text-muted-foreground">Units Reporting</div>
                        <div className="mt-2 text-3xl font-extrabold text-foreground">{unitsReportingQuery.data?.rows.length ?? 0}</div>
                      </div>
                    )}
                    {hasSubUnitDimension && (
                      <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
                        <div className="text-xs font-semibold uppercase text-muted-foreground">Sub Units Reporting</div>
                        <div className="mt-2 text-3xl font-extrabold text-foreground">{subUnitsReportingQuery.data?.rows.length ?? 0}</div>
                      </div>
                    )}
                    {hasDepartmentDimension && (
                      <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
                        <div className="text-xs font-semibold uppercase text-muted-foreground">Departments Reporting</div>
                        <div className="mt-2 text-3xl font-extrabold text-foreground">{departmentsReportingQuery.data?.rows.length ?? 0}</div>
                      </div>
                    )}
                  </div>
                </div>
              );

            case "top_movers":
              if (isWF) return null;
              return (
                <div key={sectionName} className="space-y-3">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Top Movers</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    {topMovers.length === 0 ? (
                      <div className="col-span-4 rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground italic">
                        No movers detected for this period.
                      </div>
                    ) : (
                      topMovers.map((mover, i) => {
                        const isInc = mover.color === "red";
                        const isPct = mover.metric.toLowerCase().includes("percent") || mover.metric.toLowerCase().includes("pct");
                        const valStr = isPct ? `${Math.abs(mover.diff * 100).toFixed(2)}%` : `${Math.round(Math.abs(mover.diff)).toLocaleString()} kg`;
                        return (
                          <div
                            key={i}
                            className={`rounded-lg border border-border bg-card/45 p-4 flex flex-col justify-between shadow-sm cursor-pointer hover:shadow-md transition hover:border-${mover.color}-500/50`}
                            onClick={() => handleCategoryClick("unit", mover.label)}
                          >
                            <div className="text-[10px] font-bold uppercase text-muted-foreground">{mover.title}</div>
                            <div className="mt-2 flex items-baseline justify-between gap-2">
                              <span className="font-semibold text-sm text-foreground truncate max-w-[120px]" title={mover.label}>
                                {mover.label}
                              </span>
                              <span className={`text-xs font-bold ${isInc ? "text-red-500 bg-red-500/10" : "text-green-500 bg-green-500/10"} px-1.5 py-0.5 rounded`}>
                                {isInc ? "+" : "-"}{valStr}
                              </span>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              );

            case "historical_comparison":
              if (isWF) {
                return (
                  <section key={sectionName}>
                    <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-muted-foreground">
                      Selected vs Comparison Report Date
                    </h2>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                      {kpiQuery.isLoading
                        ? kpiMetrics.map((m) => <KpiSkeleton key={m.value} />)
                        : (kpiQuery.data ?? []).map(({ trend, label }) => (
                            <div
                              key={label}
                              className="cursor-pointer hover:shadow-md transition-shadow rounded-lg"
                              onClick={() => {
                                if (unitHistoricalRef.current) {
                                  unitHistoricalRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
                                }
                              }}
                            >
                              <KpiCard
                                kpi={trendToLatestKpi(trend, label, {
                                  currentDate: state.selectedCurrentDate,
                                  previousDate: state.selectedComparisonDate,
                                })}
                                formatValue={(v) =>
                                  typeof v === "number" ? Math.round(v).toLocaleString() : v
                                }
                                showSparkline
                              />
                            </div>
                          ))}
                    </div>
                  </section>
                );
              }
              return (
                <section key={sectionName}>
                  <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-muted-foreground">
                    Selected vs Comparison Report Date
                  </h2>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    {primaryMetricsTrendQueries.data?.map(({ trend, key }: { trend: OperationalTrendResponse; key: string }) => {
                      const kpi = trendToLatestKpi(trend, key === "pd_percent" ? "PD%" : (key === "pd_qty" ? "PD Qty(Kg)" : key), {
                        currentDate: state.selectedCurrentDate,
                        previousDate: state.selectedComparisonDate,
                      });
                      if (!kpi) return null;
                      const isPct = key.toLowerCase().includes("percent") || key.toLowerCase().includes("pct");
                      return (
                        <KpiCard
                          key={key}
                          kpi={kpi}
                          formatValue={(v) => (typeof v === "number" ? (isPct ? `${(v * 100).toFixed(2)}%` : Math.round(v).toLocaleString()) : v)}
                          showSparkline
                        />
                      );
                    })}
                  </div>
                </section>
              );

            case "unit_historical_comparison":
              if (!isWF) return null;
              return (
                <section key={sectionName} ref={unitHistoricalRef} className="scroll-mt-6 rounded-lg border border-border bg-card p-5 shadow-sm space-y-6" data-focus-unit={unitHistoricalControls.focusUnit} data-unit-visibility={unitHistoricalControls.unitVisibility} data-date-scope={unitHistoricalControls.dateScope}>
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
                                +{Math.round(unitInsights.largestIncrease.delta).toLocaleString()} kg
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
                                {Math.round(unitInsights.largestReduction.delta).toLocaleString()} kg
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
                                {unitInsights.mostStable.delta >= 0 ? "+" : ""}{Math.round(unitInsights.mostStable.delta).toLocaleString()} kg
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
                        formatValue={(v) => Math.round(v).toLocaleString()}
                        focusUnit={unitHistoricalControls.focusUnit}
                        onCategoryClick={handleUnitClick}
                      />
                    )
                  ) : (
                    unitMultiSeriesDataset && (
                      <MultiSeriesTrend
                        data={unitMultiSeriesDataset}
                        title={`${metricLabel} Trend by Unit`}
                        formatValue={(v) => Math.round(v).toLocaleString()}
                        focusUnit={unitHistoricalControls.focusUnit}
                        onSeriesClick={handleUnitClick}
                      />
                    )
                  )}
                </section>
              );

            // Render explorers for dimensions specified in manifest:
            case "unit_analysis":
              if (isWF) {
                return (
                  <section key={sectionName} ref={unitExplorerRef} className="scroll-mt-6">
                    <details
                      open={unitExplorerExpanded}
                      className="group rounded-lg border border-border bg-card shadow-sm open:pb-4"
                    >
                      <summary 
                        onClick={(e) => {
                          e.preventDefault();
                          setUnitExplorerExpanded(prev => !prev);
                        }}
                        className="flex cursor-pointer items-center justify-between p-4 font-semibold text-foreground select-none"
                      >
                        <div className="flex flex-col">
                          <span className="text-base font-bold">Unit Explorer</span>
                          <span className="text-xs text-muted-foreground font-normal">Detailed investigation of unit performance</span>
                        </div>
                        <span className="ml-4 transition-transform duration-200 group-open:rotate-180 text-muted-foreground">
                          ▼
                        </span>
                      </summary>
                      <div className="px-4 pt-2 border-t border-border mt-2">
                        {unitExplorerExpanded ? (
                          <UnitExplorer
                            selectedUnit={explorerUnit}
                            onUnitChange={setExplorerUnit}
                            availableUnits={availableUnits}
                            metric={state.metric || ""}
                            metricLabel={metricLabel}
                            reportTypeId={state.reportTypeId || ""}
                            dateWindow={dateWindow}
                            latestDate={comparisonPair.current!}
                            previousDate={comparisonPair.previous}
                            formatValue={(v) => Math.round(v).toLocaleString()}
                            onBuyerClick={handleBuyerClick}
                          />
                        ) : (
                          <div className="flex h-24 items-center justify-center text-sm text-muted-foreground italic">
                            Select a unit to investigate
                          </div>
                        )}
                      </div>
                    </details>
                  </section>
                );
              }
              return hasUnitDimension ? (
                <DimensionExplorerContainer
                  key={sectionName}
                  dimensionKey="unit"
                  dimensionLabel="Unit"
                  contribKey={hasSubUnitDimension ? "sub_unit" : (hasBuyerDimension ? "buyer" : "department")}
                  contribLabel={hasSubUnitDimension ? "Sub Unit" : (hasBuyerDimension ? "Buyer" : "Department")}
                  explorerValues={explorerValues}
                  setExplorerValues={setExplorerValues}
                  availableUnits={dimensionsQuery.data?.dimensions?.unit ?? []}
                  state={state}
                  metricLabel={metricLabel}
                  dateWindow={dateWindow}
                  comparisonPair={comparisonPair}
                  handleCategoryClick={handleCategoryClick}
                />
              ) : null;

            case "sub_unit_analysis":
              return hasSubUnitDimension ? (
                <DimensionExplorerContainer
                  key={sectionName}
                  dimensionKey="sub_unit"
                  dimensionLabel="Sub Unit"
                  contribKey="department"
                  contribLabel="Department"
                  explorerValues={explorerValues}
                  setExplorerValues={setExplorerValues}
                  availableUnits={dimensionsQuery.data?.dimensions?.sub_unit ?? []}
                  state={state}
                  metricLabel={metricLabel}
                  dateWindow={dateWindow}
                  comparisonPair={comparisonPair}
                  handleCategoryClick={handleCategoryClick}
                />
              ) : null;

            case "department_analysis":
              return hasDepartmentDimension ? (
                <DimensionExplorerContainer
                  key={sectionName}
                  dimensionKey="department"
                  dimensionLabel="Department"
                  contribKey="sub_unit"
                  contribLabel="Sub Unit"
                  explorerValues={explorerValues}
                  setExplorerValues={setExplorerValues}
                  availableUnits={dimensionsQuery.data?.dimensions?.department ?? []}
                  state={state}
                  metricLabel={metricLabel}
                  dateWindow={dateWindow}
                  comparisonPair={comparisonPair}
                  handleCategoryClick={handleCategoryClick}
                />
              ) : null;

            case "buyer_analysis":
              if (isWF) {
                return (
                  <section key={sectionName} ref={buyerExplorerRef} className="scroll-mt-6">
                    <details
                      open={buyerExplorerExpanded}
                      className="group rounded-lg border border-border bg-card shadow-sm open:pb-4"
                    >
                      <summary 
                        onClick={(e) => {
                          e.preventDefault();
                          setBuyerExplorerExpanded(prev => !prev);
                        }}
                        className="flex cursor-pointer items-center justify-between p-4 font-semibold text-foreground select-none"
                      >
                        <div className="flex flex-col">
                          <span className="text-base font-bold">Buyer Explorer</span>
                          <span className="text-xs text-muted-foreground font-normal">Detailed investigation of buyer performance</span>
                        </div>
                        <span className="ml-4 transition-transform duration-200 group-open:rotate-180 text-muted-foreground">
                          ▼
                        </span>
                      </summary>
                      <div className="px-4 pt-2 border-t border-border mt-2">
                        {buyerExplorerExpanded ? (
                          <BuyerExplorer
                            selectedBuyer={explorerBuyer}
                            onBuyerChange={setExplorerBuyer}
                            onUnitClick={handleUnitClick}
                            availableBuyers={availableBuyers}
                            metric={state.metric || ""}
                            metricLabel={metricLabel}
                            reportTypeId={state.reportTypeId || ""}
                            dateWindow={dateWindow}
                            latestDate={comparisonPair.current!}
                            previousDate={comparisonPair.previous}
                            formatValue={(v) => Math.round(v).toLocaleString()}
                          />
                        ) : (
                          <div className="flex h-24 items-center justify-center text-sm text-muted-foreground italic">
                            Select a buyer to investigate
                          </div>
                        )}
                      </div>
                    </details>
                  </section>
                );
              }
              return hasBuyerDimension ? (
                <DimensionExplorerContainer
                  key={sectionName}
                  dimensionKey="buyer"
                  dimensionLabel="Buyer"
                  contribKey="unit"
                  contribLabel="Unit"
                  explorerValues={explorerValues}
                  setExplorerValues={setExplorerValues}
                  availableUnits={dimensionsQuery.data?.dimensions?.buyer ?? []}
                  state={state}
                  metricLabel={metricLabel}
                  dateWindow={dateWindow}
                  comparisonPair={comparisonPair}
                  handleCategoryClick={handleCategoryClick}
                />
              ) : null;

            case "diagnostics":
              if (isWF) {
                return (
                  <details 
                    open={diagnosticsExpanded}
                    className="group rounded-lg border border-border bg-card shadow-sm open:pb-4"
                  >
                    <summary 
                      onClick={(e) => {
                        e.preventDefault();
                        setDiagnosticsExpanded(prev => !prev);
                      }}
                      className="flex cursor-pointer items-center justify-between p-4 font-semibold text-foreground select-none"
                    >
                      Diagnostics
                      <span className="ml-4 transition-transform duration-200 group-open:rotate-180 text-muted-foreground">
                        ▼
                      </span>
                    </summary>
                    <div className="px-4 space-y-8 pt-2 border-t border-border mt-2">
                      {/* Operational Trend Composition */}
                      <section>
                        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-muted-foreground">
                          Operational Trend Composition
                        </h2>
                        {multiSeriesDataset && (
                          <StackedAreaTrend
                            data={multiSeriesDataset}
                            title={`${metricLabel} contribution by unit`}
                            formatValue={(v) => Math.round(v).toLocaleString()}
                          />
                        )}
                      </section>

                      {/* Delta Heatmap (at bottom) */}
                      <section>
                        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-muted-foreground">
                          Unit vs Date Delta Heatmap
                        </h2>
                        {heatmapDataset && (
                          <HeatmapChart
                            data={heatmapDataset}
                            title={`${metricLabel} — backlog changes between adjacent report dates`}
                            formatValue={(v) => Math.round(v).toLocaleString()}
                          />
                        )}
                      </section>
                    </div>
                  </details>
                );
              }
              return (
                 <details 
                   open={diagnosticsExpanded}
                   className="group rounded-lg border border-border bg-card shadow-sm open:pb-4"
                 >
                   <summary 
                     onClick={(e) => {
                       e.preventDefault();
                       setDiagnosticsExpanded(prev => !prev);
                     }}
                     className="flex cursor-pointer items-center justify-between p-4 font-semibold text-foreground select-none"
                   >
                     Diagnostics Section
                     <span className="ml-4 transition-transform duration-200 group-open:rotate-180 text-muted-foreground">
                       ▼
                     </span>
                   </summary>
                  <div className="px-4 space-y-8 pt-2 border-t border-border mt-2">
                    {selectedReportType?.code.toLowerCase() === "pd_summary" ? (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* PD Qty Trend Line */}
                        <div className="rounded-lg border border-border bg-card p-4">
                          <h4 className="text-sm font-semibold mb-3">PD Qty Trend Line</h4>
                          {diagnosticsPdQtyTrendQuery.data && (
                            <MultiSeriesTrend
                              data={trendToMultiSeries(diagnosticsPdQtyTrendQuery.data)}
                              title=""
                              formatValue={(v) => Math.round(v).toLocaleString() + " kg"}
                            />
                          )}
                        </div>

                        {/* PD% Trend Line */}
                        <div className="rounded-lg border border-border bg-card p-4">
                          <h4 className="text-sm font-semibold mb-3">PD% Trend Line</h4>
                          {diagnosticsPdPercentTrendQuery.data && (
                            <MultiSeriesTrend
                              data={trendToMultiSeries(diagnosticsPdPercentTrendQuery.data)}
                              title=""
                              formatValue={(v) => (v * 100).toFixed(2) + "%"}
                            />
                          )}
                        </div>

                        {/* PD Qty By Unit */}
                        <div className="rounded-lg border border-border bg-card p-4">
                          <h4 className="text-sm font-semibold mb-3">PD Qty by Unit</h4>
                          {diagnosticsPdQtyTrendQuery.data && (
                            <GroupedBarChart
                              data={trendToGroupedSeriesByDate(diagnosticsPdQtyTrendQuery.data, { selectedDates: effectiveDates })}
                              title=""
                              formatValue={(v) => Math.round(v).toLocaleString() + " kg"}
                            />
                          )}
                        </div>

                        {/* PD Qty By Sub Unit */}
                        <div className="rounded-lg border border-border bg-card p-4">
                          <h4 className="text-sm font-semibold mb-3">PD Qty by Sub Unit</h4>
                          {diagnosticsPdQtySubUnitTrendQuery.data && (
                            <GroupedBarChart
                              data={trendToGroupedSeriesByDate(diagnosticsPdQtySubUnitTrendQuery.data, { selectedDates: effectiveDates })}
                              title=""
                              formatValue={(v) => Math.round(v).toLocaleString() + " kg"}
                            />
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="flex h-24 items-center justify-center text-sm text-muted-foreground italic">
                        Diagnostics widgets are custom tailored for PD Summary.
                      </div>
                    )}
                  </div>
                </details>
              );

            default:
              return null;
          }
        })}
      </div>
    </div>
  );
}

// Explorer Container helper component to manage dimension explorers directly without collapse
function DimensionExplorerContainer({
  dimensionKey,
  dimensionLabel,
  contribKey,
  contribLabel,
  explorerValues,
  setExplorerValues,
  availableUnits,
  state,
  metricLabel,
  dateWindow,
  comparisonPair,
  handleCategoryClick,
}: {
  dimensionKey: string;
  dimensionLabel: string;
  contribKey: string;
  contribLabel: string;
  explorerValues: Record<string, string | null>;
  setExplorerValues: React.Dispatch<React.SetStateAction<Record<string, string | null>>>;
  availableUnits: any[];
  state: any;
  metricLabel: string;
  dateWindow: any;
  comparisonPair: any;
  handleCategoryClick: (dim: string, val: string) => void;
}) {
  return (
    <section id={`${dimensionKey}-analysis-section`} className="scroll-mt-6 rounded-lg border border-border bg-card shadow-sm p-4 space-y-4">
      <div className="flex flex-col">
        <span className="text-base font-bold">{dimensionLabel} Analysis</span>
        <span className="text-xs text-muted-foreground font-normal">Compare and analyze {dimensionLabel.toLowerCase()} performance</span>
      </div>
      <div className="border-t border-border pt-4">
        <DimensionExplorer
          dimensionKey={dimensionKey}
          dimensionLabel={dimensionLabel}
          contributionDimensionKey={contribKey}
          contributionDimensionLabel={contribLabel}
          selectedVal={explorerValues[dimensionKey] ?? null}
          onValChange={(v) => setExplorerValues(prev => ({ ...prev, [dimensionKey]: v }))}
          availableVals={availableUnits}
          metric={state.metric}
          metricLabel={metricLabel}
          reportTypeId={state.reportTypeId}
          dateWindow={dateWindow}
          latestDate={comparisonPair.current!}
          previousDate={comparisonPair.previous}
          onCategoryClick={handleCategoryClick}
        />
      </div>
    </section>
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
