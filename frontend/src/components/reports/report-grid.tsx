"use client";

import { AgGridReact } from "ag-grid-react";
import {
  AllCommunityModule,
  ModuleRegistry,
  type CellEditRequestEvent,
  type ColDef,
  type GetRowIdParams,
  type GridOptions,
} from "ag-grid-community";
import { Loader2, Save } from "lucide-react";
import { useCallback, useEffect, useMemo, useReducer } from "react";
import { Button } from "@/components/ui/button";
import { bulkSaveReport } from "@/lib/reports/api";
import type {
  BulkRowMetricPayload,
  BulkRowPayload,
  Report,
  ReportMetric,
  ReportRow,
  ReportValueType,
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
  __metricMeta: Record<string, MetricCellMeta>;
  [field: string]: unknown;
};

type GridModel = {
  rows: GridRow[];
  metricColumns: MetricColumn[];
};

type GridState = GridModel & {
  reportId: string | null;
  dirtyRowIds: Set<string>;
  error: string | null;
  message: string | null;
  isSaving: boolean;
};

type GridAction =
  | { type: "load_report"; report: Report | null }
  | { type: "edit_cell"; rowId: string; field: string; value: unknown }
  | { type: "saving" }
  | { type: "save_error"; error: string }
  | { type: "save_success"; report: Report };

type ReportGridProps = {
  isLoading?: boolean;
  report: Report | null;
  onSaved?: (report: Report) => void;
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

function mapReportToGrid(report: Report | null): GridModel {
  if (!report) {
    return { rows: [], metricColumns: [] };
  }

  const metricByKey = new Map<string, ReportMetric>();
  for (const row of report.rows) {
    for (const metric of row.metrics) {
      if (!metricByKey.has(metric.metric_key)) {
        metricByKey.set(metric.metric_key, metric);
      }
    }
  }

  const metricColumns = Array.from(metricByKey.values())
    .sort((left, right) => left.sort_order - right.sort_order || left.metric_key.localeCompare(right.metric_key))
    .map((metric, index) => ({
      field: `metric_${index}_${normalizeFieldPart(metric.metric_key)}`,
      key: metric.metric_key,
      label: metric.metric_label ?? metric.metric_key,
      sortOrder: metric.sort_order,
      valueType: metric.value_type,
      unitOfMeasure: metric.unit_of_measure,
      sourceSheetName: metric.source_sheet_name,
    }));

  const fieldByMetricKey = new Map(metricColumns.map((column) => [column.key, column.field]));

  const rows = report.rows
    .slice()
    .sort((left, right) => left.sort_order - right.sort_order || (left.row_label ?? "").localeCompare(right.row_label ?? ""))
    .map((row) => mapReportRow(row, fieldByMetricKey));

  return { rows, metricColumns };
}

function mapReportRow(row: ReportRow, fieldByMetricKey: Map<string, string>): GridRow {
  const gridRow: GridRow = {
    id: row.id,
    rowId: row.id,
    row_key: row.row_key ?? "",
    row_label: row.row_label ?? "",
    row_group: row.row_group ?? "",
    source_sheet_name: row.source_sheet_name ?? "",
    source_row_number: row.source_row_number,
    sort_order: row.sort_order,
    metadata: row.metadata,
    __dirty: false,
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

  for (const [metricKey, field] of fieldByMetricKey.entries()) {
    if (!(field in gridRow)) {
      gridRow[field] = "";
      gridRow.__metricMeta[field] = {
        key: metricKey,
        label: metricKey,
        sortOrder: 0,
        valueType: "text",
        unitOfMeasure: null,
        sourceSheetName: row.source_sheet_name,
        sourceCellAddress: null,
        metadata: {},
      };
    }
  }

  return gridRow;
}

function gridReducer(state: GridState, action: GridAction): GridState {
  if (action.type === "load_report") {
    const model = mapReportToGrid(action.report);
    return {
      ...model,
      reportId: action.report?.id ?? null,
      dirtyRowIds: new Set(),
      error: null,
      message: null,
      isSaving: false,
    };
  }

  if (action.type === "edit_cell") {
    const dirtyRowIds = new Set(state.dirtyRowIds);
    dirtyRowIds.add(action.rowId);

    return {
      ...state,
      dirtyRowIds,
      message: null,
      error: null,
      rows: state.rows.map((row) =>
        row.id === action.rowId
          ? {
              ...row,
              [action.field]: action.value,
              __dirty: true,
            }
          : row,
      ),
    };
  }

  if (action.type === "saving") {
    return { ...state, isSaving: true, error: null, message: null };
  }

  if (action.type === "save_error") {
    return { ...state, isSaving: false, error: action.error };
  }

  if (action.type === "save_success") {
    const model = mapReportToGrid(action.report);
    return {
      ...model,
      reportId: action.report.id,
      dirtyRowIds: new Set(),
      error: null,
      message: "Saved",
      isSaving: false,
    };
  }

  return state;
}

function initialGridState(): GridState {
  return {
    reportId: null,
    rows: [],
    metricColumns: [],
    dirtyRowIds: new Set(),
    error: null,
    message: null,
    isSaving: false,
  };
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
  return rows.map((row, index) => ({
    row_key: toTrimmedString(row.row_key) || null,
    row_label: toTrimmedString(row.row_label) || null,
    row_group: toTrimmedString(row.row_group) || null,
    sort_order: row.sort_order || index,
    source_sheet_name: toTrimmedString(row.source_sheet_name) || null,
    source_row_number: row.source_row_number,
    metadata: row.metadata,
    metrics: columns.map((column) => buildMetricPayload(row, column)),
  }));
}

export function ReportGrid({ isLoading = false, report, onSaved }: ReportGridProps) {
  const [state, dispatch] = useReducer(gridReducer, undefined, initialGridState);

  useEffect(() => {
    dispatch({ type: "load_report", report });
  }, [report]);

  const defaultColDef = useMemo<ColDef<GridRow>>(
    () => ({
      editable: true,
      minWidth: 120,
      resizable: true,
      sortable: true,
      suppressHeaderMenuButton: true,
    }),
    [],
  );

  const gridOptions = useMemo<GridOptions<GridRow>>(
    () => ({
      animateRows: false,
      readOnlyEdit: true,
      stopEditingWhenCellsLoseFocus: true,
      suppressCellFocus: false,
      suppressDragLeaveHidesColumns: true,
    }),
    [],
  );

  const columnDefs = useMemo<ColDef<GridRow>[]>(
    () => [
      {
        field: "__dirty",
        headerName: "",
        editable: false,
        pinned: "left",
        width: 54,
        minWidth: 54,
        sortable: false,
        valueFormatter: (params) => (params.value ? "*" : ""),
      },
      {
        field: "row_label",
        headerName: "Row",
        pinned: "left",
        minWidth: 190,
      },
      {
        field: "row_group",
        headerName: "Group",
        minWidth: 140,
      },
      {
        field: "row_key",
        headerName: "Key",
        minWidth: 140,
      },
      ...state.metricColumns.map<ColDef<GridRow>>((column) => ({
        field: column.field,
        headerName: column.label,
        minWidth: 150,
        type: column.valueType === "number" ? "rightAligned" : undefined,
      })),
    ],
    [state.metricColumns],
  );

  const getRowId = useCallback((params: GetRowIdParams<GridRow>) => params.data.id, []);

  const onCellEditRequest = useCallback((event: CellEditRequestEvent<GridRow>) => {
    const field = event.colDef.field;
    if (!field || !event.data || event.oldValue === event.newValue) {
      return;
    }
    dispatch({
      type: "edit_cell",
      rowId: event.data.id,
      field,
      value: event.newValue,
    });
  }, []);

  const dirtyCount = state.dirtyRowIds.size;
  const reportMetricCount = report?.metrics.length ?? 0;
  const totalMetricCount = report
    ? report.rows.reduce((total, row) => total + row.metrics.length, reportMetricCount)
    : 0;

  async function handleSave() {
    if (!report || dirtyCount === 0) {
      return;
    }

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
      dispatch({ type: "save_success", report: savedReport });
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
      <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b bg-card/95 px-4 py-3 backdrop-blur">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold">{report.title || report.report_type_name || "Report"}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {report.report_date} / {report.buyer_name ?? "Buyer"} / {report.unit_name ?? "Unit"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden text-sm text-muted-foreground sm:block">
            {state.rows.length} rows / {totalMetricCount} metrics / {dirtyCount} edited
          </div>
          <Button onClick={handleSave} disabled={state.isSaving || dirtyCount === 0}>
            {state.isSaving ? <Loader2 className="size-4 animate-spin" /> : <Save size={16} />}
            {state.isSaving ? "Saving" : "Save"}
          </Button>
        </div>
      </div>

      {(state.error || state.message) && (
        <div className="border-b px-4 py-2 text-sm">
          {state.error ? (
            <span className="text-destructive">{state.error}</span>
          ) : (
            <span className="text-muted-foreground">{state.message}</span>
          )}
        </div>
      )}

      <div className="ag-theme-quartz h-[calc(100vh-17rem)] min-h-[30rem] w-full">
        <AgGridReact<GridRow>
          columnDefs={columnDefs}
          defaultColDef={defaultColDef}
          getRowId={getRowId}
          gridOptions={gridOptions}
          loading={isLoading}
          noRowsOverlayComponent={() => (
            <div className="text-sm text-muted-foreground">No rows in this report.</div>
          )}
          onCellEditRequest={onCellEditRequest}
          rowData={state.rows}
        />
      </div>
    </section>
  );
}
