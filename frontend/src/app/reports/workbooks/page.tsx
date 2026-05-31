import { redirect } from "next/navigation";

/**
 * MD07-4 Phase 1: workbook management is consolidated into Report Grid. The
 * standalone Workbooks route now redirects there so old links keep working.
 */
export default function WorkbookGovernancePage() {
  redirect("/reports/grid");
}
