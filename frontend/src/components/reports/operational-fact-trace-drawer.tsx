"use client";

import { Loader2, MapPin, X } from "lucide-react";
import { useOperationalFactTrace } from "@/lib/reports/operational-hooks";
import { cn } from "@/lib/utils";

type Props = {
  factId: string | null;
  onClose: () => void;
};

function formatValue(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return "—";
  }
  if (typeof value === "boolean") {
    return value ? "TRUE" : "FALSE";
  }
  return String(value);
}

function Row({ label, value, mono }: { label: string; value: unknown; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border/50 py-1.5 last:border-0">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className={cn("text-right text-xs text-foreground", mono && "font-mono")}>
        {formatValue(value)}
      </span>
    </div>
  );
}

/**
 * Workbook traceability drawer (MD07-2).
 *
 * Click a semantic fact to trace it back to its workbook, sheet, cell, and
 * operational section, with extraction confidence and upload timestamp.
 */
export function OperationalFactTraceDrawer({ factId, onClose }: Props) {
  const { data, isLoading, isError, error } = useOperationalFactTrace(factId);

  if (!factId) {
    return null;
  }

  const confidence = data?.extraction_confidence as
    | { overall?: string; reasons?: string[] }
    | undefined;
  const ownership = data?.ownership as
    | {
        unit_source?: string;
        buyer_source?: string;
        metric_source?: string;
        section_source?: string;
        is_rollup?: boolean;
      }
    | undefined;

  const ownershipSourceLabel = (source?: string) => {
    switch (source) {
      case "merged_inheritance":
        return "Merged inheritance";
      case "grouping_block":
        return "Grouping block";
      case "column_header":
        return "Column header";
      case "direct_label":
        return "Direct label";
      case "positional":
        return "Positional context";
      case "inferred_fallback":
        return "Inferred fallback";
      case "not_applicable":
        return "—";
      case "none":
        return "Unresolved";
      default:
        return source ?? "—";
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        aria-label="Close traceability"
        className="absolute inset-0 bg-foreground/20 backdrop-blur-sm"
        onClick={onClose}
        type="button"
      />
      <aside className="relative flex h-full w-full max-w-md flex-col overflow-y-auto border-l bg-card shadow-xl">
        <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <MapPin className="size-4 text-primary" />
            <h3 className="text-sm font-semibold">Workbook traceability</h3>
          </div>
          <button
            aria-label="Close"
            className="rounded-md p-1 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
            onClick={onClose}
            type="button"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="flex-1 space-y-4 p-4 text-sm">
          {isLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Loading traceability…
            </div>
          ) : isError ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {(error as Error)?.message ?? "Unable to load traceability."}
            </div>
          ) : data ? (
            <>
              <section className="rounded-md border bg-background/60 p-3">
                <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Operational fact
                </div>
                <div className="mt-2 grid">
                  <Row label="Metric" value={data.fact.metric_label} />
                  <Row label="Buyer" value={data.fact.buyer} />
                  <Row label="Unit" value={data.fact.unit} />
                  <Row label="Report date" value={data.fact.report_date} />
                  <Row label="Section" value={data.operational_section_label} />
                  <Row
                    label="Value"
                    value={
                      data.fact.value_type === "number"
                        ? data.fact.value_numeric
                        : data.fact.value_type === "date"
                          ? data.fact.value_date
                          : data.fact.value_type === "boolean"
                            ? data.fact.value_boolean
                            : data.fact.value_text
                    }
                  />
                </div>
              </section>

              <section className="rounded-md border bg-background/60 p-3">
                <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Ownership source
                </div>
                <div className="mt-2 grid">
                  <Row label="Unit" value={ownershipSourceLabel(ownership?.unit_source)} />
                  <Row label="Buyer" value={ownershipSourceLabel(ownership?.buyer_source)} />
                  <Row label="Metric" value={ownershipSourceLabel(ownership?.metric_source)} />
                  <Row label="Section" value={ownershipSourceLabel(ownership?.section_source)} />
                  <Row
                    label="Rollup / aggregate"
                    value={ownership?.is_rollup ? "Yes" : "No"}
                  />
                </div>
              </section>

              <section className="rounded-md border bg-background/60 p-3">
                <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Workbook source
                </div>
                <div className="mt-2 grid">
                  <Row label="Workbook" value={data.workbook.original_filename} />
                  <Row label="Sheet" value={data.sheet_name} />
                  <Row label="Sheet index" value={data.sheet_index} />
                  <Row label="Cell" value={data.cell_address} mono />
                  <Row label="Row / Column" value={`${data.fact.source_row_number} / ${data.fact.source_column_number}`} mono />
                  <Row label="Region" value={data.source_region_range ?? data.source_region_id} mono />
                  <Row label="Region kind" value={data.source_region_kind} />
                </div>
              </section>

              <section className="rounded-md border bg-background/60 p-3">
                <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Extraction provenance
                </div>
                <div className="mt-2 grid">
                  <Row label="Confidence" value={confidence?.overall} />
                  <Row label="Engine" value={data.extraction_source} />
                  <Row
                    label="Uploaded"
                    value={
                      data.upload_timestamp
                        ? new Date(data.upload_timestamp).toLocaleString()
                        : null
                    }
                  />
                  <Row label="Calculated state" value={data.fact.calculated_state} />
                  <Row label="Formula" value={data.fact.formula} mono />
                </div>
                {confidence?.reasons && confidence.reasons.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {confidence.reasons.map((reason) => (
                      <span
                        className="rounded-sm border bg-background/70 px-1.5 py-0.5 text-[10px] text-muted-foreground"
                        key={reason}
                      >
                        {reason}
                      </span>
                    ))}
                  </div>
                )}
              </section>
            </>
          ) : null}
        </div>
      </aside>
    </div>
  );
}
