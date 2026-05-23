from typing import Any
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.schemas import AuthUser
from app.reporting import repository
from app.reporting.models import (
    AuditLog,
    Report,
    ReportMetric,
    ReportRow,
    ReportStatus,
    ReportValueType,
)
from app.reporting.schemas import (
    ReportCreateRequest,
    ReportMetricCreateRequest,
    ReportMetricResponse,
    ReportResponse,
    ReportRowCreateRequest,
    ReportRowResponse,
)


def _metadata(value: dict[str, Any]) -> dict[str, Any]:
    return dict(value)


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
            metadata_=metadata,
        )
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
