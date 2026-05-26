from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.constants import UserRole
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
    BulkReportSaveRequest,
    ReportCreateRequest,
    ReportMetricCreateRequest,
    ReportMetricResponse,
    ReportResponse,
    ReportRowCreateRequest,
    ReportRowResponse,
    ReportSummary,
)


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
