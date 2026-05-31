from __future__ import annotations

import hashlib
import re
from pathlib import Path
from uuid import UUID, uuid4

from fastapi import HTTPException, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.schemas import AuthUser
from app.core.config import settings
from app.reporting import repository
from app.reporting.models import AuditLog, UploadedFile, UploadedFileStatus
from app.reporting.schemas import (
    WorkbookDuplicateInfo,
    WorkbookParsePreview,
    WorkbookUploadResponse,
)
from app.reporting.workbook_parser import parse_xlsx_workbook
from app.reporting.workbook_semantics import (
    extract_workbook_report_date,
    persist_workbook_semantics,
)

CHUNK_SIZE_BYTES = 1024 * 1024
ALLOWED_XLSX_CONTENT_TYPES = {
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/octet-stream",
}


def _storage_root() -> Path:
    configured_path = Path(settings.uploaded_workbook_storage_dir)
    if configured_path.is_absolute():
        return configured_path
    return Path(__file__).resolve().parents[2] / configured_path


def _safe_filename(filename: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "-", filename.strip()).strip(".-")
    return cleaned or "workbook.xlsx"


def _validate_xlsx_upload(file: UploadFile) -> str:
    filename = file.filename or ""
    if not filename.lower().endswith(".xlsx"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Only .xlsx workbook uploads are supported.",
        )

    if file.content_type and file.content_type not in ALLOWED_XLSX_CONTENT_TYPES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Upload must be an XLSX workbook.",
        )

    return _safe_filename(filename)


async def save_and_parse_workbook_upload(
    session: AsyncSession,
    *,
    file: UploadFile,
    actor: AuthUser,
    replace_existing: bool = False,
) -> WorkbookUploadResponse:
    safe_filename = _validate_xlsx_upload(file)
    storage_root = _storage_root()
    storage_root.mkdir(parents=True, exist_ok=True)

    stored_filename = f"{uuid4()}-{safe_filename}"
    storage_path = storage_root / stored_filename

    total_bytes = 0
    checksum = hashlib.sha256()
    try:
        with storage_path.open("wb") as output:
            while chunk := await file.read(CHUNK_SIZE_BYTES):
                total_bytes += len(chunk)
                checksum.update(chunk)
                output.write(chunk)
    finally:
        await file.close()

    if total_bytes == 0:
        storage_path.unlink(missing_ok=True)
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Uploaded workbook is empty.",
        )

    try:
        workbook_metadata = parse_xlsx_workbook(storage_path, filename=safe_filename)
    except RuntimeError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    except Exception as exc:
        storage_path.unlink(missing_ok=True)
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Unable to parse XLSX workbook.",
        ) from exc

    # MD07-3 Phase 3: prevent accidental duplicate uploads. Identity is
    # (filename, report_date, report_type). When an active duplicate exists and
    # the caller has not opted to replace it, abort with DUPLICATE_WORKBOOK so
    # the UI can show the replace/cancel modal. The just-written temp file is
    # removed so we never leave an orphan blob behind.
    report_date = extract_workbook_report_date(workbook_metadata)
    duplicate = await repository.find_active_duplicate_workbook(
        session,
        user=actor,
        filename=safe_filename,
        report_date=report_date,
        report_type_id=None,
    )
    replaced_workbook_id: UUID | None = None
    if duplicate is not None and not replace_existing:
        storage_path.unlink(missing_ok=True)
        info = WorkbookDuplicateInfo(
            message="A matching active workbook already exists.",
            existing_workbook_id=duplicate.id,
            filename=duplicate.original_filename,
            report_date=report_date,
            report_type_id=duplicate.report_type_id,
            uploaded_at=duplicate.created_at,
        )
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=info.model_dump(mode="json"),
        )
    if duplicate is not None and replace_existing:
        # Deactivate the prior workbook so only one active version remains.
        duplicate.is_active_workbook = False
        replaced_workbook_id = duplicate.id
        session.add(
            AuditLog(
                actor_id=actor.id,
                actor_user_id=actor.id,
                action="workbook.replaced",
                entity_type="uploaded_file",
                entity_id=str(duplicate.id),
                target_type="uploaded_file",
                target_id=duplicate.id,
                metadata_={
                    "original_filename": duplicate.original_filename,
                    "reason": "duplicate_replace",
                },
            )
        )

    checksum_sha256 = checksum.hexdigest()
    workbook_metadata = {
        **workbook_metadata,
        "workbook_source": {
            "original_filename": safe_filename,
            "stored_filename": stored_filename,
            "storage_bucket": "local",
            "storage_path": str(storage_path.relative_to(storage_root.parent)),
            "content_type": file.content_type,
            "file_size_bytes": total_bytes,
            "checksum_sha256": checksum_sha256,
        },
        "workbook_geometry": {
            "sheets": [
                {
                    "name": sheet.get("name"),
                    "dimension": sheet.get("dimension"),
                    "max_row": sheet.get("max_row"),
                    "max_column": sheet.get("max_column"),
                    "merged_cells": sheet.get("structure", {}).get("merged_cells", []),
                    "freeze_panes": sheet.get("structure", {}).get("freeze_panes"),
                    "row_heights": sheet.get("structure", {}).get("row_heights", {}),
                    "column_widths": sheet.get("structure", {}).get("column_widths", {}),
                    "default_row_height": sheet.get("structure", {}).get("default_row_height"),
                    "default_column_width": sheet.get("structure", {}).get(
                        "default_column_width"
                    ),
                }
                for sheet in workbook_metadata.get("sheets", [])
            ]
        },
    }

    uploaded_file = UploadedFile(
        uploaded_by_user_id=actor.id,
        original_filename=safe_filename,
        storage_bucket="local",
        storage_path=str(storage_path.relative_to(storage_root.parent)),
        content_type=file.content_type,
        file_size_bytes=total_bytes,
        checksum_sha256=checksum_sha256,
        status=UploadedFileStatus.PROCESSED.value,
        metadata_=workbook_metadata,
    )
    session.add(uploaded_file)
    await session.flush()

    workbook_metadata = {
        **workbook_metadata,
        "workbook_sync": {
            **workbook_metadata.get("workbook_sync", {}),
            "uploaded_file_id": str(uploaded_file.id),
            "storage_bucket": uploaded_file.storage_bucket,
            "storage_path": uploaded_file.storage_path,
        },
    }
    uploaded_file.metadata_ = workbook_metadata
    semantic_extraction = await persist_workbook_semantics(
        session,
        uploaded_file=uploaded_file,
        actor=actor,
        workbook_metadata=workbook_metadata,
    )
    workbook_metadata = uploaded_file.metadata_

    session.add(
        AuditLog(
            actor_id=actor.id,
            actor_user_id=actor.id,
            action="workbook.uploaded",
            entity_type="uploaded_file",
            entity_id=str(uploaded_file.id),
            target_type="uploaded_file",
            target_id=uploaded_file.id,
            metadata_={
                "original_filename": safe_filename,
                "sheet_count": workbook_metadata["sheet_count"],
                "file_size_bytes": total_bytes,
                "checksum_sha256": checksum_sha256,
                "workbook_sync": workbook_metadata.get("workbook_sync", {}),
                "semantic_fact_count": len(semantic_extraction.facts),
                "semantic_region_count": len(semantic_extraction.regions),
            },
        )
    )
    await session.flush()

    return WorkbookUploadResponse(
        uploaded_file_id=uploaded_file.id,
        original_filename=safe_filename,
        file_size_bytes=total_bytes,
        metadata=WorkbookParsePreview.model_validate(workbook_metadata),
        replaced_workbook_id=replaced_workbook_id,
    )
