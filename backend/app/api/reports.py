from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.constants import Permission, UserRole
from app.auth.dependencies import require_permission, require_role
from app.auth.schemas import AuthUser
from app.db.session import get_db_session
from app.reporting import repository
from app.reporting.schemas import (
    BulkReportSaveRequest,
    ReportCreateRequest,
    ReportListResponse,
    ReportMetricCreateRequest,
    ReportMetricResponse,
    ReportResponse,
    ReportRowCreateRequest,
    ReportRowResponse,
    ReportSummaryListResponse,
    WorkbookExportRequest,
    WorkbookUploadResponse,
)
from app.reporting.service import (
    bulk_save_report,
    create_report,
    create_report_metric,
    create_report_row,
    serialize_metric,
    serialize_report,
    serialize_report_summary,
    serialize_row,
    transition_report_workflow,
)
from app.reporting.workbook_export import export_workbook_for_user
from app.reporting.workbook_service import save_and_parse_workbook_upload

router = APIRouter(prefix="/reports", tags=["reports"])
SessionDep = Annotated[AsyncSession, Depends(get_db_session)]
ReportReaderDep = Annotated[AuthUser, Depends(require_permission(Permission.REPORTS_READ))]
ReportWriterDep = Annotated[AuthUser, Depends(require_role([UserRole.ADMIN, UserRole.EDITOR]))]


@router.get("", response_model=ReportListResponse)
async def list_reports(
    session: SessionDep,
    user: ReportReaderDep,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
) -> ReportListResponse:
    reports, total = await repository.list_accessible_reports(
        session,
        user=user,
        page=page,
        page_size=page_size,
    )
    return ReportListResponse(
        reports=[serialize_report(report) for report in reports],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/summaries", response_model=ReportSummaryListResponse)
async def list_report_summaries(
    session: SessionDep,
    user: ReportReaderDep,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
) -> ReportSummaryListResponse:
    """Lightweight report list optimized for grid/table views."""
    rows, total = await repository.list_report_summaries(
        session,
        user=user,
        page=page,
        page_size=page_size,
    )
    return ReportSummaryListResponse(
        reports=[serialize_report_summary(row) for row in rows],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.post("", response_model=ReportResponse, status_code=status.HTTP_201_CREATED)
async def post_report(
    payload: ReportCreateRequest,
    session: SessionDep,
    user: ReportWriterDep,
) -> ReportResponse:
    try:
        report = await create_report(session, payload=payload, actor=user)
        await session.commit()
    except Exception:
        await session.rollback()
        raise

    loaded = await repository.get_accessible_report(session, report_id=report.id, user=user)
    if loaded is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Report not found.")
    return serialize_report(loaded)


@router.post("/save", response_model=ReportResponse, status_code=status.HTTP_201_CREATED)
async def bulk_save(
    payload: BulkReportSaveRequest,
    session: SessionDep,
    user: ReportWriterDep,
) -> ReportResponse:
    """Create a full report tree (header + rows + metrics) in a single transaction."""
    try:
        report = await bulk_save_report(session, payload=payload, actor=user)
        await session.commit()
    except Exception:
        await session.rollback()
        raise

    # Reload with relationships for the response
    loaded = await repository.get_accessible_report(session, report_id=report.id, user=user)
    if loaded is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Report not found.")
    return serialize_report(loaded)


@router.get("/{report_id}", response_model=ReportResponse)
async def get_report(
    report_id: UUID,
    session: SessionDep,
    user: ReportReaderDep,
) -> ReportResponse:
    report = await repository.get_accessible_report(session, report_id=report_id, user=user)
    if report is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Report not found.")
    return serialize_report(report)


@router.post("/{report_id}/workflow/{workflow_action}", response_model=ReportResponse)
async def transition_report(
    report_id: UUID,
    workflow_action: str,
    session: SessionDep,
    user: ReportWriterDep,
) -> ReportResponse:
    if workflow_action not in {"submit_for_review", "approve", "reject", "lock", "archive"}:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Workflow action not found.",
        )

    try:
        report = await transition_report_workflow(
            session,
            report_id=report_id,
            action=workflow_action,
            actor=user,
        )
        await session.commit()
    except Exception:
        await session.rollback()
        raise

    loaded = await repository.get_accessible_report(session, report_id=report.id, user=user)
    if loaded is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Report not found.")
    return serialize_report(loaded)


@router.post(
    "/workbooks/upload",
    response_model=WorkbookUploadResponse,
    status_code=status.HTTP_201_CREATED,
)
async def upload_workbook(
    session: SessionDep,
    user: ReportWriterDep,
    file: Annotated[UploadFile, File(...)],
) -> WorkbookUploadResponse:
    try:
        response = await save_and_parse_workbook_upload(session, file=file, actor=user)
        await session.commit()
    except Exception:
        await session.rollback()
        raise

    return response


@router.post(
    "/workbooks/{uploaded_file_id}/export",
    response_class=Response,
    responses={
        200: {
            "description": "Reconstructed XLSX workbook with edits applied.",
            "content": {
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": {}
            },
        }
    },
)
async def export_workbook(
    uploaded_file_id: UUID,
    payload: WorkbookExportRequest,
    session: SessionDep,
    user: ReportWriterDep,
) -> Response:
    """Reopen an uploaded XLSX, patch operational edits, and stream it back.

    The workbook is rebuilt by *loading the original file* with openpyxl and
    only mutating the cells the user actually edited. This preserves merged
    regions, freeze panes, hidden rows/columns, row/column dimensions,
    grouping, and styles to the extent openpyxl retains them.
    """

    try:
        binary, download_filename, summary = await export_workbook_for_user(
            session,
            uploaded_file_id=uploaded_file_id,
            edits=payload.sheet_edits,
            actor=user,
        )
        await session.commit()
    except Exception:
        await session.rollback()
        raise

    safe_summary_header = (
        f'applied={summary["applied_total"]}; '
        f'skipped={summary["skipped_total"]}; '
        f'bytes={summary["bytes_written"]}'
    )
    headers = {
        "Content-Disposition": f'attachment; filename="{download_filename}"',
        "X-Workbook-Export-Summary": safe_summary_header,
        "X-Workbook-Source-Filename": download_filename,
        "Cache-Control": "no-store",
    }
    return Response(
        content=binary,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers=headers,
    )


@router.post(
    "/{report_id}/rows",
    response_model=ReportRowResponse,
    status_code=status.HTTP_201_CREATED,
)
async def post_report_row(
    report_id: UUID,
    payload: ReportRowCreateRequest,
    session: SessionDep,
    user: ReportWriterDep,
) -> ReportRowResponse:
    try:
        row = await create_report_row(session, report_id=report_id, payload=payload, actor=user)
        await session.commit()
    except Exception:
        await session.rollback()
        raise

    return serialize_row(row)


@router.post(
    "/{report_id}/metrics",
    response_model=ReportMetricResponse,
    status_code=status.HTTP_201_CREATED,
)
async def post_report_metric(
    report_id: UUID,
    payload: ReportMetricCreateRequest,
    session: SessionDep,
    user: ReportWriterDep,
) -> ReportMetricResponse:
    try:
        metric = await create_report_metric(
            session,
            report_id=report_id,
            payload=payload,
            actor=user,
        )
        await session.commit()
    except Exception:
        await session.rollback()
        raise

    return serialize_metric(metric)
