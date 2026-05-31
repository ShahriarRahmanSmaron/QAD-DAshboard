"use client";

import { ArrowDownRight, ArrowRight, ArrowUpRight, FileSpreadsheet, Loader2 } from "lucide-react";
import { useOperationalComparison, useOperationalTrend } from "@/lib/reports/operational-hooks";
import type { OperationalComparisonParams } from "@/lib/reports/api";
import type { OperationalWorkbookSourceRef } from "@/lib/reports/types";
import { cn } from "@/lib/utils";

type Props = {
  metric: string | null;
  currentDate: string | null;
  buyer?: string | null;
  unit?: string | null;
  section?: string | null;
  reportTypeId?: string | null;
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
  reportTypeId,
}: Props) {
  const comparisonParams: OperationalComparisonParams | null =
    metric && currentDate
      ? {
          metric,
          current_date: currentDate,
          buyer: buyer || undefined,
          unit: unit || undefined,
          section: section || undefined,
          report_type_id: reportTypeId || undefined,
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
          report_type_id: reportTypeId || undefined,
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
        <>
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

          {/* MD07-3 Phase 4: where the compared values originate. */}
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <SourceWorkbookBlock
              date={data.current_date}
              label="Current source workbook"
              sources={data.current_sources ?? []}
            />
            <SourceWorkbookBlock
              date={data.previous_date}
              label="Previous source workbook"
              sources={data.previous_sources ?? []}
            />
          </div>
        </>
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
              const workbookNames = point.workbook_names ?? [];
              const hoverTitle = [
                `Date: ${point.report_date}`,
                workbookNames.length > 0 ? `Workbook: ${workbookNames.join(", ")}` : null,
                `Value: ${formatNumber(point.numeric_total)}`,
              ]
                .filter(Boolean)
                .join("\n");
              return (
                <div
                  className="flex items-center gap-2"
                  key={point.report_date}
                  title={hoverTitle}
                >
                  <span className="w-20 shrink-0 font-mono text-[10px] text-muted-foreground">
                    {point.report_date}
                  </span>
                  <div className="relative h-3 flex-1 overflow-hidden rounded-sm bg-muted/40">
                    <div
                      className="absolute inset-y-0 left-0 rounded-sm bg-gradient-to-r from-primary/60 to-accent/60"
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

function SourceWorkbookBlock({
  label,
  date,
  sources,
}: {
  label: string;
  date: string | null;
  sources: OperationalWorkbookSourceRef[];
}) {
  return (
    <div className="rounded-md border bg-card/60 px-2.5 py-2">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
        <FileSpreadsheet className="size-3.5" />
        {label}
      </div>
      <div className="mt-1 text-[11px] text-muted-foreground">
        Date: <span className="font-medium text-foreground">{date ?? "—"}</span>
      </div>
      {sources.length === 0 ? (
        <div className="mt-1 text-xs text-muted-foreground">No active source workbook.</div>
      ) : (
        <ul className="mt-1 grid gap-1">
          {sources.map((source) => (
            <li
              className="flex items-center justify-between gap-2 rounded-sm border bg-background/60 px-2 py-1"
              key={source.workbook_id}
            >
              <span className="truncate text-xs font-medium text-foreground" title={source.filename}>
                {source.filename}
              </span>
              <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                {source.fact_count}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
