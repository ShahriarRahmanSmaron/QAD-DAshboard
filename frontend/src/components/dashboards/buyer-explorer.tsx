"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  AreaChart,
  Area,
} from "recharts";
import { Search, BarChart2, TrendingUp, ArrowUpRight, ArrowDownRight, RefreshCw, X, Table } from "lucide-react";
import {
  getBuyerHistory,
  getBuyerPresence,
  getBuyerContribution,
  getBuyerContributionTrend,
  getBuyerUnitDrilldown,
  getBuyerComparison,
  getBuyerInsights,
  getBuyerRankingTrend,
} from "@/lib/reports/api";
import { ChartTooltip } from "@/components/charts/chart-tooltip";
import { useChartTheme } from "@/components/charts/use-chart-theme";
import { ChartExportButtons } from "@/components/charts/export-buttons";

type DateRangePreset = "7d" | "14d" | "30d" | "90d" | "all";

type BuyerExplorerProps = {
  initialBuyer?: string;
  availableBuyers: { value: string; label: string }[];
  availableMetrics: { value: string; label: string }[];
  availableDates: string[];
  onBuyerChange?: (buyer: string) => void;
};

export function BuyerExplorer({
  initialBuyer = "",
  availableBuyers = [],
  availableMetrics = [],
  availableDates = [],
  onBuyerChange,
}: BuyerExplorerProps) {
  const { theme, getColor } = useChartTheme();

  // ---------------------------------------------------------------------------
  // Filters & Settings State
  // ---------------------------------------------------------------------------
  const [selectedBuyer, setSelectedBuyer] = useState(initialBuyer);
  const [buyerSearchInput, setBuyerSearchInput] = useState(initialBuyer);
  const [showBuyerDropdown, setShowBuyerDropdown] = useState(false);
  const [selectedMetric, setSelectedMetric] = useState("");
  const [dateRange, setDateRange] = useState<DateRangePreset>("all");
  const [viewMode, setViewMode] = useState<"trend" | "comparison">("trend");
  const [selectedDateA, setSelectedDateA] = useState("");
  const [selectedDateB, setSelectedDateB] = useState("");
  const [drilldownUnit, setDrilldownUnit] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Synchronize initial buyer from parent/cross-navigation
  useEffect(() => {
    if (initialBuyer) {
      setSelectedBuyer(initialBuyer);
      setBuyerSearchInput(initialBuyer);
    }
  }, [initialBuyer]);

  // Set default metric and dates when loaded
  useEffect(() => {
    if (availableMetrics.length && !selectedMetric) {
      const preferred = availableMetrics.find((m) => m.value === "wait_for_test") ?? availableMetrics[0];
      if (preferred) setSelectedMetric(preferred.value);
    }
  }, [availableMetrics, selectedMetric]);

  useEffect(() => {
    if (availableDates.length) {
      const latest = availableDates[availableDates.length - 1];
      const previous = availableDates.length > 1 ? availableDates[availableDates.length - 2] : "";
      if (latest && !selectedDateB) setSelectedDateB(latest);
      if (previous && !selectedDateA) setSelectedDateA(previous);
    }
  }, [availableDates, selectedDateA, selectedDateB]);

  // Handle outside click to close autocomplete dropdown
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowBuyerDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Filter buyers for autocomplete dropdown
  const filteredBuyers = useMemo(() => {
    if (!buyerSearchInput.trim()) return availableBuyers;
    const needle = buyerSearchInput.toLowerCase();
    return availableBuyers.filter(
      (b) => b.label.toLowerCase().includes(needle) || b.value.toLowerCase().includes(needle)
    );
  }, [availableBuyers, buyerSearchInput]);

  // Resolve active dates range window
  const activeDateWindow = useMemo(() => {
    if (dateRange === "all" || !availableDates.length) {
      return { from: undefined, to: undefined };
    }
    const latestDateStr = availableDates[availableDates.length - 1];
    if (!latestDateStr) return { from: undefined, to: undefined };
    const latestDate = new Date(latestDateStr);

    let daysToSubtract = 30;
    if (dateRange === "7d") daysToSubtract = 7;
    else if (dateRange === "14d") daysToSubtract = 14;
    else if (dateRange === "90d") daysToSubtract = 90;

    const fromDate = new Date(latestDate);
    fromDate.setDate(fromDate.getDate() - daysToSubtract);

    return {
      from: fromDate.toISOString().split("T")[0],
      to: latestDateStr,
    };
  }, [dateRange, availableDates]);

  const dateFromParam = dateRange === "all" ? undefined : activeDateWindow.from;
  const dateToParam = dateRange === "all" ? undefined : activeDateWindow.to;

  // ---------------------------------------------------------------------------
  // Data Queries
  // ---------------------------------------------------------------------------
  const isEnabled = Boolean(selectedBuyer && selectedMetric);

  const historyQuery = useQuery({
    queryKey: ["buyer-history", selectedBuyer, selectedMetric, dateRange, activeDateWindow],
    queryFn: () => getBuyerHistory({
      buyer: selectedBuyer,
      metric: selectedMetric,
      date_from: dateFromParam,
      date_to: dateToParam,
    }),
    enabled: isEnabled,
  });

  const presenceQuery = useQuery({
    queryKey: ["buyer-presence", selectedBuyer, dateRange, activeDateWindow],
    queryFn: () => getBuyerPresence({
      buyer: selectedBuyer,
      date_from: dateFromParam,
      date_to: dateToParam,
    }),
    enabled: Boolean(selectedBuyer),
  });

  const contributionQuery = useQuery({
    queryKey: ["buyer-contribution", selectedBuyer, selectedMetric, selectedDateB],
    queryFn: () => getBuyerContribution({
      buyer: selectedBuyer,
      metric: selectedMetric,
      target_date: selectedDateB || undefined,
    }),
    enabled: isEnabled,
  });

  const contributionTrendQuery = useQuery({
    queryKey: ["buyer-contribution-trend", selectedBuyer, selectedMetric, dateRange, activeDateWindow],
    queryFn: () => getBuyerContributionTrend({
      buyer: selectedBuyer,
      metric: selectedMetric,
      date_from: dateFromParam,
      date_to: dateToParam,
    }),
    enabled: isEnabled,
  });

  const drilldownQuery = useQuery({
    queryKey: ["buyer-unit-drilldown", selectedBuyer, drilldownUnit, selectedMetric, dateRange, activeDateWindow],
    queryFn: () => getBuyerUnitDrilldown({
      buyer: selectedBuyer,
      unit: drilldownUnit || "",
      metric: selectedMetric,
      date_from: dateFromParam,
      date_to: dateToParam,
    }),
    enabled: isEnabled && Boolean(drilldownUnit),
  });

  const comparisonQuery = useQuery({
    queryKey: ["buyer-comparison", selectedBuyer, selectedMetric, selectedDateA, selectedDateB],
    queryFn: () => getBuyerComparison({
      buyer: selectedBuyer,
      metric: selectedMetric,
      date_a: selectedDateA,
      date_b: selectedDateB,
    }),
    enabled: isEnabled && viewMode === "comparison" && Boolean(selectedDateA && selectedDateB),
  });

  const insightsQuery = useQuery({
    queryKey: ["buyer-insights", selectedBuyer, selectedMetric, dateRange, activeDateWindow],
    queryFn: () => getBuyerInsights({
      buyer: selectedBuyer,
      metric: selectedMetric,
      date_from: dateFromParam,
      date_to: dateToParam,
    }),
    enabled: isEnabled,
  });

  const rankingQuery = useQuery({
    queryKey: ["buyer-ranking-trend", selectedBuyer, selectedMetric, dateRange, activeDateWindow],
    queryFn: () => getBuyerRankingTrend({
      buyer: selectedBuyer,
      metric: selectedMetric,
      date_from: dateFromParam,
      date_to: dateToParam,
    }),
    enabled: isEnabled,
  });

  // Reformat contribution trend for AreaChart (recharts needs points like {date, CCL-A: 50, HTL-02: 70})
  const areaTrendData = useMemo(() => {
    if (!contributionTrendQuery.data) return { points: [], keys: [] };
    const trendMap: Record<string, Record<string, number>> = {};
    const units = new Set<string>();

    for (const pt of contributionTrendQuery.data) {
      if (!trendMap[pt.date]) {
        trendMap[pt.date] = {};
      }
      const dayData = trendMap[pt.date];
      if (dayData) {
        dayData[pt.unit] = pt.value;
      }
      units.add(pt.unit);
    }

    const points = Object.entries(trendMap)
      .map(([dateKey, unitVals]) => ({
        date: dateKey,
        ...unitVals,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return {
      points,
      keys: Array.from(units),
    };
  }, [contributionTrendQuery.data]);

  const selectClass =
    "w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary";

  const showDrilldown = drilldownUnit && drilldownQuery.data;

  return (
    <div id="buyer-explorer-section" ref={containerRef} className="space-y-6 rounded-xl border border-border bg-card p-6 shadow-sm">
      {/* -------------------------------------------------------------------------
          FILTER HEADER
          ------------------------------------------------------------------------- */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/60 pb-5">
        <div className="space-y-1">
          <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
            <BarChart2 className="size-5 text-primary" />
            Buyer Explorer
          </h2>
          <p className="text-xs text-muted-foreground">
            True historical trend, rankings, unit composition, &amp; date comparisons.
          </p>
        </div>

        {/* View Mode Toggle */}
        <div className="flex items-center rounded-md border border-border p-1 bg-muted/40">
          <button
            onClick={() => setViewMode("trend")}
            className={`rounded px-3 py-1.5 text-xs font-semibold transition ${
              viewMode === "trend" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Trend Mode
          </button>
          <button
            onClick={() => setViewMode("comparison")}
            className={`rounded px-3 py-1.5 text-xs font-semibold transition ${
              viewMode === "comparison" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Comparison Mode
          </button>
        </div>
      </div>

      {/* Control Grid */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-4 lg:grid-cols-5">
        {/* Buyer Autocomplete Search */}
        <div ref={dropdownRef} className="relative space-y-1.5">
          <label className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
            <Search className="size-3.5" /> Search Buyer
          </label>
          <div className="relative">
            <input
              type="text"
              placeholder="Type to search buyer..."
              value={buyerSearchInput}
              onChange={(e) => {
                setBuyerSearchInput(e.target.value);
                setShowBuyerDropdown(true);
              }}
              onFocus={() => setShowBuyerDropdown(true)}
              className={selectClass}
            />
            {buyerSearchInput && (
              <button
                onClick={() => {
                  setBuyerSearchInput("");
                  setSelectedBuyer("");
                  onBuyerChange?.("");
                }}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            )}
          </div>
          {showBuyerDropdown && (
            <div className="absolute z-50 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-border bg-popover text-popover-foreground shadow-lg">
              {filteredBuyers.length === 0 ? (
                <div className="px-3 py-2 text-xs text-muted-foreground italic">No buyers found</div>
              ) : (
                filteredBuyers.map((b) => (
                  <button
                    key={b.value}
                    onClick={() => {
                      setSelectedBuyer(b.value);
                      setBuyerSearchInput(b.label);
                      setShowBuyerDropdown(false);
                      onBuyerChange?.(b.value);
                    }}
                    className={`w-full px-3 py-2 text-left text-xs hover:bg-accent hover:text-accent-foreground ${
                      selectedBuyer === b.value ? "bg-accent/40 font-semibold" : ""
                    }`}
                  >
                    {b.label}
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        {/* Metric */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-muted-foreground">Metric</label>
          <select
            value={selectedMetric}
            onChange={(e) => setSelectedMetric(e.target.value)}
            className={selectClass}
          >
            {availableMetrics.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>

        {/* Date Range */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-muted-foreground">Date Range preset</label>
          <select
            value={dateRange}
            onChange={(e) => setDateRange(e.target.value as DateRangePreset)}
            className={selectClass}
          >
            <option value="all">All Available Reports</option>
            <option value="7d">Last 7 Days</option>
            <option value="14d">Last 14 Days</option>
            <option value="30d">Last 30 Days</option>
            <option value="90d">Last 90 Days</option>
          </select>
        </div>

        {/* Dynamic comparison date pickers */}
        {viewMode === "comparison" && (
          <>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground">Date A (Previous)</label>
              <select
                value={selectedDateA}
                onChange={(e) => setSelectedDateA(e.target.value)}
                className={selectClass}
              >
                {availableDates.map((date) => (
                  <option key={`buyer-comp-a-${date}`} value={date}>
                    {date}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground">Date B (Current)</label>
              <select
                value={selectedDateB}
                onChange={(e) => setSelectedDateB(e.target.value)}
                className={selectClass}
              >
                {availableDates.map((date) => (
                  <option key={`buyer-comp-b-${date}`} value={date}>
                    {date}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}
      </div>

      {!selectedBuyer && (
        <div className="flex h-[320px] flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/10 p-6 text-center">
          <Search className="size-8 text-muted-foreground/60 mb-2" />
          <p className="text-sm font-semibold text-foreground">No Buyer Selected</p>
          <p className="text-xs text-muted-foreground mt-1 max-w-xs">
            Search and select a buyer above to unlock chronological trends, rankings, and presence diagnostics.
          </p>
        </div>
      )}

      {selectedBuyer && (
        <div className="space-y-6">
          {/* -------------------------------------------------------------------------
              COMPARISON MODE CARD (IF VIEWING COMPARISONS)
              ------------------------------------------------------------------------- */}
          {viewMode === "comparison" && comparisonQuery.data && (
            <div className="rounded-lg border border-border/80 bg-accent/10 p-5 shadow-inner">
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-1.5">
                <RefreshCw className="size-3.5 text-primary" />
                Date Comparison Overview
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="space-y-1">
                  <span className="text-xs text-muted-foreground font-medium">Previous ({selectedDateA})</span>
                  <div className="text-xl font-bold text-foreground">
                    {comparisonQuery.data.previous_value.toLocaleString()} <span className="text-xs text-muted-foreground">kg</span>
                  </div>
                </div>
                <div className="space-y-1">
                  <span className="text-xs text-muted-foreground font-medium">Current ({selectedDateB})</span>
                  <div className="text-xl font-bold text-foreground">
                    {comparisonQuery.data.current_value.toLocaleString()} <span className="text-xs text-muted-foreground">kg</span>
                  </div>
                </div>
                <div className="space-y-1">
                  <span className="text-xs text-muted-foreground font-medium">Delta Absolute</span>
                  <div className={`text-xl font-bold flex items-center gap-1 ${
                    comparisonQuery.data.delta > 0 ? "text-red-500" : comparisonQuery.data.delta < 0 ? "text-green-500" : "text-foreground"
                  }`}>
                    {comparisonQuery.data.delta > 0 ? <ArrowUpRight className="size-5" /> : comparisonQuery.data.delta < 0 ? <ArrowDownRight className="size-5" /> : null}
                    {comparisonQuery.data.delta > 0 ? "+" : ""}{comparisonQuery.data.delta.toLocaleString()}
                  </div>
                </div>
                <div className="space-y-1">
                  <span className="text-xs text-muted-foreground font-medium">Percentage Change</span>
                  <div className={`text-xl font-bold ${
                    comparisonQuery.data.delta > 0 ? "text-red-500" : comparisonQuery.data.delta < 0 ? "text-green-500" : "text-foreground"
                  }`}>
                    {comparisonQuery.data.percent_change !== null
                      ? `${comparisonQuery.data.percent_change > 0 ? "+" : ""}${comparisonQuery.data.percent_change.toFixed(1)}%`
                      : "—"}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* -------------------------------------------------------------------------
              KPI STATS / INSIGHTS CARD
              ------------------------------------------------------------------------- */}
          {insightsQuery.data && (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
                <span className="text-xs text-muted-foreground font-medium">Largest Single Increase</span>
                <div className="mt-1">
                  {insightsQuery.data.largest_increase ? (
                    <>
                      <div className="text-lg font-bold text-red-500">
                        +{insightsQuery.data.largest_increase.delta.toLocaleString()} <span className="text-xs font-medium">kg</span>
                      </div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">
                        {insightsQuery.data.largest_increase.date_from} → {insightsQuery.data.largest_increase.date_to}
                      </div>
                    </>
                  ) : (
                    <div className="text-sm font-semibold text-muted-foreground italic">None detected</div>
                  )}
                </div>
              </div>

              <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
                <span className="text-xs text-muted-foreground font-medium">Largest Single Reduction</span>
                <div className="mt-1">
                  {insightsQuery.data.largest_reduction ? (
                    <>
                      <div className="text-lg font-bold text-green-500">
                        {insightsQuery.data.largest_reduction.delta.toLocaleString()} <span className="text-xs font-medium">kg</span>
                      </div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">
                        {insightsQuery.data.largest_reduction.date_from} → {insightsQuery.data.largest_reduction.date_to}
                      </div>
                    </>
                  ) : (
                    <div className="text-sm font-semibold text-muted-foreground italic">None detected</div>
                  )}
                </div>
              </div>

              <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
                <span className="text-xs text-muted-foreground font-medium">Fastest Growth Rate %</span>
                <div className="mt-1">
                  {insightsQuery.data.fastest_growth_pct ? (
                    <>
                      <div className="text-lg font-bold text-red-500">
                        +{insightsQuery.data.fastest_growth_pct.pct.toFixed(1)}%
                      </div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">
                        {insightsQuery.data.fastest_growth_pct.date_from} → {insightsQuery.data.fastest_growth_pct.date_to}
                      </div>
                    </>
                  ) : (
                    <div className="text-sm font-semibold text-muted-foreground italic">None detected</div>
                  )}
                </div>
              </div>

              <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
                <span className="text-xs text-muted-foreground font-medium">Most Stable Period</span>
                <div className="mt-1">
                  {insightsQuery.data.most_stable_period ? (
                    <>
                      <div className="text-lg font-bold text-foreground">
                        Δ {insightsQuery.data.most_stable_period.delta_abs.toLocaleString()} <span className="text-xs font-medium text-muted-foreground">kg</span>
                      </div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">
                        {insightsQuery.data.most_stable_period.date_from} → {insightsQuery.data.most_stable_period.date_to}
                      </div>
                    </>
                  ) : (
                    <div className="text-sm font-semibold text-muted-foreground italic">None detected</div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* -------------------------------------------------------------------------
              PRESENCE MATRIX / AVAILABILITY INDICATOR
              ------------------------------------------------------------------------- */}
          {presenceQuery.data && (
            <div className="rounded-lg border border-border bg-card p-4 shadow-sm space-y-2.5">
              <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Buyer Presence Matrix</h4>
              <div className="flex flex-wrap gap-2.5">
                {presenceQuery.data.map((p) => (
                  <div
                    key={`presence-${p.date}`}
                    className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-semibold ${
                      p.is_present
                        ? "bg-green-500/10 border-green-500/30 text-green-700 dark:text-green-400"
                        : "bg-red-500/10 border-red-500/30 text-red-700 dark:text-red-400"
                    }`}
                  >
                    <span>{p.date}</span>
                    <span className="h-1.5 w-1.5 rounded-full bg-current" />
                    <span>{p.is_present ? "Available" : "No Data"}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* -------------------------------------------------------------------------
              MAIN VISUALIZATION LAYOUT
              ------------------------------------------------------------------------- */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* Buyer Trend Chart */}
            <div className="rounded-lg border border-border bg-card p-4 shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <h3 className="text-sm font-bold text-foreground">Buyer Trend Chart</h3>
                  <p className="text-[10px] text-muted-foreground">Chronological metric history over time.</p>
                </div>
                <ChartExportButtons containerRef={containerRef} filename={`${selectedBuyer}_${selectedMetric}_Trend`} />
              </div>
              <div className="h-64 w-full">
                {historyQuery.data && historyQuery.data.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={historyQuery.data} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={theme.gridColor} />
                      <XAxis dataKey="date" tick={{ fill: theme.axisLabelColor, fontSize: 10 }} tickLine={false} />
                      <YAxis tick={{ fill: theme.axisLabelColor, fontSize: 10 }} tickLine={false} />
                      <Tooltip content={<ChartTooltip />} />
                      <Line type="monotone" dataKey="value" stroke={getColor(0)} strokeWidth={2.5} dot={{ r: 4 }} activeDot={{ r: 6 }} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full items-center justify-center text-xs text-muted-foreground">No trend points</div>
                )}
              </div>
            </div>

            {/* Buyer Rankings Chart */}
            <div className="rounded-lg border border-border bg-card p-4 shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <h3 className="text-sm font-bold text-foreground">Top Buyers Rank Chart</h3>
                  <p className="text-[10px] text-muted-foreground">Buyer rank position over time (#1 is on top).</p>
                </div>
                <ChartExportButtons containerRef={containerRef} filename={`${selectedBuyer}_${selectedMetric}_Rankings`} />
              </div>
              <div className="h-64 w-full">
                {rankingQuery.data && rankingQuery.data.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={rankingQuery.data} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={theme.gridColor} />
                      <XAxis dataKey="date" tick={{ fill: theme.axisLabelColor, fontSize: 10 }} tickLine={false} />
                      {/* Invert the Y-axis so #1 is at the top */}
                      <YAxis reversed tick={{ fill: theme.axisLabelColor, fontSize: 10 }} tickLine={false} domain={[1, "dataMax"]} />
                      <Tooltip />
                      <Line type="monotone" dataKey="rank" stroke="#3b82f6" strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 6 }} connectNulls />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full items-center justify-center text-xs text-muted-foreground">No ranking trend</div>
                )}
              </div>
            </div>

            {/* Unit Contribution Horizontal Bar Chart */}
            <div className="rounded-lg border border-border bg-card p-4 shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <h3 className="text-sm font-bold text-foreground">Unit Contribution to Buyer</h3>
                  <p className="text-[10px] text-muted-foreground">Click any bar to drill down into unit history.</p>
                </div>
                <ChartExportButtons containerRef={containerRef} filename={`${selectedBuyer}_${selectedMetric}_Unit_Contribution`} />
              </div>
              <div className="h-64 w-full">
                {contributionQuery.data && contributionQuery.data.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={contributionQuery.data} layout="vertical" margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={theme.gridColor} />
                      <XAxis type="number" tick={{ fill: theme.axisLabelColor, fontSize: 10 }} tickLine={false} />
                      <YAxis dataKey="unit" type="category" tick={{ fill: theme.axisLabelColor, fontSize: 10 }} width={60} tickLine={false} />
                      <Tooltip />
                      <Bar
                        dataKey="value"
                        fill="#10b981"
                        radius={[0, 4, 4, 0]}
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        onClick={(data: any) => {
                          const unitName = data?.unit || data?.payload?.unit;
                          if (unitName) {
                            setDrilldownUnit(unitName);
                          }
                        }}
                        className="cursor-pointer hover:opacity-85 transition-opacity"
                      />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full items-center justify-center text-xs text-muted-foreground">No contribution points</div>
                )}
              </div>
            </div>

            {/* Unit Contribution Detail (Drilldown Chart) */}
            <div className="rounded-lg border border-border bg-card p-4 shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <h3 className="text-sm font-bold text-foreground flex items-center gap-1.5">
                    Unit Contribution Detail
                    {drilldownUnit && (
                      <span className="rounded bg-accent/40 px-1.5 py-0.5 text-[10px] font-bold text-accent-foreground">
                        {drilldownUnit}
                      </span>
                    )}
                  </h3>
                  <p className="text-[10px] text-muted-foreground">
                    {drilldownUnit ? `Trend for ${selectedBuyer} under unit ${drilldownUnit}` : "Click a bar on the left chart to inspect."}
                  </p>
                </div>
                {drilldownUnit && (
                  <button
                    onClick={() => setDrilldownUnit(null)}
                    className="rounded border border-border bg-background p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
                    title="Clear drilldown"
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </div>
              <div className="h-64 w-full">
                {showDrilldown ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={drilldownQuery.data} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={theme.gridColor} />
                      <XAxis dataKey="date" tick={{ fill: theme.axisLabelColor, fontSize: 10 }} tickLine={false} />
                      <YAxis tick={{ fill: theme.axisLabelColor, fontSize: 10 }} tickLine={false} />
                      <Tooltip />
                      <Line type="monotone" dataKey="value" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full flex-col items-center justify-center text-center p-6 bg-muted/5 rounded border border-dashed border-border/60">
                    <TrendingUp className="size-8 text-muted-foreground/35 mb-1.5" />
                    <p className="text-xs text-muted-foreground font-semibold">Select a Unit to Drilldown</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">Click on any green bar from the Unit Contribution chart to plot its chronological history.</p>
                  </div>
                )}
              </div>
            </div>

            {/* Buyer Contribution Evolution (Stacked Area Chart) */}
            <div className="rounded-lg border border-border bg-card p-4 shadow-sm space-y-4 lg:col-span-2">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <h3 className="text-sm font-bold text-foreground">Buyer Contribution Evolution</h3>
                  <p className="text-[10px] text-muted-foreground">How unit contribution shares evolved over time.</p>
                </div>
                <ChartExportButtons containerRef={containerRef} filename={`${selectedBuyer}_${selectedMetric}_Contribution_Evolution`} />
              </div>
              <div className="h-72 w-full">
                {areaTrendData && areaTrendData.points.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={areaTrendData.points} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={theme.gridColor} vertical={false} />
                      <XAxis dataKey="date" tick={{ fill: theme.axisLabelColor, fontSize: 10 }} tickLine={false} />
                      <YAxis tick={{ fill: theme.axisLabelColor, fontSize: 10 }} tickLine={false} />
                      <Tooltip />
                      <Legend wrapperStyle={{ fontSize: 11, paddingTop: 10 }} />
                      {areaTrendData.keys.map((key, index) => (
                        <Area
                          key={key}
                          type="monotone"
                          dataKey={key}
                          stackId="1"
                          stroke={getColor(index)}
                          fill={getColor(index)}
                          fillOpacity={0.4}
                        />
                      ))}
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full items-center justify-center text-xs text-muted-foreground">No evolution trend</div>
                )}
              </div>
            </div>

            {/* Numerical History Table */}
            <div className="rounded-lg border border-border bg-card p-4 shadow-sm space-y-4 lg:col-span-2">
              <div className="flex items-center justify-between border-b border-border/60 pb-2">
                <div className="space-y-0.5 flex items-center gap-1.5">
                  <Table className="size-4 text-primary" />
                  <h3 className="text-sm font-bold text-foreground">Buyer History Table</h3>
                </div>
                <span className="text-[10px] text-muted-foreground">Precise numerical audit record.</span>
              </div>
              <div className="overflow-x-auto max-h-72">
                <table className="w-full text-xs text-left">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground uppercase text-[10px] tracking-wider font-semibold bg-muted/20">
                      <th className="px-4 py-2">Date</th>
                      <th className="px-4 py-2 text-right">Metric Value</th>
                      <th className="px-4 py-2 text-right">Change</th>
                      <th className="px-4 py-2 text-right">% Change</th>
                      <th className="px-4 py-2 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historyQuery.data && historyQuery.data.length ? (
                      [...historyQuery.data].reverse().map((row, idx) => (
                        <tr key={`history-row-${idx}`} className="border-b border-border/50 last:border-0 hover:bg-muted/30">
                          <td className="px-4 py-2.5 font-medium text-foreground">{row.date}</td>
                          <td className="px-4 py-2.5 text-right font-bold tabular-nums text-foreground">
                            {row.value.toLocaleString()} <span className="text-[10px] font-normal text-muted-foreground">kg</span>
                          </td>
                          <td className={`px-4 py-2.5 text-right font-bold tabular-nums ${
                            row.delta && row.delta > 0 ? "text-red-500" : row.delta && row.delta < 0 ? "text-green-500" : "text-muted-foreground"
                          }`}>
                            {row.delta !== null && row.delta !== undefined ? (
                              `${row.delta > 0 ? "+" : ""}${row.delta.toLocaleString()}`
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className={`px-4 py-2.5 text-right font-bold tabular-nums ${
                            row.percent_change && row.percent_change > 0 ? "text-red-500" : row.percent_change && row.percent_change < 0 ? "text-green-500" : "text-muted-foreground"
                          }`}>
                            {row.percent_change !== null && row.percent_change !== undefined ? (
                              `${row.percent_change > 0 ? "+" : ""}${row.percent_change.toFixed(1)}%`
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-center">
                            <span className={`inline-block rounded-full px-2 py-0.5 text-[9px] font-bold ${
                              row.is_present
                                ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
                                : "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
                            }`}>
                              {row.is_present ? "Available" : "Absent / Filled"}
                            </span>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground italic">
                          No history items found.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
