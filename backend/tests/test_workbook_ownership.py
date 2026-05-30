"""Structure-aware ownership resolution tests (MD07-2A).

Each test builds a synthetic workbook grid that exercises one structural
pattern from the spec. No business names, unit names, section names, or metric
names are special-cased in the engine — the tests use arbitrary values to
prove the engine derives ownership from structure alone.
"""

from __future__ import annotations

from decimal import Decimal

from app.reporting.workbook_semantics import extract_workbook_semantics
from tests.workbook_factory import build_sheet, build_workbook


def _facts_by_cell(extraction):
    return {fact.source_cell_address: fact for fact in extraction.facts}


def _leaf_total(extraction, *, buyer=None, unit=None, metric_contains=None):
    total = Decimal(0)
    for fact in extraction.facts:
        if fact.metadata.get("ownership", {}).get("is_rollup"):
            continue
        if buyer is not None and (fact.buyer or "").lower() != buyer.lower():
            continue
        if unit is not None and (fact.unit or "").lower() != unit.lower():
            continue
        if metric_contains is not None and metric_contains.lower() not in fact.metric_label.lower():
            continue
        if fact.value_numeric is not None:
            total += fact.value_numeric
    return total


def _wf_grid():
    """A WF-style layout: merged unit blocks + repeating BUYER/metric pairs.

    Row 1: section banner (merged).
    Row 2: header — UNIT | T/STOCK | BUYER | WAIT FOR TEST | BUYER | WAIT FOR SHADE
    Rows 3-5: unit U-01 block; Rows 6-7: unit U-02 block (merged in col B).
    """
    grid: dict[tuple[int, int], object] = {
        (1, 2): "DEMO SECTION ALPHA",
        (2, 2): "Report Date: 21-MAY-2026",
        (3, 2): "UNIT",
        (3, 3): "T/STOCK",
        (3, 4): "BUYER",
        (3, 5): "WAIT FOR TEST (KG)",
        (3, 6): "BUYER",
        (3, 7): "WAIT FOR SHADE (KG)",
        # U-01 block (rows 4-6), unit label only at top (merged B4:B6).
        (4, 2): "U-01",
        (4, 4): "ALPHACO",
        (4, 5): 6,
        (5, 4): "BETACO",
        (5, 5): 10,
        (5, 6): "ALPHACO",
        (5, 7): 12,
        (6, 4): "GAMMACO",
        (6, 5): 9,
        # U-02 block (rows 7-8), merged B7:B8.
        (7, 2): "U-02",
        (7, 4): "ALPHACO",
        (7, 5): 7,
        (8, 4): "BETACO",
        (8, 5): 8,
        (8, 6): "ALPHACO",
        (8, 7): 3,
    }
    merges = ["B1:G1", "B2:G2", "B4:B6", "B7:B8"]
    return grid, merges


def test_buyer_and_metric_from_positional_header_pairs():
    grid, merges = _wf_grid()
    sheet = build_sheet(name="S", grid=grid, merges=merges)
    extraction = extract_workbook_semantics(build_workbook(filename="x.xlsx", sheets=[sheet]))
    cells = _facts_by_cell(extraction)

    # E4 sits under the first BUYER/WAIT FOR TEST pair, governed by D4.
    e_first = cells["E4"]
    assert e_first.buyer == "Alphaco"
    assert e_first.unit == "U-01"
    assert e_first.metric_label == "Wait For Test"
    assert e_first.value_numeric == Decimal(6)

    # G5 sits under the second BUYER/WAIT FOR SHADE pair, governed by F5.
    g_second = cells["G5"]
    assert g_second.buyer == "Alphaco"
    assert g_second.metric_label == "Wait For Shade"
    assert g_second.value_numeric == Decimal(12)


def test_no_composite_buyer_labels():
    grid, merges = _wf_grid()
    sheet = build_sheet(name="S", grid=grid, merges=merges)
    extraction = extract_workbook_semantics(build_workbook(filename="x.xlsx", sheets=[sheet]))
    for fact in extraction.facts:
        if fact.buyer:
            assert "/" not in fact.buyer
            assert "|" not in fact.buyer


def test_unit_never_classified_as_buyer():
    grid, merges = _wf_grid()
    sheet = build_sheet(name="S", grid=grid, merges=merges)
    extraction = extract_workbook_semantics(build_workbook(filename="x.xlsx", sheets=[sheet]))
    units = {fact.unit for fact in extraction.facts if fact.unit}
    buyers = {fact.buyer for fact in extraction.facts if fact.buyer}
    assert units.isdisjoint(buyers)
    assert "U-01" not in buyers
    assert "U-02" not in buyers


def test_merged_unit_block_inheritance():
    grid, merges = _wf_grid()
    sheet = build_sheet(name="S", grid=grid, merges=merges)
    extraction = extract_workbook_semantics(build_workbook(filename="x.xlsx", sheets=[sheet]))
    cells = _facts_by_cell(extraction)
    # Rows 5-6 have no own unit cell; they inherit U-01 from the merged block.
    assert cells["E5"].unit == "U-01"
    assert cells["E6"].unit == "U-01"
    assert cells["E5"].metadata["ownership"]["unit_source"] == "merged_inheritance"


def test_shade_and_test_values_do_not_mix():
    grid, merges = _wf_grid()
    sheet = build_sheet(name="S", grid=grid, merges=merges)
    extraction = extract_workbook_semantics(build_workbook(filename="x.xlsx", sheets=[sheet]))
    # ALPHACO test values: E3 (6) + E6 (7) = 13; shade values: G4 (12) + G7 (3) = 15.
    assert _leaf_total(extraction, buyer="Alphaco", metric_contains="Wait For Test") == Decimal(13)
    assert _leaf_total(extraction, buyer="Alphaco", metric_contains="Wait For Shade") == Decimal(15)


def test_unit_scoped_metric_total():
    grid, merges = _wf_grid()
    sheet = build_sheet(name="S", grid=grid, merges=merges)
    extraction = extract_workbook_semantics(build_workbook(filename="x.xlsx", sheets=[sheet]))
    # U-01 Wait For Test = 6 + 10 + 9 = 25.
    assert _leaf_total(extraction, unit="U-01", metric_contains="Wait For Test") == Decimal(25)


def test_section_label_from_merged_banner():
    grid, merges = _wf_grid()
    sheet = build_sheet(name="S", grid=grid, merges=merges)
    extraction = extract_workbook_semantics(build_workbook(filename="x.xlsx", sheets=[sheet]))
    sections = {fact.operational_section_label for fact in extraction.facts}
    # The banner's own casing is preserved (no business vocabulary imposed).
    assert "DEMO SECTION ALPHA" in sections


def test_named_header_columns_override_positional():
    """Header relationships: a 'Buyer' column far from the value still governs."""
    grid = {
        (1, 1): "Factory",
        (1, 2): "Concern Unit",
        (1, 3): "Buyer",
        (1, 4): "Dyeing Qty",
        (2, 1): "PLANT-X",
        (2, 2): "U-09",
        (2, 3): "ALPHACO",
        (2, 4): 100,
        (3, 1): "PLANT-X",
        (3, 2): "U-09",
        (3, 3): "BETACO",
        (3, 4): 200,
    }
    sheet = build_sheet(name="S", grid=grid)
    extraction = extract_workbook_semantics(build_workbook(filename="x.xlsx", sheets=[sheet]))
    cells = _facts_by_cell(extraction)
    d2 = cells["D4" if "D4" in cells else "D2"]
    assert d2.metric_label == "Dyeing Qty"
    assert d2.buyer == "Alphaco"
    assert d2.unit == "U-09"
    assert d2.metadata["ownership"]["buyer_source"] == "column_header"
    assert d2.metadata["ownership"]["unit_source"] in {"grouping_block", "merged_inheritance"}


def test_formula_rows_flagged_as_rollups():
    grid = {
        (1, 2): "UNIT",
        (1, 3): "BUYER",
        (1, 4): "WAIT FOR TEST",
        (2, 2): "U-01",
        (2, 3): "ALPHACO",
        (2, 4): 5,
        (3, 2): "U-01",
        (3, 3): "BETACO",
        (3, 4): 7,
    }
    formulas = {(4, 4): "=SUM(D2:D3)"}
    sheet = build_sheet(name="S", grid=grid, formulas=formulas)
    extraction = extract_workbook_semantics(build_workbook(filename="x.xlsx", sheets=[sheet]))
    cells = _facts_by_cell(extraction)
    assert cells["D4"].is_formula is True
    assert cells["D4"].metadata["ownership"]["is_rollup"] is True
    # The rollup must not be counted as a leaf fact.
    assert _leaf_total(extraction, metric_contains="Wait For Test") == Decimal(12)


def test_trust_targets_met_on_clean_workbook():
    grid, merges = _wf_grid()
    sheet = build_sheet(name="S", grid=grid, merges=merges)
    extraction = extract_workbook_semantics(build_workbook(filename="x.xlsx", sheets=[sheet]))
    diagnostics = extraction.semantic_mapping["diagnostics"]
    counts = diagnostics["confidence_counts"]
    total = sum(counts.values())
    assert total > 0
    explicit_share = counts.get("explicit", 0) / total
    ambiguous_share = counts.get("ambiguous", 0) / total
    unmapped_share = counts.get("unmapped", 0) / total
    assert explicit_share >= 0.80
    assert ambiguous_share < 0.05
    assert unmapped_share < 0.05
    assert diagnostics["trust_ratio"] >= 0.95
