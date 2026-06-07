from __future__ import annotations

import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.reporting.models import Buyer, OperationalFact


@dataclass
class SyncResult:
    inserted: int
    already_exists: int
    total_scanned: int


async def sync_buyers_from_facts(
    session: AsyncSession,
    *,
    uploaded_file_id: uuid.UUID,
) -> SyncResult:
    distinct_buyers_result = await session.execute(
        select(OperationalFact.buyer)
        .where(
            OperationalFact.uploaded_file_id == uploaded_file_id,
            OperationalFact.buyer.is_not(None),
            OperationalFact.deleted_at.is_(None),
        )
        .distinct()
    )
    fact_buyer_names = sorted(
        {row[0].strip() for row in distinct_buyers_result.all() if row[0] and row[0].strip()}
    )
    if not fact_buyer_names:
        return SyncResult(inserted=0, already_exists=0, total_scanned=0)

    existing_result = await session.execute(
        select(Buyer.name).where(Buyer.deleted_at.is_(None))
    )
    existing_lower = {row[0].strip().lower() for row in existing_result.all() if row[0]}

    missing = [name for name in fact_buyer_names if name.lower() not in existing_lower]
    already_exists = len(fact_buyer_names) - len(missing)

    if missing:
        new_buyers = [
            Buyer(code=name, name=name, is_active=True)
            for name in missing
        ]
        session.add_all(new_buyers)
        await session.flush()

    return SyncResult(
        inserted=len(missing),
        already_exists=already_exists,
        total_scanned=len(fact_buyer_names),
    )
