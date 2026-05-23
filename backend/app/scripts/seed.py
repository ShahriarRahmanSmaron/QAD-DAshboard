"""Idempotent development seed for buyers, units, and report types.

Reusable across runs: every seed entry is keyed by ``code`` (case-insensitive,
matching the partial unique indexes on the tables) so re-running the script is a
no-op for unchanged rows and a metadata refresh for changed ones.

Run from ``backend/`` with the project's virtualenv:

    python -m app.scripts.seed              # seed everything
    python -m app.scripts.seed --only buyers
    python -m app.scripts.seed --only units --only report-types

The script uses the same async SQLAlchemy session as the API, so ``DATABASE_URL``
in ``backend/.env`` is honored.
"""

from __future__ import annotations

import argparse
import asyncio
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import models as _auth_models  # noqa: F401  ensure FK target table is registered
from app.db.session import AsyncSessionLocal, engine
from app.reporting.models import Buyer, ReportType, Unit


@dataclass(frozen=True)
class BuyerSeed:
    code: str
    name: str
    notes: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class UnitSeed:
    code: str
    name: str
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class ReportTypeSeed:
    code: str
    name: str
    description: str | None = None
    version: int = 1
    excel_template_key: str | None = None
    metric_schema: dict[str, Any] = field(default_factory=dict)


BUYER_SEEDS: tuple[BuyerSeed, ...] = (
    BuyerSeed(code="HM", name="H&M", notes="Hennes & Mauritz AB"),
    BuyerSeed(code="NEXT", name="NEXT", notes="Next plc"),
    BuyerSeed(code="ZARA", name="ZARA", notes="Inditex / ZARA"),
    BuyerSeed(code="CA", name="C&A", notes="C&A Mode"),
    BuyerSeed(code="TOM_TAILOR", name="TOM TAILOR", notes="Tom Tailor Group"),
)

UNIT_SEEDS: tuple[UnitSeed, ...] = (
    UnitSeed(code="HTL-01", name="HTL-01", metadata={"site": "HTL", "line": "01"}),
    UnitSeed(code="HTL-02", name="HTL-02", metadata={"site": "HTL", "line": "02"}),
    UnitSeed(code="CCL", name="CCL", metadata={"site": "CCL"}),
    UnitSeed(code="MHTL", name="MHTL", metadata={"site": "MHTL"}),
)

REPORT_TYPE_SEEDS: tuple[ReportTypeSeed, ...] = (
    ReportTypeSeed(
        code="WF_TEST_SHADE",
        name="WF Test & Shade Summary",
        description=(
            "Wet finishing test and shade summary covering shade band, GSM, "
            "shrinkage and color fastness checkpoints."
        ),
        excel_template_key="wf-test-shade-summary",
        metric_schema={
            "row_groups": ["shade_band", "fastness", "dimensional_stability"],
            "metrics": [
                {"key": "shade_band", "label": "Shade band", "value_type": "text"},
                {"key": "gsm", "label": "GSM", "value_type": "number", "unit": "g/m^2"},
                {
                    "key": "shrinkage_warp",
                    "label": "Shrinkage (warp)",
                    "value_type": "number",
                    "unit": "%",
                },
                {
                    "key": "shrinkage_weft",
                    "label": "Shrinkage (weft)",
                    "value_type": "number",
                    "unit": "%",
                },
                {
                    "key": "color_fastness_wash",
                    "label": "Color fastness (wash)",
                    "value_type": "number",
                },
            ],
        },
    ),
    ReportTypeSeed(
        code="RFT_SUMMARY",
        name="RFT Summary",
        description=(
            "Right-First-Time summary. Tracks first-pass yield against rework "
            "and rejection across daily lots."
        ),
        excel_template_key="rft-summary",
        metric_schema={
            "metrics": [
                {"key": "lots_total", "label": "Lots total", "value_type": "number"},
                {"key": "lots_rft", "label": "Lots RFT", "value_type": "number"},
                {"key": "lots_rework", "label": "Lots rework", "value_type": "number"},
                {"key": "lots_reject", "label": "Lots rejected", "value_type": "number"},
                {
                    "key": "rft_percent",
                    "label": "RFT %",
                    "value_type": "number",
                    "unit": "%",
                },
            ],
        },
    ),
    ReportTypeSeed(
        code="DEFECT_SUMMARY",
        name="Defect Summary",
        description=(
            "Defect summary by defect category, capturing pieces inspected, "
            "defective pieces, and DHU per inspection lot."
        ),
        excel_template_key="defect-summary",
        metric_schema={
            "row_groups": ["defect_category"],
            "metrics": [
                {
                    "key": "pieces_inspected",
                    "label": "Pieces inspected",
                    "value_type": "number",
                },
                {
                    "key": "pieces_defective",
                    "label": "Pieces defective",
                    "value_type": "number",
                },
                {"key": "dhu", "label": "DHU", "value_type": "number"},
                {"key": "remarks", "label": "Remarks", "value_type": "text"},
            ],
        },
    ),
)


@dataclass
class SeedReport:
    inserted: int = 0
    updated: int = 0
    unchanged: int = 0

    def record(self, *, created: bool, changed: bool) -> None:
        if created:
            self.inserted += 1
        elif changed:
            self.updated += 1
        else:
            self.unchanged += 1


async def _allow_writes(session: AsyncSession) -> None:
    """Disable RLS for this transaction.

    The reporting tables enable row level security with admin-only write
    policies. The seed connects via ``DATABASE_URL`` (typically the
    ``postgres`` pooler role) which owns the tables and is allowed to disable
    row security per transaction; the ``SET LOCAL`` is scoped to the current
    transaction and reverts on commit/rollback.
    """

    await session.execute(text_clause("set local row_security = off"))


def text_clause(statement: str) -> Any:
    from sqlalchemy import text  # local import keeps the seed dependencies obvious

    return text(statement)


async def seed_buyers(session: AsyncSession) -> SeedReport:
    report = SeedReport()
    for seed in BUYER_SEEDS:
        existing = (
            await session.execute(
                select(Buyer).where(
                    Buyer.deleted_at.is_(None),
                    func.lower(Buyer.code) == seed.code.lower(),
                )
            )
        ).scalar_one_or_none()

        if existing is None:
            session.add(
                Buyer(
                    code=seed.code,
                    name=seed.name,
                    is_active=True,
                    notes=seed.notes,
                    metadata_=dict(seed.metadata),
                )
            )
            report.record(created=True, changed=True)
            continue

        changed = False
        if existing.name != seed.name:
            existing.name = seed.name
            changed = True
        if existing.notes != seed.notes:
            existing.notes = seed.notes
            changed = True
        if existing.metadata_ != seed.metadata:
            existing.metadata_ = dict(seed.metadata)
            changed = True
        if not existing.is_active:
            existing.is_active = True
            changed = True
        report.record(created=False, changed=changed)
    return report


async def seed_units(session: AsyncSession) -> SeedReport:
    report = SeedReport()
    for seed in UNIT_SEEDS:
        existing = (
            await session.execute(
                select(Unit).where(
                    Unit.deleted_at.is_(None),
                    func.lower(Unit.code) == seed.code.lower(),
                )
            )
        ).scalar_one_or_none()

        if existing is None:
            session.add(
                Unit(
                    code=seed.code,
                    name=seed.name,
                    is_active=True,
                    metadata_=dict(seed.metadata),
                )
            )
            report.record(created=True, changed=True)
            continue

        changed = False
        if existing.name != seed.name:
            existing.name = seed.name
            changed = True
        if existing.metadata_ != seed.metadata:
            existing.metadata_ = dict(seed.metadata)
            changed = True
        if not existing.is_active:
            existing.is_active = True
            changed = True
        report.record(created=False, changed=changed)
    return report


async def seed_report_types(session: AsyncSession) -> SeedReport:
    report = SeedReport()
    for seed in REPORT_TYPE_SEEDS:
        existing = (
            await session.execute(
                select(ReportType).where(
                    ReportType.deleted_at.is_(None),
                    func.lower(ReportType.code) == seed.code.lower(),
                    ReportType.version == seed.version,
                )
            )
        ).scalar_one_or_none()

        if existing is None:
            session.add(
                ReportType(
                    code=seed.code,
                    name=seed.name,
                    description=seed.description,
                    version=seed.version,
                    excel_template_key=seed.excel_template_key,
                    metric_schema=dict(seed.metric_schema),
                    is_active=True,
                )
            )
            report.record(created=True, changed=True)
            continue

        changed = False
        if existing.name != seed.name:
            existing.name = seed.name
            changed = True
        if existing.description != seed.description:
            existing.description = seed.description
            changed = True
        if existing.excel_template_key != seed.excel_template_key:
            existing.excel_template_key = seed.excel_template_key
            changed = True
        if existing.metric_schema != seed.metric_schema:
            existing.metric_schema = dict(seed.metric_schema)
            changed = True
        if not existing.is_active:
            existing.is_active = True
            changed = True
        report.record(created=False, changed=changed)
    return report


SEEDERS: dict[str, Callable[[AsyncSession], Awaitable[SeedReport]]] = {
    "buyers": seed_buyers,
    "units": seed_units,
    "report-types": seed_report_types,
}


async def run(targets: list[str]) -> dict[str, SeedReport]:
    results: dict[str, SeedReport] = {}
    async with AsyncSessionLocal() as session:
        await _allow_writes(session)
        for target in targets:
            seeder = SEEDERS[target]
            results[target] = await seeder(session)
        await session.commit()
    await engine.dispose()
    return results


def _parse_args(argv: list[str] | None) -> list[str]:
    parser = argparse.ArgumentParser(description="Seed development reference data.")
    parser.add_argument(
        "--only",
        action="append",
        choices=sorted(SEEDERS.keys()),
        help="Restrict to one or more seed targets. May be repeated.",
    )
    args = parser.parse_args(argv)
    return args.only if args.only else list(SEEDERS.keys())


def main(argv: list[str] | None = None) -> None:
    targets = _parse_args(argv)
    results = asyncio.run(run(targets))
    for name, report in results.items():
        print(
            f"{name}: inserted={report.inserted} "
            f"updated={report.updated} unchanged={report.unchanged}"
        )


if __name__ == "__main__":
    main()
