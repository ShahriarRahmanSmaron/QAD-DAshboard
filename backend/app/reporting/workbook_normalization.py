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
# Structural label vocabulary (workbook-agnostic)
# ---------------------------------------------------------------------------

# These tokens describe *structural* labels that appear in operational
# workbooks regardless of the business domain — header captions, total/summary
# markers, and bookkeeping columns. They are intentionally NOT business values
# (no buyer names, no unit names, no metric names). They let the engine reject
# obvious non-entity text (e.g. a literal ``TOTAL`` cell or a ``BUYER`` header
# leaking into a data row) without encoding any specific workbook's vocabulary.
_STRUCTURAL_LABEL_TOKENS: frozenset[str] = frozenset(
    {
        "",
        "total",
        "totals",
        "grand total",
        "sub total",
        "subtotal",
        "sum",
        "summary",
        "buyer",
        "buyers",
        "unit",
        "units",
        "qty",
        "quantity",
        "remarks",
        "remark",
        "date",
        "report date",
        "no",
        "sl",
        "sl no",
        "serial",
        "n a",
        "na",
        "nil",
        "none",
    }
)

# Markers that indicate a row/label is a rollup or aggregate rather than an
# entity. Detected as substrings of the normalized token.
_ROLLUP_MARKERS: tuple[str, ...] = (
    "total",
    "grand total",
    "sub total",
    "subtotal",
    "previous day",
    "running day",
    "closing",
    "summary",
)


def is_structural_label(value: str | None) -> bool:
    """``True`` when text is a structural caption/total, not a business entity."""
    if value is None:
        return False
    token = normalize_token(str(value))
    if token in _STRUCTURAL_LABEL_TOKENS:
        return True
    return any(marker in token for marker in _ROLLUP_MARKERS)


def is_rollup_label(value: str | None) -> bool:
    """``True`` when text marks an aggregate/rollup row (total, previous day…)."""
    if value is None:
        return False
    token = normalize_token(str(value))
    return any(marker in token for marker in _ROLLUP_MARKERS)


# ---------------------------------------------------------------------------
# Header role detection (column-role captions, not business values)
# ---------------------------------------------------------------------------

# Header captions that name a column's *role* as the buyer dimension or the
# unit/grouping dimension. These are generic role words that operational
# workbooks use to label their dimension columns. Matching a header against
# these is a header-relationship signal — it never matches a business value,
# only the caption a workbook author wrote to describe the column.
_BUYER_HEADER_TOKENS: tuple[str, ...] = ("buyer", "customer", "client", "brand")
_UNIT_HEADER_TOKENS: tuple[str, ...] = (
    "unit",
    "concern unit",
    "factory",
    "plant",
    "line",
    "block",
)


def header_names_buyer(header_text: str | None) -> bool:
    """``True`` when a column header captions a buyer/entity dimension."""
    if not header_text:
        return False
    token = normalize_token(str(header_text))
    if not token:
        return False
    return any(
        marker == token or f" {marker} " in f" {token} " for marker in _BUYER_HEADER_TOKENS
    )


def header_names_unit(header_text: str | None) -> bool:
    """``True`` when a column header captions a unit/grouping dimension."""
    if not header_text:
        return False
    token = normalize_token(str(header_text))
    if not token:
        return False
    return any(
        marker == token or f" {marker} " in f" {token} " for marker in _UNIT_HEADER_TOKENS
    )


def normalize_buyer(value: str | None) -> str | None:
    """Return a clean buyer entity name, or ``None`` if the value is ineligible.

    The canonical form is derived purely from the source text — no business
    name dictionary is consulted, so this works for any workbook. Composite
    labels (e.g. a cell that accidentally joined two columns with a separator)
    are rejected rather than concatenated.
    """
    if value is None:
        return None
    cleaned = collapse_whitespace(str(value).strip(" :-\n\t"))
    if not cleaned or len(cleaned) > 64:
        return None
    token = normalize_token(cleaned)
    if not token or is_structural_label(cleaned):
        return None
    # Reject composite labels: a buyer cell should describe a single entity.
    # Separators like ``/`` or `` - `` joining multiple words signal that two
    # ownership sources were merged, which must not become one buyer identity.
    if _looks_composite(cleaned):
        return None
    # Default canonical form: upper-case for short codes (≤4 chars), title
    # case otherwise. This stays stable across reuploads.
    return cleaned.upper() if len(cleaned) <= 4 else cleaned.title()


def _looks_composite(value: str) -> bool:
    """Detect labels that concatenate multiple ownership sources."""
    # A slash or pipe separating non-trivial fragments → composite.
    for separator in ("/", "|", "\\"):
        if separator in value:
            fragments = [frag.strip() for frag in value.split(separator) if frag.strip()]
            if len(fragments) >= 2:
                return True
    return False


# ---------------------------------------------------------------------------
# Unit normalization
# ---------------------------------------------------------------------------

# A unit/grouping label is a compact block identifier. The grouping column
# (detected via merge geometry or repeating-block structure) establishes that a
# value *is* a unit, so normalization only canonicalizes the form and rejects
# obvious non-entities — it does not gate on a fixed list of unit codes.
_UNIT_NUMERIC_SUFFIX_RE = re.compile(r"^(?P<prefix>[A-Za-z]{1,8})[\s\-_]+(?P<number>\d{1,3})$")
_UNIT_ALNUM_SUFFIX_RE = re.compile(
    r"^(?P<prefix>[A-Za-z]{1,8})[\s\-_]+(?P<suffix>[A-Za-z0-9]{1,4})$"
)


def normalize_unit_label(value: str | None) -> str | None:
    """Canonicalize a grouping-column label into a stable unit identifier.

    Handles numeric suffixes (``HTL 02`` → ``HTL-02``) and alphanumeric
    suffixes (``CCL A`` → ``CCL-A``) as well as bare codes (``MTL`` → ``MTL``).
    Returns ``None`` for structural captions / rollup markers or values too
    long to be a block code.
    """
    if value is None:
        return None
    text = collapse_whitespace(str(value).strip(" :-\n\t"))
    if not text or is_structural_label(text):
        return None
    if len(text) > 32:
        return None
    numeric = _UNIT_NUMERIC_SUFFIX_RE.match(text)
    if numeric:
        return f"{numeric.group('prefix').upper()}-{int(numeric.group('number')):02d}"
    alnum = _UNIT_ALNUM_SUFFIX_RE.match(text)
    if alnum:
        return f"{alnum.group('prefix').upper()}-{alnum.group('suffix').upper()}"
    return text.upper()


def normalize_unit(value: str | None) -> str | None:
    """Backward-compatible unit search: find a ``PREFIX-NN`` code in free text.

    Retained for callers that scan arbitrary text. Prefer
    :func:`normalize_unit_label` when the value is known to come from a
    grouping/unit column.
    """
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    match = re.search(
        r"\b(?P<prefix>[A-Z]{2,6})[\s\-_]?(?P<number>\d{1,3})\b",
        text.upper(),
    )
    if not match:
        return None
    prefix = match.group("prefix").upper()
    number = int(match.group("number"))
    return f"{prefix}-{number:02d}"


# ---------------------------------------------------------------------------
# Metric / section normalization (derived from workbook headers, not a table)
# ---------------------------------------------------------------------------

# Newlines and unit-of-measure annotations frequently appear in operational
# headers, e.g. ``"WAIT FOR TEST\n(KG)"``. We strip a trailing parenthetical
# annotation and collapse whitespace so the same column header produces a
# stable metric label/key regardless of formatting noise — without encoding
# any specific metric name.
_TRAILING_PAREN_RE = re.compile(r"\s*\([^)]*\)\s*$")


def _clean_header_text(value: str) -> str:
    text = collapse_whitespace(str(value).replace("\n", " ").replace("\r", " "))
    # Strip one trailing parenthetical unit annotation, e.g. "(KG)".
    previous = None
    while previous != text:
        previous = text
        text = _TRAILING_PAREN_RE.sub("", text).strip()
    return text.strip(" :-")


def derive_metric_label(header_text: str | None) -> str:
    """Title-case label derived from a workbook column header."""
    if not header_text:
        return "Unmapped"
    cleaned = _clean_header_text(header_text)
    if not cleaned:
        return "Unmapped"
    # Preserve all-caps short codes; otherwise Title Case for readability.
    if len(cleaned) <= 4 and cleaned.isupper():
        return cleaned
    return cleaned.title()


def derive_metric_key(header_text: str | None) -> str | None:
    """Stable slug key derived from a workbook column header."""
    if not header_text:
        return None
    return slugify(_clean_header_text(header_text))


def normalize_section_label(value: str | None) -> str:
    """Clean a section banner/title into a stable display label."""
    if value is None:
        return ""
    return _clean_header_text(value)


def canonical_metric_label(metric_key: str | None) -> str:
    """Best-effort human label for a metric key when no header is available."""
    if not metric_key:
        return "Unmapped"
    return metric_key.replace("_", " ").title()


def canonical_section_label(section_key: str | None) -> str:
    if not section_key:
        return "Unmapped"
    return section_key.replace("_", " ").title()


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
        "unit": normalize_unit_label(unit) or normalize_unit(unit),
        "metric_key": metric_key or "unmapped",
        "metric_label": canonical_metric_label(metric_key),
        "operational_section": section_key or "unmapped",
        "operational_section_label": canonical_section_label(section_key),
        "report_date": normalize_report_date(report_date),
    }
