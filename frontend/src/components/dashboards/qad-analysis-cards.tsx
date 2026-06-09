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
};

type QadAnalysisResponse = {
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

  // Call onDataLoaded when query succeeds
  React.useEffect(() => {
    if (!isLoading) {
      onDataLoaded(!!data);
    }
  }, [data, isLoading, onDataLoaded]);

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, idx) => (
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
        Error loading QAD analysis: {error instanceof Error ? error.message : "Unknown error"}
      </div>
    );
  }

  if (!data || !data.cards || data.cards.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border/80 bg-accent/5 p-8 text-center text-muted-foreground">
        <p className="text-sm font-medium">No WF Test & Shade data found for {buyer} on {formatShortDate(date)}.</p>
        <p className="text-xs text-muted-foreground/85 mt-1">Please select another date or check your assignments.</p>
      </div>
    );
  }

  function formatVal(key: string, val: number | null): string {
    if (val === null || val === undefined) return "—";
    if (key.includes("pct")) {
      return `${val.toFixed(1)}%`;
    }
    return `${Math.round(val).toLocaleString()} kg`;
  }

  function getDeltaColor(key: string, delta: number | null): string {
    if (!delta) return "text-muted-foreground";
    const isWftOrWeight = key === "wait_for_test" || key === "total_weight";
    if (isWftOrWeight) {
      // For backlog and total weight, an increase is negative/red, a reduction is positive/green
      return delta > 0 ? "text-red-500 font-bold" : "text-green-500 font-bold";
    }
    // For Pass %, increase is positive/green, decrease is negative/red
    if (key === "pass_pct") {
      return delta > 0 ? "text-green-500 font-bold" : "text-red-500 font-bold";
    }
    // For Fail %, Need Approval %, No App %, increase is negative/red, decrease is positive/green
    return delta > 0 ? "text-red-500 font-bold" : "text-green-500 font-bold";
  }

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
        QAD Analysis
      </h3>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {data.cards.map((card) => {
          const hasPrev = card.previous_value !== null;
          const deltaColor = getDeltaColor(card.key, card.delta);

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
                        {formatVal(card.key, card.previous_value)}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] text-muted-foreground font-medium block">
                        Curr ({formatShortDate(date)})
                      </span>
                      <span className="text-sm font-bold text-foreground">
                        {formatVal(card.key, card.value)}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="mt-2 text-3xl font-extrabold text-foreground tracking-tight">
                    {formatVal(card.key, card.value)}
                  </div>
                )}
              </div>

              {isCompare && hasPrev && card.delta !== null && (
                <div className="mt-3 pt-1 flex items-center justify-between text-xs">
                  <span className="text-muted-foreground font-medium">Variance</span>
                  <div className="flex items-center gap-2">
                    <span className={deltaColor}>
                      {card.delta > 0 ? "+" : ""}
                      {card.key.includes("pct") ? `${card.delta.toFixed(1)}%` : Math.round(card.delta).toLocaleString()}
                    </span>
                    {card.pct_change !== null && (
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                        card.delta > 0 
                          ? (card.key === "pass_pct" ? "bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400" : "bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-400")
                          : (card.key === "pass_pct" ? "bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-400" : "bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400")
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
