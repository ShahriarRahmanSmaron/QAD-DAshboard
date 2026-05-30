"""Normalization tests (MD07-2A): workbook-agnostic, no hardcoded vocabulary."""

from __future__ import annotations

from app.reporting.workbook_normalization import (
    derive_metric_key,
    derive_metric_label,
    header_names_buyer,
    header_names_unit,
    is_rollup_label,
    is_structural_label,
    normalize_buyer,
    normalize_section_label,
    normalize_unit_label,
)


def test_normalize_buyer_rejects_composite_labels():
    assert normalize_buyer("U-01 / ALPHACO / ALPHACO") is None
    assert normalize_buyer("ALPHACO / BETACO") is None
    assert normalize_buyer("ALPHACO | BETACO") is None


def test_normalize_buyer_keeps_single_entities():
    assert normalize_buyer("ALPHACO") == "Alphaco"
    assert normalize_buyer("h&m") == "H&M"  # short code → upper-case
    assert normalize_buyer("  Hugo Boss ") == "Hugo Boss"


def test_normalize_buyer_rejects_structural_labels():
    assert normalize_buyer("Total") is None
    assert normalize_buyer("Grand Total") is None
    assert normalize_buyer("BUYER") is None
    assert normalize_buyer("") is None


def test_normalize_unit_label_forms():
    assert normalize_unit_label("U 01") == "U-01"
    assert normalize_unit_label("HTL-02") == "HTL-02"
    assert normalize_unit_label("CCL A") == "CCL-A"
    assert normalize_unit_label("MTL") == "MTL"
    assert normalize_unit_label("Total") is None


def test_derive_metric_strips_unit_annotations():
    assert derive_metric_label("WAIT FOR TEST\n(KG)") == "Wait For Test"
    assert derive_metric_key("WAIT FOR TEST\n(KG)") == "wait_for_test"
    assert derive_metric_key("Wait For Shade (KG)") == "wait_for_shade"


def test_section_label_cleans_formatting():
    # normalize_section_label collapses whitespace and strips a trailing unit
    # annotation; it does not invent or translate any business vocabulary.
    assert normalize_section_label("  Buyer-wise  Breakdown  ") == "Buyer-wise Breakdown"
    assert normalize_section_label("Hold Status (KG)") == "Hold Status"
    assert normalize_section_label(None) == ""


def test_header_role_detection():
    assert header_names_buyer("Buyer") is True
    assert header_names_buyer("Customer") is True
    assert header_names_buyer("Wait For Test") is False
    assert header_names_unit("Concern Unit") is True
    assert header_names_unit("Unit") is True
    assert header_names_unit("Buyer") is False


def test_structural_and_rollup_labels():
    assert is_structural_label("Total") is True
    assert is_structural_label("ALPHACO") is False
    assert is_rollup_label("Previous Day") is True
    assert is_rollup_label("Grand Total") is True
    assert is_rollup_label("ALPHACO") is False
