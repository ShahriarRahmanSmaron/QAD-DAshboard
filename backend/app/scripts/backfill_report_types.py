"""One-time backfill: classify existing workbooks into the dynamic report-type
registry (MD07-5 Phase 5).

Workbooks uploaded before Phase 5 have ``report_type_id = NULL``. This derives
the report type from each workbook's filename and assigns it, so the dynamic
report-type dropdown populates without re-uploading.

Run from ``backend/``:

    python -m app.scripts.backfill_report_types
"""

from __future__ import annotations

import asyncio

from sqlalchemy import select, text

from app.auth import models as _auth_models  # noqa: F401
from app.db.session import AsyncSessionLocal, engine
from app.reporting.models import UploadedFile
from app.reporting.repository import get_or_create_report_type_for_workbook
from app.reporting.workbook_normalization import (
    derive_report_type_code,
    derive_report_type_name,
)


async def run() -> None:
    assigned = 0
    skipped = 0
    async with AsyncSessionLocal() as session:
        await session.execute(text("set local row_security = off"))
        workbooks = (
            await session.execute(
                select(UploadedFile).where(UploadedFile.deleted_at.is_(None))
            )
        ).scalars().all()

        for wb in workbooks:
            filename = wb.original_filename or ""
            name = derive_report_type_name(filename)
            code = derive_report_type_code(name)
            if not name or not code:
                skipped += 1
                continue
            report_type = await get_or_create_report_type_for_workbook(
                session, name=name, code=code
            )
            if wb.report_type_id != report_type.id:
                wb.report_type_id = report_type.id
                assigned += 1
        await session.commit()
    await engine.dispose()
    print(f"assigned={assigned} skipped={skipped} total={len(workbooks)}")


if __name__ == "__main__":
    asyncio.run(run())
