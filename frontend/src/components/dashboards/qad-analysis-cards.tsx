"use client";

import React from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowUp, ArrowDown, Minus } from "lucide-react";
import { formatShortDate } from "@/components/charts/adapters";

type QadCardData = {
  key: string;
  label: string;
  value: number | null;
  previous_value: number | null;
  delta: number | null;
  pct_change: number | null;
  unit: string | null;
  display_format: string;
  display_order: number;
};

type QadAnalysisResponse = {
  report_type: string;
  report_date: string;
  buyer: string;
  cards: QadCardData[];
};

type QadAnalysisCardsProps = {
  reportTypeId: string;
  buyer: string | null;
  date: string;
  compareMode: "snapshot" | "compare";
  compareDate: string | null;
  onDataLoaded: (hasData: boolean) => void;
};

async function fetchQadAnalysis(
  reportTypeId: string,
  buyer: string,
  date: string,
  compareDate: string | null
): Promise<QadAnalysisResponse | null> {
  const query = new URLSearchParams({
    report_type_id: reportTypeId,
    buyer,
    date,
  });
  if (compareDate) {
    query.set("compare_date", compareDate);
  }
  const res = await fetch(`/api/buyer-dashboard/qad-analysis?${query.toString()}`);
  if (!res.ok) {
    throw new Error("Failed to fetch QAD analysis");
  }
  return res.json();
}

function formatVal(card: QadCardData): string {
  if (card.value === null || card.value === undefined) return "\u2014";
  const unit = card.unit || "";
  if (card.display_format === "percentage" || unit === "%") {
    return `${card.value.toFixed(1)}%`;
  }
  return `${Math.round(card.value).toLocaleString()} ${unit}`.trim();
}

function getDeltaColor(delta: number | null): string {
  if (!delta) return "text-muted-foreground";
  return delta > 0 ? "text-green-500 font-bold" : "text-red-500 font-bold";
}

export function QadAnalysisCards({
  reportTypeId,
  buyer,
  date,
  compareMode,
  compareDate,
  onDataLoaded,
}: QadAnalysisCardsProps) {
  const isCompare = compareMode === "compare" && !!compareDate;

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["buyer-dashboard", "qad-analysis", reportTypeId, buyer, date, isCompare ? compareDate : null],
    queryFn: () => fetchQadAnalysis(reportTypeId, buyer!, date, isCompare ? compareDate : null),
    enabled: !!reportTypeId && !!buyer && !!date,
    staleTime: 30_000,
  });

  React.useEffect(() => {
    if (!isLoading) {
      onDataLoaded(!!data);
    }
  }, [data, isLoading, onDataLoaded]);

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, idx) => (
          <div
            key={idx}
            className="h-32 rounded-lg border border-border bg-card p-4 animate-pulse flex flex-col justify-between"
          >
            <div className="h-4 w-1/3 bg-muted rounded"></div>
            <div className="h-8 w-1/2 bg-muted rounded"></div>
            <div className="h-3 w-1/4 bg-muted rounded"></div>
          </div>
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-900/30 p-4 text-sm text-red-600 dark:text-red-400">
        Error loading report summary: {error instanceof Error ? error.message : "Unknown error"}
      </div>
    );
  }

  if (!data || !data.cards || data.cards.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border/80 bg-accent/5 p-8 text-center text-muted-foreground">
        <p className="text-sm font-medium">No report data found for {buyer} on {formatShortDate(date)}.</p>
        <p className="text-xs text-muted-foreground/85 mt-1">Please select another date or check your assignments.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
          <span className="font-semibold text-foreground">{data.report_type} Summary</span>
          <span>{"\u2022"}</span>
          <span>{data.buyer}</span>
          <span>{"\u2022"}</span>
          <span>{formatShortDate(data.report_date)}</span>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {data.cards.map((card) => {
          const hasPrev = card.previous_value !== null;
          const deltaColor = getDeltaColor(card.delta);

          return (
            <div
              key={card.key}
              className="relative overflow-hidden rounded-xl border border-border bg-card p-5 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between"
            >
              <div>
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  {card.label}
                </span>

                {isCompare && hasPrev ? (
                  <div className="mt-2 grid grid-cols-2 gap-x-2 gap-y-1 pb-3 border-b border-border/40">
                    <div>
                      <span className="text-[10px] text-muted-foreground font-medium block">
                        Prev ({formatShortDate(compareDate!)})
                      </span>
                      <span className="text-sm font-bold text-foreground/80">
                        {formatVal({ ...card, value: card.previous_value })}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] text-muted-foreground font-medium block">
                        Curr ({formatShortDate(date)})
                      </span>
                      <span className="text-sm font-bold text-foreground">
                        {formatVal(card)}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="mt-2 text-3xl font-extrabold text-foreground tracking-tight">
                    {formatVal(card)}
                  </div>
                )}
              </div>

              {isCompare && hasPrev && card.delta !== null && (
                <div className="mt-3 pt-1 flex items-center justify-between text-xs">
                  <span className="text-muted-foreground font-medium">Variance</span>
                  <div className="flex items-center gap-2">
                    <span className={deltaColor}>
                      {card.delta > 0 ? "+" : ""}
                      {formatVarDelta(card)}
                    </span>
                    {card.pct_change !== null && (
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                        card.delta > 0
                          ? "bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400"
                          : "bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-400"
                      }`}>
                        {card.pct_change > 0 ? "+" : ""}
                        {card.pct_change.toFixed(1)}%
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function formatVarDelta(card: QadCardData): string {
  if (card.delta === null) return "\u2014";
  const unit = card.unit || "";
  if (card.display_format === "percentage" || unit === "%") {
    return `${card.delta.toFixed(1)}%`;
  }
  return `${Math.round(card.delta).toLocaleString()}`;
}
