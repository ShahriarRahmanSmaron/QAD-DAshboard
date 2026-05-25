from datetime import date
from uuid import UUID

from sqlalchemy import Select, func, or_, select, true
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from sqlalchemy.orm.interfaces import ExecutableOption
from sqlalchemy.sql.elements import ColumnElement

from app.auth.constants import Permission, UserRole
from app.auth.schemas import AuthUser
from app.reporting.models import Buyer, Report, ReportMetric, ReportRow, ReportType, Unit


def _report_access_filter(user: AuthUser) -> ColumnElement[bool]:
    if user.role == UserRole.ADMIN or Permission.REPORTS_READ.value in user.permissions:
        return true()
    return or_(Report.owner_user_id == user.id, Report.created_by_user_id == user.id)


def _report_write_filter(user: AuthUser) -> ColumnElement[bool]:
    if user.role == UserRole.ADMIN:
        return true()
    return or_(Report.owner_user_id == user.id, Report.created_by_user_id == user.id)


async def active_buyer_exists(session: AsyncSession, buyer_id: UUID) -> bool:
    result = await session.execute(
        select(Buyer.id).where(
            Buyer.id == buyer_id,
            Buyer.deleted_at.is_(None),
            Buyer.is_active.is_(True),
        )
    )
    return result.scalar_one_or_none() is not None


async def active_unit_exists(session: AsyncSession, unit_id: UUID) -> bool:
    result = await session.execute(
        select(Unit.id).where(
            Unit.id == unit_id,
            Unit.deleted_at.is_(None),
            Unit.is_active.is_(True),
        )
    )
    return result.scalar_one_or_none() is not None


async def active_report_type_exists(session: AsyncSession, report_type_id: UUID) -> bool:
    result = await session.execute(
        select(ReportType.id).where(
            ReportType.id == report_type_id,
            ReportType.deleted_at.is_(None),
            ReportType.is_active.is_(True),
        )
    )
    return result.scalar_one_or_none() is not None


def report_detail_options() -> tuple[ExecutableOption, ...]:
    return (
        selectinload(Report.buyer),
        selectinload(Report.unit),
        selectinload(Report.report_type),
        selectinload(Report.rows).selectinload(ReportRow.metrics),
        selectinload(Report.metrics),
    )


def accessible_report_query(user: AuthUser) -> Select[tuple[Report]]:
    return (
        select(Report)
        .where(Report.deleted_at.is_(None), _report_access_filter(user))
        .options(*report_detail_options())
    )


async def get_accessible_report(
    session: AsyncSession,
    *,
    report_id: UUID,
    user: AuthUser,
) -> Report | None:
    result = await session.execute(accessible_report_query(user).where(Report.id == report_id))
    return result.scalar_one_or_none()


async def get_writable_report(
    session: AsyncSession,
    *,
    report_id: UUID,
    user: AuthUser,
) -> Report | None:
    result = await session.execute(
        select(Report).where(
            Report.id == report_id,
            Report.deleted_at.is_(None),
            _report_write_filter(user),
        )
    )
    return result.scalar_one_or_none()


async def get_writable_report_by_natural_key(
    session: AsyncSession,
    *,
    report_type_id: UUID,
    buyer_id: UUID,
    unit_id: UUID,
    report_date: date,
    user: AuthUser,
) -> Report | None:
    result = await session.execute(
        select(Report)
        .where(
            Report.report_type_id == report_type_id,
            Report.buyer_id == buyer_id,
            Report.unit_id == unit_id,
            Report.report_date == report_date,
            Report.deleted_at.is_(None),
            _report_write_filter(user),
        )
        .options(*report_detail_options())
    )
    return result.scalar_one_or_none()


async def list_accessible_reports(
    session: AsyncSession,
    *,
    user: AuthUser,
    page: int,
    page_size: int,
) -> tuple[list[Report], int]:
    filters = (Report.deleted_at.is_(None), _report_access_filter(user))
    total_result = await session.execute(select(func.count()).select_from(Report).where(*filters))
    total = total_result.scalar_one()
    result = await session.execute(
        select(Report)
        .where(*filters)
        .options(*report_detail_options())
        .order_by(Report.report_date.desc(), Report.created_at.desc())
        .limit(page_size)
        .offset((page - 1) * page_size)
    )
    return list(result.scalars().unique().all()), int(total)


async def get_report_row(
    session: AsyncSession,
    *,
    report_id: UUID,
    row_id: UUID,
) -> ReportRow | None:
    result = await session.execute(
        select(ReportRow).where(
            ReportRow.id == row_id,
            ReportRow.report_id == report_id,
            ReportRow.deleted_at.is_(None),
        )
    )
    return result.scalar_one_or_none()


def add_report(session: AsyncSession, report: Report) -> None:
    session.add(report)


def add_report_row(session: AsyncSession, row: ReportRow) -> None:
    session.add(row)


def add_report_metric(session: AsyncSession, metric: ReportMetric) -> None:
    session.add(metric)


async def list_active_buyers(session: AsyncSession) -> list[Buyer]:
    result = await session.execute(
        select(Buyer)
        .where(Buyer.deleted_at.is_(None), Buyer.is_active.is_(True))
        .order_by(Buyer.name)
    )
    return list(result.scalars().all())


async def list_active_units(session: AsyncSession) -> list[Unit]:
    result = await session.execute(
        select(Unit)
        .where(Unit.deleted_at.is_(None), Unit.is_active.is_(True))
        .order_by(Unit.name)
    )
    return list(result.scalars().all())


async def list_active_report_types(session: AsyncSession) -> list[ReportType]:
    result = await session.execute(
        select(ReportType)
        .where(ReportType.deleted_at.is_(None), ReportType.is_active.is_(True))
        .order_by(ReportType.name, ReportType.version)
    )
    return list(result.scalars().all())


async def validate_references_exist(
    session: AsyncSession,
    *,
    report_type_id: UUID,
    buyer_id: UUID,
    unit_id: UUID,
) -> dict[str, bool]:
    """Check buyer, unit, and report_type existence in a single round-trip."""
    from sqlalchemy import literal_column, union_all

    q_buyer = (
        select(literal_column("'buyer'").label("ref"))
        .select_from(Buyer)
        .where(Buyer.id == buyer_id, Buyer.deleted_at.is_(None), Buyer.is_active.is_(True))
    )
    q_unit = (
        select(literal_column("'unit'").label("ref"))
        .select_from(Unit)
        .where(Unit.id == unit_id, Unit.deleted_at.is_(None), Unit.is_active.is_(True))
    )
    q_rt = (
        select(literal_column("'report_type'").label("ref"))
        .select_from(ReportType)
        .where(
            ReportType.id == report_type_id,
            ReportType.deleted_at.is_(None),
            ReportType.is_active.is_(True),
        )
    )
    combined = union_all(q_buyer, q_unit, q_rt)
    result = await session.execute(combined)
    found = {row[0] for row in result.all()}
    return {
        "buyer": "buyer" in found,
        "unit": "unit" in found,
        "report_type": "report_type" in found,
    }


async def list_report_summaries(
    session: AsyncSession,
    *,
    user: AuthUser,
    page: int,
    page_size: int,
) -> tuple[list[dict], int]:
    """Return lightweight report summaries with row/metric counts (no eager loads)."""

    filters = (Report.deleted_at.is_(None), _report_access_filter(user))

    # Total count
    total_result = await session.execute(select(func.count()).select_from(Report).where(*filters))
    total = total_result.scalar_one()

    # Row count subquery
    row_count_sq = (
        select(func.count())
        .select_from(ReportRow)
        .where(ReportRow.report_id == Report.id, ReportRow.deleted_at.is_(None))
        .correlate(Report)
        .scalar_subquery()
        .label("row_count")
    )

    # Metric count subquery
    metric_count_sq = (
        select(func.count())
        .select_from(ReportMetric)
        .where(ReportMetric.report_id == Report.id, ReportMetric.deleted_at.is_(None))
        .correlate(Report)
        .scalar_subquery()
        .label("metric_count")
    )

    stmt = (
        select(
            Report.id,
            Report.report_type_id,
            ReportType.name.label("report_type_name"),
            Report.buyer_id,
            Buyer.name.label("buyer_name"),
            Report.unit_id,
            Unit.name.label("unit_name"),
            Report.owner_user_id,
            Report.report_date,
            Report.period_start,
            Report.period_end,
            Report.status,
            Report.title,
            Report.remarks,
            Report.created_at,
            Report.updated_at,
            row_count_sq,
            metric_count_sq,
        )
        .join(Buyer, Buyer.id == Report.buyer_id, isouter=True)
        .join(Unit, Unit.id == Report.unit_id, isouter=True)
        .join(ReportType, ReportType.id == Report.report_type_id, isouter=True)
        .where(*filters)
        .order_by(Report.report_date.desc(), Report.created_at.desc())
        .limit(page_size)
        .offset((page - 1) * page_size)
    )

    result = await session.execute(stmt)
    rows = [dict(row._mapping) for row in result.all()]
    return rows, int(total)
