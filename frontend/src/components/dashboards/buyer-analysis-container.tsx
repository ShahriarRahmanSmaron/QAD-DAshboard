"use client";

import React from "react";
import { BuyerExplorer } from "@/components/charts/buyer-explorer";

type BuyerAnalysisContainerProps = {
  selectedBuyer: string | null;
  onBuyerChange: (buyer: string) => void;
  availableBuyers: { value: string; label: string }[];
  metric: string;
  metricLabel: string;
  reportTypeId: string;
  dateWindow: { date_from?: string; date_to?: string };
  latestDate: string;
  previousDate: string | null;
};

export function BuyerAnalysisContainer({
  selectedBuyer,
  onBuyerChange,
  availableBuyers,
  metric,
  metricLabel,
  reportTypeId,
  dateWindow,
  latestDate,
  previousDate,
}: BuyerAnalysisContainerProps) {
  return (
    <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
      <BuyerExplorer
        title="Buyer Analysis"
        selectedBuyer={selectedBuyer}
        onBuyerChange={onBuyerChange}
        availableBuyers={availableBuyers}
        metric={metric}
        metricLabel={metricLabel}
        reportTypeId={reportTypeId}
        dateWindow={dateWindow}
        latestDate={latestDate}
        previousDate={previousDate}
      />
    </div>
  );
}
