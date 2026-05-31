"""MD07-2B stabilization tests: formula values, classification, sanitation.

These tests use synthetic workbook grids (no business names baked into the
engine) plus a WF-style layout that mirrors the real "WF Test & Shade"
workbook structure, so the behaviour the spec verifies is exercised without
depending on a specific .xlsx file.
"""

from __future__ import annotations

from decimal import Decimal

import pytest

from app.reporting.workbook_formula_eval import build_sheet_formula_evaluator
from app.reporting.workbook_normalization import (
    CLASS_DETAIL,
    CLASS_GRAND_TOTAL,
    CLASS_PREVIOUS_DAY,
    classify_row,
    is_composite_label,
)
from app.reporting.workbook_semantics import extract_workbook_semantics
from tests.workbook_factory import build_sheet, build_workbook

# ---------------------------------------------------------------------------
# Formula evaluator
# ---------------------------------------------------------------------------


def _evaluator_from_grid(grid, formulas):
    sheet = build_sheet(name="S", grid=grid, formulas=formulas)
    cells = {(c["row"], c["column"]): c for c in sheet["cells"]}
    return build_sheet_formula_evaluator(cells)


def test_formula_eval_sum_range():
    grid = {(1, 5): 10, (2, 5): 20, (3, 5): 30}
    formulas = {(4, 5): "=SUM(E1:E3)"}
    ev = _evaluator_from_grid(grid, formulas)
    assert ev.evaluate(4, 5) == Decimal(60)


def test_formula_eval_cell_addition():
    # C1 = E2 + G2 + I2 (mirrors the T/Stock formula shape).
    grid = {(2, 5): 100, (2, 7): 20, (2, 9): 3}
    formulas = {(1, 3): "=E2+G2+I2"}
    ev = _evaluator_from_grid(grid, formulas)
    assert ev.evaluate(1, 3) == Decimal(123)


def test_formula_eval_nested_formula_reference():
    # A grand-total formula that references other formula (subtotal) cells.
    grid = {(1, 5): 5, (2, 5): 7, (4, 5): 11, (5, 5): 13}
    formulas = {
        (3, 5): "=SUM(E1:E2)",  # 12
        (6, 5): "=SUM(E4:E5)",  # 24
        (7, 5): "=E3+E6",  # 36
    }
    ev = _evaluator_from_grid(grid, formulas)
    assert ev.evaluate(7, 5) == Decimal(36)


def test_formula_eval_handles_double_plus_typo():
    # The real workbook contains "=E18+E30++E38" (a stray ++). Python's eval
    # treats ++x as +(+x), so this must still evaluate.
    grid = {(1, 5): 1, (2, 5): 2, (3, 5): 4}
    formulas = {(4, 5): "=E1+E2++E3"}
    ev = _evaluator_from_grid(grid, formulas)
    assert ev.evaluate(4, 5) == Decimal(7)


def test_formula_eval_rejects_unknown_function():
    grid = {(1, 5): 1}
    formulas = {(2, 5): "=VLOOKUP(E1,A:B,2)"}
    ev = _evaluator_from_grid(grid, formulas)
    assert ev.evaluate(2, 5) is None


def test_formula_eval_breaks_cycles():
    formulas = {(1, 5): "=E2", (2, 5): "=E1"}
    ev = _evaluator_from_grid({}, formulas)
    # A cycle must not hang; it yields None (or 0 for the broken leg).
    assert ev.evaluate(1, 5) in {None, Decimal(0)}


# ---------------------------------------------------------------------------
# Row classification taxonomy
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("label", "expected"),
    [
        ("GRAND TOTAL", CLASS_GRAND_TOTAL),
        ("PREVIOUS DAY", CLASS_PREVIOUS_DAY),
        ("Prev Day", CLASS_PREVIOUS_DAY),
        ("ALPHACO", CLASS_DETAIL),
    ],
)
def test_classify_row_from_caption(label, expected):
    assert classify_row(row_label=label, is_rollup=False, is_formula=False) == expected


def test_grand_total_never_classified_as_previous_day():
    assert classify_row(row_label="GRAND TOTAL", is_rollup=True, is_formula=True) == (
        CLASS_GRAND_TOTAL
    )
    assert classify_row(row_label="PREVIOUS DAY", is_rollup=False, is_formula=False) == (
        CLASS_PREVIOUS_DAY
    )


def test_is_composite_label():
    assert is_composite_label("CCL-A / Hugo Boss") is True
    assert is_composite_label("Hugo Boss / H&M") is True
    assert is_composite_label("Hugo Boss") is False
    assert is_composite_label("H&M") is False


# ---------------------------------------------------------------------------
# End-to-end extraction on a WF-style layout
# ---------------------------------------------------------------------------


def _wf_like_workbook():
    """A compact WF-style sheet: a unit block with T/Stock + metric subtotals,
    a Grand Total row, and a Previous Day row — the exact pattern MD07-2B must
    stabilize.

    Layout (columns): B=UNIT, C=T/STOCK, D=BUYER, E=WAIT FOR TEST,
    F=BUYER, G=WAIT FOR SHADE.
    """
    grid: dict[tuple[int, int], object] = {
        (1, 2): "BREAKDOWN OF WAIT FOR TEST AND SHADE",
        (2, 2): "Report Date: 18-MAY-2026",
        (3, 2): "UNIT",
        (3, 3): "T/STOCK",
        (3, 4): "BUYER",
        (3, 5): "WAIT FOR TEST (KG)",
        (3, 6): "BUYER",
        (3, 7): "WAIT FOR SHADE (KG)",
        # U-01 block rows 4-6 (unit merged B4:B6).
        (4, 2): "U-01",
        (4, 4): "ALPHACO",
        (4, 5): 100,
        (4, 6): "ALPHACO",
        (4, 7): 10,
        (5, 4): "BETACO",
        (5, 5): 200,
        (6, 4): "GAMMACO",
        (6, 5): 300,
    }
    # C4 = T/Stock for U-01 = E7 + G7 (subtotals).
    # E7/G7 = SUM of the block.
    formulas = {
        (4, 3): "=E7+G7",  # T/Stock U-01 = 600 + 10 = 610
        (7, 5): "=SUM(E4:E6)",  # wait for test subtotal = 600
        (7, 7): "=SUM(G4:G6)",  # wait for shade subtotal = 10
        # Grand total row 8.
        (8, 3): "=SUM(C4:C7)",  # = 610
        (8, 5): "=E7",  # = 600
        (8, 7): "=G7",  # = 10
    }
    grid[(8, 2)] = "GRAND TOTAL"
    # Previous day row 9.
    grid[(9, 2)] = "PREVIOUS DAY"
    grid[(9, 3)] = 555
    grid[(9, 5)] = 540
    grid[(9, 7)] = 15
    merges = ["B1:G1", "B2:G2", "B4:B6"]
    return build_workbook(
        filename="wf.xlsx",
        sheets=[build_sheet(name="S", grid=grid, merges=merges, formulas=formulas)],
    )


def _active(extraction):
    return [f for f in extraction.facts if f.is_active]


def test_formula_values_persisted_not_text():
    extraction = extract_workbook_semantics(_wf_like_workbook())
    by_cell = {f.source_cell_address: f for f in extraction.facts}
    c4 = by_cell["C4"]
    assert c4.is_formula is True
    assert c4.formula == "=E7+G7"
    # The evaluated numeric value is stored, never the formula text.
    assert c4.value_type == "number"
    assert c4.value_numeric == Decimal(610)


def test_grand_total_and_previous_day_separated():
    extraction = extract_workbook_semantics(_wf_like_workbook())
    by_cell = {f.source_cell_address: f for f in extraction.facts}
    assert by_cell["C8"].row_classification == CLASS_GRAND_TOTAL
    assert by_cell["C8"].value_numeric == Decimal(610)
    assert by_cell["C9"].row_classification == CLASS_PREVIOUS_DAY
    assert by_cell["C9"].value_numeric == Decimal(555)
    # They must never share a classification.
    assert by_cell["C8"].row_classification != by_cell["C9"].row_classification


def test_grand_total_and_previous_day_have_no_leaked_unit():
    extraction = extract_workbook_semantics(_wf_like_workbook())
    by_cell = {f.source_cell_address: f for f in extraction.facts}
    assert by_cell["C8"].unit is None  # not "U-01"
    assert by_cell["C9"].unit is None


def test_tstock_detail_grain_sums_to_grand_total():
    extraction = extract_workbook_semantics(_wf_like_workbook())
    detail_tstock = sum(
        (f.value_numeric or Decimal(0))
        for f in _active(extraction)
        if f.metric_key == "t_stock" and f.row_classification == CLASS_DETAIL
    )
    assert detail_tstock == Decimal(610)


def test_wait_for_test_detail_sums_to_block_total():
    extraction = extract_workbook_semantics(_wf_like_workbook())
    detail_total = sum(
        (f.value_numeric or Decimal(0))
        for f in _active(extraction)
        if f.metric_key == "wait_for_test"
        and f.unit == "U-01"
        and f.row_classification == CLASS_DETAIL
    )
    assert detail_total == Decimal(600)


def test_composite_buyer_marked_inactive():
    grid = {
        (1, 1): "Buyer",
        (1, 2): "Wait For Test",
        (2, 1): "ALPHACO",
        (2, 2): 5,
        (3, 1): "CCL-A / Hugo Boss",  # composite — must be sanitised
        (3, 2): 7,
    }
    extraction = extract_workbook_semantics(
        build_workbook(filename="x.xlsx", sheets=[build_sheet(name="S", grid=grid)])
    )
    # Either the composite buyer was rejected at normalization (buyer None) or
    # the fact was marked inactive; in both cases no active composite remains.
    for fact in extraction.facts:
        if fact.is_active and fact.buyer:
            assert "/" not in fact.buyer


def test_no_composite_buyers_in_active_facts():
    extraction = extract_workbook_semantics(_wf_like_workbook())
    for fact in _active(extraction):
        if fact.buyer:
            assert "/" not in fact.buyer
            assert "|" not in fact.buyer
