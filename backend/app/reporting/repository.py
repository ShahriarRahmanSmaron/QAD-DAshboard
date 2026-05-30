from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Any
from uuid import UUID

from sqlalchemy import Select, delete, func, or_, select, true
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from sqlalchemy.orm.interfaces import ExecutableOption
from sqlalchemy.sql.elements import ColumnElement

from app.auth.constants import Permission, UserRole
from app.auth.schemas import AuthUser
from app.reporting.models import (
    Buyer,
    OperationalFact,
    Report,
    ReportMetric,
    ReportRow,
    ReportType,
    Unit,
    UploadedFile,
)


def _report_access_filter(user: AuthUser) -> ColumnElement[bool]:
    if user.role == UserRole.ADMIN or Permission.REPORTS_READ.value in user.permissions:
        return true()
    return or_(Report.owner_user_id == user.id, Report.created_by_user_id == user.id)


def _report_write_filter(user: AuthUser) -> ColumnElement[bool]:
    if user.role == UserRole.ADMIN:
        return true()
    return or_(Report.owner_user_id == user.id, Report.created_by_user_id == user.id)


def _uploaded_file_access_filter(user: AuthUser) -> ColumnElement[bool]:
    if user.role == UserRole.ADMIN or Permission.REPORTS_READ.value in user.permissions:
        return true()
    return UploadedFile.uploaded_by_user_id == user.id


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


async def get_accessible_uploaded_file(
    session: AsyncSession,
    *,
    uploaded_file_id: UUID,
    user: AuthUser,
) -> UploadedFile | None:
    result = await session.execute(
        select(UploadedFile).where(
            UploadedFile.id == uploaded_file_id,
            UploadedFile.deleted_at.is_(None),
            _uploaded_file_access_filter(user),
        )
    )
    return result.scalar_one_or_none()


async def replace_operational_facts(
    session: AsyncSession,
    *,
    uploaded_file_id: UUID,
    facts: list[OperationalFact],
) -> None:
    await session.execute(
        delete(OperationalFact).where(OperationalFact.uploaded_file_id == uploaded_file_id)
    )
    if facts:
        session.add_all(facts)
    await session.flush()


@dataclass(slots=True)
class OperationalFactFilters:
    """Structured filter set for the operational fact query engine (MD07-2).

    Centralizing the filter shape keeps the list/summary/aggregation/history
    queries consistent and lets every endpoint share the same exact, range,
    and multi-filter combination semantics without duplicating SQL.
    """

    uploaded_file_id: UUID | None = None
    buyer: str | None = None
    unit: str | None = None
    buyer_id: UUID | None = None
    unit_id: UUID | None = None
    metric_key: str | None = None
    operational_section: str | None = None
    report_type_id: UUID | None = None
    report_date: date | None = None
    date_from: date | None = None
    date_to: date | None = None
    value_min: Decimal | None = None
    value_max: Decimal | None = None
    value_type: str | None = None
    search: str | None = None


def _operational_fact_filters(
    user: AuthUser,
    filters: OperationalFactFilters,
) -> list[ColumnElement[bool]]:
    clauses: list[ColumnElement[bool]] = [
        OperationalFact.deleted_at.is_(None),
        UploadedFile.deleted_at.is_(None),
        _uploaded_file_access_filter(user),
    ]
    if filters.uploaded_file_id is not None:
        clauses.append(OperationalFact.uploaded_file_id == filters.uploaded_file_id)
    if filters.buyer:
        clauses.append(func.lower(OperationalFact.buyer) == filters.buyer.strip().lower())
    if filters.unit:
        clauses.append(func.lower(OperationalFact.unit) == filters.unit.strip().lower())
    if filters.buyer_id is not None:
        clauses.append(OperationalFact.buyer_id == filters.buyer_id)
    if filters.unit_id is not None:
        clauses.append(OperationalFact.unit_id == filters.unit_id)
    if filters.metric_key:
        clauses.append(func.lower(OperationalFact.metric_key) == filters.metric_key.strip().lower())
    if filters.operational_section:
        clauses.append(
            func.lower(OperationalFact.operational_section)
            == filters.operational_section.strip().lower()
        )
    if filters.report_type_id is not None:
        clauses.append(UploadedFile.report_type_id == filters.report_type_id)
    if filters.report_date is not None:
        clauses.append(OperationalFact.report_date == filters.report_date)
    if filters.date_from is not None:
        clauses.append(OperationalFact.report_date >= filters.date_from)
    if filters.date_to is not None:
        clauses.append(OperationalFact.report_date <= filters.date_to)
    if filters.value_min is not None:
        clauses.append(OperationalFact.value_numeric >= filters.value_min)
    if filters.value_max is not None:
        clauses.append(OperationalFact.value_numeric <= filters.value_max)
    if filters.value_type:
        clauses.append(OperationalFact.value_type == filters.value_type.strip().lower())
    if filters.search:
        needle = f"%{filters.search.strip().lower()}%"
        clauses.append(
            or_(
                func.lower(OperationalFact.metric_label).like(needle),
                func.lower(OperationalFact.metric_key).like(needle),
                func.lower(func.coalesce(OperationalFact.buyer, "")).like(needle),
                func.lower(func.coalesce(OperationalFact.unit, "")).like(needle),
                func.lower(OperationalFact.operational_section_label).like(needle),
                func.lower(func.coalesce(OperationalFact.operational_row_label, "")).like(needle),
            )
        )
    return clauses


async def list_operational_facts(
    session: AsyncSession,
    *,
    user: AuthUser,
    page: int,
    page_size: int,
    filters: OperationalFactFilters | None = None,
    uploaded_file_id: UUID | None = None,
    buyer: str | None = None,
    unit: str | None = None,
    metric_key: str | None = None,
    report_date: date | None = None,
) -> tuple[list[OperationalFact], int]:
    resolved = filters or OperationalFactFilters(
        uploaded_file_id=uploaded_file_id,
        buyer=buyer,
        unit=unit,
        metric_key=metric_key,
        report_date=report_date,
    )
    clauses = _operational_fact_filters(user, resolved)

    total_result = await session.execute(
        select(func.count())
        .select_from(OperationalFact)
        .join(UploadedFile, UploadedFile.id == OperationalFact.uploaded_file_id)
        .where(*clauses)
    )
    total = total_result.scalar_one()

    result = await session.execute(
        select(OperationalFact)
        .join(UploadedFile, UploadedFile.id == OperationalFact.uploaded_file_id)
        .where(*clauses)
        .order_by(
            OperationalFact.report_date.desc().nullslast(),
            OperationalFact.source_sheet_index.asc().nullslast(),
            OperationalFact.source_row_number,
            OperationalFact.source_column_number,
        )
        .limit(page_size)
        .offset((page - 1) * page_size)
    )
    return list(result.scalars().all()), int(total)


async def summarize_operational_facts(
    session: AsyncSession,
    *,
    user: AuthUser,
    filters: OperationalFactFilters | None = None,
    uploaded_file_id: UUID | None = None,
    buyer: str | None = None,
    unit: str | None = None,
    metric_key: str | None = None,
    report_date: date | None = None,
) -> list[dict[str, Any]]:
    resolved = filters or OperationalFactFilters(
        uploaded_file_id=uploaded_file_id,
        buyer=buyer,
        unit=unit,
        metric_key=metric_key,
        report_date=report_date,
    )
    clauses = _operational_fact_filters(user, resolved)

    stmt = (
        select(
            OperationalFact.metric_key,
            OperationalFact.metric_label,
            OperationalFact.operational_section,
            OperationalFact.buyer,
            OperationalFact.unit,
            OperationalFact.report_date,
            func.count(OperationalFact.id).label("fact_count"),
            func.sum(OperationalFact.value_numeric).label("numeric_total"),
            func.count(OperationalFact.id)
            .filter(OperationalFact.is_formula.is_(True))
            .label("formula_count"),
        )
        .select_from(OperationalFact)
        .join(UploadedFile, UploadedFile.id == OperationalFact.uploaded_file_id)
        .where(*clauses)
        .group_by(
            OperationalFact.metric_key,
            OperationalFact.metric_label,
            OperationalFact.operational_section,
            OperationalFact.buyer,
            OperationalFact.unit,
            OperationalFact.report_date,
        )
        .order_by(
            OperationalFact.report_date.desc().nullslast(),
            OperationalFact.metric_key,
            OperationalFact.buyer,
            OperationalFact.unit,
        )
    )
    result = await session.execute(stmt)
    return [dict(row._mapping) for row in result.all()]


# ---------------------------------------------------------------------------
# Operational aggregation layer (MD07-2)
# ---------------------------------------------------------------------------

# Whitelisted grouping dimensions for the aggregation endpoint. Keys map to the
# column the caller wants to group by; only these are accepted so the
# ``group_by`` clause can never be driven by untrusted input.
_AGGREGATION_DIMENSIONS: dict[str, Any] = {
    "buyer": OperationalFact.buyer,
    "unit": OperationalFact.unit,
    "metric": OperationalFact.metric_key,
    "section": OperationalFact.operational_section,
    "report_date": OperationalFact.report_date,
    "report_type": UploadedFile.report_type_id,
    "workbook": OperationalFact.uploaded_file_id,
}


def resolve_aggregation_dimensions(group_by: list[str] | None) -> list[str]:
    """Filter caller-supplied grouping keys down to the supported set."""
    return [key for key in (group_by or []) if key in _AGGREGATION_DIMENSIONS]


async def aggregate_operational_facts(
    session: AsyncSession,
    *,
    user: AuthUser,
    filters: OperationalFactFilters,
    group_by: list[str] | None = None,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Return grouped totals plus an overall total row.

    ``group_by`` accepts any subset of :data:`_AGGREGATION_DIMENSIONS` keys.
    Unknown keys are ignored. When no valid dimension is supplied only the
    grand total is returned. A single aggregate query backs both buyer/unit/
    section totals and arbitrary multi-dimension grouping to avoid N+1.
    """
    clauses = _operational_fact_filters(user, filters)
    requested = [key for key in (group_by or []) if key in _AGGREGATION_DIMENSIONS]

    numeric_total = func.coalesce(func.sum(OperationalFact.value_numeric), 0).label(
        "numeric_total"
    )
    fact_count = func.count(OperationalFact.id).label("fact_count")
    formula_count = (
        func.count(OperationalFact.id)
        .filter(OperationalFact.is_formula.is_(True))
        .label("formula_count")
    )
    numeric_count = (
        func.count(OperationalFact.value_numeric).label("numeric_count")
    )

    # Grand total (always computed in one round-trip).
    overall_result = await session.execute(
        select(numeric_total, fact_count, formula_count, numeric_count)
        .select_from(OperationalFact)
        .join(UploadedFile, UploadedFile.id == OperationalFact.uploaded_file_id)
        .where(*clauses)
    )
    overall = dict(overall_result.one()._mapping)

    if not requested:
        return [], overall

    group_columns = [_AGGREGATION_DIMENSIONS[key].label(key) for key in requested]
    stmt = (
        select(*group_columns, numeric_total, fact_count, formula_count, numeric_count)
        .select_from(OperationalFact)
        .join(UploadedFile, UploadedFile.id == OperationalFact.uploaded_file_id)
        .where(*clauses)
        .group_by(*group_columns)
        .order_by(numeric_total.desc())
    )
    result = await session.execute(stmt)
    rows = [dict(row._mapping) for row in result.all()]
    return rows, overall


# ---------------------------------------------------------------------------
# Historical operational querying (MD07-2)
# ---------------------------------------------------------------------------


async def get_operational_trend(
    session: AsyncSession,
    *,
    user: AuthUser,
    metric_key: str,
    buyer: str | None = None,
    unit: str | None = None,
    operational_section: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    limit: int = 180,
) -> list[dict[str, Any]]:
    """Return a per-date history series for a metric (optionally scoped).

    Supports trend retrieval for buyer+metric, unit+metric, and
    buyer+unit+metric. Results are grouped by ``report_date`` so the frontend
    can render a tabular trend preview without an N+1 fetch per day.
    """
    filters = OperationalFactFilters(
        metric_key=metric_key,
        buyer=buyer,
        unit=unit,
        operational_section=operational_section,
        date_from=date_from,
        date_to=date_to,
    )
    clauses = _operational_fact_filters(user, filters)
    clauses.append(OperationalFact.report_date.is_not(None))

    stmt = (
        select(
            OperationalFact.report_date.label("report_date"),
            func.coalesce(func.sum(OperationalFact.value_numeric), 0).label("numeric_total"),
            func.count(OperationalFact.id).label("fact_count"),
            func.count(OperationalFact.value_numeric).label("numeric_count"),
        )
        .select_from(OperationalFact)
        .join(UploadedFile, UploadedFile.id == OperationalFact.uploaded_file_id)
        .where(*clauses)
        .group_by(OperationalFact.report_date)
        .order_by(OperationalFact.report_date.desc())
        .limit(limit)
    )
    result = await session.execute(stmt)
    rows = [dict(row._mapping) for row in result.all()]
    rows.reverse()  # ascending chronological order for trend rendering
    return rows


async def get_nearest_previous_date(
    session: AsyncSession,
    *,
    user: AuthUser,
    reference_date: date,
    metric_key: str | None = None,
    buyer: str | None = None,
    unit: str | None = None,
    operational_section: str | None = None,
) -> date | None:
    """Return the closest operational_date strictly before ``reference_date``.

    Used for both previous-day lookup and nearest-previous-record comparison.
    A single ``max(report_date)`` query keeps this cheap.
    """
    filters = OperationalFactFilters(
        metric_key=metric_key,
        buyer=buyer,
        unit=unit,
        operational_section=operational_section,
    )
    clauses = _operational_fact_filters(user, filters)
    clauses.append(OperationalFact.report_date.is_not(None))
    clauses.append(OperationalFact.report_date < reference_date)

    result = await session.execute(
        select(func.max(OperationalFact.report_date))
        .select_from(OperationalFact)
        .join(UploadedFile, UploadedFile.id == OperationalFact.uploaded_file_id)
        .where(*clauses)
    )
    return result.scalar_one_or_none()


async def get_operational_comparison(
    session: AsyncSession,
    *,
    user: AuthUser,
    metric_key: str,
    current_date: date,
    previous_date: date | None = None,
    buyer: str | None = None,
    unit: str | None = None,
    operational_section: str | None = None,
) -> dict[str, Any]:
    """Compare current vs previous operational totals for a metric.

    When ``previous_date`` is omitted the nearest previous record date is
    resolved automatically (previous-day / nearest-previous-record lookup).
    Returns current/previous totals plus the resolved previous date so the UI
    can render delta indicators.
    """
    if previous_date is None:
        previous_date = await get_nearest_previous_date(
            session,
            user=user,
            reference_date=current_date,
            metric_key=metric_key,
            buyer=buyer,
            unit=unit,
            operational_section=operational_section,
        )

    async def _total_for(target: date | None) -> dict[str, Any]:
        if target is None:
            return {"numeric_total": None, "fact_count": 0, "numeric_count": 0}
        filters = OperationalFactFilters(
            metric_key=metric_key,
            buyer=buyer,
            unit=unit,
            operational_section=operational_section,
            report_date=target,
        )
        clauses = _operational_fact_filters(user, filters)
        result = await session.execute(
            select(
                func.sum(OperationalFact.value_numeric).label("numeric_total"),
                func.count(OperationalFact.id).label("fact_count"),
                func.count(OperationalFact.value_numeric).label("numeric_count"),
            )
            .select_from(OperationalFact)
            .join(UploadedFile, UploadedFile.id == OperationalFact.uploaded_file_id)
            .where(*clauses)
        )
        return dict(result.one()._mapping)

    current = await _total_for(current_date)
    previous = await _total_for(previous_date)
    return {
        "metric_key": metric_key,
        "buyer": buyer,
        "unit": unit,
        "operational_section": operational_section,
        "current_date": current_date,
        "previous_date": previous_date,
        "current": current,
        "previous": previous,
    }


async def get_accessible_operational_fact(
    session: AsyncSession,
    *,
    fact_id: UUID,
    user: AuthUser,
) -> OperationalFact | None:
    """Fetch a single operational fact (with its uploaded file) for traceback."""
    result = await session.execute(
        select(OperationalFact)
        .join(UploadedFile, UploadedFile.id == OperationalFact.uploaded_file_id)
        .where(
            OperationalFact.id == fact_id,
            OperationalFact.deleted_at.is_(None),
            UploadedFile.deleted_at.is_(None),
            _uploaded_file_access_filter(user),
        )
        .options(selectinload(OperationalFact.uploaded_file))
    )
    return result.scalar_one_or_none()


async def list_operational_dimensions(
    session: AsyncSession,
    *,
    user: AuthUser,
) -> dict[str, list[dict[str, Any]]]:
    """Return distinct filter options that actually appear in operational facts.

    Powers the operational query panel dropdowns (buyer / unit / metric /
    section) without forcing the UI to scan the full fact list. Each query is
    a single grouped round-trip, so this stays N+1 free.
    """
    base_filters = [
        OperationalFact.deleted_at.is_(None),
        UploadedFile.deleted_at.is_(None),
        _uploaded_file_access_filter(user),
    ]

    async def _distinct(value_col: Any, label_col: Any) -> list[dict[str, Any]]:
        stmt = (
            select(value_col.label("value"), func.max(label_col).label("label"))
            .select_from(OperationalFact)
            .join(UploadedFile, UploadedFile.id == OperationalFact.uploaded_file_id)
            .where(*base_filters, value_col.is_not(None))
            .group_by(value_col)
            .order_by(value_col)
        )
        result = await session.execute(stmt)
        return [
            {"value": row.value, "label": row.label or row.value}
            for row in result.all()
            if row.value is not None and str(row.value).strip()
        ]

    buyers = await _distinct(OperationalFact.buyer, OperationalFact.buyer)
    units = await _distinct(OperationalFact.unit, OperationalFact.unit)
    metrics = await _distinct(OperationalFact.metric_key, OperationalFact.metric_label)
    sections = await _distinct(
        OperationalFact.operational_section,
        OperationalFact.operational_section_label,
    )

    # Distinct report dates (for date pickers / range hints).
    date_result = await session.execute(
        select(OperationalFact.report_date)
        .select_from(OperationalFact)
        .join(UploadedFile, UploadedFile.id == OperationalFact.uploaded_file_id)
        .where(*base_filters, OperationalFact.report_date.is_not(None))
        .group_by(OperationalFact.report_date)
        .order_by(OperationalFact.report_date.desc())
    )
    dates = [
        {"value": row[0].isoformat(), "label": row[0].isoformat()}
        for row in date_result.all()
    ]

    return {
        "buyers": buyers,
        "units": units,
        "metrics": metrics,
        "sections": sections,
        "dates": dates,
    }


async def get_operational_facts_for_cells(
    session: AsyncSession,
    *,
    uploaded_file_id: UUID,
    sheet_cell_addresses: dict[str, set[str]],
) -> list[OperationalFact]:
    if not sheet_cell_addresses:
        return []

    filters: list[ColumnElement[bool]] = [OperationalFact.uploaded_file_id == uploaded_file_id]
    sheet_filters = [
        (
            (OperationalFact.source_sheet_name == sheet_name)
            & (OperationalFact.source_cell_address.in_(addresses))
        )
        for sheet_name, addresses in sheet_cell_addresses.items()
        if addresses
    ]
    if not sheet_filters:
        return []
    filters.append(or_(*sheet_filters))

    result = await session.execute(
        select(OperationalFact).where(
            OperationalFact.deleted_at.is_(None),
            *filters,
        )
    )
    return list(result.scalars().all())


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

    q_buyer: Any = (
        select(literal_column("'buyer'").label("ref"))
        .select_from(Buyer)
        .where(Buyer.id == buyer_id, Buyer.deleted_at.is_(None), Buyer.is_active.is_(True))
    )
    q_unit: Any = (
        select(literal_column("'unit'").label("ref"))
        .select_from(Unit)
        .where(Unit.id == unit_id, Unit.deleted_at.is_(None), Unit.is_active.is_(True))
    )
    q_rt: Any = (
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
            Report.submitted_at,
            Report.submitted_by_user_id,
            Report.approved_at,
            Report.approved_by_user_id,
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
