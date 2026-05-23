"use client";

import { useQuery } from "@tanstack/react-query";
import { Plus, RefreshCw, Save, Search, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  createReport,
  createReportMetric,
  createReportRow,
  getReport,
  listBuyers,
  listReportTypes,
  listReports,
  listUnits,
} from "@/lib/reports/api";
import type {
  Report,
  ReportMetricCreatePayload,
  ReportValueType,
} from "@/lib/reports/types";

type MetricDraft = {
  localId: string;
  metricKey: string;
  metricLabel: string;
  valueType: ReportValueType;
  value: string;
  unitOfMeasure: string;
};

type RowDraft = {
  localId: string;
  rowKey: string;
  rowLabel: string;
  rowGroup: string;
  metrics: MetricDraft[];
};

type ReportFormState = {
  reportTypeId: string;
  buyerId: string;
  unitId: string;
  reportDate: string;
  title: string;
  remarks: string;
};

const emptyForm: ReportFormState = {
  reportTypeId: "",
  buyerId: "",
  unitId: "",
  reportDate: new Date().toISOString().slice(0, 10),
  title: "",
  remarks: "",
};

function newMetricDraft(): MetricDraft {
  return {
    localId: crypto.randomUUID(),
    metricKey: "",
    metricLabel: "",
    valueType: "number",
    value: "",
    unitOfMeasure: "",
  };
}

function newRowDraft(): RowDraft {
  return {
    localId: crypto.randomUUID(),
    rowKey: "",
    rowLabel: "",
    rowGroup: "",
    metrics: [newMetricDraft()],
  };
}

function buildMetricPayload(rowId: string, metric: MetricDraft): ReportMetricCreatePayload {
  const base = {
    row_id: rowId,
    metric_key: metric.metricKey.trim(),
    metric_label: metric.metricLabel.trim() || null,
    value_type: metric.valueType,
    unit_of_measure: metric.unitOfMeasure.trim() || null,
    sort_order: 0,
    metadata: {},
  };

  if (metric.valueType === "number") {
    return { ...base, value_numeric: metric.value };
  }
  if (metric.valueType === "date") {
    return { ...base, value_date: metric.value };
  }
  if (metric.valueType === "boolean") {
    return { ...base, value_boolean: metric.value === "true" };
  }
  return { ...base, value_text: metric.value };
}

export function ReportSchemaTester() {
  const [form, setForm] = useState<ReportFormState>(emptyForm);
  const [rows, setRows] = useState<RowDraft[]>([newRowDraft()]);
  const [reports, setReports] = useState<Report[]>([]);
  const [selectedReport, setSelectedReport] = useState<Report | null>(null);
  const [selectedReportId, setSelectedReportId] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reportTypesQuery = useQuery({
    queryKey: ["lookups", "report-types"],
    queryFn: listReportTypes,
    staleTime: 60_000,
  });
  const buyersQuery = useQuery({
    queryKey: ["lookups", "buyers"],
    queryFn: listBuyers,
    staleTime: 60_000,
  });
  const unitsQuery = useQuery({
    queryKey: ["lookups", "units"],
    queryFn: listUnits,
    staleTime: 60_000,
  });

  const reportTypeOptions = useMemo(
    () =>
      (reportTypesQuery.data?.report_types ?? []).map((reportType) => ({
        value: reportType.id,
        label: reportType.name,
        hint: reportType.code,
      })),
    [reportTypesQuery.data],
  );
  const buyerOptions = useMemo(
    () =>
      (buyersQuery.data?.buyers ?? []).map((buyer) => ({
        value: buyer.id,
        label: buyer.name,
        hint: buyer.code,
      })),
    [buyersQuery.data],
  );
  const unitOptions = useMemo(
    () =>
      (unitsQuery.data?.units ?? []).map((unit) => ({
        value: unit.id,
        label: unit.name,
        hint: unit.code,
      })),
    [unitsQuery.data],
  );

  const lookupsErrorMessage =
    (reportTypesQuery.error as Error | null)?.message ??
    (buyersQuery.error as Error | null)?.message ??
    (unitsQuery.error as Error | null)?.message ??
    null;

  const rowCount = rows.length;
  const metricCount = useMemo(
    () => rows.reduce((total, row) => total + row.metrics.length, 0),
    [rows],
  );

  function updateForm(field: keyof ReportFormState, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function updateRow(localId: string, field: keyof Omit<RowDraft, "localId" | "metrics">, value: string) {
    setRows((current) =>
      current.map((row) => (row.localId === localId ? { ...row, [field]: value } : row)),
    );
  }

  function updateMetric(
    rowId: string,
    metricId: string,
    field: keyof Omit<MetricDraft, "localId">,
    value: string,
  ) {
    setRows((current) =>
      current.map((row) =>
        row.localId === rowId
          ? {
              ...row,
              metrics: row.metrics.map((metric) =>
                metric.localId === metricId ? { ...metric, [field]: value } : metric,
              ),
            }
          : row,
      ),
    );
  }

  function addMetric(rowId: string) {
    setRows((current) =>
      current.map((row) =>
        row.localId === rowId ? { ...row, metrics: [...row.metrics, newMetricDraft()] } : row,
      ),
    );
  }

  function removeMetric(rowId: string, metricId: string) {
    setRows((current) =>
      current.map((row) =>
        row.localId === rowId
          ? { ...row, metrics: row.metrics.filter((metric) => metric.localId !== metricId) }
          : row,
      ),
    );
  }

  async function handleSave() {
    setError(null);
    setMessage(null);
    setIsSaving(true);

    try {
      const report = await createReport({
        report_type_id: form.reportTypeId.trim(),
        buyer_id: form.buyerId.trim(),
        unit_id: form.unitId.trim(),
        report_date: form.reportDate,
        title: form.title.trim() || null,
        remarks: form.remarks.trim() || null,
        metadata: { source: "schema-test" },
      });

      for (const [rowIndex, row] of rows.entries()) {
        const savedRow = await createReportRow(report.id, {
          row_key: row.rowKey.trim() || null,
          row_label: row.rowLabel.trim() || null,
          row_group: row.rowGroup.trim() || null,
          sort_order: rowIndex,
          metadata: { source: "schema-test" },
        });

        for (const [metricIndex, metric] of row.metrics.entries()) {
          if (!metric.metricKey.trim()) {
            continue;
          }
          await createReportMetric(report.id, {
            ...buildMetricPayload(savedRow.id, metric),
            sort_order: metricIndex,
          });
        }
      }

      const loaded = await getReport(report.id);
      setSelectedReport(loaded);
      setSelectedReportId(loaded.id);
      setMessage(`Saved report ${loaded.id}.`);
      await handleFetchReports();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save report.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleFetchReports() {
    setError(null);
    setIsLoading(true);
    try {
      const response = await listReports(1, 10);
      setReports(response.reports);
      setMessage(`Fetched ${response.reports.length} of ${response.total} reports.`);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to fetch reports.");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleFetchSelected() {
    if (!selectedReportId.trim()) {
      return;
    }

    setError(null);
    setIsLoading(true);
    try {
      const report = await getReport(selectedReportId.trim());
      setSelectedReport(report);
      setMessage(`Loaded report ${report.id}.`);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to fetch report.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)]">
      <section className="rounded-lg border bg-card p-5">
        <div className="flex flex-col gap-2 border-b pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold">Report schema test</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Temporary validation form for the normalized reporting tables.
            </p>
          </div>
          <Button onClick={handleSave} disabled={isSaving}>
            <Save className="size-4" />
            {isSaving ? "Saving" : "Save report"}
          </Button>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <div className="space-y-1 text-sm">
            <label htmlFor="report-type-select" className="font-medium">
              Report type
            </label>
            <SearchableSelect
              id="report-type-select"
              value={form.reportTypeId}
              options={reportTypeOptions}
              onChange={(value) => updateForm("reportTypeId", value)}
              placeholder={
                reportTypesQuery.isLoading ? "Loading report types..." : "Select a report type"
              }
              searchPlaceholder="Search report types"
              isLoading={reportTypesQuery.isLoading}
              emptyMessage={
                reportTypesQuery.isError
                  ? "Unable to load report types."
                  : "No active report types. Run the seed script."
              }
              disabled={reportTypesQuery.isLoading}
            />
          </div>
          <div className="space-y-1 text-sm">
            <label htmlFor="buyer-select" className="font-medium">
              Buyer
            </label>
            <SearchableSelect
              id="buyer-select"
              value={form.buyerId}
              options={buyerOptions}
              onChange={(value) => updateForm("buyerId", value)}
              placeholder={buyersQuery.isLoading ? "Loading buyers..." : "Select a buyer"}
              searchPlaceholder="Search buyers"
              isLoading={buyersQuery.isLoading}
              emptyMessage={
                buyersQuery.isError
                  ? "Unable to load buyers."
                  : "No active buyers. Run the seed script."
              }
              disabled={buyersQuery.isLoading}
            />
          </div>
          <div className="space-y-1 text-sm">
            <label htmlFor="unit-select" className="font-medium">
              Unit
            </label>
            <SearchableSelect
              id="unit-select"
              value={form.unitId}
              options={unitOptions}
              onChange={(value) => updateForm("unitId", value)}
              placeholder={unitsQuery.isLoading ? "Loading units..." : "Select a unit"}
              searchPlaceholder="Search units"
              isLoading={unitsQuery.isLoading}
              emptyMessage={
                unitsQuery.isError
                  ? "Unable to load units."
                  : "No active units. Run the seed script."
              }
              disabled={unitsQuery.isLoading}
            />
          </div>
          <label className="space-y-1 text-sm">
            <span className="font-medium">Report date</span>
            <input
              className="h-10 w-full rounded-md border bg-background px-3"
              type="date"
              value={form.reportDate}
              onChange={(event) => updateForm("reportDate", event.target.value)}
            />
          </label>
          {lookupsErrorMessage ? (
            <p className="md:col-span-2 text-sm text-destructive">{lookupsErrorMessage}</p>
          ) : null}
          <label className="space-y-1 text-sm md:col-span-2">
            <span className="font-medium">Title</span>
            <input
              className="h-10 w-full rounded-md border bg-background px-3"
              value={form.title}
              onChange={(event) => updateForm("title", event.target.value)}
            />
          </label>
          <label className="space-y-1 text-sm md:col-span-2">
            <span className="font-medium">Remarks</span>
            <textarea
              className="min-h-20 w-full rounded-md border bg-background px-3 py-2"
              value={form.remarks}
              onChange={(event) => updateForm("remarks", event.target.value)}
            />
          </label>
        </div>

        <div className="mt-6 flex items-center justify-between border-t pt-5">
          <div>
            <p className="text-sm font-medium">Rows and metrics</p>
            <p className="text-xs text-muted-foreground">
              {rowCount} rows, {metricCount} metrics
            </p>
          </div>
          <Button variant="outline" onClick={() => setRows((current) => [...current, newRowDraft()])}>
            <Plus className="size-4" />
            Row
          </Button>
        </div>

        <div className="mt-4 space-y-4">
          {rows.map((row, rowIndex) => (
            <div key={row.localId} className="rounded-md border p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold">Row {rowIndex + 1}</p>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Remove row"
                  onClick={() =>
                    setRows((current) => current.filter((item) => item.localId !== row.localId))
                  }
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-3">
                <input
                  className="h-10 rounded-md border bg-background px-3 text-sm"
                  placeholder="Row key"
                  value={row.rowKey}
                  onChange={(event) => updateRow(row.localId, "rowKey", event.target.value)}
                />
                <input
                  className="h-10 rounded-md border bg-background px-3 text-sm"
                  placeholder="Row label"
                  value={row.rowLabel}
                  onChange={(event) => updateRow(row.localId, "rowLabel", event.target.value)}
                />
                <input
                  className="h-10 rounded-md border bg-background px-3 text-sm"
                  placeholder="Group"
                  value={row.rowGroup}
                  onChange={(event) => updateRow(row.localId, "rowGroup", event.target.value)}
                />
              </div>

              <div className="mt-4 space-y-2">
                {row.metrics.map((metric) => (
                  <div key={metric.localId} className="grid gap-2 md:grid-cols-[1fr_1fr_120px_1fr_1fr_40px]">
                    <input
                      className="h-10 rounded-md border bg-background px-3 text-sm"
                      placeholder="Metric key"
                      value={metric.metricKey}
                      onChange={(event) =>
                        updateMetric(row.localId, metric.localId, "metricKey", event.target.value)
                      }
                    />
                    <input
                      className="h-10 rounded-md border bg-background px-3 text-sm"
                      placeholder="Label"
                      value={metric.metricLabel}
                      onChange={(event) =>
                        updateMetric(row.localId, metric.localId, "metricLabel", event.target.value)
                      }
                    />
                    <select
                      className="h-10 rounded-md border bg-background px-3 text-sm"
                      value={metric.valueType}
                      onChange={(event) =>
                        updateMetric(row.localId, metric.localId, "valueType", event.target.value)
                      }
                    >
                      <option value="number">Number</option>
                      <option value="text">Text</option>
                      <option value="date">Date</option>
                      <option value="boolean">Boolean</option>
                    </select>
                    <input
                      className="h-10 rounded-md border bg-background px-3 text-sm"
                      placeholder="Value"
                      value={metric.value}
                      onChange={(event) =>
                        updateMetric(row.localId, metric.localId, "value", event.target.value)
                      }
                    />
                    <input
                      className="h-10 rounded-md border bg-background px-3 text-sm"
                      placeholder="UOM"
                      value={metric.unitOfMeasure}
                      onChange={(event) =>
                        updateMetric(
                          row.localId,
                          metric.localId,
                          "unitOfMeasure",
                          event.target.value,
                        )
                      }
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Remove metric"
                      onClick={() => removeMetric(row.localId, metric.localId)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                ))}
                <Button variant="outline" onClick={() => addMetric(row.localId)}>
                  <Plus className="size-4" />
                  Metric
                </Button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <aside className="space-y-4">
        <section className="rounded-lg border bg-card p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">Fetch reports</h2>
              <p className="mt-1 text-sm text-muted-foreground">Load recent records or inspect one UUID.</p>
            </div>
            <Button variant="outline" onClick={handleFetchReports} disabled={isLoading}>
              <RefreshCw className="size-4" />
              Fetch
            </Button>
          </div>

          <div className="mt-4 flex gap-2">
            <input
              className="h-10 min-w-0 flex-1 rounded-md border bg-background px-3 text-sm"
              placeholder="Report UUID"
              value={selectedReportId}
              onChange={(event) => setSelectedReportId(event.target.value)}
            />
            <Button variant="outline" size="icon" aria-label="Fetch report" onClick={handleFetchSelected}>
              <Search className="size-4" />
            </Button>
          </div>

          {message ? <p className="mt-4 text-sm text-muted-foreground">{message}</p> : null}
          {error ? <p className="mt-4 text-sm text-destructive">{error}</p> : null}

          <div className="mt-4 space-y-2">
            {reports.map((report) => (
              <button
                key={report.id}
                type="button"
                className="w-full rounded-md border p-3 text-left text-sm hover:bg-secondary"
                onClick={() => {
                  setSelectedReport(report);
                  setSelectedReportId(report.id);
                }}
              >
                <span className="block font-medium">{report.title || report.id}</span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {report.report_date} · {report.buyer_name ?? report.buyer_id}
                </span>
              </button>
            ))}
          </div>
        </section>

        <section className="rounded-lg border bg-card p-5">
          <h2 className="text-base font-semibold">Selected report</h2>
          {selectedReport ? (
            <div className="mt-4 space-y-3 text-sm">
              <div>
                <p className="font-medium">{selectedReport.title || selectedReport.id}</p>
                <p className="text-muted-foreground">
                  {selectedReport.status} · {selectedReport.report_date}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <p className="rounded-md border p-2">Rows: {selectedReport.rows.length}</p>
                <p className="rounded-md border p-2">
                  Metrics:{" "}
                  {selectedReport.rows.reduce((total, row) => total + row.metrics.length, 0)}
                </p>
              </div>
              <div className="max-h-96 overflow-auto rounded-md border bg-background p-3">
                <pre className="whitespace-pre-wrap text-xs">
                  {JSON.stringify(selectedReport, null, 2)}
                </pre>
              </div>
            </div>
          ) : (
            <p className="mt-4 text-sm text-muted-foreground">No report selected.</p>
          )}
        </section>
      </aside>
    </div>
  );
}
