"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ReportGrid } from "@/components/reports/report-grid";
import { Button } from "@/components/ui/button";
import { getReport, listReportSummaries } from "@/lib/reports/api";
import type { Report, ReportSummary } from "@/lib/reports/types";
import { cn } from "@/lib/utils";

function reportTitle(report: ReportSummary) {
  return report.title || report.report_type_name || report.id;
}

export function ReportGridModule() {
  const queryClient = useQueryClient();
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);

  const summariesQuery = useQuery({
    queryKey: ["reports", "summaries", 1, 50],
    queryFn: () => listReportSummaries(1, 50),
    staleTime: 30_000,
  });

  const summaries = useMemo(
    () => summariesQuery.data?.reports ?? [],
    [summariesQuery.data?.reports],
  );

  useEffect(() => {
    const firstReport = summaries.at(0);
    if (!selectedReportId && firstReport) {
      setSelectedReportId(firstReport.id);
    }
  }, [selectedReportId, summaries]);

  const reportQuery = useQuery({
    queryKey: ["reports", "detail", selectedReportId],
    queryFn: () => getReport(selectedReportId as string),
    enabled: Boolean(selectedReportId),
    staleTime: 10_000,
  });

  function handleSaved(report: Report) {
    setSelectedReportId(report.id);
    void queryClient.invalidateQueries({ queryKey: ["reports", "summaries"] });
    queryClient.setQueryData(["reports", "detail", report.id], report);
  }

  return (
    <div className="grid min-h-[calc(100vh-9rem)] gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
      <aside className="flex min-h-0 flex-col rounded-md border bg-card/70 shadow-sm backdrop-blur">
        <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold">Reports</h2>
            <p className="mt-1 text-xs text-muted-foreground">{summaries.length} loaded</p>
          </div>
          <Button
            aria-label="Refresh reports"
            disabled={summariesQuery.isFetching}
            onClick={() => summariesQuery.refetch()}
            size="icon"
            variant="ghost"
          >
            <RefreshCw className={cn("size-4", summariesQuery.isFetching && "animate-spin")} />
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {summariesQuery.isLoading ? (
            <div className="px-3 py-8 text-sm text-muted-foreground">Loading reports</div>
          ) : summariesQuery.isError ? (
            <div className="px-3 py-8 text-sm text-destructive">
              {(summariesQuery.error as Error).message}
            </div>
          ) : summaries.length === 0 ? (
            <div className="px-3 py-8 text-sm text-muted-foreground">No reports found.</div>
          ) : (
            <div className="space-y-1">
              {summaries.map((report) => (
                <button
                  className={cn(
                    "w-full rounded-md px-3 py-2 text-left text-sm transition hover:bg-secondary",
                    selectedReportId === report.id && "bg-secondary text-foreground",
                  )}
                  key={report.id}
                  onClick={() => setSelectedReportId(report.id)}
                  type="button"
                >
                  <span className="block truncate font-medium">{reportTitle(report)}</span>
                  <span className="mt-1 block truncate text-xs text-muted-foreground">
                    {report.report_date} / {report.buyer_name ?? "Buyer"}
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {report.row_count} rows / {report.metric_count} metrics
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </aside>

      <ReportGrid
        isLoading={reportQuery.isFetching}
        onSaved={handleSaved}
        report={reportQuery.data ?? null}
      />
    </div>
  );
}
