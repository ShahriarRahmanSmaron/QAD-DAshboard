import type { Report, ReportValueType } from "@/lib/reports/types";

export type ReportTemplateBaseColumnKey = "row_label" | "row_group" | "row_key";

export type ReportTemplateBaseColumn = {
  field: ReportTemplateBaseColumnKey;
  headerName: string;
  minWidth?: number;
  pinned?: "left";
  readonly?: boolean;
};

export type ReportTemplateMetricColumn = {
  key: string;
  label: string;
  valueType: ReportValueType;
  unitOfMeasure?: string | null;
  sectionId?: string;
  readonly?: boolean;
  defaultValue?: string | boolean;
};

export type ReportTemplateSection = {
  id: string;
  label: string;
  rowGroup: string;
  description?: string;
  allowDynamicRows: boolean;
  readonly?: boolean;
};

export type ReportTemplatePinnedRow = {
  id: string;
  label: string;
  position: "top" | "bottom";
  values?: Record<string, string | boolean>;
};

export type ReportTemplateRowRole = "editable" | "readonly" | "summary" | "calculated";

export type ReportTemplateRow = {
  key: string;
  label: string;
  rowGroup: string;
  sourceSheetName?: string | null;
  sourceRowNumber?: number | null;
  role?: ReportTemplateRowRole;
  readonly?: boolean;
  visualLevel?: 0 | 1 | 2;
  metricDefaults?: Record<string, string | boolean>;
};

export type ReportTemplateSummaryBehavior = {
  showRowCount: boolean;
  showMetricCount: boolean;
  pinnedSummaryRows: boolean;
};

export type ReportTemplate = {
  id: string;
  name: string;
  description: string;
  operationalLabel: string;
  match: (report: Report) => boolean;
  baseColumns: ReportTemplateBaseColumn[];
  metricColumns: ReportTemplateMetricColumn[];
  sections: ReportTemplateSection[];
  rows: ReportTemplateRow[];
  pinnedRows: ReportTemplatePinnedRow[];
  readonlyRowKeys?: string[];
  summary: ReportTemplateSummaryBehavior;
};

export function validateReportTemplate(template: ReportTemplate) {
  const errors: string[] = [];
  const sectionIds = new Set<string>();
  const rowGroups = new Set<string>();
  const metricKeys = new Set<string>();

  for (const section of template.sections) {
    if (!section.id.trim()) {
      errors.push(`${template.name} has a section without an id.`);
    }
    if (!section.label.trim()) {
      errors.push(`${template.name} has a section without a label.`);
    }
    if (!section.rowGroup.trim()) {
      errors.push(`${template.name} section "${section.label}" needs a row group.`);
    }
    if (sectionIds.has(section.id)) {
      errors.push(`${template.name} has duplicate section id "${section.id}".`);
    }
    if (rowGroups.has(section.rowGroup.toLowerCase())) {
      errors.push(`${template.name} has duplicate row group "${section.rowGroup}".`);
    }
    sectionIds.add(section.id);
    rowGroups.add(section.rowGroup.toLowerCase());
  }

  for (const metric of template.metricColumns) {
    if (!metric.key.trim()) {
      errors.push(`${template.name} has a metric without a key.`);
    }
    if (!metric.label.trim()) {
      errors.push(`${template.name} metric "${metric.key}" needs a label.`);
    }
    if (metricKeys.has(metric.key.toLowerCase())) {
      errors.push(`${template.name} has duplicate metric key "${metric.key}".`);
    }
    if (metric.sectionId && !sectionIds.has(metric.sectionId)) {
      errors.push(`${template.name} metric "${metric.key}" references an invalid section.`);
    }
    metricKeys.add(metric.key.toLowerCase());
  }

  const rowKeys = new Set<string>();
  for (const row of template.rows) {
    if (!row.key.trim()) {
      errors.push(`${template.name} has a template row without a key.`);
    }
    if (!row.label.trim()) {
      errors.push(`${template.name} row "${row.key}" needs a label.`);
    }
    if (!rowGroups.has(row.rowGroup.toLowerCase())) {
      errors.push(`${template.name} row "${row.key}" references an invalid section.`);
    }
    if (rowKeys.has(row.key.toLowerCase())) {
      errors.push(`${template.name} has duplicate template row key "${row.key}".`);
    }
    rowKeys.add(row.key.toLowerCase());
  }

  return errors;
}
