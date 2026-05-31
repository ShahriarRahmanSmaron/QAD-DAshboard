"""MD07-3 workbook governance tests.

These cover the pure, DB-free units of the governance layer:

* ``extract_workbook_report_date`` — the duplicate-upload guard reads this from
  parsed metadata before persisting facts.
* ``serialize_workbook_inventory_item`` — inventory row -> DTO mapping.
* ``_workbook_source_refs`` — comparison source-workbook serialization.

The DB-backed repository queries (inventory listing, duplicate lookup,
activate/deactivate/archive/delete) are exercised through the API integration
suite; here we lock down the deterministic building blocks.
"""

from __future__ import annotations

from datetime import UTC, date, datetime
from uuid import uuid4

from app.reporting.schemas import OperationalWorkbookSourceRef, WorkbookInventoryItem
from app.reporting.service import (
    _workbook_source_refs,
    serialize_workbook_inventory_item,
)
from app.reporting.workbook_semantics import extract_workbook_report_date
from tests.workbook_factory import build_sheet, build_workbook


def test_extract_workbook_report_date_from_labeled_cell():
    grid = {
        (1, 2): "BREAKDOWN OF WAIT FOR TEST AND SHADE",
        (2, 2): "Report Date: 21-MAY-2026",
        (3, 2): "UNIT",
        (4, 2): "U-01",
        (4, 3): 100,
    }
    workbook = build_workbook(
        filename="WF-Test-and-shade-21-may.xlsx",
        sheets=[build_sheet(name="S", grid=grid)],
    )
    assert extract_workbook_report_date(workbook) == date(2026, 5, 21)


def test_extract_workbook_report_date_falls_back_to_filename():
    grid = {(1, 1): "UNIT", (2, 1): "U-01", (2, 2): 5}
    workbook = build_workbook(
        filename="WF-Test-and-shade-20-05-2026.xlsx",
        sheets=[build_sheet(name="S", grid=grid)],
    )
    # No labeled date in the grid; the filename date is used.
    assert extract_workbook_report_date(workbook) == date(2026, 5, 20)


def test_extract_workbook_report_date_none_when_absent():
    grid = {(1, 1): "UNIT", (2, 1): "U-01", (2, 2): 5}
    workbook = build_workbook(
        filename="workbook.xlsx",
        sheets=[build_sheet(name="S", grid=grid)],
    )
    assert extract_workbook_report_date(workbook) is None


def test_serialize_workbook_inventory_item_reads_semantic_report_date():
    workbook_id = uuid4()
    uploaded_at = datetime(2026, 5, 30, 19, 36, tzinfo=UTC)
    row = {
        "workbook_id": workbook_id,
        "filename": "WF-Test-and-shade-21-may.xlsx",
        "report_type_id": None,
        "report_type_name": None,
        "uploaded_by_user_id": None,
        "status": "processed",
        "is_active_workbook": True,
        "archived_at": None,
        "file_size_bytes": 1024,
        "uploaded_at": uploaded_at,
        "metadata": {"semantic_mapping": {"report_date": "2026-05-21"}},
        "operational_fact_count": 12542,
    }
    item = serialize_workbook_inventory_item(row)
    assert isinstance(item, WorkbookInventoryItem)
    assert item.workbook_id == workbook_id
    assert item.filename == "WF-Test-and-shade-21-may.xlsx"
    assert item.report_date == date(2026, 5, 21)
    assert item.processed is True
    assert item.is_active_workbook is True
    assert item.operational_fact_count == 12542


def test_serialize_workbook_inventory_item_unprocessed_and_archived():
    row = {
        "workbook_id": uuid4(),
        "filename": "old.xlsx",
        "report_type_id": None,
        "report_type_name": None,
        "uploaded_by_user_id": None,
        "status": "failed",
        "is_active_workbook": False,
        "archived_at": datetime(2026, 5, 31, tzinfo=UTC),
        "file_size_bytes": None,
        "uploaded_at": datetime(2026, 5, 31, tzinfo=UTC),
        "metadata": {},
        "operational_fact_count": 0,
    }
    item = serialize_workbook_inventory_item(row)
    assert item.processed is False
    assert item.report_date is None
    assert item.archived_at is not None
    assert item.operational_fact_count == 0


def test_workbook_source_refs_serialization():
    workbook_id = uuid4()
    rows = [
        {"workbook_id": workbook_id, "filename": "WF-21-may.xlsx", "fact_count": 42},
        {"workbook_id": None, "filename": None, "fact_count": 0},  # skipped
        "not-a-dict",  # skipped
    ]
    refs = _workbook_source_refs(rows)
    assert len(refs) == 1
    assert isinstance(refs[0], OperationalWorkbookSourceRef)
    assert refs[0].workbook_id == workbook_id
    assert refs[0].filename == "WF-21-may.xlsx"
    assert refs[0].fact_count == 42


def test_workbook_source_refs_handles_non_list():
    assert _workbook_source_refs(None) == []
    assert _workbook_source_refs("nope") == []
