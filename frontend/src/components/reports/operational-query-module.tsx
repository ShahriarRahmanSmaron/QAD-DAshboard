"use client";

import { AgGridReact } from "ag-grid-react";
import {
  AllCommunityModule,
  ModuleRegistry,
  type ColDef,
  type ICellRendererParams,
} from "ag-grid-community";
import {
  Database,
  Filter,
  Layers,
  Loader2,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { OperationalComparisonPanel } from "@/components/reports/operational-comparison-panel";
import { OperationalFactTraceDrawer } from "@/components/reports/operational-fact-trace-drawer";
import { Button } from "@/components/ui/button";
import type { OperationalQueryParams } from "@/lib/reports/api";
import { listReportTypes } from "@/lib/reports/api";
import {
  useOperationalAggregation,
  useOperationalDimensions,
  useOperationalFacts,
} from "@/lib/reports/operational-hooks";
import type { OperationalFact } from "@/lib/reports/types";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";

ModuleRegistry.registerModules([AllCommunityModule]);

type FilterState = {
  buyer: string;
  unit: string;
  metric: string;
  section: string;
  report_type_id: string;
  report_date: string;
  date_from: string;
  date_to: string;
  search: string;
};

const EMPTY_FILTERS: FilterState = {
  buyer: "",
  unit: "",
  metric: "",
  section: "",
  report_type_id: "",
  report_date: "",
  date_from: "",
  date_to: "",
  search: "",
};

type GroupByDimension = "buyer" | "unit" | "section" | "metric";

const GROUP_BY_OPTIONS: { value: GroupByDimension; label: string }[] = [
  { value: "buyer", label: "Buyer" },
  { value: "unit", label: "Unit" },
  { value: "section", label: "Section" },
  { value: "metric", label: "Metric" },
];

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

/**
 * Operational query module (MD07-2).
 *
 * Combines the operational query panel (buyer/unit/metric/date/section
 * filters + quick search), the semantic fact viewer grid (sortable, with
 * workbook source references + sheet/cell visibility), grouped aggregation
 * totals, the historical comparison layer, and workbook traceability.
 *
 * This is a pure consumer of the operational query API — it does not touch the
 * workbook ingestion, reconstruction, AG Grid workbook rendering, or export
 * surfaces.
 */
export function OperationalQueryModule() {
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [searchDraft, setSearchDraft] = useState("");
  const [groupBy, setGroupBy] = useState<GroupByDimension[]>(["buyer"]);
  const [traceFactId, setTraceFactId] = useState<string | null>(null);

  const dimensions = useOperationalDimensions();
  const reportTypesQuery = useQuery({
    queryKey: ["report-types"],
    queryFn: listReportTypes,
    staleTime: 300_000,
  });
  const reportTypeOptions = useMemo(
    () =>
      (reportTypesQuery.data?.report_types ?? [])
        .filter((option) => option.is_active)
        .map((option) => ({ value: option.id, label: option.name })),
    [reportTypesQuery.data?.report_types],
  );

  const queryParams = useMemo<OperationalQueryParams>(() => {
    const params: OperationalQueryParams = { page: 1, page_size: 500 };
    if (filters.buyer) params.buyer = filters.buyer;
    if (filters.unit) params.unit = filters.unit;
    if (filters.metric) params.metric = filters.metric;
    if (filters.section) params.section = filters.section;
    if (filters.report_type_id) params.report_type_id = filters.report_type_id;
    if (filters.report_date) params.report_date = filters.report_date;
    if (filters.date_from) params.date_from = filters.date_from;
    if (filters.date_to) params.date_to = filters.date_to;
    if (filters.search) params.search = filters.search;
    return params;
  }, [filters]);

  const factsQuery = useOperationalFacts(queryParams);
  const facts = useMemo(() => factsQuery.data?.facts ?? [], [factsQuery.data?.facts]);

  const aggregationQuery = useOperationalAggregation({
    group_by: groupBy,
    buyer: filters.buyer || undefined,
    unit: filters.unit || undefined,
    metric: filters.metric || undefined,
    section: filters.section || undefined,
    report_type_id: filters.report_type_id || undefined,
    report_date: filters.report_date || undefined,
    date_from: filters.date_from || undefined,
    date_to: filters.date_to || undefined,
  });

  const activeFilterCount = Object.values(filters).filter(Boolean).length;

  const columnDefs = useMemo<ColDef<OperationalFact>[]>(
    () => [
      {
        headerName: "Metric",
        field: "metric_label",
        minWidth: 160,
        flex: 1.4,
      },
      { headerName: "Buyer", field: "buyer", minWidth: 110, flex: 1 },
      { headerName: "Unit", field: "unit", minWidth: 100, flex: 1 },
      {
        headerName: "Section",
        field: "operational_section_label",
        minWidth: 140,
        flex: 1,
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

  function updateFilter(key: keyof FilterState, value: string) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function applySearch() {
    setFilters((current) => ({ ...current, search: searchDraft.trim() }));
  }

  function clearFilters() {
    setFilters(EMPTY_FILTERS);
    setSearchDraft("");
  }

  function toggleGroupBy(dimension: GroupByDimension) {
    setGroupBy((current) =>
      current.includes(dimension)
        ? current.filter((item) => item !== dimension)
        : [...current, dimension],
    );
  }

  const dimensionData = dimensions.data;
  const aggregationRows = aggregationQuery.data?.rows ?? [];
  const totals = aggregationQuery.data?.totals;

  return (
    <div className="space-y-4">
      <section className="rounded-md border bg-card/70 p-4 shadow-sm backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Database className="size-4 text-primary" />
            <h2 className="text-sm font-semibold">Operational Query</h2>
            {activeFilterCount > 0 && (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] text-primary">
                {activeFilterCount} filter{activeFilterCount === 1 ? "" : "s"}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Button
              aria-label="Refresh facts"
              disabled={factsQuery.isFetching}
              onClick={() => factsQuery.refetch()}
              size="icon"
              variant="ghost"
            >
              <RefreshCw className={cn("size-4", factsQuery.isFetching && "animate-spin")} />
            </Button>
            <Button onClick={clearFilters} variant="outline">
              <X className="size-4" />
              Clear
            </Button>
          </div>
        </div>

        <div className="mt-3 grid gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          <FilterSelect
            label="Buyer"
            value={filters.buyer}
            onChange={(value) => updateFilter("buyer", value)}
            options={dimensionData?.buyers ?? []}
            placeholder="All buyers"
          />
          <FilterSelect
            label="Unit"
            value={filters.unit}
            onChange={(value) => updateFilter("unit", value)}
            options={dimensionData?.units ?? []}
            placeholder="All units"
          />
          <FilterSelect
            label="Metric"
            value={filters.metric}
            onChange={(value) => updateFilter("metric", value)}
            options={dimensionData?.metrics ?? []}
            placeholder="All metrics"
          />
          <FilterSelect
            label="Section"
            value={filters.section}
            onChange={(value) => updateFilter("section", value)}
            options={dimensionData?.sections ?? []}
            placeholder="All sections"
          />
          <FilterSelect
            label="Report type"
            value={filters.report_type_id}
            onChange={(value) => updateFilter("report_type_id", value)}
            options={reportTypeOptions}
            placeholder="All report types"
          />
          <label className="grid gap-1 text-xs font-medium text-muted-foreground">
            Report date
            <input
              className="h-9 rounded-md border bg-background/80 px-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
              onChange={(event) => updateFilter("report_date", event.target.value)}
              type="date"
              value={filters.report_date}
            />
          </label>
          <label className="grid gap-1 text-xs font-medium text-muted-foreground">
            Date from
            <input
              className="h-9 rounded-md border bg-background/80 px-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
              onChange={(event) => updateFilter("date_from", event.target.value)}
              type="date"
              value={filters.date_from}
            />
          </label>
          <label className="grid gap-1 text-xs font-medium text-muted-foreground">
            Date to
            <input
              className="h-9 rounded-md border bg-background/80 px-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
              onChange={(event) => updateFilter("date_to", event.target.value)}
              type="date"
              value={filters.date_to}
            />
          </label>
          <div className="grid gap-1 text-xs font-medium text-muted-foreground">
            Quick search
            <div className="flex gap-1">
              <input
                className="h-9 min-w-0 flex-1 rounded-md border bg-background/80 px-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
                onChange={(event) => setSearchDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    applySearch();
                  }
                }}
                placeholder="metric, buyer, unit…"
                value={searchDraft}
              />
              <Button aria-label="Search" onClick={applySearch} size="icon" variant="outline">
                <Search className="size-4" />
              </Button>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-md border bg-card/70 p-4 shadow-sm backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Layers className="size-4 text-primary" />
            <h3 className="text-sm font-semibold">Grouped totals</h3>
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <span className="mr-1 text-xs text-muted-foreground">Group by</span>
            {GROUP_BY_OPTIONS.map((option) => (
              <button
                className={cn(
                  "rounded-md border px-2 py-1 text-xs transition",
                  groupBy.includes(option.value)
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-background/70 text-muted-foreground hover:bg-secondary",
                )}
                key={option.value}
                onClick={() => toggleGroupBy(option.value)}
                type="button"
              >
                {option.label}
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
                    {dimension}
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

      <OperationalComparisonPanel
        metric={filters.metric || null}
        currentDate={filters.report_date || dimensionData?.dates?.[0]?.value || null}
        buyer={filters.buyer || null}
        unit={filters.unit || null}
        section={filters.section || null}
      />

      <section className="rounded-md border bg-card/70 p-4 shadow-sm backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Filter className="size-4 text-primary" />
            <h3 className="text-sm font-semibold">Operational facts</h3>
            <span className="text-xs text-muted-foreground">
              {factsQuery.data?.total ?? 0} matching
            </span>
          </div>
          {factsQuery.isFetching && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
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

      <OperationalFactTraceDrawer factId={traceFactId} onClose={() => setTraceFactId(null)} />
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  placeholder: string;
}) {
  return (
    <label className="grid gap-1 text-xs font-medium text-muted-foreground">
      {label}
      <select
        className="h-9 rounded-md border bg-background/80 px-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-card/60 px-2 py-1.5">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-base font-semibold tabular-nums">{value}</div>
    </div>
  );
}
