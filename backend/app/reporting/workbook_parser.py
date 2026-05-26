from __future__ import annotations

import logging
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any

from app.reporting.workbook_sync import (
    build_empty_sheet_sync_map,
    build_sheet_sync_map,
    build_workbook_sync_summary,
)

logger = logging.getLogger("app.reporting.workbook")

MAX_PREVIEW_ROWS = 160
MAX_PREVIEW_COLUMNS = 60
MAX_REGION_ROWS_GAP = 1
HEADER_TEXT_MARKERS = ("report date", "buyer-wise", "summary", "stock", "test", "shade")
SUMMARY_TEXT_MARKERS = ("total", "grand total", "previous day", "running day")


def _cell_value(value: Any) -> str | int | float | bool | None:
    if value is None:
        return None
    if isinstance(value, bool | int | float | str):
        return value
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, datetime | date):
        return value.isoformat()
    return str(value)


def _color_value(color: Any) -> str | None:
    if color is None:
        return None
    if color.type == "rgb" and color.rgb:
        return color.rgb
    if color.type == "indexed":
        return f"indexed:{color.indexed}"
    if color.type == "theme":
        return f"theme:{color.theme}"
    return None


def _border_side(side: Any) -> dict[str, Any] | None:
    if side is None or side.style is None:
        return None
    return {
        "style": side.style,
        "color": _color_value(side.color),
    }


def _cell_style(cell: Any) -> dict[str, Any]:
    fill = cell.fill
    font = cell.font
    alignment = cell.alignment
    border = cell.border
    return {
        "style_id": cell.style_id,
        "number_format": cell.number_format,
        "fill": {
            "type": fill.fill_type,
            "fg_color": _color_value(fill.fgColor),
        },
        "font": {
            "bold": bool(font.bold),
            "italic": bool(font.italic),
            "color": _color_value(font.color),
            "name": font.name,
            "size": font.sz,
        },
        "alignment": {
            "horizontal": alignment.horizontal,
            "vertical": alignment.vertical,
            "wrap_text": bool(alignment.wrap_text),
        },
        "border": {
            "left": _border_side(border.left),
            "right": _border_side(border.right),
            "top": _border_side(border.top),
            "bottom": _border_side(border.bottom),
        },
    }


def _normalized_region_kind(sheet: Any, start_row: int, end_row: int) -> str:
    values: list[str] = []
    formula_count = 0
    styled_count = 0

    for row in sheet.iter_rows(min_row=start_row, max_row=end_row):
        for cell in row:
            if cell.value is None:
                continue
            text_value = str(cell.value).strip().lower()
            values.append(text_value)
            if text_value.startswith("="):
                formula_count += 1
            if cell.style_id:
                styled_count += 1

    joined = " ".join(values)
    if any(marker in joined for marker in SUMMARY_TEXT_MARKERS):
        return "summary_band"
    if any(marker in joined for marker in HEADER_TEXT_MARKERS):
        return "grouped_section"
    if formula_count > 0 and formula_count >= max(1, len(values) // 3):
        return "readonly_band"
    if styled_count > 0 and len(values) <= 4:
        return "metric_zone"
    return "operational_block"


def _region_metadata(sheet: Any, start_row: int, end_row: int) -> dict[str, Any]:
    formula_count = 0
    non_empty_count = 0
    style_ids: set[int] = set()
    merged_ranges = []

    for merged_range in sheet.merged_cells.ranges:
        if merged_range.min_row <= end_row and merged_range.max_row >= start_row:
            merged_ranges.append(merged_range.coord)

    for row in sheet.iter_rows(min_row=start_row, max_row=end_row):
        for cell in row:
            if cell.value is None:
                continue
            non_empty_count += 1
            style_ids.add(cell.style_id)
            if isinstance(cell.value, str) and cell.value.startswith("="):
                formula_count += 1

    return {
        "formula_count": formula_count,
        "non_empty_cell_count": non_empty_count,
        "style_ids": sorted(style_ids),
        "merged_ranges": merged_ranges,
    }


def _build_regions(sheet: Any) -> list[dict[str, Any]]:
    regions: list[dict[str, Any]] = []

    for index, merged_range in enumerate(sheet.merged_cells.ranges, start=1):
        regions.append(
            {
                "id": f"{sheet.title}_merged_{index}",
                "label": f"Merged {merged_range.coord}",
                "kind": "merged_cell_region",
                "range": merged_range.coord,
                "start_row": merged_range.min_row,
                "end_row": merged_range.max_row,
                "start_column": merged_range.min_col,
                "end_column": merged_range.max_col,
                "metadata": {
                    "size": {
                        "rows": merged_range.max_row - merged_range.min_row + 1,
                        "columns": merged_range.max_col - merged_range.min_col + 1,
                    }
                },
            }
        )

    active_rows: list[int] = []
    for row in sheet.iter_rows():
        if any(cell.value is not None for cell in row):
            active_rows.append(row[0].row)

    if not active_rows:
        return regions

    def append_band(index: int, start: int, end: int, kind: str) -> None:
        regions.append(
            {
                "id": f"{sheet.title}_band_{index}",
                "label": f"Workbook band rows {start}-{end}",
                "kind": kind,
                "range": f"{start}:{end}",
                "start_row": start,
                "end_row": end,
                "start_column": 1,
                "end_column": sheet.max_column,
                "metadata": _region_metadata(sheet, start, end),
            }
        )

    start_row = active_rows[0]
    previous_row = active_rows[0]
    current_kind = _normalized_region_kind(sheet, start_row, start_row)
    region_index = 1
    for row_number in active_rows[1:]:
        row_kind = _normalized_region_kind(sheet, row_number, row_number)
        has_gap = row_number - previous_row > MAX_REGION_ROWS_GAP + 1
        if has_gap or row_kind != current_kind:
            append_band(region_index, start_row, previous_row, current_kind)
            region_index += 1
            start_row = row_number
            current_kind = row_kind
        previous_row = row_number

    append_band(region_index, start_row, previous_row, current_kind)
    return regions


def _freeze_pane_metadata(sheet: Any) -> dict[str, int | str | None]:
    coordinate = sheet.freeze_panes
    if coordinate is None:
        return {"cell": None, "frozen_rows": 0, "frozen_columns": 0}

    try:
        from openpyxl.utils.cell import coordinate_to_tuple

        row, column = coordinate_to_tuple(str(coordinate))
    except Exception:
        return {"cell": str(coordinate), "frozen_rows": 0, "frozen_columns": 0}

    return {
        "cell": str(coordinate),
        "frozen_rows": max(0, row - 1),
        "frozen_columns": max(0, column - 1),
    }


def _empty_structure(sheet: Any | None = None) -> dict[str, Any]:
    sheet_state = getattr(sheet, "sheet_state", None) if sheet is not None else None
    return {
        "merged_cells": [],
        "row_heights": {},
        "column_widths": {},
        "hidden_rows": [],
        "hidden_columns": [],
        "freeze_panes": None,
        "row_groups": {},
        "column_groups": {},
        "sheet_state": sheet_state or "visible",
    }


def _empty_freeze_panes() -> dict[str, Any]:
    return {"cell": None, "frozen_rows": 0, "frozen_columns": 0}


def _degraded_sheet(
    *,
    sheet_index: int,
    sheet_name: str,
    sheet: Any | None,
    filename: str,
    phase: str,
    error: BaseException,
) -> dict[str, Any]:
    """Return a minimally-populated sheet entry that won't crash downstream consumers.

    Every sheet must always expose ``sync.cells``, ``sync.rows``, ``sync.columns`` and
    ``sync.regions`` so the frontend can iterate them without runtime errors.
    """

    logger.warning(
        "workbook sync degraded: sheet=%r workbook=%r phase=%s error=%s",
        sheet_name,
        filename,
        phase,
        error,
        exc_info=True,
    )

    structure = _empty_structure(sheet)
    sync = build_empty_sheet_sync_map(
        sheet_name=sheet_name,
        structure=structure,
        freeze_panes=_empty_freeze_panes(),
        preview_row_limit=0,
        preview_column_limit=0,
        degraded=True,
        degraded_reason=f"{phase}:{type(error).__name__}",
    )

    return {
        "name": sheet_name,
        "index": sheet_index,
        "dimension": "A1",
        "max_row": 0,
        "max_column": 0,
        "non_empty_cell_count": 0,
        "formula_count": 0,
        "structure": structure,
        "regions": [],
        "cells": [],
        "workbook_view": {
            "freeze_panes": _empty_freeze_panes(),
            "grid_lines": True,
            "zoom_scale": None,
        },
        "sync": sync,
        "degraded": True,
        "degraded_reason": f"{phase}:{type(error).__name__}",
    }


def _parse_single_sheet(
    sheet: Any,
    *,
    sheet_index: int,
    filename: str,
) -> dict[str, Any]:
    """Parse a single worksheet. Always returns a dict with a fully populated ``sync``.

    On any unexpected failure, returns a degraded sheet shape so callers can keep
    iterating other sheets without losing the entire workbook upload.
    """

    sheet_name = getattr(sheet, "title", None) or f"Sheet{sheet_index}"

    try:
        max_row = max(int(getattr(sheet, "max_row", 0) or 0), 0)
        max_column = max(int(getattr(sheet, "max_column", 0) or 0), 0)
        preview_row_limit = min(max_row, MAX_PREVIEW_ROWS)
        preview_column_limit = min(max_column, MAX_PREVIEW_COLUMNS)

        non_empty_cell_count = 0
        formula_count = 0
        cells: list[dict[str, Any]] = []

        if max_row > 0 and max_column > 0:
            try:
                for row in sheet.iter_rows(max_row=max_row, max_col=max_column):
                    for cell in row:
                        if cell.value is None:
                            continue
                        non_empty_cell_count += 1
                        if isinstance(cell.value, str) and cell.value.startswith("="):
                            formula_count += 1
                        if (
                            cell.row > preview_row_limit
                            or cell.column > preview_column_limit
                        ):
                            continue

                        formula = (
                            cell.value
                            if isinstance(cell.value, str) and cell.value.startswith("=")
                            else None
                        )
                        try:
                            style = _cell_style(cell)
                        except Exception as style_error:  # noqa: BLE001
                            logger.warning(
                                "workbook sync style fallback: sheet=%r workbook=%r "
                                "phase=cell_style address=%s error=%s",
                                sheet_name,
                                filename,
                                cell.coordinate,
                                style_error,
                            )
                            style = {}
                        cells.append(
                            {
                                "address": cell.coordinate,
                                "row": cell.row,
                                "column": cell.column,
                                "value": None if formula else _cell_value(cell.value),
                                "formula": formula,
                                "data_type": cell.data_type,
                                "style": style,
                            }
                        )
            except Exception as iter_error:  # noqa: BLE001
                logger.warning(
                    "workbook sync iter_rows fallback: sheet=%r workbook=%r "
                    "phase=iter_rows error=%s",
                    sheet_name,
                    filename,
                    iter_error,
                )

        row_heights: dict[str, float] = {}
        column_widths: dict[str, float] = {}
        hidden_rows: list[int] = []
        hidden_columns: list[str] = []
        row_groups: dict[str, int] = {}
        column_groups: dict[str, int] = {}

        try:
            row_heights = {
                str(index): dimension.height
                for index, dimension in sheet.row_dimensions.items()
                if dimension.height is not None
            }
            column_widths = {
                key: dimension.width
                for key, dimension in sheet.column_dimensions.items()
                if dimension.width is not None
            }
            hidden_rows = [
                index
                for index, dimension in sheet.row_dimensions.items()
                if bool(dimension.hidden)
            ]
            hidden_columns = [
                key
                for key, dimension in sheet.column_dimensions.items()
                if bool(dimension.hidden)
            ]
            row_groups = {
                str(index): dimension.outlineLevel
                for index, dimension in sheet.row_dimensions.items()
                if dimension.outlineLevel
            }
            column_groups = {
                key: dimension.outlineLevel
                for key, dimension in sheet.column_dimensions.items()
                if dimension.outlineLevel
            }
        except Exception as dim_error:  # noqa: BLE001
            logger.warning(
                "workbook sync dimensions fallback: sheet=%r workbook=%r "
                "phase=dimensions error=%s",
                sheet_name,
                filename,
                dim_error,
            )

        try:
            freeze_panes = _freeze_pane_metadata(sheet)
        except Exception as freeze_error:  # noqa: BLE001
            logger.warning(
                "workbook sync freeze_panes fallback: sheet=%r workbook=%r "
                "phase=freeze_panes error=%s",
                sheet_name,
                filename,
                freeze_error,
            )
            freeze_panes = _empty_freeze_panes()

        try:
            merged_cells = [
                merged_range.coord for merged_range in sheet.merged_cells.ranges
            ]
        except Exception as merged_error:  # noqa: BLE001
            logger.warning(
                "workbook sync merged_cells fallback: sheet=%r workbook=%r "
                "phase=merged_cells error=%s",
                sheet_name,
                filename,
                merged_error,
            )
            merged_cells = []

        structure = {
            "merged_cells": merged_cells,
            "row_heights": row_heights,
            "column_widths": column_widths,
            "hidden_rows": hidden_rows,
            "hidden_columns": hidden_columns,
            "freeze_panes": (
                str(sheet.freeze_panes) if getattr(sheet, "freeze_panes", None) else None
            ),
            "row_groups": row_groups,
            "column_groups": column_groups,
            "sheet_state": getattr(sheet, "sheet_state", None) or "visible",
        }

        try:
            regions = _build_regions(sheet)
        except Exception as region_error:  # noqa: BLE001
            logger.warning(
                "workbook sync regions fallback: sheet=%r workbook=%r "
                "phase=regions error=%s",
                sheet_name,
                filename,
                region_error,
            )
            regions = []

        try:
            sync = build_sheet_sync_map(
                sheet,
                cells=cells,
                regions=regions,
                structure=structure,
                freeze_panes=freeze_panes,
                preview_row_limit=preview_row_limit,
                preview_column_limit=preview_column_limit,
            )
        except Exception as sync_error:  # noqa: BLE001
            logger.warning(
                "workbook sync build fallback: sheet=%r workbook=%r "
                "phase=build_sync_map error=%s",
                sheet_name,
                filename,
                sync_error,
                exc_info=True,
            )
            sync = build_empty_sheet_sync_map(
                sheet_name=sheet_name,
                structure=structure,
                freeze_panes=freeze_panes,
                preview_row_limit=preview_row_limit,
                preview_column_limit=preview_column_limit,
                degraded=True,
                degraded_reason=f"build_sync_map:{type(sync_error).__name__}",
            )

        try:
            dimension = sheet.calculate_dimension()
        except Exception:
            dimension = "A1"

        try:
            grid_lines = bool(sheet.sheet_view.showGridLines)
        except Exception:
            grid_lines = True
        try:
            zoom_scale = sheet.sheet_view.zoomScale
        except Exception:
            zoom_scale = None

        return {
            "name": sheet_name,
            "index": sheet_index,
            "dimension": dimension,
            "max_row": max_row,
            "max_column": max_column,
            "non_empty_cell_count": non_empty_cell_count,
            "formula_count": formula_count,
            "structure": structure,
            "regions": regions,
            "cells": cells,
            "workbook_view": {
                "freeze_panes": freeze_panes,
                "grid_lines": grid_lines,
                "zoom_scale": zoom_scale,
            },
            "sync": sync,
        }
    except Exception as exc:  # noqa: BLE001
        return _degraded_sheet(
            sheet_index=sheet_index,
            sheet_name=sheet_name,
            sheet=sheet,
            filename=filename,
            phase="sheet_parse",
            error=exc,
        )


def parse_xlsx_workbook(path: Path, *, filename: str) -> dict[str, Any]:
    try:
        from openpyxl import load_workbook
    except ImportError as exc:
        raise RuntimeError(
            "openpyxl is required for workbook ingestion. Install backend dependencies first."
        ) from exc

    try:
        import pandas as pd

        pandas_sheet_names = list(pd.ExcelFile(path).sheet_names)
    except Exception:
        pandas_sheet_names = []

    workbook = load_workbook(path, data_only=False)
    sheets: list[dict[str, Any]] = []

    for sheet_index, sheet in enumerate(workbook.worksheets, start=1):
        sheets.append(
            _parse_single_sheet(sheet, sheet_index=sheet_index, filename=filename)
        )

    parser_name = "openpyxl+pandas" if pandas_sheet_names else "openpyxl"
    degraded_sheets = [sheet["name"] for sheet in sheets if sheet.get("degraded")]
    if degraded_sheets:
        logger.warning(
            "workbook upload completed with degraded sheets: workbook=%r sheets=%s",
            filename,
            degraded_sheets,
        )

    return {
        "filename": filename,
        "sheet_count": len(sheets),
        "parser": parser_name,
        "preview_limits": {
            "max_rows": MAX_PREVIEW_ROWS,
            "max_columns": MAX_PREVIEW_COLUMNS,
            "pandas_sheet_names": pandas_sheet_names,
        },
        "workbook_sync": build_workbook_sync_summary(
            filename=filename,
            sheets=sheets,
            parser=parser_name,
        ),
        "sheets": sheets,
        "degraded_sheets": degraded_sheets,
    }
