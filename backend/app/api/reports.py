from datetime import date
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
    OperationalFactListResponse,
    OperationalSummaryResponse,
    ReportCreateRequest,
    ReportListResponse,
    ReportMetricCreateRequest,
    ReportMetricResponse,
    ReportResponse,
    ReportRowCreateRequest,
    ReportRowResponse,
    ReportSummaryListResponse,
    SemanticDiagnosticsResponse,
    WorkbookExportRequest,
    WorkbookSemanticBreakdownResponse,
    WorkbookSemanticDiagnosticsBundle,
    WorkbookSemanticRegionResponse,
    WorkbookUploadResponse,
)
from app.reporting.service import (
    bulk_save_report,
    create_report,
    create_report_metric,
    create_report_row,
    serialize_metric,
    serialize_operational_fact,
    serialize_operational_summary_row,
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


@router.get("/operations/facts", response_model=OperationalFactListResponse)
async def list_operational_facts(
    session: SessionDep,
    user: ReportReaderDep,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=500)] = 50,
    uploaded_file_id: UUID | None = None,
    buyer: str | None = None,
    unit: str | None = None,
    metric: str | None = None,
    report_date: date | None = None,
) -> OperationalFactListResponse:
    facts, total = await repository.list_operational_facts(
        session,
        user=user,
        page=page,
        page_size=page_size,
        uploaded_file_id=uploaded_file_id,
        buyer=buyer,
        unit=unit,
        metric_key=metric,
        report_date=report_date,
    )
    return OperationalFactListResponse(
        facts=[serialize_operational_fact(fact) for fact in facts],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/operations/by-buyer", response_model=OperationalFactListResponse)
async def list_operational_facts_by_buyer(
    session: SessionDep,
    user: ReportReaderDep,
    buyer: Annotated[str, Query(min_length=1)],
    report_date: date | None = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=500)] = 50,
) -> OperationalFactListResponse:
    facts, total = await repository.list_operational_facts(
        session,
        user=user,
        page=page,
        page_size=page_size,
        buyer=buyer,
        report_date=report_date,
    )
    return OperationalFactListResponse(
        facts=[serialize_operational_fact(fact) for fact in facts],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/operations/by-unit", response_model=OperationalFactListResponse)
async def list_operational_facts_by_unit(
    session: SessionDep,
    user: ReportReaderDep,
    unit: Annotated[str, Query(min_length=1)],
    report_date: date | None = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=500)] = 50,
) -> OperationalFactListResponse:
    facts, total = await repository.list_operational_facts(
        session,
        user=user,
        page=page,
        page_size=page_size,
        unit=unit,
        report_date=report_date,
    )
    return OperationalFactListResponse(
        facts=[serialize_operational_fact(fact) for fact in facts],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/operations/by-metric", response_model=OperationalFactListResponse)
async def list_operational_facts_by_metric(
    session: SessionDep,
    user: ReportReaderDep,
    metric: Annotated[str, Query(min_length=1)],
    report_date: date | None = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=500)] = 50,
) -> OperationalFactListResponse:
    facts, total = await repository.list_operational_facts(
        session,
        user=user,
        page=page,
        page_size=page_size,
        metric_key=metric,
        report_date=report_date,
    )
    return OperationalFactListResponse(
        facts=[serialize_operational_fact(fact) for fact in facts],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/operations/summary", response_model=OperationalSummaryResponse)
async def get_operational_summary(
    session: SessionDep,
    user: ReportReaderDep,
    uploaded_file_id: UUID | None = None,
    buyer: str | None = None,
    unit: str | None = None,
    metric: str | None = None,
    report_date: date | None = None,
) -> OperationalSummaryResponse:
    rows = await repository.summarize_operational_facts(
        session,
        user=user,
        uploaded_file_id=uploaded_file_id,
        buyer=buyer,
        unit=unit,
        metric_key=metric,
        report_date=report_date,
    )
    return OperationalSummaryResponse(
        rows=[serialize_operational_summary_row(row) for row in rows],
        total=len(rows),
    )


@router.get(
    "/workbooks/{uploaded_file_id}/semantics",
    response_model=WorkbookSemanticBreakdownResponse,
)
async def get_workbook_semantics(
    uploaded_file_id: UUID,
    session: SessionDep,
    user: ReportReaderDep,
) -> WorkbookSemanticBreakdownResponse:
    uploaded_file = await repository.get_accessible_uploaded_file(
        session,
        uploaded_file_id=uploaded_file_id,
        user=user,
    )
    if uploaded_file is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workbook not found.")

    facts, _total = await repository.list_operational_facts(
        session,
        user=user,
        uploaded_file_id=uploaded_file_id,
        page=1,
        page_size=500,
    )
    summary_rows = await repository.summarize_operational_facts(
        session,
        user=user,
        uploaded_file_id=uploaded_file_id,
    )
    semantic_mapping = uploaded_file.metadata_.get("semantic_mapping", {})
    raw_regions = semantic_mapping.get("regions", []) if isinstance(semantic_mapping, dict) else []
    regions = [
        WorkbookSemanticRegionResponse.model_validate(region)
        for region in raw_regions
        if isinstance(region, dict)
    ]
    raw_diagnostics = (
        semantic_mapping.get("diagnostics") if isinstance(semantic_mapping, dict) else None
    )
    diagnostics = (
        SemanticDiagnosticsResponse.model_validate(raw_diagnostics)
        if isinstance(raw_diagnostics, dict)
        else None
    )
    confidence_counts = (
        dict(semantic_mapping.get("confidence_counts", {}))
        if isinstance(semantic_mapping, dict)
        else {}
    )
    return WorkbookSemanticBreakdownResponse(
        uploaded_file_id=uploaded_file_id,
        semantic_mapping=semantic_mapping if isinstance(semantic_mapping, dict) else {},
        regions=regions,
        facts=[serialize_operational_fact(fact) for fact in facts],
        summary=OperationalSummaryResponse(
            rows=[serialize_operational_summary_row(row) for row in summary_rows],
            total=len(summary_rows),
        ),
        diagnostics=diagnostics,
        confidence_counts=confidence_counts,
    )


@router.get(
    "/workbooks/{uploaded_file_id}/diagnostics",
    response_model=WorkbookSemanticDiagnosticsBundle,
)
async def get_workbook_diagnostics(
    uploaded_file_id: UUID,
    session: SessionDep,
    user: ReportReaderDep,
) -> WorkbookSemanticDiagnosticsBundle:
    """Return only the semantic diagnostics block for a workbook.

    Lighter than the full breakdown endpoint — useful for the diagnostics
    panel in the upload UI which doesn't need the per-fact list every time.
    """
    uploaded_file = await repository.get_accessible_uploaded_file(
        session,
        uploaded_file_id=uploaded_file_id,
        user=user,
    )
    if uploaded_file is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workbook not found.")

    semantic_mapping = uploaded_file.metadata_.get("semantic_mapping", {}) or {}
    raw_diagnostics = (
        semantic_mapping.get("diagnostics") if isinstance(semantic_mapping, dict) else None
    )
    if not isinstance(raw_diagnostics, dict):
        # No diagnostics persisted yet (older workbook upload). Return an
        # empty-but-valid bundle so the UI can render the empty state without
        # additional null-checking.
        diagnostics = SemanticDiagnosticsResponse(
            fact_count=0,
            confidence_counts={},
            sheets_with_facts=0,
            sheets_without_facts=[],
            unmapped_regions=[],
            ambiguous_rows=[],
            duplicate_facts=[],
            orphan_cells=[],
            missing_workbook_references=[],
            issues=[],
            health="ok",
        )
    else:
        diagnostics = SemanticDiagnosticsResponse.model_validate(raw_diagnostics)

    confidence_counts = (
        dict(semantic_mapping.get("confidence_counts", {}))
        if isinstance(semantic_mapping, dict)
        else {}
    )
    return WorkbookSemanticDiagnosticsBundle(
        uploaded_file_id=uploaded_file_id,
        diagnostics=diagnostics,
        confidence_counts=confidence_counts,
        semantic_mapping=semantic_mapping if isinstance(semantic_mapping, dict) else {},
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
