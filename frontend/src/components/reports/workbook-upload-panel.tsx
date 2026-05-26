"use client";

import { AgGridReact } from "ag-grid-react";
import {
  AllCommunityModule,
  ModuleRegistry,
  type CellEditRequestEvent,
  type ColDef,
  type RowStyle,
} from "ag-grid-community";
import { AnimatePresence, motion } from "framer-motion";
import { Bug, Download, FileSpreadsheet, Loader2, Upload, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  exportWorkbook,
  triggerWorkbookDownload,
  uploadWorkbook,
  type WorkbookExportPayload,
} from "@/lib/reports/api";
import type {
  WorkbookCellPreview,
  WorkbookSheetPreview,
  WorkbookUploadResponse,
} from "@/lib/reports/types";
import { cn } from "@/lib/utils";

ModuleRegistry.registerModules([AllCommunityModule]);

type WorkbookPreviewRow = {
  id: string;
  sheet: string;
  dimension: string;
  rows: number;
  columns: number;
  cells: number;
  formulas: number;
  merged: number;
  hidden: string;
  freeze: string;
  regions: number;
};

type WorkbookGridRow = {
  id: string;
  __rowNumber: number;
  __height: number | null;
  __regionKind: string | null;
  __regionRole: "editable" | "readonly" | "structural";
  __styles: Record<string, Record<string, string | number>>;
  __editableFields: Record<string, boolean>;
  __readonlyReasons: Record<string, string>;
  __addresses: Record<string, string>;
  __cellRegionKinds: Record<string, string>;
  __formulaFields: Record<string, boolean>;
  __mergeCovered: Record<string, boolean>;
  __mergeSpans: Record<string, WorkbookMergeSpan>;
  [field: string]: unknown;
};

type WorkbookEditValue = string | number | boolean | null;
type WorkbookSheetEditMap = Record<string, WorkbookEditValue>;
type WorkbookMergeSpan = { range: string; rows: number; columns: number };

type WorkbookSheetReconstructionStats = {
  rendered: number;
  skipped: number;
  hiddenRows: number;
  hiddenColumns: number;
  mergedRegions: number;
  orphanMasters: number;
  oversizedRowsTrimmed: number;
  oversizedColumnsTrimmed: number;
  rowLimit: number;
  columnLimit: number;
};

type WorkbookSheetGridResult = {
  rows: WorkbookGridRow[];
  stats: WorkbookSheetReconstructionStats;
};

type SafeSyncRegions = NonNullable<WorkbookSheetPreview["sync"]>["regions"];

const EMPTY_SYNC_REGIONS: SafeSyncRegions = {
  editable: [],
  readonly: [],
  structural: [],
  merged: [],
};

function safeSyncRegions(sheet: WorkbookSheetPreview | null | undefined): SafeSyncRegions {
  const regions = sheet?.sync?.regions;
  if (!regions || typeof regions !== "object") {
    return EMPTY_SYNC_REGIONS;
  }
  return {
    editable: Array.isArray(regions.editable) ? regions.editable : [],
    readonly: Array.isArray(regions.readonly) ? regions.readonly : [],
    structural: Array.isArray(regions.structural) ? regions.structural : [],
    merged: Array.isArray(regions.merged) ? regions.merged : [],
  };
}

function safeSyncCells(sheet: WorkbookSheetPreview | null | undefined) {
  const cells = sheet?.sync?.cells;
  return Array.isArray(cells) ? cells : [];
}

function safeSyncRows(sheet: WorkbookSheetPreview | null | undefined) {
  const rows = sheet?.sync?.rows;
  return Array.isArray(rows) ? rows : [];
}

function safeSyncColumns(sheet: WorkbookSheetPreview | null | undefined) {
  const columns = sheet?.sync?.columns;
  return Array.isArray(columns) ? columns : [];
}

function safeSheetCells(sheet: WorkbookSheetPreview | null | undefined) {
  const cells = sheet?.cells;
  return Array.isArray(cells) ? cells : [];
}

function isSheetDegraded(sheet: WorkbookSheetPreview | null | undefined) {
  if (!sheet) {
    return false;
  }
  if (sheet.degraded) {
    return true;
  }
  if (sheet.sync?.degraded) {
    return true;
  }
  // Treat sheets with no sync mapping at all as degraded.
  if (!sheet.sync || typeof sheet.sync !== "object") {
    return true;
  }
  return false;
}

const excelColumnLetters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const maxSheetPreviewRows = 120;
const maxSheetPreviewColumns = 60;
const excelPointToPixelRatio = 96 / 72;
const defaultExcelRowHeight = 15;
const defaultExcelColumnWidth = 8.43;

function formatBytes(value: number) {
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function columnName(index: number) {
  let value = index;
  let name = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = excelColumnLetters.charAt(remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

function normalizeColor(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }
  if (/^[A-Fa-f0-9]{8}$/.test(value)) {
    return `#${value.slice(2)}`;
  }
  if (/^[A-Fa-f0-9]{6}$/.test(value)) {
    return `#${value}`;
  }
  return null;
}

function nestedRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function numberFromUnknown(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function cssTextAlign(value: unknown) {
  if (value === "center" || value === "right" || value === "left" || value === "justify") {
    return value;
  }
  if (value === "centerContinuous") {
    return "center";
  }
  return null;
}

function cssVerticalAlign(value: unknown) {
  if (value === "center") {
    return "middle";
  }
  if (value === "top" || value === "bottom" || value === "middle") {
    return value;
  }
  return null;
}

function borderStyle(side: unknown) {
  const sideRecord = nestedRecord(side);
  const style = sideRecord.style;
  if (!style) {
    return null;
  }
  const color = normalizeColor(sideRecord.color) ?? "var(--border)";
  return `1px solid ${color}`;
}

function styleFromCell(cell: WorkbookCellPreview): Record<string, string | number> {
  const style = nestedRecord(cell.style);
  const fill = nestedRecord(style.fill);
  const font = nestedRecord(style.font);
  const alignment = nestedRecord(style.alignment);
  const border = nestedRecord(style.border);
  const result: Record<string, string | number> = {};
  const fillColor = normalizeColor(fill.fg_color);
  const fontColor = normalizeColor(font.color);
  const fontSize = numberFromUnknown(font.size);
  const horizontal = cssTextAlign(alignment.horizontal);
  const vertical = cssVerticalAlign(alignment.vertical);

  if (
    fillColor &&
    fillColor.toLowerCase() !== "#000000" &&
    fillColor.toLowerCase() !== "#ffffff"
  ) {
    result.background = fillColor;
  }
  if (font.bold) {
    result.fontWeight = "700";
  }
  if (font.italic) {
    result.fontStyle = "italic";
  }
  if (
    fontColor &&
    fontColor.toLowerCase() !== "#000000" &&
    fontColor.toLowerCase() !== "#ffffff"
  ) {
    result.color = fontColor;
  }
  if (fontSize) {
    result.fontSize = `${Math.max(10, Math.min(15, Math.round(fontSize)))}px`;
  }
  if (horizontal) {
    result.textAlign = horizontal;
    if (horizontal === "center") {
      result.justifyContent = "center";
    }
    if (horizontal === "right") {
      result.justifyContent = "flex-end";
    }
  }
  if (vertical) {
    result.verticalAlign = vertical;
    if (vertical === "top") {
      result.alignItems = "flex-start";
    }
    if (vertical === "bottom") {
      result.alignItems = "flex-end";
    }
  }
  if (alignment.wrap_text) {
    result.whiteSpace = "normal";
    result.lineHeight = "1.2";
  }

  const left = borderStyle(border.left);
  const right = borderStyle(border.right);
  const top = borderStyle(border.top);
  const bottom = borderStyle(border.bottom);
  if (left) {
    result.borderLeft = left;
  }
  if (right) {
    result.borderRight = right;
  }
  if (top) {
    result.borderTop = top;
  }
  if (bottom) {
    result.borderBottom = bottom;
  }

  return result;
}

function sheetToPreviewRow(sheet: WorkbookSheetPreview): WorkbookPreviewRow {
  const structure = sheet.structure ?? {
    merged_cells: [],
    hidden_rows: [],
    hidden_columns: [],
    freeze_panes: null,
  };
  const mergedCells = Array.isArray(structure.merged_cells) ? structure.merged_cells : [];
  const hiddenRows = Array.isArray(structure.hidden_rows) ? structure.hidden_rows : [];
  const hiddenColumns = Array.isArray(structure.hidden_columns) ? structure.hidden_columns : [];
  const regions = Array.isArray(sheet.regions) ? sheet.regions : [];
  return {
    id: `${sheet.index}-${sheet.name}`,
    sheet: sheet.name,
    dimension: sheet.dimension ?? "",
    rows: sheet.max_row ?? 0,
    columns: sheet.max_column ?? 0,
    cells: sheet.non_empty_cell_count ?? 0,
    formulas: sheet.formula_count ?? 0,
    merged: mergedCells.length,
    hidden: `${hiddenRows.length} rows / ${hiddenColumns.length} cols`,
    freeze: structure.freeze_panes ?? "None",
    regions: regions.length,
  };
}

function buildMergedLookup(sheet: WorkbookSheetPreview) {
  const covered = new Map<string, string>();
  const masters = new Map<
    string,
    {
      range: string;
      rows: number;
      columns: number;
      startColumn: number;
      endColumn: number;
    }
  >();

  for (const region of safeSyncRegions(sheet).merged) {
    if (
      !region ||
      typeof region.start_row !== "number" ||
      typeof region.start_column !== "number" ||
      typeof region.end_row !== "number" ||
      typeof region.end_column !== "number" ||
      !region.span
    ) {
      continue;
    }
    const master = `${region.start_row}:${region.start_column}`;
    masters.set(master, {
      range: region.range,
      rows: region.span.rows,
      columns: region.span.columns,
      startColumn: region.start_column,
      endColumn: region.end_column,
    });
    // AG Grid cannot reproduce vertical row spans natively. For
    // vertical-only merges (single column, multiple rows) we still render
    // the master text at its anchor row, but we do NOT mark the other
    // rows' covered cells as "covered" - otherwise they'd be blanked with
    // ``color: transparent`` and force every adjacent column on those
    // rows to look obscured. The merge metadata stays in ``masters`` so
    // the master cell can still surface its merge styling.
    const isVerticalOnly =
      region.span.columns === 1 && region.start_column === region.end_column;
    if (isVerticalOnly) {
      continue;
    }
    for (let row = region.start_row; row <= region.end_row; row += 1) {
      for (let column = region.start_column; column <= region.end_column; column += 1) {
        const key = `${row}:${column}`;
        if (key !== master) {
          covered.set(key, master);
        }
      }
    }
  }

  return { covered, masters };
}

function regionKindForSyncRow(sheet: WorkbookSheetPreview, regionIds: string[]) {
  const sheetRegions = Array.isArray(sheet.regions) ? sheet.regions : [];
  const regionById = new Map(sheetRegions.map((region) => [region.id, region]));
  return regionIds
    .map((regionId) => regionById.get(regionId)?.kind)
    .find((kind) => kind && kind !== "merged_cell_region") ?? null;
}

function regionKindForSyncCell(sheet: WorkbookSheetPreview, regionIds: string[]) {
  return regionKindForSyncRow(sheet, regionIds);
}

function cellDisplayValue(
  cell: WorkbookCellPreview | undefined,
  address: string,
  edits: WorkbookSheetEditMap,
) {
  if (Object.prototype.hasOwnProperty.call(edits, address)) {
    return edits[address] ?? "";
  }
  return cell?.formula ?? cell?.value ?? "";
}

function formatWorkbookCellValue(value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "boolean") {
    return value ? "TRUE" : "FALSE";
  }
  return String(value);
}

function buildSheetGridRows(
  sheet: WorkbookSheetPreview,
  edits: WorkbookSheetEditMap,
): WorkbookSheetGridResult {
  const sheetCells = safeSheetCells(sheet);
  const cellMap = new Map(sheetCells.map((cell) => [`${cell.row}:${cell.column}`, cell]));
  const syncCellMap = new Map(
    safeSyncCells(sheet).map((cell) => [`${cell.workbook_row}:${cell.workbook_column}`, cell]),
  );
  const { covered, masters } = buildMergedLookup(sheet);
  const rows: WorkbookGridRow[] = [];
  const visibleColumns = safeSyncColumns(sheet)
    .filter((column) => !column.hidden)
    .slice(0, maxSheetPreviewColumns);
  const visibleColumnNumbers = visibleColumns.map((column) => column.workbook_column);
  const safeRowHeights =
    sheet.structure && typeof sheet.structure === "object" && sheet.structure.row_heights
      ? sheet.structure.row_heights
      : ({} as Record<string, number>);

  // Build a reverse lookup from anchor address -> master cell, used to surface
  // orphan-master text into the first visible covered cell when the master
  // row itself is hidden by Excel. Without this, operational header titles
  // disappear from the portal even though the workbook still carries them.
  const orphanMasterByVisibleKey = new Map<
    string,
    { masterAddress: string; range: string }
  >();
  for (const syncCell of safeSyncCells(sheet)) {
    const orphan = syncCell.orphan_master;
    if (!orphan || !orphan.master_address) {
      continue;
    }
    orphanMasterByVisibleKey.set(
      `${syncCell.workbook_row}:${syncCell.workbook_column}`,
      {
        masterAddress: orphan.master_address,
        range: orphan.range ?? "",
      },
    );
  }

  // Stats collection
  const totalSyncRows = safeSyncRows(sheet).length;
  const visibleSyncRows = safeSyncRows(sheet).filter((row) => !row.hidden);
  const hiddenRowCount = totalSyncRows - visibleSyncRows.length;
  const hiddenColumnCount = safeSyncColumns(sheet).filter((column) => column.hidden).length;
  const mergedRegionCount = safeSyncRegions(sheet).merged.length;
  const orphanMasterCount = orphanMasterByVisibleKey.size;

  // Filter hidden rows BEFORE slicing so a 120-row preview budget is spent on
  // visible content rather than burned on hidden geometry.
  const renderableSyncRows = visibleSyncRows.slice(0, maxSheetPreviewRows);
  const oversizedRowsTrimmed = Math.max(
    0,
    visibleSyncRows.length - renderableSyncRows.length,
  );
  const totalSyncColumns = safeSyncColumns(sheet).filter((column) => !column.hidden).length;
  const oversizedColumnsTrimmed = Math.max(
    0,
    totalSyncColumns - visibleColumns.length,
  );
  let skippedRowCount = 0;

  for (const syncRow of renderableSyncRows) {
    if (syncRow.hidden) {
      skippedRowCount += 1;
      continue;
    }

    const rowNumber = syncRow.workbook_row;
    const row: WorkbookGridRow = {
      id: syncRow.grid_row_id,
      __rowNumber: rowNumber,
      __height: syncRow.height ?? safeRowHeights[String(rowNumber)] ?? null,
      __regionKind: regionKindForSyncRow(sheet, syncRow.region_ids ?? []),
      __regionRole: syncRow.role ?? "structural",
      __styles: {},
      __editableFields: {},
      __readonlyReasons: {},
      __addresses: {},
      __cellRegionKinds: {},
      __formulaFields: {},
      __mergeCovered: {},
      __mergeSpans: {},
    };

    for (const syncColumn of visibleColumns) {
      const column = syncColumn.workbook_column;
      const field = syncColumn.grid_field;
      const key = `${rowNumber}:${column}`;
      const cell = cellMap.get(key);
      const address = `${syncColumn.workbook_column_name}${rowNumber}`;
      const syncCell = syncCellMap.get(key);
      const isCovered = covered.has(key);
      const mergeMaster = masters.get(key);
      const readonlyReason = syncCell?.readonly_reason ?? "";
      const isEditable = Boolean(syncCell?.editable);
      const cellRegionKind = regionKindForSyncCell(sheet, syncCell?.region_ids ?? []);
      const orphan = orphanMasterByVisibleKey.get(key);

      // Resolve the visible value for this cell. Covered cells normally
      // render as blank, but if they are the first visible covered cell of
      // an orphan merge we re-surface the master cell's text so the
      // operational header survives the hidden anchor row.
      let displayValue: WorkbookEditValue | string | number | boolean | null;
      if (isCovered) {
        if (orphan) {
          // Read the master cell's value out of the parsed cell map.
          const masterAddress = orphan.masterAddress;
          const masterCell = sheetCells.find((candidate) => candidate.address === masterAddress);
          displayValue = masterCell?.formula ?? masterCell?.value ?? "";
        } else {
          displayValue = "";
        }
      } else {
        displayValue = cellDisplayValue(cell, address, edits);
      }

      row[field] = displayValue;
      row.__addresses[field] = address;
      row.__editableFields[field] = isEditable;
      row.__cellRegionKinds[field] = cellRegionKind ?? row.__regionKind ?? "";
      row.__formulaFields[field] = Boolean(syncCell?.has_formula || cell?.formula);
      if (readonlyReason) {
        row.__readonlyReasons[field] = readonlyReason;
      }
      if (cell) {
        row.__styles[field] = styleFromCell(cell);
      }
      if (isEditable) {
        row.__styles[field] = {
          ...row.__styles[field],
          background:
            row.__styles[field]?.background ??
            "color-mix(in oklch, var(--accent) 36%, transparent)",
        };
      }
      if (isCovered) {
        row.__mergeCovered[field] = true;
        // Orphan-rescued cells must remain readable - keep their text color
        // intact and avoid the "transparent" overlay used for normal covered
        // cells.
        const isOrphanRescue = Boolean(orphan && displayValue !== "" && displayValue !== null);
        const baseStyle = row.__styles[field] ?? {};
        const overlayStyle: Record<string, string | number> = {
          ...baseStyle,
          color: isOrphanRescue ? baseStyle.color ?? "inherit" : "transparent",
          background:
            baseStyle.background ??
            (isOrphanRescue
              ? "color-mix(in oklch, var(--secondary) 76%, transparent)"
              : "color-mix(in oklch, var(--muted) 42%, transparent)"),
        };
        if (isOrphanRescue) {
          overlayStyle.fontWeight = baseStyle.fontWeight ?? "650";
        } else if (baseStyle.fontWeight !== undefined) {
          overlayStyle.fontWeight = baseStyle.fontWeight;
        }
        row.__styles[field] = overlayStyle;
        if (isOrphanRescue) {
          row.__mergeSpans[field] = {
            range: orphan?.range || address,
            rows: 1,
            columns: 1,
          };
        }
      }
      if (mergeMaster) {
        const visibleSpanColumns = visibleColumnNumbers.filter(
          (visibleColumn) =>
            visibleColumn >= mergeMaster.startColumn && visibleColumn <= mergeMaster.endColumn,
        ).length;
        row.__mergeSpans[field] = {
          range: mergeMaster.range,
          rows: mergeMaster.rows,
          columns: Math.max(1, visibleSpanColumns || mergeMaster.columns),
        };
        row.__styles[field] = {
          ...row.__styles[field],
          background:
            row.__styles[field]?.background ??
            "color-mix(in oklch, var(--secondary) 76%, transparent)",
          boxShadow: "inset 0 0 0 1px color-mix(in oklch, var(--primary) 46%, transparent)",
          fontWeight: row.__styles[field]?.fontWeight ?? "650",
        };
      }
    }

    rows.push(row);
  }

  return {
    rows,
    stats: {
      rendered: rows.length,
      skipped: skippedRowCount,
      hiddenRows: hiddenRowCount,
      hiddenColumns: hiddenColumnCount,
      mergedRegions: mergedRegionCount,
      orphanMasters: orphanMasterCount,
      oversizedRowsTrimmed,
      oversizedColumnsTrimmed,
      rowLimit: maxSheetPreviewRows,
      columnLimit: maxSheetPreviewColumns,
    },
  };
}

function workbookRowHeight(height: number | null | undefined, fallback?: number | null) {
  const points = height ?? fallback ?? defaultExcelRowHeight;
  return Math.max(22, Math.min(144, Math.round(points * excelPointToPixelRatio) + 4));
}

function workbookColumnWidth(width: number | null | undefined, fallback?: number | null) {
  const excelWidth = width ?? fallback ?? defaultExcelColumnWidth;
  const pixels = Math.round(excelWidth * 7 + 8);
  return Math.max(44, Math.min(360, pixels));
}

function frozenRowCount(sheet: WorkbookSheetPreview | null) {
  const freezePanes = nestedRecord(sheet?.workbook_view?.freeze_panes);
  const count = numberFromUnknown(freezePanes.frozen_rows);
  return count ? Math.max(0, Math.min(maxSheetPreviewRows, count)) : 0;
}

function regionLabel(kind: string) {
  return kind
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

type ReconstructionDiagnosticsPanelProps = {
  sheet: WorkbookSheetPreview;
  stats: WorkbookSheetReconstructionStats | null;
  workbookDiagnostics:
    | {
        warnings?: { sheet?: string | null; code: string; message: string }[];
        orphan_merged_masters?: number;
        hidden_rows?: number;
        hidden_columns?: number;
        merged_regions?: number;
        skipped_blank_rows?: number;
        bands_built?: number;
        debug_logging_enabled?: boolean;
      }
    | null;
  showRegionOverlay: boolean;
  onToggleRegionOverlay: () => void;
};

function ReconstructionDiagnosticsPanel({
  sheet,
  stats,
  workbookDiagnostics,
  showRegionOverlay,
  onToggleRegionOverlay,
}: ReconstructionDiagnosticsPanelProps) {
  const sheetDiagnostics = sheet.reconstruction_diagnostics ?? null;
  const renderedRows = stats?.rendered ?? 0;
  const skippedRows = stats?.skipped ?? 0;
  const hiddenRows =
    stats?.hiddenRows ?? sheetDiagnostics?.hidden_row_count ?? sheet.structure.hidden_rows.length;
  const hiddenColumns =
    stats?.hiddenColumns ??
    sheetDiagnostics?.hidden_column_count ??
    sheet.structure.hidden_columns.length;
  const mergedRegions =
    stats?.mergedRegions ??
    sheetDiagnostics?.merged_region_count ??
    sheet.sync?.regions?.merged?.length ??
    0;
  const orphanMasters =
    stats?.orphanMasters ??
    (sheetDiagnostics?.orphan_merged_masters?.length ?? sheet.sync?.orphan_masters?.length ?? 0);
  const oversizedRows = stats?.oversizedRowsTrimmed ?? 0;
  const oversizedColumns = stats?.oversizedColumnsTrimmed ?? 0;
  const sheetWarnings = sheetDiagnostics?.warnings ?? [];
  const workbookWarnings = (workbookDiagnostics?.warnings ?? []).filter(
    (warning) => warning.sheet && warning.sheet !== sheet.name,
  );

  const stats_entries: { label: string; value: number; tone?: "warning" | "info" }[] = [
    { label: "Rendered rows", value: renderedRows, tone: "info" },
    { label: "Skipped rows", value: skippedRows, tone: skippedRows ? "warning" : "info" },
    { label: "Hidden rows", value: hiddenRows, tone: "info" },
    { label: "Hidden columns", value: hiddenColumns, tone: "info" },
    { label: "Merged regions", value: mergedRegions, tone: "info" },
    {
      label: "Orphan merged masters",
      value: orphanMasters,
      tone: orphanMasters ? "warning" : "info",
    },
    {
      label: "Rows trimmed (preview cap)",
      value: oversizedRows,
      tone: oversizedRows ? "warning" : "info",
    },
    {
      label: "Columns trimmed (preview cap)",
      value: oversizedColumns,
      tone: oversizedColumns ? "warning" : "info",
    },
  ];

  return (
    <div className="rounded-md border bg-background/55 p-3 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-medium text-foreground">
            Reconstruction diagnostics — {sheet.name}
          </div>
          <div className="mt-0.5 text-muted-foreground">
            Counts measured during AG Grid reconstruction. Warnings indicate
            workbook geometry the portal could not visually reproduce.
          </div>
        </div>
        <Button
          aria-pressed={showRegionOverlay}
          onClick={onToggleRegionOverlay}
          type="button"
          variant={showRegionOverlay ? "default" : "outline"}
        >
          {showRegionOverlay ? "Hide region overlay" : "Show region overlay"}
        </Button>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {stats_entries.map((entry) => (
          <div
            className={cn(
              "rounded-md border bg-card/60 px-2 py-1.5",
              entry.tone === "warning" &&
                "border-amber-300/40 bg-amber-100/30 text-amber-900 dark:border-amber-400/30 dark:bg-amber-900/20 dark:text-amber-200",
            )}
            key={entry.label}
          >
            <div className="text-[11px] uppercase tracking-wide opacity-80">{entry.label}</div>
            <div className="mt-0.5 text-base font-semibold tabular-nums">{entry.value}</div>
          </div>
        ))}
      </div>

      {sheetDiagnostics?.orphan_merged_masters && sheetDiagnostics.orphan_merged_masters.length > 0 && (
        <div className="mt-3 border-t pt-2">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Orphan merged masters (master row hidden, covered rows visible)
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {sheetDiagnostics.orphan_merged_masters.slice(0, 12).map((orphan) => (
              <span
                className="rounded-sm border bg-background/70 px-1.5 py-1 font-mono text-[11px] text-foreground"
                key={`${orphan.range}-${orphan.master_address}`}
                title={`Master ${orphan.master_address}; rescued into ${orphan.first_visible_address}`}
              >
                {orphan.range} → {orphan.first_visible_address}
              </span>
            ))}
            {sheetDiagnostics.orphan_merged_masters.length > 12 && (
              <span className="text-[11px] text-muted-foreground">
                +{sheetDiagnostics.orphan_merged_masters.length - 12} more
              </span>
            )}
          </div>
        </div>
      )}

      {sheetWarnings.length > 0 && (
        <div className="mt-3 border-t pt-2">
          <div className="text-[11px] font-medium uppercase tracking-wide text-amber-700 dark:text-amber-300">
            Sheet warnings
          </div>
          <ul className="mt-1.5 grid gap-1">
            {sheetWarnings.map((warning, index) => (
              <li
                className="rounded-sm border border-amber-300/40 bg-amber-100/30 px-2 py-1 text-amber-900 dark:border-amber-400/30 dark:bg-amber-900/20 dark:text-amber-200"
                key={`${warning.code}-${index}`}
              >
                <span className="font-mono text-[10px]">{warning.code}</span> · {warning.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {workbookWarnings.length > 0 && (
        <div className="mt-3 border-t pt-2">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Other sheets
          </div>
          <ul className="mt-1.5 grid gap-1">
            {workbookWarnings.map((warning, index) => (
              <li
                className="rounded-sm border bg-background/70 px-2 py-1 text-muted-foreground"
                key={`${warning.sheet}-${warning.code}-${index}`}
              >
                <span className="font-medium text-foreground">{warning.sheet}</span> ·{" "}
                <span className="font-mono text-[10px]">{warning.code}</span> · {warning.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {workbookDiagnostics?.debug_logging_enabled && (
        <div className="mt-3 border-t pt-2 text-[11px] text-muted-foreground">
          Verbose reconstruction logging is enabled on the server
          (<code>WORKBOOK_DEBUG_RECONSTRUCTION</code>). See backend logs for per-cell traces.
        </div>
      )}
    </div>
  );
}

export function WorkbookUploadPanel() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<WorkbookUploadResponse | null>(null);
  const [selectedSheetName, setSelectedSheetName] = useState("");
  const [workbookEdits, setWorkbookEdits] = useState<Record<string, WorkbookSheetEditMap>>({});
  const workbookEditsRef = useRef(workbookEdits);
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [showRegionOverlay, setShowRegionOverlay] = useState(false);

  const selectedSheet = useMemo(
    () =>
      result?.metadata.sheets.find((sheet) => sheet.name === selectedSheetName) ??
      result?.metadata.sheets[0] ??
      null,
    [result, selectedSheetName],
  );

  useEffect(() => {
    if (result?.metadata.sheets[0] && !selectedSheetName) {
      setSelectedSheetName(result.metadata.sheets[0].name);
    }
  }, [result, selectedSheetName]);

  useEffect(() => {
    workbookEditsRef.current = workbookEdits;
  }, [workbookEdits]);

  const degradedSheetNames = useMemo(() => {
    if (!result?.metadata?.sheets) {
      return [] as string[];
    }
    const explicit = Array.isArray(result.metadata.degraded_sheets)
      ? result.metadata.degraded_sheets
      : [];
    const detected = result.metadata.sheets
      .filter((sheet) => isSheetDegraded(sheet))
      .map((sheet) => sheet.name);
    return Array.from(new Set([...explicit, ...detected]));
  }, [result]);

  const isSelectedSheetDegraded = isSheetDegraded(selectedSheet);

  const previewRows = useMemo(
    () => result?.metadata.sheets.map(sheetToPreviewRow) ?? [],
    [result],
  );

  const selectedRegionCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const region of selectedSheet?.regions ?? []) {
      counts.set(region.kind, (counts.get(region.kind) ?? 0) + 1);
    }
    return Array.from(counts.entries()).sort(([left], [right]) => left.localeCompare(right));
  }, [selectedSheet]);

  const visibleMergedRanges = useMemo(
    () => (selectedSheet?.structure?.merged_cells ?? []).slice(0, 8),
    [selectedSheet],
  );

  const sheetGridResult = useMemo(
    () =>
      selectedSheet
        ? buildSheetGridRows(selectedSheet, workbookEdits[selectedSheet.name] ?? {})
        : { rows: [] as WorkbookGridRow[], stats: null as WorkbookSheetReconstructionStats | null },
    [selectedSheet, workbookEdits],
  );
  const sheetRows = sheetGridResult.rows;
  const sheetStats = sheetGridResult.stats;

  const frozenRows = useMemo(() => frozenRowCount(selectedSheet), [selectedSheet]);

  const sheetPinnedTopRows = useMemo(
    () => sheetRows.filter((row) => row.__rowNumber <= frozenRows),
    [frozenRows, sheetRows],
  );

  const sheetBodyRows = useMemo(
    () => sheetRows.filter((row) => row.__rowNumber > frozenRows),
    [frozenRows, sheetRows],
  );

  const summaryColumnDefs = useMemo<ColDef<WorkbookPreviewRow>[]>(
    () => [
      { field: "sheet", headerName: "Sheet", minWidth: 210, pinned: "left" },
      { field: "dimension", headerName: "Range", minWidth: 120 },
      { field: "rows", headerName: "Rows", minWidth: 90, type: "rightAligned" },
      { field: "columns", headerName: "Cols", minWidth: 90, type: "rightAligned" },
      { field: "cells", headerName: "Cells", minWidth: 100, type: "rightAligned" },
      { field: "formulas", headerName: "Formulas", minWidth: 110, type: "rightAligned" },
      { field: "merged", headerName: "Merged", minWidth: 110, type: "rightAligned" },
      { field: "hidden", headerName: "Hidden", minWidth: 140 },
      { field: "freeze", headerName: "Freeze", minWidth: 120 },
      { field: "regions", headerName: "Regions", minWidth: 110, type: "rightAligned" },
    ],
    [],
  );

  const sheetColumnDefs = useMemo<ColDef<WorkbookGridRow>[]>(() => {
    if (!selectedSheet) {
      return [];
    }

    const syncColumns = safeSyncColumns(selectedSheet);
    const safeColumnWidths =
      selectedSheet.structure && typeof selectedSheet.structure === "object"
        ? selectedSheet.structure.column_widths ?? {}
        : {};
    const defaultColumnWidth =
      selectedSheet.structure && typeof selectedSheet.structure === "object"
        ? selectedSheet.structure.default_column_width
        : null;
    const pinnedWorkbookColumns = new Set(
      syncColumns
        .filter((column) => column.frozen && !column.hidden)
        .slice(0, 8)
        .map((column) => column.workbook_column),
    );
    const columns: ColDef<WorkbookGridRow>[] = [
      {
        field: "__rowNumber",
        headerName: "",
        pinned: "left",
        width: 58,
        minWidth: 58,
        editable: false,
        sortable: false,
        cellClass: "workbook-row-header-cell",
      },
    ];

    for (const syncColumn of syncColumns.slice(0, maxSheetPreviewColumns)) {
      if (syncColumn.hidden) {
        continue;
      }
      const name = syncColumn.workbook_column_name || columnName(syncColumn.workbook_column);
      const field = syncColumn.grid_field;
      const width = workbookColumnWidth(syncColumn.width ?? safeColumnWidths[name], defaultColumnWidth);
      columns.push({
        field,
        headerName: name,
        width,
        minWidth: Math.min(width, 72),
        pinned: pinnedWorkbookColumns.has(syncColumn.workbook_column) ? "left" : undefined,
        sortable: false,
        editable: (params) => Boolean(params.data?.__editableFields?.[field]),
        colSpan: (params) => params.data?.__mergeSpans?.[field]?.columns ?? 1,
        valueFormatter: (params) => formatWorkbookCellValue(params.value),
        cellClass: (params) => {
          const classes = ["workbook-cell"];
          const kind = params.data?.__cellRegionKinds?.[field];
          const readonlyReason = params.data?.__readonlyReasons?.[field];
          if (kind) {
            classes.push(`workbook-cell-${kind}`);
          }
          if (params.data?.__editableFields?.[field]) {
            classes.push("workbook-cell-editable");
          }
          if (readonlyReason) {
            classes.push("workbook-cell-readonly");
            classes.push(`workbook-cell-readonly-${readonlyReason}`);
          }
          if (params.data?.__formulaFields?.[field]) {
            classes.push("workbook-cell-formula");
          }
          if (params.data?.__mergeCovered?.[field]) {
            classes.push("workbook-cell-merge-covered");
          }
          if (params.data?.__mergeSpans?.[field]) {
            classes.push("workbook-cell-merge-master");
          }
          return classes;
        },
        cellStyle: (params) => {
          const style = params.data?.__styles?.[field] ?? {};
          if (params.data?.__editableFields?.[field]) {
            return {
              ...style,
              cursor: "cell",
            };
          }
          return style;
        },
      });
    }

    return columns;
  }, [selectedSheet]);

  async function handleFile(file: File | undefined) {
    if (!file) {
      return;
    }

    setError(null);
    setExportError(null);
    setExportStatus(null);
    setResult(null);
    setSelectedSheetName("");
    setWorkbookEdits({});
    setProgress(4);
    setIsUploading(true);
    try {
      const response = await uploadWorkbook(file, setProgress);
      setResult(response);
      setSelectedSheetName(response.metadata.sheets[0]?.name ?? "");
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Workbook upload failed.");
    } finally {
      setIsUploading(false);
    }
  }

  const handleWorkbookCellEdit = useCallback(
    (event: CellEditRequestEvent<WorkbookGridRow>) => {
      const field = event.colDef.field;
      const sheetName = selectedSheet?.name;
      if (!field || !event.data || !sheetName || !event.data.__editableFields?.[field]) {
        return;
      }

      const address = event.data.__addresses?.[field];
      if (!address || event.oldValue === event.newValue) {
        return;
      }

      event.data[field] = event.newValue;
      event.api.refreshCells({ columns: [field], force: true, rowNodes: [event.node] });
      setWorkbookEdits((current) => ({
        ...current,
        [sheetName]: {
          ...current[sheetName],
          [address]: event.newValue as WorkbookEditValue,
        },
      }));
      setExportStatus(null);
      setExportError(null);
    },
    [selectedSheet?.name],
  );

  const editedSheetCount = useMemo(
    () => Object.values(workbookEdits).filter((entries) => Object.keys(entries).length > 0).length,
    [workbookEdits],
  );
  const totalEditCount = useMemo(
    () =>
      Object.values(workbookEdits).reduce(
        (count, entries) => count + Object.keys(entries).length,
        0,
      ),
    [workbookEdits],
  );

  const handleExport = useCallback(async () => {
    if (!result) {
      return;
    }
    setIsExporting(true);
    setExportError(null);
    setExportStatus(null);
    try {
      const payload: WorkbookExportPayload = {
        sheet_edits: Object.fromEntries(
          Object.entries(workbookEditsRef.current).filter(
            ([, entries]) => entries && Object.keys(entries).length > 0,
          ),
        ),
      };
      const { blob, filename, summary } = await exportWorkbook(
        result.uploaded_file_id,
        payload,
      );
      triggerWorkbookDownload(blob, filename);
      setExportStatus(
        summary
          ? `Exported "${filename}" (${summary}).`
          : `Exported "${filename}".`,
      );
    } catch (downloadError) {
      setExportError(
        downloadError instanceof Error ? downloadError.message : "Workbook export failed.",
      );
    } finally {
      setIsExporting(false);
    }
  }, [result]);

  return (
    <section className="overflow-hidden rounded-md border bg-card/70 shadow-sm backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-md border bg-background/70 text-muted-foreground">
            <FileSpreadsheet className="size-4" />
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold">Workbook ingestion</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Upload XLSX files for structural mapping into the reporting grid.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {result && (
            <>
              <Button
                aria-label={
                  showDiagnostics
                    ? "Hide reconstruction diagnostics"
                    : "Show reconstruction diagnostics"
                }
                onClick={() => setShowDiagnostics((prev) => !prev)}
                title="Toggle workbook reconstruction diagnostics"
                type="button"
                variant={showDiagnostics ? "default" : "outline"}
              >
                <Bug className="size-4" />
                Debug
              </Button>
              <Button
                aria-label="Export edited workbook as XLSX"
                disabled={isExporting || isUploading}
                onClick={() => {
                  void handleExport();
                }}
                title={
                  totalEditCount > 0
                    ? `Export with ${totalEditCount} edit${totalEditCount === 1 ? "" : "s"} across ${editedSheetCount} sheet${editedSheetCount === 1 ? "" : "s"}.`
                    : "Export the original workbook unchanged."
                }
                type="button"
                variant="default"
              >
                {isExporting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Download className="size-4" />
                )}
                Export XLSX
              </Button>
              <Button
                onClick={() => {
                  setResult(null);
                  setWorkbookEdits({});
                  setExportError(null);
                  setExportStatus(null);
                  setShowDiagnostics(false);
                  setShowRegionOverlay(false);
                }}
                type="button"
                variant="outline"
              >
                <X className="size-4" />
                Clear
              </Button>
            </>
          )}
          <Button
            disabled={isUploading}
            onClick={() => fileInputRef.current?.click()}
            type="button"
            variant="outline"
          >
            {isUploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
            Upload XLSX
          </Button>
        </div>
      </div>

      <input
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="hidden"
        onChange={(event) => {
          void handleFile(event.target.files?.[0]);
          event.target.value = "";
        }}
        ref={fileInputRef}
        type="file"
      />

      <div className="grid gap-3 p-4">
        <button
          className={cn(
            "group relative flex min-h-24 w-full items-center justify-center overflow-hidden rounded-md border border-dashed bg-background/45 px-4 text-center transition duration-300",
            isDragging && "border-primary bg-primary/10",
            isUploading && "cursor-wait opacity-80",
          )}
          disabled={isUploading}
          onClick={() => fileInputRef.current?.click()}
          onDragLeave={() => setIsDragging(false)}
          onDragOver={(event) => {
            event.preventDefault();
            setIsDragging(true);
          }}
          onDrop={(event) => {
            event.preventDefault();
            setIsDragging(false);
            void handleFile(event.dataTransfer.files?.[0]);
          }}
          type="button"
        >
          <span className="grid gap-1">
            <span className="text-sm font-medium">Drop an XLSX workbook here</span>
            <span className="text-xs text-muted-foreground">
              Structure, formulas, styles, dimensions, and workbook regions will be extracted.
            </span>
          </span>
          <motion.span
            animate={{ opacity: isDragging ? 0.18 : 0 }}
            className="absolute inset-0 bg-primary"
            transition={{ duration: 0.2 }}
          />
        </button>

        <AnimatePresence>
          {(isUploading || progress > 0) && !result && (
            <motion.div
              animate={{ opacity: 1, y: 0 }}
              className="h-1.5 overflow-hidden rounded-full bg-muted"
              exit={{ opacity: 0, y: -4 }}
              initial={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2 }}
            >
              <motion.div
                animate={{ width: `${Math.max(progress, isUploading ? 8 : 0)}%` }}
                className="h-full rounded-full bg-primary"
                transition={{ duration: 0.25 }}
              />
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {error && (
            <motion.div
              animate={{ opacity: 1, y: 0 }}
              className="rounded-md border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              exit={{ opacity: 0, y: -4 }}
              initial={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2 }}
            >
              {error}
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {exportError && (
            <motion.div
              animate={{ opacity: 1, y: 0 }}
              className="rounded-md border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              exit={{ opacity: 0, y: -4 }}
              initial={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2 }}
            >
              {exportError}
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {exportStatus && !exportError && (
            <motion.div
              animate={{ opacity: 1, y: 0 }}
              className="rounded-md border border-primary/25 bg-primary/10 px-3 py-2 text-sm text-foreground"
              exit={{ opacity: 0, y: -4 }}
              initial={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2 }}
            >
              {exportStatus}
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {result && selectedSheet && (
            <motion.div
              animate={{ opacity: 1, y: 0 }}
              className="grid gap-3"
              exit={{ opacity: 0, y: -6 }}
              initial={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.22 }}
            >
              {degradedSheetNames.length > 0 && (
                <div
                  className="rounded-md border border-amber-300/40 bg-amber-100/30 px-3 py-2 text-xs text-amber-900 dark:border-amber-400/30 dark:bg-amber-900/20 dark:text-amber-200"
                  role="status"
                >
                  <div className="font-medium">
                    Some sheets were imported with limited sync metadata.
                  </div>
                  <div className="mt-0.5 opacity-80">
                    Affected: {degradedSheetNames.join(", ")}. The workbook is still usable,
                    but cell mapping for these sheets may be incomplete.
                  </div>
                </div>
              )}
              <div className="grid gap-2 text-sm sm:grid-cols-4">
                <div className="rounded-md border bg-background/55 px-3 py-2">
                  <div className="text-xs text-muted-foreground">Workbook</div>
                  <div className="mt-1 truncate font-medium">{result.original_filename}</div>
                </div>
                <div className="rounded-md border bg-background/55 px-3 py-2">
                  <div className="text-xs text-muted-foreground">Sheets</div>
                  <div className="mt-1 font-medium">{result.metadata.sheet_count}</div>
                </div>
                <div className="rounded-md border bg-background/55 px-3 py-2">
                  <div className="text-xs text-muted-foreground">Size</div>
                  <div className="mt-1 font-medium">{formatBytes(result.file_size_bytes)}</div>
                </div>
                <div className="rounded-md border bg-background/55 px-3 py-2">
                  <div className="text-xs text-muted-foreground">Pending edits</div>
                  <div className="mt-1 font-medium">
                    {totalEditCount > 0
                      ? `${totalEditCount} cell${totalEditCount === 1 ? "" : "s"} / ${editedSheetCount} sheet${editedSheetCount === 1 ? "" : "s"}`
                      : "None"}
                  </div>
                </div>
              </div>

              <div className="grid gap-2 md:grid-cols-[18rem_minmax(0,1fr)]">
                <div className="rounded-md border bg-background/45 p-2">
                  <label className="grid gap-1 text-xs font-medium text-muted-foreground">
                    Sheet
                    <select
                      className="h-9 rounded-md border bg-background/80 px-2 text-sm text-foreground outline-none transition focus:ring-2 focus:ring-ring"
                      onChange={(event) => setSelectedSheetName(event.target.value)}
                      value={selectedSheetName}
                    >
                      {result.metadata.sheets.map((sheet) => (
                        <option key={sheet.name} value={sheet.name}>
                          {sheet.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div className="mt-3 grid gap-2 text-xs text-muted-foreground">
                    <div className="flex justify-between gap-2">
                      <span>Dimension</span>
                      <span className="text-foreground">{selectedSheet.dimension ?? "—"}</span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span>Merged</span>
                      <span className="text-foreground">
                        {(selectedSheet.structure?.merged_cells ?? []).length}
                      </span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span>Row groups</span>
                      <span className="text-foreground">
                        {Object.keys(selectedSheet.structure?.row_groups ?? {}).length}
                      </span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span>Column groups</span>
                      <span className="text-foreground">
                        {Object.keys(selectedSheet.structure?.column_groups ?? {}).length}
                      </span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span>Freeze panes</span>
                      <span className="text-foreground">
                        {selectedSheet.structure?.freeze_panes ?? "None"}
                      </span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span>Mapped cells</span>
                      <span className="text-foreground">
                        {selectedSheet.sync?.cells?.length ?? 0}
                      </span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span>Default row</span>
                      <span className="text-foreground">
                        {selectedSheet.structure?.default_row_height
                          ? `${selectedSheet.structure.default_row_height} pt`
                          : "Excel default"}
                      </span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span>Default col</span>
                      <span className="text-foreground">
                        {selectedSheet.structure?.default_column_width
                          ? selectedSheet.structure.default_column_width
                          : "Excel default"}
                      </span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span>Layout ID</span>
                      <span className="max-w-28 truncate text-foreground">
                        {selectedSheet.sync?.layout_fingerprint ?? "—"}
                      </span>
                    </div>
                  </div>

                  {selectedRegionCounts.length > 0 && (
                    <div className="mt-3 border-t pt-3">
                      <div className="text-xs font-medium text-muted-foreground">Regions</div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {selectedRegionCounts.map(([kind, count]) => (
                          <span
                            className="rounded-sm border bg-background/70 px-1.5 py-1 text-[11px] text-foreground"
                            key={kind}
                          >
                            {regionLabel(kind)}: {count}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {visibleMergedRanges.length > 0 && (
                    <div className="mt-3 border-t pt-3">
                      <div className="text-xs font-medium text-muted-foreground">
                        Merged ranges
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {visibleMergedRanges.map((range) => (
                          <span
                            className="rounded-sm border bg-background/70 px-1.5 py-1 font-mono text-[11px] text-foreground"
                            key={range}
                          >
                            {range}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div className="ag-theme-quartz h-48 w-full">
                  <AgGridReact<WorkbookPreviewRow>
                    columnDefs={summaryColumnDefs}
                    defaultColDef={{
                      lockVisible: true,
                      minWidth: 100,
                      resizable: true,
                      sortable: true,
                      suppressHeaderMenuButton: true,
                    }}
                    getRowId={(params) => params.data.id}
                    rowData={previewRows}
                    theme="legacy"
                  />
                </div>
              </div>

              {showDiagnostics && (
                <ReconstructionDiagnosticsPanel
                  sheet={selectedSheet}
                  stats={sheetStats}
                  workbookDiagnostics={result.metadata.reconstruction_diagnostics ?? null}
                  showRegionOverlay={showRegionOverlay}
                  onToggleRegionOverlay={() => setShowRegionOverlay((prev) => !prev)}
                />
              )}

              <div
                className={cn(
                  "ag-theme-quartz workbook-reconstruction-grid relative h-[32rem] w-full",
                  showRegionOverlay && "workbook-reconstruction-debug-overlay",
                )}
              >
                {isSelectedSheetDegraded && sheetRows.length === 0 ? (
                  <div className="flex h-full flex-col items-center justify-center rounded-md border border-dashed bg-background/40 px-6 text-center">
                    <p className="text-sm font-medium text-foreground">
                      Preview unavailable for this sheet
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Workbook sync metadata is missing or incomplete. The file is still saved
                      and other sheets continue to work normally.
                    </p>
                  </div>
                ) : (
                  <AgGridReact<WorkbookGridRow>
                    columnDefs={sheetColumnDefs}
                    defaultColDef={{
                      lockVisible: true,
                      minWidth: 72,
                      resizable: true,
                      sortable: false,
                      suppressHeaderMenuButton: true,
                    }}
                    getRowHeight={(params) =>
                      workbookRowHeight(
                        params.data?.__height,
                        selectedSheet.structure?.default_row_height ?? null,
                      )
                    }
                    getRowId={(params) => params.data.id}
                    getRowStyle={(params) => {
                      if (params.data?.__regionKind === "summary_band") {
                        const style: RowStyle = {
                          background: "color-mix(in oklch, var(--accent) 38%, transparent)",
                          fontWeight: "700",
                        };
                        return style;
                      }
                      if (
                        params.data?.__regionKind === "readonly_band" ||
                        params.data?.__regionKind === "formula_row"
                      ) {
                        const style: RowStyle = {
                          background: "color-mix(in oklch, var(--muted) 36%, transparent)",
                        };
                        return style;
                      }
                      if (
                        params.data?.__regionKind === "grouped_section" ||
                        params.data?.__regionKind === "section_header"
                      ) {
                        const style: RowStyle = {
                          background: "color-mix(in oklch, var(--primary) 10%, transparent)",
                          fontWeight: "700",
                        };
                        return style;
                      }
                      if (params.data?.__regionKind === "footer_region") {
                        const style: RowStyle = {
                          background: "color-mix(in oklch, var(--secondary) 70%, transparent)",
                        };
                        return style;
                      }
                      if (params.data?.__regionKind === "worksheet_separator") {
                        const style: RowStyle = {
                          background: "color-mix(in oklch, var(--border) 36%, transparent)",
                        };
                        return style;
                      }
                      if (params.data?.__regionRole === "editable") {
                        const style: RowStyle = {
                          background: "color-mix(in oklch, var(--background) 92%, var(--primary) 8%)",
                        };
                        return style;
                      }
                      return undefined;
                    }}
                    gridOptions={{
                      animateRows: false,
                      enterNavigatesVertically: true,
                      enterNavigatesVerticallyAfterEdit: true,
                      readOnlyEdit: true,
                      suppressColumnVirtualisation: false,
                      suppressScrollOnNewData: true,
                      columnHoverHighlight: true,
                      rowBuffer: 20,
                    }}
                    onCellEditRequest={handleWorkbookCellEdit}
                    pinnedTopRowData={sheetPinnedTopRows}
                    rowData={sheetBodyRows}
                    theme="legacy"
                  />
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </section>
  );
}
