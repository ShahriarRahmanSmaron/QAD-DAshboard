"""MD07-5 Phase 5 — dynamic report type registry tests.

Locks down the deterministic, DB-free building block of the registry: deriving
a stable report-type *name* and *code* from a workbook filename. The identity is
the report *kind*, independent of the date the workbook covers, so the same kind
uploaded across dates collapses to one report type — which is what lets the
platform be self-extending without hardcoded report types.

The DB-backed pieces (``get_or_create_report_type_for_workbook``, the workbook
join in ``list_report_types_with_workbook_counts``, and the
upload/archive/restore/delete lifecycle) are exercised through the API
integration suite; here we keep the workbook-agnostic derivation honest with no
hardcoded business vocabulary.
"""

from __future__ import annotations

from app.reporting.workbook_normalization import (
    derive_report_type_code,
    derive_report_type_name,
)


def test_derive_report_type_name_strips_trailing_day_month():
    # "WF-Test-and-shade-19-may.xlsx" → kind only, date stripped.
    assert derive_report_type_name("WF-Test-and-shade-19-may.xlsx") == "WF Test And Shade"


def test_derive_report_type_name_is_date_invariant():
    # Same kind, different dates and separators → identical report type.
    a = derive_report_type_name("WF-Test-and-shade-19-may.xlsx")
    b = derive_report_type_name("WF-Test-and-shade-20-May.xlsx")
    assert a == b == "WF Test And Shade"


def test_derive_report_type_name_strips_numeric_date_blocks():
    # "WIP-STOCK-23-05-2026.xlsx" → "WIP Stock" (all date fragments removed).
    assert derive_report_type_name("WIP-STOCK-23-05-2026.xlsx") == "WIP Stock"


def test_derive_report_type_name_future_workbook_kind():
    # A brand-new workbook kind classifies with zero code changes.
    assert derive_report_type_name("Subcontract-Status.xlsx") == "Subcontract Status"


def test_derive_report_type_name_drops_noise_words():
    assert derive_report_type_name("WIP Stock Report.xlsx") == "WIP Stock"
    assert derive_report_type_name("Defect Summary final v2.xlsx") == "Defect"


def test_derive_report_type_name_preserves_short_acronyms():
    assert derive_report_type_name("RFT.xlsx") == "RFT"


def test_derive_report_type_name_none_for_dateless_meaningless_names():
    # Purely numeric / date-only filenames yield no classifiable kind.
    assert derive_report_type_name("23-05-2026.xlsx") is None
    assert derive_report_type_name("12345.xlsx") is None
    assert derive_report_type_name("") is None
    assert derive_report_type_name(None) is None


def test_derive_report_type_code_is_stable_upper_snake():
    name = derive_report_type_name("WF-Test-and-shade-19-may.xlsx")
    assert derive_report_type_code(name) == "WF_TEST_AND_SHADE"
    assert derive_report_type_code("WIP Stock") == "WIP_STOCK"


def test_derive_report_type_code_none_when_no_name():
    assert derive_report_type_code(None) is None
    assert derive_report_type_code("") is None


def test_derive_report_type_code_matches_across_date_variants():
    # The code is the identity key for get-or-create; date variants must share it.
    code_a = derive_report_type_code(derive_report_type_name("WIP-STOCK-23-05-2026.xlsx"))
    code_b = derive_report_type_code(derive_report_type_name("WIP-STOCK-24-05-2026.xlsx"))
    assert code_a == code_b == "WIP_STOCK"
