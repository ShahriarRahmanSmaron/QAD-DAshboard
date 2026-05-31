"use client";

import { AlertTriangle, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  filename: string | null;
  isDeleting?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * Hard-delete confirmation modal (MD07-4 Phase 5).
 *
 * Permanent deletion removes the workbook record, its operational facts, its
 * presence in the active source inventory, and from historical comparisons.
 * The wording mirrors the spec so admins understand the action is irreversible.
 */
export function WorkbookDeleteModal({ filename, isDeleting, onConfirm, onCancel }: Props) {
  if (!filename) {
    return null;
  }

  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/30 p-4 backdrop-blur-sm"
      role="dialog"
    >
      <div className="w-full max-w-md overflow-hidden rounded-xl border bg-popover shadow-2xl">
        <div className="flex items-center gap-3 border-b bg-gradient-to-r from-destructive/15 via-destructive/5 to-transparent px-4 py-3">
          <span className="flex size-9 items-center justify-center rounded-lg border bg-background/70 text-destructive">
            <AlertTriangle className="size-4" />
          </span>
          <div>
            <h3 className="text-sm font-semibold">Delete workbook permanently?</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              This action cannot be undone.
            </p>
          </div>
        </div>

        <div className="grid gap-3 p-4">
          <div className="rounded-lg border bg-background/55 px-3 py-2 text-sm font-medium text-foreground">
            {filename}
          </div>
          <div className="text-xs text-muted-foreground">
            This action will:
            <ul className="mt-1.5 grid gap-1">
              <li className="flex items-center gap-2">
                <span className="size-1 rounded-full bg-destructive/60" />
                remove the workbook record
              </li>
              <li className="flex items-center gap-2">
                <span className="size-1 rounded-full bg-destructive/60" />
                remove the workbook facts
              </li>
              <li className="flex items-center gap-2">
                <span className="size-1 rounded-full bg-destructive/60" />
                remove the workbook from active sources
              </li>
              <li className="flex items-center gap-2">
                <span className="size-1 rounded-full bg-destructive/60" />
                remove the workbook from comparisons
              </li>
            </ul>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t bg-background/40 px-4 py-3">
          <Button disabled={isDeleting} onClick={onCancel} size="sm" variant="outline">
            Cancel
          </Button>
          <Button
            className="bg-destructive text-white hover:bg-destructive/90"
            disabled={isDeleting}
            onClick={onConfirm}
            size="sm"
          >
            {isDeleting ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
            Delete Permanently
          </Button>
        </div>
      </div>
    </div>
  );
}
