export type ReportStatus = "draft" | "in_review" | "approved" | "rejected" | "locked" | "archived";
export type ReportWorkflowAction = "submit_for_review" | "approve" | "reject" | "lock" | "archive";
export type ReportValueType = "text" | "number" | "date" | "boolean";

export type ReportMetric = {
  id: string;
  report_id: string;
  row_id: string | null;
  metric_key: string;
  metric_label: string | null;
  value_type: ReportValueType;
  value_numeric: string | null;
  value_text: string | null;
  value_date: string | null;
  value_boolean: boolean | null;
  unit_of_measure: string | null;
  source_sheet_name: string | null;
  source_cell_address: string | null;
  sort_order: number;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type ReportRow = {
  id: string;
  report_id: string;
  owner_user_id: string | null;
  row_key: string | null;
  row_label: string | null;
  row_group: string | null;
  sort_order: number;
  source_sheet_name: string | null;
  source_row_number: number | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  metrics: ReportMetric[];
};

export type Report = {
  id: string;
  report_type_id: string;
  report_type_name: string | null;
  buyer_id: string;
  buyer_name: string | null;
  unit_id: string;
  unit_name: string | null;
  owner_user_id: string | null;
  report_date: string;
  period_start: string | null;
  period_end: string | null;
  status: ReportStatus;
  title: string | null;
  remarks: string | null;
  submitted_at: string | null;
  submitted_by_user_id: string | null;
  approved_at: string | null;
  approved_by_user_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  rows: ReportRow[];
  metrics: ReportMetric[];
};

export type ReportListResponse = {
  reports: Report[];
  total: number;
  page: number;
  page_size: number;
};

export type ReportCreatePayload = {
  report_type_id: string;
  buyer_id: string;
  unit_id: string;
  report_date: string;
  period_start?: string | null;
  period_end?: string | null;
  title?: string | null;
  remarks?: string | null;
  metadata?: Record<string, unknown>;
};

export type ReportRowCreatePayload = {
  row_key?: string | null;
  row_label?: string | null;
  row_group?: string | null;
  sort_order: number;
  source_sheet_name?: string | null;
  source_row_number?: number | null;
  metadata?: Record<string, unknown>;
};

export type ReportMetricCreatePayload = {
  row_id?: string | null;
  metric_key: string;
  metric_label?: string | null;
  value_type: ReportValueType;
  value_numeric?: string | null;
  value_text?: string | null;
  value_date?: string | null;
  value_boolean?: boolean | null;
  unit_of_measure?: string | null;
  source_sheet_name?: string | null;
  source_cell_address?: string | null;
  sort_order: number;
  metadata?: Record<string, unknown>;
};


// ---------------------------------------------------------------------------
// Bulk save types
// ---------------------------------------------------------------------------

export type BulkRowMetricPayload = {
  metric_key: string;
  metric_label?: string | null;
  value_type: ReportValueType;
  value_numeric?: string | null;
  value_text?: string | null;
  value_date?: string | null;
  value_boolean?: boolean | null;
  unit_of_measure?: string | null;
  source_sheet_name?: string | null;
  source_cell_address?: string | null;
  sort_order: number;
  metadata?: Record<string, unknown>;
};

export type BulkRowPayload = {
  row_key?: string | null;
  row_label?: string | null;
  row_group?: string | null;
  sort_order: number;
  source_sheet_name?: string | null;
  source_row_number?: number | null;
  metadata?: Record<string, unknown>;
  metrics: BulkRowMetricPayload[];
};

export type BulkReportSavePayload = {
  report_type_id: string;
  buyer_id: string;
  unit_id: string;
  report_date: string;
  period_start?: string | null;
  period_end?: string | null;
  title?: string | null;
  remarks?: string | null;
  metadata?: Record<string, unknown>;
  rows: BulkRowPayload[];
  metrics?: BulkRowMetricPayload[];
};


// ---------------------------------------------------------------------------
// Report summary (lightweight list DTO)
// ---------------------------------------------------------------------------

export type ReportSummary = {
  id: string;
  report_type_id: string;
  report_type_name: string | null;
  buyer_id: string;
  buyer_name: string | null;
  unit_id: string;
  unit_name: string | null;
  owner_user_id: string | null;
  report_date: string;
  period_start: string | null;
  period_end: string | null;
  status: ReportStatus;
  title: string | null;
  remarks: string | null;
  submitted_at: string | null;
  submitted_by_user_id: string | null;
  approved_at: string | null;
  approved_by_user_id: string | null;
  row_count: number;
  metric_count: number;
  created_at: string;
  updated_at: string;
};

export type ReportSummaryListResponse = {
  reports: ReportSummary[];
  total: number;
  page: number;
  page_size: number;
};


export type BuyerOption = {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
};

export type UnitOption = {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
};

export type ReportTypeOption = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  version: number;
  is_active: boolean;
};

export type BuyerListResponse = {
  buyers: BuyerOption[];
};

export type UnitListResponse = {
  units: UnitOption[];
};

export type ReportTypeListResponse = {
  report_types: ReportTypeOption[];
};

export type WorkbookCellPreview = {
  address: string;
  row: number;
  column: number;
  value: string | number | boolean | null;
  formula: string | null;
  data_type: string;
  style: Record<string, unknown>;
};

export type WorkbookRegionPreview = {
  id: string;
  label: string;
  kind: string;
  range: string;
  start_row: number;
  end_row: number;
  start_column: number;
  end_column: number;
  metadata: Record<string, unknown>;
};

export type WorkbookSyncRegion = {
  id: string;
  kind: string;
  range: string;
  start_row: number;
  end_row: number;
  start_column: number;
  end_column: number;
};

export type WorkbookSyncMergedRegion = {
  range: string;
  master: string;
  start_row: number;
  end_row: number;
  start_column: number;
  end_column: number;
  span: {
    rows: number;
    columns: number;
  };
};

export type WorkbookSyncRow = {
  workbook_row: number;
  grid_row_id: string;
  role: "editable" | "readonly" | "structural";
  editable: boolean;
  hidden: boolean;
  height: number | null;
  outline_level: number;
  region_ids: string[];
};

export type WorkbookSyncColumn = {
  workbook_column: number;
  workbook_column_name: string;
  grid_field: string;
  width: number | null;
  hidden: boolean;
  outline_level: number;
  frozen: boolean;
};

export type WorkbookSyncCell = {
  address: string;
  workbook_row: number;
  workbook_column: number;
  grid_row_id: string;
  grid_field: string;
  region_ids: string[];
  editable: boolean;
  readonly_reason: string | null;
  has_formula: boolean;
  merge: {
    role: "master" | "covered";
    master: string;
    range: string;
    span: {
      rows: number;
      columns: number;
    };
  } | null;
};

export type WorkbookSheetSync = {
  version: number;
  grid_engine: string;
  sheet_name: string;
  layout_fingerprint: string;
  preview_limits: {
    max_rows: number;
    max_columns: number;
  };
  geometry: Record<string, unknown>;
  regions: {
    editable: WorkbookSyncRegion[];
    readonly: WorkbookSyncRegion[];
    structural: WorkbookSyncRegion[];
    merged: WorkbookSyncMergedRegion[];
  };
  rows: WorkbookSyncRow[];
  columns: WorkbookSyncColumn[];
  cells: WorkbookSyncCell[];
  degraded?: boolean;
  degraded_reason?: string | null;
};

export type WorkbookSheetPreview = {
  name: string;
  index: number;
  dimension: string;
  max_row: number;
  max_column: number;
  non_empty_cell_count: number;
  formula_count: number;
  structure: {
    merged_cells: string[];
    row_heights: Record<string, number>;
    column_widths: Record<string, number>;
    hidden_rows: number[];
    hidden_columns: string[];
    freeze_panes: string | null;
    row_groups: Record<string, number>;
    column_groups: Record<string, number>;
    sheet_state: string;
  };
  workbook_view: {
    freeze_panes: Record<string, unknown>;
    grid_lines: boolean | null;
    zoom_scale: number | null;
  };
  regions: WorkbookRegionPreview[];
  cells: WorkbookCellPreview[];
  sync: WorkbookSheetSync;
  degraded?: boolean;
  degraded_reason?: string | null;
};

export type WorkbookParsePreview = {
  filename: string;
  sheet_count: number;
  parser: string;
  preview_limits: Record<string, unknown>;
  workbook_sync: Record<string, unknown>;
  sheets: WorkbookSheetPreview[];
  degraded_sheets?: string[];
};

export type WorkbookUploadResponse = {
  uploaded_file_id: string;
  original_filename: string;
  file_size_bytes: number;
  metadata: WorkbookParsePreview;
};
