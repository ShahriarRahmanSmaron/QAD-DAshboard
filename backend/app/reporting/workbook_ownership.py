"""Workbook-structure-aware ownership resolution (MD07-2A).

This module converts workbook semantics from row-based / nearest-text inference
into *structure-aware* ownership resolution. For every numeric (or formula)
cell it answers: which unit, which buyer, which metric, and which section owns
this value — using only the workbook's own structure:

* merged-range inheritance (vertical unit blocks, merged section banners)
* header relationships (the column header names the metric / the dimension)
* positional context (a value column is owned by the nearest entity column to
  its left; the grouping column to the left is the unit dimension)

Nothing here is specific to any particular workbook. There are **no hardcoded
buyer names, unit names, section names, metric names, or workbook labels**.
Column roles are derived from the data-type distribution of each column, the
grouping/merge geometry, and the header row position. The engine therefore
adapts to any tabular operational workbook, not just the WF Test & Shade
format that motivated it.

The output ``CellOwnership`` carries the resolved dimensions *and* the
provenance (which structural source produced each dimension) plus a confidence
band, so the semantic layer and diagnostics can explain every mapping.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from typing import Any

from app.reporting.workbook_normalization import (
    CONFIDENCE_AMBIGUOUS,
    CONFIDENCE_EXPLICIT,
    CONFIDENCE_INFERRED,
    CONFIDENCE_UNMAPPED,
    collapse_whitespace,
    derive_metric_key,
    derive_metric_label,
    header_names_buyer,
    header_names_unit,
    is_rollup_label,
    normalize_buyer,
    normalize_section_label,
    normalize_token,
    normalize_unit_label,
    slugify,
)

JsonObject = dict[str, Any]
CellKey = tuple[int, int]

# ---------------------------------------------------------------------------
# Ownership source tags (provenance for each resolved dimension)
# ---------------------------------------------------------------------------

SOURCE_MERGED_INHERITANCE = "merged_inheritance"
SOURCE_GROUPING_BLOCK = "grouping_block"
SOURCE_COLUMN_HEADER = "column_header"
SOURCE_DIRECT_LABEL = "direct_label"
SOURCE_POSITIONAL = "positional"
SOURCE_INFERRED_FALLBACK = "inferred_fallback"
SOURCE_NONE = "none"
SOURCE_NOT_APPLICABLE = "not_applicable"

# Column role classifications.
ROLE_VALUE = "value"
ROLE_LABEL = "label"
ROLE_GROUPING = "grouping"
ROLE_EMPTY = "empty"

_NUMBER_RE = re.compile(r"^-?\d+(?:,\d{3})*(?:\.\d+)?$")
_DATE_TEXT_RE = re.compile(
    r"\b\d{1,2}[-/. ](?:[A-Za-z]{3,9}|\d{1,2})[-/. ]\d{2,4}\b"
)


# ---------------------------------------------------------------------------
# Value classification helpers
# ---------------------------------------------------------------------------


def _parse_decimal(text: str) -> Decimal | None:
    cleaned = text.replace(",", "").strip()
    if not _NUMBER_RE.match(cleaned):
        return None
    try:
        return Decimal(cleaned)
    except InvalidOperation:
        return None


def _looks_like_date(text: str) -> bool:
    stripped = text.strip()
    if len(stripped) == 10 and stripped[4:5] == "-" and stripped[7:8] == "-":
        return True
    return bool(_DATE_TEXT_RE.search(stripped))


def classify_value(value: Any, formula: str | None) -> str:
    """Classify a cell's *intent* for column-role detection.

    Formula cells are treated as numeric — they hold computed numbers even when
    the cached value is absent (the parser stores ``value=None`` for formulas).
    """
    if formula:
        return "numeric"
    if value is None:
        return "blank"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, int | float | Decimal):
        return "numeric"
    if isinstance(value, datetime | date):
        return "date"
    text = str(value).strip()
    if not text:
        return "blank"
    if _parse_decimal(text) is not None:
        return "numeric"
    if _looks_like_date(text):
        return "date"
    return "text"


def _is_rollup_label(value: str) -> bool:
    return is_rollup_label(value)


# ---------------------------------------------------------------------------
# Resolved structures
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ColumnRole:
    column: int
    header_label: str | None
    header_key: str | None
    role: str
    numeric_count: int
    text_count: int
    date_count: int
    distinct_values: int
    non_empty: int
    vertical_merge: bool
    header_is_buyer: bool = False
    header_is_unit: bool = False


@dataclass(frozen=True)
class TableModel:
    sheet_name: str
    section_key: str
    section_label: str
    section_source: str
    title_row: int | None
    header_row: int
    start_row: int
    end_row: int
    start_column: int
    end_column: int
    columns: dict[int, ColumnRole]
    value_columns: tuple[int, ...]
    label_columns: tuple[int, ...]
    grouping_columns: tuple[int, ...]
    buyer_column_for: dict[int, int | None]
    unit_column_for: dict[int, int | None]
    unit_values: frozenset[str]
    grouping_fill: dict[int, dict[int, str]]
    date_column: int | None


@dataclass(frozen=True)
class CellOwnership:
    unit: str | None
    buyer: str | None
    metric_key: str
    metric_label: str
    section_key: str
    section_label: str
    unit_source: str
    buyer_source: str
    metric_source: str
    section_source: str
    is_rollup: bool
    confidence_overall: str
    confidence_unit: str
    confidence_buyer: str
    confidence_metric: str
    confidence_section: str
    reasons: tuple[str, ...]
    table_header_row: int
    table_range: str
    metric_column: int
    buyer_column: int | None
    unit_column: int | None
    date_column: int | None
    row_date_text: str | None


@dataclass
class SheetOwnership:
    sheet_name: str
    tables: list[TableModel] = field(default_factory=list)
    unit_values: set[str] = field(default_factory=set)
    buyer_values: set[str] = field(default_factory=set)
    metric_labels: dict[str, str] = field(default_factory=dict)
    section_labels: dict[str, str] = field(default_factory=dict)
    _ownership_cache: dict[CellKey, CellOwnership | None] = field(default_factory=dict)
    _resolver: Any = None

    def ownership_for(self, row: int, column: int) -> CellOwnership | None:
        if (row, column) in self._ownership_cache:
            return self._ownership_cache[(row, column)]
        result = self._resolver(row, column) if self._resolver else None
        self._ownership_cache[(row, column)] = result
        return result


# ---------------------------------------------------------------------------
# The resolver
# ---------------------------------------------------------------------------


class _OwnershipResolver:
    """Builds the structural ownership model for a single sheet."""

    def __init__(self, sheet: JsonObject) -> None:
        self.sheet = sheet
        self.sheet_name = str(sheet.get("name") or "")
        self.max_row = int(sheet.get("max_row") or 0)
        self.max_column = int(sheet.get("max_column") or 0)
        self.cells: dict[CellKey, JsonObject] = {}
        for raw in sheet.get("cells", []):
            if not isinstance(raw, dict):
                continue
            r = raw.get("row")
            c = raw.get("column")
            if isinstance(r, int) and isinstance(c, int):
                self.cells[(r, c)] = raw

        self.merged_owner: dict[CellKey, CellKey] = {}
        self.vertical_merge_columns: set[int] = set()
        self.banner_rows: list[tuple[int, str]] = []
        self._build_merged_maps(sheet)

        self.used_columns = self._used_columns()
        self.tables: list[TableModel] = self._build_tables()

    # -- merged geometry ---------------------------------------------------

    def _build_merged_maps(self, sheet: JsonObject) -> None:
        regions = [r for r in sheet.get("regions", []) if isinstance(r, dict)]
        for region in regions:
            if region.get("kind") != "merged_cell_region":
                continue
            sr = int(region.get("start_row") or 0)
            er = int(region.get("end_row") or 0)
            sc = int(region.get("start_column") or 0)
            ec = int(region.get("end_column") or 0)
            if sr <= 0 or sc <= 0:
                continue
            for r in range(sr, er + 1):
                for c in range(sc, ec + 1):
                    if (r, c) != (sr, sc):
                        self.merged_owner[(r, c)] = (sr, sc)
            row_span = er - sr + 1
            col_span = ec - sc + 1
            master_text = self._own_text(sr, sc)
            # Vertical, single-column merge spanning multiple rows → a grouping
            # (unit-like) block established by merged-region inheritance.
            if col_span == 1 and row_span > 1:
                self.vertical_merge_columns.add(sc)
            # Wide horizontal merge with text → a section banner / title.
            used = max(self.max_column, 1)
            if col_span >= max(3, used * 0.4) and master_text:
                self.banner_rows.append((sr, master_text))
        self.banner_rows.sort()

    # -- low-level cell access --------------------------------------------

    def _own_value(self, row: int, column: int) -> Any:
        entry = self.cells.get((row, column))
        return entry.get("value") if entry else None

    def _own_formula(self, row: int, column: int) -> str | None:
        entry = self.cells.get((row, column))
        if not entry:
            return None
        formula = entry.get("formula")
        return formula if isinstance(formula, str) else None

    def _own_text(self, row: int, column: int) -> str:
        value = self._own_value(row, column)
        if value is None:
            return ""
        if isinstance(value, datetime):
            return value.date().isoformat()
        if isinstance(value, date):
            return value.isoformat()
        return str(value).strip()

    def effective_value(self, row: int, column: int) -> Any:
        value = self._own_value(row, column)
        if value is not None and str(value).strip() != "":
            return value
        owner = self.merged_owner.get((row, column))
        if owner is not None:
            return self._own_value(*owner)
        return value

    def effective_text(self, row: int, column: int) -> str:
        value = self.effective_value(row, column)
        if value is None:
            return ""
        if isinstance(value, datetime):
            return value.date().isoformat()
        if isinstance(value, date):
            return value.isoformat()
        return str(value).strip()

    def effective_kind(self, row: int, column: int) -> str:
        value = self.effective_value(row, column)
        formula = self._own_formula(row, column)
        return classify_value(value, formula)

    def _grouping_fill(self, column: int, start_row: int, end_row: int) -> dict[int, str]:
        """Propagate a grouping column's labels across a data region.

        A grouping (unit) label governs ownership until the next label — the
        merged-section propagation rule generalised to non-merged blocks. Rows
        below a label inherit it; rows above the first label inherit that first
        label (same block, before any boundary). This recovers unit ownership
        when a workbook writes the block label only once instead of on every
        row or as a vertical merge.
        """
        filled: dict[int, str] = {}
        current = ""
        for row in range(start_row, end_row + 1):
            text = self.effective_text(row, column)
            if text and not is_rollup_label(text):
                current = text
            if current:
                filled[row] = current
        first_value = ""
        for row in range(start_row, end_row + 1):
            text = self.effective_text(row, column)
            if text and not is_rollup_label(text):
                first_value = text
                break
        if first_value:
            for row in range(start_row, end_row + 1):
                filled.setdefault(row, first_value)
        return filled

    # -- layout detection --------------------------------------------------

    def _used_columns(self) -> int:
        used = 0
        for (_row, col), entry in self.cells.items():
            if entry.get("value") is not None or entry.get("formula"):
                used = max(used, col)
        return min(max(used, self.max_column), self.max_column or used)

    def _row_signature(self, row: int) -> tuple[int, int, int]:
        """Return (text, numeric, date) counts of *own* values in a row."""
        text = numeric = dates = 0
        for col in range(1, self.used_columns + 1):
            formula = self._own_formula(row, col)
            value = self._own_value(row, col)
            kind = classify_value(value, formula)
            if kind == "text":
                text += 1
            elif kind in {"numeric", "boolean"}:
                numeric += 1
            elif kind == "date":
                dates += 1
        return text, numeric, dates

    def _is_caption_row(self, row: int) -> bool:
        """A caption-like row: multiple text cells, no numeric/boolean data.

        This is only a *candidate*; a genuine table header additionally names
        at least one column that holds numeric data below it (see
        :meth:`_build_tables`). That distinction prevents an all-text *data*
        row in an empty block from being mistaken for a header.
        """
        text, numeric, dates = self._row_signature(row)
        return text >= 2 and numeric == 0 and dates <= 1

    def _caption_columns(self, row: int) -> set[int]:
        cols: set[int] = set()
        for col in range(1, self.used_columns + 1):
            if classify_value(self._own_value(row, col), self._own_formula(row, col)) == "text":
                cols.add(col)
        return cols

    def _numeric_columns_between(self, start_row: int, end_row: int) -> set[int]:
        cols: set[int] = set()
        for r in range(start_row, end_row + 1):
            for col in range(1, self.used_columns + 1):
                kind = classify_value(self._own_value(r, col), self._own_formula(r, col))
                if kind in {"numeric", "boolean"}:
                    cols.add(col)
        return cols

    def _banner_for_header(self, header_row: int, header_rows: list[int]) -> tuple[int | None, str]:
        """Find the governing section banner for ``header_row``.

        Per merged-section semantics, a banner propagates ownership downward
        until the *next banner* (the next section boundary) — not merely until
        the next header row. So a header that has no banner of its own inherits
        the most recent descriptive banner above it. Pure-date banners are
        skipped in favour of a descriptive title.
        """
        for brow, btext in sorted(self.banner_rows, key=lambda item: item[0], reverse=True):
            if brow >= header_row:
                continue
            if _looks_like_date(btext) and not _strip_date(btext):
                continue
            return brow, btext
        return None, ""

    def _build_tables(self) -> list[TableModel]:
        if self.max_row <= 0 or self.used_columns <= 0:
            return []

        caption_rows = [r for r in range(1, self.max_row + 1) if self._is_caption_row(r)]
        if not caption_rows:
            return []

        banner_set = {brow for brow, _ in self.banner_rows}

        # Determine which caption rows are *genuine* table headers: a header
        # names at least one column that holds numeric data in the rows beneath
        # it (before the next caption row). This rejects all-text data rows in
        # empty blocks, which caption nothing that has numbers below.
        header_rows: list[int] = []
        for index, caption in enumerate(caption_rows):
            body_end = (
                caption_rows[index + 1] - 1
                if index + 1 < len(caption_rows)
                else self.max_row
            )
            if body_end < caption + 1:
                continue
            numeric_below = self._numeric_columns_between(caption + 1, body_end)
            if self._caption_columns(caption) & numeric_below:
                header_rows.append(caption)

        if not header_rows:
            return []

        tables: list[TableModel] = []
        for index, header_row in enumerate(header_rows):
            next_header = (
                header_rows[index + 1] if index + 1 < len(header_rows) else self.max_row + 1
            )
            end_row = next_header - 1
            # A banner that starts a *new* block ends the current data region.
            for brow in sorted(banner_set):
                if header_row < brow < next_header:
                    end_row = brow - 1
                    break
            start_row = header_row + 1
            if start_row > end_row:
                continue
            title_row, title_text = self._banner_for_header(header_row, header_rows)
            table = self._build_table(
                header_row=header_row,
                start_row=start_row,
                end_row=end_row,
                title_row=title_row,
                title_text=title_text,
                table_index=index,
            )
            if table is not None:
                tables.append(table)
        return tables

    def _build_table(
        self,
        *,
        header_row: int,
        start_row: int,
        end_row: int,
        title_row: int | None,
        title_text: str,
        table_index: int,
    ) -> TableModel | None:
        data_rows = list(range(start_row, end_row + 1))
        columns: dict[int, ColumnRole] = {}
        for col in range(1, self.used_columns + 1):
            columns[col] = self._classify_column(col, header_row, data_rows)

        value_columns = tuple(c for c, role in columns.items() if role.role == ROLE_VALUE)
        if not value_columns:
            return None
        label_columns = tuple(
            c for c, role in columns.items() if role.role in {ROLE_LABEL, ROLE_GROUPING}
        )
        grouping_columns = tuple(
            c for c, role in columns.items() if role.role == ROLE_GROUPING
        )

        # For each value column, resolve its governing buyer/unit columns.
        # Header relationships win: if the table has columns explicitly
        # captioned as the buyer or unit dimension, every value column is
        # governed by the nearest such column to its left (or the sole one).
        # Otherwise we fall back to positional adjacency: the nearest entity
        # label column to the left is the buyer, the nearest grouping column is
        # the unit.
        header_buyer_cols = [c for c, role in columns.items() if role.header_is_buyer]
        header_unit_cols = [
            c for c, role in columns.items() if role.header_is_unit and role.role == ROLE_GROUPING
        ]
        buyer_column_for: dict[int, int | None] = {}
        unit_column_for: dict[int, int | None] = {}
        for vc in value_columns:
            buyer_col = _nearest_left(header_buyer_cols, vc)
            if buyer_col is None and not header_buyer_cols:
                buyer_col = _nearest_left(
                    [c for c in label_columns if columns[c].role == ROLE_LABEL], vc
                )
            unit_col = _nearest_left(header_unit_cols, vc)
            if unit_col is None and header_unit_cols:
                # A captioned unit column governs the whole table even when it
                # sits to the right of a value column (single grouping
                # dimension), so fall back to the nearest one on either side.
                unit_col = _nearest_any(header_unit_cols, vc)
            elif unit_col is None:
                unit_col = _nearest_left(list(grouping_columns), vc)
            buyer_column_for[vc] = buyer_col
            unit_column_for[vc] = unit_col

        # Collect the unit value set (for unit-as-buyer validation).
        unit_values: set[str] = set()
        for gc in grouping_columns:
            for r in data_rows:
                normalized = normalize_unit_label(self.effective_text(r, gc))
                if normalized:
                    unit_values.add(normalized)

        # Propagate grouping (unit) labels across the block so rows that omit
        # the label still inherit ownership (merged-section propagation rule).
        grouping_fill: dict[int, dict[int, str]] = {}
        for gc in {col for col in unit_column_for.values() if col is not None}:
            grouping_fill[gc] = self._grouping_fill(gc, start_row, end_row)

        # Detect a per-row date column: a column dominated by date-typed values.
        date_column: int | None = None
        best_date_count = 0
        for col, role in columns.items():
            if role.date_count > role.numeric_count and role.date_count > role.text_count:
                if role.date_count > best_date_count:
                    best_date_count = role.date_count
                    date_column = col

        section_label, section_key, section_source = self._resolve_section(
            title_text=title_text,
            header_row=header_row,
            table_index=table_index,
        )

        return TableModel(
            sheet_name=self.sheet_name,
            section_key=section_key,
            section_label=section_label,
            section_source=section_source,
            title_row=title_row,
            header_row=header_row,
            start_row=start_row,
            end_row=end_row,
            start_column=min(columns),
            end_column=max(columns),
            columns=columns,
            value_columns=value_columns,
            label_columns=label_columns,
            grouping_columns=grouping_columns,
            buyer_column_for=buyer_column_for,
            unit_column_for=unit_column_for,
            unit_values=frozenset(unit_values),
            grouping_fill=grouping_fill,
            date_column=date_column,
        )

    def _resolve_section(
        self,
        *,
        title_text: str,
        header_row: int,
        table_index: int,
    ) -> tuple[str, str, str]:
        cleaned = normalize_section_label(_strip_date(title_text) or title_text)
        if cleaned:
            key = slugify(cleaned) or f"section_{header_row}"
            return cleaned, key[:120], SOURCE_MERGED_INHERITANCE
        # Positional fallback — derived purely from structure (table order).
        label = f"Table {table_index + 1}"
        return label, f"table_{table_index + 1}", SOURCE_POSITIONAL

    def _classify_column(
        self,
        column: int,
        header_row: int,
        data_rows: list[int],
    ) -> ColumnRole:
        numeric = text = dates = 0
        seen: list[str] = []
        non_empty = 0
        adjacency_dupes = 0
        previous: str | None = None
        for r in data_rows:
            kind = self.effective_kind(r, column)
            if kind == "blank":
                previous = None
                continue
            non_empty += 1
            if kind == "text":
                text += 1
            elif kind in {"numeric", "boolean"}:
                numeric += 1
            elif kind == "date":
                dates += 1
            normalized = normalize_token(self.effective_text(r, column))
            seen.append(normalized)
            if previous is not None and normalized == previous and normalized:
                adjacency_dupes += 1
            previous = normalized

        header_label = self.effective_text(header_row, column) or None
        header_key = slugify(header_label) if header_label else None
        distinct = len(set(seen))
        header_is_buyer = header_names_buyer(header_label)
        header_is_unit = header_names_unit(header_label)

        role = ROLE_EMPTY
        if non_empty > 0:
            # Header relationships are authoritative for a column's dimension
            # role: a column captioned "Buyer" is an entity (label) column; one
            # captioned "Unit"/"Factory"/etc. is a grouping column — regardless
            # of how its values happen to repeat.
            if header_is_unit and text > 0:
                role = ROLE_GROUPING
            elif header_is_buyer and text > 0:
                role = ROLE_LABEL
            elif numeric >= text and numeric > 0:
                role = ROLE_VALUE
            elif text > 0:
                # A grouping (unit-like) column establishes ownership over a run
                # of rows. We detect it structurally, never by value content:
                #   * it participates in vertical merges, OR
                #   * its values form contiguous repeated runs (block layout).
                # A per-row entity column (buyer) changes value almost every
                # row, so it has few/zero adjacency duplicates even when some
                # values recur across blocks.
                vertical_merge = column in self.vertical_merge_columns
                run_based = adjacency_dupes >= max(2, non_empty // 4)
                role = ROLE_GROUPING if (vertical_merge or run_based) else ROLE_LABEL

        return ColumnRole(
            column=column,
            header_label=header_label,
            header_key=header_key,
            role=role,
            numeric_count=numeric,
            text_count=text,
            date_count=dates,
            distinct_values=distinct,
            non_empty=non_empty,
            vertical_merge=column in self.vertical_merge_columns,
            header_is_buyer=header_is_buyer,
            header_is_unit=header_is_unit,
        )

    # -- ownership resolution ---------------------------------------------

    def _inherited_header(self, header_row: int, column: int) -> str | None:
        """Return a merged header label that spans ``column`` at the header row.

        When a value column has no own header text, a horizontally-merged
        header cell covering it still names the metric (merged-region
        inheritance applied to the header row).
        """
        owner = self.merged_owner.get((header_row, column))
        if owner is None:
            return None
        text = self._own_text(*owner)
        return text or None

    def _table_for(self, row: int, column: int) -> TableModel | None:
        for table in self.tables:
            if (
                table.start_row <= row <= table.end_row
                and table.start_column <= column <= table.end_column
            ):
                return table
        return None

    def resolve(self, row: int, column: int) -> CellOwnership | None:
        table = self._table_for(row, column)
        if table is None:
            return None
        column_role = table.columns.get(column)
        if column_role is None or column_role.role != ROLE_VALUE:
            return None

        formula = self._own_formula(row, column)
        reasons: list[str] = []

        # Metric — from the column's own header, else an inherited merged
        # header that spans the column (header relationship + merged
        # inheritance), else positional fallback.
        header_label = column_role.header_label
        metric_source = SOURCE_COLUMN_HEADER
        if not header_label:
            inherited_header = self._inherited_header(table.header_row, column)
            if inherited_header:
                header_label = inherited_header
                metric_source = SOURCE_MERGED_INHERITANCE
        if header_label:
            metric_label = derive_metric_label(header_label)
            metric_key = derive_metric_key(header_label) or f"column_{column}"
            metric_conf = (
                CONFIDENCE_EXPLICIT
                if metric_source == SOURCE_COLUMN_HEADER
                else CONFIDENCE_INFERRED
            )
            if metric_source != SOURCE_COLUMN_HEADER:
                reasons.append("metric_from_merged_header")
        else:
            metric_label = f"Column {column}"
            metric_key = f"column_{column}"
            metric_source = SOURCE_POSITIONAL
            metric_conf = CONFIDENCE_INFERRED
            reasons.append("metric_missing_header")

        # Unit — from the nearest grouping column via merged/grouping inheritance.
        unit_col = table.unit_column_for.get(column)
        unit: str | None = None
        unit_source = SOURCE_NOT_APPLICABLE
        unit_conf = CONFIDENCE_EXPLICIT
        unit_missing = False
        if unit_col is not None:
            raw_unit = self.effective_text(row, unit_col)
            unit = normalize_unit_label(raw_unit)
            inherited_label = False
            if unit is None:
                # Inherit the governing block label via grouping propagation.
                filled = table.grouping_fill.get(unit_col, {})
                fill_text = filled.get(row, "")
                unit = normalize_unit_label(fill_text)
                inherited_label = unit is not None
            if unit is not None:
                inherited = self.merged_owner.get((row, unit_col)) is not None
                vertical = unit_col in self.vertical_merge_columns
                unit_source = (
                    SOURCE_MERGED_INHERITANCE
                    if inherited or vertical or inherited_label
                    else SOURCE_GROUPING_BLOCK
                )
                unit_conf = CONFIDENCE_EXPLICIT
            else:
                unit_source = SOURCE_NONE
                unit_missing = True
        elif table.grouping_columns:
            unit_source = SOURCE_NONE
            unit_missing = True

        # Buyer — from the nearest entity (non-grouping) label column.
        buyer_col = table.buyer_column_for.get(column)
        buyer: str | None = None
        buyer_source = SOURCE_NOT_APPLICABLE
        buyer_conf = CONFIDENCE_EXPLICIT
        is_rollup = False
        if buyer_col is not None:
            raw_buyer = self.effective_text(row, buyer_col)
            if raw_buyer and _is_rollup_label(raw_buyer):
                # The governing label literally marks an aggregate (e.g. a
                # "Total" / "Previous Day" row): a structural rollup.
                buyer = None
                buyer_source = SOURCE_NOT_APPLICABLE
                buyer_conf = CONFIDENCE_EXPLICIT
                is_rollup = True
                reasons.append("rollup_row")
            else:
                candidate = normalize_buyer(raw_buyer)
                if candidate is None:
                    # No entity in the governing column → this is a structural
                    # rollup / subtotal row (e.g. a unit total), not a missing
                    # buyer.
                    buyer = None
                    buyer_source = SOURCE_NOT_APPLICABLE
                    buyer_conf = CONFIDENCE_EXPLICIT
                    is_rollup = True
                    reasons.append("rollup_row")
                elif _matches_unit(candidate, table.unit_values):
                    # Validation: reject a unit value masquerading as a buyer.
                    buyer = None
                    buyer_source = SOURCE_NONE
                    buyer_conf = CONFIDENCE_AMBIGUOUS
                    reasons.append("buyer_equals_unit")
                else:
                    buyer = candidate
                    buyer_source = SOURCE_COLUMN_HEADER
                    buyer_conf = CONFIDENCE_EXPLICIT
        else:
            # No entity column to the left → the value belongs to the unit
            # dimension only (e.g. a stock column governed by the unit block).
            buyer_source = SOURCE_NOT_APPLICABLE

        # A grouping/unit label that is itself a rollup marker also signals an
        # aggregate row even when no buyer column governs the value.
        if unit_col is not None:
            raw_unit_text = self.effective_text(row, unit_col)
            if raw_unit_text and _is_rollup_label(raw_unit_text):
                is_rollup = True
                if "rollup_row" not in reasons:
                    reasons.append("rollup_row")

        if formula:
            is_rollup = True
            if "rollup_row" not in reasons and "calculated_rollup" not in reasons:
                reasons.append("calculated_rollup")

        # A missing unit only counts against trust when the row is a genuine
        # leaf (an entity row). On rollup/aggregate rows the grouping cell is
        # legitimately blank, so we treat the unit as not-applicable instead of
        # unmapped — aggregates must not drag the trust ratio down.
        if unit_missing:
            if is_rollup:
                unit_source = SOURCE_NOT_APPLICABLE
                unit_conf = CONFIDENCE_EXPLICIT
            else:
                unit_conf = CONFIDENCE_UNMAPPED
                if "unit_unmapped" not in reasons:
                    reasons.append("unit_unmapped")

        overall = _aggregate_confidence(
            [
                unit_conf if unit_source != SOURCE_NOT_APPLICABLE else CONFIDENCE_EXPLICIT,
                buyer_conf if buyer_source != SOURCE_NOT_APPLICABLE else CONFIDENCE_EXPLICIT,
                metric_conf,
                CONFIDENCE_EXPLICIT
                if table.section_source != SOURCE_POSITIONAL
                else CONFIDENCE_INFERRED,
            ]
        )

        # Report date — from a per-row date column when the table has one
        # (column-aware date ownership), so each row carries its own date.
        row_date_text: str | None = None
        date_col = table.date_column
        if date_col is not None and date_col != column:
            candidate = self.effective_text(row, date_col)
            if candidate:
                row_date_text = candidate

        return CellOwnership(
            unit=unit,
            buyer=buyer,
            metric_key=metric_key,
            metric_label=metric_label,
            section_key=table.section_key,
            section_label=table.section_label,
            unit_source=unit_source,
            buyer_source=buyer_source,
            metric_source=metric_source,
            section_source=table.section_source,
            is_rollup=is_rollup,
            confidence_overall=overall,
            confidence_unit=unit_conf,
            confidence_buyer=buyer_conf,
            confidence_metric=metric_conf,
            confidence_section=(
                CONFIDENCE_EXPLICIT
                if table.section_source != SOURCE_POSITIONAL
                else CONFIDENCE_INFERRED
            ),
            reasons=tuple(reasons),
            table_header_row=table.header_row,
            table_range=f"{table.start_row}:{table.end_row}",
            metric_column=column,
            buyer_column=buyer_col,
            unit_column=unit_col,
            date_column=date_col,
            row_date_text=row_date_text,
        )


# ---------------------------------------------------------------------------
# Module-level helpers
# ---------------------------------------------------------------------------


def _nearest_left(columns: list[int], target: int) -> int | None:
    """Return the closest column strictly left of ``target`` from ``columns``."""
    candidates = [c for c in columns if c < target]
    return max(candidates) if candidates else None


def _nearest_any(columns: list[int], target: int) -> int | None:
    """Return the column closest to ``target`` (either side)."""
    if not columns:
        return None
    return min(columns, key=lambda c: (abs(c - target), c))


def _strip_date(text: str) -> str:
    """Remove an embedded date phrase (and date-label prefix) from a banner."""
    if not text:
        return ""
    without_date = _DATE_TEXT_RE.sub(" ", text)
    without_date = re.sub(r"(?i)\breport\s+date\b\s*:?", " ", without_date)
    return collapse_whitespace(without_date).strip(" :-")


def _matches_unit(buyer: str, unit_values: frozenset[str]) -> bool:
    token = normalize_token(buyer)
    for unit in unit_values:
        if normalize_token(unit) == token:
            return True
    return False


def _aggregate_confidence(parts: list[str]) -> str:
    seen = set(parts)
    if CONFIDENCE_AMBIGUOUS in seen or CONFIDENCE_UNMAPPED in seen:
        return CONFIDENCE_AMBIGUOUS
    if CONFIDENCE_INFERRED in seen:
        return CONFIDENCE_INFERRED
    return CONFIDENCE_EXPLICIT


def build_sheet_ownership(sheet: JsonObject) -> SheetOwnership:
    """Build the structural ownership model for a single worksheet."""
    resolver = _OwnershipResolver(sheet)
    ownership = SheetOwnership(sheet_name=resolver.sheet_name, tables=resolver.tables)
    ownership._resolver = resolver.resolve  # noqa: SLF001 - intentional wiring

    for table in resolver.tables:
        ownership.section_labels[table.section_key] = table.section_label
        ownership.unit_values.update(table.unit_values)
        for vc in table.value_columns:
            role = table.columns[vc]
            if role.header_label:
                ownership.metric_labels[derive_metric_key(role.header_label) or f"column_{vc}"] = (
                    derive_metric_label(role.header_label)
                )
    return ownership
