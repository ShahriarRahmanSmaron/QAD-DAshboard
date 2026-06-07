"""One-time backfill: populate public.buyers with every distinct buyer value
already present in operational_facts (MD11-1.1).

The incremental sync_buyers_from_facts only runs on new uploads and rebuilds,
so historical buyers from pre-deployment workbooks are never auto-registered.
This script performs a one-shot scan of all operational_facts and inserts every
missing buyer into public.buyers using the same rule as the sync service:
code = name, is_active = true.

Idempotent — rerunning is a no-op once all buyers exist.

Run from ``backend/``:

    python -m app.scripts.backfill_buyers
"""

from __future__ import annotations

import asyncio

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import models as _auth_models  # noqa: F401
from app.db.session import AsyncSessionLocal, engine
from app.reporting.models import Buyer, OperationalFact


async def _distinct_buyer_names(session: AsyncSession) -> list[str]:
    rows = (
        await session.execute(
            select(OperationalFact.buyer)
            .where(
                OperationalFact.buyer.is_not(None),
                OperationalFact.deleted_at.is_(None),
            )
            .distinct()
        )
    ).all()
    return sorted(
        {row[0].strip() for row in rows if row[0] and row[0].strip()}
    )


async def _existing_buyer_names(session: AsyncSession) -> set[str]:
    rows = (
        await session.execute(
            select(Buyer.name).where(Buyer.deleted_at.is_(None))
        )
    ).all()
    return {row[0].strip().lower() for row in rows if row[0]}


async def run() -> None:
    async with AsyncSessionLocal() as session:
        await session.execute(text("set local row_security = off"))

        fact_names = await _distinct_buyer_names(session)
        if not fact_names:
            print("No buyer names found in operational_facts — nothing to backfill.")
            return

        existing_lower = await _existing_buyer_names(session)
        missing = [name for name in fact_names if name.lower() not in existing_lower]

        if not missing:
            print(
                f"All {len(fact_names)} distinct buyer(s) from operational_facts "
                f"already exist in public.buyers — nothing to do."
            )
            await engine.dispose()
            return

        new_buyers = [
            Buyer(code=name, name=name, is_active=True)
            for name in missing
        ]
        session.add_all(new_buyers)
        await session.commit()

    await engine.dispose()

    print(
        f"Inserted {len(missing)} new buyer(s): "
        + ", ".join(missing)
    )
    print(
        f"Skipped {len(fact_names) - len(missing)} buyer(s) that already existed."
    )


if __name__ == "__main__":
    asyncio.run(run())
