"""Semantic extraction diagnostics for the operational workbook layer.

MD07-0 requires the workbook semantic layer to surface lightweight
diagnostics so trust in operational facts can be verified before historical
querying expands. The classes here describe the diagnostics shape and the
function below builds a diagnostics report from a ``SemanticExtraction``.

Only data already produced by the extraction engine is consumed — no
additional workbook parsing happens here, which keeps the diagnostics layer
cheap to compute on every upload.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

from app.reporting.workbook_normalization import (
    CONFIDENCE_AMBIGUOUS,
    CONFIDENCE_EXPLICIT,
    CONFIDENCE_INFERRED,
    CONFIDENCE_UNMAPPED,
)

if TYPE_CHECKING:  # pragma: no cover - typing only
    from app.reporting.workbook_semantics import SemanticExtraction, SemanticFact


JsonObject = dict[str, object]


SEVERITY_INFO = "info"
SEVERITY_WARNING = "warning"
SEVERITY_ERROR = "error"


@dataclass(frozen=True)
class SemanticIssue:
    code: str
    severity: str
    message: str
    sheet_name: str | None = None
    cell_address: str | None = None
    metric_key: str | None = None
    operational_section: str | None = None
    occurrences: int = 1
    metadata: JsonObject = field(default_factory=dict)

    def to_json(self) -> JsonObject:
        return {
            "code": self.code,
            "severity": self.severity,
            "message": self.message,
            "sheet_name": self.sheet_name,
            "cell_address": self.cell_address,
            "metric_key": self.metric_key,
            "operational_section": self.operational_section,
            "occurrences": self.occurrences,
            "metadata": dict(self.metadata),
        }


@dataclass(frozen=True)
class SemanticDiagnostics:
    fact_count: int
    confidence_counts: dict[str, int]
    sheets_with_facts: int
    sheets_without_facts: list[str]
    unmapped_regions: list[JsonObject]
    ambiguous_rows: list[JsonObject]
    duplicate_facts: list[JsonObject]
    orphan_cells: list[JsonObject]
    missing_workbook_references: list[JsonObject]
    ownership_conflicts: list[JsonObject]
    ownership_sources: dict[str, dict[str, int]]
    trust_ratio: float
    issues: list[SemanticIssue]
    health: str

    def to_json(self) -> JsonObject:
        return {
            "fact_count": self.fact_count,
            "confidence_counts": dict(self.confidence_counts),
            "sheets_with_facts": self.sheets_with_facts,
            "sheets_without_facts": list(self.sheets_without_facts),
            "unmapped_regions": list(self.unmapped_regions),
            "ambiguous_rows": list(self.ambiguous_rows),
            "duplicate_facts": list(self.duplicate_facts),
            "orphan_cells": list(self.orphan_cells),
            "missing_workbook_references": list(self.missing_workbook_references),
            "ownership_conflicts": list(self.ownership_conflicts),
            "ownership_sources": {
                dimension: dict(counts)
                for dimension, counts in self.ownership_sources.items()
            },
            "trust_ratio": self.trust_ratio,
            "issues": [issue.to_json() for issue in self.issues],
            "health": self.health,
        }


def _confidence_counts(facts: list[SemanticFact]) -> dict[str, int]:
    counts: Counter[str] = Counter()
    for fact in facts:
        confidence = (
            fact.metadata.get("mapping_confidence", {})
            if isinstance(fact.metadata, dict)
            else {}
        )
        overall = (
            confidence.get("overall")
            if isinstance(confidence, dict)
            else None
        )
        counts[str(overall) if overall else CONFIDENCE_UNMAPPED] += 1
    # Always include the four buckets even when zero so the UI doesn't have to
    # special-case missing keys.
    for bucket in (
        CONFIDENCE_EXPLICIT,
        CONFIDENCE_INFERRED,
        CONFIDENCE_AMBIGUOUS,
        CONFIDENCE_UNMAPPED,
    ):
        counts.setdefault(bucket, 0)
    return dict(counts)


def _detect_unmapped_regions(
    workbook_metadata: JsonObject,
    extraction: SemanticExtraction,
) -> list[JsonObject]:
    """Workbook regions that the engine did not map to a semantic section."""
    mapped_region_ids = {
        region.source_region_id
        for region in extraction.regions
        if region.source_region_id
    }
    unmapped: list[JsonObject] = []
    sheets = workbook_metadata.get("sheets")
    if not isinstance(sheets, list):
        return unmapped
    for sheet in sheets:
        if not isinstance(sheet, dict):
            continue
        sheet_name = sheet.get("name")
        regions = sheet.get("regions")
        if not isinstance(regions, list):
            continue
        for region in regions:
            if not isinstance(region, dict):
                continue
            kind = region.get("kind")
            if kind == "merged_cell_region":
                continue
            region_id = region.get("id")
            if region_id and region_id in mapped_region_ids:
                continue
            unmapped.append(
                {
                    "sheet_name": sheet_name,
                    "region_id": region_id,
                    "kind": kind,
                    "label": region.get("label"),
                    "range": region.get("range"),
                }
            )
    return unmapped


def _detect_ambiguous_rows(facts: list[SemanticFact]) -> list[JsonObject]:
    grouped: dict[tuple[str, int, str], list[SemanticFact]] = defaultdict(list)
    for fact in facts:
        confidence = (
            fact.metadata.get("mapping_confidence", {})
            if isinstance(fact.metadata, dict)
            else {}
        )
        overall = (
            confidence.get("overall") if isinstance(confidence, dict) else None
        )
        if overall != CONFIDENCE_AMBIGUOUS:
            continue
        grouped[
            (fact.source_sheet_name, fact.source_row_number, fact.operational_section)
        ].append(fact)

    ambiguous: list[JsonObject] = []
    for (sheet_name, row_number, section), group in grouped.items():
        sample = group[0]
        ambiguous.append(
            {
                "sheet_name": sheet_name,
                "row_number": row_number,
                "operational_section": section,
                "operational_section_label": sample.operational_section_label,
                "fact_count": len(group),
                "sample_cell_address": sample.source_cell_address,
                "metric_key": sample.metric_key,
                "metric_label": sample.metric_label,
                "row_label": sample.operational_row_label,
            }
        )
    return ambiguous


def _fact_is_rollup(fact: SemanticFact) -> bool:
    metadata = fact.metadata if isinstance(fact.metadata, dict) else {}
    ownership = metadata.get("ownership")
    if isinstance(ownership, dict) and ownership.get("is_rollup"):
        return True
    return bool(fact.is_formula) or fact.calculated_state in {"formula", "calculated"}


def _ownership_source(fact: SemanticFact, dimension: str) -> str | None:
    metadata = fact.metadata if isinstance(fact.metadata, dict) else {}
    ownership = metadata.get("ownership")
    if isinstance(ownership, dict):
        value = ownership.get(f"{dimension}_source")
        return str(value) if value else None
    return None


def _detect_duplicate_facts(facts: list[SemanticFact]) -> list[JsonObject]:
    """Distinct *leaf* cells producing identical (buyer, unit, date, metric).

    Rollup/aggregate cells are excluded — repeated subtotal or grand-total
    cells legitimately share a (None, None, date, metric) signature and are not
    duplicate operational facts. Only true leaf facts that carry a buyer or
    unit are considered, so accidental ownership collisions surface without
    false positives from totals.
    """
    grouped: dict[tuple[str | None, str | None, str | None, str], list[SemanticFact]] = defaultdict(
        list
    )
    for fact in facts:
        if fact.value_numeric is None:
            continue
        if _fact_is_rollup(fact):
            continue
        if fact.buyer is None and fact.unit is None:
            continue
        grouped[
            (
                fact.buyer,
                fact.unit,
                fact.report_date.isoformat() if fact.report_date else None,
                fact.metric_key,
            )
        ].append(fact)

    duplicates: list[JsonObject] = []
    for key, group in grouped.items():
        if len(group) < 2:
            continue
        unique_cells = {(fact.source_sheet_name, fact.source_cell_address) for fact in group}
        if len(unique_cells) < 2:
            continue
        sample = group[0]
        duplicates.append(
            {
                "buyer": key[0],
                "unit": key[1],
                "report_date": key[2],
                "metric_key": key[3],
                "metric_label": sample.metric_label,
                "fact_count": len(group),
                "sample_cells": sorted(
                    f"{sheet}!{address}" for sheet, address in unique_cells
                )[:6],
            }
        )
    return duplicates


def _detect_orphan_cells(
    workbook_metadata: JsonObject,
    extraction: SemanticExtraction,
) -> list[JsonObject]:
    """Workbook cells with numeric values that did not produce a semantic fact."""
    fact_keys = {
        (fact.source_sheet_name, fact.source_cell_address) for fact in extraction.facts
    }
    orphans: list[JsonObject] = []
    sheets = workbook_metadata.get("sheets")
    if not isinstance(sheets, list):
        return orphans
    for sheet in sheets:
        if not isinstance(sheet, dict):
            continue
        sheet_name = sheet.get("name")
        cells = sheet.get("cells")
        if not isinstance(cells, list):
            continue
        for cell in cells:
            if not isinstance(cell, dict):
                continue
            data_type = cell.get("data_type")
            value = cell.get("value")
            if data_type != "n" and not isinstance(value, (int, float)):
                continue
            if value is None or value == 0:
                continue
            address = cell.get("address")
            if not isinstance(address, str):
                continue
            if (sheet_name, address) in fact_keys:
                continue
            orphans.append(
                {
                    "sheet_name": sheet_name,
                    "cell_address": address,
                    "value": value,
                }
            )
    # Cap orphans so the response stays small. Workbooks may have many
    # decorative numeric cells (page numbers, totals already rendered as
    # text) that we are intentionally ignoring.
    return orphans[:200]


def _detect_missing_workbook_references(extraction: SemanticExtraction) -> list[JsonObject]:
    missing: list[JsonObject] = []
    for fact in extraction.facts:
        problems: list[str] = []
        if not fact.source_sheet_name:
            problems.append("source_sheet_name")
        if not fact.source_cell_address:
            problems.append("source_cell_address")
        if not isinstance(fact.workbook_sheet_identity, dict):
            problems.append("workbook_sheet_identity")
        if not problems:
            continue
        missing.append(
            {
                "source_key": fact.source_key,
                "missing_fields": problems,
                "metric_key": fact.metric_key,
            }
        )
    return missing


def _detect_ownership_conflicts(facts: list[SemanticFact]) -> list[JsonObject]:
    """Apply the MD07-2A semantic validation rules.

    Flags facts whose mapping_confidence reasons indicate a structural
    ownership problem:

    * ``buyer_equals_unit`` — a unit value was rejected as a buyer
    * ``unit_unmapped`` — a leaf row is missing its governing unit
    * ``buyer_unmapped`` / ``metric_missing_header`` — missing ownership

    Composite buyer labels never reach here because ``normalize_buyer`` rejects
    them up front, but if one slipped through (contains a separator) it is also
    reported.
    """
    conflicts: list[JsonObject] = []
    for fact in facts:
        metadata = fact.metadata if isinstance(fact.metadata, dict) else {}
        confidence = metadata.get("mapping_confidence")
        reasons = (
            confidence.get("reasons", []) if isinstance(confidence, dict) else []
        )
        problems: list[str] = []
        if "buyer_equals_unit" in reasons:
            problems.append("unit_classified_as_buyer")
        if "unit_unmapped" in reasons and not _fact_is_rollup(fact):
            problems.append("missing_unit_ownership")
        if "metric_missing_header" in reasons:
            problems.append("missing_metric_ownership")
        if fact.buyer and ("/" in fact.buyer or "|" in fact.buyer):
            problems.append("composite_buyer_label")
        if not problems:
            continue
        conflicts.append(
            {
                "sheet_name": fact.source_sheet_name,
                "cell_address": fact.source_cell_address,
                "metric_key": fact.metric_key,
                "metric_label": fact.metric_label,
                "buyer": fact.buyer,
                "unit": fact.unit,
                "operational_section": fact.operational_section,
                "problems": problems,
            }
        )
    return conflicts


def _ownership_source_breakdown(facts: list[SemanticFact]) -> dict[str, dict[str, int]]:
    """Count, per dimension, which structural source resolved ownership.

    Lets the UI explain *why* a fact was mapped (merged inheritance vs column
    header vs direct label vs positional fallback) — MD07-2A diagnostics
    requirement.
    """
    dimensions = ("unit", "buyer", "metric", "section")
    breakdown: dict[str, Counter[str]] = {dimension: Counter() for dimension in dimensions}
    for fact in facts:
        metadata = fact.metadata if isinstance(fact.metadata, dict) else {}
        ownership = metadata.get("ownership")
        if not isinstance(ownership, dict):
            continue
        for dimension in dimensions:
            source = ownership.get(f"{dimension}_source")
            if source:
                breakdown[dimension][str(source)] += 1
    return {dimension: dict(counter) for dimension, counter in breakdown.items()}


def _trust_ratio(confidence_counts: dict[str, int], fact_count: int) -> float:
    if fact_count <= 0:
        return 0.0
    trusted = confidence_counts.get(CONFIDENCE_EXPLICIT, 0) + confidence_counts.get(
        CONFIDENCE_INFERRED, 0
    )
    return round(trusted / fact_count, 4)


def _build_issues(
    *,
    extraction: SemanticExtraction,
    confidence_counts: dict[str, int],
    unmapped_regions: list[JsonObject],
    ambiguous_rows: list[JsonObject],
    duplicate_facts: list[JsonObject],
    orphan_cells: list[JsonObject],
    missing_workbook_references: list[JsonObject],
    ownership_conflicts: list[JsonObject],
) -> list[SemanticIssue]:
    issues: list[SemanticIssue] = []

    if extraction.facts and confidence_counts.get(CONFIDENCE_AMBIGUOUS, 0) > 0:
        issues.append(
            SemanticIssue(
                code="semantic.ambiguous_facts",
                severity=SEVERITY_WARNING,
                message=(
                    f"{confidence_counts[CONFIDENCE_AMBIGUOUS]} fact(s) have an ambiguous mapping; "
                    "review buyer/unit/metric inference."
                ),
                occurrences=confidence_counts[CONFIDENCE_AMBIGUOUS],
            )
        )

    # Ownership conflicts are the headline MD07-2A signal: a unit classified as
    # a buyer, a composite buyer label, or missing unit/metric ownership.
    if ownership_conflicts:
        def _problems(conflict: JsonObject) -> list[str]:
            raw = conflict.get("problems")
            return [str(item) for item in raw] if isinstance(raw, list) else []

        unit_as_buyer = sum(
            1 for c in ownership_conflicts if "unit_classified_as_buyer" in _problems(c)
        )
        composite = sum(
            1 for c in ownership_conflicts if "composite_buyer_label" in _problems(c)
        )
        severity = SEVERITY_WARNING if (unit_as_buyer or composite) else SEVERITY_INFO
        issues.append(
            SemanticIssue(
                code="semantic.ownership_conflicts",
                severity=severity,
                message=(
                    f"{len(ownership_conflicts)} fact(s) have an ownership conflict "
                    f"({unit_as_buyer} unit-as-buyer, {composite} composite buyer)."
                ),
                occurrences=len(ownership_conflicts),
            )
        )

    if unmapped_regions:
        issues.append(
            SemanticIssue(
                code="semantic.unmapped_regions",
                severity=SEVERITY_INFO,
                message=(
                    f"{len(unmapped_regions)} workbook region(s) were not mapped to a"
                    " semantic section."
                ),
                occurrences=len(unmapped_regions),
            )
        )

    if duplicate_facts:
        issues.append(
            SemanticIssue(
                code="semantic.duplicate_facts",
                severity=SEVERITY_WARNING,
                message=(
                    f"{len(duplicate_facts)} duplicate (buyer, unit, date, metric) signature(s) "
                    "detected across distinct leaf cells."
                ),
                occurrences=len(duplicate_facts),
            )
        )

    if orphan_cells:
        issues.append(
            SemanticIssue(
                code="semantic.orphan_cells",
                severity=SEVERITY_INFO,
                message=(
                    f"{len(orphan_cells)} numeric workbook cell(s) did not produce a semantic fact."
                ),
                occurrences=len(orphan_cells),
            )
        )

    if missing_workbook_references:
        issues.append(
            SemanticIssue(
                code="semantic.missing_workbook_reference",
                severity=SEVERITY_ERROR,
                message=(
                    f"{len(missing_workbook_references)} fact(s) are missing workbook traceability "
                    "(sheet/cell/source identity)."
                ),
                occurrences=len(missing_workbook_references),
            )
        )

    if not extraction.facts:
        issues.append(
            SemanticIssue(
                code="semantic.no_facts_extracted",
                severity=SEVERITY_INFO,
                message="No semantic facts were extracted from the workbook.",
            )
        )

    return issues


def _compute_health(issues: list[SemanticIssue]) -> str:
    severities = {issue.severity for issue in issues}
    if SEVERITY_ERROR in severities:
        return "error"
    if SEVERITY_WARNING in severities:
        return "warning"
    return "ok"


def build_semantic_diagnostics(
    *,
    workbook_metadata: JsonObject,
    extraction: SemanticExtraction,
) -> SemanticDiagnostics:
    """Compute semantic diagnostics from an extraction and its source metadata."""
    facts = list(extraction.facts)
    confidence_counts = _confidence_counts(facts)

    sheets_with_facts = {fact.source_sheet_name for fact in facts}
    sheets = workbook_metadata.get("sheets")
    if isinstance(sheets, list):
        sheets_without_facts = sorted(
            sheet.get("name", "")
            for sheet in sheets
            if isinstance(sheet, dict)
            and isinstance(sheet.get("name"), str)
            and sheet.get("name") not in sheets_with_facts
        )
    else:
        sheets_without_facts = []

    unmapped_regions = _detect_unmapped_regions(workbook_metadata, extraction)
    ambiguous_rows = _detect_ambiguous_rows(facts)
    duplicate_facts = _detect_duplicate_facts(facts)
    orphan_cells = _detect_orphan_cells(workbook_metadata, extraction)
    missing_workbook_references = _detect_missing_workbook_references(extraction)
    ownership_conflicts = _detect_ownership_conflicts(facts)
    ownership_sources = _ownership_source_breakdown(facts)
    trust_ratio = _trust_ratio(confidence_counts, len(facts))

    issues = _build_issues(
        extraction=extraction,
        confidence_counts=confidence_counts,
        unmapped_regions=unmapped_regions,
        ambiguous_rows=ambiguous_rows,
        duplicate_facts=duplicate_facts,
        orphan_cells=orphan_cells,
        missing_workbook_references=missing_workbook_references,
        ownership_conflicts=ownership_conflicts,
    )

    return SemanticDiagnostics(
        fact_count=len(facts),
        confidence_counts=confidence_counts,
        sheets_with_facts=len(sheets_with_facts),
        sheets_without_facts=sheets_without_facts,
        unmapped_regions=unmapped_regions,
        ambiguous_rows=ambiguous_rows,
        duplicate_facts=duplicate_facts,
        orphan_cells=orphan_cells,
        missing_workbook_references=missing_workbook_references,
        ownership_conflicts=ownership_conflicts,
        ownership_sources=ownership_sources,
        trust_ratio=trust_ratio,
        issues=issues,
        health=_compute_health(issues),
    )
