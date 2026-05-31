"use client";

import { Clock, Database, FileSpreadsheet, Layers } from "lucide-react";
import { useActiveWorkbookSources } from "@/lib/reports/operational-hooks";

function formatNumber(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return "0";
  }
  return new Intl.NumberFormat("en-US").format(value);
}

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Active Operational Sources card (MD07-3 Phase 6).
 *
 * Immediate visibility into which workbooks feed operational reporting, the
 * latest upload time, the active workbook count, and total operational facts.
 */
export function ActiveSourcesCard() {
  const query = useActiveWorkbookSources();
  const data = query.data;
  const sources = data?.sources ?? [];

  // MD07-5 Phase 4: group active workbooks by report type so each report
  // type's sources are visually scoped and never mixed together.
  const groups = (() => {
    const map = new Map<string, { label: string; sources: typeof sources }>();
    for (const source of sources) {
      const key = source.report_type_id ?? "__none__";
      const label = source.report_type_name ?? "Unclassified";
      if (!map.has(key)) {
        map.set(key, { label, sources: [] });
      }
      map.get(key)!.sources.push(source);
    }
    return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label));
  })();

  return (
    <section className="overflow-hidden rounded-xl border bg-card/70 shadow-sm backdrop-blur">
      <div className="flex items-center gap-3 border-b bg-gradient-to-r from-amber-200/30 via-orange-200/20 to-transparent px-4 py-3 dark:from-amber-500/10 dark:via-orange-500/10">
        <span className="flex size-9 items-center justify-center rounded-lg border bg-background/70 text-amber-600 dark:text-amber-400">
          <Database className="size-4" />
        </span>
        <div>
          <h2 className="text-sm font-semibold">Active operational sources</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Workbooks currently feeding operational reporting.
          </p>
        </div>
      </div>

      <div className="grid gap-3 p-4">
        <div className="grid grid-cols-3 gap-2">
          <Stat
            icon={<FileSpreadsheet className="size-3.5" />}
            label="Active workbooks"
            value={formatNumber(data?.active_workbook_count)}
          />
          <Stat
            icon={<Layers className="size-3.5" />}
            label="Operational facts"
            value={formatNumber(data?.total_operational_facts)}
          />
          <Stat
            icon={<Clock className="size-3.5" />}
            label="Latest upload"
            value={formatDateTime(data?.latest_upload_at)}
          />
        </div>

        {query.isLoading ? (
          <div className="rounded-lg border border-dashed bg-background/40 px-3 py-6 text-center text-xs text-muted-foreground">
            Loading active sources…
          </div>
        ) : sources.length === 0 ? (
          <div className="rounded-lg border border-dashed bg-background/40 px-3 py-6 text-center text-xs text-muted-foreground">
            No active workbooks are contributing operational facts.
          </div>
        ) : (
          <div className="grid gap-2">
            <div className="grid max-h-72 gap-3 overflow-y-auto pr-1">
              {groups.map((group) => (
                <div className="grid gap-1.5" key={group.label}>
                  <div className="flex items-center gap-2 px-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    <span className="truncate">{group.label}</span>
                    <span className="h-px flex-1 bg-border" />
                    <span className="shrink-0 tabular-nums opacity-70">
                      {group.sources.length}
                    </span>
                  </div>
                  <ul className="grid gap-1.5">
                    {group.sources.map((source) => (
                      <li
                        className="flex items-center justify-between gap-3 rounded-lg border bg-background/55 px-3 py-2"
                        key={source.workbook_id}
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-emerald-300/50 bg-emerald-100/40 text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-900/20 dark:text-emerald-300">
                            <FileSpreadsheet className="size-3.5" />
                          </span>
                          <div className="min-w-0">
                            <div className="truncate text-xs font-medium text-foreground" title={source.filename}>
                              {source.filename}
                            </div>
                            <div className="flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
                              <span>{source.report_date ?? "—"}</span>
                              <span className="opacity-60">·</span>
                              <span>{formatDateTime(source.uploaded_at)}</span>
                            </div>
                          </div>
                        </div>
                        <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium tabular-nums text-primary">
                          {formatNumber(source.operational_fact_count)} facts
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            <p className="text-center text-[11px] text-muted-foreground">
              {sources.length} active {sources.length === 1 ? "workbook" : "workbooks"} feeding
              operational reporting
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

function Stat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border bg-background/55 px-3 py-2">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="mt-1 truncate text-base font-semibold tabular-nums text-foreground">
        {value}
      </div>
    </div>
  );
}
