"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import {
  ArrowRight,
  ClipboardCheck,
  Clock,
  Database,
  FileSpreadsheet,
  Layers,
} from "lucide-react";
import { ActiveSourcesCard } from "@/components/reports/active-sources-card";
import { listReportSummaries } from "@/lib/reports/api";
import { useActiveWorkbookSources } from "@/lib/reports/operational-hooks";

const QUICK_LINKS = [
  {
    href: "/reports/grid",
    label: "Report Grid",
    description: "Build reports and manage operational workbooks.",
    icon: ClipboardCheck,
  },
  {
    href: "/reports/operations",
    label: "Operational Query",
    description: "Query, aggregate, and compare operational facts.",
    icon: Database,
  },
];

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
 * Workspace dashboard — executive overview only (MD07-4 Phase 2).
 *
 * Surfaces the high-level operational picture: active reports, active
 * workbooks, total operational facts, and latest upload, alongside the active
 * operational sources card (which lists only active workbooks).
 */
export function DashboardHome({ fullName }: { fullName: string | null }) {
  const sourcesQuery = useActiveWorkbookSources();
  const reportsQuery = useQuery({
    queryKey: ["reports", "summaries", 1, 100],
    queryFn: () => listReportSummaries(1, 100),
    staleTime: 30_000,
  });

  const sources = sourcesQuery.data;
  const activeReports = (reportsQuery.data?.reports ?? []).filter(
    (report) => report.status !== "archived",
  ).length;

  const stats = [
    {
      label: "Active reports",
      value: reportsQuery.isLoading ? "…" : formatNumber(activeReports),
      icon: <ClipboardCheck className="size-3.5" />,
    },
    {
      label: "Active workbooks",
      value: sourcesQuery.isLoading ? "…" : formatNumber(sources?.active_workbook_count),
      icon: <FileSpreadsheet className="size-3.5" />,
    },
    {
      label: "Operational facts",
      value: sourcesQuery.isLoading ? "…" : formatNumber(sources?.total_operational_facts),
      icon: <Layers className="size-3.5" />,
    },
    {
      label: "Latest upload",
      value: sourcesQuery.isLoading ? "…" : formatDateTime(sources?.latest_upload_at),
      icon: <Clock className="size-3.5" />,
    },
  ];

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-xl border bg-gradient-to-br from-primary/15 via-accent/10 to-orange-200/25 p-6 shadow-sm sm:p-8 dark:from-primary/10 dark:via-accent/10 dark:to-orange-500/10">
        <p className="text-sm font-medium text-muted-foreground">DBL QAD Portal</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
          Welcome back{fullName ? `, ${fullName}` : ""}
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
          Your quality assurance workspace for textile operations — workbook
          ingestion, operational intelligence, and auditable reporting in one place.
        </p>
      </section>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map((stat) => (
          <div className="rounded-xl border bg-card/70 px-4 py-3 shadow-sm backdrop-blur" key={stat.label}>
            <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
              {stat.icon}
              {stat.label}
            </div>
            <div className="mt-1 truncate text-lg font-semibold tabular-nums text-foreground">
              {stat.value}
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="grid gap-3 sm:grid-cols-2">
          {QUICK_LINKS.map((link) => (
            <Link
              className="group flex flex-col justify-between rounded-xl border bg-card/70 p-4 shadow-sm backdrop-blur transition hover:border-primary/40 hover:shadow-md"
              href={link.href}
              key={link.href}
            >
              <span className="flex size-9 items-center justify-center rounded-lg border bg-background/70 text-primary">
                <link.icon className="size-4" />
              </span>
              <div className="mt-4">
                <div className="flex items-center gap-1 text-sm font-semibold text-foreground">
                  {link.label}
                  <ArrowRight className="size-3.5 opacity-0 transition group-hover:translate-x-0.5 group-hover:opacity-100" />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{link.description}</p>
              </div>
            </Link>
          ))}
        </div>
        <ActiveSourcesCard />
      </div>
    </div>
  );
}
