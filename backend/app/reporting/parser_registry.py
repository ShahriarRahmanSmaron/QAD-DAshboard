"""MD-OPQ01: Parser manifest registry — single source of truth.

The manifest is serialized and sent to the frontend via GET /report-types.
No TypeScript mirror. No DB column. No seed script.

To add a new report type:
  1. Add its ParserManifest here
  2. The API automatically delivers it to the frontend
  Done.
"""
from __future__ import annotations

from typing import Literal, TypedDict


DimensionCategory = Literal["business", "time", "system"]


class Dimension(TypedDict):
    key: str            # Query param key  e.g. "buyer", "sub_unit"
    label: str          # Display label    e.g. "Buyer", "Sub Unit"
    type: Literal["select", "date", "text"]
    category: DimensionCategory  # Groups filters in the UI
    visible: bool
    searchable: bool
    groupable: bool     # Appears in the Group By panel
    required: bool      # Future: data-entry form validation
    editable: bool      # Future: data-entry form field
    order: int          # Render order within its category group
    depends_on: str | None  # Cascading: parent dimension key


class MetricMetadata(TypedDict):
    metric_key: str
    aggregation: Literal["sum", "avg", "formula"]
    display_format: Literal["number", "percentage"]
    historical_comparison: bool


METRICS_REGISTRY: dict[str, MetricMetadata] = {
    "pd_percent": {
        "metric_key": "pd_percent",
        "aggregation": "formula",
        "display_format": "percentage",
        "historical_comparison": True
    },
    "pd_qty": {
        "metric_key": "pd_qty",
        "aggregation": "sum",
        "display_format": "number",
        "historical_comparison": True
    },
    "t_stock": {
        "metric_key": "t_stock",
        "aggregation": "sum",
        "display_format": "number",
        "historical_comparison": True
    },
    "wait_for_test": {
        "metric_key": "wait_for_test",
        "aggregation": "sum",
        "display_format": "number",
        "historical_comparison": True
    },
    "wait_for_shade": {
        "metric_key": "wait_for_shade",
        "aggregation": "sum",
        "display_format": "number",
        "historical_comparison": True
    },
    "wait_for_rfd": {
        "metric_key": "wait_for_rfd",
        "aggregation": "sum",
        "display_format": "number",
        "historical_comparison": True
    },
}


class DashboardManifest(TypedDict):
    primary_metrics: list[str]
    dimensions: list[str]
    default_group_by: str
    enable_historical: bool
    enable_diagnostics: bool
    sections: list[str]


class ParserManifest(TypedDict):
    parser_code: str
    display_name: str
    dimensions: list[Dimension]
    default_grouping: list[str]   # Multi-level, e.g. ["unit", "sub_unit"]
    hidden_dimensions: list[str]
    dashboard: DashboardManifest | None


def _dim(
    key: str,
    label: str,
    *,
    type: Literal["select", "date", "text"] = "select",
    category: DimensionCategory = "business",
    visible: bool = True,
    searchable: bool = True,
    groupable: bool = False,
    required: bool = False,
    editable: bool = False,
    order: int = 99,
    depends_on: str | None = None,
) -> Dimension:
    return Dimension(
        key=key, label=label, type=type, category=category,
        visible=visible, searchable=searchable, groupable=groupable,
        required=required, editable=editable, order=order, depends_on=depends_on,
    )


# ---------------------------------------------------------------------------
# Manifests
# ---------------------------------------------------------------------------

WF_TEST_AND_SHADE: ParserManifest = {
    "parser_code": "wf_test_and_shade",
    "display_name": "WF Test & Shade",
    "dimensions": [
        _dim("buyer",   "Buyer",   groupable=True, order=1),
        _dim("unit",    "Unit",    groupable=True, order=2),
        _dim("metric",  "Metric",  groupable=True, order=3),
        _dim("section", "Section", groupable=True, order=4),
    ],
    "default_grouping": ["buyer"],
    "hidden_dimensions": [],
    "dashboard": {
        "primary_metrics": ["t_stock", "wait_for_test", "wait_for_shade", "wait_for_rfd"],
        "dimensions": ["unit", "buyer"],
        "default_group_by": "unit",
        "enable_historical": True,
        "enable_diagnostics": True,
        "sections": [
            "executive_summary",
            "historical_comparison",
            "unit_historical_comparison",
            "unit_analysis",
            "buyer_analysis",
            "diagnostics"
        ]
    }
}

PD_SUMMARY: ParserManifest = {
    "parser_code": "pd_summary",
    "display_name": "PD Summary",
    "dimensions": [
        _dim("section",    "Section",    groupable=True, order=1),
        _dim("unit",       "Unit",       groupable=True, order=2),
        _dim("sub_unit",   "Sub Unit",   groupable=True, order=3, depends_on="unit"),
        _dim("department", "Department", groupable=True, order=4),
        _dim("metric",     "Metric",     groupable=True, order=5),
    ],
    "default_grouping": ["unit", "sub_unit"],
    "hidden_dimensions": [],
    "dashboard": {
        "primary_metrics": ["pd_qty", "pd_percent"],
        "dimensions": ["unit", "sub_unit", "department"],
        "default_group_by": "sub_unit",
        "enable_historical": True,
        "enable_diagnostics": True,
        "sections": [
            "executive_summary",
            "top_movers",
            "historical_comparison",
            "unit_analysis",
            "sub_unit_analysis",
            "department_analysis",
            "diagnostics"
        ]
    }
}

# ---------------------------------------------------------------------------
# Registry — only file to touch when adding a new report type
# ---------------------------------------------------------------------------

PARSER_REGISTRY: dict[str, ParserManifest] = {
    "wf_test_and_shade": WF_TEST_AND_SHADE,
    "pd_summary":        PD_SUMMARY,
}


def get_manifest(parser_code: str) -> ParserManifest | None:
    return PARSER_REGISTRY.get(parser_code.lower())
