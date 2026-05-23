export type ReportStatus = "draft" | "submitted" | "approved" | "rejected" | "archived";
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
