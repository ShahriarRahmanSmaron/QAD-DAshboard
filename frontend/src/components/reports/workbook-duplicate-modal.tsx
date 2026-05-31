"use client";

import { AlertTriangle, FileSpreadsheet, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { WorkbookDuplicateInfo } from "@/lib/reports/types";

type Props = {
  info: WorkbookDuplicateInfo | null;
  isReplacing?: boolean;
  onReplace: () => void;
  onCancel: () => void;
};

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
    timeZoneName: "short",
  });
}

/**
 * Duplicate workbook modal (MD07-3 Phase 3).
 *
 * Shown when an upload matches an existing active workbook. The user can
 * Replace (deactivate the old version, activate the new one) or Cancel.
 */
export function WorkbookDuplicateModal({ info, isReplacing, onReplace, onCancel }: Props) {
  if (!info) {
    return null;
  }

  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/30 p-4 backdrop-blur-sm"
      role="dialog"
    >
      <div className="w-full max-w-md overflow-hidden rounded-xl border bg-popover shadow-2xl">
        <div className="flex items-center gap-3 border-b bg-gradient-to-r from-amber-200/40 via-orange-200/20 to-transparent px-4 py-3 dark:from-amber-500/15 dark:via-orange-500/10">
          <span className="flex size-9 items-center justify-center rounded-lg border bg-background/70 text-amber-600 dark:text-amber-400">
            <AlertTriangle className="size-4" />
          </span>
          <div>
            <h3 className="text-sm font-semibold">Workbook already exists</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              An active workbook with the same identity is already loaded.
            </p>
          </div>
        </div>

        <div className="grid gap-3 p-4">
          <div className="flex items-start gap-3 rounded-lg border bg-background/55 p-3">
            <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border bg-background/70 text-primary">
              <FileSpreadsheet className="size-4" />
            </span>
            <div className="min-w-0 text-xs">
              <div className="truncate text-sm font-medium text-foreground">{info.filename}</div>
              <div className="mt-1 grid gap-0.5 text-muted-foreground">
                <span>
                  Report date:{" "}
                  <span className="font-medium text-foreground">{info.report_date ?? "—"}</span>
                </span>
                <span>Uploaded: {formatDateTime(info.uploaded_at)}</span>
              </div>
            </div>
          </div>

          <p className="text-xs leading-5 text-muted-foreground">
            Replacing deactivates the existing workbook and activates this upload, so operational
            facts are never double counted. Only one active version will remain.
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 border-t bg-background/40 px-4 py-3">
          <Button disabled={isReplacing} onClick={onCancel} variant="outline">
            Cancel
          </Button>
          <Button disabled={isReplacing} onClick={onReplace}>
            {isReplacing && <Loader2 className="size-4 animate-spin" />}
            Replace existing
          </Button>
        </div>
      </div>
    </div>
  );
}
