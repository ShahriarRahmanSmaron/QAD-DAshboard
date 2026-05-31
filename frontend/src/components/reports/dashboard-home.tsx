"use client";

import Link from "next/link";
import { ArrowRight, ClipboardCheck, Database, FileSpreadsheet } from "lucide-react";
import { ActiveSourcesCard } from "@/components/reports/active-sources-card";

const QUICK_LINKS = [
  {
    href: "/reports/workbooks",
    label: "Workbooks",
    description: "Upload, activate, and govern operational workbooks.",
    icon: FileSpreadsheet,
  },
  {
    href: "/reports/operations",
    label: "Operational Query",
    description: "Query, aggregate, and compare operational facts.",
    icon: Database,
  },
  {
    href: "/reports/grid",
    label: "Report Grid",
    description: "Build and review structured report submissions.",
    icon: ClipboardCheck,
  },
];

/**
 * Workspace dashboard (MD07-3 Phase 6 surfaces the Active Sources card here).
 */
export function DashboardHome({ fullName }: { fullName: string | null }) {
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

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="grid gap-3 sm:grid-cols-3">
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
