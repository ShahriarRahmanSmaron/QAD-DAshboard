"use client";

import { FileSpreadsheet, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { WorkbookInventoryItem } from "@/lib/reports/types";

type Props = {
  workbook: WorkbookInventoryItem | null;
  onClose: () => void;
};

function formatNumber(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return "0";
  }
  return new Intl.NumberFormat("en-US").format(value);
}

function formatBytes(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return "—";
  }
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
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
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function workbookStatusLabel(workbook: WorkbookInventoryItem) {
  if (workbook.archived_at) {
    return "Archived";
  }
  if (workbook.is_active_workbook) {
    return "Active";
  }
  return "Inactive";
}

/**
 * Workbook details modal (MD07-4 Phase 4 "View Details" action).
 *
 * Read-only inspection of a single workbook's governance metadata so users can
 * confirm exactly what a given upload contributes before acting on it.
 */
export function WorkbookDetailsModal({ workbook, onClose }: Props) {
  if (!workbook) {
    return null;
  }

  const rows: { label: string; value: string }[] = [
    { label: "Filename", value: workbook.filename },
    { label: "Report date", value: workbook.report_date ?? "—" },
    { label: "Report type", value: workbook.report_type_name ?? "—" },
    { label: "Status", value: workbookStatusLabel(workbook) },
    { label: "Uploaded", value: formatDateTime(workbook.uploaded_at) },
    { label: "Processed", value: workbook.processed ? "Yes" : "No" },
    {
      label: "Operational facts",
      value: `${formatNumber(workbook.operational_fact_count)} facts`,
    },
    { label: "File size", value: formatBytes(workbook.file_size_bytes) },
    { label: "Workbook ID", value: workbook.workbook_id },
  ];

  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/30 p-4 backdrop-blur-sm"
      role="dialog"
    >
      <div className="w-full max-w-md overflow-hidden rounded-xl border bg-popover shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b bg-gradient-to-r from-primary/10 via-accent/10 to-transparent px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-background/70 text-primary">
              <FileSpreadsheet className="size-4" />
            </span>
            <div className="min-w-0">
              <h3 className="truncate text-sm font-semibold">Workbook details</h3>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {workbook.filename}
              </p>
            </div>
          </div>
          <Button aria-label="Close" onClick={onClose} size="icon-sm" variant="ghost">
            <X className="size-4" />
          </Button>
        </div>

        <dl className="grid gap-px bg-border/60 p-px">
          {rows.map((row) => (
            <div
              className="grid grid-cols-[9rem_minmax(0,1fr)] gap-3 bg-popover px-4 py-2"
              key={row.label}
            >
              <dt className="text-xs text-muted-foreground">{row.label}</dt>
              <dd className="truncate text-xs font-medium text-foreground" title={row.value}>
                {row.value}
              </dd>
            </div>
          ))}
        </dl>

        <div className="flex items-center justify-end gap-2 border-t bg-background/40 px-4 py-3">
          <Button onClick={onClose} size="sm" variant="outline">
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
