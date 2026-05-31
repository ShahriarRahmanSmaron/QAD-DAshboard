"use client";

import { ActiveSourcesCard } from "@/components/reports/active-sources-card";
import { WorkbookInventoryPanel } from "@/components/reports/workbook-inventory-panel";
import { WorkbookUploadPanel } from "@/components/reports/workbook-upload-panel";

/**
 * Workbook Manager (MD07-5 Phase 3).
 *
 * Replaces the legacy report-builder / draft-report workflow. Operational
 * reporting is now entirely workbook-driven, so this surface only exposes the
 * workbook lifecycle: upload, inventory (with view details / archive / delete /
 * activate / replace), and the active operational sources card.
 *
 * No draft report templates, workflow-state dropdowns, or report-selection
 * logic remain — those legacy artifacts have been removed.
 */
export function ReportGridModule({ isAdmin = false }: { isAdmin?: boolean }) {
  return (
    <div className="min-w-0 space-y-4">
      <WorkbookUploadPanel />
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <WorkbookInventoryPanel isAdmin={isAdmin} />
        <ActiveSourcesCard />
      </div>
    </div>
  );
}
