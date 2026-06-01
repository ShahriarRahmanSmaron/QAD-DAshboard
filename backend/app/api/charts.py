"""MD08-1: Visualization Foundation — Chart Query Endpoints.

Provides chart-oriented query endpoints that reuse the operational fact layer.
No business logic is duplicated — these endpoints are thin wrappers that
reshape existing aggregation/trend/comparison results for chart consumption.

Endpoints:
  GET /charts/time-series   — time series for trend/area charts
  GET /charts/grouped       — grouped totals for bar/pie charts
  GET /charts/rankings      — ranked groups (top N buyers/units)
  GET /charts/distribution  — proportional breakdown for pie/donut
"""

from datetime import date
from decimal import Decimal
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.constants import Permission
from app.auth.dependencies import require_permission
from app.auth.schemas import AuthUser
from app.db.session import get_db_session
from app.reporting import repository
from app.reporting.repository import OperationalFactFilters
from app.reporting.schemas import (
    OperationalAggregationResponse,
    OperationalTrendResponse,
)
from app.reporting.service import (
    serialize_operational_aggregation,
    serialize_operational_trend,
)

router = APIRouter(prefix="/charts", tags=["charts"])
SessionDep = Annotated[AsyncSession, Depends(get_db_session)]
ChartReaderDep = Annotated[AuthUser, Depends(require_permission(Permission.REPORTS_READ))]


@router.get("/time-series", response_model=OperationalTrendResponse)
async def chart_time_series(
    session: SessionDep,
    user: ChartReaderDep,
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
    """Time series data for line/area charts.

    Reuses the operational trend query. Returns date-ordered points with
    numeric totals suitable for rendering as line, area, or stacked area charts.
    """
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


@router.get("/grouped", response_model=OperationalAggregationResponse)
async def chart_grouped_totals(
    session: SessionDep,
    user: ChartReaderDep,
    group_by: Annotated[list[str] | None, Query()] = None,
    buyer: str | None = None,
    unit: str | None = None,
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
    """Grouped totals for bar/comparison charts.

    Reuses the operational aggregation query. Accepts the same group_by
    dimensions (buyer, unit, metric, section, report_date, report_type, workbook).
    """
    filters = OperationalFactFilters(
        buyer=buyer,
        unit=unit,
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


@router.get("/rankings", response_model=OperationalAggregationResponse)
async def chart_rankings(
    session: SessionDep,
    user: ChartReaderDep,
    rank_by: Annotated[str, Query(pattern="^(buyer|unit|metric|section)$")] = "buyer",
    metric: str | None = None,
    section: str | None = None,
    report_type_id: UUID | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    classification: str | None = None,
    limit: Annotated[int, Query(ge=1, le=50)] = 10,
) -> OperationalAggregationResponse:
    """Ranked groups for horizontal bar / ranking charts.

    Groups by the specified dimension and returns results sorted by
    numeric_total descending, limited to the top N entries.
    """
    filters = OperationalFactFilters(
        metric_key=metric,
        operational_section=section,
        report_type_id=report_type_id,
        date_from=date_from,
        date_to=date_to,
        row_classification=classification,
    )
    rows, overall = await repository.aggregate_operational_facts(
        session,
        user=user,
        filters=filters,
        group_by=[rank_by],
    )
    # Sort by numeric_total descending and limit
    sorted_rows = sorted(
        rows,
        key=lambda r: float(r.get("numeric_total") or 0),
        reverse=True,
    )[:limit]

    resolved_group_by = repository.resolve_aggregation_dimensions([rank_by])
    return serialize_operational_aggregation(
        group_by=resolved_group_by,
        rows=sorted_rows,
        overall=overall,
    )


@router.get("/distribution", response_model=OperationalAggregationResponse)
async def chart_distribution(
    session: SessionDep,
    user: ChartReaderDep,
    distribute_by: Annotated[str, Query(pattern="^(buyer|unit|metric|section)$")] = "metric",
    buyer: str | None = None,
    unit: str | None = None,
    section: str | None = None,
    report_type_id: UUID | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    classification: str | None = None,
) -> OperationalAggregationResponse:
    """Proportional distribution for pie/donut charts.

    Groups by the specified dimension and returns all groups with their
    numeric totals — suitable for rendering as pie slices.
    """
    filters = OperationalFactFilters(
        buyer=buyer,
        unit=unit,
        operational_section=section,
        report_type_id=report_type_id,
        date_from=date_from,
        date_to=date_to,
        row_classification=classification,
    )
    rows, overall = await repository.aggregate_operational_facts(
        session,
        user=user,
        filters=filters,
        group_by=[distribute_by],
    )
    resolved_group_by = repository.resolve_aggregation_dimensions([distribute_by])
    return serialize_operational_aggregation(
        group_by=resolved_group_by,
        rows=rows,
        overall=overall,
    )
