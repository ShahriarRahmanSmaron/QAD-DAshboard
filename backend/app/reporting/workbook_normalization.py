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
# Row classification taxonomy (MD07-2B: rollup classification layer)
# ---------------------------------------------------------------------------

# Explicit, mutually-exclusive classifications for an operational fact's row.
# These let aggregation keep Grand Total, Previous Day, and detail values as
# distinct semantic concepts so they can never be mixed.
CLASS_DETAIL = "detail"
CLASS_SUBTOTAL = "subtotal"
CLASS_GRAND_TOTAL = "grand_total"
CLASS_PREVIOUS_DAY = "previous_day"
CLASS_SUMMARY = "summary"

CLASSIFICATION_CHOICES = (
    CLASS_DETAIL,
    CLASS_SUBTOTAL,
    CLASS_GRAND_TOTAL,
    CLASS_PREVIOUS_DAY,
    CLASS_SUMMARY,
)

# Marker phrases that identify each rollup classification from a row/label
# caption. Order matters: ``grand_total`` and ``previous_day`` are checked
# before the generic ``subtotal``/``summary`` so a "Grand Total" row is never
# collapsed into a plain subtotal, and a "Previous Day" row is never treated as
# a grand total. These are structural bookkeeping captions, not business
# vocabulary, so they generalise across operational workbook formats.
_PREVIOUS_DAY_MARKERS: tuple[str, ...] = ("previous day", "prev day", "previous date")
_GRAND_TOTAL_MARKERS: tuple[str, ...] = ("grand total", "grand tot")
_SUBTOTAL_MARKERS: tuple[str, ...] = ("sub total", "subtotal", "section total", "buyer total")
_SUMMARY_MARKERS: tuple[str, ...] = ("running day", "closing", "summary", "total")


def classify_row(
    *,
    row_label: str | None,
    is_rollup: bool,
    is_formula: bool,
) -> str:
    """Classify a fact's row into the rollup taxonomy.

    The label caption is authoritative: a row literally labelled "Grand Total"
    is ``grand_total``; "Previous Day" is ``previous_day``; "Sub Total" /
    "Section Total" is ``subtotal``. A label-less aggregate (a rollup cell with
    no governing caption) is ``summary``. Everything else is a ``detail`` leaf.
    Grand Total and Previous Day are deliberately separated so aggregation never
    mixes them.

    Note (MD08-3A): ``is_formula`` alone does NOT trigger summary classification.
    A formula-based buyer row is a detail fact. Only ``is_rollup`` (which is set
    when the row has no buyer) triggers summary for unlabelled aggregates.
    """
    token = normalize_token(str(row_label)) if row_label else ""
    if token:
        if any(marker in token for marker in _PREVIOUS_DAY_MARKERS):
            return CLASS_PREVIOUS_DAY
        if any(marker in token for marker in _GRAND_TOTAL_MARKERS):
            return CLASS_GRAND_TOTAL
        if any(marker in token for marker in _SUBTOTAL_MARKERS):
            return CLASS_SUBTOTAL
        if any(marker in token for marker in _SUMMARY_MARKERS):
            return CLASS_SUMMARY
    if is_rollup:
        return CLASS_SUMMARY
    return CLASS_DETAIL


def is_composite_label(value: str | None) -> bool:
    """``True`` when a value joins multiple ownership chains (e.g. ``A / B``).

    Public wrapper over the composite-detection rule so the sanitation layer
    can reject legacy composite buyers without re-implementing the heuristic.
    """
    if value is None:
        return False
    return _looks_composite(str(value))


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


# ---------------------------------------------------------------------------
# Report type derivation (MD07-5 Phase 5: dynamic report type registry)
# ---------------------------------------------------------------------------

# Date tokens that appear in workbook filenames (e.g. ``WF-Test-and-shade-19-may``
# or ``WIP-STOCK-23-05-2026``). Stripping these yields the stable report-type
# identity so the same report kind uploaded for different dates collapses to one
# report type. These are structural date captions, not business vocabulary.
_MONTH_NAME_TOKENS: frozenset[str] = frozenset(
    {
        "jan",
        "january",
        "feb",
        "february",
        "mar",
        "march",
        "apr",
        "april",
        "may",
        "jun",
        "june",
        "jul",
        "july",
        "aug",
        "august",
        "sep",
        "sept",
        "september",
        "oct",
        "october",
        "nov",
        "november",
        "dec",
        "december",
    }
)

# Generic suffix words operational filenames append to the report kind. Removing
# them keeps the report-type name focused on the kind itself, e.g.
# ``"WIP Stock Report"`` → ``"WIP Stock"``. Purely structural, not business
# vocabulary.
_REPORT_NAME_NOISE_TOKENS: frozenset[str] = frozenset(
    {
        "report",
        "reports",
        "summary",
        "sheet",
        "workbook",
        "final",
        "copy",
        "updated",
        "new",
        "v",
        "ver",
        "version",
        "rev",
        "draft",
    }
)

_FILE_EXT_RE = re.compile(r"\.[A-Za-z0-9]+$")
_WORD_RE = re.compile(r"[A-Za-z]+")
# Version markers operational filenames append (``v2``, ``rev3``, ``ver10``).
_VERSION_TOKEN_RE = re.compile(r"^(?:v|ver|rev|version)\d+$", re.IGNORECASE)


def _strip_extension(filename: str) -> str:
    return _FILE_EXT_RE.sub("", filename)


def _is_date_token(token: str) -> bool:
    """``True`` when a filename token is a date fragment (day, month, year)."""
    lowered = token.lower()
    if lowered in _MONTH_NAME_TOKENS:
        return True
    if token.isdigit():
        # Day (1-31), month (1-12) or year (e.g. 2026 / 26) fragments.
        return True
    return False


def _is_noise_token(token: str) -> bool:
    """``True`` for generic suffix/version words that aren't part of the kind."""
    lowered = token.lower()
    if lowered in _REPORT_NAME_NOISE_TOKENS:
        return True
    return bool(_VERSION_TOKEN_RE.match(token))


def derive_report_type_name(filename: str | None) -> str | None:
    """Derive a stable, human report-type name from a workbook filename.

    The identity is the report *kind*, independent of the date the workbook
    covers, so ``WF-Test-and-shade-19-may.xlsx`` and
    ``WF-Test-and-shade-20-May.xlsx`` both yield ``"WF Test And Shade"`` and
    ``WIP-STOCK-23-05-2026.xlsx`` yields ``"WIP Stock"``.

    Returns ``None`` when no alphabetic tokens remain (e.g. a purely numeric or
    date-only filename) so the caller can leave the workbook unclassified
    rather than inventing a meaningless report type.
    """
    if not filename:
        return None
    stem = _strip_extension(str(filename))
    # Split on any non-alphanumeric run so ``-``, ``_``, spaces, and ``.`` all
    # act as separators.
    raw_tokens = [tok for tok in re.split(r"[^A-Za-z0-9]+", stem) if tok]
    kept: list[str] = []
    for token in raw_tokens:
        if _is_date_token(token):
            continue
        if _is_noise_token(token):
            continue
        # Drop tokens with no letters (stray numeric fragments not caught above).
        if not _WORD_RE.search(token):
            continue
        kept.append(token)
    if not kept:
        return None
    # Canonicalize: preserve all-caps short acronyms (WF, WIP, RFT, GSM…),
    # title-case longer words. Keeps a stable, readable display name.
    parts = [tok.upper() if len(tok) <= 3 and tok.isupper() else tok.title() for tok in kept]
    return collapse_whitespace(" ".join(parts)) or None


def derive_report_type_code(report_type_name: str | None) -> str | None:
    """Stable upper-snake code for a report type name (e.g. ``WF_TEST_AND_SHADE``).

    Used as the case-insensitive identity key when getting-or-creating the
    ``report_types`` row so the same report kind never spawns duplicates.
    """
    if not report_type_name:
        return None
    token = normalize_token(report_type_name)
    if not token:
        return None
    return token.replace(" ", "_").upper()


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
    if cleaned.upper() == "PD%":
        return "PD%"
    # Preserve all-caps short codes; otherwise Title Case for readability.
    if len(cleaned) <= 4 and cleaned.isupper():
        return cleaned
    return cleaned.title()


def derive_metric_key(header_text: str | None) -> str | None:
    """Stable slug key derived from a workbook column header."""
    if not header_text:
        return None
    cleaned = _clean_header_text(header_text)
    if cleaned.upper() == "PD%":
        return "pd_percent"
    return slugify(cleaned)


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


def is_pd_summary_workbook(workbook_metadata: JsonObject) -> bool:
    """Detect if the workbook metadata corresponds to a PD Summary report."""
    all_text = []
    for sheet in workbook_metadata.get("sheets", []):
        if not isinstance(sheet, dict):
            continue
        for cell in sheet.get("cells", []):
            if not isinstance(cell, dict):
                continue
            val = cell.get("value")
            if val is not None:
                all_text.append(str(val))
    joined = " ".join(all_text).upper()
    return (
        "REPORTING DATE" in joined
        and "RESPONSIBLE DEPARTMENT" in joined
        and "PD QTY(KG)" in joined
        and "PD%" in joined
        and ("OVERALL SUMMARY (SOLID)" in joined or "OVERALL SUMMARY (AOP)" in joined)
    )
