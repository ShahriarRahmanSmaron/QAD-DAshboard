"use client";

import { ArrowDownRight, ArrowRight, ArrowUpRight, Loader2 } from "lucide-react";
import { useOperationalComparison, useOperationalTrend } from "@/lib/reports/operational-hooks";
import type { OperationalComparisonParams } from "@/lib/reports/api";
import { cn } from "@/lib/utils";

type Props = {
  metric: string | null;
  currentDate: string | null;
  buyer?: string | null;
  unit?: string | null;
  section?: string | null;
};

function formatNumber(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") {
    return "—";
  }
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return String(value);
  }
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(numeric);
}

const DIRECTION_TONE: Record<string, string> = {
  up: "text-emerald-600 dark:text-emerald-400",
  down: "text-rose-600 dark:text-rose-400",
  flat: "text-muted-foreground",
};

/**
 * Historical comparison layer (MD07-2).
 *
 * Previous-day comparison view with delta indicators plus a compact
 * operational trend preview. Charts are intentionally avoided — the trend is
 * rendered as a simple bar/spark list to stay within scope.
 */
export function OperationalComparisonPanel({
  metric,
  currentDate,
  buyer,
  unit,
  section,
}: Props) {
  const comparisonParams: OperationalComparisonParams | null =
    metric && currentDate
      ? {
          metric,
          current_date: currentDate,
          buyer: buyer || undefined,
          unit: unit || undefined,
          section: section || undefined,
        }
      : null;

  const comparison = useOperationalComparison(comparisonParams);
  const trend = useOperationalTrend(
    metric
      ? {
          metric,
          buyer: buyer || undefined,
          unit: unit || undefined,
          section: section || undefined,
          limit: 30,
        }
      : null,
  );

  if (!metric) {
    return (
      <div className="rounded-md border bg-background/55 p-3 text-xs text-muted-foreground">
        Select a metric to see previous-day comparison and trend.
      </div>
    );
  }

  const data = comparison.data;
  const direction = data?.direction ?? "flat";
  const DirectionIcon =
    direction === "up" ? ArrowUpRight : direction === "down" ? ArrowDownRight : ArrowRight;

  const trendPoints = trend.data?.points ?? [];
  const maxTrend = trendPoints.reduce((max, point) => {
    const value = Number(point.numeric_total ?? 0);
    return Number.isFinite(value) ? Math.max(max, Math.abs(value)) : max;
  }, 0);

  return (
    <div className="rounded-md border bg-background/55 p-3 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-medium text-foreground">Historical comparison</div>
          <div className="mt-0.5 text-muted-foreground">
            {metric}
            {buyer ? ` · ${buyer}` : ""}
            {unit ? ` · ${unit}` : ""}
          </div>
        </div>
        {(comparison.isFetching || trend.isFetching) && (
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        )}
      </div>

      {comparison.isError ? (
        <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive">
          {(comparison.error as Error)?.message ?? "Unable to load comparison."}
        </div>
      ) : data ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <div className="rounded-md border bg-card/60 px-2 py-1.5">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Current ({data.current_date})
            </div>
            <div className="mt-0.5 text-base font-semibold tabular-nums">
              {formatNumber(data.current.numeric_total)}
            </div>
            <div className="text-[11px] text-muted-foreground">
              {data.current.fact_count} facts
            </div>
          </div>
          <div className="rounded-md border bg-card/60 px-2 py-1.5">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Previous ({data.previous_date ?? "n/a"})
            </div>
            <div className="mt-0.5 text-base font-semibold tabular-nums">
              {formatNumber(data.previous.numeric_total)}
            </div>
            <div className="text-[11px] text-muted-foreground">
              {data.previous.fact_count} facts
            </div>
          </div>
          <div className="rounded-md border bg-card/60 px-2 py-1.5">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Delta</div>
            <div
              className={cn(
                "mt-0.5 flex items-center gap-1 text-base font-semibold tabular-nums",
                DIRECTION_TONE[direction],
              )}
            >
              <DirectionIcon className="size-4" />
              {formatNumber(data.delta)}
            </div>
            <div className="text-[11px] text-muted-foreground">
              {data.delta_percent !== null && data.delta_percent !== undefined
                ? `${data.delta_percent.toFixed(1)}%`
                : "—"}
            </div>
          </div>
        </div>
      ) : null}

      {trendPoints.length > 0 && (
        <div className="mt-3 border-t pt-2">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Trend preview (last {trendPoints.length} dates)
          </div>
          <div className="mt-2 grid gap-1">
            {trendPoints.map((point) => {
              const value = Number(point.numeric_total ?? 0);
              const width = maxTrend > 0 ? Math.max(2, (Math.abs(value) / maxTrend) * 100) : 0;
              return (
                <div className="flex items-center gap-2" key={point.report_date}>
                  <span className="w-20 shrink-0 font-mono text-[10px] text-muted-foreground">
                    {point.report_date}
                  </span>
                  <div className="relative h-3 flex-1 overflow-hidden rounded-sm bg-muted/40">
                    <div
                      className="absolute inset-y-0 left-0 rounded-sm bg-primary/50"
                      style={{ width: `${width}%` }}
                    />
                  </div>
                  <span className="w-20 shrink-0 text-right font-mono text-[10px] tabular-nums text-foreground">
                    {formatNumber(point.numeric_total)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
