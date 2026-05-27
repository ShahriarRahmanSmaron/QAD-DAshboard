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

JsonObject = dict[str, Any]
CellKey = tuple[int, int]
CoercedValue = tuple[str, Decimal | None, str | None, date | None, bool | None]


@dataclass(frozen=True)
class SectionDefinition:
    key: str
    label: str
    aliases: tuple[str, ...]


@dataclass(frozen=True)
class SemanticSection:
    key: str
    label: str
    sheet_name: str
    start_row: int
    end_row: int
    start_column: int
    end_column: int
    source_region_id: str | None
    source_region_kind: str | None
    source_region_range: str | None


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


SECTION_DEFINITIONS: tuple[SectionDefinition, ...] = (
    SectionDefinition("closing_summary", "Closing Summary", ("closing summary",)),
    SectionDefinition("previous_day", "Previous Day", ("previous day", "prev day")),
    SectionDefinition("grand_total", "Grand Total", ("grand total",)),
    SectionDefinition(
        "buyer_wise_breakdown",
        "Buyer-wise breakdown",
        ("buyer wise", "buyer-wise", "buyerwise"),
    ),
    SectionDefinition(
        "unit_wise_totals",
        "Unit-wise totals",
        ("unit wise", "unit-wise", "unit totals", "unit total"),
    ),
    SectionDefinition(
        "wait_for_test",
        "Wait For Test",
        ("wait for test", "w f test", "wf test", "wft", "waiting for test"),
    ),
    SectionDefinition("wait_for_rfd", "Wait for RFD", ("wait for rfd", "rfd")),
    SectionDefinition("shade_test", "Shade/Test", ("shade test", "shade/test", "shade")),
    SectionDefinition("t_stock", "T/Stock", ("t stock", "t/stock", "stock")),
    SectionDefinition("hold", "Hold", ("hold", "holding")),
    SectionDefinition("unit", "Unit", ("unit",)),
)

OPERATIONAL_BLOCK_DEFINITION = SectionDefinition(
    "operational_block",
    "Operational Block",
    (),
)
SECTION_BY_KEY = {
    **{definition.key: definition for definition in SECTION_DEFINITIONS},
    OPERATIONAL_BLOCK_DEFINITION.key: OPERATIONAL_BLOCK_DEFINITION,
}

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
    r"\b(?P<day>\d{1,2})[-/ ](?P<month>[A-Za-z]{3,9}|\d{1,2})[-/ ](?P<year>\d{2,4})\b"
)
UNIT_RE = re.compile(r"\b(?P<prefix>[A-Z]{2,6})[\s-]?(?P<number>\d{1,3})\b", re.IGNORECASE)
NUMBER_RE = re.compile(r"^-?\d+(?:,\d{3})*(?:\.\d+)?$")


def _normal_text(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()


def _slug(value: str | None) -> str | None:
    if not value:
        return None
    normalized = _normal_text(value)
    return normalized.replace(" ", "_") or None


def _cell_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    return str(value).strip()


def _match_section(text: str) -> SectionDefinition | None:
    normalized = _normal_text(text)
    if not normalized:
        return None
    for definition in SECTION_DEFINITIONS:
        if any(alias in normalized for alias in definition.aliases):
            return definition
    return None


def _is_section_text(text: str) -> bool:
    return _match_section(text) is not None


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
    if formula:
        return ("text", None, text_value, None, None)
    return ("text", None, text_value, None, None)


def _calculated_state(
    *,
    formula: str | None,
    value_type: str,
    region_kind: str | None,
    section_key: str,
) -> str:
    if formula:
        return "formula"
    if value_type == "blank":
        return "blank"
    if region_kind in {"formula_row", "calculated_row", "summary_band"}:
        return "calculated"
    if section_key in {"closing_summary", "previous_day", "grand_total", "unit_wise_totals"}:
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


def _row_cells(cells: dict[CellKey, JsonObject], row_number: int) -> list[JsonObject]:
    return [
        cell
        for (row, _column), cell in sorted(cells.items(), key=lambda item: item[0])
        if row == row_number
    ]


def _row_texts(
    cells: dict[CellKey, JsonObject],
    row_number: int,
    *,
    before_column: int | None = None,
) -> list[str]:
    texts: list[str] = []
    for cell in _row_cells(cells, row_number):
        column = int(cell.get("column") or 0)
        if before_column is not None and column >= before_column:
            continue
        value = cell.get("value")
        if value is None:
            continue
        text = _cell_text(value)
        if text and _parse_decimal(text) is None and _parse_date_text(text) is None:
            texts.append(text)
    return texts


def _region_for_point(
    regions: list[JsonObject],
    *,
    row: int,
    column: int,
) -> JsonObject | None:
    for region in regions:
        if region.get("kind") == "merged_cell_region":
            continue
        if (
            int(region.get("start_row") or 0) <= row <= int(region.get("end_row") or 0)
            and int(region.get("start_column") or 0)
            <= column
            <= int(region.get("end_column") or 0)
        ):
            return region
    return None


def _region_text(region: JsonObject | None, key: str) -> str | None:
    if region is None:
        return None
    value = region.get(key)
    return str(value) if value else None


def _region_for_section(regions: list[JsonObject], section: SemanticSection) -> JsonObject | None:
    for region in regions:
        if region.get("kind") == "merged_cell_region":
            continue
        start_row = int(region.get("start_row") or 0)
        end_row = int(region.get("end_row") or 0)
        if start_row <= section.end_row and end_row >= section.start_row:
            return region
    return None


def _extract_report_date(cells: dict[CellKey, JsonObject], filename: str) -> date | None:
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
        return labeled_candidates[0]
    return all_candidates[0] if all_candidates else None


def _extract_labeled_text(cells: dict[CellKey, JsonObject], label: str) -> str | None:
    normalized_label = _normal_text(label)
    for (row, column), cell in sorted(cells.items()):
        text = _cell_text(cell.get("value"))
        if normalized_label not in _normal_text(text):
            continue
        for offset in range(1, 5):
            neighbor = cells.get((row, column + offset))
            if not neighbor:
                continue
            value = _cell_text(neighbor.get("value"))
            if value and not _is_section_text(value) and _parse_date_text(value) is None:
                return value
    return None


def _unit_from_text(text: str | None) -> str | None:
    if not text:
        return None
    match = UNIT_RE.search(text.upper())
    if not match:
        return None
    return f"{match.group('prefix').upper()}-{int(match.group('number')):02d}"


def _clean_dimension(value: str | None) -> str | None:
    if not value:
        return None
    cleaned = re.sub(r"\s+", " ", value.strip(" :-"))
    return cleaned or None


def _probable_buyer_from_text(text: str | None) -> str | None:
    cleaned = _clean_dimension(text)
    if not cleaned or len(cleaned) > 48:
        return None
    normalized = _normal_text(cleaned)
    if not normalized or _match_section(cleaned):
        return None
    blocked = {
        "total",
        "grand total",
        "previous day",
        "date",
        "unit",
        "qty",
        "quantity",
        "remarks",
        "summary",
    }
    if normalized in blocked or "total" in normalized:
        return None
    if _unit_from_text(cleaned):
        return None
    return cleaned


def _column_label(
    cells: dict[CellKey, JsonObject],
    *,
    row_number: int,
    column_number: int,
    section_start_row: int,
) -> str | None:
    labels: list[str] = []
    first_row = max(section_start_row, row_number - 8, 1)
    for candidate_row in range(first_row, row_number):
        cell = cells.get((candidate_row, column_number))
        if not cell:
            continue
        text = _cell_text(cell.get("value"))
        if text and _parse_decimal(text) is None and _parse_date_text(text) is None:
            labels.append(text)
    return " / ".join(labels[-3:]) if labels else None


def _row_label(
    cells: dict[CellKey, JsonObject],
    *,
    row_number: int,
    column_number: int,
) -> str | None:
    texts = [
        text
        for text in _row_texts(cells, row_number, before_column=column_number)
        if not _is_section_text(text)
    ]
    if not texts:
        texts = [
            text for text in _row_texts(cells, row_number)[:4] if not _is_section_text(text)
        ]
    return _clean_dimension(" / ".join(texts[:4]))


def _metric_for_cell(
    section: SemanticSection,
    *,
    column_label: str | None,
    row_label: str | None,
) -> SectionDefinition:
    for text in (column_label, row_label):
        if not text:
            continue
        matched = _match_section(text)
        if matched is not None:
            return matched
    return SECTION_BY_KEY[section.key]


def _infer_buyer(
    *,
    section: SemanticSection,
    row_label: str | None,
    row_texts: list[str],
    global_buyer: str | None,
) -> str | None:
    if section.key == "buyer_wise_breakdown":
        buyer = _probable_buyer_from_text(row_label)
        if buyer:
            return buyer
    for text in row_texts:
        buyer = _probable_buyer_from_text(text)
        if buyer:
            return buyer
    return _clean_dimension(global_buyer)


def _infer_unit(
    *,
    section: SemanticSection,
    row_label: str | None,
    column_label: str | None,
    row_texts: list[str],
    global_unit: str | None,
) -> str | None:
    for text in (column_label, row_label, *row_texts):
        unit = _unit_from_text(text)
        if unit:
            return unit
    if section.key in {"unit_wise_totals", "unit"}:
        return _clean_dimension(row_label) or _clean_dimension(global_unit)
    return _clean_dimension(global_unit)


def _report_date_for_cell(
    *,
    workbook_report_date: date | None,
    column_label: str | None,
    row_label: str | None,
    value: Any,
) -> date | None:
    for candidate in (column_label, row_label, _cell_text(value)):
        if not candidate:
            continue
        parsed = _parse_date_text(candidate)
        if parsed is not None:
            return parsed
    return workbook_report_date


def _build_sections(sheet: JsonObject, cells: dict[CellKey, JsonObject]) -> list[SemanticSection]:
    max_row = int(sheet.get("max_row") or 0)
    max_column = int(sheet.get("max_column") or 0)
    row_sections: list[tuple[int, SectionDefinition]] = []

    for row_number in range(1, max_row + 1):
        texts = _row_texts(cells, row_number)
        joined = " ".join(texts)
        matched = _match_section(joined)
        first_text_match = _match_section(texts[0]) if texts else None
        if matched is not None and (len(texts) <= 2 or first_text_match == matched):
            row_sections.append((row_number, matched))

    regions = [region for region in sheet.get("regions", []) if isinstance(region, dict)]
    for region in regions:
        if region.get("kind") == "merged_cell_region":
            continue
        raw_metadata = region.get("metadata")
        metadata: JsonObject = raw_metadata if isinstance(raw_metadata, dict) else {}
        probe = " ".join(
            _cell_text(value)
            for value in (
                region.get("label"),
                region.get("kind"),
                metadata.get("merged_ranges"),
            )
        )
        matched = _match_section(probe)
        if matched is not None:
            start_row = int(region.get("start_row") or 1)
            row_sections.append((start_row, matched))

    deduped: dict[int, SectionDefinition] = {}
    for row_number, definition in row_sections:
        deduped.setdefault(row_number, definition)

    if not deduped and max_row > 0 and max_column > 0:
        deduped[1] = OPERATIONAL_BLOCK_DEFINITION

    ordered = sorted(deduped.items())
    sections: list[SemanticSection] = []
    for index, (start_row, definition) in enumerate(ordered):
        next_start = ordered[index + 1][0] if index + 1 < len(ordered) else max_row + 1
        sections.append(
            SemanticSection(
                key=definition.key,
                label=definition.label,
                sheet_name=str(sheet.get("name") or ""),
                start_row=start_row,
                end_row=max(start_row, next_start - 1),
                start_column=1,
                end_column=max_column,
                source_region_id=None,
                source_region_kind=None,
                source_region_range=None,
            )
        )
    return sections


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


def _fact_should_be_recorded(value_type: str, formula: str | None) -> bool:
    if formula:
        return True
    return value_type in {"number", "boolean"}


def _extract_sheet_semantics(
    sheet: JsonObject,
    *,
    workbook_source: JsonObject,
    workbook_report_date: date | None,
    filename: str,
) -> tuple[list[SemanticFact], list[SemanticRegion]]:
    sheet_name = str(sheet.get("name") or "")
    sheet_index = sheet.get("index") if isinstance(sheet.get("index"), int) else None
    max_column = int(sheet.get("max_column") or 0)
    dimension = str(sheet.get("dimension") or "")
    cells = _sheet_cell_map(sheet)
    regions = [region for region in sheet.get("regions", []) if isinstance(region, dict)]
    sections = _build_sections(sheet, cells)
    global_buyer = _extract_labeled_text(cells, "buyer")
    global_unit = _extract_labeled_text(cells, "unit")
    sheet_date = _extract_report_date(cells, filename) or workbook_report_date
    facts: list[SemanticFact] = []

    resolved_sections: list[SemanticSection] = []
    for section in sections:
        source_region = _region_for_section(regions, section)
        resolved_sections.append(
            SemanticSection(
                key=section.key,
                label=section.label,
                sheet_name=section.sheet_name,
                start_row=section.start_row,
                end_row=section.end_row,
                start_column=section.start_column,
                end_column=section.end_column,
                source_region_id=_region_text(source_region, "id"),
                source_region_kind=_region_text(source_region, "kind"),
                source_region_range=_region_text(source_region, "range"),
            )
        )

    for section in resolved_sections:
        for row_number in range(section.start_row + 1, section.end_row + 1):
            for column_number in range(section.start_column, max_column + 1):
                cell = cells.get((row_number, column_number))
                if not cell:
                    continue

                formula = cell.get("formula") if isinstance(cell.get("formula"), str) else None
                value = cell.get("value")
                value_type, value_numeric, value_text, value_date, value_boolean = _coerce_value(
                    value,
                    formula,
                )
                if not _fact_should_be_recorded(value_type, formula):
                    continue

                row_text_values = _row_texts(cells, row_number)
                row_label = _row_label(
                    cells,
                    row_number=row_number,
                    column_number=column_number,
                )
                col_label = _column_label(
                    cells,
                    row_number=row_number,
                    column_number=column_number,
                    section_start_row=section.start_row,
                )
                metric = _metric_for_cell(section, column_label=col_label, row_label=row_label)
                source_region = _region_for_point(
                    regions,
                    row=row_number,
                    column=column_number,
                )
                source_region_id = _region_text(source_region, "id")
                source_region_kind = (
                    _region_text(source_region, "kind") or section.source_region_kind
                )
                source_region_range = (
                    _region_text(source_region, "range") or section.source_region_range
                )
                report_date = _report_date_for_cell(
                    workbook_report_date=sheet_date,
                    column_label=col_label,
                    row_label=row_label,
                    value=value,
                )
                calculated_state = _calculated_state(
                    formula=formula,
                    value_type=value_type,
                    region_kind=source_region_kind,
                    section_key=section.key,
                )
                address = str(cell.get("address") or "")
                facts.append(
                    SemanticFact(
                        source_key=f"{sheet_name}!{address}:{metric.key}:{section.key}",
                        buyer=_infer_buyer(
                            section=section,
                            row_label=row_label,
                            row_texts=row_text_values,
                            global_buyer=global_buyer,
                        ),
                        unit=_infer_unit(
                            section=section,
                            row_label=row_label,
                            column_label=col_label,
                            row_texts=row_text_values,
                            global_unit=global_unit,
                        ),
                        report_date=report_date,
                        metric_key=metric.key,
                        metric_label=metric.label,
                        operational_section=section.key,
                        operational_section_label=section.label,
                        operational_row_key=_slug(row_label),
                        operational_row_label=row_label,
                        column_label=col_label,
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
                        source_region_id=source_region_id or section.source_region_id,
                        source_region_kind=source_region_kind,
                        source_region_range=source_region_range,
                        workbook_sheet_identity={
                            "sheet_name": sheet_name,
                            "sheet_index": sheet_index,
                            "dimension": dimension,
                        },
                        workbook_source=workbook_source,
                        metadata={
                            "engine": "operational_semantic_mapper",
                            "source_region_label": _region_text(source_region, "label"),
                            "sheet_dimension": dimension,
                        },
                    )
                )

    semantic_regions: list[SemanticRegion] = []
    for section in resolved_sections:
        section_facts = [
            fact
            for fact in facts
            if fact.operational_section == section.key
            and fact.source_sheet_name == section.sheet_name
            and section.start_row <= fact.source_row_number <= section.end_row
        ]
        region_metric = SECTION_BY_KEY.get(section.key)
        metric_key = region_metric.key if region_metric else section.key
        metric_label = region_metric.label if region_metric else section.label
        semantic_regions.append(
            SemanticRegion(
                id=f"{sheet_name}:{section.key}:{section.start_row}:{section.end_row}",
                sheet_name=sheet_name,
                section=section.key,
                section_label=section.label,
                metric_key=metric_key,
                metric_label=metric_label,
                source_region_id=section.source_region_id,
                source_region_kind=section.source_region_kind,
                range=f"{section.start_row}:{section.end_row}",
                start_row=section.start_row,
                end_row=section.end_row,
                start_column=section.start_column,
                end_column=section.end_column,
                fact_count=len(section_facts),
                metadata={"source_region_range": section.source_region_range},
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
    workbook_report_date = _extract_report_date(all_cells, filename)

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
        "version": 1,
        "engine": "operational_semantic_mapper",
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
    return SemanticExtraction(facts=facts, regions=regions, semantic_mapping=semantic_mapping)


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
