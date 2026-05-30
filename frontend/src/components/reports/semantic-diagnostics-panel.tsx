"use client";

import { AlertTriangle, BadgeCheck, CheckCircle2, CircleDashed, ShieldAlert } from "lucide-react";
import { useMemo } from "react";
import type {
  SemanticConfidenceBand,
  SemanticDiagnostics,
  SemanticIssue,
  WorkbookSemanticMapping,
} from "@/lib/reports/types";
import { cn } from "@/lib/utils";

const CONFIDENCE_BANDS: SemanticConfidenceBand[] = [
  "explicit",
  "inferred",
  "ambiguous",
  "unmapped",
];

const CONFIDENCE_TONES: Record<SemanticConfidenceBand, string> = {
  explicit: "border-emerald-300/40 bg-emerald-100/30 text-emerald-900 dark:border-emerald-400/30 dark:bg-emerald-900/20 dark:text-emerald-200",
  inferred: "border-sky-300/40 bg-sky-100/30 text-sky-900 dark:border-sky-400/30 dark:bg-sky-900/20 dark:text-sky-200",
  ambiguous: "border-amber-300/40 bg-amber-100/30 text-amber-900 dark:border-amber-400/30 dark:bg-amber-900/20 dark:text-amber-200",
  unmapped: "border-zinc-300/40 bg-zinc-100/30 text-zinc-700 dark:border-zinc-400/30 dark:bg-zinc-900/30 dark:text-zinc-300",
};

const SEVERITY_TONES: Record<SemanticIssue["severity"], string> = {
  info: "border-sky-300/40 bg-sky-100/30 text-sky-900 dark:border-sky-400/30 dark:bg-sky-900/20 dark:text-sky-200",
  warning: "border-amber-300/40 bg-amber-100/30 text-amber-900 dark:border-amber-400/30 dark:bg-amber-900/20 dark:text-amber-200",
  error: "border-rose-300/40 bg-rose-100/30 text-rose-900 dark:border-rose-400/30 dark:bg-rose-900/20 dark:text-rose-200",
};

const HEALTH_LABEL: Record<NonNullable<SemanticDiagnostics["health"]>, string> = {
  ok: "Workbook semantic layer is verified.",
  warning: "Workbook semantic layer has open warnings.",
  error: "Workbook semantic layer has errors that need review.",
};

const HEALTH_TONE: Record<NonNullable<SemanticDiagnostics["health"]>, string> = {
  ok: "border-emerald-300/40 bg-emerald-100/30 text-emerald-900 dark:border-emerald-400/30 dark:bg-emerald-900/20 dark:text-emerald-200",
  warning: "border-amber-300/40 bg-amber-100/30 text-amber-900 dark:border-amber-400/30 dark:bg-amber-900/20 dark:text-amber-200",
  error: "border-rose-300/40 bg-rose-100/30 text-rose-900 dark:border-rose-400/30 dark:bg-rose-900/20 dark:text-rose-200",
};

const HEALTH_ICON: Record<NonNullable<SemanticDiagnostics["health"]>, typeof CheckCircle2> = {
  ok: BadgeCheck,
  warning: AlertTriangle,
  error: ShieldAlert,
};

type Props = {
  diagnostics: SemanticDiagnostics | null | undefined;
  mapping?: WorkbookSemanticMapping | null;
  selectedSheetName?: string | null;
};

const OWNERSHIP_SOURCE_LABELS: Record<string, string> = {
  merged_inheritance: "Merged inheritance",
  grouping_block: "Grouping block",
  column_header: "Column header",
  direct_label: "Direct label",
  positional: "Positional",
  inferred_fallback: "Inferred fallback",
  none: "Unresolved",
  not_applicable: "N/A",
};

function Metric({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div
      className={cn(
        "rounded-md border px-2 py-1.5",
        ok
          ? "border-emerald-300/40 bg-emerald-100/30 text-emerald-900 dark:border-emerald-400/30 dark:bg-emerald-900/20 dark:text-emerald-200"
          : "border-amber-300/40 bg-amber-100/30 text-amber-900 dark:border-amber-400/30 dark:bg-amber-900/20 dark:text-amber-200",
      )}
    >
      <div className="text-[11px] uppercase tracking-wide opacity-80">{label}</div>
      <div className="mt-0.5 text-base font-semibold tabular-nums">{value}</div>
    </div>
  );
}

export function SemanticDiagnosticsPanel({
  diagnostics,
  mapping,
  selectedSheetName,
}: Props) {
  const factCount = diagnostics?.fact_count ?? mapping?.fact_count ?? 0;

  const confidenceCounts = useMemo(() => {
    const counts: Record<SemanticConfidenceBand, number> = {
      explicit: 0,
      inferred: 0,
      ambiguous: 0,
      unmapped: 0,
    };
    const source = diagnostics?.confidence_counts ?? mapping?.confidence_counts ?? {};
    for (const band of CONFIDENCE_BANDS) {
      const value = source[band];
      counts[band] = typeof value === "number" ? value : 0;
    }
    return counts;
  }, [diagnostics, mapping]);

  const trustedCount = confidenceCounts.explicit + confidenceCounts.inferred;
  const trustedShare =
    typeof diagnostics?.trust_ratio === "number"
      ? Math.round(diagnostics.trust_ratio * 100)
      : factCount > 0
        ? Math.round((trustedCount / factCount) * 100)
        : 0;
  const explicitShare =
    factCount > 0 ? Math.round((confidenceCounts.explicit / factCount) * 100) : 0;
  const ambiguousShare =
    factCount > 0 ? Math.round((confidenceCounts.ambiguous / factCount) * 100) : 0;
  const unmappedShare =
    factCount > 0 ? Math.round((confidenceCounts.unmapped / factCount) * 100) : 0;

  const ownershipConflicts = diagnostics?.ownership_conflicts ?? [];
  const ownershipSources = diagnostics?.ownership_sources ?? {};

  const sortedIssues = useMemo(() => {
    if (!diagnostics?.issues) {
      return [] as SemanticIssue[];
    }
    return [...diagnostics.issues].sort((left, right) => {
      const order = { error: 0, warning: 1, info: 2 } as const;
      return order[left.severity] - order[right.severity];
    });
  }, [diagnostics]);

  const ambiguousRows = useMemo(() => {
    if (!diagnostics?.ambiguous_rows) {
      return [];
    }
    if (!selectedSheetName) {
      return diagnostics.ambiguous_rows;
    }
    return diagnostics.ambiguous_rows.filter(
      (row) => !row.sheet_name || row.sheet_name === selectedSheetName,
    );
  }, [diagnostics, selectedSheetName]);

  const unmappedRegions = useMemo(() => {
    if (!diagnostics?.unmapped_regions) {
      return [];
    }
    if (!selectedSheetName) {
      return diagnostics.unmapped_regions;
    }
    return diagnostics.unmapped_regions.filter(
      (region) => !region.sheet_name || region.sheet_name === selectedSheetName,
    );
  }, [diagnostics, selectedSheetName]);

  const orphanCells = useMemo(() => {
    if (!diagnostics?.orphan_cells) {
      return [];
    }
    if (!selectedSheetName) {
      return diagnostics.orphan_cells;
    }
    return diagnostics.orphan_cells.filter(
      (cell) => !cell.sheet_name || cell.sheet_name === selectedSheetName,
    );
  }, [diagnostics, selectedSheetName]);

  if (!diagnostics) {
    return (
      <div className="rounded-md border bg-background/55 p-3 text-xs">
        <div className="flex items-center gap-2 text-foreground">
          <CircleDashed className="size-4" />
          <span className="text-sm font-medium">Semantic verification</span>
        </div>
        <p className="mt-1 text-muted-foreground">
          Diagnostics are not available for this workbook yet. Re-upload the file to
          generate the semantic verification report.
        </p>
      </div>
    );
  }

  const HealthIcon = HEALTH_ICON[diagnostics.health];

  return (
    <div className="rounded-md border bg-background/55 p-3 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-medium text-foreground">Semantic verification</div>
          <div className="mt-0.5 text-muted-foreground">
            {factCount} mapped fact{factCount === 1 ? "" : "s"} across{" "}
            {diagnostics.sheets_with_facts} sheet
            {diagnostics.sheets_with_facts === 1 ? "" : "s"}.
          </div>
        </div>
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 font-medium",
            HEALTH_TONE[diagnostics.health],
          )}
        >
          <HealthIcon className="size-3.5" />
          {HEALTH_LABEL[diagnostics.health]}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {CONFIDENCE_BANDS.map((band) => (
          <div
            className={cn("rounded-md border px-2 py-1.5", CONFIDENCE_TONES[band])}
            key={band}
          >
            <div className="text-[11px] uppercase tracking-wide opacity-80">
              {band}
            </div>
            <div className="mt-0.5 text-base font-semibold tabular-nums">
              {confidenceCounts[band]}
            </div>
          </div>
        ))}
      </div>

      {factCount > 0 && (
        <div className="mt-3 rounded-md border bg-background/40 p-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Semantic health
            </span>
            <span className="text-[11px] text-muted-foreground">
              Targets: trust ≥ 95% · explicit &gt; 80% · ambiguous &lt; 5%
            </span>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Metric
              label="Trust ratio"
              value={`${trustedShare}%`}
              ok={trustedShare >= 95}
            />
            <Metric
              label="Explicit"
              value={`${explicitShare}%`}
              ok={explicitShare > 80}
            />
            <Metric
              label="Ambiguous"
              value={`${ambiguousShare}%`}
              ok={ambiguousShare < 5}
            />
            <Metric
              label="Unmapped"
              value={`${unmappedShare}%`}
              ok={unmappedShare < 5}
            />
          </div>
          <div className="mt-2 text-[11px] text-muted-foreground">
            {trustedCount} of {factCount} fact{factCount === 1 ? "" : "s"} mapped
            explicitly or with strong inference.
          </div>
        </div>
      )}

      {sortedIssues.length > 0 && (
        <div className="mt-3 border-t pt-2">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Issues
          </div>
          <ul className="mt-1.5 grid gap-1">
            {sortedIssues.map((issue, index) => (
              <li
                className={cn(
                  "rounded-sm border px-2 py-1 text-[11px]",
                  SEVERITY_TONES[issue.severity],
                )}
                key={`${issue.code}-${index}`}
              >
                <span className="font-mono text-[10px]">{issue.code}</span>
                {" · "}
                {issue.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {Object.keys(ownershipSources).length > 0 && (
        <div className="mt-3 border-t pt-2">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Ownership sources
          </div>
          <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
            {(["unit", "buyer", "metric", "section"] as const).map((dimension) => {
              const counts = ownershipSources[dimension];
              if (!counts || Object.keys(counts).length === 0) {
                return null;
              }
              return (
                <div className="rounded-sm border bg-background/60 px-2 py-1.5" key={dimension}>
                  <div className="text-[11px] font-medium capitalize text-foreground">
                    {dimension}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {Object.entries(counts)
                      .sort((a, b) => b[1] - a[1])
                      .map(([source, count]) => (
                        <span
                          className="rounded-sm border bg-background/70 px-1.5 py-0.5 text-[10px] text-muted-foreground"
                          key={source}
                          title={source}
                        >
                          {OWNERSHIP_SOURCE_LABELS[source] ?? source}
                          {" · "}
                          <span className="font-mono text-foreground">{count}</span>
                        </span>
                      ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {ownershipConflicts.length > 0 && (
        <div className="mt-3 border-t pt-2">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Ownership conflicts
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {ownershipConflicts.slice(0, 12).map((conflict, index) => (
              <span
                className="rounded-sm border bg-background/70 px-1.5 py-1 text-[11px] text-foreground"
                key={`${conflict.cell_address ?? "?"}-${index}`}
                title={(conflict.problems ?? []).join(", ")}
              >
                {conflict.sheet_name ? `${conflict.sheet_name} ` : ""}
                <span className="font-mono">{conflict.cell_address ?? "?"}</span>
                {" · "}
                {(conflict.problems ?? []).join(", ")}
              </span>
            ))}
            {ownershipConflicts.length > 12 && (
              <span className="text-[11px] text-muted-foreground">
                +{ownershipConflicts.length - 12} more
              </span>
            )}
          </div>
        </div>
      )}

      {ambiguousRows.length > 0 && (
        <div className="mt-3 border-t pt-2">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Ambiguous rows
            {selectedSheetName ? ` — ${selectedSheetName}` : ""}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {ambiguousRows.slice(0, 12).map((row, index) => (
              <span
                className="rounded-sm border bg-background/70 px-1.5 py-1 font-mono text-[11px] text-foreground"
                key={`${row.sheet_name ?? "?"}-${row.row_number ?? index}-${index}`}
                title={row.row_label ?? ""}
              >
                {row.sheet_name ? `${row.sheet_name} ` : ""}row {row.row_number ?? "—"}
                {row.metric_label ? ` · ${row.metric_label}` : ""}
              </span>
            ))}
            {ambiguousRows.length > 12 && (
              <span className="text-[11px] text-muted-foreground">
                +{ambiguousRows.length - 12} more
              </span>
            )}
          </div>
        </div>
      )}

      {unmappedRegions.length > 0 && (
        <div className="mt-3 border-t pt-2">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Unmapped regions
            {selectedSheetName ? ` — ${selectedSheetName}` : ""}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {unmappedRegions.slice(0, 12).map((region, index) => (
              <span
                className="rounded-sm border bg-background/70 px-1.5 py-1 font-mono text-[11px] text-foreground"
                key={`${region.region_id ?? "?"}-${index}`}
                title={region.label ?? region.kind ?? ""}
              >
                {region.range ?? region.region_id ?? "region"}
                {region.kind ? ` · ${region.kind}` : ""}
              </span>
            ))}
            {unmappedRegions.length > 12 && (
              <span className="text-[11px] text-muted-foreground">
                +{unmappedRegions.length - 12} more
              </span>
            )}
          </div>
        </div>
      )}

      {diagnostics.duplicate_facts.length > 0 && (
        <div className="mt-3 border-t pt-2">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Duplicate signatures
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {diagnostics.duplicate_facts.slice(0, 8).map((dup, index) => (
              <span
                className="rounded-sm border bg-background/70 px-1.5 py-1 text-[11px] text-foreground"
                key={`${dup.metric_key ?? "?"}-${dup.buyer ?? "?"}-${dup.unit ?? "?"}-${index}`}
                title={dup.sample_cells?.join(", ") ?? ""}
              >
                {dup.metric_label ?? dup.metric_key}
                {dup.buyer ? ` · ${dup.buyer}` : ""}
                {dup.unit ? ` · ${dup.unit}` : ""}
                {" · "}
                <span className="font-mono">×{dup.fact_count ?? 0}</span>
              </span>
            ))}
            {diagnostics.duplicate_facts.length > 8 && (
              <span className="text-[11px] text-muted-foreground">
                +{diagnostics.duplicate_facts.length - 8} more
              </span>
            )}
          </div>
        </div>
      )}

      {orphanCells.length > 0 && (
        <div className="mt-3 border-t pt-2">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Orphan numeric cells
            {selectedSheetName ? ` — ${selectedSheetName}` : ""}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {orphanCells.slice(0, 12).map((cell, index) => (
              <span
                className="rounded-sm border bg-background/70 px-1.5 py-1 font-mono text-[11px] text-foreground"
                key={`${cell.sheet_name ?? "?"}-${cell.cell_address ?? index}`}
              >
                {cell.sheet_name ? `${cell.sheet_name} ` : ""}
                {cell.cell_address ?? "?"}
                {cell.value !== undefined && cell.value !== null
                  ? ` · ${String(cell.value)}`
                  : ""}
              </span>
            ))}
            {orphanCells.length > 12 && (
              <span className="text-[11px] text-muted-foreground">
                +{orphanCells.length - 12} more
              </span>
            )}
          </div>
        </div>
      )}

      {diagnostics.missing_workbook_references.length > 0 && (
        <div className="mt-3 border-t pt-2">
          <div className="text-[11px] font-medium uppercase tracking-wide text-rose-700 dark:text-rose-300">
            Missing workbook references
          </div>
          <ul className="mt-1.5 grid gap-1">
            {diagnostics.missing_workbook_references.slice(0, 8).map((ref, index) => (
              <li
                className={cn(
                  "rounded-sm border px-2 py-1 text-[11px]",
                  SEVERITY_TONES.error,
                )}
                key={`${ref.source_key ?? "?"}-${index}`}
              >
                <span className="font-mono text-[10px]">
                  {ref.metric_key ?? "metric"}
                </span>
                {" · "}
                missing: {(ref.missing_fields ?? []).join(", ")}
              </li>
            ))}
          </ul>
        </div>
      )}

      {diagnostics.sheets_without_facts.length > 0 && (
        <div className="mt-3 border-t pt-2">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Sheets without semantic facts
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {diagnostics.sheets_without_facts.map((sheet) => (
              <span
                className="rounded-sm border bg-background/70 px-1.5 py-1 text-[11px] text-foreground"
                key={sheet}
              >
                {sheet}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
