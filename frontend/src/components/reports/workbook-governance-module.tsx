"use client";

import { ActiveSourcesCard } from "@/components/reports/active-sources-card";
import { WorkbookInventoryPanel } from "@/components/reports/workbook-inventory-panel";
import { WorkbookUploadPanel } from "@/components/reports/workbook-upload-panel";

type Props = {
  isAdmin?: boolean;
};

/**
 * Workbook governance module (MD07-3).
 *
 * Combines the active-sources dashboard card, the upload surface (with the
 * duplicate-upload guard), and the workbook inventory with activation /
 * archive / delete controls.
 */
export function WorkbookGovernanceModule({ isAdmin = false }: Props) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-gradient-to-br from-primary/10 via-accent/10 to-orange-200/20 p-5 shadow-sm dark:from-primary/10 dark:via-accent/10 dark:to-orange-500/10">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          Workbook governance
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Manage which workbooks are active, prevent duplicate uploads, and keep
          operational reporting fed by exactly the right sources.
        </p>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-4">
          <WorkbookUploadPanel />
          <WorkbookInventoryPanel isAdmin={isAdmin} />
        </div>
        <div className="space-y-4">
          <ActiveSourcesCard />
        </div>
      </div>
    </div>
  );
}
