import type { Report } from "@/lib/reports/types";
import type { ReportTemplate } from "@/features/reports/templates/types";
import { validateReportTemplate } from "@/features/reports/templates/types";
import { wfTestShadeTemplate } from "@/features/reports/templates/wf-test-shade";

export type { ReportTemplate } from "@/features/reports/templates/types";

export const reportTemplates = [wfTestShadeTemplate] satisfies ReportTemplate[];

export function resolveReportTemplate(report: Report | null) {
  if (!report) {
    return null;
  }

  return reportTemplates.find((template) => template.match(report)) ?? null;
}

export function validateReportTemplates() {
  return reportTemplates.flatMap((template) => validateReportTemplate(template));
}
