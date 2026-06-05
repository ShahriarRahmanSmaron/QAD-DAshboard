"use client";

import { Database, Sliders, CalendarDays } from "lucide-react";
import type { DateRange } from "@/components/charts/types";
import { formatShortDate } from "@/components/charts/adapters";
import type {
  OperationalDimensionOption,
  ReportTypeOption,
} from "@/lib/reports/types";
import { DATE_RANGE_OPTIONS } from "./dashboard-utils";

type DashboardControlsProps = {
  state: Record<string, string>;
  reportTypes: ReportTypeOption[];
  metrics: OperationalDimensionOption[];
  availableDates: string[];
  onChange: (patch: Partial<Record<string, string>>) => void;
  manifest: any;
  dimensionsData: any;
};

const selectClass =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary";

export function DashboardControls({
  state,
  reportTypes,
  metrics,
  availableDates,
  onChange,
  manifest,
  dimensionsData,
}: DashboardControlsProps) {
  const businessDimensions = manifest
    ? manifest.dimensions
        .filter((d: any) => d.visible && d.key !== "metric" && d.key !== "section")
        .sort((a: any, b: any) => a.order - b.order)
    : [];

  return (
    <div className="space-y-4">
      {/* 1. Report Type Card */}
      <div className="rounded-xl border border-border bg-card p-4 shadow-sm backdrop-blur">
        <div className="flex items-center gap-2 mb-3">
          <Database className="size-4 text-primary" />
          <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Report Selection
          </h3>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Report Type</label>
            <select
              value={state.reportTypeId}
              onChange={(e) => {
                const val = e.target.value;
                // Propagate reset of dimensions in parent via onChange
                onChange({ reportTypeId: val });
              }}
              className={selectClass}
            >
              <option value="">Select Report Type</option>
              {reportTypes.map((rt) => (
                <option key={rt.id} value={rt.id}>
                  {rt.name}
                </option>
              ))}
            </select>
          </div>

          {state.reportTypeId && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Primary Metric</label>
              <select
                value={state.metric}
                onChange={(e) => onChange({ metric: e.target.value })}
                className={selectClass}
              >
                {metrics.length === 0 && <option value="">No metrics</option>}
                {metrics.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      {/* 2. Business Filters Card */}
      {state.reportTypeId && businessDimensions.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm backdrop-blur">
          <div className="flex items-center gap-2 mb-3">
            <Sliders className="size-4 text-primary" />
            <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Business Filters
            </h3>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {businessDimensions.map((dim: any) => (
              <div key={dim.key} className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">{dim.label}</label>
                <select
                  value={state[dim.key] ?? ""}
                  onChange={(e) => onChange({ [dim.key]: e.target.value })}
                  className={selectClass}
                >
                  <option value="">All {dim.label}s</option>
                  {dimensionsData?.dimensions?.[dim.key]?.map((opt: any) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 3. Time & Comparison Controls Card */}
      {state.reportTypeId && (
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm backdrop-blur">
          <div className="flex items-center gap-2 mb-3">
            <CalendarDays className="size-4 text-primary" />
            <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Time & Comparison Controls
            </h3>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {/* Date Range Preset */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Date Range (Trends)</label>
              <select
                value={state.dateRange}
                onChange={(e) => onChange({ dateRange: e.target.value as DateRange })}
                className={selectClass}
              >
                {DATE_RANGE_OPTIONS.map((dr) => (
                  <option key={dr.value} value={dr.value}>
                    {dr.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Current Report Date */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Current Date</label>
              <select
                value={state.selectedCurrentDate}
                onChange={(e) => onChange({ selectedCurrentDate: e.target.value })}
                className={selectClass}
              >
                <option value="" disabled>Select Current Date</option>
                {[...availableDates].reverse().map((date) => (
                  <option
                    key={`curr-${date}`}
                    value={date}
                    disabled={date === state.selectedComparisonDate}
                  >
                    {formatShortDate(date)}
                  </option>
                ))}
              </select>
            </div>

            {/* Comparison Report Date */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Comparison Date</label>
              <select
                value={state.selectedComparisonDate}
                onChange={(e) => onChange({ selectedComparisonDate: e.target.value })}
                className={selectClass}
              >
                <option value="" disabled>Select Comparison Date</option>
                {[...availableDates].reverse().map((date) => (
                  <option
                    key={`comp-${date}`}
                    value={date}
                    disabled={date === state.selectedCurrentDate}
                  >
                    {formatShortDate(date)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Custom date range inputs */}
          {state.dateRange === "custom" && (
            <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3 mt-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-muted-foreground">From</label>
                <input
                  type="date"
                  value={state.customFrom}
                  onChange={(e) => onChange({ customFrom: e.target.value })}
                  className="rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-muted-foreground">To</label>
                <input
                  type="date"
                  value={state.customTo}
                  onChange={(e) => onChange({ customTo: e.target.value })}
                  className="rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
