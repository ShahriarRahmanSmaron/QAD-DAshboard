"use client";

/**
 * MD08-3A Phase 1: Global Dashboard Date Controls
 *
 * Top-of-dashboard filters:
 *   - Report Type (dynamic from report registry)
 *   - Metric (dynamic from selected report type)
 *   - Date Range presets (7/14/30/90/custom)
 *   - Comparison Mode (Latest vs Previous / Selected Dates / Trend Mode)
 *   - Group dimension (Unit / Buyer / Section)
 *   - Date picker (multi-select) when Comparison Mode = Selected Dates
 *
 * Nothing is hardcoded — report types, metrics and dates are loaded from the
 * registry and the operational dimensions endpoint.
 */

import type {
  DateRange,
  GroupDimension,
} from "@/components/charts/types";
import { formatShortDate } from "@/components/charts/adapters";
import type {
  OperationalDimensionOption,
  ReportTypeOption,
} from "@/lib/reports/types";
import {
  DATE_RANGE_OPTIONS,
  GROUP_DIMENSION_OPTIONS,
} from "./dashboard-utils";

export type DashboardControlsState = {
  reportTypeId: string;
  metric: string;
  dateRange: DateRange;
  customFrom: string;
  customTo: string;
  groupDimension: GroupDimension;
  selectedCurrentDate: string;
  selectedComparisonDate: string;
};

type DashboardControlsProps = {
  state: DashboardControlsState;
  reportTypes: ReportTypeOption[];
  metrics: OperationalDimensionOption[];
  availableDates: string[];
  onChange: (patch: Partial<DashboardControlsState>) => void;
};

function ControlGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

const selectClass =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary";

export function DashboardControls({
  state,
  reportTypes,
  metrics,
  availableDates,
  onChange,
}: DashboardControlsProps) {
  return (
    <div className="space-y-4 rounded-lg border border-border bg-card p-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-6">
        {/* Report Type */}
        <ControlGroup label="Report Type">
          <select
            value={state.reportTypeId}
            onChange={(e) => onChange({ reportTypeId: e.target.value })}
            className={selectClass}
          >
            <option value="">All Report Types</option>
            {reportTypes.map((rt) => (
              <option key={rt.id} value={rt.id}>
                {rt.name}
              </option>
            ))}
          </select>
        </ControlGroup>

        {/* Metric */}
        <ControlGroup label="Metric">
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
        </ControlGroup>

        {/* Date Range */}
        <ControlGroup label="Date Range (Trends)">
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
        </ControlGroup>

        {/* Group By */}
        <ControlGroup label="Group By">
          <select
            value={state.groupDimension}
            onChange={(e) =>
              onChange({ groupDimension: e.target.value as GroupDimension })
            }
            className={selectClass}
          >
            {GROUP_DIMENSION_OPTIONS.map((gd) => (
              <option key={gd.value} value={gd.value}>
                {gd.label}
              </option>
            ))}
          </select>
        </ControlGroup>

        {/* Current Report Date */}
        <ControlGroup label="Current Report Date">
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
        </ControlGroup>

        {/* Comparison Report Date */}
        <ControlGroup label="Comparison Report Date">
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
        </ControlGroup>
      </div>

      {/* Custom date range inputs */}
      {state.dateRange === "custom" && (
        <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3">
          <label className="text-xs font-medium text-muted-foreground">From</label>
          <input
            type="date"
            value={state.customFrom}
            onChange={(e) => onChange({ customFrom: e.target.value })}
            className="rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <label className="text-xs font-medium text-muted-foreground">To</label>
          <input
            type="date"
            value={state.customTo}
            onChange={(e) => onChange({ customTo: e.target.value })}
            className="rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
      )}
    </div>
  );
}
