"use client";

import { AgGridReact } from "ag-grid-react";
import {
  AllCommunityModule,
  ModuleRegistry,
  type ColDef,
  type ICellRendererParams,
} from "ag-grid-community";
import {
  CalendarDays,
  Database,
  Download,
  Filter,
  Info,
  Layers,
  Loader2,
  RefreshCw,
  Search,
  Sliders,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { OperationalComparisonPanel } from "@/components/reports/operational-comparison-panel";
import { OperationalFactTraceDrawer } from "@/components/reports/operational-fact-trace-drawer";
import { Button } from "@/components/ui/button";
import type { OperationalQueryParams } from "@/lib/reports/api";
import { listReportTypes } from "@/lib/reports/api";
import { downloadBinary, queryString } from "@/lib/export/downloads";
import {
  useOperationalAggregation,
  useOperationalDimensions,
  useOperationalFacts,
} from "@/lib/reports/operational-hooks";
import type { OperationalFact } from "@/lib/reports/types";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";

ModuleRegistry.registerModules([AllCommunityModule]);

type FilterState = Record<string, string> & {
  report_type_id: string;
  report_date: string;
  date_from: string;
  date_to: string;
  search: string;
  classification: string;
};

const EMPTY_FILTERS: FilterState = {
  report_type_id: "",
  report_date: "",
  date_from: "",
  date_to: "",
  search: "",
  classification: "",
};

// MD07-2B: explicit rollup taxonomy. Each grain is queried separately so Grand
// Total and Previous Day never mix with detail values or each other.
const CLASSIFICATION_OPTIONS: { value: string; label: string }[] = [
  { value: "detail", label: "Detail" },
  { value: "subtotal", label: "Subtotal" },
  { value: "grand_total", label: "Grand Total" },
  { value: "previous_day", label: "Previous Day" },
  { value: "summary", label: "Summary" },
];

const CLASSIFICATION_LABEL: Record<string, string> = {
  detail: "Detail",
  subtotal: "Subtotal",
  grand_total: "Grand Total",
  previous_day: "Previous Day",
  summary: "Summary",
};

const CLASSIFICATION_TONE: Record<string, string> = {
  detail: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-300",
  subtotal: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-200",
  grand_total: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200",
  previous_day: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  summary: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200",
};

function formatNumber(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") {
    return "—";
  }
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return String(value);
  }
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(numeric);
}

function factValue(fact: OperationalFact) {
  if (fact.value_type === "number") {
    return formatNumber(fact.value_numeric);
  }
  if (fact.value_type === "date") {
    return fact.value_date ?? "";
  }
  if (fact.value_type === "boolean") {
    return fact.value_boolean ? "TRUE" : "FALSE";
  }
  if (fact.value_numeric !== null && fact.value_numeric !== undefined) {
    return formatNumber(fact.value_numeric);
  }
  if (fact.is_formula) {
    return fact.formula ?? "Formula";
  }
  return fact.value_text ?? "";
}

const CONFIDENCE_TONE: Record<string, string> = {
  explicit: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  inferred: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200",
  ambiguous: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  unmapped: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-300",
};

export function OperationalQueryModule() {
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [searchDraft, setSearchDraft] = useState("");
  const [groupBy, setGroupBy] = useState<string[]>([]);
  const [traceFactId, setTraceFactId] = useState<string | null>(null);

  const reportTypesQuery = useQuery({
    queryKey: ["report-types"],
    queryFn: listReportTypes,
    staleTime: 300_000,
  });

  const selectedReportType = useMemo(
    () =>
      (reportTypesQuery.data?.report_types ?? []).find(
        (rt) => rt.id === filters.report_type_id,
      ),
    [reportTypesQuery.data?.report_types, filters.report_type_id],
  );

  const manifest = selectedReportType?.manifest ?? null;

  // Helper: partition dimensions by category
  const businessDimensions = useMemo(
    () =>
      manifest?.dimensions
        .filter((d) => d.visible && d.category === "business")
        .sort((a, b) => a.order - b.order) ?? [],
    [manifest],
  );

  // Cascading: only send parent values for dimensions that have dependents
  const cascadingParentKeys = useMemo(() => {
    if (!manifest) return new Set<string>();
    return new Set(
      manifest.dimensions.filter((d) => d.depends_on).map((d) => d.depends_on!),
    );
  }, [manifest]);

  const dimFilters = useMemo(() => {
    const result: Record<string, string> = {};
    cascadingParentKeys.forEach((key) => {
      if (filters[key]) result[key] = filters[key];
    });
    return Object.keys(result).length > 0 ? result : undefined;
  }, [cascadingParentKeys, filters]);

  const dimensionsQuery = useOperationalDimensions(
    filters.report_type_id || undefined,
    dimFilters,
  );

  const queryParams = useMemo<OperationalQueryParams>(() => {
    const params: Record<string, unknown> = { page: 1, page_size: 500 };
    if (filters.report_type_id) params.report_type_id = filters.report_type_id;
    if (filters.report_date) params.report_date = filters.report_date;
    if (filters.date_from) params.date_from = filters.date_from;
    if (filters.date_to) params.date_to = filters.date_to;
    if (filters.search) params.search = filters.search;
    if (filters.classification) params.classification = filters.classification;

    // Dynamic dimension keys
    manifest?.dimensions.forEach((dim) => {
      if (filters[dim.key]) {
        params[dim.key] = filters[dim.key];
      }
    });

    return params as OperationalQueryParams;
  }, [filters, manifest]);

  const factsQuery = useOperationalFacts(queryParams, Boolean(filters.report_type_id));
  const facts = useMemo(() => factsQuery.data?.facts ?? [], [factsQuery.data?.facts]);

  const aggregationParams = useMemo(() => {
    const params: Record<string, unknown> = {
      group_by: groupBy,
      classification: filters.classification || undefined,
      report_type_id: filters.report_type_id || undefined,
      report_date: filters.report_date || undefined,
      date_from: filters.date_from || undefined,
      date_to: filters.date_to || undefined,
    };
    manifest?.dimensions.forEach((dim) => {
      if (filters[dim.key]) {
        params[dim.key] = filters[dim.key];
      }
    });
    return params;
  }, [filters, groupBy, manifest]);

  const aggregationQuery = useOperationalAggregation(
    aggregationParams,
    Boolean(filters.report_type_id),
  );

  const activeFilterCount = useMemo(() => {
    return Object.keys(filters).filter((k) => k !== "report_type_id" && filters[k]).length;
  }, [filters]);

  const exportQuery = queryString({ ...queryParams, group_by: groupBy });

  const columnDefs = useMemo<ColDef<OperationalFact>[]>(
    () => [
      {
        headerName: "Metric",
        field: "metric_label",
        minWidth: 160,
        flex: 1.4,
        valueGetter: (params) => {
          const fact = params.data;
          if (!fact) return "";
          if (fact.row_classification === "grand_total") return "Grand Total";
          if (fact.row_classification === "previous_day") return "Previous Day";
          return fact.metric_label;
        },
      },
      { headerName: "Buyer", field: "buyer", minWidth: 110, flex: 1 },
      { headerName: "Unit", field: "unit", minWidth: 100, flex: 1 },
      { headerName: "Sub Unit", field: "sub_unit" as any, minWidth: 100, flex: 1 },
      { headerName: "Department", field: "department" as any, minWidth: 100, flex: 1 },
      {
        headerName: "Section",
        field: "operational_section_label",
        minWidth: 140,
        flex: 1,
      },
      {
        headerName: "Class",
        colId: "classification",
        minWidth: 120,
        sortable: true,
        valueGetter: (params) => params.data?.row_classification ?? "",
        cellRenderer: (params: ICellRendererParams<OperationalFact>) => {
          const band = params.data?.row_classification ?? "detail";
          return (
            <span
              className={cn(
                "rounded-sm px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                CLASSIFICATION_TONE[band] ?? CLASSIFICATION_TONE.detail,
              )}
            >
              {CLASSIFICATION_LABEL[band] ?? band}
            </span>
          );
        },
      },
      {
        headerName: "Date",
        field: "report_date",
        minWidth: 110,
        sort: "desc",
      },
      {
        headerName: "Value",
        colId: "value",
        minWidth: 110,
        type: "rightAligned",
        valueGetter: (params) => {
          const fact = params.data;
          if (!fact) return "";
          return fact.value_type === "number" ? Number(fact.value_numeric ?? 0) : factValue(fact);
        },
        valueFormatter: (params) =>
          params.data ? factValue(params.data) : String(params.value ?? ""),
      },
      {
        headerName: "Sheet",
        field: "source_sheet_name",
        minWidth: 120,
        flex: 1,
      },
      {
        headerName: "Cell",
        field: "source_cell_address",
        minWidth: 80,
        cellClass: "font-mono",
      },
      {
        headerName: "Confidence",
        colId: "confidence",
        minWidth: 110,
        sortable: false,
        cellRenderer: (params: ICellRendererParams<OperationalFact>) => {
          const meta = params.data?.metadata as
            | { mapping_confidence?: { overall?: string } }
            | undefined;
          const band = meta?.mapping_confidence?.overall ?? "unmapped";
          return (
            <span
              className={cn(
                "rounded-sm px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                CONFIDENCE_TONE[band] ?? CONFIDENCE_TONE.unmapped,
              )}
            >
              {band}
            </span>
          );
        },
      },
      {
        headerName: "Trace",
        colId: "trace",
        minWidth: 90,
        sortable: false,
        filter: false,
        cellRenderer: (params: ICellRendererParams<OperationalFact>) => {
          const id = params.data?.id;
          if (!id) return null;
          return (
            <button
              className="rounded-sm border border-border bg-background px-2 py-0.5 text-[11px] text-primary transition hover:bg-secondary"
              onClick={() => setTraceFactId(id)}
              type="button"
            >
              Trace
            </button>
          );
        },
      },
    ],
    [],
  );

  function updateFilter(key: string, value: string) {
    setFilters((cur) => {
      const next = { ...cur, [key]: value };
      if (key === "report_type_id") {
        // Full reset: clear all dim filters + restore default_grouping
        const newManifest = (reportTypesQuery.data?.report_types ?? [])
          .find((rt) => rt.id === value)?.manifest ?? null;
        manifest?.dimensions.forEach((d) => { next[d.key] = ""; });
        newManifest?.dimensions.forEach((d) => { next[d.key] = ""; });
        setGroupBy(newManifest?.default_grouping ?? []);
      } else {
        // Clear children of changed parent
        manifest?.dimensions
          .filter((d) => d.depends_on === key)
          .forEach((d) => { next[d.key] = ""; });
      }
      return next;
    });
  }

  function clearFilters() {
    setFilters({ ...EMPTY_FILTERS, report_type_id: filters.report_type_id });
    setSearchDraft("");
  }

  const aggregationRows = aggregationQuery.data?.rows ?? [];
  const totals = aggregationQuery.data?.totals;

  return (
    <div className="space-y-4">
      {/* Row 1: Report Type — always present */}
      <section className="rounded-xl border bg-card/70 p-4 shadow-sm backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <Database className="size-4 text-primary" />
            <h2 className="text-sm font-semibold tracking-tight">Operational Query</h2>
            {activeFilterCount > 0 && (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] text-primary">
                {activeFilterCount} filter{activeFilterCount === 1 ? "" : "s"}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {manifest && (
              <Button
                onClick={() =>
                  downloadBinary(
                    `/api/reports/operations/export.xlsx${exportQuery ? `?${exportQuery}` : ""}`,
                    "operational-query.xlsx",
                  )
                }
                variant="outline"
                size="sm"
              >
                <Download className="size-4 mr-1.5" />
                Excel
              </Button>
            )}
            <Button
              aria-label="Refresh facts"
              disabled={factsQuery.isFetching}
              onClick={() => {
                factsQuery.refetch();
                aggregationQuery.refetch();
              }}
              size="icon"
              variant="ghost"
              className="size-8"
            >
              <RefreshCw className={cn("size-4", factsQuery.isFetching && "animate-spin")} />
            </Button>
            {manifest && (
              <Button onClick={clearFilters} variant="outline" size="sm">
                <X className="size-4 mr-1.5" />
                Clear Filters
              </Button>
            )}
          </div>
        </div>
        <div className="max-w-md">
          <FilterSelect
            id="filter-report-type"
            label="Report type"
            value={filters.report_type_id}
            onChange={(v) => updateFilter("report_type_id", v)}
            options={(reportTypesQuery.data?.report_types ?? []).map((rt) => ({
              value: rt.id,
              label: rt.name,
            }))}
            placeholder="Select a report type"
          />
        </div>
      </section>

      {/* Placeholder when no report type selected */}
      {!manifest && (
        <div className="flex items-center gap-3 rounded-xl border border-dashed bg-muted/20 px-5 py-4 text-sm text-muted-foreground">
          <Info className="size-4 shrink-0 text-muted-foreground/60" />
          <span>Select a report type to load available filters</span>
        </div>
      )}

      {/* Business Filters — category === "business" */}
      {manifest && businessDimensions.length > 0 && (
        <section className="rounded-xl border bg-card/70 p-4 shadow-sm backdrop-blur">
          <div className="flex items-center gap-2 mb-3">
            <Sliders className="size-4 text-primary" />
            <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Business Filters
            </h3>
          </div>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {businessDimensions.map((dim) => (
              <FilterSelect
                key={dim.key}
                id={`filter-${dim.key}`}
                label={dim.label}
                value={filters[dim.key] ?? ""}
                onChange={(v) => updateFilter(dim.key, v)}
                options={dimensionsQuery.data?.dimensions?.[dim.key] ?? []}
                placeholder={`All ${dim.label.toLowerCase()}s`}
                isLoading={dimensionsQuery.isLoading}
              />
            ))}
            <FilterSelect
              label="Classification"
              value={filters.classification}
              onChange={(value) => updateFilter("classification", value)}
              options={CLASSIFICATION_OPTIONS}
              placeholder="All (detail grain)"
            />
          </div>
        </section>
      )}

      {/* Time Filters — always shown when report type selected */}
      {manifest && (
        <section className="rounded-xl border bg-card/70 p-4 shadow-sm backdrop-blur">
          <div className="flex items-center gap-2 mb-3">
            <CalendarDays className="size-4 text-primary" />
            <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Time Filters
            </h3>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <DateFilter
              id="filter-report-date"
              label="Report date"
              value={filters.report_date}
              onChange={(v) => updateFilter("report_date", v)}
            />
            <DateFilter
              id="filter-date-from"
              label="Date from"
              value={filters.date_from}
              onChange={(v) => updateFilter("date_from", v)}
            />
            <DateFilter
              id="filter-date-to"
              label="Date to"
              value={filters.date_to}
              onChange={(v) => updateFilter("date_to", v)}
            />
          </div>
        </section>
      )}

      {/* Search */}
      {manifest && (
        <QuickSearchBar
          value={searchDraft}
          onChange={setSearchDraft}
          onApply={() => updateFilter("search", searchDraft.trim())}
          onClear={() => {
            setSearchDraft("");
            updateFilter("search", "");
          }}
        />
      )}

      {/* Group By — driven by manifest.groupable dimensions */}
      {manifest && (
        <section className="rounded-xl border bg-card/70 p-4 shadow-sm backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Layers className="size-4 text-primary" />
              <h3 className="text-sm font-semibold">Grouped totals</h3>
              <span className="mr-1 text-xs text-muted-foreground">Group by</span>
              {manifest.dimensions
                .filter((d) => d.groupable && d.visible)
                .sort((a, b) => a.order - b.order)
                .map((dim) => (
                  <button
                    key={dim.key}
                    id={`groupby-${dim.key}`}
                    type="button"
                    className={cn(
                      "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
                      groupBy.includes(dim.key)
                        ? "border-primary/60 bg-primary/10 text-primary"
                        : "border-border bg-background/60 text-muted-foreground hover:bg-secondary/80",
                    )}
                    onClick={() =>
                      setGroupBy((cur) =>
                        cur.includes(dim.key)
                          ? cur.filter((k) => k !== dim.key)
                          : [...cur, dim.key],
                      )
                    }
                  >
                    {dim.label}
                  </button>
                ))}
            </div>
          </div>

          {totals && (
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <SummaryStat label="Total value" value={formatNumber(totals.numeric_total)} />
              <SummaryStat label="Facts" value={String(totals.fact_count)} />
              <SummaryStat label="Numeric cells" value={String(totals.numeric_count)} />
              <SummaryStat label="Formula cells" value={String(totals.formula_count)} />
            </div>
          )}

          <div className="mt-3 overflow-hidden rounded-md border">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr>
                  {groupBy.map((dimension) => (
                    <th className="px-3 py-2 text-left font-medium capitalize" key={dimension}>
                      {manifest.dimensions.find((d) => d.key === dimension)?.label ?? dimension}
                    </th>
                  ))}
                  <th className="px-3 py-2 text-right font-medium">Total</th>
                  <th className="px-3 py-2 text-right font-medium">Facts</th>
                </tr>
              </thead>
              <tbody>
                {aggregationQuery.isLoading ? (
                  <tr>
                    <td className="px-3 py-4 text-muted-foreground" colSpan={groupBy.length + 2}>
                      Loading totals…
                    </td>
                  </tr>
                ) : aggregationRows.length === 0 ? (
                  <tr>
                    <td className="px-3 py-4 text-muted-foreground" colSpan={groupBy.length + 2}>
                      No grouped totals for the current filters.
                    </td>
                  </tr>
                ) : (
                  aggregationRows.slice(0, 50).map((row, index) => (
                    <tr className="border-t" key={index}>
                      {groupBy.map((dimension) => (
                        <td className="px-3 py-1.5 text-foreground" key={dimension}>
                          {row.group[dimension] ?? "—"}
                        </td>
                      ))}
                      <td className="px-3 py-1.5 text-right font-semibold tabular-nums">
                        {formatNumber(row.numeric_total)}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                        {row.fact_count}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {manifest && (
        <OperationalComparisonPanel
          metric={filters.metric || null}
          currentDate={filters.report_date || dimensionsQuery.data?.dates?.[0]?.value || null}
          buyer={filters.buyer || null}
          unit={filters.unit || null}
          subUnit={filters.sub_unit || null}
          department={filters.department || null}
          section={filters.section || null}
          reportTypeId={filters.report_type_id || null}
        />
      )}

      {manifest && (
        <section className="rounded-md border bg-card/70 p-4 shadow-sm backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Filter className="size-4 text-primary" />
              <h3 className="text-sm font-semibold">Operational facts</h3>
              <span className="text-xs text-muted-foreground">
                {factsQuery.data?.total ?? 0} matching
              </span>
            </div>
            {factsQuery.isFetching && (
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            )}
          </div>

          {factsQuery.isError ? (
            <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {(factsQuery.error as Error)?.message ?? "Unable to load operational facts."}
            </div>
          ) : (
            <div className="ag-theme-quartz mt-3 h-[32rem] w-full">
              <AgGridReact<OperationalFact>
                columnDefs={columnDefs}
                defaultColDef={{
                  filter: true,
                  resizable: true,
                  sortable: true,
                  suppressHeaderMenuButton: true,
                }}
                getRowId={(params) => params.data.id}
                rowData={facts}
                theme="legacy"
              />
            </div>
          )}
        </section>
      )}

      <OperationalFactTraceDrawer factId={traceFactId} onClose={() => setTraceFactId(null)} />
    </div>
  );
}

function FilterSelect({
  id,
  label,
  value,
  onChange,
  options,
  placeholder,
  isLoading,
}: {
  id?: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  placeholder: string;
  isLoading?: boolean;
}) {
  return (
    <label htmlFor={id} className="grid gap-1 text-xs font-medium text-muted-foreground">
      {label}
      <div className="relative">
        <select
          id={id}
          className="h-9 w-full rounded-md border bg-background/80 px-2 pr-8 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
          onChange={(event) => onChange(event.target.value)}
          value={value}
          disabled={isLoading}
        >
          <option value="">{isLoading ? "Loading..." : placeholder}</option>
          {!isLoading &&
            options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
        </select>
      </div>
    </label>
  );
}

function DateFilter({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label htmlFor={id} className="grid gap-1 text-xs font-medium text-muted-foreground">
      {label}
      <input
        id={id}
        className="h-9 rounded-md border bg-background/80 px-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
        onChange={(event) => onChange(event.target.value)}
        type="date"
        value={value}
      />
    </label>
  );
}

function QuickSearchBar({
  value,
  onChange,
  onApply,
  onClear,
}: {
  value: string;
  onChange: (val: string) => void;
  onApply: () => void;
  onClear: () => void;
}) {
  return (
    <section className="rounded-xl border bg-card/70 p-4 shadow-sm backdrop-blur">
      <div className="flex items-center gap-2 mb-3">
        <Search className="size-4 text-primary" />
        <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Search
        </h3>
      </div>
      <div className="flex gap-2 max-w-md">
        <input
          className="h-9 min-w-0 flex-1 rounded-md border bg-background/80 px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              onApply();
            }
          }}
          placeholder="Search by metric, section, values..."
          value={value}
        />
        <Button onClick={onApply} variant="default" size="sm">
          Search
        </Button>
        {value && (
          <Button onClick={onClear} variant="ghost" size="sm">
            Clear
          </Button>
        )}
      </div>
    </section>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-card/60 px-2 py-1.5">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5 text-base font-semibold tabular-nums">{value}</div>
    </div>
  );
}
