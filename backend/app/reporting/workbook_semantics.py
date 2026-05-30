"""Workbook semantic extraction (MD07-2A: structure-aware ownership).

Numeric facts are mapped to (unit, buyer, metric, section, report date) using
the *workbook structure* — header relationships, merged-region inheritance, and
positional context — via :mod:`app.reporting.workbook_ownership`. There are no
hardcoded buyer/unit/section/metric names anywhere in this pipeline; every
dimension is derived from the workbook the cell lives in, so the engine is
reusable across future workbook formats.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.schemas import AuthUser
from app.reporting import repository
from app.reporting.models import OperationalFact, UploadedFile
from app.reporting.workbook_diagnostics import build_semantic_diagnostics
from app.reporting.workbook_normalization import (
    CONFIDENCE_EXPLICIT,
    CONFIDENCE_INFERRED,
    CONFIDENCE_UNMAPPED,
    MappingConfidence,
    normalize_report_date,
    slugify,
)
from app.reporting.workbook_ownership import (
    CellOwnership,
    SheetOwnership,
    build_sheet_ownership,
)

JsonObject = dict[str, Any]
CellKey = tuple[int, int]
CoercedValue = tuple[str, Decimal | None, str | None, date | None, bool | None]


@dataclass(frozen=True)
class SemanticFact:
    source_key: str
    buyer: str | None
    unit: str | None
    report_date: date | None
    metric_key: str
    metric_label: str
    operational_section: str
    operational_section_label: str
    operational_row_key: str | None
    operational_row_label: str | None
    column_label: str | None
    value_type: str
    value_numeric: Decimal | None
    value_text: str | None
    value_date: date | None
    value_boolean: bool | None
    unit_of_measure: str | None
    is_formula: bool
    formula: str | None
    calculated_state: str
    source_sheet_name: str
    source_sheet_index: int | None
    source_cell_address: str
    source_row_number: int
    source_column_number: int
    source_region_id: str | None
    source_region_kind: str | None
    source_region_range: str | None
    workbook_sheet_identity: JsonObject
    workbook_source: JsonObject
    metadata: JsonObject


@dataclass(frozen=True)
class SemanticRegion:
    id: str
    sheet_name: str
    section: str
    section_label: str
    metric_key: str
    metric_label: str
    source_region_id: str | None
    source_region_kind: str | None
    range: str
    start_row: int
    end_row: int
    start_column: int
    end_column: int
    fact_count: int
    metadata: JsonObject


@dataclass(frozen=True)
class SemanticExtraction:
    facts: list[SemanticFact]
    regions: list[SemanticRegion]
    semantic_mapping: JsonObject


# ---------------------------------------------------------------------------
# Date / value parsing helpers (generic, no business vocabulary)
# ---------------------------------------------------------------------------

MONTH_ALIASES = {
    "jan": 1,
    "january": 1,
    "feb": 2,
    "february": 2,
    "mar": 3,
    "march": 3,
    "apr": 4,
    "april": 4,
    "may": 5,
    "jun": 6,
    "june": 6,
    "jul": 7,
    "july": 7,
    "aug": 8,
    "august": 8,
    "sep": 9,
    "sept": 9,
    "september": 9,
    "oct": 10,
    "october": 10,
    "nov": 11,
    "november": 11,
    "dec": 12,
    "december": 12,
}

DATE_TEXT_RE = re.compile(
    r"\b(?P<day>\d{1,2})[-/. ](?P<month>[A-Za-z]{3,9}|\d{1,2})[-/. ](?P<year>\d{2,4})\b"
)
NUMBER_RE = re.compile(r"^-?\d+(?:,\d{3})*(?:\.\d+)?$")


def _normal_text(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()


def _cell_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    return str(value).strip()


def _parse_decimal(value: str) -> Decimal | None:
    cleaned = value.replace(",", "").strip()
    if not NUMBER_RE.match(cleaned):
        return None
    try:
        return Decimal(cleaned)
    except InvalidOperation:
        return None


def _parse_date_text(value: str) -> date | None:
    stripped = value.strip()
    try:
        if len(stripped) == 10 and stripped[4] == "-" and stripped[7] == "-":
            return date.fromisoformat(stripped)
    except ValueError:
        pass

    match = DATE_TEXT_RE.search(stripped)
    if not match:
        return None
    day = int(match.group("day"))
    month_value = match.group("month").lower()
    month: int | None
    if month_value.isdigit():
        month = int(month_value)
    else:
        month = MONTH_ALIASES.get(month_value[:3]) or MONTH_ALIASES.get(month_value)
        if month is None:
            return None
    year = int(match.group("year"))
    if year < 100:
        year += 2000
    try:
        return date(year, month, day)
    except ValueError:
        return None


def _coerce_value(value: Any, formula: str | None) -> CoercedValue:
    if value is None:
        return ("blank", None, None, None, None)
    if isinstance(value, bool):
        return ("boolean", None, None, None, value)
    if isinstance(value, int | float | Decimal):
        return ("number", Decimal(str(value)), None, None, None)
    if isinstance(value, datetime):
        return ("date", None, None, value.date(), None)
    if isinstance(value, date):
        return ("date", None, None, value, None)

    text_value = str(value).strip()
    if not text_value:
        return ("blank", None, None, None, None)
    parsed_date = _parse_date_text(text_value)
    if parsed_date is not None:
        return ("date", None, None, parsed_date, None)
    parsed_decimal = _parse_decimal(text_value)
    if parsed_decimal is not None:
        return ("number", parsed_decimal, None, None, None)
    return ("text", None, text_value, None, None)


def _calculated_state(*, formula: str | None, value_type: str, is_rollup: bool) -> str:
    """Classify a fact's calculated nature from structure only.

    A formula cell is a ``formula``; a rollup (subtotal/aggregate) row is
    ``calculated``; blanks are ``blank``; everything else is ``static``. No
    section names are consulted, keeping this workbook-agnostic.
    """
    if formula:
        return "formula"
    if value_type == "blank":
        return "blank"
    if is_rollup:
        return "calculated"
    return "static"


def _json_number(value: Decimal | None) -> float | None:
    return float(value) if value is not None else None


def _fact_json(fact: SemanticFact) -> JsonObject:
    return {
        "source_key": fact.source_key,
        "buyer": fact.buyer,
        "unit": fact.unit,
        "report_date": fact.report_date.isoformat() if fact.report_date else None,
        "metric_key": fact.metric_key,
        "metric_label": fact.metric_label,
        "operational_section": fact.operational_section,
        "operational_section_label": fact.operational_section_label,
        "operational_row_key": fact.operational_row_key,
        "operational_row_label": fact.operational_row_label,
        "column_label": fact.column_label,
        "value_type": fact.value_type,
        "value_numeric": _json_number(fact.value_numeric),
        "value_text": fact.value_text,
        "value_date": fact.value_date.isoformat() if fact.value_date else None,
        "value_boolean": fact.value_boolean,
        "unit_of_measure": fact.unit_of_measure,
        "is_formula": fact.is_formula,
        "formula": fact.formula,
        "calculated_state": fact.calculated_state,
        "source_sheet_name": fact.source_sheet_name,
        "source_sheet_index": fact.source_sheet_index,
        "source_cell_address": fact.source_cell_address,
        "source_row_number": fact.source_row_number,
        "source_column_number": fact.source_column_number,
        "source_region_id": fact.source_region_id,
        "source_region_kind": fact.source_region_kind,
        "source_region_range": fact.source_region_range,
        "metadata": fact.metadata,
    }


def _region_json(region: SemanticRegion) -> JsonObject:
    return {
        "id": region.id,
        "sheet_name": region.sheet_name,
        "section": region.section,
        "section_label": region.section_label,
        "metric_key": region.metric_key,
        "metric_label": region.metric_label,
        "source_region_id": region.source_region_id,
        "source_region_kind": region.source_region_kind,
        "range": region.range,
        "start_row": region.start_row,
        "end_row": region.end_row,
        "start_column": region.start_column,
        "end_column": region.end_column,
        "fact_count": region.fact_count,
        "metadata": region.metadata,
    }


def _sheet_cell_map(sheet: JsonObject) -> dict[CellKey, JsonObject]:
    cells: dict[CellKey, JsonObject] = {}
    for raw_cell in sheet.get("cells", []):
        if not isinstance(raw_cell, dict):
            continue
        row = raw_cell.get("row")
        column = raw_cell.get("column")
        if not isinstance(row, int) or not isinstance(column, int):
            continue
        cells[(row, column)] = raw_cell
    return cells


def _extract_report_date(
    cells: dict[CellKey, JsonObject], filename: str
) -> tuple[date | None, str]:
    """Find a report date and its confidence band.

    Returns ``(date, confidence)`` where confidence is ``explicit`` when the
    date came from a labeled "date" caption (an in-workbook, authoritative
    source), ``inferred`` when it came from an unlabeled date cell or the
    filename, and ``unmapped`` when none was found. ``date`` is a structural
    caption, not a business value — the same detection works for any workbook.
    """
    labeled_candidates: list[date] = []
    all_candidates: list[date] = []
    for (row, column), cell in sorted(cells.items()):
        value = cell.get("value")
        text = _cell_text(value)
        parsed = _parse_date_text(text)
        if parsed is not None:
            all_candidates.append(parsed)

        if "date" not in _normal_text(text):
            continue
        # A date can be in the same merged caption ("Report Date: 21-MAY-2026")
        # or in a neighbouring cell.
        if parsed is not None:
            labeled_candidates.append(parsed)
        for offset in range(1, 5):
            neighbor = cells.get((row, column + offset))
            if not neighbor:
                continue
            neighbor_date = _parse_date_text(_cell_text(neighbor.get("value")))
            if neighbor_date is not None:
                labeled_candidates.append(neighbor_date)

    filename_date = _parse_date_text(filename)
    if filename_date is not None:
        all_candidates.append(filename_date)
    if labeled_candidates:
        return labeled_candidates[0], CONFIDENCE_EXPLICIT
    if all_candidates:
        return all_candidates[0], CONFIDENCE_INFERRED
    return None, CONFIDENCE_UNMAPPED


def _fact_should_be_recorded(value_type: str, formula: str | None) -> bool:
    if formula:
        return True
    return value_type in {"number", "boolean"}


# ---------------------------------------------------------------------------
# Structure-aware sheet extraction
# ---------------------------------------------------------------------------


def _region_index(sheet: JsonObject) -> list[JsonObject]:
    return [region for region in sheet.get("regions", []) if isinstance(region, dict)]


def _region_for_point(regions: list[JsonObject], *, row: int, column: int) -> JsonObject | None:
    match: JsonObject | None = None
    for region in regions:
        if region.get("kind") == "merged_cell_region":
            continue
        if (
            int(region.get("start_row") or 0) <= row <= int(region.get("end_row") or 0)
            and int(region.get("start_column") or 0)
            <= column
            <= int(region.get("end_column") or 0)
        ):
            # Prefer the most specific (smallest) region.
            if match is None or _region_area(region) < _region_area(match):
                match = region
    return match


def _region_area(region: JsonObject) -> int:
    rows = int(region.get("end_row") or 0) - int(region.get("start_row") or 0) + 1
    cols = int(region.get("end_column") or 0) - int(region.get("start_column") or 0) + 1
    return max(rows, 1) * max(cols, 1)


def _region_text(region: JsonObject | None, key: str) -> str | None:
    if region is None:
        return None
    value = region.get(key)
    return str(value) if value else None


def _extract_sheet_semantics(
    sheet: JsonObject,
    *,
    workbook_source: JsonObject,
    workbook_report_date: date | None,
    filename: str,
) -> tuple[list[SemanticFact], list[SemanticRegion]]:
    sheet_name = str(sheet.get("name") or "")
    sheet_index = sheet.get("index") if isinstance(sheet.get("index"), int) else None
    dimension = str(sheet.get("dimension") or "")
    cells = _sheet_cell_map(sheet)
    regions = _region_index(sheet)

    ownership: SheetOwnership = build_sheet_ownership(sheet)
    sheet_date, sheet_date_confidence = _extract_report_date(cells, filename)
    if sheet_date is None and workbook_report_date is not None:
        sheet_date = workbook_report_date
        sheet_date_confidence = CONFIDENCE_INFERRED

    facts: list[SemanticFact] = []
    # Track (section_key) -> aggregate region bounds + fact counts for regions.
    section_bounds: dict[str, dict[str, Any]] = {}

    for (row_number, column_number), cell in sorted(cells.items()):
        formula = cell.get("formula") if isinstance(cell.get("formula"), str) else None
        value = cell.get("value")
        value_type, value_numeric, value_text, value_date, value_boolean = _coerce_value(
            value,
            formula,
        )
        if not _fact_should_be_recorded(value_type, formula):
            continue

        own: CellOwnership | None = ownership.ownership_for(row_number, column_number)
        if own is None:
            # The cell is numeric but not inside a recognised value column of a
            # detected table. Skip it: it is structural noise (page numbers,
            # stray totals) rather than an operational fact. Diagnostics will
            # surface it as an orphan cell.
            continue

        address = str(cell.get("address") or "")
        source_region = _region_for_point(regions, row=row_number, column=column_number)
        source_region_id = _region_text(source_region, "id")
        source_region_kind = _region_text(source_region, "kind")
        source_region_range = _region_text(source_region, "range")

        report_date = normalize_report_date(sheet_date)
        date_confidence = sheet_date_confidence if report_date is not None else CONFIDENCE_UNMAPPED
        # Prefer a per-row date column (column-aware date ownership) when the
        # table exposes one — it is an explicit, in-workbook source.
        if own.row_date_text:
            row_date = _parse_date_text(own.row_date_text)
            if row_date is not None:
                report_date = normalize_report_date(row_date)
                date_confidence = CONFIDENCE_EXPLICIT

        calculated_state = _calculated_state(
            formula=formula,
            value_type=value_type,
            is_rollup=own.is_rollup,
        )

        # Confidence: ownership drives the overall band. The report date is a
        # secondary signal — a missing/inferred date can only *soften* an
        # otherwise-explicit fact to inferred, never make it ambiguous (which
        # is reserved for genuine ownership conflicts).
        overall_confidence = own.confidence_overall
        if overall_confidence == CONFIDENCE_EXPLICIT and date_confidence != CONFIDENCE_EXPLICIT:
            overall_confidence = CONFIDENCE_INFERRED
        reasons = list(own.reasons)
        if report_date is None:
            reasons.append("report_date_missing")

        mapping_confidence = MappingConfidence(
            overall=overall_confidence,
            buyer=own.confidence_buyer,
            unit=own.confidence_unit,
            metric=own.confidence_metric,
            section=own.confidence_section,
            report_date=date_confidence,
            reasons=tuple(reasons),
        )

        # ``operational_row_label`` is the in-workbook entity label for the
        # fact — the buyer when one governs the value, otherwise the unit.
        row_label = own.buyer or own.unit
        column_label = own.metric_label

        facts.append(
            SemanticFact(
                source_key=f"{sheet_name}!{address}:{own.metric_key}:{own.section_key}",
                buyer=own.buyer,
                unit=own.unit,
                report_date=report_date,
                metric_key=own.metric_key,
                metric_label=own.metric_label,
                operational_section=own.section_key,
                operational_section_label=own.section_label,
                operational_row_key=slugify(row_label),
                operational_row_label=row_label,
                column_label=column_label,
                value_type=value_type,
                value_numeric=value_numeric,
                value_text=value_text,
                value_date=value_date,
                value_boolean=value_boolean,
                unit_of_measure="pcs" if value_type == "number" else None,
                is_formula=formula is not None,
                formula=formula,
                calculated_state=calculated_state,
                source_sheet_name=sheet_name,
                source_sheet_index=sheet_index,
                source_cell_address=address,
                source_row_number=row_number,
                source_column_number=column_number,
                source_region_id=source_region_id,
                source_region_kind=source_region_kind,
                source_region_range=source_region_range,
                workbook_sheet_identity={
                    "sheet_name": sheet_name,
                    "sheet_index": sheet_index,
                    "dimension": dimension,
                },
                workbook_source=workbook_source,
                metadata={
                    "engine": "workbook_ownership_resolver",
                    "engine_version": 3,
                    "source_region_label": _region_text(source_region, "label"),
                    "sheet_dimension": dimension,
                    "mapping_confidence": mapping_confidence.to_json(),
                    "ownership": {
                        "unit_source": own.unit_source,
                        "buyer_source": own.buyer_source,
                        "metric_source": own.metric_source,
                        "section_source": own.section_source,
                        "is_rollup": own.is_rollup,
                        "table_header_row": own.table_header_row,
                        "table_range": own.table_range,
                        "metric_column": own.metric_column,
                        "buyer_column": own.buyer_column,
                        "unit_column": own.unit_column,
                    },
                    "traceability": {
                        "sheet_name": sheet_name,
                        "sheet_index": sheet_index,
                        "cell_address": address,
                        "row_number": row_number,
                        "column_number": column_number,
                        "region_id": source_region_id,
                        "region_range": source_region_range,
                        "table_range": own.table_range,
                    },
                    "normalization": {
                        "buyer_source": own.buyer_source,
                        "unit_source": own.unit_source,
                        "metric_source": own.metric_source,
                        "section_source": own.section_source,
                        "report_date_source": date_confidence,
                    },
                },
            )
        )

        bounds = section_bounds.setdefault(
            own.section_key,
            {
                "label": own.section_label,
                "metric_key": own.metric_key,
                "metric_label": own.metric_label,
                "start_row": row_number,
                "end_row": row_number,
                "start_column": column_number,
                "end_column": column_number,
                "fact_count": 0,
                "source_region_id": source_region_id,
                "source_region_kind": source_region_kind,
                "source_region_range": source_region_range,
            },
        )
        bounds["start_row"] = min(int(bounds["start_row"]), row_number)
        bounds["end_row"] = max(int(bounds["end_row"]), row_number)
        bounds["start_column"] = min(int(bounds["start_column"]), column_number)
        bounds["end_column"] = max(int(bounds["end_column"]), column_number)
        bounds["fact_count"] = int(bounds["fact_count"]) + 1

    semantic_regions: list[SemanticRegion] = []
    for section_key, bounds in section_bounds.items():
        start_row = int(bounds["start_row"])
        end_row = int(bounds["end_row"])
        semantic_regions.append(
            SemanticRegion(
                id=f"{sheet_name}:{section_key}:{start_row}:{end_row}",
                sheet_name=sheet_name,
                section=section_key,
                section_label=str(bounds["label"]),
                metric_key=str(bounds["metric_key"]),
                metric_label=str(bounds["metric_label"]),
                source_region_id=bounds["source_region_id"],
                source_region_kind=bounds["source_region_kind"],
                range=f"{start_row}:{end_row}",
                start_row=start_row,
                end_row=end_row,
                start_column=int(bounds["start_column"]),
                end_column=int(bounds["end_column"]),
                fact_count=int(bounds["fact_count"]),
                metadata={"source_region_range": bounds["source_region_range"]},
            )
        )

    return facts, semantic_regions


def _summary_rows(facts: list[SemanticFact]) -> list[JsonObject]:
    grouped: dict[tuple[str, str | None, str | None, str | None], JsonObject] = {}
    for fact in facts:
        key = (
            fact.metric_key,
            fact.buyer,
            fact.unit,
            fact.report_date.isoformat() if fact.report_date else None,
        )
        row = grouped.setdefault(
            key,
            {
                "metric_key": fact.metric_key,
                "metric_label": fact.metric_label,
                "operational_section": fact.operational_section,
                "buyer": fact.buyer,
                "unit": fact.unit,
                "report_date": fact.report_date.isoformat() if fact.report_date else None,
                "fact_count": 0,
                "numeric_total": 0.0,
                "formula_count": 0,
            },
        )
        row["fact_count"] = int(row["fact_count"]) + 1
        row["formula_count"] = int(row["formula_count"]) + (1 if fact.is_formula else 0)
        if fact.value_numeric is not None:
            row["numeric_total"] = float(row["numeric_total"]) + float(fact.value_numeric)
    return list(grouped.values())


def extract_workbook_semantics(
    workbook_metadata: JsonObject,
    *,
    uploaded_file_id: UUID | None = None,
) -> SemanticExtraction:
    filename = str(workbook_metadata.get("filename") or "")
    raw_workbook_source = workbook_metadata.get("workbook_source")
    workbook_source: JsonObject = (
        raw_workbook_source if isinstance(raw_workbook_source, dict) else {}
    )
    all_cells: dict[CellKey, JsonObject] = {}
    for sheet in workbook_metadata.get("sheets", []):
        if not isinstance(sheet, dict):
            continue
        for key, cell in _sheet_cell_map(sheet).items():
            all_cells.setdefault(key, cell)
    workbook_report_date, _workbook_date_confidence = _extract_report_date(all_cells, filename)

    facts: list[SemanticFact] = []
    regions: list[SemanticRegion] = []
    sheet_summaries: list[JsonObject] = []
    for sheet in workbook_metadata.get("sheets", []):
        if not isinstance(sheet, dict):
            continue
        sheet_facts, sheet_regions = _extract_sheet_semantics(
            sheet,
            workbook_source=workbook_source,
            workbook_report_date=workbook_report_date,
            filename=filename,
        )
        facts.extend(sheet_facts)
        regions.extend(sheet_regions)
        sheet_summaries.append(
            {
                "name": sheet.get("name"),
                "index": sheet.get("index"),
                "fact_count": len(sheet_facts),
                "semantic_region_count": len(sheet_regions),
                "sections": [
                    {
                        "section": region.section,
                        "section_label": region.section_label,
                        "fact_count": region.fact_count,
                        "range": region.range,
                    }
                    for region in sheet_regions
                ],
            }
        )

    semantic_mapping: JsonObject = {
        "version": 3,
        "engine": "workbook_ownership_resolver",
        "engine_version": 3,
        "uploaded_file_id": str(uploaded_file_id) if uploaded_file_id else None,
        "status": "mapped" if facts else "empty",
        "report_date": workbook_report_date.isoformat() if workbook_report_date else None,
        "fact_count": len(facts),
        "semantic_region_count": len(regions),
        "sheets": sheet_summaries,
        "regions": [_region_json(region) for region in regions],
        "facts": [_fact_json(fact) for fact in facts],
        "summary": {
            "rows": _summary_rows(facts),
            "by_metric": _summary_rows(facts),
        },
        "prepared_for": {
            "previous_day_carry_forward": True,
            "rolling_summaries": True,
            "historical_aggregation": True,
        },
    }
    extraction = SemanticExtraction(facts=facts, regions=regions, semantic_mapping=semantic_mapping)
    diagnostics = build_semantic_diagnostics(
        workbook_metadata=workbook_metadata,
        extraction=extraction,
    )
    semantic_mapping["diagnostics"] = diagnostics.to_json()
    semantic_mapping["confidence_counts"] = dict(diagnostics.confidence_counts)
    semantic_mapping["health"] = diagnostics.health
    return extraction


def build_operational_fact_models(
    extraction: SemanticExtraction,
    *,
    uploaded_file: UploadedFile,
    actor: AuthUser,
) -> list[OperationalFact]:
    models: list[OperationalFact] = []
    for fact in extraction.facts:
        models.append(
            OperationalFact(
                uploaded_file_id=uploaded_file.id,
                buyer=fact.buyer,
                unit=fact.unit,
                report_date=fact.report_date,
                metric_key=fact.metric_key,
                metric_label=fact.metric_label,
                operational_section=fact.operational_section,
                operational_section_label=fact.operational_section_label,
                operational_row_key=fact.operational_row_key,
                operational_row_label=fact.operational_row_label,
                column_label=fact.column_label,
                value_type=fact.value_type,
                value_numeric=fact.value_numeric,
                value_text=fact.value_text,
                value_date=fact.value_date,
                value_boolean=fact.value_boolean,
                unit_of_measure=fact.unit_of_measure,
                is_formula=fact.is_formula,
                formula=fact.formula,
                calculated_state=fact.calculated_state,
                source_sheet_name=fact.source_sheet_name,
                source_sheet_index=fact.source_sheet_index,
                source_cell_address=fact.source_cell_address,
                source_row_number=fact.source_row_number,
                source_column_number=fact.source_column_number,
                source_region_id=fact.source_region_id,
                source_region_kind=fact.source_region_kind,
                source_region_range=fact.source_region_range,
                workbook_sheet_identity=fact.workbook_sheet_identity,
                workbook_source=fact.workbook_source,
                metadata_=fact.metadata,
                created_by_user_id=actor.id,
                updated_by_user_id=actor.id,
            )
        )
    return models


async def persist_workbook_semantics(
    session: AsyncSession,
    *,
    uploaded_file: UploadedFile,
    actor: AuthUser,
    workbook_metadata: JsonObject,
) -> SemanticExtraction:
    extraction = extract_workbook_semantics(
        workbook_metadata,
        uploaded_file_id=uploaded_file.id,
    )
    facts = build_operational_fact_models(
        extraction,
        uploaded_file=uploaded_file,
        actor=actor,
    )
    await repository.replace_operational_facts(
        session,
        uploaded_file_id=uploaded_file.id,
        facts=facts,
    )
    uploaded_file.metadata_ = {
        **workbook_metadata,
        "semantic_mapping": extraction.semantic_mapping,
    }
    await session.flush()
    return extraction


def _cell_data_type(value: Any) -> str:
    if value is None:
        return "n"
    if isinstance(value, bool):
        return "b"
    if isinstance(value, int | float | Decimal):
        return "n"
    return "s"


def _patch_metadata_cell(
    sheet: JsonObject,
    *,
    address: str,
    value: Any,
) -> bool:
    cells = sheet.setdefault("cells", [])
    if not isinstance(cells, list):
        return False
    for cell in cells:
        if isinstance(cell, dict) and cell.get("address") == address:
            cell["value"] = value
            cell["formula"] = None
            cell["data_type"] = _cell_data_type(value)
            return True

    raw_sync = sheet.get("sync")
    sync: JsonObject = raw_sync if isinstance(raw_sync, dict) else {}
    raw_sync_cells = sync.get("cells")
    sync_cells = raw_sync_cells if isinstance(raw_sync_cells, list) else []
    for sync_cell in sync_cells:
        if not isinstance(sync_cell, dict) or sync_cell.get("address") != address:
            continue
        row = sync_cell.get("workbook_row")
        column = sync_cell.get("workbook_column")
        if not isinstance(row, int) or not isinstance(column, int):
            return False
        cells.append(
            {
                "address": address,
                "row": row,
                "column": column,
                "value": value,
                "formula": None,
                "data_type": _cell_data_type(value),
                "style": {},
            }
        )
        return True
    return False


async def sync_workbook_semantics_after_export(
    session: AsyncSession,
    *,
    uploaded_file: UploadedFile,
    actor: AuthUser,
    edits: dict[str, dict[str, Any]] | None,
    export_summary: JsonObject,
) -> SemanticExtraction | None:
    if not edits:
        return None

    patched_by_sheet: dict[str, set[str]] = {}
    raw_summary_sheets = export_summary.get("sheets")
    summary_sheets: JsonObject = raw_summary_sheets if isinstance(raw_summary_sheets, dict) else {}
    for sheet_name, sheet_summary in summary_sheets.items():
        if not isinstance(sheet_name, str) or not isinstance(sheet_summary, dict):
            continue
        raw_patched_cells = sheet_summary.get("patched_cells")
        patched_cell_values = raw_patched_cells if isinstance(raw_patched_cells, list) else []
        patched_cells = {
            str(address)
            for address in patched_cell_values
            if isinstance(address, str)
        }
        if patched_cells:
            patched_by_sheet[sheet_name] = patched_cells
    if not patched_by_sheet:
        return None

    metadata = dict(uploaded_file.metadata_ or {})
    patched_count = 0
    raw_sheets = metadata.get("sheets")
    metadata_sheets = raw_sheets if isinstance(raw_sheets, list) else []
    for sheet in metadata_sheets:
        if not isinstance(sheet, dict):
            continue
        metadata_sheet_name = sheet.get("name")
        if not isinstance(metadata_sheet_name, str) or metadata_sheet_name not in patched_by_sheet:
            continue
        sheet_edits = edits.get(metadata_sheet_name, {})
        for address in patched_by_sheet[metadata_sheet_name]:
            if address not in sheet_edits:
                continue
            if _patch_metadata_cell(sheet, address=address, value=sheet_edits[address]):
                patched_count += 1

    if patched_count == 0:
        return None

    metadata["semantic_sync"] = {
        "last_synced_export": {
            "applied_cells": patched_count,
            "applied_total": export_summary.get("applied_total", 0),
            "skipped_total": export_summary.get("skipped_total", 0),
        }
    }
    return await persist_workbook_semantics(
        session,
        uploaded_file=uploaded_file,
        actor=actor,
        workbook_metadata=metadata,
    )
