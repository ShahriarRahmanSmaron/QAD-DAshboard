import logging
from datetime import UTC, date, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.constants import UserRole
from app.auth.schemas import AuthUser
from app.core.config import settings
from app.reporting import repository
from app.reporting.models import (
    AuditLog,
    OperationalFact,
    OperationalValueType,
    Report,
    ReportMetric,
    ReportRow,
    ReportStatus,
    ReportValueType,
)
from app.reporting.schemas import (
    BulkReportSaveRequest,
    OperationalAggregationResponse,
    OperationalAggregationRow,
    OperationalAggregationTotals,
    OperationalComparisonResponse,
    OperationalComparisonTotals,
    OperationalDimensionOption,
    OperationalDimensionsResponse,
    OperationalFactResponse,
    OperationalFactTraceResponse,
    OperationalFactTraceWorkbook,
    OperationalSummaryRow,
    OperationalTrendPoint,
    OperationalTrendResponse,
    OperationalWorkbookSourceRef,
    ReportCreateRequest,
    ReportMetricCreateRequest,
    ReportMetricResponse,
    ReportResponse,
    ReportRowCreateRequest,
    ReportRowResponse,
    ReportSummary,
    WorkbookInventoryItem,
    WorkbookRebuildResponse,
    WorkbookRebuildResult,
)

logger = logging.getLogger("app.reporting.service")


def _metadata(value: dict[str, Any]) -> dict[str, Any]:
    return dict(value)


PERSISTENT_REPORT_METADATA_KEYS = (
    "workbook_sync",
    "workbook_source",
    "workbook_geometry",
    "workbook_layout",
)


def _merge_persistent_report_metadata(
    *,
    existing: dict[str, Any],
    incoming: dict[str, Any],
) -> dict[str, Any]:
    merged = _metadata(incoming)
    for key in PERSISTENT_REPORT_METADATA_KEYS:
        if key not in merged and key in existing:
            merged[key] = existing[key]
    return merged


def serialize_metric(metric: ReportMetric) -> ReportMetricResponse:
    return ReportMetricResponse(
        id=metric.id,
        report_id=metric.report_id,
        row_id=metric.row_id,
        metric_key=metric.metric_key,
        metric_label=metric.metric_label,
        value_type=ReportValueType(metric.value_type),
        value_numeric=metric.value_numeric,
        value_text=metric.value_text,
        value_date=metric.value_date,
        value_boolean=metric.value_boolean,
        unit_of_measure=metric.unit_of_measure,
        source_sheet_name=metric.source_sheet_name,
        source_cell_address=metric.source_cell_address,
        sort_order=metric.sort_order,
        metadata=metric.metadata_,
        created_at=metric.created_at,
        updated_at=metric.updated_at,
    )


def serialize_operational_fact(fact: OperationalFact) -> OperationalFactResponse:
    return OperationalFactResponse(
        id=fact.id,
        uploaded_file_id=fact.uploaded_file_id,
        report_id=fact.report_id,
        buyer_id=fact.buyer_id,
        unit_id=fact.unit_id,
        buyer=fact.buyer,
        unit=fact.unit,
        report_date=fact.report_date,
        metric_key=fact.metric_key,
        metric_label=fact.metric_label,
        operational_section=fact.operational_section,
        operational_section_label=fact.operational_section_label,
        operational_row_key=fact.operational_row_key,
        operational_row_label=fact.operational_row_label,
        column_label=fact.column_label,
        value_type=OperationalValueType(fact.value_type),
        value_numeric=fact.value_numeric,
        value_text=fact.value_text,
        value_date=fact.value_date,
        value_boolean=fact.value_boolean,
        unit_of_measure=fact.unit_of_measure,
        is_formula=fact.is_formula,
        formula=fact.formula,
        calculated_state=fact.calculated_state,
        row_classification=fact.row_classification,
        is_active=fact.is_active,
        inactive_reason=fact.inactive_reason,
        source_sheet_name=fact.source_sheet_name,
        source_sheet_index=fact.source_sheet_index,
        source_cell_address=fact.source_cell_address,
        source_row_number=fact.source_row_number,
        source_column_number=fact.source_column_number,
        source_region_id=fact.source_region_id,
        source_region_kind=fact.source_region_kind,
        source_region_range=fact.source_region_range,
        workbook_sheet_identity=fact.workbook_sheet_identity,
        workbook_source=fact.workbook_source,
        metadata=fact.metadata_,
        created_at=fact.created_at,
        updated_at=fact.updated_at,
    )


def serialize_operational_summary_row(row: dict[str, Any]) -> OperationalSummaryRow:
    return OperationalSummaryRow(
        metric_key=row["metric_key"],
        metric_label=row["metric_label"],
        operational_section=row["operational_section"],
        buyer=row.get("buyer"),
        unit=row.get("unit"),
        report_date=row.get("report_date"),
        fact_count=row.get("fact_count", 0),
        numeric_total=row.get("numeric_total"),
        formula_count=row.get("formula_count", 0),
    )


# ---------------------------------------------------------------------------
# Operational query layer serializers (MD07-2)
# ---------------------------------------------------------------------------

_AGGREGATION_KEYS = ("buyer", "unit", "metric", "section", "report_date", "report_type", "workbook")


def _decimal_or_none(value: Any) -> Decimal | None:
    if value is None:
        return None
    if isinstance(value, Decimal):
        return value
    return Decimal(str(value))


def serialize_operational_aggregation(
    *,
    group_by: list[str],
    rows: list[dict[str, Any]],
    overall: dict[str, Any],
) -> OperationalAggregationResponse:
    aggregation_rows: list[OperationalAggregationRow] = []
    for row in rows:
        group: dict[str, Any] = {}
        for key in group_by:
            if key not in row:
                continue
            value = row[key]
            if isinstance(value, date):
                group[key] = value.isoformat()
            elif isinstance(value, UUID):
                group[key] = str(value)
            else:
                group[key] = value
        aggregation_rows.append(
            OperationalAggregationRow(
                group=group,
                numeric_total=_decimal_or_none(row.get("numeric_total")),
                fact_count=int(row.get("fact_count", 0) or 0),
                formula_count=int(row.get("formula_count", 0) or 0),
                numeric_count=int(row.get("numeric_count", 0) or 0),
            )
        )
    return OperationalAggregationResponse(
        group_by=group_by,
        rows=aggregation_rows,
        totals=OperationalAggregationTotals(
            numeric_total=_decimal_or_none(overall.get("numeric_total")),
            fact_count=int(overall.get("fact_count", 0) or 0),
            formula_count=int(overall.get("formula_count", 0) or 0),
            numeric_count=int(overall.get("numeric_count", 0) or 0),
        ),
        total=len(aggregation_rows),
    )


def serialize_operational_trend(
    *,
    metric_key: str,
    buyer: str | None,
    unit: str | None,
    operational_section: str | None,
    rows: list[dict[str, Any]],
    series_by: str | None = None,
) -> OperationalTrendResponse:
    points = [
        OperationalTrendPoint(
            report_date=row["report_date"],
            numeric_total=_decimal_or_none(row.get("numeric_total")),
            fact_count=int(row.get("fact_count", 0) or 0),
            numeric_count=int(row.get("numeric_count", 0) or 0),
            workbook_names=[
                str(name)
                for name in (row.get("workbook_names") or [])
                if name
            ],
            series=row.get("series"),
        )
        for row in rows
        if row.get("report_date") is not None
    ]
    return OperationalTrendResponse(
        metric_key=metric_key,
        buyer=buyer,
        unit=unit,
        operational_section=operational_section,
        series_by=series_by,
        points=points,
        total=len(points),
    )


def serialize_operational_comparison(comparison: dict[str, Any]) -> OperationalComparisonResponse:
    current = comparison.get("current") or {}
    previous = comparison.get("previous") or {}
    current_total = _decimal_or_none(current.get("numeric_total"))
    previous_total = _decimal_or_none(previous.get("numeric_total"))

    delta: Decimal | None = None
    delta_percent: float | None = None
    direction = "flat"
    if current_total is not None and previous_total is not None:
        delta = current_total - previous_total
        if previous_total != 0:
            delta_percent = float(delta / previous_total * 100)
        if delta > 0:
            direction = "up"
        elif delta < 0:
            direction = "down"

    return OperationalComparisonResponse(
        metric_key=comparison["metric_key"],
        buyer=comparison.get("buyer"),
        unit=comparison.get("unit"),
        operational_section=comparison.get("operational_section"),
        current_date=comparison["current_date"],
        previous_date=comparison.get("previous_date"),
        current=OperationalComparisonTotals(
            numeric_total=current_total,
            fact_count=int(current.get("fact_count", 0) or 0),
            numeric_count=int(current.get("numeric_count", 0) or 0),
        ),
        previous=OperationalComparisonTotals(
            numeric_total=previous_total,
            fact_count=int(previous.get("fact_count", 0) or 0),
            numeric_count=int(previous.get("numeric_count", 0) or 0),
        ),
        delta=delta,
        delta_percent=delta_percent,
        direction=direction,
        current_sources=_workbook_source_refs(comparison.get("current_sources")),
        previous_sources=_workbook_source_refs(comparison.get("previous_sources")),
    )


def _workbook_source_refs(rows: Any) -> list[OperationalWorkbookSourceRef]:
    if not isinstance(rows, list):
        return []
    refs: list[OperationalWorkbookSourceRef] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        workbook_id = row.get("workbook_id")
        filename = row.get("filename")
        if workbook_id is None or filename is None:
            continue
        refs.append(
            OperationalWorkbookSourceRef(
                workbook_id=workbook_id,
                filename=str(filename),
                fact_count=int(row.get("fact_count", 0) or 0),
            )
        )
    return refs


def serialize_operational_dimensions(
    data: dict[str, list[dict[str, Any]]],
) -> OperationalDimensionsResponse:
    def _options(rows: list[dict[str, Any]]) -> list[OperationalDimensionOption]:
        return [
            OperationalDimensionOption(value=str(row["value"]), label=str(row["label"]))
            for row in rows
        ]

    return OperationalDimensionsResponse(
        buyers=_options(data.get("buyers", [])),
        units=_options(data.get("units", [])),
        metrics=_options(data.get("metrics", [])),
        sections=_options(data.get("sections", [])),
        dates=_options(data.get("dates", [])),
    )


def serialize_operational_fact_trace(fact: OperationalFact) -> OperationalFactTraceResponse:
    uploaded_file = fact.uploaded_file
    raw_metadata = fact.metadata_ if isinstance(fact.metadata_, dict) else {}
    confidence = raw_metadata.get("mapping_confidence")
    extraction_confidence = confidence if isinstance(confidence, dict) else {}
    extraction_source = raw_metadata.get("engine")
    ownership = raw_metadata.get("ownership")
    ownership_payload = ownership if isinstance(ownership, dict) else {}

    workbook = OperationalFactTraceWorkbook(
        uploaded_file_id=fact.uploaded_file_id,
        original_filename=uploaded_file.original_filename if uploaded_file else None,
        storage_bucket=uploaded_file.storage_bucket if uploaded_file else None,
        storage_path=uploaded_file.storage_path if uploaded_file else None,
        report_type_id=uploaded_file.report_type_id if uploaded_file else None,
        buyer_id=uploaded_file.buyer_id if uploaded_file else None,
        unit_id=uploaded_file.unit_id if uploaded_file else None,
        uploaded_at=uploaded_file.created_at if uploaded_file else None,
        workbook_source=fact.workbook_source if isinstance(fact.workbook_source, dict) else {},
    )
    return OperationalFactTraceResponse(
        fact=serialize_operational_fact(fact),
        workbook=workbook,
        sheet_name=fact.source_sheet_name,
        sheet_index=fact.source_sheet_index,
        cell_address=fact.source_cell_address,
        operational_section=fact.operational_section,
        operational_section_label=fact.operational_section_label,
        source_region_id=fact.source_region_id,
        source_region_kind=fact.source_region_kind,
        source_region_range=fact.source_region_range,
        extraction_confidence=extraction_confidence,
        extraction_source=extraction_source,
        ownership=ownership_payload,
        upload_timestamp=uploaded_file.created_at if uploaded_file else None,
    )


def serialize_row(row: ReportRow) -> ReportRowResponse:
    metrics = row.__dict__.get("metrics", [])
    return ReportRowResponse(
        id=row.id,
        report_id=row.report_id,
        owner_user_id=row.owner_user_id,
        row_key=row.row_key,
        row_label=row.row_label,
        row_group=row.row_group,
        sort_order=row.sort_order,
        source_sheet_name=row.source_sheet_name,
        source_row_number=row.source_row_number,
        metadata=row.metadata_,
        created_at=row.created_at,
        updated_at=row.updated_at,
        metrics=sorted(
            (serialize_metric(metric) for metric in metrics if metric.deleted_at is None),
            key=lambda metric: (metric.sort_order, metric.metric_key),
        ),
    )


def serialize_report(report: Report) -> ReportResponse:
    return ReportResponse(
        id=report.id,
        report_type_id=report.report_type_id,
        report_type_name=report.report_type.name if report.report_type else None,
        buyer_id=report.buyer_id,
        buyer_name=report.buyer.name if report.buyer else None,
        unit_id=report.unit_id,
        unit_name=report.unit.name if report.unit else None,
        owner_user_id=report.owner_user_id,
        report_date=report.report_date,
        period_start=report.period_start,
        period_end=report.period_end,
        status=ReportStatus(report.status),
        title=report.title,
        remarks=report.remarks,
        submitted_at=report.submitted_at,
        submitted_by_user_id=report.submitted_by_user_id,
        approved_at=report.approved_at,
        approved_by_user_id=report.approved_by_user_id,
        metadata=report.metadata_,
        created_at=report.created_at,
        updated_at=report.updated_at,
        rows=sorted(
            (serialize_row(row) for row in report.rows if row.deleted_at is None),
            key=lambda row: (row.sort_order, row.row_label or ""),
        ),
        metrics=sorted(
            (
                serialize_metric(metric)
                for metric in report.metrics
                if metric.deleted_at is None and metric.row_id is None
            ),
            key=lambda metric: (metric.sort_order, metric.metric_key),
        ),
    )


def add_audit_log(
    session: AsyncSession,
    *,
    actor: AuthUser,
    action: str,
    target_type: str,
    target_id: UUID,
    metadata: dict[str, Any],
    old_values: dict[str, Any] | None = None,
    new_values: dict[str, Any] | None = None,
) -> None:
    session.add(
        AuditLog(
            actor_id=actor.id,
            actor_user_id=actor.id,
            action=action,
            entity_type=target_type,
            entity_id=str(target_id),
            target_type=target_type,
            target_id=target_id,
            old_values=old_values or {},
            new_values=new_values or {},
            metadata_=metadata,
        )
    )


LOCKED_REPORT_STATUSES = {
    ReportStatus.IN_REVIEW.value,
    ReportStatus.APPROVED.value,
    ReportStatus.LOCKED.value,
    ReportStatus.ARCHIVED.value,
}

WORKFLOW_TRANSITIONS: dict[str, set[str]] = {
    "submit_for_review": {ReportStatus.DRAFT.value, ReportStatus.REJECTED.value},
    "approve": {ReportStatus.IN_REVIEW.value},
    "reject": {ReportStatus.IN_REVIEW.value},
    "lock": {
        ReportStatus.DRAFT.value,
        ReportStatus.IN_REVIEW.value,
        ReportStatus.APPROVED.value,
        ReportStatus.REJECTED.value,
    },
    "archive": {
        ReportStatus.DRAFT.value,
        ReportStatus.IN_REVIEW.value,
        ReportStatus.APPROVED.value,
        ReportStatus.REJECTED.value,
        ReportStatus.LOCKED.value,
    },
}

WORKFLOW_TARGET_STATUS = {
    "submit_for_review": ReportStatus.IN_REVIEW.value,
    "approve": ReportStatus.APPROVED.value,
    "reject": ReportStatus.REJECTED.value,
    "lock": ReportStatus.LOCKED.value,
    "archive": ReportStatus.ARCHIVED.value,
}

EDITOR_WORKFLOW_ACTIONS = {"submit_for_review"}
ADMIN_WORKFLOW_ACTIONS = {"approve", "reject", "lock", "archive"}


def _ensure_report_editable(report: Report) -> None:
    if report.status in LOCKED_REPORT_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Report is {report.status} and cannot be edited.",
        )


def _ensure_workflow_permission(actor: AuthUser, action: str) -> None:
    if actor.role == UserRole.ADMIN:
        return
    if actor.role == UserRole.EDITOR and action in EDITOR_WORKFLOW_ACTIONS:
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="You do not have permission to perform this workflow action.",
    )


async def create_report(
    session: AsyncSession,
    *,
    payload: ReportCreateRequest,
    actor: AuthUser,
) -> Report:
    if not await repository.active_report_type_exists(session, payload.report_type_id):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Invalid report type.",
        )
    if not await repository.active_buyer_exists(session, payload.buyer_id):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Invalid buyer.",
        )
    if not await repository.active_unit_exists(session, payload.unit_id):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Invalid unit.",
        )

    report = Report(
        report_type_id=payload.report_type_id,
        buyer_id=payload.buyer_id,
        unit_id=payload.unit_id,
        owner_user_id=actor.id,
        report_date=payload.report_date,
        period_start=payload.period_start,
        period_end=payload.period_end,
        status=ReportStatus.DRAFT.value,
        title=payload.title,
        remarks=payload.remarks,
        metadata_=_metadata(payload.metadata),
        created_by_user_id=actor.id,
        updated_by_user_id=actor.id,
    )
    repository.add_report(session, report)

    try:
        await session.flush()
    except IntegrityError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An active report already exists for this type, buyer, unit, and date.",
        ) from exc

    add_audit_log(
        session,
        actor=actor,
        action="report.created",
        target_type="report",
        target_id=report.id,
        metadata={"report_date": payload.report_date.isoformat()},
    )
    await session.flush()
    return report


async def create_report_row(
    session: AsyncSession,
    *,
    report_id: UUID,
    payload: ReportRowCreateRequest,
    actor: AuthUser,
) -> ReportRow:
    report = await repository.get_writable_report(session, report_id=report_id, user=actor)
    if report is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Report not found.")
    _ensure_report_editable(report)

    row = ReportRow(
        report_id=report_id,
        owner_user_id=actor.id,
        row_key=payload.row_key.strip() if payload.row_key else None,
        row_label=payload.row_label,
        row_group=payload.row_group,
        sort_order=payload.sort_order,
        source_sheet_name=payload.source_sheet_name,
        source_row_number=payload.source_row_number,
        metadata_=_metadata(payload.metadata),
        created_by_user_id=actor.id,
        updated_by_user_id=actor.id,
    )
    repository.add_report_row(session, row)

    try:
        await session.flush()
    except IntegrityError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A row with this key already exists for the report.",
        ) from exc

    add_audit_log(
        session,
        actor=actor,
        action="report_row.created",
        target_type="report_row",
        target_id=row.id,
        metadata={"report_id": str(report_id), "row_key": row.row_key},
    )
    await session.flush()
    return row


async def create_report_metric(
    session: AsyncSession,
    *,
    report_id: UUID,
    payload: ReportMetricCreateRequest,
    actor: AuthUser,
) -> ReportMetric:
    report = await repository.get_writable_report(session, report_id=report_id, user=actor)
    if report is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Report not found.")
    _ensure_report_editable(report)

    if payload.row_id is not None:
        row = await repository.get_report_row(session, report_id=report_id, row_id=payload.row_id)
        if row is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Metric row does not belong to this report.",
            )

    metric = ReportMetric(
        report_id=report_id,
        row_id=payload.row_id,
        metric_key=payload.metric_key.strip(),
        metric_label=payload.metric_label,
        value_type=payload.value_type.value,
        value_numeric=payload.value_numeric,
        value_text=payload.value_text,
        value_date=payload.value_date,
        value_boolean=payload.value_boolean,
        unit_of_measure=payload.unit_of_measure,
        source_sheet_name=payload.source_sheet_name,
        source_cell_address=payload.source_cell_address,
        sort_order=payload.sort_order,
        metadata_=_metadata(payload.metadata),
        created_by_user_id=actor.id,
        updated_by_user_id=actor.id,
    )
    repository.add_report_metric(session, metric)

    try:
        await session.flush()
    except IntegrityError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A metric with this key already exists at this scope.",
        ) from exc

    add_audit_log(
        session,
        actor=actor,
        action="report_metric.created",
        target_type="report_metric",
        target_id=metric.id,
        metadata={"report_id": str(report_id), "metric_key": metric.metric_key},
    )
    await session.flush()
    return metric


def serialize_report_summary(row: dict) -> ReportSummary:
    """Convert a flat row dict from list_report_summaries into a ReportSummary."""
    return ReportSummary(
        id=row["id"],
        report_type_id=row["report_type_id"],
        report_type_name=row.get("report_type_name"),
        buyer_id=row["buyer_id"],
        buyer_name=row.get("buyer_name"),
        unit_id=row["unit_id"],
        unit_name=row.get("unit_name"),
        owner_user_id=row.get("owner_user_id"),
        report_date=row["report_date"],
        period_start=row.get("period_start"),
        period_end=row.get("period_end"),
        status=ReportStatus(row["status"]),
        title=row.get("title"),
        remarks=row.get("remarks"),
        submitted_at=row.get("submitted_at"),
        submitted_by_user_id=row.get("submitted_by_user_id"),
        approved_at=row.get("approved_at"),
        approved_by_user_id=row.get("approved_by_user_id"),
        row_count=row.get("row_count", 0),
        metric_count=row.get("metric_count", 0),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


async def bulk_save_report(
    session: AsyncSession,
    *,
    payload: BulkReportSaveRequest,
    actor: AuthUser,
) -> Report:
    """Create a full report tree (header + rows + metrics) in a single transaction.

    Validates references in one query, bulk-inserts all rows and metrics,
    and emits a single audit log entry.
    """
    # Validate all FK references in one round-trip
    refs = await repository.validate_references_exist(
        session,
        report_type_id=payload.report_type_id,
        buyer_id=payload.buyer_id,
        unit_id=payload.unit_id,
    )
    if not refs["report_type"]:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Invalid report type.",
        )
    if not refs["buyer"]:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Invalid buyer.",
        )
    if not refs["unit"]:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Invalid unit.",
        )

    report = await repository.get_writable_report_by_natural_key(
        session,
        report_type_id=payload.report_type_id,
        buyer_id=payload.buyer_id,
        unit_id=payload.unit_id,
        report_date=payload.report_date,
        user=actor,
    )
    is_update = report is not None

    if report is None:
        report = Report(
            report_type_id=payload.report_type_id,
            buyer_id=payload.buyer_id,
            unit_id=payload.unit_id,
            owner_user_id=actor.id,
            report_date=payload.report_date,
            period_start=payload.period_start,
            period_end=payload.period_end,
            status=ReportStatus.DRAFT.value,
            title=payload.title,
            remarks=payload.remarks,
            metadata_=_metadata(payload.metadata),
            created_by_user_id=actor.id,
            updated_by_user_id=actor.id,
        )
        session.add(report)

        try:
            await session.flush()
        except IntegrityError as exc:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="An active report already exists for this type, buyer, unit, and date.",
            ) from exc
    else:
        _ensure_report_editable(report)
        deleted_at = datetime.now(UTC)
        for metric in report.metrics:
            if metric.deleted_at is None:
                metric.deleted_at = deleted_at
                metric.deleted_by_user_id = actor.id
                metric.updated_by_user_id = actor.id
        for row in report.rows:
            if row.deleted_at is None:
                row.deleted_at = deleted_at
                row.deleted_by_user_id = actor.id
                row.updated_by_user_id = actor.id

        report.period_start = payload.period_start
        report.period_end = payload.period_end
        report.title = payload.title
        report.remarks = payload.remarks
        report.metadata_ = _merge_persistent_report_metadata(
            existing=report.metadata_,
            incoming=payload.metadata,
        )
        report.updated_by_user_id = actor.id
        await session.flush()

    # Bulk-insert rows and their nested metrics
    all_rows: list[ReportRow] = []
    all_metrics: list[ReportMetric] = []

    for row_payload in payload.rows:
        row = ReportRow(
            report_id=report.id,
            owner_user_id=actor.id,
            row_key=row_payload.row_key.strip() if row_payload.row_key else None,
            row_label=row_payload.row_label,
            row_group=row_payload.row_group,
            sort_order=row_payload.sort_order,
            source_sheet_name=row_payload.source_sheet_name,
            source_row_number=row_payload.source_row_number,
            metadata_=_metadata(row_payload.metadata),
            created_by_user_id=actor.id,
            updated_by_user_id=actor.id,
        )
        all_rows.append(row)

    if all_rows:
        session.add_all(all_rows)
        try:
            await session.flush()  # assigns IDs to rows
        except IntegrityError as exc:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Duplicate row key within this report.",
            ) from exc

    # Now create metrics attached to their rows
    for row, row_payload in zip(all_rows, payload.rows, strict=True):
        for metric_payload in row_payload.metrics:
            metric = ReportMetric(
                report_id=report.id,
                row_id=row.id,
                metric_key=metric_payload.metric_key.strip(),
                metric_label=metric_payload.metric_label,
                value_type=metric_payload.value_type.value,
                value_numeric=metric_payload.value_numeric,
                value_text=metric_payload.value_text,
                value_date=metric_payload.value_date,
                value_boolean=metric_payload.value_boolean,
                unit_of_measure=metric_payload.unit_of_measure,
                source_sheet_name=metric_payload.source_sheet_name,
                source_cell_address=metric_payload.source_cell_address,
                sort_order=metric_payload.sort_order,
                metadata_=_metadata(metric_payload.metadata),
                created_by_user_id=actor.id,
                updated_by_user_id=actor.id,
            )
            all_metrics.append(metric)

    # Report-level metrics (not attached to a row)
    for report_metric_payload in payload.metrics:
        metric = ReportMetric(
            report_id=report.id,
            row_id=None,
            metric_key=report_metric_payload.metric_key.strip(),
            metric_label=report_metric_payload.metric_label,
            value_type=report_metric_payload.value_type.value,
            value_numeric=report_metric_payload.value_numeric,
            value_text=report_metric_payload.value_text,
            value_date=report_metric_payload.value_date,
            value_boolean=report_metric_payload.value_boolean,
            unit_of_measure=report_metric_payload.unit_of_measure,
            source_sheet_name=report_metric_payload.source_sheet_name,
            source_cell_address=report_metric_payload.source_cell_address,
            sort_order=report_metric_payload.sort_order,
            metadata_=_metadata(report_metric_payload.metadata),
            created_by_user_id=actor.id,
            updated_by_user_id=actor.id,
        )
        all_metrics.append(metric)

    if all_metrics:
        session.add_all(all_metrics)
        try:
            await session.flush()
        except IntegrityError as exc:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Duplicate row key or metric key within this report.",
            ) from exc

    # Single audit log entry for the entire save
    add_audit_log(
        session,
        actor=actor,
        action="report.bulk_saved" if not is_update else "report.bulk_replaced",
        target_type="report",
        target_id=report.id,
        metadata={
            "report_date": payload.report_date.isoformat(),
            "row_count": len(all_rows),
            "metric_count": len(all_metrics),
            "mode": "update" if is_update else "create",
        },
    )
    await session.flush()
    return report


async def transition_report_workflow(
    session: AsyncSession,
    *,
    report_id: UUID,
    action: str,
    actor: AuthUser,
) -> Report:
    _ensure_workflow_permission(actor, action)
    if action not in WORKFLOW_TARGET_STATUS:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Workflow action not found.",
        )

    report = await repository.get_accessible_report(session, report_id=report_id, user=actor)
    if report is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Report not found.")

    previous_status = report.status
    allowed_previous_states = WORKFLOW_TRANSITIONS[action]
    if previous_status not in allowed_previous_states:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Cannot {action.replace('_', ' ')} a {previous_status} report.",
        )

    next_status = WORKFLOW_TARGET_STATUS[action]
    now = datetime.now(UTC)
    report.status = next_status
    report.updated_by_user_id = actor.id

    if action == "submit_for_review":
        report.submitted_at = now
        report.submitted_by_user_id = actor.id
        report.approved_at = None
        report.approved_by_user_id = None
    elif action == "approve":
        report.approved_at = now
        report.approved_by_user_id = actor.id
    elif action == "reject":
        report.approved_at = None
        report.approved_by_user_id = None

    add_audit_log(
        session,
        actor=actor,
        action=f"report.workflow.{action}",
        target_type="report",
        target_id=report.id,
        old_values={"status": previous_status},
        new_values={"status": next_status},
        metadata={
            "previous_state": previous_status,
            "new_state": next_status,
            "transition": action,
        },
    )
    await session.flush()
    return report


async def rebuild_operational_facts(
    session: AsyncSession,
    *,
    actor: AuthUser,
    uploaded_file_id: UUID | None = None,
) -> WorkbookRebuildResponse:
    """Rebuild operational facts for one workbook or every accessible workbook.

    MD07-2B §7 rebuild path: re-runs semantic extraction from each workbook's
    already-parsed metadata (no re-upload), so existing uploads gain evaluated
    formula values, separated Grand Total / Previous Day rows, row
    classifications, and sanitised buyers. Returns a per-workbook summary.
    """
    from app.reporting.workbook_semantics import rebuild_workbook_semantics

    if uploaded_file_id is not None:
        target = await repository.get_accessible_uploaded_file(
            session,
            uploaded_file_id=uploaded_file_id,
            user=actor,
        )
        if target is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Workbook not found.",
            )
        uploaded_files = [target]
    else:
        uploaded_files = await repository.list_accessible_uploaded_files(session, user=actor)

    results: list[WorkbookRebuildResult] = []
    rebuilt = 0
    failed = 0
    for uploaded_file in uploaded_files:
        metadata = uploaded_file.metadata_ or {}
        # Skip workbooks that were never parsed into sheets (nothing to rebuild).
        if not isinstance(metadata, dict) or not metadata.get("sheets"):
            results.append(
                WorkbookRebuildResult(
                    uploaded_file_id=uploaded_file.id,
                    original_filename=uploaded_file.original_filename,
                    status="skipped",
                    error="No parsed workbook metadata to rebuild from.",
                )
            )
            continue
        try:
            extraction = await rebuild_workbook_semantics(
                session,
                uploaded_file=uploaded_file,
                actor=actor,
            )
        except Exception as exc:  # noqa: BLE001 - report per-workbook, keep going
            failed += 1
            results.append(
                WorkbookRebuildResult(
                    uploaded_file_id=uploaded_file.id,
                    original_filename=uploaded_file.original_filename,
                    status="failed",
                    error=str(exc),
                )
            )
            continue

        classification_counts: dict[str, int] = {}
        active = 0
        inactive = 0
        for fact in extraction.facts:
            classification_counts[fact.row_classification] = (
                classification_counts.get(fact.row_classification, 0) + 1
            )
            if fact.is_active:
                active += 1
            else:
                inactive += 1

        rebuilt += 1
        results.append(
            WorkbookRebuildResult(
                uploaded_file_id=uploaded_file.id,
                original_filename=uploaded_file.original_filename,
                status="rebuilt",
                fact_count=len(extraction.facts),
                active_fact_count=active,
                inactive_fact_count=inactive,
                classification_counts=classification_counts,
            )
        )

    add_audit_log(
        session,
        actor=actor,
        action="operational_facts.rebuilt",
        target_type="uploaded_file",
        target_id=uploaded_file_id or actor.id,
        metadata={
            "scope": "single" if uploaded_file_id else "all",
            "rebuilt": rebuilt,
            "failed": failed,
            "workbook_count": len(uploaded_files),
        },
    )
    await session.flush()
    return WorkbookRebuildResponse(rebuilt=rebuilt, failed=failed, results=results)


# ---------------------------------------------------------------------------
# MD07-3: Workbook governance service layer
# ---------------------------------------------------------------------------


def _workbook_report_date(metadata: dict[str, Any] | None) -> date | None:
    """Read the persisted semantic report_date from workbook metadata."""
    if not isinstance(metadata, dict):
        return None
    semantic_mapping = metadata.get("semantic_mapping")
    if isinstance(semantic_mapping, dict):
        value = semantic_mapping.get("report_date")
        if isinstance(value, str) and value:
            try:
                return date.fromisoformat(value)
            except ValueError:
                return None
    return None


def _coerce_report_date(value: object) -> date | None:
    """Parse a report_date that the query already extracted as ISO text.

    The governance queries select ``metadata -> semantic_mapping ->>
    report_date`` directly (instead of the whole metadata blob), so the row
    carries a plain ISO string. ``None`` and unparseable values yield ``None``.
    """
    if isinstance(value, date):
        return value
    if isinstance(value, str) and value:
        try:
            return date.fromisoformat(value)
        except ValueError:
            return None
    return None


def serialize_workbook_inventory_item(row: dict[str, Any]) -> WorkbookInventoryItem:
    """Convert a flat inventory row dict into a WorkbookInventoryItem."""
    status = str(row.get("status") or "")
    # Prefer the directly-extracted report_date text (governance queries select
    # only the JSONB path). Fall back to the full metadata blob for callers /
    # tests that still pass it.
    if "report_date_text" in row:
        report_date = _coerce_report_date(row.get("report_date_text"))
    else:
        report_date = _workbook_report_date(row.get("metadata"))
    return WorkbookInventoryItem(
        workbook_id=row["workbook_id"],
        filename=row["filename"],
        report_type_id=row.get("report_type_id"),
        report_type_name=row.get("report_type_name"),
        report_date=report_date,
        uploaded_at=row["uploaded_at"],
        uploaded_by_user_id=row.get("uploaded_by_user_id"),
        status=status,
        is_active_workbook=bool(row.get("is_active_workbook")),
        archived_at=row.get("archived_at"),
        processed=status == "processed",
        operational_fact_count=int(row.get("operational_fact_count") or 0),
        file_size_bytes=row.get("file_size_bytes"),
    )


async def set_workbook_active_state(
    session: AsyncSession,
    *,
    uploaded_file_id: UUID,
    actor: AuthUser,
    active: bool,
) -> dict[str, Any]:
    """Activate or deactivate a workbook (Phase 2).

    Activating an archived workbook also un-archives it so it can rejoin
    reporting. Returns the refreshed inventory row dict.
    """
    uploaded_file = await repository.get_accessible_uploaded_file(
        session,
        uploaded_file_id=uploaded_file_id,
        user=actor,
    )
    if uploaded_file is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Workbook not found.",
        )

    previous = uploaded_file.is_active_workbook
    uploaded_file.is_active_workbook = active
    if active and uploaded_file.archived_at is not None:
        uploaded_file.archived_at = None
        uploaded_file.archived_by_user_id = None

    add_audit_log(
        session,
        actor=actor,
        action="workbook.activated" if active else "workbook.deactivated",
        target_type="uploaded_file",
        target_id=uploaded_file.id,
        old_values={"is_active_workbook": previous},
        new_values={"is_active_workbook": active},
        metadata={"original_filename": uploaded_file.original_filename},
    )
    await session.flush()

    row = await repository.get_workbook_inventory_item(
        session,
        user=actor,
        uploaded_file_id=uploaded_file_id,
    )
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Workbook not found.",
        )
    return row


async def archive_workbook(
    session: AsyncSession,
    *,
    uploaded_file_id: UUID,
    actor: AuthUser,
) -> dict[str, Any]:
    """Archive a workbook (Phase 5).

    Archived workbooks remain stored but are excluded from all reporting,
    dropdowns, and comparisons. Archiving also deactivates the workbook.
    """
    uploaded_file = await repository.get_accessible_uploaded_file(
        session,
        uploaded_file_id=uploaded_file_id,
        user=actor,
    )
    if uploaded_file is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Workbook not found.",
        )

    uploaded_file.archived_at = datetime.now(UTC)
    uploaded_file.archived_by_user_id = actor.id
    uploaded_file.is_active_workbook = False

    add_audit_log(
        session,
        actor=actor,
        action="workbook.archived",
        target_type="uploaded_file",
        target_id=uploaded_file.id,
        metadata={"original_filename": uploaded_file.original_filename},
    )
    await session.flush()

    row = await repository.get_workbook_inventory_item(
        session,
        user=actor,
        uploaded_file_id=uploaded_file_id,
    )
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Workbook not found.",
        )
    return row


async def restore_workbook(
    session: AsyncSession,
    *,
    uploaded_file_id: UUID,
    actor: AuthUser,
) -> dict[str, Any]:
    """Restore an archived workbook back into reporting (un-archive + activate)."""
    uploaded_file = await repository.get_accessible_uploaded_file(
        session,
        uploaded_file_id=uploaded_file_id,
        user=actor,
    )
    if uploaded_file is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Workbook not found.",
        )

    uploaded_file.archived_at = None
    uploaded_file.archived_by_user_id = None
    uploaded_file.is_active_workbook = True

    add_audit_log(
        session,
        actor=actor,
        action="workbook.restored",
        target_type="uploaded_file",
        target_id=uploaded_file.id,
        metadata={"original_filename": uploaded_file.original_filename},
    )
    await session.flush()

    row = await repository.get_workbook_inventory_item(
        session,
        user=actor,
        uploaded_file_id=uploaded_file_id,
    )
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Workbook not found.",
        )
    return row


async def delete_workbook(
    session: AsyncSession,
    *,
    uploaded_file_id: UUID,
    actor: AuthUser,
) -> None:
    """Permanently (hard) delete a workbook and its facts (Phase 5, admin only).

    MD07-4 Phase 5: deletion must remove data from the database. The workbook
    record and all of its operational facts are physically removed from
    ``uploaded_files`` and ``operational_facts`` so the workbook disappears
    from the active source inventory and every operational query. Reports that
    referenced the workbook keep their data (their ``source_file_id`` FK is
    cleared by ``ON DELETE SET NULL``). An audit-log entry is still written so
    the deletion itself remains traceable.
    """
    if actor.role != UserRole.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only administrators can delete workbooks.",
        )

    uploaded_file = await repository.get_accessible_uploaded_file(
        session,
        uploaded_file_id=uploaded_file_id,
        user=actor,
    )
    if uploaded_file is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Workbook not found.",
        )

    original_filename = uploaded_file.original_filename
    storage_bucket = uploaded_file.storage_bucket
    storage_path = uploaded_file.storage_path

    # Capture the audit entry *before* removing the row so the deletion stays
    # traceable. The audit_logs table has no FK to uploaded_files, so the
    # entry survives the hard delete.
    fact_count = await repository.hard_delete_workbook_facts(
        session,
        uploaded_file_id=uploaded_file_id,
    )

    add_audit_log(
        session,
        actor=actor,
        action="workbook.deleted",
        target_type="uploaded_file",
        target_id=uploaded_file_id,
        metadata={
            "original_filename": original_filename,
            "deleted_fact_count": fact_count,
            "hard_delete": True,
        },
    )

    # SQLAlchemy tracks ``uploaded_file`` in the identity map; expunge it before
    # the bulk DELETE so the ORM does not attempt to flush a stale instance.
    await session.flush()
    session.expunge(uploaded_file)
    await repository.hard_delete_uploaded_file(
        session,
        uploaded_file_id=uploaded_file_id,
    )
    await session.flush()

    # Best-effort cleanup of the stored blob on disk. A failure here must not
    # roll back the database deletion, so it is logged and swallowed.
    _remove_workbook_blob(storage_bucket, storage_path, uploaded_file_id)


def _remove_workbook_blob(
    storage_bucket: str | None,
    storage_path: str | None,
    uploaded_file_id: UUID,
) -> None:
    """Delete the on-disk workbook blob written at upload time (best effort)."""
    if storage_bucket != "local" or not storage_path:
        return
    try:
        configured_path = Path(settings.uploaded_workbook_storage_dir)
        if configured_path.is_absolute():
            storage_root = configured_path
        else:
            storage_root = Path(__file__).resolve().parents[2] / configured_path
        base = storage_root.parent.resolve()
        candidate = (base / storage_path).resolve()
        # Guard against path traversal: only remove files under the storage root.
        candidate.relative_to(base)
        candidate.unlink(missing_ok=True)
    except (OSError, ValueError) as exc:
        logger.warning(
            "workbook blob cleanup failed: workbook=%s path=%s error=%s",
            uploaded_file_id,
            storage_path,
            exc,
        )
