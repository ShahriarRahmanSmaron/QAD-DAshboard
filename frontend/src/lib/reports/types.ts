export type ReportStatus = "draft" | "in_review" | "approved" | "rejected" | "locked" | "archived";
export type ReportWorkflowAction = "submit_for_review" | "approve" | "reject" | "lock" | "archive";
export type ReportValueType = "text" | "number" | "date" | "boolean";
export type OperationalValueType = ReportValueType | "blank";

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

export type OperationalFact = {
  id: string;
  uploaded_file_id: string;
  report_id: string | null;
  buyer_id: string | null;
  unit_id: string | null;
  buyer: string | null;
  unit: string | null;
  report_date: string | null;
  metric_key: string;
  metric_label: string;
  operational_section: string;
  operational_section_label: string;
  operational_row_key: string | null;
  operational_row_label: string | null;
  column_label: string | null;
  value_type: OperationalValueType;
  value_numeric: string | number | null;
  value_text: string | null;
  value_date: string | null;
  value_boolean: boolean | null;
  unit_of_measure: string | null;
  is_formula: boolean;
  formula: string | null;
  calculated_state: string;
  source_sheet_name: string;
  source_sheet_index: number | null;
  source_cell_address: string;
  source_row_number: number;
  source_column_number: number;
  source_region_id: string | null;
  source_region_kind: string | null;
  source_region_range: string | null;
  workbook_sheet_identity: Record<string, unknown>;
  workbook_source: Record<string, unknown>;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type OperationalFactListResponse = {
  facts: OperationalFact[];
  total: number;
  page: number;
  page_size: number;
};

export type OperationalSummaryRow = {
  metric_key: string;
  metric_label: string;
  operational_section: string;
  buyer: string | null;
  unit: string | null;
  report_date: string | null;
  fact_count: number;
  numeric_total: string | number | null;
  formula_count: number;
};

export type OperationalSummaryResponse = {
  rows: OperationalSummaryRow[];
  total: number;
};

// ---------------------------------------------------------------------------
// Operational query layer (MD07-2)
// ---------------------------------------------------------------------------

export type OperationalAggregationRow = {
  group: Record<string, string | number | null>;
  numeric_total: string | number | null;
  fact_count: number;
  formula_count: number;
  numeric_count: number;
};

export type OperationalAggregationTotals = {
  numeric_total: string | number | null;
  fact_count: number;
  formula_count: number;
  numeric_count: number;
};

export type OperationalAggregationResponse = {
  group_by: string[];
  rows: OperationalAggregationRow[];
  totals: OperationalAggregationTotals;
  total: number;
};

export type OperationalTrendPoint = {
  report_date: string;
  numeric_total: string | number | null;
  fact_count: number;
  numeric_count: number;
};

export type OperationalTrendResponse = {
  metric_key: string;
  buyer: string | null;
  unit: string | null;
  operational_section: string | null;
  points: OperationalTrendPoint[];
  total: number;
};

export type OperationalComparisonTotals = {
  numeric_total: string | number | null;
  fact_count: number;
  numeric_count: number;
};

export type OperationalComparisonResponse = {
  metric_key: string;
  buyer: string | null;
  unit: string | null;
  operational_section: string | null;
  current_date: string;
  previous_date: string | null;
  current: OperationalComparisonTotals;
  previous: OperationalComparisonTotals;
  delta: string | number | null;
  delta_percent: number | null;
  direction: "up" | "down" | "flat";
};

export type OperationalDimensionOption = {
  value: string;
  label: string;
};

export type OperationalDimensionsResponse = {
  buyers: OperationalDimensionOption[];
  units: OperationalDimensionOption[];
  metrics: OperationalDimensionOption[];
  sections: OperationalDimensionOption[];
  dates: OperationalDimensionOption[];
};

export type OperationalFactTraceWorkbook = {
  uploaded_file_id: string;
  original_filename: string | null;
  storage_bucket: string | null;
  storage_path: string | null;
  report_type_id: string | null;
  buyer_id: string | null;
  unit_id: string | null;
  uploaded_at: string | null;
  workbook_source: Record<string, unknown>;
};

export type OperationalFactTraceResponse = {
  fact: OperationalFact;
  workbook: OperationalFactTraceWorkbook;
  sheet_name: string;
  sheet_index: number | null;
  cell_address: string;
  operational_section: string;
  operational_section_label: string;
  source_region_id: string | null;
  source_region_kind: string | null;
  source_region_range: string | null;
  extraction_confidence: Record<string, unknown>;
  extraction_source: string | null;
  ownership?: SemanticOwnership;
  upload_timestamp: string | null;
};

export type WorkbookSemanticRegion = {
  id: string;
  sheet_name: string;
  section: string;
  section_label: string;
  metric_key: string;
  metric_label: string;
  source_region_id?: string | null;
  source_region_kind?: string | null;
  range: string;
  start_row: number;
  end_row: number;
  start_column: number;
  end_column: number;
  fact_count: number;
  metadata: Record<string, unknown>;
};

export type SemanticConfidenceBand =
  | "explicit"
  | "inferred"
  | "ambiguous"
  | "unmapped";

export type SemanticOwnershipSource =
  | "merged_inheritance"
  | "grouping_block"
  | "column_header"
  | "direct_label"
  | "positional"
  | "inferred_fallback"
  | "none"
  | "not_applicable"
  | string;

export type SemanticOwnership = {
  unit_source?: SemanticOwnershipSource;
  buyer_source?: SemanticOwnershipSource;
  metric_source?: SemanticOwnershipSource;
  section_source?: SemanticOwnershipSource;
  is_rollup?: boolean;
  table_header_row?: number;
  table_range?: string;
  metric_column?: number;
  buyer_column?: number | null;
  unit_column?: number | null;
};

export type SemanticMappingConfidence = {
  overall: SemanticConfidenceBand;
  buyer: SemanticConfidenceBand;
  unit: SemanticConfidenceBand;
  metric: SemanticConfidenceBand;
  section: SemanticConfidenceBand;
  report_date: SemanticConfidenceBand;
  reasons: string[];
};

export type SemanticIssueSeverity = "info" | "warning" | "error";

export type SemanticIssue = {
  code: string;
  severity: SemanticIssueSeverity;
  message: string;
  sheet_name?: string | null;
  cell_address?: string | null;
  metric_key?: string | null;
  operational_section?: string | null;
  occurrences: number;
  metadata?: Record<string, unknown>;
};

export type SemanticDiagnostics = {
  fact_count: number;
  confidence_counts: Partial<Record<SemanticConfidenceBand, number>>;
  sheets_with_facts: number;
  sheets_without_facts: string[];
  unmapped_regions: Array<{
    sheet_name?: string | null;
    region_id?: string | null;
    kind?: string | null;
    label?: string | null;
    range?: string | null;
  }>;
  ambiguous_rows: Array<{
    sheet_name?: string | null;
    row_number?: number | null;
    operational_section?: string | null;
    operational_section_label?: string | null;
    fact_count?: number | null;
    sample_cell_address?: string | null;
    metric_key?: string | null;
    metric_label?: string | null;
    row_label?: string | null;
  }>;
  duplicate_facts: Array<{
    buyer?: string | null;
    unit?: string | null;
    report_date?: string | null;
    metric_key?: string | null;
    metric_label?: string | null;
    fact_count?: number | null;
    sample_cells?: string[];
  }>;
  orphan_cells: Array<{
    sheet_name?: string | null;
    cell_address?: string | null;
    value?: number | string | null;
  }>;
  missing_workbook_references: Array<{
    source_key?: string | null;
    missing_fields?: string[];
    metric_key?: string | null;
  }>;
  ownership_conflicts?: Array<{
    sheet_name?: string | null;
    cell_address?: string | null;
    metric_key?: string | null;
    metric_label?: string | null;
    buyer?: string | null;
    unit?: string | null;
    operational_section?: string | null;
    problems?: string[];
  }>;
  ownership_sources?: Record<string, Record<string, number>>;
  trust_ratio?: number;
  issues: SemanticIssue[];
  health: "ok" | "warning" | "error";
};

export type WorkbookSemanticDiagnosticsResponse = {
  uploaded_file_id: string;
  diagnostics: SemanticDiagnostics;
  confidence_counts: Partial<Record<SemanticConfidenceBand, number>>;
  semantic_mapping: WorkbookSemanticMapping | Record<string, unknown>;
};

export type WorkbookSemanticFact = Partial<OperationalFact> & {
  source_key: string;
  buyer: string | null;
  unit: string | null;
  report_date: string | null;
  metric_key: string;
  metric_label: string;
  operational_section: string;
  operational_section_label: string;
  operational_row_label: string | null;
  column_label: string | null;
  value_type: OperationalValueType;
  value_numeric: string | number | null;
  value_text: string | null;
  value_date: string | null;
  value_boolean: boolean | null;
  is_formula: boolean;
  formula: string | null;
  calculated_state: string;
  source_sheet_name: string;
  source_cell_address: string;
  source_row_number: number;
  source_column_number: number;
  metadata?: {
    mapping_confidence?: SemanticMappingConfidence;
    ownership?: SemanticOwnership;
    traceability?: Record<string, unknown>;
    normalization?: Record<string, string>;
    engine?: string;
    engine_version?: number;
    [key: string]: unknown;
  };
};

export type WorkbookSemanticMapping = {
  version: number;
  engine: string;
  engine_version?: number;
  uploaded_file_id: string | null;
  status: "mapped" | "empty" | string;
  report_date: string | null;
  fact_count: number;
  semantic_region_count: number;
  sheets: {
    name: string;
    index: number;
    fact_count: number;
    semantic_region_count: number;
    sections: {
      section: string;
      section_label: string;
      fact_count: number;
      range: string;
    }[];
  }[];
  regions: WorkbookSemanticRegion[];
  facts: WorkbookSemanticFact[];
  summary: {
    rows: OperationalSummaryRow[];
    by_metric?: OperationalSummaryRow[];
  };
  prepared_for?: Record<string, boolean>;
  diagnostics?: SemanticDiagnostics;
  confidence_counts?: Partial<Record<SemanticConfidenceBand, number>>;
  health?: "ok" | "warning" | "error";
};

export type WorkbookSemanticBreakdownResponse = {
  uploaded_file_id: string;
  semantic_mapping: WorkbookSemanticMapping | Record<string, unknown>;
  regions: WorkbookSemanticRegion[];
  facts: OperationalFact[];
  summary: OperationalSummaryResponse;
  diagnostics?: SemanticDiagnostics | null;
  confidence_counts?: Partial<Record<SemanticConfidenceBand, number>>;
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
  blank?: boolean;
  orphan_master?: {
    master_address: string | null;
    range: string | null;
  } | null;
};

export type WorkbookOrphanMaster = {
  range: string;
  master_address: string;
  first_visible_row: number;
  first_visible_column: number;
  first_visible_address: string;
  visible_rows: number[];
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
  orphan_masters?: WorkbookOrphanMaster[];
  degraded?: boolean;
  degraded_reason?: string | null;
};

export type WorkbookReconstructionWarning = {
  sheet?: string | null;
  code: string;
  message: string;
  error?: string;
};

export type WorkbookReconstructionDiagnostics = {
  warnings: WorkbookReconstructionWarning[];
  orphan_merged_masters: number;
  hidden_rows: number;
  hidden_columns: number;
  merged_regions: number;
  skipped_blank_rows: number;
  bands_built: number;
  debug_logging_enabled?: boolean;
};

export type WorkbookSheetReconstructionDiagnostics = {
  sheet: string;
  warnings: WorkbookReconstructionWarning[];
  skipped_blank_rows: number[];
  skipped_oversized_rows: number;
  skipped_oversized_columns: number;
  hidden_row_count: number;
  hidden_column_count: number;
  merged_region_count: number;
  merged_master_count: number;
  orphan_merged_masters: WorkbookOrphanMaster[];
  merged_rows_outside_preview: number;
  filtered_regions: number;
  bands_built: number;
  merged_row_count: number;
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
    default_row_height?: number | null;
    default_column_width?: number | null;
    sheet_format?: Record<string, unknown>;
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
  reconstruction_diagnostics?: WorkbookSheetReconstructionDiagnostics;
  degraded?: boolean;
  degraded_reason?: string | null;
};

export type WorkbookParsePreview = {
  filename: string;
  sheet_count: number;
  parser: string;
  preview_limits: Record<string, unknown>;
  workbook_sync: Record<string, unknown>;
  semantic_mapping?: WorkbookSemanticMapping;
  sheets: WorkbookSheetPreview[];
  degraded_sheets?: string[];
  reconstruction_diagnostics?: WorkbookReconstructionDiagnostics;
};

export type WorkbookUploadResponse = {
  uploaded_file_id: string;
  original_filename: string;
  file_size_bytes: number;
  metadata: WorkbookParsePreview;
};
