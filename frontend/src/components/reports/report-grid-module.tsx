"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, RefreshCw, X } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { ReportGrid } from "@/components/reports/report-grid";
import { Button } from "@/components/ui/button";
import {
  reportTemplates,
  resolveReportTemplate,
  type ReportTemplate,
  validateReportTemplates,
} from "@/features/reports/templates";
import {
  bulkSaveReport,
  createReport,
  getReport,
  listBuyers,
  listReportSummaries,
  listReportTypes,
  listUnits,
  transitionReportWorkflow,
} from "@/lib/reports/api";
import type {
  BulkReportSavePayload,
  BulkRowMetricPayload,
  BulkRowPayload,
  BuyerOption,
  Report,
  ReportSummary,
  ReportStatus,
  ReportWorkflowAction,
  ReportTypeOption,
  UnitOption,
} from "@/lib/reports/types";
import { cn } from "@/lib/utils";

type CreateReportForm = {
  reportTypeId: string;
  templateId: string;
  buyerId: string;
  unitId: string;
  reportDate: string;
};

const workflowStatusLabels: Record<ReportStatus, string> = {
  draft: "Draft",
  in_review: "In Review",
  approved: "Approved",
  rejected: "Rejected",
  locked: "Locked",
  archived: "Archived",
};

const workflowStatusOptions: Array<ReportStatus | "all"> = [
  "all",
  "draft",
  "in_review",
  "approved",
  "rejected",
  "locked",
  "archived",
];

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function initialCreateReportForm(): CreateReportForm {
  return {
    reportTypeId: "",
    templateId: reportTemplates[0]?.id ?? "",
    buyerId: "",
    unitId: "",
    reportDate: todayIsoDate(),
  };
}

function reportTitle(report: ReportSummary) {
  return report.title || report.report_type_name || report.id;
}

function valueForTemplateMetric(
  column: ReportTemplate["metricColumns"][number],
  value: string | boolean | undefined,
  reportDate: string,
) {
  if (value !== undefined) {
    return value;
  }
  if (column.defaultValue !== undefined) {
    return column.defaultValue;
  }
  if (column.valueType === "number") {
    return "0";
  }
  if (column.valueType === "date") {
    return reportDate;
  }
  if (column.valueType === "boolean") {
    return false;
  }
  return "";
}

function templateMetricPayload(
  column: ReportTemplate["metricColumns"][number],
  sortOrder: number,
  value: string | boolean | undefined,
  reportDate: string,
): BulkRowMetricPayload {
  const metricValue = valueForTemplateMetric(column, value, reportDate);
  const basePayload: BulkRowMetricPayload = {
    metric_key: column.key,
    metric_label: column.label,
    value_type: column.valueType,
    unit_of_measure: column.unitOfMeasure ?? null,
    source_sheet_name: null,
    source_cell_address: null,
    sort_order: sortOrder,
    metadata: {},
  };

  if (column.valueType === "number") {
    const textValue = String(metricValue ?? "").trim();
    return {
      ...basePayload,
      value_numeric: textValue && Number.isFinite(Number(textValue)) ? textValue : "0",
    };
  }
  if (column.valueType === "date") {
    const textValue = String(metricValue ?? "").trim();
    return {
      ...basePayload,
      value_date: /^\d{4}-\d{2}-\d{2}$/.test(textValue) ? textValue : reportDate,
    };
  }
  if (column.valueType === "boolean") {
    return {
      ...basePayload,
      value_boolean: metricValue === true || metricValue === "true",
    };
  }

  return { ...basePayload, value_text: String(metricValue ?? "") };
}

function templateRowsPayload(template: ReportTemplate, reportDate: string): BulkRowPayload[] {
  const rows: ReportTemplate["rows"] =
    template.rows.length > 0
      ? template.rows
      : template.sections
          .filter((section) => section.allowDynamicRows)
          .map((section, index) => ({
            key: `${section.id}_${index + 1}`,
            label: section.label,
            rowGroup: section.rowGroup,
          }));

  return rows.map((row, index) => ({
    row_key: row.key,
    row_label: row.label,
    row_group: row.rowGroup,
    sort_order: index,
    source_sheet_name: row.sourceSheetName ?? null,
    source_row_number: row.sourceRowNumber ?? null,
    metadata: {},
    metrics: template.metricColumns.map((column, metricIndex) =>
      templateMetricPayload(column, metricIndex, row.metricDefaults?.[column.key], reportDate),
    ),
  }));
}

function buildCreateReportPayload({
  form,
  template,
  buyer,
  unit,
}: {
  form: CreateReportForm;
  template: ReportTemplate;
  reportType: ReportTypeOption;
  buyer: BuyerOption;
  unit: UnitOption;
}): BulkReportSavePayload {
  return {
    report_type_id: form.reportTypeId,
    buyer_id: form.buyerId,
    unit_id: form.unitId,
    report_date: form.reportDate,
    period_start: null,
    period_end: null,
    title: `${template.name} - ${buyer.name} - ${unit.name} - ${form.reportDate}`,
    remarks: null,
    metadata: {
      template: template.id,
      excel_template_key: template.id,
    },
    rows: templateRowsPayload(template, form.reportDate),
    metrics: [],
  };
}

export function ReportGridModule() {
  const queryClient = useQueryClient();
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [statusFilter, setStatusFilter] = useState<ReportStatus | "all">("all");
  const [isWorkflowTransitioning, setIsWorkflowTransitioning] = useState(false);
  const [workflowError, setWorkflowError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createForm, setCreateForm] = useState<CreateReportForm>(initialCreateReportForm);

  const summariesQuery = useQuery({
    queryKey: ["reports", "summaries", 1, 50],
    queryFn: () => listReportSummaries(1, 50),
    staleTime: 30_000,
  });

  const summaries = useMemo(
    () => summariesQuery.data?.reports ?? [],
    [summariesQuery.data?.reports],
  );
  const filteredSummaries = useMemo(
    () =>
      statusFilter === "all"
        ? summaries
        : summaries.filter((summary) => summary.status === statusFilter),
    [statusFilter, summaries],
  );
  const reportTypesQuery = useQuery({
    queryKey: ["report-types"],
    queryFn: listReportTypes,
    enabled: isCreateOpen,
    staleTime: 300_000,
  });
  const buyersQuery = useQuery({
    queryKey: ["buyers"],
    queryFn: listBuyers,
    enabled: isCreateOpen,
    staleTime: 300_000,
  });
  const unitsQuery = useQuery({
    queryKey: ["units"],
    queryFn: listUnits,
    enabled: isCreateOpen,
    staleTime: 300_000,
  });
  const reportTypes = useMemo(
    () => reportTypesQuery.data?.report_types.filter((option) => option.is_active) ?? [],
    [reportTypesQuery.data?.report_types],
  );
  const buyers = useMemo(
    () => buyersQuery.data?.buyers.filter((option) => option.is_active) ?? [],
    [buyersQuery.data?.buyers],
  );
  const units = useMemo(
    () => unitsQuery.data?.units.filter((option) => option.is_active) ?? [],
    [unitsQuery.data?.units],
  );

  useEffect(() => {
    const firstReport = filteredSummaries.at(0) ?? summaries.at(0);
    if (!selectedReportId && firstReport) {
      setSelectedReportId(firstReport.id);
    }
  }, [filteredSummaries, selectedReportId, summaries]);

  const reportQuery = useQuery({
    queryKey: ["reports", "detail", selectedReportId],
    queryFn: () => getReport(selectedReportId as string),
    enabled: Boolean(selectedReportId),
    staleTime: 10_000,
  });
  const selectedTemplate = useMemo(
    () => resolveReportTemplate(reportQuery.data ?? null),
    [reportQuery.data],
  );
  const templateErrors = useMemo(() => validateReportTemplates(), []);
  const createTemplate = useMemo(
    () => reportTemplates.find((template) => template.id === createForm.templateId) ?? null,
    [createForm.templateId],
  );
  const createReportType = useMemo(
    () => reportTypes.find((reportType) => reportType.id === createForm.reportTypeId) ?? null,
    [createForm.reportTypeId, reportTypes],
  );
  const createBuyer = useMemo(
    () => buyers.find((buyer) => buyer.id === createForm.buyerId) ?? null,
    [buyers, createForm.buyerId],
  );
  const createUnit = useMemo(
    () => units.find((unit) => unit.id === createForm.unitId) ?? null,
    [createForm.unitId, units],
  );
  const lookupIsLoading =
    reportTypesQuery.isLoading || buyersQuery.isLoading || unitsQuery.isLoading;
  const canCreateReport =
    Boolean(createTemplate && createReportType && createBuyer && createUnit && createForm.reportDate) &&
    templateErrors.length === 0 &&
    !lookupIsLoading &&
    !isCreating;

  useEffect(() => {
    if (!isCreateOpen) {
      return;
    }

    setCreateForm((current) => ({
      ...current,
      reportTypeId: current.reportTypeId || reportTypes[0]?.id || "",
      buyerId: current.buyerId || buyers[0]?.id || "",
      unitId: current.unitId || units[0]?.id || "",
      templateId: current.templateId || reportTemplates[0]?.id || "",
    }));
  }, [buyers, isCreateOpen, reportTypes, units]);

  function handleSaved(report: Report) {
    setHasUnsavedChanges(false);
    setWorkflowError(null);
    setSelectedReportId(report.id);
    void queryClient.invalidateQueries({ queryKey: ["reports", "summaries"] });
    queryClient.setQueryData(["reports", "detail", report.id], report);
    void queryClient.invalidateQueries({ queryKey: ["reports", "detail", report.id] });
  }

  async function handleWorkflowAction(action: ReportWorkflowAction) {
    if (!selectedReportId) {
      return;
    }

    setWorkflowError(null);
    setIsWorkflowTransitioning(true);
    try {
      const report = await transitionReportWorkflow(selectedReportId, action);
      setHasUnsavedChanges(false);
      setSelectedReportId(report.id);
      queryClient.setQueryData(["reports", "detail", report.id], report);
      void queryClient.invalidateQueries({ queryKey: ["reports", "summaries"] });
      void queryClient.invalidateQueries({ queryKey: ["reports", "detail", report.id] });
    } catch (error) {
      setWorkflowError(error instanceof Error ? error.message : "Unable to update workflow state.");
    } finally {
      setIsWorkflowTransitioning(false);
    }
  }

  function handleSelectReport(reportId: string) {
    if (
      hasUnsavedChanges &&
      !window.confirm("Discard unsaved grid changes and open another report?")
    ) {
      return;
    }

    setHasUnsavedChanges(false);
    setSelectedReportId(reportId);
  }

  async function handleCreateReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreateError(null);

    if (hasUnsavedChanges && !window.confirm("Discard unsaved grid changes and create a new report?")) {
      return;
    }
    if (!createTemplate || !createReportType || !createBuyer || !createUnit) {
      setCreateError("Select a report type, template, buyer, unit, and report date.");
      return;
    }
    if (templateErrors.length > 0) {
      setCreateError(templateErrors[0] ?? "Template validation failed.");
      return;
    }

    const payload = buildCreateReportPayload({
      form: createForm,
      template: createTemplate,
      reportType: createReportType,
      buyer: createBuyer,
      unit: createUnit,
    });

    setIsCreating(true);
    try {
      await createReport({
        report_type_id: payload.report_type_id,
        buyer_id: payload.buyer_id,
        unit_id: payload.unit_id,
        report_date: payload.report_date,
        period_start: payload.period_start,
        period_end: payload.period_end,
        title: payload.title,
        remarks: payload.remarks,
        metadata: payload.metadata,
      });
      const report = await bulkSaveReport(payload);
      setHasUnsavedChanges(false);
      setSelectedReportId(report.id);
      setIsCreateOpen(false);
      queryClient.setQueryData(["reports", "detail", report.id], report);
      void queryClient.invalidateQueries({ queryKey: ["reports", "summaries"] });
      void queryClient.invalidateQueries({ queryKey: ["reports", "detail", report.id] });
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "Unable to create report.");
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <div className="grid min-h-[calc(100vh-9rem)] gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
      <aside className="flex min-h-0 flex-col rounded-md border bg-card/70 shadow-sm backdrop-blur">
        <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold">Reports</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {filteredSummaries.length} shown / {summaries.length} loaded
            </p>
          </div>
          <div className="flex items-center gap-1">
            <Button
              aria-label="Create new report"
              onClick={() => {
                setCreateError(null);
                setIsCreateOpen(true);
              }}
              size="icon"
              variant="ghost"
            >
              <Plus className="size-4" />
            </Button>
            <Button
              aria-label="Refresh reports"
              disabled={summariesQuery.isFetching}
              onClick={() => summariesQuery.refetch()}
              size="icon"
              variant="ghost"
            >
              <RefreshCw className={cn("size-4", summariesQuery.isFetching && "animate-spin")} />
            </Button>
          </div>
        </div>

        <div className="border-b px-3 py-2">
          <label className="grid gap-1 text-xs font-medium text-muted-foreground">
            Workflow state
            <select
              className="h-9 rounded-md border bg-background/80 px-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
              onChange={(event) => setStatusFilter(event.target.value as ReportStatus | "all")}
              value={statusFilter}
            >
              {workflowStatusOptions.map((status) => (
                <option key={status} value={status}>
                  {status === "all" ? "All states" : workflowStatusLabels[status]}
                </option>
              ))}
            </select>
          </label>
        </div>

        {isCreateOpen && (
          <form className="border-b bg-background/35 p-3" onSubmit={handleCreateReport}>
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">Create New Report</h3>
              <Button
                aria-label="Close create report panel"
                disabled={isCreating}
                onClick={() => setIsCreateOpen(false)}
                size="icon"
                type="button"
                variant="ghost"
              >
                <X className="size-4" />
              </Button>
            </div>

            <div className="grid gap-2">
              <label className="grid gap-1 text-xs font-medium text-muted-foreground">
                Report type
                <select
                  className="h-9 rounded-md border bg-background/80 px-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
                  disabled={lookupIsLoading || isCreating}
                  onChange={(event) =>
                    setCreateForm((current) => ({ ...current, reportTypeId: event.target.value }))
                  }
                  value={createForm.reportTypeId}
                >
                  <option value="">Select report type</option>
                  {reportTypes.map((reportType) => (
                    <option key={reportType.id} value={reportType.id}>
                      {reportType.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="grid gap-1 text-xs font-medium text-muted-foreground">
                Template
                <select
                  className="h-9 rounded-md border bg-background/80 px-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
                  disabled={isCreating}
                  onChange={(event) =>
                    setCreateForm((current) => ({ ...current, templateId: event.target.value }))
                  }
                  value={createForm.templateId}
                >
                  {reportTemplates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="grid gap-1 text-xs font-medium text-muted-foreground">
                Buyer
                <select
                  className="h-9 rounded-md border bg-background/80 px-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
                  disabled={lookupIsLoading || isCreating}
                  onChange={(event) =>
                    setCreateForm((current) => ({ ...current, buyerId: event.target.value }))
                  }
                  value={createForm.buyerId}
                >
                  <option value="">Select buyer</option>
                  {buyers.map((buyer) => (
                    <option key={buyer.id} value={buyer.id}>
                      {buyer.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="grid gap-1 text-xs font-medium text-muted-foreground">
                Unit
                <select
                  className="h-9 rounded-md border bg-background/80 px-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
                  disabled={lookupIsLoading || isCreating}
                  onChange={(event) =>
                    setCreateForm((current) => ({ ...current, unitId: event.target.value }))
                  }
                  value={createForm.unitId}
                >
                  <option value="">Select unit</option>
                  {units.map((unit) => (
                    <option key={unit.id} value={unit.id}>
                      {unit.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="grid gap-1 text-xs font-medium text-muted-foreground">
                Report date
                <input
                  className="h-9 rounded-md border bg-background/80 px-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
                  disabled={isCreating}
                  onChange={(event) =>
                    setCreateForm((current) => ({ ...current, reportDate: event.target.value }))
                  }
                  type="date"
                  value={createForm.reportDate}
                />
              </label>
            </div>

            {(createError || lookupIsLoading) && (
              <div className="mt-3 text-xs">
                {createError ? (
                  <span className="text-destructive">{createError}</span>
                ) : (
                  <span className="text-muted-foreground">Loading options</span>
                )}
              </div>
            )}

            <div className="mt-3 flex items-center justify-end gap-2">
              <Button
                disabled={isCreating}
                onClick={() => setIsCreateOpen(false)}
                type="button"
                variant="outline"
              >
                Cancel
              </Button>
              <Button disabled={!canCreateReport} type="submit">
                {isCreating ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                Create
              </Button>
            </div>
          </form>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {workflowError && (
            <div className="mb-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {workflowError}
            </div>
          )}
          {summariesQuery.isLoading ? (
            <div className="px-3 py-8 text-sm text-muted-foreground">Loading reports</div>
          ) : summariesQuery.isError ? (
            <div className="px-3 py-8 text-sm text-destructive">
              {(summariesQuery.error as Error).message}
            </div>
          ) : filteredSummaries.length === 0 ? (
            <div className="px-3 py-8 text-sm text-muted-foreground">
              No reports found for this workflow state.
            </div>
          ) : (
            <div className="space-y-1">
              {filteredSummaries.map((report) => (
                <button
                  className={cn(
                    "w-full rounded-md px-3 py-2 text-left text-sm transition hover:bg-secondary",
                    selectedReportId === report.id && "bg-secondary text-foreground",
                  )}
                  key={report.id}
                  onClick={() => handleSelectReport(report.id)}
                  type="button"
                >
                  <span className="block truncate font-medium">{reportTitle(report)}</span>
                  <span className="mt-1 block truncate text-xs text-muted-foreground">
                    {report.report_date} / {report.buyer_name ?? "Buyer"}
                  </span>
                  <span className="mt-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>{report.row_count} rows / {report.metric_count} metrics</span>
                    <span className="rounded border bg-background/70 px-1.5 py-0.5">
                      {workflowStatusLabels[report.status]}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </aside>

      <ReportGrid
        isWorkflowTransitioning={isWorkflowTransitioning}
        isLoading={reportQuery.isFetching}
        onDirtyChange={setHasUnsavedChanges}
        onSaved={handleSaved}
        onWorkflowAction={handleWorkflowAction}
        report={reportQuery.data ?? null}
        template={templateErrors.length > 0 ? null : selectedTemplate}
      />
    </div>
  );
}
