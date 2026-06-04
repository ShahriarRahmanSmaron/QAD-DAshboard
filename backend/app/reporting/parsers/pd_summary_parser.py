from __future__ import annotations

import re
import logging
from datetime import date, datetime
from decimal import Decimal
from typing import Any
from uuid import UUID

logger = logging.getLogger("app.reporting.parsers.pd_summary")

from app.auth.schemas import AuthUser
from app.reporting.models import OperationalFact, UploadedFile
from app.reporting.workbook_formula_eval import build_sheet_formula_evaluator
from app.reporting.workbook_semantics import (
    SemanticFact,
    SemanticRegion,
    SemanticExtraction,
    _parse_date_text,
    _clamp_numeric,
    _calculated_state,
    _fact_json,
    _region_json,
    build_operational_fact_models,
)
from app.reporting.workbook_normalization import (
    normalize_unit_label,
    derive_metric_key,
    derive_metric_label,
    is_rollup_label,
    is_structural_label,
    CLASS_DETAIL,
    CLASS_SUMMARY,
)

MONTH_ALIASES = {
    "jan": 1, "january": 1,
    "feb": 2, "february": 2,
    "mar": 3, "march": 3,
    "apr": 4, "april": 4,
    "may": 5,
    "jun": 6, "june": 6,
    "jul": 7, "july": 7,
    "aug": 8, "august": 8,
    "sep": 9, "sept": 9, "september": 9,
    "oct": 10, "october": 10,
    "nov": 11, "november": 11,
    "dec": 12, "december": 12,
}

KNOWN_DEPARTMENTS = {
    "Dyeing",
    "Finishing",
    "Knitting",
    "Printing",
    "Spinning",
}

def parse_hierarchical_date(value: Any, reporting_year: int) -> date | None:
    if isinstance(value, (datetime, date)):
        if isinstance(value, datetime):
            return value.date()
        return value
    val_str = str(value).strip()
    if not val_str:
        return None
    try:
        # Try datetime ISO format first (e.g. 2026-05-26T00:00:00)
        return datetime.fromisoformat(val_str).date()
    except ValueError:
        pass
    try:
        return date.fromisoformat(val_str)
    except ValueError:
        pass
    
    parsed = _parse_date_text(val_str)
    if parsed:
        return parsed
        
    match = re.search(r"\b(?P<day>\d{1,2})[-/. ](?P<month>[A-Za-z]{3,9})\b", val_str)
    if match:
        day = int(match.group("day"))
        month_name = match.group("month").lower()[:3]
        month = MONTH_ALIASES.get(month_name)
        if month:
            try:
                return date(reporting_year, month, day)
            except ValueError:
                pass
    return None

def is_valid_sub_unit_candidate(val: Any) -> bool:
    if not val:
        return False
    val_str = str(val).strip()
    val_title = val_str.title()
    if val_title in KNOWN_DEPARTMENTS:
        return False
    val_upper = val_str.upper()
    if is_structural_label(val_str):
        return False
    # Additional common structural words in headers
    for word in ["DEPARTMENT", "RESPONSIBLE", "DATE", "QTY", "PERCENT", "SL NO", "SERIAL", "SUB UNIT", "SUB-UNIT"]:
        if word in val_upper:
            return False
    return True

def parse_pd_summary_workbook(
    workbook_metadata: dict[str, Any],
    uploaded_file_id: UUID | None = None,
    actor: AuthUser | None = None,
) -> SemanticExtraction:
    filename = str(workbook_metadata.get("filename") or "")
    
    # 1. Resolve base Reporting Date / Year
    reporting_date = None
    reporting_year = datetime.now().year
    
    for sheet in workbook_metadata.get("sheets", []):
        for cell in sheet.get("cells", []):
            val = cell.get("value")
            if val and "reporting date" in str(val).lower():
                parsed = _parse_date_text(str(val))
                if parsed:
                    reporting_date = parsed
                    reporting_year = parsed.year
                    break
                
                # Check right neighbors in the same row
                row = cell.get("row")
                col = cell.get("column")
                for neighbor in sheet.get("cells", []):
                    if neighbor.get("row") == row and neighbor.get("column") > col:
                        parsed = _parse_date_text(str(neighbor.get("value") or ""))
                        if parsed:
                            reporting_date = parsed
                            reporting_year = parsed.year
                            break
                if reporting_date:
                    break
        if reporting_date:
            break

    facts: list[SemanticFact] = []
    regions: list[SemanticRegion] = []
    sheet_summaries = []

    # Iterate over sheets
    for sheet_idx, sheet in enumerate(workbook_metadata.get("sheets", [])):
        sheet_name = str(sheet.get("name") or "")
        cells_list = sheet.get("cells", [])
        if not cells_list:
            continue
            
        # Group cells by (row, col)
        grid: dict[tuple[int, int], dict[str, Any]] = {}
        for c in cells_list:
            grid[(c["row"], c["column"])] = c
            
        evaluator = build_sheet_formula_evaluator(grid)
        rows_in_sheet = sorted({addr[0] for addr in grid.keys()})
        
        # Detect column indexes of interest by scanning header rows
        dept_col = None
        qty_cols = []
        pct_cols = []
        sub_unit_col = None
        date_col = None
        
        column_date_map = {}
        column_sub_unit_map = {}
        max_col_in_sheet = max((addr[1] for addr in grid.keys()), default=1)
        
        # 1. Build column_date_map by scanning all rows first
        for r in rows_in_sheet:
            row_vals = {c[1]: grid[c].get("value") for c in grid if c[0] == r}
            row_text_upper = " ".join([str(v).upper() for v in row_vals.values() if v is not None])
            if "REPORTING DATE" not in row_text_upper:
                row_date_map = {}
                last_seen_date = None
                for col_idx in range(1, max_col_in_sheet + 1):
                    val = grid.get((r, col_idx), {}).get("value")
                    if val is not None:
                        parsed_d = parse_hierarchical_date(val, reporting_year)
                        if parsed_d:
                            last_seen_date = parsed_d
                    if last_seen_date is not None:
                        row_date_map[col_idx] = last_seen_date
                if row_date_map:
                    column_date_map.update(row_date_map)

        # 2. Detect initial column layouts
        for r in rows_in_sheet:
            row_vals = {c[1]: grid[c].get("value") for c in grid if c[0] == r}
            row_text_upper = " ".join([str(v).upper() for v in row_vals.values() if v is not None])
            if "RESPONSIBLE DEPARTMENT" in row_text_upper:
                qty_cols = []
                pct_cols = []
                for col_idx, cell in sorted(grid.items()):
                    if cell.get("row") == r:
                        val_str = str(cell.get("value") or "").upper()
                        if "RESPONSIBLE DEPARTMENT" in val_str:
                            dept_col = col_idx[1]
                        elif "PD QTY" in val_str:
                            qty_cols.append(col_idx[1])
                        elif "PD%" in val_str:
                            pct_cols.append(col_idx[1])
                        elif "SUB" in val_str and "UNIT" in val_str:
                            sub_unit_col = col_idx[1]
                        elif "DATE" in val_str:
                            date_col = col_idx[1]
                
                # If sub unit col was not explicitly captioned:
                if sub_unit_col is None and dept_col is not None:
                    # Look for first text column to the left of department
                    for col_idx in sorted(row_vals.keys()):
                        if col_idx < dept_col:
                            sub_unit_col = col_idx
                            break
                break

        # State machine variables
        current_section = "Unit Wise PD"
        current_section_key = "unit_wise_pd"
        current_unit = None
        current_sub_unit = None
        current_date = reporting_date
        
        # State machine tracking variables for diagnostics
        prev_section = None
        prev_unit = None
        prev_sub_unit = None
        prev_date = None
        
        sheet_facts_count = 0
        section_start_rows: dict[str, int] = {}
        section_end_rows: dict[str, int] = {}
        section_fact_counts: dict[str, int] = {}

        KNOWN_SUB_UNITS = {"CCL-A", "CCL-B", "CCL-07", "HTL", "HTL-02", "HTL-2", "MTL"}

        for r in rows_in_sheet:
            row_cells = {c[1]: grid[c] for c in grid if c[0] == r}
            row_vals = {c[1]: grid[c].get("value") for c in grid if c[0] == r}
            row_text = " ".join([str(cell.get("value") or "") for cell in row_cells.values() if cell.get("value") is not None]).strip()
            row_text_upper = row_text.upper()
            
            # 0. Layout Headers Detection
            if "RESPONSIBLE DEPARTMENT" in row_text_upper:
                qty_cols = []
                pct_cols = []
                for col_idx, cell in sorted(row_cells.items()):
                    val_str = str(cell.get("value") or "").upper()
                    if "RESPONSIBLE DEPARTMENT" in val_str:
                        dept_col = col_idx
                    elif "PD QTY" in val_str:
                        qty_cols.append(col_idx)
                    elif "PD%" in val_str:
                        pct_cols.append(col_idx)

            # 1. Section Header Detection
            if "OVERALL SUMMARY (SOLID)" in row_text.upper():
                current_section = "Overall Summary (Solid)"
                current_section_key = "overall_summary_solid"
                current_unit = None
                current_sub_unit = None
                current_date = reporting_date
                column_sub_unit_map = {}
            elif "OVERALL SUMMARY (AOP)" in row_text.upper():
                current_section = "Overall Summary (AOP)"
                current_section_key = "overall_summary_aop"
                current_unit = None
                current_sub_unit = None
                current_date = reporting_date
                column_sub_unit_map = {}
            
            # 2. Company/Unit Header Rule (bold and contains Ltd / Limited / Textiles)
            is_unit_header = False
            if current_section == "Unit Wise PD":
                # Ensure no numeric values in the row to avoid matching detail rows
                has_numbers = any(isinstance(cell.get("value"), (int, float)) or (isinstance(cell.get("value"), str) and cell.get("value").isdigit()) for cell in row_cells.values())
                if not has_numbers:
                    is_date_row = any(parse_hierarchical_date(cell.get("value"), reporting_year) is not None for cell in row_cells.values())
                    is_desc_row = "DESCRIPTION" in row_text_upper
                    is_dept_row = "RESPONSIBLE DEPARTMENT" in row_text_upper or "DEPARTMENT" in row_text_upper
                    
                    if not is_date_row and not is_desc_row and not is_dept_row:
                        for col_idx, cell in sorted(row_cells.items()):
                            val_str = str(cell.get("value") or "").strip()
                            style = cell.get("style", {})
                            font = style.get("font", {})
                            is_bold = font.get("bold") is True
                            val_lower = val_str.lower()
                            if is_bold and ("ltd" in val_lower or "limited" in val_lower or "textiles" in val_lower):
                                if "color city ltd-07" in val_lower:
                                    current_unit = "Color City Ltd"
                                    column_sub_unit_map = {col: "CCL-07" for col in range(1, max_col_in_sheet + 1)}
                                else:
                                    current_unit = val_str
                                    column_sub_unit_map = {}
                                
                                current_sub_unit = None
                                current_date = reporting_date
                                is_unit_header = True
                                break
            if is_unit_header:
                if current_unit != prev_unit:
                    logger.info(f"UNIT DETECTED:\n{current_unit}")
                    prev_unit = current_unit
                continue

            # 3. Sub-unit or Date state updates
            # Let's scan for sub-units in this row to populate column_sub_unit_map
            if current_section == "Unit Wise PD":
                row_sub_units = {}
                for col_idx in range(1, max_col_in_sheet + 1):
                    val = grid.get((r, col_idx), {}).get("value")
                    if val is not None and is_valid_sub_unit_candidate(val):
                        norm_sub = normalize_unit_label(str(val))
                        if norm_sub and not is_rollup_label(norm_sub):
                            is_known = norm_sub in KNOWN_SUB_UNITS
                            looks_like_subunit = bool(re.match(r"^[A-Z]{2,6}(?:-\w{1,4})?$", norm_sub))
                            if is_known or looks_like_subunit:
                                row_sub_units[col_idx] = norm_sub
                
                if row_sub_units:
                    last_seen_subunit = None
                    for col_idx in range(1, max_col_in_sheet + 1):
                        if col_idx in row_sub_units:
                            last_seen_subunit = row_sub_units[col_idx]
                        if last_seen_subunit is not None:
                            column_sub_unit_map[col_idx] = last_seen_subunit

            for col_idx, cell in sorted(row_cells.items()):
                val = cell.get("value")
                if val is not None:
                    # check if it is a date first
                    parsed_d = parse_hierarchical_date(val, reporting_year)
                    if parsed_d:
                        current_date = parsed_d
                    elif is_valid_sub_unit_candidate(val):
                        norm_sub = normalize_unit_label(str(val))
                        if norm_sub and not is_rollup_label(norm_sub):
                            is_known = norm_sub in KNOWN_SUB_UNITS
                            looks_like_subunit = bool(re.match(r"^[A-Z]{2,6}(?:-\w{1,4})?$", norm_sub))
                            if is_known or looks_like_subunit:
                                current_sub_unit = norm_sub
                                if not is_known:
                                    logger.warning(f"Detected unknown sub-unit candidate: {norm_sub}")

            if date_col is not None and date_col in row_cells:
                cell_val = row_cells[date_col].get("value")
                parsed_d = parse_hierarchical_date(cell_val, reporting_year)
                if parsed_d:
                    current_date = parsed_d

            # Log changes in state variables
            if current_unit != prev_unit:
                logger.info(f"UNIT DETECTED:\n{current_unit}")
                prev_unit = current_unit
            if current_sub_unit != prev_sub_unit:
                logger.info(f"SUB UNIT DETECTED:\n{current_sub_unit}")
                prev_sub_unit = current_sub_unit
            if current_date != prev_date:
                date_str = current_date.strftime("%Y-%m-%d") if current_date else "None"
                logger.info(f"DATE DETECTED:\n{date_str}")
                prev_date = current_date
            if current_section != prev_section:
                logger.info(f"SECTION DETECTED:\n{current_section}")
                prev_section = current_section

            # Check if this row is metadata/header/total that must be ignored for generating facts
            dept_val_str = ""
            if dept_col is not None and dept_col in row_cells:
                dept_val_str = str(row_cells[dept_col].get("value") or "").strip()
            
            ignore_keywords = {"date", "description", "responsible department", "handover to packing", "grand total"}
            if dept_val_str.lower() in ignore_keywords:
                continue

            # 4. Department extraction
            department = None
            if dept_col is not None and dept_col in row_cells:
                dept_val = row_cells[dept_col].get("value")
                if dept_val is not None and not is_rollup_label(str(dept_val)):
                    dept_str = str(dept_val).strip()
                    if dept_str and dept_str.lower() not in ignore_keywords:
                        department = dept_str.title()

            # 5. Metric extraction
            metric_targets = []
            for target_col in qty_cols:
                metric_targets.append((target_col, "pd_qty", "PD Qty(Kg)"))
            for target_col in pct_cols:
                metric_targets.append((target_col, "pd_percent", "PD%"))

            for target_col, m_key, m_lbl in metric_targets:
                if target_col is not None and target_col in row_cells:
                    cell = row_cells[target_col]
                    val = cell.get("value")
                    formula = cell.get("formula")
                    
                    # Parse numeric value
                    num_val = None
                    if val is not None:
                        try:
                            # Clean cell value of potential Excel division errors
                            val_str = str(val).strip()
                            if "#" in val_str:
                                val_str = "0"
                            num_val = Decimal(val_str)
                        except Exception:
                            pass
                    
                    if formula is not None and num_val is None:
                        evaluated = evaluator.evaluate(r, target_col)
                        if evaluated is not None:
                            num_val = evaluated
                    
                    is_valid_num = num_val is not None
                    
                    # Force constraints
                    fact_unit = current_unit
                    fact_sub_unit = column_sub_unit_map.get(target_col, current_sub_unit)
                    if current_section_key in {"overall_summary_solid", "overall_summary_aop"}:
                        fact_unit = None
                        fact_sub_unit = None
                        
                    # Determine date anchor column: nearest date header above current column
                    # Each PD Qty / PD% pair must use its own date header.
                    if target_col in qty_cols:
                        date_anchor_col = target_col
                    elif target_col in pct_cols:
                        qty_before = [qc for qc in qty_cols if qc < target_col]
                        date_anchor_col = max(qty_before) if qty_before else target_col
                    else:
                        date_anchor_col = target_col

                    fact_date = None
                    for r_above in range(r - 1, 0, -1):
                        val_above = grid.get((r_above, date_anchor_col), {}).get("value")
                        if val_above is not None:
                            parsed_d = parse_hierarchical_date(val_above, reporting_year)
                            if parsed_d:
                                fact_date = parsed_d
                                break
                    if fact_date is None and date_col is not None and date_col in row_cells:
                        cell_val = row_cells[date_col].get("value")
                        fact_date = parse_hierarchical_date(cell_val, reporting_year)
                    if fact_date is None:
                        fact_date = reporting_date
                        
                    address = cell.get("address", "")
                    
                    # Validation rules
                    if current_section_key == "unit_wise_pd":
                        if fact_sub_unit is None:
                            logger.warning(f"Rejecting fact: sub_unit is None for Unit Wise PD at cell {sheet_name}!{address}")
                            continue
                        if fact_date is None:
                            logger.warning(f"Rejecting fact: report_date is None for Unit Wise PD at cell {sheet_name}!{address}")
                            continue
                        if not is_valid_num:
                            logger.warning(f"Rejecting fact: value_numeric is None for Unit Wise PD at cell {sheet_name}!{address}")
                            continue
                    
                    if is_valid_num:
                        is_rollup = is_rollup_label(row_text) or (formula is not None and fact_sub_unit is None)
                        row_class = CLASS_SUMMARY if is_rollup else CLASS_DETAIL
                        
                        fact = SemanticFact(
                            source_key=f"{sheet_name}!{address}:{m_key}:{current_section_key}",
                            buyer=None, # Buyer must remain NULL
                            unit=fact_unit,
                            report_date=fact_date,
                            metric_key=m_key,
                            metric_label=m_lbl,
                            operational_section=current_section_key,
                            operational_section_label=current_section,
                            operational_row_key=None,
                            operational_row_label=None,
                            column_label=m_lbl,
                            value_type="number",
                            value_numeric=_clamp_numeric(num_val),
                            value_text=None,
                            value_date=None,
                            value_boolean=None,
                            unit_of_measure="kg" if m_key == "pd_qty" else "%",
                            is_formula=formula is not None,
                            formula=formula,
                            calculated_state=_calculated_state(formula=formula, value_type="number", is_rollup=is_rollup),
                            row_classification=row_class,
                            is_active=True,
                            inactive_reason=None,
                            source_sheet_name=sheet_name,
                            source_sheet_index=sheet_idx,
                            source_cell_address=address,
                            source_row_number=r,
                            source_column_number=target_col,
                            source_region_id=None,
                            source_region_kind=None,
                            source_region_range=None,
                            workbook_sheet_identity={
                                "sheet_name": sheet_name,
                                "sheet_index": sheet_idx,
                                "dimension": sheet.get("dimension", ""),
                            },
                            workbook_source=workbook_metadata.get("workbook_source", {}),
                            metadata={
                                "engine": "pd_summary_parser",
                                "engine_version": 1,
                                "sub_unit": fact_sub_unit,
                                "department": department,
                            },
                        )
                        # Wire sub_unit and department directly to the metadata object
                        # dynamically since they are dynamically populated on OperationalFact DB models.
                        # We can also add properties dynamically or via custom attributes
                        # to the SemanticFact if we subclass or update python attributes.
                        object.__setattr__(fact, "sub_unit", fact_sub_unit)
                        object.__setattr__(fact, "department", department)
                        
                        # Log first 20 generated facts
                        if len(facts) < 20:
                            logger.debug(
                                "FACT GENERATED | unit=%s | sub_unit=%s | department=%s | metric=%s | value=%s | date=%s",
                                fact_unit,
                                fact_sub_unit,
                                department,
                                m_lbl,
                                num_val,
                                fact_date.strftime("%Y-%m-%d") if fact_date else "None"
                            )
                        
                        facts.append(fact)
                        sheet_facts_count += 1
                        
                        # Track region stats
                        section_start_rows[current_section_key] = min(section_start_rows.get(current_section_key, r), r)
                        section_end_rows[current_section_key] = max(section_end_rows.get(current_section_key, r), r)
                        section_fact_counts[current_section_key] = section_fact_counts.get(current_section_key, 0) + 1

        # Build semantic regions for this sheet
        for s_key, count in section_fact_counts.items():
            start_r = section_start_rows[s_key]
            end_r = section_end_rows[s_key]
            s_label = "Unit Wise PD" if s_key == "unit_wise_pd" else ("Overall Summary (Solid)" if s_key == "overall_summary_solid" else "Overall Summary (AOP)")
            regions.append(
                SemanticRegion(
                    id=f"{sheet_name}:{s_key}:{start_r}:{end_r}",
                    sheet_name=sheet_name,
                    section=s_key,
                    section_label=s_label,
                    metric_key="pd_qty", # fallback
                    metric_label="PD Qty(Kg)",
                    source_region_id=None,
                    source_region_kind=None,
                    range=f"{start_r}:{end_r}",
                    start_row=start_r,
                    end_row=end_r,
                    start_column=1,
                    end_column=sheet.get("max_column", 10),
                    fact_count=count,
                    metadata={},
                )
            )

        sheet_summaries.append(
            {
                "name": sheet_name,
                "index": sheet_idx,
                "fact_count": sheet_facts_count,
                "semantic_region_count": len(section_fact_counts),
            }
        )

    # Reconstruct serialization JSON
    facts_json = []
    for fact in facts:
        fj = _fact_json(fact)
        fj["sub_unit"] = getattr(fact, "sub_unit", None)
        fj["department"] = getattr(fact, "department", None)
        facts_json.append(fj)

    semantic_mapping = {
        "version": 3,
        "engine": "pd_summary_parser",
        "engine_version": 1,
        "uploaded_file_id": str(uploaded_file_id) if uploaded_file_id else None,
        "status": "mapped" if facts else "empty",
        "report_date": reporting_date.isoformat() if reporting_date else None,
        "fact_count": len(facts),
        "semantic_region_count": len(regions),
        "sheets": sheet_summaries,
        "regions": [_region_json(region) for region in regions],
        "facts": facts_json,
        "summary": {
            "rows": [],
            "by_metric": [],
        },
    }

    return SemanticExtraction(facts=facts, regions=regions, semantic_mapping=semantic_mapping)
