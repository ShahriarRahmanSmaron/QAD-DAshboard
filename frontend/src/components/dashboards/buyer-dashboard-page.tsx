"use client";

import React, { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { BuyerDashboardFilters } from "./buyer-dashboard-filters";
import { QadAnalysisCards } from "./qad-analysis-cards";
import { BuyerAnalysisContainer } from "./buyer-analysis-container";
import { useOperationalDimensions } from "@/lib/reports/operational-hooks";
import { FileSpreadsheet, RefreshCw } from "lucide-react";
import type { AuthUser } from "@/lib/auth/types";

type BootstrapResponse = {
  default_report_type_id: string | null;
  latest_date: string | null;
  report_type_name: string | null;
  default_analysis_metric: string | null;
  primary_metrics: string[];
  available_reports: { id: string; name: string; supports_buyer_analysis: boolean }[];
  available_buyers: { name: string }[];
};

export function BuyerDashboardPage({ user }: { user: AuthUser }) {
  const bootstrapQuery = useQuery({
    queryKey: ["buyer-dashboard", "bootstrap"],
    queryFn: async (): Promise<BootstrapResponse> => {
      const res = await fetch("/api/buyer-dashboard/bootstrap");
      if (!res.ok) {
        throw new Error("Failed to load bootstrap data");
      }
      return res.json();
    },
    staleTime: 60_000,
  });

  const [selectedBuyer, setSelectedBuyer] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [compareMode, setCompareMode] = useState<"snapshot" | "compare">("snapshot");
  const [selectedCompareDate, setSelectedCompareDate] = useState<string | null>(null);
  const [hasData, setHasData] = useState<boolean>(true);

  const bootstrapData = bootstrapQuery.data;
  const reportTypeId = bootstrapData?.default_report_type_id || "";

  const dimensionsQuery = useOperationalDimensions(reportTypeId || undefined);
  const availableDates = useMemo(() => {
    const raw = dimensionsQuery.data?.dates ?? [];
    return raw.map((d) => d.value).sort((a, b) => a.localeCompare(b));
  }, [dimensionsQuery.data]);

  useEffect(() => {
    if (bootstrapData) {
      if (bootstrapData.available_buyers.length > 0 && !selectedBuyer) {
        setSelectedBuyer(bootstrapData.available_buyers[0]!.name);
      }
      if (bootstrapData.latest_date && !selectedDate) {
        setSelectedDate(bootstrapData.latest_date);
      }
    }
  }, [bootstrapData, selectedBuyer, selectedDate]);

  useEffect(() => {
    if (selectedDate && selectedCompareDate === selectedDate) {
      const otherDate = availableDates.find((d) => d !== selectedDate) || null;
      setSelectedCompareDate(otherDate);
    }
  }, [selectedDate, selectedCompareDate, availableDates]);

  useEffect(() => {
    if (compareMode === "compare" && selectedDate && !selectedCompareDate && availableDates.length > 1) {
      const idx = availableDates.indexOf(selectedDate);
      if (idx > 0) {
        setSelectedCompareDate(availableDates[idx - 1]!);
      } else {
        setSelectedCompareDate(availableDates[1]!);
      }
    }
  }, [compareMode, selectedDate, selectedCompareDate, availableDates]);

  const dateWindow = useMemo(() => {
    if (!selectedDate) return { date_from: undefined, date_to: undefined };
    const d = new Date(selectedDate);
    d.setDate(d.getDate() - 30);
    const dateFrom = d.toISOString().split("T")[0];
    return {
      date_from: dateFrom,
      date_to: selectedDate,
    };
  }, [selectedDate]);

  const formattedAvailableBuyers = useMemo(() => {
    if (!bootstrapData) return [];
    return bootstrapData.available_buyers.map((b) => ({
      value: b.name,
      label: b.name,
    }));
  }, [bootstrapData]);

  const analysisMetric = bootstrapData?.default_analysis_metric || "wait_for_test";
  const analysisMetricLabel = analysisMetric.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  if (bootstrapQuery.isLoading || dimensionsQuery.isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="flex flex-col items-center gap-2">
          <RefreshCw className="h-8 w-8 text-primary animate-spin" />
          <p className="text-sm text-muted-foreground">Initializing Buyer Dashboard...</p>
        </div>
      </div>
    );
  }

  if (bootstrapQuery.isError) {
    return (
      <div className="p-6 rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-900/30 text-red-600 dark:text-red-400">
        <h2 className="text-base font-bold">Failed to load Dashboard</h2>
        <p className="text-sm mt-1">
          {bootstrapQuery.error instanceof Error ? bootstrapQuery.error.message : "Unknown error"}
        </p>
      </div>
    );
  }

  const reportLabel = bootstrapData?.report_type_name || "WF Test & Shade";

  if (!bootstrapData || !bootstrapData.default_report_type_id) {
    return (
      <div className="rounded-xl border border-dashed border-border/80 bg-accent/5 p-12 text-center text-muted-foreground">
        <FileSpreadsheet className="size-10 mx-auto text-muted-foreground/60 mb-3" />
        <h3 className="text-sm font-semibold text-foreground">No active workbooks found</h3>
        <p className="text-xs text-muted-foreground/80 mt-1 max-w-sm mx-auto">
          Please upload and process at least one active "{reportLabel}" workbook in the Workbook Manager.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold text-foreground tracking-tight">Buyer Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Perform buyer-centric QAD Analysis and explore performance metrics.
        </p>
      </div>

      <BuyerDashboardFilters
        availableBuyers={formattedAvailableBuyers}
        selectedBuyer={selectedBuyer}
        onBuyerChange={setSelectedBuyer}
        availableDates={availableDates}
        selectedDate={selectedDate}
        onDateChange={setSelectedDate}
        compareMode={compareMode}
        onCompareModeChange={setCompareMode}
        selectedCompareDate={selectedCompareDate}
        onCompareDateChange={setSelectedCompareDate}
      />

      {selectedBuyer && selectedDate && (
        <QadAnalysisCards
          reportTypeId={reportTypeId}
          buyer={selectedBuyer}
          date={selectedDate}
          compareMode={compareMode}
          compareDate={compareMode === "compare" ? selectedCompareDate : null}
          onDataLoaded={setHasData}
        />
      )}

      {hasData && selectedBuyer && selectedDate && (
        <div className="pt-2 animate-fadeIn">
          <BuyerAnalysisContainer
            selectedBuyer={selectedBuyer}
            onBuyerChange={setSelectedBuyer}
            availableBuyers={formattedAvailableBuyers}
            metric={analysisMetric}
            metricLabel={analysisMetricLabel}
            reportTypeId={reportTypeId}
            dateWindow={dateWindow}
            latestDate={selectedDate}
            previousDate={compareMode === "compare" ? selectedCompareDate : null}
          />
        </div>
      )}
    </div>
  );
}
