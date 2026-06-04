from __future__ import annotations

from decimal import Decimal
from datetime import date
from uuid import uuid4

from app.reporting.parsers.pd_summary_parser import parse_pd_summary_workbook
from app.reporting.workbook_normalization import is_pd_summary_workbook
from tests.workbook_factory import build_sheet, build_workbook

def test_pd_summary_detection_and_parsing():
    # Construct a synthetic sheet matching the PD Summary format
    grid = {
        # Header / Meta
        (1, 2): "Reporting Date: 03-Jun-2026",
        # Table Headers
        (3, 2): "Sub Unit",
        (3, 3): "Responsible Department",
        (3, 4): "PD Qty(Kg)",
        (3, 5): "PD%",
        (3, 6): "Date",
        
        # Unit Block: Hamza Textile Ltd-02 (bold, contains Ltd but doesn't end with it)
        (4, 2): "Hamza Textile Ltd-02",
        
        # Sub Unit row: CCL-A
        (5, 2): "CCL-A",
        (5, 3): "Dyeing",
        (5, 4): 1100,
        (5, 5): 0.15,
        (5, 6): "26-May",  # Model B date
        
        # Another row under CCL-A: check invalid department
        (6, 3): "Invalid Department Value",
        (6, 4): 950,
        (6, 5): 0.12,
        (6, 6): "25-May",  # Model B date
        
        # OVERALL SUMMARY (SOLID) transition
        (8, 2): "OVERALL SUMMARY (SOLID)",
        (9, 3): "Spinning",
        (9, 4): 5000,
        (9, 5): 0.08,
    }
    
    # We must mark company name (row 4, column 2) as bold in cells style list
    # and build sheet merges if any.
    sheet = build_sheet(name="PD Sheet", grid=grid)
    
    # Let's patch cell style to make row 4 column 2 bold:
    for cell in sheet["cells"]:
        if cell["row"] == 4 and cell["column"] == 2:
            cell["style"] = {"font": {"bold": True}}
            
    workbook_metadata = build_workbook(filename="PD Summary 3June.xlsx", sheets=[sheet])
    
    # Verify detection conditions
    assert is_pd_summary_workbook(workbook_metadata) is True
    
    # Run the dedicated parser
    extraction = parse_pd_summary_workbook(workbook_metadata, uploaded_file_id=uuid4())
    
    facts = extraction.facts
    assert len(facts) > 0
    
    # Group facts by source cell address for easier assertions
    facts_by_cell = {f.source_cell_address: f for f in facts}
    
    # Assertions for CCL-A Dyeing row (Row 5)
    d_qty_fact = facts_by_cell["D5"]
    assert d_qty_fact.unit == "Hamza Textile Ltd-02"
    assert d_qty_fact.metadata.get("sub_unit") == "CCL-A"
    assert d_qty_fact.metadata.get("department") == "Dyeing"
    assert d_qty_fact.buyer is None
    assert d_qty_fact.report_date == date(2026, 5, 26)  # Model B parsed date
    assert d_qty_fact.value_numeric == Decimal("1100")
    
    # Assertions for row with invalid department (Row 6)
    f_qty_fact = facts_by_cell["D6"]
    assert f_qty_fact.unit == "Hamza Textile Ltd-02"
    assert f_qty_fact.metadata.get("sub_unit") == "CCL-A"
    assert f_qty_fact.metadata.get("department") == "Invalid Department Value"
    assert f_qty_fact.report_date == date(2026, 5, 25)
    assert f_qty_fact.value_numeric == Decimal("950")
    
    # Assertions for Overall Summary (SOLID) row (Row 9)
    os_fact = facts_by_cell["D9"]
    assert os_fact.operational_section == "overall_summary_solid"
    assert os_fact.unit is None
    assert os_fact.metadata.get("sub_unit") is None
    assert os_fact.metadata.get("department") == "Spinning"  # department remains populated in overall summary
    assert os_fact.report_date == date(2026, 6, 3)  # Uses workbook's default Reporting Date

def test_pd_summary_multi_date_and_validation(caplog):
    # Construct a synthetic sheet matching the PD Summary format with multiple dates
    grid = {
        # Header / Meta
        (1, 2): "Reporting Date: 03-Jun-2026",
        
        # Date Headers Row
        (3, 4): "26-May-26",
        (3, 6): "25-May-26",
        
        # Table Headers
        (4, 2): "Sub Unit",
        (4, 3): "Responsible Department",
        (4, 4): "PD Qty(Kg)",
        (4, 5): "PD%",
        (4, 6): "PD Qty(Kg)",
        (4, 7): "PD%",
        
        # Unit Block: Hamza Textile Ltd-02
        (5, 2): "Hamza Textile Ltd-02",
        
        # Row 6: Sub Unit CCL-A, Department Dyeing
        # column 4 and 5 are for 26-May, column 6 and 7 are for 25-May
        (6, 2): "CCL-A",
        (6, 3): "Dyeing",
        (6, 4): 1100,  # pd_qty for 26-May
        (6, 5): 0.15,  # pd% for 26-May
        (6, 6): 950,   # pd_qty for 25-May
        (6, 7): 0.12,  # pd% for 25-May
        
        # Row 7: Unknown sub-unit MTL-3, should warn but allow
        (7, 2): "MTL-3",
        (7, 3): "Knitting",
        (7, 4): 500,
        (7, 5): 0.05,
        
        # Row 8: Missing value_numeric, should be rejected for unit_wise_pd
        (8, 2): "CCL-B",
        (8, 3): "Finishing",
        (8, 4): None,
        (8, 5): None,
    }
    
    sheet = build_sheet(name="PD Sheet", grid=grid)
    
    # Patch cell style to make company name bold
    for cell in sheet["cells"]:
        if cell["row"] == 5 and cell["column"] == 2:
            cell["style"] = {"font": {"bold": True}}
            
    workbook_metadata = build_workbook(filename="PD Summary Multi-Date.xlsx", sheets=[sheet])
    
    # Run parsing and capture logs
    import logging
    with caplog.at_level(logging.WARNING, logger="app.reporting.parsers.pd_summary"):
        extraction = parse_pd_summary_workbook(workbook_metadata, uploaded_file_id=uuid4())
        
    facts = extraction.facts
    assert len(facts) > 0
    
    # We should see warning for unknown sub-unit candidate MTL-03
    assert any("Detected unknown sub-unit candidate: MTL-03" in record.message for record in caplog.records)
    # We should see rejection warning for cell with missing value_numeric on Row 8
    assert any("Rejecting fact: value_numeric is None for Unit Wise PD" in record.message for record in caplog.records)
    
    # Group facts by source cell address
    facts_by_cell = {f.source_cell_address: f for f in facts}
    
    # Verify CCL-A Dyeing 26-May facts (columns 4 and 5)
    d26_qty = facts_by_cell["D6"]
    assert d26_qty.unit == "Hamza Textile Ltd-02"
    assert d26_qty.metadata.get("sub_unit") == "CCL-A"
    assert d26_qty.report_date == date(2026, 5, 26)
    assert d26_qty.value_numeric == Decimal("1100")
    
    d26_pct = facts_by_cell["E6"]
    assert d26_pct.report_date == date(2026, 5, 26)
    assert d26_pct.value_numeric == Decimal("0.15")
    
    # Verify CCL-A Dyeing 25-May facts (columns 6 and 7)
    d25_qty = facts_by_cell["F6"]
    assert d25_qty.report_date == date(2026, 5, 25)
    assert d25_qty.value_numeric == Decimal("950")
    
    d25_pct = facts_by_cell["G6"]
    assert d25_pct.report_date == date(2026, 5, 25)
    assert d25_pct.value_numeric == Decimal("0.12")
    
    # Verify MTL-3 (unknown sub-unit, allowed)
    mtl_qty = facts_by_cell["D7"]
    assert mtl_qty.metadata.get("sub_unit") == "MTL-03"
    assert mtl_qty.value_numeric == Decimal("500")

