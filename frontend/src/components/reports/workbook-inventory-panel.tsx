"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  ArchiveRestore,
  CheckCircle2,
  Database,
  FileSpreadsheet,
  Loader2,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  activateWorkbook,
  archiveWorkbook,
  deactivateWorkbook,
  deleteWorkbook,
  restoreWorkbook,
  type WorkbookInventoryScope,
} from "@/lib/reports/api";
import { useWorkbookInventory } from "@/lib/reports/operational-hooks";
import type { WorkbookInventoryItem } from "@/lib/reports/types";
import { cn } from "@/lib/utils";

type Props = {
  isAdmin?: boolean;
};

const SCOPE_TABS: { value: WorkbookInventoryScope; label: string }[] = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "archived", label: "Archived" },
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
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Workbook Inventory panel (MD07-3 Phases 1, 2, 5).
 *
 * Surfaces actual uploaded workbooks (not report templates) with their
 * governance state and live operational-fact counts. Each workbook can be
 * activated/deactivated, archived/restored, and (for admins) soft-deleted.
 */
export function WorkbookInventoryPanel({ isAdmin = false }: Props) {
  const queryClient = useQueryClient();
  const [scope, setScope] = useState<WorkbookInventoryScope>("all");
  const inventory = useWorkbookInventory(scope);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const workbooks = useMemo(
    () => inventory.data?.workbooks ?? [],
    [inventory.data?.workbooks],
  );

  function invalidateGovernance() {
    void queryClient.invalidateQueries({ queryKey: ["workbooks"] });
    void queryClient.invalidateQueries({ queryKey: ["operations"] });
  }

  async function runAction(
    id: string,
    action: () => Promise<unknown>,
    confirmMessage?: string,
  ) {
    if (confirmMessage && !window.confirm(confirmMessage)) {
      return;
    }
    setActionError(null);
    setPendingId(id);
    try {
      await action();
      invalidateGovernance();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Action failed.");
    } finally {
      setPendingId(null);
    }
  }

  return (
    <section className="overflow-hidden rounded-xl border bg-card/70 shadow-sm backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-gradient-to-r from-primary/10 via-accent/10 to-transparent px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-lg border bg-background/70 text-primary">
            <Database className="size-4" />
          </span>
          <div>
            <h2 className="text-sm font-semibold">Workbook inventory</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Actual uploaded workbooks contributing to operational reporting.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-lg border bg-background/60 p-0.5">
            {SCOPE_TABS.map((tab) => {
              const count =
                tab.value === "active"
                  ? inventory.data?.active_count
                  : tab.value === "archived"
                    ? inventory.data?.archived_count
                    : inventory.data?.total;
              return (
                <button
                  className={cn(
                    "rounded-md px-2.5 py-1 text-xs font-medium transition",
                    scope === tab.value
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  key={tab.value}
                  onClick={() => setScope(tab.value)}
                  type="button"
                >
                  {tab.label}
                  {count !== undefined && (
                    <span className="ml-1 opacity-70">{count}</span>
                  )}
                </button>
              );
            })}
          </div>
          <Button
            aria-label="Refresh inventory"
            disabled={inventory.isFetching}
            onClick={() => inventory.refetch()}
            size="icon"
            variant="ghost"
          >
            <RefreshCw className={cn("size-4", inventory.isFetching && "animate-spin")} />
          </Button>
        </div>
      </div>

      <div className="p-4">
        {actionError && (
          <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {actionError}
          </div>
        )}

        {inventory.isError ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {(inventory.error as Error)?.message ?? "Unable to load workbook inventory."}
          </div>
        ) : inventory.isLoading ? (
          <div className="flex items-center gap-2 px-1 py-8 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading workbooks…
          </div>
        ) : workbooks.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed bg-background/40 px-6 py-12 text-center">
            <FileSpreadsheet className="size-8 text-muted-foreground/60" />
            <p className="mt-3 text-sm font-medium text-foreground">No workbooks here yet</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {scope === "archived"
                ? "Archived workbooks will appear here."
                : "Upload an XLSX workbook to populate the inventory."}
            </p>
          </div>
        ) : (
          <div className="grid gap-2">
            {workbooks.map((workbook) => (
              <WorkbookInventoryRow
                isAdmin={isAdmin}
                key={workbook.workbook_id}
                onActivate={() =>
                  runAction(workbook.workbook_id, () => activateWorkbook(workbook.workbook_id))
                }
                onArchive={() =>
                  runAction(
                    workbook.workbook_id,
                    () => archiveWorkbook(workbook.workbook_id),
                    `Archive "${workbook.filename}"? It will be excluded from all reporting.`,
                  )
                }
                onDeactivate={() =>
                  runAction(workbook.workbook_id, () => deactivateWorkbook(workbook.workbook_id))
                }
                onDelete={() =>
                  runAction(
                    workbook.workbook_id,
                    () => deleteWorkbook(workbook.workbook_id),
                    `Delete "${workbook.filename}"? This soft-deletes the workbook and its operational facts. Audit history is preserved.`,
                  )
                }
                onRestore={() =>
                  runAction(workbook.workbook_id, () => restoreWorkbook(workbook.workbook_id))
                }
                pending={pendingId === workbook.workbook_id}
                workbook={workbook}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function WorkbookInventoryRow({
  workbook,
  pending,
  isAdmin,
  onActivate,
  onDeactivate,
  onArchive,
  onRestore,
  onDelete,
}: {
  workbook: WorkbookInventoryItem;
  pending: boolean;
  isAdmin: boolean;
  onActivate: () => void;
  onDeactivate: () => void;
  onArchive: () => void;
  onRestore: () => void;
  onDelete: () => void;
}) {
  const isArchived = Boolean(workbook.archived_at);
  const isActive = workbook.is_active_workbook && !isArchived;

  return (
    <div
      className={cn(
        "grid grid-cols-1 gap-3 rounded-lg border bg-background/55 p-3 transition hover:border-primary/40 hover:bg-background/80 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center",
        isArchived && "opacity-70",
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        <span
          className={cn(
            "mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg border",
            isActive
              ? "border-emerald-300/50 bg-emerald-100/40 text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-900/20 dark:text-emerald-300"
              : "bg-muted/50 text-muted-foreground",
          )}
        >
          <FileSpreadsheet className="size-4" />
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium text-foreground">
              {workbook.filename}
            </span>
            <StatusBadge isActive={isActive} isArchived={isArchived} />
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            <span>
              Report date:{" "}
              <span className="font-medium text-foreground">
                {workbook.report_date ?? "—"}
              </span>
            </span>
            <span>Uploaded: {formatDateTime(workbook.uploaded_at)}</span>
            {workbook.report_type_name && <span>Type: {workbook.report_type_name}</span>}
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary">
              {formatNumber(workbook.operational_fact_count)} facts
            </span>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-end gap-1.5">
        {pending && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
        {isArchived ? (
          <Button disabled={pending} onClick={onRestore} variant="outline">
            <ArchiveRestore className="size-4" />
            Restore
          </Button>
        ) : isActive ? (
          <Button disabled={pending} onClick={onDeactivate} variant="outline">
            <PauseCircle className="size-4" />
            Deactivate
          </Button>
        ) : (
          <Button disabled={pending} onClick={onActivate} variant="outline">
            <PlayCircle className="size-4" />
            Activate
          </Button>
        )}
        {!isArchived && (
          <Button
            aria-label="Archive workbook"
            disabled={pending}
            onClick={onArchive}
            size="icon"
            title="Archive workbook"
            variant="ghost"
          >
            <Archive className="size-4" />
          </Button>
        )}
        {isAdmin && (
          <Button
            aria-label="Delete workbook"
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            disabled={pending}
            onClick={onDelete}
            size="icon"
            title="Delete workbook (admin)"
            variant="ghost"
          >
            <Trash2 className="size-4" />
          </Button>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ isActive, isArchived }: { isActive: boolean; isArchived: boolean }) {
  if (isArchived) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-amber-300/50 bg-amber-100/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800 dark:border-amber-400/30 dark:bg-amber-900/20 dark:text-amber-200">
        <Archive className="size-3" />
        Archived
      </span>
    );
  }
  if (isActive) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300/50 bg-emerald-100/50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-800 dark:border-emerald-400/30 dark:bg-emerald-900/20 dark:text-emerald-200">
        <CheckCircle2 className="size-3" />
        Active
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border bg-muted/50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
      <PauseCircle className="size-3" />
      Inactive
    </span>
  );
}
