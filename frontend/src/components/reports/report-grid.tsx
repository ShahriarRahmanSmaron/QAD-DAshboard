"use client";

import { AgGridReact } from "ag-grid-react";
import {
  AllCommunityModule,
  ModuleRegistry,
  type CellEditRequestEvent,
  type ColDef,
  type GetRowIdParams,
  type GridOptions,
  type ICellRendererParams,
  type RowClickedEvent,
  type RowStyle,
} from "ag-grid-community";
import {
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Copy,
  Loader2,
  Plus,
  Redo2,
  RotateCcw,
  Save,
  Trash2,
  Undo2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { Button } from "@/components/ui/button";
import type { ReportTemplate } from "@/features/reports/templates";
import { bulkSaveReport } from "@/lib/reports/api";
import type {
  BulkRowMetricPayload,
  BulkRowPayload,
  Report,
  ReportMetric,
  ReportRow,
  ReportValueType,
  ReportWorkflowAction,
} from "@/lib/reports/types";

ModuleRegistry.registerModules([AllCommunityModule]);

type MetricColumn = {
  field: string;
  key: string;
  label: string;
  sortOrder: number;
  valueType: ReportValueType;
  unitOfMeasure: string | null;
  sourceSheetName: string | null;
  readonly?: boolean;
  sectionId?: string;
  templateDefined?: boolean;
  defaultValue?: string | boolean;
};

type MetricCellMeta = {
  key: string;
  label: string | null;
  sortOrder: number;
  valueType: ReportValueType;
  unitOfMeasure: string | null;
  sourceSheetName: string | null;
  sourceCellAddress: string | null;
  metadata: Record<string, unknown>;
};

type GridRow = {
  id: string;
  rowId: string | null;
  row_key: string;
  row_label: string;
  row_group: string;
  source_sheet_name: string;
  source_row_number: number | null;
  sort_order: number;
  metadata: Record<string, unknown>;
  __dirty: boolean;
  __created: boolean;
  __readonly: boolean;
  __rowKind: "data" | "section";
  __rowRole: "editable" | "readonly" | "summary" | "calculated";
  __visualLevel: 0 | 1 | 2;
  __sectionId: string | null;
  __templateRow: boolean;
  __dirtyFields: Record<string, boolean>;
  __metricMeta: Record<string, MetricCellMeta>;
  [field: string]: unknown;
};

type GridModel = {
  rows: GridRow[];
  metricColumns: MetricColumn[];
  pinnedTopRows: GridRow[];
  templateErrors: string[];
};

type MetricDraft = {
  key: string;
  label: string;
  valueType: ReportValueType;
  unitOfMeasure: string;
};

type GridHistorySnapshot = {
  rows: GridRow[];
  metricColumns: MetricColumn[];
  pinnedTopRows: GridRow[];
  selectedRowId: string | null;
  selectedMetricField: string;
  metricDraft: MetricDraft;
  dirtyRowIds: Set<string>;
  createdRowIds: Set<string>;
  updatedRowIds: Set<string>;
  deletedRowIds: Set<string>;
  deletedRows: GridRow[];
};

type GridState = GridModel & {
  baseline: GridModel;
  reportId: string | null;
  selectedRowId: string | null;
  selectedMetricField: string;
  metricDraft: MetricDraft;
  collapsedSectionIds: Set<string>;
  dirtyRowIds: Set<string>;
  createdRowIds: Set<string>;
  updatedRowIds: Set<string>;
  deletedRowIds: Set<string>;
  deletedRows: GridRow[];
  historyPast: GridHistorySnapshot[];
  historyFuture: GridHistorySnapshot[];
  validationErrors: string[];
  error: string | null;
  message: string | null;
  isSaving: boolean;
};

type InsertPosition = "above" | "below" | "end";

type GridAction =
  | { type: "load_report"; report: Report | null; template: ReportTemplate | null }
  | { type: "select_row"; rowId: string | null }
  | { type: "select_metric"; field: string }
  | { type: "edit_metric_draft"; field: keyof MetricDraft; value: string }
  | { type: "edit_cell"; rowId: string; field: string; value: unknown }
  | { type: "add_row"; position: InsertPosition }
  | { type: "duplicate_row"; rowId: string }
  | { type: "delete_row"; rowId: string }
  | { type: "upsert_metric" }
  | { type: "delete_metric"; field: string }
  | { type: "undo_structure" }
  | { type: "redo_structure" }
  | { type: "toggle_section"; sectionId: string }
  | { type: "collapse_all_sections" }
  | { type: "expand_all_sections" }
  | { type: "reset_changes" }
  | { type: "validation_error"; errors: string[] }
  | { type: "saving" }
  | { type: "save_error"; error: string }
  | { type: "save_success"; report: Report; template: ReportTemplate | null };

type ReportGridProps = {
  isLoading?: boolean;
  report: Report | null;
  template?: ReportTemplate | null;
  onDirtyChange?: (hasDirtyChanges: boolean) => void;
  onSaved?: (report: Report) => void;
  onWorkflowAction?: (action: ReportWorkflowAction) => Promise<void> | void;
  isWorkflowTransitioning?: boolean;
};

type GridViewportSnapshot = {
  firstRowId: string | null;
  focusedRowId: string | null;
  focusedColumnId: string | null;
};

const emptyMetricDraft: MetricDraft = {
  key: "",
  label: "",
  valueType: "number",
  unitOfMeasure: "",
};

const workflowReadonlyStatuses = new Set(["in_review", "approved", "locked", "archived"]);

const workflowStatusLabels: Record<Report["status"], string> = {
  draft: "Draft",
  in_review: "In Review",
  approved: "Approved",
  rejected: "Rejected",
  locked: "Locked",
  archived: "Archived",
};

const workflowActionLabels: Record<ReportWorkflowAction, string> = {
  submit_for_review: "Submit",
  approve: "Approve",
  reject: "Reject",
  lock: "Lock",
  archive: "Archive",
};

const workflowActionsByStatus: Record<Report["status"], ReportWorkflowAction[]> = {
  draft: ["submit_for_review", "lock", "archive"],
  in_review: ["approve", "reject", "lock", "archive"],
  approved: ["lock", "archive"],
  rejected: ["submit_for_review", "lock", "archive"],
  locked: ["archive"],
  archived: [],
};

function metricValue(metric: ReportMetric) {
  if (metric.value_type === "number") {
    return metric.value_numeric ?? "";
  }
  if (metric.value_type === "date") {
    return metric.value_date ?? "";
  }
  if (metric.value_type === "boolean") {
    return metric.value_boolean ?? false;
  }
  return metric.value_text ?? "";
}

function normalizeFieldPart(value: string) {
  return value.replace(/[^a-zA-Z0-9_]/g, "_").replace(/^(\d)/, "_$1");
}

function makeMetricField(key: string, existingFields: Set<string>) {
  const base = `metric_${normalizeFieldPart(key.trim() || "new_metric")}`;
  let field = base;
  let index = 2;

  while (existingFields.has(field)) {
    field = `${base}_${index}`;
    index += 1;
  }

  return field;
}

function mapReportToGrid(report: Report | null, template: ReportTemplate | null = null): GridModel {
  if (!report) {
    return { rows: [], metricColumns: [], pinnedTopRows: [], templateErrors: [] };
  }

  const metricByKey = new Map<string, ReportMetric>();
  for (const row of report.rows) {
    for (const metric of row.metrics) {
      if (!metricByKey.has(metric.metric_key)) {
        metricByKey.set(metric.metric_key, metric);
      }
    }
  }

  const usedFields = new Set<string>();
  const templateMetricColumns: MetricColumn[] = [];
  for (const metric of template?.metricColumns ?? []) {
    if (metricByKey.has(metric.key)) {
      continue;
    }
    const field = makeMetricField(metric.key, usedFields);
    usedFields.add(field);
    templateMetricColumns.push({
      field,
      key: metric.key,
      label: metric.label,
      sortOrder: templateMetricColumns.length,
      valueType: metric.valueType,
      unitOfMeasure: metric.unitOfMeasure ?? null,
      sourceSheetName: null,
      readonly: metric.readonly,
      sectionId: metric.sectionId,
      templateDefined: true,
      defaultValue: metric.defaultValue,
    });
  }

  const reportMetricColumns = Array.from(metricByKey.values())
    .sort((left, right) => left.sort_order - right.sort_order || left.metric_key.localeCompare(right.metric_key))
    .map((metric, index) => {
      const field = makeMetricField(metric.metric_key, usedFields);
      usedFields.add(field);
      const templateMetric = template?.metricColumns.find(
        (templateColumn) => templateColumn.key === metric.metric_key,
      );

      return {
        field,
        key: metric.metric_key,
        label: metric.metric_label ?? templateMetric?.label ?? metric.metric_key,
        sortOrder: templateMetricColumns.length + index,
        valueType: templateMetric?.valueType ?? metric.value_type,
        unitOfMeasure: metric.unit_of_measure ?? templateMetric?.unitOfMeasure ?? null,
        sourceSheetName: metric.source_sheet_name,
        readonly: templateMetric?.readonly,
        sectionId: templateMetric?.sectionId,
        templateDefined: Boolean(templateMetric),
        defaultValue: templateMetric?.defaultValue,
      };
    });
  const metricColumns = [...templateMetricColumns, ...reportMetricColumns].map((column, index) => ({
    ...column,
    sortOrder: index,
  }));

  const fieldByMetricKey = new Map(metricColumns.map((column) => [column.key, column.field]));

  const dataRows = report.rows
    .slice()
    .sort((left, right) => left.sort_order - right.sort_order || (left.row_label ?? "").localeCompare(right.row_label ?? ""))
    .map((row) => mapReportRow(row, fieldByMetricKey, metricColumns, template));

  return {
    rows: applyTemplateSections(dataRows, template),
    metricColumns,
    pinnedTopRows: buildPinnedRows(template, metricColumns),
    templateErrors: validateTemplateStructure(template),
  };
}

function stableRowIdFromReportRow(row: ReportRow) {
  const rowKey = row.row_key?.trim();
  if (rowKey) {
    return `report_row_${normalizeFieldPart(rowKey).toLowerCase()}`;
  }

  return `report_row_${row.id}`;
}

function findTemplateRow(rowKey: string, template: ReportTemplate | null) {
  if (!rowKey || !template) {
    return null;
  }

  return template.rows.find((row) => row.key.toLowerCase() === rowKey.toLowerCase()) ?? null;
}

function mapReportRow(
  row: ReportRow,
  fieldByMetricKey: Map<string, string>,
  metricColumns: MetricColumn[],
  template: ReportTemplate | null,
): GridRow {
  const section = findTemplateSection(row.row_group, template);
  const templateRow = findTemplateRow(row.row_key ?? "", template);
  const readonlyRowKeys = new Set(template?.readonlyRowKeys ?? []);
  const rowKey = row.row_key ?? "";
  const isReadonly =
    readonlyRowKeys.has(rowKey) || Boolean(section?.readonly) || Boolean(templateRow?.readonly);
  const rowRole = templateRow?.role ?? (isReadonly ? "readonly" : "editable");
  const gridRow: GridRow = {
    id: stableRowIdFromReportRow(row),
    rowId: row.id,
    row_key: rowKey,
    row_label: row.row_label ?? "",
    row_group: row.row_group ?? section?.rowGroup ?? "",
    source_sheet_name: row.source_sheet_name ?? "",
    source_row_number: row.source_row_number,
    sort_order: row.sort_order,
    metadata: row.metadata,
    __dirty: false,
    __created: false,
    __readonly: isReadonly || rowRole !== "editable",
    __rowKind: "data",
    __rowRole: rowRole,
    __visualLevel: templateRow?.visualLevel ?? (rowRole === "summary" ? 0 : 1),
    __sectionId: section?.id ?? null,
    __templateRow: Boolean(templateRow),
    __dirtyFields: {},
    __metricMeta: {},
  };

  for (const metric of row.metrics) {
    const field = fieldByMetricKey.get(metric.metric_key);
    if (!field) {
      continue;
    }

    gridRow[field] = metricValue(metric);
    gridRow.__metricMeta[field] = {
      key: metric.metric_key,
      label: metric.metric_label,
      sortOrder: metric.sort_order,
      valueType: metric.value_type,
      unitOfMeasure: metric.unit_of_measure,
      sourceSheetName: metric.source_sheet_name,
      sourceCellAddress: metric.source_cell_address,
      metadata: metric.metadata,
    };
  }

  for (const column of metricColumns) {
    const field = fieldByMetricKey.get(column.key);
    if (!field) {
      continue;
    }
    if (!(field in gridRow)) {
      gridRow[field] = defaultMetricValue(column.valueType, column);
      gridRow.__metricMeta[field] = {
        key: column.key,
        label: column.label,
        sortOrder: column.sortOrder,
        valueType: column.valueType,
        unitOfMeasure: column.unitOfMeasure,
        sourceSheetName: row.source_sheet_name,
        sourceCellAddress: null,
        metadata: { templateDefined: Boolean(column.templateDefined) },
      };
    }
  }

  return gridRow;
}

function findTemplateSection(rowGroup: string | null | undefined, template: ReportTemplate | null) {
  if (!rowGroup || !template) {
    return null;
  }
  return template.sections.find((section) => section.rowGroup === rowGroup) ?? null;
}

function applyTemplateSections(rows: GridRow[], template: ReportTemplate | null) {
  if (!template || template.sections.length === 0) {
    return rows;
  }

  const output: GridRow[] = [];
  const consumedRowIds = new Set<string>();

  for (const section of template.sections) {
    output.push(createSectionRow(section.id, section.label, section.rowGroup));
    const sectionRows = rows.filter((row) => row.row_group === section.rowGroup);
    for (const row of sectionRows) {
      const sectionReadonly = Boolean(section.readonly);
      output.push({
        ...row,
        __sectionId: section.id,
        __readonly: row.__readonly || sectionReadonly,
        __rowRole: sectionReadonly && row.__rowRole === "editable" ? "readonly" : row.__rowRole,
      });
      consumedRowIds.add(row.id);
    }
  }

  const ungroupedRows = rows.filter((row) => !consumedRowIds.has(row.id));
  if (ungroupedRows.length > 0) {
    output.push(createSectionRow("unassigned", "Unassigned operational rows", ""));
    output.push(...ungroupedRows);
  }

  return output;
}

function createSectionRow(sectionId: string, label: string, rowGroup: string): GridRow {
  return {
    id: `template_section_${sectionId}`,
    rowId: null,
    row_key: "",
    row_label: label,
    row_group: rowGroup,
    source_sheet_name: "",
    source_row_number: null,
    sort_order: -1,
    metadata: {},
    __dirty: false,
    __created: false,
    __readonly: true,
    __rowKind: "section",
    __rowRole: "summary",
    __visualLevel: 0,
    __sectionId: sectionId,
    __templateRow: true,
    __dirtyFields: {},
    __metricMeta: {},
  };
}

function buildPinnedRows(template: ReportTemplate | null, metricColumns: MetricColumn[]) {
  if (!template?.summary.pinnedSummaryRows) {
    return [];
  }

  return template.pinnedRows
    .filter((row) => row.position === "top")
    .map<GridRow>((row) => {
      const pinnedRow: GridRow = {
        id: `template_pinned_${row.id}`,
        rowId: null,
        row_key: String(row.values?.row_key ?? ""),
        row_label: row.label,
        row_group: String(row.values?.row_group ?? "summary"),
        source_sheet_name: "",
        source_row_number: null,
        sort_order: -1,
        metadata: {},
        __dirty: false,
        __created: false,
        __readonly: true,
        __rowKind: "section",
        __rowRole: "summary",
        __visualLevel: 0,
        __sectionId: "summary",
        __templateRow: true,
        __dirtyFields: {},
        __metricMeta: {},
      };

      for (const column of metricColumns) {
        pinnedRow[column.field] = row.values?.[column.key] ?? "";
      }

      return pinnedRow;
    });
}

function validateTemplateStructure(template: ReportTemplate | null) {
  if (!template) {
    return [];
  }

  const errors: string[] = [];
  const sectionIds = new Set<string>();
  const metricKeys = new Set<string>();

  for (const section of template.sections) {
    if (!section.id || !section.label || !section.rowGroup) {
      errors.push(`Template section "${section.label || section.id}" is incomplete.`);
    }
    if (sectionIds.has(section.id)) {
      errors.push(`Template has duplicate section "${section.id}".`);
    }
    sectionIds.add(section.id);
  }

  for (const metric of template.metricColumns) {
    if (!metric.key || !metric.label) {
      errors.push(`Template metric "${metric.key || metric.label}" is incomplete.`);
    }
    if (metricKeys.has(metric.key.toLowerCase())) {
      errors.push(`Template has duplicate metric "${metric.key}".`);
    }
    if (metric.sectionId && !sectionIds.has(metric.sectionId)) {
      errors.push(`Metric "${metric.key}" points at a missing section.`);
    }
    metricKeys.add(metric.key.toLowerCase());
  }

  return errors;
}

function createDraftRow(
  index: number,
  metricColumns: MetricColumn[],
  existingRows: GridRow[],
  sectionSource?: GridRow,
): GridRow {
  const rowKey = makeUniqueRowKey(`row_${index + 1}`, existingRows);
  const row: GridRow = {
    id: `draft_${crypto.randomUUID()}`,
    rowId: null,
    row_key: rowKey,
    row_label: `New row ${index + 1}`,
    row_group: sectionSource?.row_group ?? "",
    source_sheet_name: "",
    source_row_number: null,
    sort_order: index,
    metadata: {},
    __dirty: true,
    __created: true,
    __readonly: false,
    __rowKind: "data",
    __rowRole: "editable",
    __visualLevel: sectionSource?.__rowKind === "data" ? sectionSource.__visualLevel : 1,
    __sectionId: sectionSource?.__sectionId ?? null,
    __templateRow: false,
    __dirtyFields: {},
    __metricMeta: {},
  };

  for (const column of metricColumns) {
    row[column.field] = defaultMetricValue(column.valueType, column);
    row.__metricMeta[column.field] = metricMetaFromColumn(column);
  }

  return row;
}

function createDuplicateRow(source: GridRow, index: number, existingRows: GridRow[]): GridRow {
  const rowKey = makeUniqueRowKey(source.row_key || source.row_label || "row", existingRows, true);
  const duplicate: GridRow = {
    ...source,
    id: `draft_${crypto.randomUUID()}`,
    rowId: null,
    row_key: rowKey,
    row_label: `${source.row_label || source.row_key || "Row"} copy`,
    sort_order: index,
    __dirty: true,
    __created: true,
    __readonly: false,
    __rowKind: "data",
    __rowRole: "editable",
    __visualLevel: source.__visualLevel,
    __templateRow: false,
    __dirtyFields: { ...source.__dirtyFields },
    __metricMeta: Object.fromEntries(
      Object.entries(source.__metricMeta).map(([field, meta]) => [field, { ...meta }]),
    ),
  };

  return duplicate;
}

function makeUniqueRowKey(value: string, rows: GridRow[], preferCopy = false) {
  const normalizedBase = normalizeFieldPart(value.trim() || "row").toLowerCase();
  const existingKeys = new Set(
    rows
      .map((row) => row.row_key.trim().toLowerCase())
      .filter(Boolean),
  );
  let candidate = preferCopy ? `${normalizedBase}_copy` : normalizedBase;
  let index = 2;

  while (existingKeys.has(candidate)) {
    candidate = preferCopy ? `${normalizedBase}_copy_${index}` : `${normalizedBase}_${index}`;
    index += 1;
  }

  return candidate;
}

function defaultMetricValue(valueType: ReportValueType, column?: MetricColumn) {
  if (column?.defaultValue !== undefined) {
    return column.defaultValue;
  }
  if (valueType === "number") {
    return "0";
  }
  if (valueType === "date") {
    return new Date().toISOString().slice(0, 10);
  }
  if (valueType === "boolean") {
    return false;
  }
  return "";
}

function metricMetaFromColumn(column: MetricColumn): MetricCellMeta {
  return {
    key: column.key,
    label: column.label,
    sortOrder: column.sortOrder,
    valueType: column.valueType,
    unitOfMeasure: column.unitOfMeasure,
    sourceSheetName: column.sourceSheetName,
    sourceCellAddress: null,
    metadata: {},
  };
}

function copyRows(rows: GridRow[]) {
  return rows.map((row) => ({
    ...row,
    __dirtyFields: { ...row.__dirtyFields },
    __metricMeta: Object.fromEntries(
      Object.entries(row.__metricMeta).map(([field, meta]) => [field, { ...meta }]),
    ),
  }));
}

const maxHistoryDepth = 20;

function copyMetricColumns(columns: MetricColumn[]) {
  return columns.map((column) => ({ ...column }));
}

function copyMetricDraft(draft: MetricDraft): MetricDraft {
  return { ...draft };
}

function captureHistorySnapshot(state: GridState): GridHistorySnapshot {
  return {
    rows: copyRows(state.rows),
    metricColumns: copyMetricColumns(state.metricColumns),
    pinnedTopRows: copyRows(state.pinnedTopRows),
    selectedRowId: state.selectedRowId,
    selectedMetricField: state.selectedMetricField,
    metricDraft: copyMetricDraft(state.metricDraft),
    dirtyRowIds: new Set(state.dirtyRowIds),
    createdRowIds: new Set(state.createdRowIds),
    updatedRowIds: new Set(state.updatedRowIds),
    deletedRowIds: new Set(state.deletedRowIds),
    deletedRows: copyRows(state.deletedRows),
  };
}

function restoreHistorySnapshot(
  state: GridState,
  snapshot: GridHistorySnapshot,
  message: string,
): GridState {
  return {
    ...state,
    rows: copyRows(snapshot.rows),
    metricColumns: copyMetricColumns(snapshot.metricColumns),
    pinnedTopRows: copyRows(snapshot.pinnedTopRows),
    selectedRowId: snapshot.selectedRowId,
    selectedMetricField: snapshot.selectedMetricField,
    metricDraft: copyMetricDraft(snapshot.metricDraft),
    dirtyRowIds: new Set(snapshot.dirtyRowIds),
    createdRowIds: new Set(snapshot.createdRowIds),
    updatedRowIds: new Set(snapshot.updatedRowIds),
    deletedRowIds: new Set(snapshot.deletedRowIds),
    deletedRows: copyRows(snapshot.deletedRows),
    validationErrors: [],
    error: null,
    message,
  };
}

function withStructuralHistory(state: GridState, nextState: GridState): GridState {
  return {
    ...nextState,
    historyPast: [...state.historyPast.slice(-(maxHistoryDepth - 1)), captureHistorySnapshot(state)],
    historyFuture: [],
  };
}

function applyCollapsedRows(rows: GridRow[], collapsedSectionIds: Set<string>) {
  const output: GridRow[] = [];
  let hiddenSectionId: string | null = null;

  for (const row of rows) {
    if (row.__rowKind === "section") {
      output.push(row);
      hiddenSectionId =
        row.__sectionId && collapsedSectionIds.has(row.__sectionId) ? row.__sectionId : null;
      continue;
    }

    if (hiddenSectionId && row.__sectionId === hiddenSectionId) {
      continue;
    }

    output.push(row);
  }

  return output;
}

function markRowsChanged(
  state: GridState,
  rows: GridRow[],
  rowIds: string[],
): Pick<GridState, "dirtyRowIds" | "updatedRowIds"> {
  const dirtyRowIds = new Set(state.dirtyRowIds);
  const updatedRowIds = new Set(state.updatedRowIds);

  for (const rowId of rowIds) {
    dirtyRowIds.add(rowId);
    if (!state.createdRowIds.has(rowId)) {
      updatedRowIds.add(rowId);
    }
  }

  return { dirtyRowIds, updatedRowIds };
}

function isEditableDataRow(row: GridRow) {
  return row.__rowKind === "data" && !row.__readonly;
}

function dataRows(rows: GridRow[]) {
  return rows.filter((row) => row.__rowKind === "data");
}

function gridReducer(state: GridState, action: GridAction): GridState {
  if (action.type === "load_report") {
    const model = mapReportToGrid(action.report, action.template);
    return {
      ...model,
      baseline: {
        rows: copyRows(model.rows),
        metricColumns: copyMetricColumns(model.metricColumns),
        pinnedTopRows: copyRows(model.pinnedTopRows),
        templateErrors: [...model.templateErrors],
      },
      reportId: action.report?.id ?? null,
      selectedRowId: dataRows(model.rows)[0]?.id ?? null,
      selectedMetricField: "",
      metricDraft: emptyMetricDraft,
      dirtyRowIds: new Set(),
      createdRowIds: new Set(),
      updatedRowIds: new Set(),
      deletedRowIds: new Set(),
      deletedRows: [],
      collapsedSectionIds: new Set(),
      historyPast: [],
      historyFuture: [],
      validationErrors: [],
      error: null,
      message: null,
      isSaving: false,
    };
  }

  if (action.type === "select_row") {
    return { ...state, selectedRowId: action.rowId };
  }

  if (action.type === "select_metric") {
    const column = state.metricColumns.find((metricColumn) => metricColumn.field === action.field);
    return {
      ...state,
      selectedMetricField: action.field,
      metricDraft: column
        ? {
            key: column.key,
            label: column.label,
            valueType: column.valueType,
            unitOfMeasure: column.unitOfMeasure ?? "",
          }
        : emptyMetricDraft,
      validationErrors: [],
      error: null,
    };
  }

  if (action.type === "edit_metric_draft") {
    return {
      ...state,
      metricDraft: { ...state.metricDraft, [action.field]: action.value },
      validationErrors: [],
      error: null,
      message: null,
    };
  }

  if (action.type === "edit_cell") {
    const targetRow = state.rows.find((row) => row.id === action.rowId);
    if (!targetRow || !isEditableDataRow(targetRow)) {
      return state;
    }

    const changedRows = state.rows.map((row) =>
      row.id === action.rowId
        ? {
            ...row,
            [action.field]: action.value,
            __dirty: true,
            __dirtyFields: { ...row.__dirtyFields, [action.field]: true },
          }
        : row,
    );
    const rowTracking = markRowsChanged(state, changedRows, [action.rowId]);

    return {
      ...state,
      ...rowTracking,
      message: null,
      error: null,
      validationErrors: [],
      rows: changedRows,
    };
  }

  if (action.type === "add_row") {
    const selectedIndex = state.rows.findIndex((row) => row.id === state.selectedRowId);
    const selectedRow = state.rows.find((row) => row.id === state.selectedRowId);
    const insertIndex =
      action.position === "end" || selectedIndex < 0
        ? state.rows.length
        : selectedRow?.__rowKind === "section"
          ? selectedIndex + 1
        : action.position === "above"
          ? selectedIndex
          : selectedIndex + 1;
    const nextRow = createDraftRow(insertIndex, state.metricColumns, state.rows, selectedRow);
    const rows = [
      ...state.rows.slice(0, insertIndex),
      nextRow,
      ...state.rows.slice(insertIndex),
    ];
    const createdRowIds = new Set(state.createdRowIds);
    const dirtyRowIds = new Set(state.dirtyRowIds);
    createdRowIds.add(nextRow.id);
    dirtyRowIds.add(nextRow.id);

    return withStructuralHistory(state, {
      ...state,
      rows,
      selectedRowId: nextRow.id,
      createdRowIds,
      dirtyRowIds,
      validationErrors: [],
      error: null,
      message: null,
    });
  }

  if (action.type === "duplicate_row") {
    const sourceIndex = state.rows.findIndex((row) => row.id === action.rowId);
    const sourceRow = state.rows[sourceIndex];
    if (sourceIndex < 0 || !sourceRow || !isEditableDataRow(sourceRow)) {
      return state;
    }

    const insertIndex = sourceIndex + 1;
    const duplicateRow = createDuplicateRow(sourceRow, insertIndex, state.rows);
    const rows = [
      ...state.rows.slice(0, insertIndex),
      duplicateRow,
      ...state.rows.slice(insertIndex),
    ];
    const createdRowIds = new Set(state.createdRowIds);
    const dirtyRowIds = new Set(state.dirtyRowIds);
    createdRowIds.add(duplicateRow.id);
    dirtyRowIds.add(duplicateRow.id);

    return withStructuralHistory(state, {
      ...state,
      rows,
      selectedRowId: duplicateRow.id,
      createdRowIds,
      dirtyRowIds,
      validationErrors: [],
      error: null,
      message: null,
    });
  }

  if (action.type === "delete_row") {
    const rowToDelete = state.rows.find((row) => row.id === action.rowId);
    if (!rowToDelete || rowToDelete.__rowKind !== "data" || rowToDelete.__readonly) {
      return state;
    }

    const deleteIndex = state.rows.findIndex((row) => row.id === action.rowId);
    const rows = state.rows.filter((row) => row.id !== action.rowId);
    const createdRowIds = new Set(state.createdRowIds);
    const updatedRowIds = new Set(state.updatedRowIds);
    const dirtyRowIds = new Set(state.dirtyRowIds);
    const deletedRowIds = new Set(state.deletedRowIds);
    const deletedRows = [...state.deletedRows];

    if (createdRowIds.has(action.rowId)) {
      createdRowIds.delete(action.rowId);
      dirtyRowIds.delete(action.rowId);
    } else {
      updatedRowIds.delete(action.rowId);
      dirtyRowIds.add(action.rowId);
      deletedRowIds.add(action.rowId);
      deletedRows.push(rowToDelete);
    }

    return withStructuralHistory(state, {
      ...state,
      rows,
      createdRowIds,
      updatedRowIds,
      dirtyRowIds,
      deletedRowIds,
      deletedRows,
      selectedRowId: rows[Math.min(deleteIndex, rows.length - 1)]?.id ?? null,
      validationErrors: [],
      error: null,
      message: null,
    });
  }

  if (action.type === "upsert_metric") {
    const key = state.metricDraft.key.trim();
    if (!key) {
      return { ...state, validationErrors: ["Metric key is required before adding or updating a metric."] };
    }

    if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(key)) {
      return {
        ...state,
        validationErrors: ["Metric key must start with a letter and use only letters, numbers, or underscores."],
      };
    }

    const duplicate = state.metricColumns.some(
      (column) =>
        column.key.trim().toLowerCase() === key.toLowerCase() &&
        column.field !== state.selectedMetricField,
    );
    if (duplicate) {
      return { ...state, validationErrors: [`Metric key "${key}" already exists.`] };
    }

    const changedRowIds = dataRows(state.rows).map((row) => row.id);

    if (state.selectedMetricField) {
      const selectedColumn = state.metricColumns.find(
        (column) => column.field === state.selectedMetricField,
      );
      const rows = state.rows.map((row) => {
        if (row.__rowKind !== "data") {
          return row;
        }
        const nextValue = normalizeValueForType(row[state.selectedMetricField], state.metricDraft.valueType);
        const currentMeta = row.__metricMeta[state.selectedMetricField];
        const nextMeta: MetricCellMeta = {
          key,
          label: state.metricDraft.label.trim() || key,
          sortOrder: currentMeta?.sortOrder ?? selectedColumn?.sortOrder ?? 0,
          valueType: state.metricDraft.valueType,
          unitOfMeasure: state.metricDraft.unitOfMeasure.trim() || null,
          sourceSheetName: currentMeta?.sourceSheetName ?? selectedColumn?.sourceSheetName ?? null,
          sourceCellAddress: currentMeta?.sourceCellAddress ?? null,
          metadata: currentMeta?.metadata ?? {},
        };

        return {
          ...row,
          [state.selectedMetricField]: nextValue,
          __dirty: true,
          __dirtyFields: { ...row.__dirtyFields, [state.selectedMetricField]: true },
          __metricMeta: {
            ...row.__metricMeta,
            [state.selectedMetricField]: nextMeta,
          },
        };
      });
      const rowTracking = markRowsChanged(state, rows, changedRowIds);

      return withStructuralHistory(state, {
        ...state,
        ...rowTracking,
        rows,
        metricColumns: state.metricColumns.map((column) =>
          column.field === state.selectedMetricField
            ? {
                ...column,
                key,
                label: state.metricDraft.label.trim() || key,
                valueType: state.metricDraft.valueType,
                unitOfMeasure: state.metricDraft.unitOfMeasure.trim() || null,
              }
            : column,
        ),
        validationErrors: [],
        error: null,
        message: null,
      });
    }

    const existingFields = new Set(state.metricColumns.map((column) => column.field));
    const column: MetricColumn = {
      field: makeMetricField(key, existingFields),
      key,
      label: state.metricDraft.label.trim() || key,
      sortOrder: state.metricColumns.length,
      valueType: state.metricDraft.valueType,
      unitOfMeasure: state.metricDraft.unitOfMeasure.trim() || null,
      sourceSheetName: null,
    };
    const rows = state.rows.map((row) =>
      row.__rowKind === "data"
        ? {
            ...row,
            [column.field]: defaultMetricValue(column.valueType, column),
            __dirty: true,
            __dirtyFields: { ...row.__dirtyFields, [column.field]: true },
            __metricMeta: {
              ...row.__metricMeta,
              [column.field]: metricMetaFromColumn(column),
            },
          }
        : row,
    );
    const rowTracking = markRowsChanged(state, rows, changedRowIds);

    return withStructuralHistory(state, {
      ...state,
      ...rowTracking,
      rows,
      metricColumns: [...state.metricColumns, column],
      selectedMetricField: column.field,
      metricDraft: {
        key: column.key,
        label: column.label,
        valueType: column.valueType,
        unitOfMeasure: column.unitOfMeasure ?? "",
      },
      validationErrors: [],
      error: null,
      message: null,
    });
  }

  if (action.type === "delete_metric") {
    const column = state.metricColumns.find((metricColumn) => metricColumn.field === action.field);
    if (!column) {
      return state;
    }
    const deletedColumnIndex = state.metricColumns.findIndex(
      (metricColumn) => metricColumn.field === action.field,
    );

    const rows = state.rows.map((row) => {
      if (row.__rowKind !== "data") {
        return row;
      }
      const nextRow = { ...row };
      const metricMeta = { ...row.__metricMeta };
      const dirtyFields = { ...row.__dirtyFields };
      delete nextRow[action.field];
      delete metricMeta[action.field];
      delete dirtyFields[action.field];

      return {
        ...nextRow,
        __dirty: true,
        __dirtyFields: dirtyFields,
        __metricMeta: metricMeta,
      } as GridRow;
    });
    const pinnedTopRows = state.pinnedTopRows.map((row) => {
      const nextRow = { ...row };
      const metricMeta = { ...row.__metricMeta };
      delete nextRow[action.field];
      delete metricMeta[action.field];
      return { ...nextRow, __metricMeta: metricMeta } as GridRow;
    });
    const rowTracking = markRowsChanged(state, rows, dataRows(rows).map((row) => row.id));
    const metricColumns = state.metricColumns
      .filter((metricColumn) => metricColumn.field !== action.field)
      .map((metricColumn, index) => ({ ...metricColumn, sortOrder: index }));
    const nextSelectedMetricField =
      state.selectedMetricField === action.field
        ? metricColumns[Math.min(deletedColumnIndex, metricColumns.length - 1)]?.field ?? ""
        : state.selectedMetricField;
    const nextSelectedMetricColumn = metricColumns.find(
      (metricColumn) => metricColumn.field === nextSelectedMetricField,
    );

    return withStructuralHistory(state, {
      ...state,
      ...rowTracking,
      rows,
      pinnedTopRows,
      metricColumns,
      selectedMetricField: nextSelectedMetricField,
      metricDraft: nextSelectedMetricColumn
        ? {
            key: nextSelectedMetricColumn.key,
            label: nextSelectedMetricColumn.label,
            valueType: nextSelectedMetricColumn.valueType,
            unitOfMeasure: nextSelectedMetricColumn.unitOfMeasure ?? "",
          }
        : emptyMetricDraft,
      validationErrors: [],
      error: null,
      message: null,
    });
  }

  if (action.type === "undo_structure") {
    const previous = state.historyPast.at(-1);
    if (!previous) {
      return state;
    }

    return {
      ...restoreHistorySnapshot(state, previous, "Structural change undone"),
      historyPast: state.historyPast.slice(0, -1),
      historyFuture: [captureHistorySnapshot(state), ...state.historyFuture].slice(0, maxHistoryDepth),
    };
  }

  if (action.type === "redo_structure") {
    const next = state.historyFuture[0];
    if (!next) {
      return state;
    }

    return {
      ...restoreHistorySnapshot(state, next, "Structural change redone"),
      historyPast: [...state.historyPast, captureHistorySnapshot(state)].slice(-maxHistoryDepth),
      historyFuture: state.historyFuture.slice(1),
    };
  }

  if (action.type === "toggle_section") {
    const collapsedSectionIds = new Set(state.collapsedSectionIds);
    if (collapsedSectionIds.has(action.sectionId)) {
      collapsedSectionIds.delete(action.sectionId);
    } else {
      collapsedSectionIds.add(action.sectionId);
    }
    return { ...state, collapsedSectionIds };
  }

  if (action.type === "collapse_all_sections") {
    return {
      ...state,
      collapsedSectionIds: new Set(
        state.rows
          .filter((row) => row.__rowKind === "section" && row.__sectionId)
          .map((row) => row.__sectionId as string),
      ),
    };
  }

  if (action.type === "expand_all_sections") {
    return { ...state, collapsedSectionIds: new Set() };
  }

  if (action.type === "reset_changes") {
    return {
      ...state,
      rows: copyRows(state.baseline.rows),
      metricColumns: copyMetricColumns(state.baseline.metricColumns),
      pinnedTopRows: copyRows(state.baseline.pinnedTopRows),
      selectedRowId: dataRows(state.baseline.rows)[0]?.id ?? null,
      selectedMetricField: "",
      metricDraft: emptyMetricDraft,
      dirtyRowIds: new Set(),
      createdRowIds: new Set(),
      updatedRowIds: new Set(),
      deletedRowIds: new Set(),
      deletedRows: [],
      historyPast: [],
      historyFuture: [],
      validationErrors: [],
      error: null,
      message: "Changes reverted",
      isSaving: false,
    };
  }

  if (action.type === "validation_error") {
    return { ...state, validationErrors: action.errors, error: null, message: null };
  }

  if (action.type === "saving") {
    return { ...state, isSaving: true, error: null, message: null, validationErrors: [] };
  }

  if (action.type === "save_error") {
    return { ...state, isSaving: false, error: action.error };
  }

  if (action.type === "save_success") {
    const model = mapReportToGrid(action.report, action.template);
    const selectedRowId =
      state.selectedRowId && dataRows(model.rows).some((row) => row.id === state.selectedRowId)
        ? state.selectedRowId
        : dataRows(model.rows)[0]?.id ?? null;
    const selectedMetricColumn = state.selectedMetricField
      ? model.metricColumns.find((column) => column.field === state.selectedMetricField)
      : null;
    return {
      ...model,
      baseline: {
        rows: copyRows(model.rows),
        metricColumns: copyMetricColumns(model.metricColumns),
        pinnedTopRows: copyRows(model.pinnedTopRows),
        templateErrors: [...model.templateErrors],
      },
      reportId: action.report.id,
      selectedRowId,
      selectedMetricField: selectedMetricColumn?.field ?? "",
      metricDraft: selectedMetricColumn
        ? {
            key: selectedMetricColumn.key,
            label: selectedMetricColumn.label,
            valueType: selectedMetricColumn.valueType,
            unitOfMeasure: selectedMetricColumn.unitOfMeasure ?? "",
          }
        : emptyMetricDraft,
      collapsedSectionIds: new Set(state.collapsedSectionIds),
      dirtyRowIds: new Set(),
      createdRowIds: new Set(),
      updatedRowIds: new Set(),
      deletedRowIds: new Set(),
      deletedRows: [],
      historyPast: [],
      historyFuture: [],
      validationErrors: [],
      error: null,
      message: "Saved",
      isSaving: false,
    };
  }

  return state;
}

function initialGridState(): GridState {
  const emptyModel: GridModel = { rows: [], metricColumns: [], pinnedTopRows: [], templateErrors: [] };
  return {
    ...emptyModel,
    baseline: emptyModel,
    reportId: null,
    selectedRowId: null,
    selectedMetricField: "",
    metricDraft: emptyMetricDraft,
    collapsedSectionIds: new Set(),
    dirtyRowIds: new Set(),
    createdRowIds: new Set(),
    updatedRowIds: new Set(),
    deletedRowIds: new Set(),
    deletedRows: [],
    historyPast: [],
    historyFuture: [],
    validationErrors: [],
    error: null,
    message: null,
    isSaving: false,
  };
}

function normalizeValueForType(value: unknown, valueType: ReportValueType) {
  if (valueType === "number") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? String(parsed) : "0";
  }
  if (valueType === "date") {
    const textValue = String(value ?? "");
    return /^\d{4}-\d{2}-\d{2}$/.test(textValue) ? textValue : new Date().toISOString().slice(0, 10);
  }
  if (valueType === "boolean") {
    return value === true || value === "true";
  }
  return String(value ?? "");
}

function toTrimmedString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function buildMetricPayload(row: GridRow, column: MetricColumn): BulkRowMetricPayload {
  const meta = row.__metricMeta[column.field];
  const valueType = meta?.valueType ?? column.valueType;
  const value = row[column.field];
  const base: BulkRowMetricPayload = {
    metric_key: meta?.key ?? column.key,
    metric_label: meta?.label ?? column.label,
    value_type: valueType,
    unit_of_measure: meta?.unitOfMeasure ?? column.unitOfMeasure,
    source_sheet_name: meta?.sourceSheetName ?? column.sourceSheetName,
    source_cell_address: meta?.sourceCellAddress ?? null,
    sort_order: meta?.sortOrder ?? column.sortOrder,
    metadata: meta?.metadata ?? {},
  };

  if (valueType === "number") {
    return { ...base, value_numeric: String(value ?? "") };
  }
  if (valueType === "date") {
    return { ...base, value_date: String(value ?? "") };
  }
  if (valueType === "boolean") {
    return { ...base, value_boolean: value === true || value === "true" };
  }
  return { ...base, value_text: String(value ?? "") };
}

function buildRowsPayload(rows: GridRow[], columns: MetricColumn[]): BulkRowPayload[] {
  return dataRows(rows).map((row, index) => ({
    row_key: toTrimmedString(row.row_key) || null,
    row_label: toTrimmedString(row.row_label) || null,
    row_group: toTrimmedString(row.row_group) || null,
    sort_order: index,
    source_sheet_name: toTrimmedString(row.source_sheet_name) || null,
    source_row_number: row.source_row_number,
    metadata: row.metadata,
    metrics: columns.map((column) => buildMetricPayload(row, column)),
  }));
}

function validateGrid(rows: GridRow[], columns: MetricColumn[]) {
  const errors: string[] = [];
  const rowKeys = new Set<string>();
  const metricKeys = new Set<string>();
  const editableRows = dataRows(rows);

  if (editableRows.length === 0) {
    errors.push("Add at least one valid row before saving.");
  }

  for (const [index, row] of editableRows.entries()) {
    const rowKey = toTrimmedString(row.row_key);
    const rowLabel = toTrimmedString(row.row_label);
    if (!rowKey && !rowLabel) {
      errors.push(`Row ${index + 1} needs a row key or label before saving.`);
    }
    if (rowKey) {
      const normalizedKey = rowKey.toLowerCase();
      if (rowKeys.has(normalizedKey)) {
        errors.push(`Duplicate row key "${rowKey}".`);
      }
      rowKeys.add(normalizedKey);
    }
  }

  for (const column of columns) {
    const key = column.key.trim();
    if (!key) {
      errors.push("Each metric needs a key before saving.");
      continue;
    }
    if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(key)) {
      errors.push(`Metric key "${key}" must start with a letter and use only letters, numbers, or underscores.`);
    }

    const normalizedKey = key.toLowerCase();
    if (metricKeys.has(normalizedKey)) {
      errors.push(`Duplicate metric key "${key}".`);
    }
    metricKeys.add(normalizedKey);

    for (const [rowIndex, row] of editableRows.entries()) {
      const value = row[column.field];
      if (column.valueType === "number") {
        const textValue = String(value ?? "").trim();
        if (!textValue || !Number.isFinite(Number(textValue))) {
          errors.push(`${column.label} in row ${rowIndex + 1} needs a number.`);
        }
      }
      if (column.valueType === "date") {
        const textValue = String(value ?? "").trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(textValue)) {
          errors.push(`${column.label} in row ${rowIndex + 1} needs YYYY-MM-DD.`);
        }
      }
    }
  }

  return errors;
}

export function ReportGrid({
  isLoading = false,
  report,
  template = null,
  onDirtyChange,
  onSaved,
  onWorkflowAction,
  isWorkflowTransitioning = false,
}: ReportGridProps) {
  const gridRef = useRef<AgGridReact<GridRow>>(null);
  const lastMetricFieldSignatureRef = useRef("");
  const viewportSnapshotRef = useRef<GridViewportSnapshot | null>(null);
  const [state, dispatch] = useReducer(gridReducer, undefined, initialGridState);

  const hasUnsavedChanges =
    state.createdRowIds.size > 0 ||
    state.updatedRowIds.size > 0 ||
    state.deletedRowIds.size > 0 ||
    state.dirtyRowIds.size > 0;
  const isWorkflowReadonly = Boolean(report && workflowReadonlyStatuses.has(report.status));

  const visibleRows = useMemo(
    () => applyCollapsedRows(state.rows, state.collapsedSectionIds),
    [state.collapsedSectionIds, state.rows],
  );

  useEffect(() => {
    dispatch({ type: "load_report", report, template });
  }, [report, template]);

  useEffect(() => {
    onDirtyChange?.(hasUnsavedChanges);
  }, [hasUnsavedChanges, onDirtyChange]);

  useEffect(() => {
    if (!hasUnsavedChanges) {
      return;
    }

    function handleBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasUnsavedChanges]);

  useEffect(() => {
    if (!hasUnsavedChanges) {
      return;
    }

    function handleDocumentClick(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }

      const link = target.closest("a[href]");
      if (!link || !window.location.origin) {
        return;
      }

      const href = link.getAttribute("href");
      if (!href || href.startsWith("#")) {
        return;
      }

      if (!window.confirm("Discard unsaved grid changes and leave this report?")) {
        event.preventDefault();
        event.stopPropagation();
      }
    }

    document.addEventListener("click", handleDocumentClick, true);
    return () => document.removeEventListener("click", handleDocumentClick, true);
  }, [hasUnsavedChanges]);

  const captureGridViewport = useCallback(() => {
    const api = gridRef.current?.api;
    if (!api) {
      viewportSnapshotRef.current = null;
      return;
    }

    const firstDisplayedIndex = api.getFirstDisplayedRowIndex();
    const focusedCell = api.getFocusedCell();
    viewportSnapshotRef.current = {
      firstRowId: api.getDisplayedRowAtIndex(firstDisplayedIndex)?.data?.id ?? null,
      focusedRowId:
        typeof focusedCell?.rowIndex === "number"
          ? api.getDisplayedRowAtIndex(focusedCell.rowIndex)?.data?.id ?? null
          : null,
      focusedColumnId: focusedCell?.column.getColId() ?? null,
    };
  }, []);

  const restoreGridViewport = useCallback(() => {
    const snapshot = viewportSnapshotRef.current;
    const api = gridRef.current?.api;
    if (!snapshot || !api) {
      return false;
    }

    const firstRowIndex = snapshot.firstRowId
      ? visibleRows.findIndex((row) => row.id === snapshot.firstRowId)
      : -1;
    const focusedRowIndex = snapshot.focusedRowId
      ? visibleRows.findIndex((row) => row.id === snapshot.focusedRowId)
      : -1;

    window.requestAnimationFrame(() => {
      if (firstRowIndex >= 0) {
        api.ensureIndexVisible(firstRowIndex, "top");
      }
      if (focusedRowIndex >= 0 && snapshot.focusedColumnId) {
        api.setFocusedCell(focusedRowIndex, snapshot.focusedColumnId);
      }
      viewportSnapshotRef.current = null;
    });

    return true;
  }, [visibleRows]);

  useEffect(() => {
    if (state.message === "Saved") {
      restoreGridViewport();
    }
  }, [restoreGridViewport, state.message]);

  useEffect(() => {
    if (!state.selectedRowId) {
      return;
    }
    if (viewportSnapshotRef.current) {
      return;
    }

    const api = gridRef.current?.api;
    const rowIndex = visibleRows.findIndex((row) => row.id === state.selectedRowId);
    if (!api || rowIndex < 0) {
      return;
    }

    api.ensureIndexVisible(rowIndex, "middle");
  }, [state.selectedRowId, visibleRows]);

  const metricFieldSignature = state.metricColumns.map((column) => column.field).join("|");

  useEffect(() => {
    if (lastMetricFieldSignatureRef.current === metricFieldSignature) {
      return;
    }
    lastMetricFieldSignatureRef.current = metricFieldSignature;

    const api = gridRef.current?.api;
    if (!api || !state.selectedRowId) {
      return;
    }

    const rowIndex = visibleRows.findIndex((row) => row.id === state.selectedRowId);
    if (rowIndex < 0) {
      return;
    }

    const availableColumnIds = new Set([
      "__dirty",
      "__row_number",
      "row_label",
      "row_group",
      "row_key",
      ...state.metricColumns.map((column) => column.field),
    ]);
    const focusedColumnId = api.getFocusedCell()?.column.getColId();
    const nextColumnId =
      focusedColumnId && availableColumnIds.has(focusedColumnId)
        ? focusedColumnId
        : state.selectedMetricField && availableColumnIds.has(state.selectedMetricField)
          ? state.selectedMetricField
          : "row_label";

    window.requestAnimationFrame(() => {
      api.setFocusedCell(rowIndex, nextColumnId);
    });
  }, [metricFieldSignature, state.metricColumns, state.selectedMetricField, state.selectedRowId, visibleRows]);

  const defaultColDef = useMemo<ColDef<GridRow>>(
    () => ({
      editable: (params) => Boolean(params.data && !isWorkflowReadonly && isEditableDataRow(params.data)),
      lockVisible: true,
      suppressMovable: true,
      minWidth: 120,
      resizable: true,
      sortable: true,
      suppressHeaderMenuButton: true,
      cellStyle: (params) => {
        const field = params.colDef.field ?? params.column.getColId();
        if (!params.data || !field) {
          return null;
        }

        const style: Record<string, string | number> = {};

        if (field === "row_label" && params.data.__visualLevel > 0) {
          style.paddingLeft = `${12 + params.data.__visualLevel * 14}px`;
        }

        if (params.data.__dirtyFields[field]) {
          style.background = "color-mix(in oklch, var(--accent) 26%, transparent)";
          style.boxShadow = "inset 0 -2px 0 color-mix(in oklch, var(--primary) 42%, transparent)";
        }

        return Object.keys(style).length > 0 ? style : null;
      },
    }),
    [isWorkflowReadonly],
  );

  const gridOptions = useMemo<GridOptions<GridRow>>(
    () => ({
      animateRows: false,
      enterNavigatesVertically: true,
      enterNavigatesVerticallyAfterEdit: true,
      readOnlyEdit: true,
      singleClickEdit: false,
      stopEditingWhenCellsLoseFocus: true,
      suppressCellFocus: false,
      suppressDragLeaveHidesColumns: true,
      suppressMaintainUnsortedOrder: false,
      suppressColumnVirtualisation: false,
      suppressScrollOnNewData: true,
      rowBuffer: 24,
      getRowStyle: (params) => {
        if (params.data?.__rowKind === "section") {
          const sectionStyle: RowStyle = {
            background: "color-mix(in oklch, var(--secondary) 86%, transparent)",
            borderBottom: "1px solid var(--border)",
            borderTop: "1px solid var(--border)",
            color: "var(--foreground)",
            fontWeight: "700",
          };
          return sectionStyle;
        }

        if (params.data?.__rowRole === "summary") {
          const summaryStyle: RowStyle = {
            background: "color-mix(in oklch, var(--muted) 68%, transparent)",
            color: "var(--foreground)",
            fontWeight: "700",
          };
          return summaryStyle;
        }

        if (params.data?.__rowRole === "calculated") {
          const calculatedStyle: RowStyle = {
            background: "color-mix(in oklch, var(--secondary) 48%, transparent)",
            color: "var(--foreground)",
            fontWeight: "600",
          };
          return calculatedStyle;
        }

        if (params.data?.__rowRole === "readonly") {
          const readonlyStyle: RowStyle = {
            background: "color-mix(in oklch, var(--muted) 36%, transparent)",
            color: "var(--muted-foreground)",
            fontWeight: "500",
          };
          return readonlyStyle;
        }

        if (params.data?.__dirty) {
          const dirtyStyle: RowStyle = {
            background: "color-mix(in oklch, var(--accent) 18%, transparent)",
          };
          return dirtyStyle;
        }

        if (params.data?.__templateRow && params.data.__visualLevel === 2) {
          const childTemplateStyle: RowStyle = {
            background: "color-mix(in oklch, var(--background) 78%, var(--muted))",
          };
          return childTemplateStyle;
        }

        return undefined;
      },
    }),
    [],
  );

  const deleteRow = useCallback((rowId: string) => {
    if (!window.confirm("Delete this row? The row and its metric values will be removed when you save.")) {
      return;
    }
    dispatch({ type: "delete_row", rowId });
  }, []);

  const duplicateRow = useCallback((rowId: string) => {
    dispatch({ type: "duplicate_row", rowId });
  }, []);

  const baseColumnConfig = useMemo(() => {
    const defaults = new Map<string, { headerName: string; minWidth: number }>([
      ["row_label", { headerName: "Row", minWidth: 190 }],
      ["row_group", { headerName: "Group", minWidth: 140 }],
      ["row_key", { headerName: "Key", minWidth: 140 }],
    ]);

    for (const column of template?.baseColumns ?? []) {
      defaults.set(column.field, {
        headerName: column.headerName,
        minWidth: column.minWidth ?? defaults.get(column.field)?.minWidth ?? 140,
      });
    }

    return defaults;
  }, [template]);

  const columnDefs = useMemo<ColDef<GridRow>[]>(
    () => [
      {
        field: "__dirty",
        headerName: "State",
        editable: false,
        pinned: "left",
        width: 86,
        minWidth: 86,
        lockPinned: true,
        sortable: false,
        valueFormatter: (params) => {
          if (!params.data) {
            return "";
          }
          if (params.data.__created) {
            return params.data.id === state.selectedRowId ? "> New" : "New";
          }
          if (params.value) {
            return params.data.id === state.selectedRowId ? "> Edited" : "Edited";
          }
          return params.data.id === state.selectedRowId ? ">" : "";
        },
      },
      {
        colId: "__row_number",
        headerName: "#",
        editable: false,
        pinned: "left",
        width: 62,
        minWidth: 62,
        lockPinned: true,
        sortable: false,
        valueGetter: (params) => {
          if (params.data?.__rowKind === "section") {
            return "";
          }
          return params.data?.source_row_number ?? (
            typeof params.node?.rowIndex === "number" ? params.node.rowIndex + 1 : ""
          );
        },
      },
      {
        field: "row_label",
        headerName: baseColumnConfig.get("row_label")?.headerName ?? "Row",
        editable: (params) => Boolean(params.data && !isWorkflowReadonly && isEditableDataRow(params.data)),
        pinned: "left",
        lockPinned: true,
        minWidth: baseColumnConfig.get("row_label")?.minWidth ?? 190,
        cellRenderer: (params: ICellRendererParams<GridRow>) => {
          if (params.data?.__rowKind !== "section") {
            return params.value ?? "";
          }

          const sectionId = params.data.__sectionId;
          const isCollapsed = sectionId ? state.collapsedSectionIds.has(sectionId) : false;
          const Icon = isCollapsed ? ChevronRight : ChevronDown;

          return (
            <button
              className="flex h-full w-full items-center gap-2 text-left font-semibold"
              onClick={(event) => {
                event.stopPropagation();
                if (sectionId) {
                  dispatch({ type: "toggle_section", sectionId });
                }
              }}
              type="button"
            >
              <Icon className="size-4 text-muted-foreground" />
              <span className="truncate">{params.value ?? ""}</span>
            </button>
          );
        },
      },
      {
        field: "row_group",
        headerName: baseColumnConfig.get("row_group")?.headerName ?? "Group",
        editable: (params) =>
          Boolean(params.data && !isWorkflowReadonly && isEditableDataRow(params.data) && !params.data.__templateRow),
        pinned: "left",
        lockPinned: true,
        minWidth: baseColumnConfig.get("row_group")?.minWidth ?? 140,
      },
      {
        field: "row_key",
        headerName: baseColumnConfig.get("row_key")?.headerName ?? "Key",
        editable: (params) =>
          Boolean(params.data && !isWorkflowReadonly && isEditableDataRow(params.data) && !params.data.__templateRow),
        pinned: "left",
        lockPinned: true,
        minWidth: baseColumnConfig.get("row_key")?.minWidth ?? 140,
      },
      ...state.metricColumns.map<ColDef<GridRow>>((column) => ({
        field: column.field,
        colId: column.field,
        editable: (params) => Boolean(params.data && !isWorkflowReadonly && isEditableDataRow(params.data) && !column.readonly),
        headerName: column.unitOfMeasure ? `${column.label} (${column.unitOfMeasure})` : column.label,
        minWidth: 150,
        type: column.valueType === "number" ? "rightAligned" : undefined,
      })),
      {
        colId: "__actions",
        headerName: "",
        editable: false,
        pinned: "right",
        width: 94,
        minWidth: 94,
        sortable: false,
        cellRenderer: (params: ICellRendererParams<GridRow>) => {
          const canEditRow = Boolean(params.data && !isWorkflowReadonly && isEditableDataRow(params.data));

          return (
            <div className="flex items-center gap-1">
              <button
                aria-label="Duplicate row"
                className={`inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition hover:bg-secondary hover:text-foreground ${
                  canEditRow ? "" : "cursor-not-allowed opacity-40"
                }`}
                disabled={!canEditRow}
                onClick={(event) => {
                  event.stopPropagation();
                  if (params.data) {
                    duplicateRow(params.data.id);
                  }
                }}
                type="button"
              >
                <Copy size={15} />
              </button>
              <button
                aria-label="Delete row"
                className={`inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition hover:bg-secondary hover:text-destructive ${
                  canEditRow ? "" : "cursor-not-allowed opacity-40"
                }`}
                disabled={!canEditRow}
                onClick={(event) => {
                  event.stopPropagation();
                  if (params.data) {
                    deleteRow(params.data.id);
                  }
                }}
                type="button"
              >
                <Trash2 size={15} />
              </button>
            </div>
          );
        },
      },
    ],
    [
      baseColumnConfig,
      deleteRow,
      duplicateRow,
      isWorkflowReadonly,
      state.collapsedSectionIds,
      state.metricColumns,
      state.selectedRowId,
    ],
  );

  const getRowId = useCallback((params: GetRowIdParams<GridRow>) => params.data.id, []);

  const onCellEditRequest = useCallback((event: CellEditRequestEvent<GridRow>) => {
    const field = event.colDef.field;
    if (!field || field.startsWith("__") || !event.data || event.oldValue === event.newValue) {
      return;
    }
    dispatch({
      type: "edit_cell",
      rowId: event.data.id,
      field,
      value: event.newValue,
    });
  }, []);

  const onRowClicked = useCallback((event: RowClickedEvent<GridRow>) => {
    if (event.data?.__rowKind === "section" && event.data.__sectionId) {
      dispatch({ type: "toggle_section", sectionId: event.data.__sectionId });
      return;
    }
    dispatch({ type: "select_row", rowId: event.data?.id ?? null });
  }, []);

  const dirtyCount = state.dirtyRowIds.size;
  const selectedMetricColumn = state.metricColumns.find(
    (column) => column.field === state.selectedMetricField,
  );
  const selectedRow = state.rows.find((row) => row.id === state.selectedRowId);
  const selectedRowCanEdit = Boolean(selectedRow && selectedRow.__rowKind === "data" && !selectedRow.__readonly);
  const reportMetricCount = report?.metrics.length ?? 0;
  const editableRowCount = dataRows(state.rows).length;
  const totalMetricCount = editableRowCount * state.metricColumns.length + reportMetricCount;

  async function handleSave() {
    if (!report || !hasUnsavedChanges || isWorkflowReadonly) {
      return;
    }

    const validationErrors = [...state.templateErrors, ...validateGrid(state.rows, state.metricColumns)];
    if (validationErrors.length > 0) {
      dispatch({ type: "validation_error", errors: validationErrors.slice(0, 6) });
      return;
    }

    captureGridViewport();
    dispatch({ type: "saving" });

    try {
      const savedReport = await bulkSaveReport({
        report_type_id: report.report_type_id,
        buyer_id: report.buyer_id,
        unit_id: report.unit_id,
        report_date: report.report_date,
        period_start: report.period_start,
        period_end: report.period_end,
        title: report.title,
        remarks: report.remarks,
        metadata: report.metadata,
        rows: buildRowsPayload(state.rows, state.metricColumns),
        metrics: report.metrics.map((metric) => buildMetricPayload(
          {
            id: `report_metric_${metric.id}`,
            rowId: null,
            row_key: "",
            row_label: "",
            row_group: "",
            source_sheet_name: metric.source_sheet_name ?? "",
            source_row_number: null,
            sort_order: 0,
            metadata: {},
            __dirty: false,
            __created: false,
            __readonly: false,
            __rowKind: "data",
            __rowRole: "editable",
            __visualLevel: 1,
            __sectionId: null,
            __templateRow: false,
            __dirtyFields: {},
            __metricMeta: {
              report_metric: {
                key: metric.metric_key,
                label: metric.metric_label,
                sortOrder: metric.sort_order,
                valueType: metric.value_type,
                unitOfMeasure: metric.unit_of_measure,
                sourceSheetName: metric.source_sheet_name,
                sourceCellAddress: metric.source_cell_address,
                metadata: metric.metadata,
              },
            },
            report_metric: metricValue(metric),
          },
          {
            field: "report_metric",
            key: metric.metric_key,
            label: metric.metric_label ?? metric.metric_key,
            sortOrder: metric.sort_order,
            valueType: metric.value_type,
            unitOfMeasure: metric.unit_of_measure,
            sourceSheetName: metric.source_sheet_name,
          },
        )),
      });
      dispatch({ type: "save_success", report: savedReport, template });
      onSaved?.(savedReport);
    } catch (saveError) {
      dispatch({
        type: "save_error",
        error: saveError instanceof Error ? saveError.message : "Unable to save report.",
      });
    }
  }

  if (isLoading) {
    return (
      <div className="flex min-h-[34rem] items-center justify-center rounded-md border bg-card/70">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading report
        </div>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="flex min-h-[34rem] items-center justify-center rounded-md border bg-card/70 text-sm text-muted-foreground">
        No report selected.
      </div>
    );
  }

  return (
    <section className="flex min-h-[34rem] flex-1 flex-col overflow-hidden rounded-md border bg-card/70 shadow-sm backdrop-blur">
      <div className="sticky top-0 z-10 flex flex-col gap-3 border-b bg-card/95 px-4 py-3 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold">{report.title || report.report_type_name || "Report"}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {report.report_date} / {report.buyer_name ?? "Buyer"} / {report.unit_name ?? "Unit"}
              {template ? ` / ${template.operationalLabel}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md border bg-background/70 px-3 py-2 text-sm text-muted-foreground">
              {editableRowCount} rows / {totalMetricCount} metrics
            </span>
            {report.status && (
              <span className="rounded-md border bg-background/70 px-3 py-2 text-sm font-medium">
                {workflowStatusLabels[report.status]}
              </span>
            )}
            <span
              className={`rounded-md border px-3 py-2 text-sm ${
                hasUnsavedChanges
                  ? "border-primary/30 bg-primary/10 text-foreground"
                  : "bg-background/70 text-muted-foreground"
              }`}
            >
              {dirtyCount} dirty / {state.createdRowIds.size} new / {state.updatedRowIds.size} updated / {state.deletedRowIds.size} deleted
            </span>
            <Button
              onClick={() => {
                if (window.confirm("Discard all unsaved grid changes?")) {
                  dispatch({ type: "reset_changes" });
                }
              }}
              disabled={!hasUnsavedChanges || state.isSaving}
              variant="outline"
            >
              <RotateCcw size={16} />
              Reset
            </Button>
            <Button onClick={handleSave} disabled={state.isSaving || !hasUnsavedChanges || isWorkflowReadonly}>
              {state.isSaving ? <Loader2 className="size-4 animate-spin" /> : <Save size={16} />}
              {state.isSaving ? "Saving" : "Save"}
            </Button>
            {workflowActionsByStatus[report.status].map((action) => (
              <Button
                disabled={isWorkflowTransitioning || hasUnsavedChanges}
                key={action}
                onClick={() => {
                  if (
                    window.confirm(
                      `${workflowActionLabels[action]} this report? Unsaved grid changes must be saved or reset first.`,
                    )
                  ) {
                    void onWorkflowAction?.(action);
                  }
                }}
                variant={action === "approve" ? "default" : "outline"}
              >
                {isWorkflowTransitioning ? <Loader2 className="size-4 animate-spin" /> : null}
                {workflowActionLabels[action]}
              </Button>
            ))}
          </div>
        </div>

        {isWorkflowReadonly && (
          <div className="rounded-md border bg-muted/35 px-3 py-2 text-sm text-muted-foreground">
            This report is {workflowStatusLabels[report.status].toLowerCase()} and is open in read-only workflow mode.
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            disabled={isWorkflowReadonly}
            onClick={() => dispatch({ type: "add_row", position: "end" })}
            variant="outline"
          >
            <Plus size={16} />
            Add row
          </Button>
          <Button
            onClick={() => dispatch({ type: "add_row", position: "above" })}
            disabled={!state.selectedRowId || isWorkflowReadonly}
            variant="outline"
          >
            <ChevronsUpDown size={16} />
            Insert above
          </Button>
          <Button
            onClick={() => dispatch({ type: "add_row", position: "below" })}
            disabled={!state.selectedRowId || isWorkflowReadonly}
            variant="outline"
          >
            <ChevronsDownUp size={16} />
            Insert below
          </Button>
          <Button
            onClick={() => state.selectedRowId && dispatch({ type: "duplicate_row", rowId: state.selectedRowId })}
            disabled={!selectedRowCanEdit || isWorkflowReadonly}
            variant="outline"
          >
            <Copy size={16} />
            Duplicate
          </Button>
          <Button
            onClick={() => state.selectedRowId && deleteRow(state.selectedRowId)}
            disabled={!selectedRowCanEdit || isWorkflowReadonly}
            variant="outline"
          >
            <Trash2 size={16} />
            Delete row
          </Button>
          <Button
            onClick={() => dispatch({ type: "undo_structure" })}
            disabled={state.historyPast.length === 0 || state.isSaving || isWorkflowReadonly}
            variant="outline"
          >
            <Undo2 size={16} />
            Undo
          </Button>
          <Button
            onClick={() => dispatch({ type: "redo_structure" })}
            disabled={state.historyFuture.length === 0 || state.isSaving || isWorkflowReadonly}
            variant="outline"
          >
            <Redo2 size={16} />
            Redo
          </Button>
          <Button
            onClick={() => dispatch({ type: "collapse_all_sections" })}
            disabled={state.rows.every((row) => row.__rowKind !== "section")}
            variant="outline"
          >
            <ChevronRight size={16} />
            Collapse
          </Button>
          <Button
            onClick={() => dispatch({ type: "expand_all_sections" })}
            disabled={state.collapsedSectionIds.size === 0}
            variant="outline"
          >
            <ChevronDown size={16} />
            Expand
          </Button>
        </div>

        <div className="grid gap-2 md:grid-cols-[10rem_minmax(9rem,1fr)_minmax(9rem,1fr)_8rem_8rem_auto_auto]">
          <select
            className="h-10 rounded-md border bg-background/70 px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
            value={state.selectedMetricField}
            onChange={(event) => dispatch({ type: "select_metric", field: event.target.value })}
          >
            <option value="">New metric</option>
            {state.metricColumns.map((column) => (
              <option key={column.field} value={column.field}>
                {column.label}
              </option>
            ))}
          </select>
          <input
            className="h-10 rounded-md border bg-background/70 px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
            disabled={isWorkflowReadonly}
            onChange={(event) => dispatch({ type: "edit_metric_draft", field: "key", value: event.target.value })}
            placeholder="Metric key"
            value={state.metricDraft.key}
          />
          <input
            className="h-10 rounded-md border bg-background/70 px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
            disabled={isWorkflowReadonly}
            onChange={(event) => dispatch({ type: "edit_metric_draft", field: "label", value: event.target.value })}
            placeholder="Metric label"
            value={state.metricDraft.label}
          />
          <select
            className="h-10 rounded-md border bg-background/70 px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
            disabled={isWorkflowReadonly}
            value={state.metricDraft.valueType}
            onChange={(event) =>
              dispatch({
                type: "edit_metric_draft",
                field: "valueType",
                value: event.target.value as ReportValueType,
              })
            }
          >
            <option value="number">Number</option>
            <option value="text">Text</option>
            <option value="date">Date</option>
            <option value="boolean">Boolean</option>
          </select>
          <input
            className="h-10 rounded-md border bg-background/70 px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
            disabled={isWorkflowReadonly}
            onChange={(event) =>
              dispatch({ type: "edit_metric_draft", field: "unitOfMeasure", value: event.target.value })
            }
            placeholder="Unit"
            value={state.metricDraft.unitOfMeasure}
          />
          <Button disabled={isWorkflowReadonly} onClick={() => dispatch({ type: "upsert_metric" })} variant="outline">
            {selectedMetricColumn ? "Update" : "Add"} metric
          </Button>
          <Button
            onClick={() => {
              if (!state.selectedMetricField || !selectedMetricColumn) {
                return;
              }

              const affectedRows = dataRows(state.rows).length;
              const typedKey = window.prompt(
                `Delete metric "${selectedMetricColumn.label}" from ${affectedRows} rows? Type ${selectedMetricColumn.key} to confirm.`,
              );

              if (typedKey === selectedMetricColumn.key) {
                dispatch({ type: "delete_metric", field: state.selectedMetricField });
              }
            }}
            disabled={!state.selectedMetricField || isWorkflowReadonly}
            variant="outline"
          >
            <Trash2 size={16} />
            Metric
          </Button>
        </div>
      </div>

      {(state.error || state.message || state.validationErrors.length > 0) && (
        <div className="border-b px-4 py-2 text-sm">
          {state.error ? (
            <span className="text-destructive">{state.error}</span>
          ) : state.validationErrors.length > 0 ? (
            <div className="text-destructive">{state.validationErrors.join(" ")}</div>
          ) : (
            <span className="text-muted-foreground">{state.message}</span>
          )}
        </div>
      )}

      <div className="ag-theme-quartz h-[calc(100vh-22rem)] min-h-[30rem] w-full">
        <AgGridReact<GridRow>
          columnDefs={columnDefs}
          defaultColDef={defaultColDef}
          getRowId={getRowId}
          gridOptions={gridOptions}
          loading={isLoading}
          noRowsOverlayComponent={() => (
            <div className="text-sm text-muted-foreground">
              No rows yet. Use Add row to start the report grid.
            </div>
          )}
          onCellEditRequest={onCellEditRequest}
          onRowClicked={onRowClicked}
          pinnedTopRowData={state.pinnedTopRows}
          reactiveCustomComponents
          rowData={visibleRows}
          theme="legacy"
        />
      </div>
    </section>
  );
}
