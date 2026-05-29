"""Semantic normalization utilities for the operational workbook layer.

MD07-0 introduces a stabilization pass on workbook semantic extraction. This
module centralizes the normalization rules used while building
``OperationalFact`` records so the same canonical naming applies everywhere
the engine inspects workbook content.

The functions here are intentionally pure and side-effect free so they can be
re-used from the extraction engine, the diagnostics engine, and any later
historical-aggregation work without coupling them to SQLAlchemy or FastAPI.
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date, datetime

JsonObject = dict[str, object]

# ---------------------------------------------------------------------------
# Whitespace / casing helpers
# ---------------------------------------------------------------------------

_WS_RE = re.compile(r"\s+")
_NON_ALNUM_RE = re.compile(r"[^a-z0-9]+")


def collapse_whitespace(value: str) -> str:
    """Collapse internal whitespace and strip surrounding spaces."""
    return _WS_RE.sub(" ", value).strip()


def normalize_token(value: str) -> str:
    """Lower-case, alphanumeric-only key suitable for fuzzy comparisons."""
    return _NON_ALNUM_RE.sub(" ", value.lower()).strip()


def slugify(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = normalize_token(value)
    if not normalized:
        return None
    return normalized.replace(" ", "_")


# ---------------------------------------------------------------------------
# Buyer normalization
# ---------------------------------------------------------------------------

# Known buyer aliases observed in WF Test/Shade workbooks. The list is small
# on purpose — we want repeatable canonicalization without requiring a full
# directory lookup. Anything missing falls back to a cleaned, title-cased
# version of the source text.
_BUYER_CANONICAL: dict[str, str] = {
    "next": "NEXT",
    "next sourcing": "NEXT",
    "h&m": "H&M",
    "hnm": "H&M",
    "h and m": "H&M",
    "primark": "PRIMARK",
    "zara": "ZARA",
    "inditex": "ZARA",
    "marks and spencer": "M&S",
    "m&s": "M&S",
    "ms": "M&S",
    "tesco": "TESCO",
    "asda": "ASDA",
    "lidl": "LIDL",
    "aldi": "ALDI",
    "walmart": "WALMART",
    "uniqlo": "UNIQLO",
    "decathlon": "DECATHLON",
    "c&a": "C&A",
    "ca": "C&A",
    "kiabi": "KIABI",
    "lc waikiki": "LC WAIKIKI",
    "lcw": "LC WAIKIKI",
}

_BUYER_BLOCKLIST: frozenset[str] = frozenset(
    {
        "",
        "total",
        "grand total",
        "subtotal",
        "summary",
        "buyer",
        "unit",
        "qty",
        "quantity",
        "remarks",
        "date",
        "no",
        "sl",
        "sl no",
        "n/a",
        "na",
    }
)


def normalize_buyer(value: str | None) -> str | None:
    """Return a canonical buyer name, or ``None`` if the value is ineligible."""
    if value is None:
        return None
    cleaned = collapse_whitespace(str(value).strip(" :-"))
    if not cleaned or len(cleaned) > 64:
        return None
    token = normalize_token(cleaned)
    if not token or token in _BUYER_BLOCKLIST or "total" in token:
        return None
    canonical = _BUYER_CANONICAL.get(token)
    if canonical:
        return canonical
    # Default canonical form: upper-case for short codes (≤4 chars), title
    # case otherwise. This stays stable across reuploads.
    return cleaned.upper() if len(cleaned) <= 4 else cleaned.title()


# ---------------------------------------------------------------------------
# Unit normalization
# ---------------------------------------------------------------------------

_UNIT_PATTERN = re.compile(
    r"\b(?P<prefix>[A-Z]{2,6})[\s\-_]?(?P<number>\d{1,3})\b",
    re.IGNORECASE,
)


def normalize_unit(value: str | None) -> str | None:
    """Map a free-form unit reference to ``PREFIX-NN`` (e.g. ``HTL-02``)."""
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    match = _UNIT_PATTERN.search(text.upper())
    if not match:
        return None
    prefix = match.group("prefix").upper()
    number = int(match.group("number"))
    return f"{prefix}-{number:02d}"


# ---------------------------------------------------------------------------
# Metric / section normalization
# ---------------------------------------------------------------------------

# These keys mirror ``SECTION_DEFINITIONS`` in workbook_semantics so they stay
# in sync. The mapping intentionally uses short, stable identifiers.
_METRIC_LABEL: dict[str, str] = {
    "wait_for_test": "Wait For Test",
    "wait_for_rfd": "Wait for RFD",
    "shade_test": "Shade/Test",
    "t_stock": "T/Stock",
    "hold": "Hold",
    "closing_summary": "Closing Summary",
    "previous_day": "Previous Day",
    "grand_total": "Grand Total",
    "buyer_wise_breakdown": "Buyer-wise breakdown",
    "unit_wise_totals": "Unit-wise totals",
    "unit": "Unit",
    "operational_block": "Operational Block",
}


def canonical_metric_label(metric_key: str | None) -> str:
    if not metric_key:
        return "Unmapped"
    return _METRIC_LABEL.get(metric_key, metric_key.replace("_", " ").title())


def canonical_section_label(section_key: str | None) -> str:
    return canonical_metric_label(section_key)


# ---------------------------------------------------------------------------
# Operational date normalization
# ---------------------------------------------------------------------------


def normalize_report_date(value: object) -> date | None:
    """Coerce datetimes/dates/ISO strings into ``date`` objects."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        try:
            return date.fromisoformat(text)
        except ValueError:
            return None
    return None


# ---------------------------------------------------------------------------
# Confidence tracking
# ---------------------------------------------------------------------------

CONFIDENCE_EXPLICIT = "explicit"
CONFIDENCE_INFERRED = "inferred"
CONFIDENCE_AMBIGUOUS = "ambiguous"
CONFIDENCE_UNMAPPED = "unmapped"

CONFIDENCE_CHOICES = (
    CONFIDENCE_EXPLICIT,
    CONFIDENCE_INFERRED,
    CONFIDENCE_AMBIGUOUS,
    CONFIDENCE_UNMAPPED,
)


@dataclass(frozen=True)
class MappingConfidence:
    """Per-fact metadata describing how the mapping was derived."""

    overall: str
    buyer: str
    unit: str
    metric: str
    section: str
    report_date: str
    reasons: tuple[str, ...] = ()

    def to_json(self) -> JsonObject:
        return {
            "overall": self.overall,
            "buyer": self.buyer,
            "unit": self.unit,
            "metric": self.metric,
            "section": self.section,
            "report_date": self.report_date,
            "reasons": list(self.reasons),
        }


def aggregate_confidence(parts: Iterable[str]) -> str:
    """Reduce a set of dimension confidences to an overall fact confidence.

    Rules (lowest-trust wins):

    * any ``ambiguous`` → ``ambiguous``
    * any ``unmapped`` → ``ambiguous`` (an ambiguous mapping at this level)
    * any ``inferred`` → ``inferred``
    * everything ``explicit`` → ``explicit``
    """
    seen = set(parts)
    if CONFIDENCE_AMBIGUOUS in seen or CONFIDENCE_UNMAPPED in seen:
        return CONFIDENCE_AMBIGUOUS
    if CONFIDENCE_INFERRED in seen:
        return CONFIDENCE_INFERRED
    return CONFIDENCE_EXPLICIT


def confidence_for_value(
    *,
    value: str | date | None,
    explicit_match: bool,
    blocked: bool = False,
) -> str:
    """Map a single dimension to a confidence band.

    ``explicit_match`` is ``True`` when the value came from an unambiguous
    label (e.g. a row literally labelled ``BUYER`` or a unit code like
    ``HTL-02``). Otherwise the value is treated as inferred.
    """
    if blocked:
        return CONFIDENCE_AMBIGUOUS
    if value is None:
        return CONFIDENCE_UNMAPPED
    return CONFIDENCE_EXPLICIT if explicit_match else CONFIDENCE_INFERRED


# ---------------------------------------------------------------------------
# Composite helpers
# ---------------------------------------------------------------------------


def normalize_fact_dimensions(
    *,
    buyer: str | None,
    unit: str | None,
    metric_key: str | None,
    section_key: str | None,
    report_date: object,
) -> JsonObject:
    """Apply all normalization rules to a fact's dimension tuple."""
    return {
        "buyer": normalize_buyer(buyer),
        "unit": normalize_unit(unit),
        "metric_key": metric_key or "operational_block",
        "metric_label": canonical_metric_label(metric_key),
        "operational_section": section_key or "operational_block",
        "operational_section_label": canonical_section_label(section_key),
        "report_date": normalize_report_date(report_date),
    }
