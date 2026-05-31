from datetime import date
from decimal import Decimal
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
from app.reporting.repository import OperationalFactFilters
from app.reporting.schemas import (
    ActiveSourcesResponse,
    ActiveWorkbookSource,
    BulkReportSaveRequest,
    OperationalAggregationResponse,
    OperationalComparisonResponse,
    OperationalDimensionsResponse,
    OperationalFactListResponse,
    OperationalFactTraceResponse,
    OperationalSummaryResponse,
    OperationalTrendResponse,
    ReportCreateRequest,
    ReportListResponse,
    ReportMetricCreateRequest,
    ReportMetricResponse,
    ReportResponse,
    ReportRowCreateRequest,
    ReportRowResponse,
    ReportSummaryListResponse,
    SemanticDiagnosticsResponse,
    WorkbookActionResponse,
    WorkbookExportRequest,
    WorkbookInventoryResponse,
    WorkbookRebuildResponse,
    WorkbookSemanticBreakdownResponse,
    WorkbookSemanticDiagnosticsBundle,
    WorkbookSemanticRegionResponse,
    WorkbookUploadResponse,
)
from app.reporting.service import (
    archive_workbook,
    bulk_save_report,
    create_report,
    create_report_metric,
    create_report_row,
    delete_workbook,
    rebuild_operational_facts,
    restore_workbook,
    serialize_metric,
    serialize_operational_aggregation,
    serialize_operational_comparison,
    serialize_operational_dimensions,
    serialize_operational_fact,
    serialize_operational_fact_trace,
    serialize_operational_summary_row,
    serialize_operational_trend,
    serialize_report,
    serialize_report_summary,
    serialize_row,
    serialize_workbook_inventory_item,
    set_workbook_active_state,
    transition_report_workflow,
)
from app.reporting.workbook_export import export_workbook_for_user
from app.reporting.workbook_service import save_and_parse_workbook_upload

router = APIRouter(prefix="/reports", tags=["reports"])
SessionDep = Annotated[AsyncSession, Depends(get_db_session)]
ReportReaderDep = Annotated[AuthUser, Depends(require_permission(Permission.REPORTS_READ))]
ReportWriterDep = Annotated[AuthUser, Depends(require_role([UserRole.ADMIN, UserRole.EDITOR]))]
ReportAdminDep = Annotated[AuthUser, Depends(require_role([UserRole.ADMIN]))]


def _active_source_report_date(value: object) -> date | None:
    """Parse the report_date text the query extracted from workbook metadata."""
    if isinstance(value, date):
        return value
    if isinstance(value, str) and value:
        try:
            return date.fromisoformat(value)
        except ValueError:
            return None
    return None


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
    buyer_id: UUID | None = None,
    unit_id: UUID | None = None,
    metric: str | None = None,
    section: str | None = None,
    report_type_id: UUID | None = None,
    report_date: date | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    value_min: Decimal | None = None,
    value_max: Decimal | None = None,
    value_type: str | None = None,
    classification: str | None = None,
    include_inactive: bool = False,
    search: str | None = None,
) -> OperationalFactListResponse:
    filters = OperationalFactFilters(
        uploaded_file_id=uploaded_file_id,
        buyer=buyer,
        unit=unit,
        buyer_id=buyer_id,
        unit_id=unit_id,
        metric_key=metric,
        operational_section=section,
        report_type_id=report_type_id,
        report_date=report_date,
        date_from=date_from,
        date_to=date_to,
        value_min=value_min,
        value_max=value_max,
        value_type=value_type,
        row_classification=classification,
        include_inactive=include_inactive,
        search=search,
    )
    facts, total = await repository.list_operational_facts(
        session,
        user=user,
        page=page,
        page_size=page_size,
        filters=filters,
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
    section: str | None = None,
    report_type_id: UUID | None = None,
    report_date: date | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    classification: str | None = None,
) -> OperationalSummaryResponse:
    filters = OperationalFactFilters(
        uploaded_file_id=uploaded_file_id,
        buyer=buyer,
        unit=unit,
        metric_key=metric,
        operational_section=section,
        report_type_id=report_type_id,
        report_date=report_date,
        date_from=date_from,
        date_to=date_to,
        row_classification=classification,
    )
    rows = await repository.summarize_operational_facts(
        session,
        user=user,
        filters=filters,
    )
    return OperationalSummaryResponse(
        rows=[serialize_operational_summary_row(row) for row in rows],
        total=len(rows),
    )


@router.get("/operations/aggregate", response_model=OperationalAggregationResponse)
async def get_operational_aggregation(
    session: SessionDep,
    user: ReportReaderDep,
    group_by: Annotated[list[str] | None, Query()] = None,
    uploaded_file_id: UUID | None = None,
    buyer: str | None = None,
    unit: str | None = None,
    buyer_id: UUID | None = None,
    unit_id: UUID | None = None,
    metric: str | None = None,
    section: str | None = None,
    report_type_id: UUID | None = None,
    report_date: date | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    value_min: Decimal | None = None,
    value_max: Decimal | None = None,
    classification: str | None = None,
) -> OperationalAggregationResponse:
    """Grouped operational totals.

    ``group_by`` accepts repeated values from: buyer, unit, metric, section,
    report_date, report_type, workbook. Without it, only the grand total is
    returned. Covers totals, grouped totals, buyer totals, unit totals, and
    section totals from a single endpoint.

    ``classification`` pins the rollup grain (detail / subtotal / grand_total /
    previous_day / summary). When omitted the detail grain is used so totals
    match the workbook without double-counting.
    """
    filters = OperationalFactFilters(
        uploaded_file_id=uploaded_file_id,
        buyer=buyer,
        unit=unit,
        buyer_id=buyer_id,
        unit_id=unit_id,
        metric_key=metric,
        operational_section=section,
        report_type_id=report_type_id,
        report_date=report_date,
        date_from=date_from,
        date_to=date_to,
        value_min=value_min,
        value_max=value_max,
        row_classification=classification,
    )
    rows, overall = await repository.aggregate_operational_facts(
        session,
        user=user,
        filters=filters,
        group_by=group_by,
    )
    resolved_group_by = repository.resolve_aggregation_dimensions(group_by)
    return serialize_operational_aggregation(
        group_by=resolved_group_by,
        rows=rows,
        overall=overall,
    )


@router.get("/operations/trend", response_model=OperationalTrendResponse)
async def get_operational_trend(
    session: SessionDep,
    user: ReportReaderDep,
    metric: Annotated[str, Query(min_length=1)],
    buyer: str | None = None,
    unit: str | None = None,
    section: str | None = None,
    report_type_id: UUID | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    classification: str | None = None,
    limit: Annotated[int, Query(ge=1, le=365)] = 180,
) -> OperationalTrendResponse:
    """History/trend retrieval for buyer+metric, unit+metric, buyer+unit+metric."""
    rows = await repository.get_operational_trend(
        session,
        user=user,
        metric_key=metric,
        buyer=buyer,
        unit=unit,
        operational_section=section,
        report_type_id=report_type_id,
        date_from=date_from,
        date_to=date_to,
        classification=classification,
        limit=limit,
    )
    return serialize_operational_trend(
        metric_key=metric,
        buyer=buyer,
        unit=unit,
        operational_section=section,
        rows=rows,
    )


@router.get("/operations/comparison", response_model=OperationalComparisonResponse)
async def get_operational_comparison(
    session: SessionDep,
    user: ReportReaderDep,
    metric: Annotated[str, Query(min_length=1)],
    current_date: date,
    previous_date: date | None = None,
    buyer: str | None = None,
    unit: str | None = None,
    section: str | None = None,
    report_type_id: UUID | None = None,
    classification: str | None = None,
) -> OperationalComparisonResponse:
    """Previous-day / nearest-previous-record comparison with delta indicators.

    When ``previous_date`` is omitted, the nearest previous operational date
    is resolved automatically.
    """
    comparison = await repository.get_operational_comparison(
        session,
        user=user,
        metric_key=metric,
        current_date=current_date,
        previous_date=previous_date,
        buyer=buyer,
        unit=unit,
        operational_section=section,
        report_type_id=report_type_id,
        classification=classification,
    )
    return serialize_operational_comparison(comparison)


@router.get("/operations/dimensions", response_model=OperationalDimensionsResponse)
async def get_operational_dimensions(
    session: SessionDep,
    user: ReportReaderDep,
    report_type_id: UUID | None = None,
) -> OperationalDimensionsResponse:
    """Distinct buyer/unit/metric/section/date values for filter dropdowns.

    MD07-5 Phase 4: scoped by ``report_type_id`` when supplied so dropdowns
    only surface dimensions from the selected report type.
    """
    data = await repository.list_operational_dimensions(
        session, user=user, report_type_id=report_type_id
    )
    return serialize_operational_dimensions(data)


@router.get("/operations/facts/{fact_id}/trace", response_model=OperationalFactTraceResponse)
async def trace_operational_fact(
    fact_id: UUID,
    session: SessionDep,
    user: ReportReaderDep,
) -> OperationalFactTraceResponse:
    """Trace a semantic fact back to workbook, sheet, cell, and section."""
    fact = await repository.get_accessible_operational_fact(
        session,
        fact_id=fact_id,
        user=user,
    )
    if fact is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Operational fact not found.",
        )
    return serialize_operational_fact_trace(fact)


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


@router.post(
    "/operations/rebuild",
    response_model=WorkbookRebuildResponse,
)
async def rebuild_all_operational_facts(
    session: SessionDep,
    user: ReportWriterDep,
) -> WorkbookRebuildResponse:
    """Rebuild operational facts for every accessible workbook (MD07-2B §7).

    Re-runs semantic extraction from each workbook's stored metadata so existing
    uploads gain evaluated formula values, separated Grand Total / Previous Day
    rows, classifications, and sanitised buyers — without re-uploading.
    """
    try:
        result = await rebuild_operational_facts(session, actor=user)
        await session.commit()
    except Exception:
        await session.rollback()
        raise
    return result


@router.post(
    "/workbooks/{uploaded_file_id}/rebuild",
    response_model=WorkbookRebuildResponse,
)
async def rebuild_workbook_operational_facts(
    uploaded_file_id: UUID,
    session: SessionDep,
    user: ReportWriterDep,
) -> WorkbookRebuildResponse:
    """Rebuild operational facts for a single uploaded workbook (MD07-2B §7)."""
    try:
        result = await rebuild_operational_facts(
            session,
            actor=user,
            uploaded_file_id=uploaded_file_id,
        )
        await session.commit()
    except Exception:
        await session.rollback()
        raise
    return result


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


@router.get("/workbooks", response_model=WorkbookInventoryResponse)
async def list_workbooks(
    session: SessionDep,
    user: ReportReaderDep,
    scope: Annotated[str, Query(pattern="^(all|active|archived)$")] = "all",
) -> WorkbookInventoryResponse:
    """Workbook inventory (MD07-3 Phase 1).

    Lists actual uploaded workbooks (not generated report templates) with their
    governance state and active operational-fact counts. ``scope`` filters to
    ``active`` (active + non-archived), ``archived``, or ``all``.
    """
    rows, total, active_count, archived_count = await repository.list_workbook_inventory(
        session,
        user=user,
        scope=scope,
    )
    return WorkbookInventoryResponse(
        workbooks=[serialize_workbook_inventory_item(row) for row in rows],
        total=total,
        active_count=active_count,
        archived_count=archived_count,
    )


@router.get("/workbooks/active-sources", response_model=ActiveSourcesResponse)
async def get_active_workbook_sources(
    session: SessionDep,
    user: ReportReaderDep,
) -> ActiveSourcesResponse:
    """Active operational sources dashboard card (MD07-3 Phase 6)."""
    (
        sources,
        active_count,
        total_facts,
        latest_upload,
    ) = await repository.list_active_workbook_sources(session, user=user)
    return ActiveSourcesResponse(
        active_workbook_count=active_count,
        total_operational_facts=total_facts,
        latest_upload_at=latest_upload,
        sources=[
            ActiveWorkbookSource(
                workbook_id=row["workbook_id"],
                filename=row["filename"],
                report_type_id=row.get("report_type_id"),
                report_type_name=row.get("report_type_name"),
                report_date=_active_source_report_date(row.get("report_date_text")),
                uploaded_at=row["uploaded_at"],
                operational_fact_count=int(row.get("operational_fact_count") or 0),
            )
            for row in sources
        ],
    )


@router.post("/workbooks/{uploaded_file_id}/activate", response_model=WorkbookActionResponse)
async def activate_workbook(
    uploaded_file_id: UUID,
    session: SessionDep,
    user: ReportWriterDep,
) -> WorkbookActionResponse:
    """Activate a workbook so it contributes to operational reporting (Phase 2)."""
    try:
        row = await set_workbook_active_state(
            session,
            uploaded_file_id=uploaded_file_id,
            actor=user,
            active=True,
        )
        await session.commit()
    except Exception:
        await session.rollback()
        raise
    return WorkbookActionResponse(workbook=serialize_workbook_inventory_item(row))


@router.post("/workbooks/{uploaded_file_id}/deactivate", response_model=WorkbookActionResponse)
async def deactivate_workbook(
    uploaded_file_id: UUID,
    session: SessionDep,
    user: ReportWriterDep,
) -> WorkbookActionResponse:
    """Deactivate a workbook so it is ignored by operational reporting (Phase 2)."""
    try:
        row = await set_workbook_active_state(
            session,
            uploaded_file_id=uploaded_file_id,
            actor=user,
            active=False,
        )
        await session.commit()
    except Exception:
        await session.rollback()
        raise
    return WorkbookActionResponse(workbook=serialize_workbook_inventory_item(row))


@router.post("/workbooks/{uploaded_file_id}/archive", response_model=WorkbookActionResponse)
async def archive_workbook_endpoint(
    uploaded_file_id: UUID,
    session: SessionDep,
    user: ReportWriterDep,
) -> WorkbookActionResponse:
    """Archive a workbook (Phase 5): stored but excluded from all reporting."""
    try:
        row = await archive_workbook(session, uploaded_file_id=uploaded_file_id, actor=user)
        await session.commit()
    except Exception:
        await session.rollback()
        raise
    return WorkbookActionResponse(workbook=serialize_workbook_inventory_item(row))


@router.post("/workbooks/{uploaded_file_id}/restore", response_model=WorkbookActionResponse)
async def restore_workbook_endpoint(
    uploaded_file_id: UUID,
    session: SessionDep,
    user: ReportWriterDep,
) -> WorkbookActionResponse:
    """Restore an archived workbook back into reporting (Phase 5)."""
    try:
        row = await restore_workbook(session, uploaded_file_id=uploaded_file_id, actor=user)
        await session.commit()
    except Exception:
        await session.rollback()
        raise
    return WorkbookActionResponse(workbook=serialize_workbook_inventory_item(row))


@router.delete("/workbooks/{uploaded_file_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_workbook_endpoint(
    uploaded_file_id: UUID,
    session: SessionDep,
    user: ReportAdminDep,
) -> Response:
    """Soft-delete a workbook and its operational facts (Phase 5, admin only)."""
    try:
        await delete_workbook(session, uploaded_file_id=uploaded_file_id, actor=user)
        await session.commit()
    except Exception:
        await session.rollback()
        raise
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/workbooks/upload",
    response_model=WorkbookUploadResponse,
    status_code=status.HTTP_201_CREATED,
)
async def upload_workbook(
    session: SessionDep,
    user: ReportWriterDep,
    file: Annotated[UploadFile, File(...)],
    replace_existing: Annotated[bool, Query()] = False,
) -> WorkbookUploadResponse:
    try:
        response = await save_and_parse_workbook_upload(
            session,
            file=file,
            actor=user,
            replace_existing=replace_existing,
        )
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


# NOTE: This bare ``/{report_id}`` GET is intentionally registered LAST.
# Starlette matches routes in registration order, so it must come after every
# concrete ``/...`` collection route (e.g. ``/workbooks``, ``/summaries``,
# ``/operations/*``). Otherwise a request like ``GET /reports/workbooks`` would
# match ``/{report_id}`` and fail UUID validation with a 422 (MD07-4 fix).
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
