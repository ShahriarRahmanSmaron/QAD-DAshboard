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
FOOTER_TEXT_MARKERS = ("prepared by", "checked by", "approved by", "signature", "remarks", "note")


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


def _has_visual_style(cell: Any) -> bool:
    if getattr(cell, "has_style", False):
        return True
    fill = getattr(cell, "fill", None)
    if fill is not None and getattr(fill, "fill_type", None):
        return True
    border = getattr(cell, "border", None)
    if border is not None and any(
        getattr(getattr(border, side, None), "style", None)
        for side in ("left", "right", "top", "bottom")
    ):
        return True
    font = getattr(cell, "font", None)
    if font is not None and (getattr(font, "bold", False) or getattr(font, "italic", False)):
        return True
    alignment = getattr(cell, "alignment", None)
    return bool(
        alignment is not None
        and (
            getattr(alignment, "horizontal", None)
            or getattr(alignment, "vertical", None)
            or getattr(alignment, "wrap_text", False)
        )
    )


def _is_formula_value(value: Any) -> bool:
    return isinstance(value, str) and value.startswith("=")


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
    filled_count = 0
    bold_count = 0

    for row in sheet.iter_rows(min_row=start_row, max_row=end_row):
        for cell in row:
            if _has_visual_style(cell):
                styled_count += 1
            fill = getattr(cell, "fill", None)
            if fill is not None and getattr(fill, "fill_type", None):
                filled_count += 1
            font = getattr(cell, "font", None)
            if font is not None and getattr(font, "bold", False):
                bold_count += 1
            if cell.value is None:
                continue
            text_value = str(cell.value).strip().lower()
            values.append(text_value)
            if _is_formula_value(cell.value):
                formula_count += 1

    joined = " ".join(values)
    if not values and styled_count:
        return "worksheet_separator"
    if any(marker in joined for marker in FOOTER_TEXT_MARKERS):
        return "footer_region"
    if any(marker in joined for marker in SUMMARY_TEXT_MARKERS):
        return "summary_band"
    if formula_count > 0 and formula_count >= max(1, len(values) // 4):
        return "formula_row"
    if any(marker in joined for marker in HEADER_TEXT_MARKERS):
        return "section_header"
    if len(values) <= 3 and (filled_count or bold_count) and styled_count >= max(1, len(values)):
        return "section_header"
    if formula_count > 0:
        return "readonly_band"
    if styled_count > 0 and len(values) <= 4:
        return "metric_zone"
    return "operational_block"


def _region_metadata(sheet: Any, start_row: int, end_row: int) -> dict[str, Any]:
    formula_count = 0
    non_empty_count = 0
    style_ids: set[int] = set()
    fill_colors: set[str] = set()
    font_names: set[str] = set()
    bold_count = 0
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
            fill_color = _color_value(getattr(cell.fill, "fgColor", None))
            if fill_color:
                fill_colors.add(fill_color)
            font_name = getattr(cell.font, "name", None)
            if font_name:
                font_names.add(str(font_name))
            if getattr(cell.font, "bold", False):
                bold_count += 1
            if _is_formula_value(cell.value):
                formula_count += 1

    return {
        "formula_count": formula_count,
        "non_empty_cell_count": non_empty_count,
        "style_ids": sorted(style_ids),
        "fill_colors": sorted(fill_colors),
        "font_names": sorted(font_names),
        "bold_cell_count": bold_count,
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
        if any(cell.value is not None or _has_visual_style(cell) for cell in row):
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
    sheet_format = getattr(sheet, "sheet_format", None) if sheet is not None else None
    default_row_height = (
        getattr(sheet_format, "defaultRowHeight", None) if sheet_format is not None else None
    )
    default_column_width = (
        getattr(sheet_format, "defaultColWidth", None) if sheet_format is not None else None
    )
    return {
        "merged_cells": [],
        "row_heights": {},
        "column_widths": {},
        "default_row_height": default_row_height,
        "default_column_width": default_column_width,
        "sheet_format": {
            "base_column_width": (
                getattr(sheet_format, "baseColWidth", None) if sheet_format is not None else None
            ),
            "default_row_height": default_row_height,
            "default_column_width": default_column_width,
        },
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
        preview_merged_cells: set[tuple[int, int]] = set()

        try:
            for merged_range in sheet.merged_cells.ranges:
                if (
                    merged_range.min_row > preview_row_limit
                    or merged_range.min_col > preview_column_limit
                ):
                    continue
                for row_number in range(
                    merged_range.min_row,
                    min(merged_range.max_row, preview_row_limit) + 1,
                ):
                    for column_number in range(
                        merged_range.min_col,
                        min(merged_range.max_col, preview_column_limit) + 1,
                    ):
                        preview_merged_cells.add((row_number, column_number))
        except Exception as merged_preview_error:  # noqa: BLE001
            logger.warning(
                "workbook sync merged preview fallback: sheet=%r workbook=%r "
                "phase=merged_preview error=%s",
                sheet_name,
                filename,
                merged_preview_error,
            )

        if max_row > 0 and max_column > 0:
            try:
                for row in sheet.iter_rows(max_row=max_row, max_col=max_column):
                    for cell in row:
                        has_value = cell.value is not None
                        if has_value:
                            non_empty_cell_count += 1
                            if _is_formula_value(cell.value):
                                formula_count += 1

                        inside_preview = (
                            cell.row <= preview_row_limit
                            and cell.column <= preview_column_limit
                        )
                        has_preview_geometry = (cell.row, cell.column) in preview_merged_cells
                        if not inside_preview or (
                            not has_value
                            and not _has_visual_style(cell)
                            and not has_preview_geometry
                        ):
                            continue

                        formula = cell.value if _is_formula_value(cell.value) else None
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
        sheet_format = getattr(sheet, "sheet_format", None)
        default_row_height = (
            getattr(sheet_format, "defaultRowHeight", None) if sheet_format is not None else None
        )
        default_column_width = (
            getattr(sheet_format, "defaultColWidth", None) if sheet_format is not None else None
        )
        base_column_width = (
            getattr(sheet_format, "baseColWidth", None) if sheet_format is not None else None
        )
        outline_properties = getattr(getattr(sheet, "sheet_properties", None), "outlinePr", None)

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
            "default_row_height": default_row_height,
            "default_column_width": default_column_width,
            "sheet_format": {
                "base_column_width": base_column_width,
                "default_row_height": default_row_height,
                "default_column_width": default_column_width,
                "outline_summary_below": getattr(outline_properties, "summaryBelow", None),
                "outline_summary_right": getattr(outline_properties, "summaryRight", None),
            },
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
    try:
        for sheet_index, sheet in enumerate(workbook.worksheets, start=1):
            sheets.append(
                _parse_single_sheet(sheet, sheet_index=sheet_index, filename=filename)
            )
    finally:
        workbook.close()

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
