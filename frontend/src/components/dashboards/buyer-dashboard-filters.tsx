"use client";

import React from "react";
import { Sliders, CalendarDays } from "lucide-react";
import { formatShortDate } from "@/components/charts/adapters";

type BuyerDashboardFiltersProps = {
  availableBuyers: { value: string; label: string }[];
  selectedBuyer: string | null;
  onBuyerChange: (buyer: string) => void;
  availableDates: string[];
  selectedDate: string;
  onDateChange: (date: string) => void;
  compareMode: "snapshot" | "compare";
  onCompareModeChange: (mode: "snapshot" | "compare") => void;
  selectedCompareDate: string | null;
  onCompareDateChange: (date: string | null) => void;
};

const selectClass =
  "rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary h-9 min-w-[160px]";

export function BuyerDashboardFilters({
  availableBuyers,
  selectedBuyer,
  onBuyerChange,
  availableDates,
  selectedDate,
  onDateChange,
  compareMode,
  onCompareModeChange,
  selectedCompareDate,
  onCompareDateChange,
}: BuyerDashboardFiltersProps) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm backdrop-blur space-y-4">
      <div className="flex items-center gap-2 pb-1 border-b border-border/50">
        <Sliders className="size-4 text-primary" />
        <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Dashboard Filters
        </h3>
      </div>

      <div className="flex flex-wrap items-end gap-6">
        {/* Buyer Dropdown */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-muted-foreground">Select Buyer</label>
          <select
            value={selectedBuyer || ""}
            onChange={(e) => onBuyerChange(e.target.value)}
            className={selectClass}
          >
            {availableBuyers.length === 0 && <option value="">No buyers</option>}
            {availableBuyers.map((b) => (
              <option key={b.value} value={b.value}>
                {b.label}
              </option>
            ))}
          </select>
        </div>

        {/* Mode Selector */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-muted-foreground">Analysis Mode</label>
          <div className="flex h-9 rounded-md border border-input p-0.5 bg-background shadow-sm">
            <button
              type="button"
              onClick={() => onCompareModeChange("snapshot")}
              className={`px-3 rounded-sm text-xs font-medium transition-all ${
                compareMode === "snapshot"
                  ? "bg-primary text-primary-foreground shadow-sm font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Snapshot
            </button>
            <button
              type="button"
              onClick={() => onCompareModeChange("compare")}
              className={`px-3 rounded-sm text-xs font-medium transition-all ${
                compareMode === "compare"
                  ? "bg-primary text-primary-foreground shadow-sm font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Compare
            </button>
          </div>
        </div>

        {/* Date Dropdown */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-muted-foreground">
            {compareMode === "compare" ? "Current Date" : "Report Date"}
          </label>
          <select
            value={selectedDate}
            onChange={(e) => onDateChange(e.target.value)}
            className={selectClass}
          >
            {[...availableDates].reverse().map((d) => (
              <option key={`date-${d}`} value={d} disabled={d === selectedCompareDate}>
                {formatShortDate(d)}
              </option>
            ))}
          </select>
        </div>

        {/* Compare Date Dropdown (Visible only in Compare Mode) */}
        {compareMode === "compare" && (
          <div className="flex flex-col gap-1.5 animate-fadeIn">
            <label className="text-xs font-semibold text-muted-foreground">Comparison Date</label>
            <select
              value={selectedCompareDate || ""}
              onChange={(e) => onCompareDateChange(e.target.value || null)}
              className={selectClass}
            >
              <option value="" disabled>Select Compare Date</option>
              {[...availableDates].reverse().map((d) => (
                <option key={`comp-date-${d}`} value={d} disabled={d === selectedDate}>
                  {formatShortDate(d)}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
    </div>
  );
}
