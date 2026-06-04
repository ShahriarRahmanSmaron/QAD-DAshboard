"""MD09-LP: Public Landing Snapshot Endpoint.

Returns a sanitized, aggregated operational snapshot for the public landing
page.  No authentication is required — the endpoint reads only active,
non-archived workbook facts and exposes only high-level totals, never raw
operational facts.

This module queries the database repository layer directly (no ``AuthUser``
dependency) using the same base filters that the authenticated endpoints
apply for active-workbook governance.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Annotated, Any

from fastapi import APIRouter, Depends
from sqlalchemy import func, select, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db_session
from app.reporting.models import OperationalFact, ReportType, UploadedFile, Unit

router = APIRouter(prefix="/public", tags=["public"])
SessionDep = Annotated[AsyncSession, Depends(get_db_session)]

# The four core KPI metrics displayed on the landing page.
_LANDING_KPI_METRICS = ["t_stock", "wait_for_test", "wait_for_shade", "wait_for_rfd"]

# Only active, non-archived workbook facts at the detail grain.
_DETAIL_CLASSIFICATION = "detail"


def _active_fact_base_filters() -> list:
    """Return the standard governance filters for active operational facts."""
    return [
        OperationalFact.deleted_at.is_(None),
        OperationalFact.is_active.is_(True),
        UploadedFile.deleted_at.is_(None),
        UploadedFile.is_active_workbook.is_(True),
        UploadedFile.archived_at.is_(None),
        OperationalFact.row_classification == _DETAIL_CLASSIFICATION,
    ]


async def _get_active_unit_prefixes(session: AsyncSession) -> list[str]:
    """Retrieve active unit prefixes from the database."""
    units_stmt = select(Unit.code).where(Unit.deleted_at.is_(None), Unit.is_active.is_(True))
    units_res = await session.execute(units_stmt)
    active_codes = [r[0] for r in units_res.all()]
    prefixes = set()
    for code in active_codes:
        prefix = code.split('-')[0].strip()
        if prefix:
            prefixes.add(prefix)
    return list(prefixes)


def _unit_prefix_filter(prefixes: list[str]) -> Any:
    """Return SQL filter for unit prefixes."""
    if not prefixes:
        return True
    return or_(*(OperationalFact.unit.like(f"{p}%") for p in prefixes))


def _safe_float(value: Any) -> float:
    if value is None:
        return 0.0
    if isinstance(value, Decimal):
        return float(value)
    return float(value)


# ---------------------------------------------------------------------------
# Landing snapshot sub-queries
# ---------------------------------------------------------------------------


async def _latest_workbook_summary(session: AsyncSession) -> dict[str, Any] | None:
    """Return metadata about the most-recently uploaded active workbook."""
    prefixes = await _get_active_unit_prefixes(session)
    fact_count_sq = (
        select(func.count(OperationalFact.id))
        .where(
            OperationalFact.uploaded_file_id == UploadedFile.id,
            OperationalFact.deleted_at.is_(None),
            OperationalFact.is_active.is_(True),
            OperationalFact.row_classification == _DETAIL_CLASSIFICATION,
            _unit_prefix_filter(prefixes),
        )
        .correlate(UploadedFile)
        .scalar_subquery()
        .label("fact_count")
    )

    report_date_expr = (
        UploadedFile.metadata_["semantic_mapping"]["report_date"]
        .astext.label("report_date_text")
    )

    stmt = (
        select(
            UploadedFile.id.label("workbook_id"),
            UploadedFile.original_filename.label("filename"),
            UploadedFile.status,
            UploadedFile.created_at.label("uploaded_at"),
            UploadedFile.report_type_id,
            ReportType.name.label("report_type_name"),
            report_date_expr,
            fact_count_sq,
        )
        .select_from(UploadedFile)
        .join(ReportType, ReportType.id == UploadedFile.report_type_id, isouter=True)
        .where(
            UploadedFile.deleted_at.is_(None),
            UploadedFile.is_active_workbook.is_(True),
            UploadedFile.archived_at.is_(None),
        )
        .order_by(UploadedFile.created_at.desc())
        .limit(1)
    )
    result = await session.execute(stmt)
    row = result.one_or_none()
    if row is None:
        return None
    mapping = dict(row._mapping)

    # Count distinct units and buyers from this workbook's facts.
    counts = await session.execute(
        select(
            func.count(func.distinct(OperationalFact.unit)).label("unit_count"),
            func.count(func.distinct(OperationalFact.buyer)).label("buyer_count"),
        )
        .select_from(OperationalFact)
        .where(
            OperationalFact.uploaded_file_id == mapping["workbook_id"],
            OperationalFact.deleted_at.is_(None),
            OperationalFact.is_active.is_(True),
            OperationalFact.row_classification == _DETAIL_CLASSIFICATION,
            _unit_prefix_filter(prefixes),
        )
    )
    count_row = counts.one()._mapping
    mapping["unit_count"] = int(count_row["unit_count"])
    mapping["buyer_count"] = int(count_row["buyer_count"])

    return mapping


async def _hero_stats(session: AsyncSession) -> dict[str, Any]:
    """Return aggregate counts for the hero section animated counters."""
    prefixes = await _get_active_unit_prefixes(session)
    base = [*_active_fact_base_filters(), _unit_prefix_filter(prefixes)]

    result = await session.execute(
        select(
            func.count(OperationalFact.id).label("total_facts"),
            func.count(func.distinct(OperationalFact.unit)).label("total_units"),
            func.count(func.distinct(OperationalFact.buyer)).label("total_buyers"),
        )
        .select_from(OperationalFact)
        .join(UploadedFile, UploadedFile.id == OperationalFact.uploaded_file_id)
        .where(*base)
    )
    row = result.one()._mapping

    # Count active workbooks.
    wb_result = await session.execute(
        select(func.count(UploadedFile.id))
        .where(
            UploadedFile.deleted_at.is_(None),
            UploadedFile.is_active_workbook.is_(True),
            UploadedFile.archived_at.is_(None),
        )
    )
    workbook_count = wb_result.scalar_one()

    # Latest report date across all active facts.
    date_result = await session.execute(
        select(func.max(OperationalFact.report_date))
        .select_from(OperationalFact)
        .join(UploadedFile, UploadedFile.id == OperationalFact.uploaded_file_id)
        .where(*base, OperationalFact.report_date.is_not(None))
    )
    latest_date = date_result.scalar_one_or_none()

    return {
        "total_facts": int(row["total_facts"]),
        "total_units": int(row["total_units"]),
        "total_buyers": int(row["total_buyers"]),
        "total_workbooks": int(workbook_count),
        "latest_report_date": latest_date.isoformat() if latest_date else None,
    }


async def _kpi_snapshot(
    session: AsyncSession, current_date: date, previous_date: date | None
) -> list[dict[str, Any]]:
    """Return KPI totals for each core metric on current and previous dates."""
    base = _active_fact_base_filters()
    kpis: list[dict[str, Any]] = []

    for metric_key in _LANDING_KPI_METRICS:
        metric_filters = [*base, OperationalFact.metric_key == metric_key]

        # Current total.
        cur = await session.execute(
            select(
                func.coalesce(func.sum(OperationalFact.value_numeric), 0).label("total"),
                func.max(OperationalFact.metric_label).label("label"),
            )
            .select_from(OperationalFact)
            .join(UploadedFile, UploadedFile.id == OperationalFact.uploaded_file_id)
            .where(*metric_filters, OperationalFact.report_date == current_date)
        )
        cur_row = cur.one()._mapping
        current_value = _safe_float(cur_row["total"])
        label = cur_row["label"] or metric_key

        previous_value: float | None = None
        if previous_date is not None:
            prev = await session.execute(
                select(
                    func.coalesce(func.sum(OperationalFact.value_numeric), 0).label("total"),
                )
                .select_from(OperationalFact)
                .join(UploadedFile, UploadedFile.id == OperationalFact.uploaded_file_id)
                .where(*metric_filters, OperationalFact.report_date == previous_date)
            )
            previous_value = _safe_float(prev.scalar_one())

        delta = current_value - previous_value if previous_value is not None else None
        delta_pct = (
            (delta / previous_value * 100) if delta is not None and previous_value else None
        )
        direction = "flat"
        if delta is not None:
            direction = "up" if delta > 0 else ("down" if delta < 0 else "flat")

        kpis.append({
            "metric_key": metric_key,
            "label": label,
            "value": round(current_value),
            "previous_value": round(previous_value) if previous_value is not None else None,
            "delta": round(delta) if delta is not None else None,
            "delta_percent": round(delta_pct, 1) if delta_pct is not None else None,
            "direction": direction,
        })

    return kpis


async def _executive_insights(
    session: AsyncSession, current_date: date, previous_date: date | None
) -> list[dict[str, Any]]:
    """Generate executive insight callouts from unit and buyer movements."""
    if previous_date is None:
        return []

    base = _active_fact_base_filters()
    insights: list[dict[str, Any]] = []

    for dimension, col in [("unit", OperationalFact.unit), ("buyer", OperationalFact.buyer)]:
        # Get per-group totals for current and previous date.
        async def _by_group(target: date, _col=col) -> dict[str, float]:
            result = await session.execute(
                select(
                    _col.label("group_key"),
                    func.coalesce(func.sum(OperationalFact.value_numeric), 0).label("total"),
                )
                .select_from(OperationalFact)
                .join(UploadedFile, UploadedFile.id == OperationalFact.uploaded_file_id)
                .where(*base, OperationalFact.report_date == target, _col.is_not(None))
                .group_by(_col)
            )
            return {row.group_key: _safe_float(row.total) for row in result.all()}

        current_groups = await _by_group(current_date)
        previous_groups = await _by_group(previous_date)

        all_keys = set(current_groups) | set(previous_groups)
        deltas = []
        for key in all_keys:
            cur_val = current_groups.get(key, 0)
            prev_val = previous_groups.get(key, 0)
            diff = cur_val - prev_val
            pct = (diff / prev_val * 100) if prev_val else None
            deltas.append({"key": key, "difference": diff, "percent": pct})

        deltas.sort(key=lambda d: d["difference"])

        # Largest reduction.
        reductions = [d for d in deltas if d["difference"] < 0]
        if reductions:
            r = reductions[0]
            insights.append({
                "type": f"largest_{dimension}_reduction",
                "entity": r["key"],
                "difference": round(r["difference"]),
                "percent": round(r["percent"], 1) if r["percent"] is not None else None,
            })

        # Largest increase.
        increases = [d for d in deltas if d["difference"] > 0]
        increases.sort(key=lambda d: d["difference"], reverse=True)
        if increases:
            i = increases[0]
            insights.append({
                "type": f"largest_{dimension}_increase",
                "entity": i["key"],
                "difference": round(i["difference"]),
                "percent": round(i["percent"], 1) if i["percent"] is not None else None,
            })

    return insights


async def _preview_charts(
    session: AsyncSession, current_date: date, previous_date: date | None
) -> dict[str, Any]:
    """Return simplified comparison data for unit and buyer preview charts."""
    base = _active_fact_base_filters()
    charts: dict[str, Any] = {"unit_comparison": [], "buyer_comparison": []}

    if previous_date is None:
        return charts

    for dimension, col, chart_key in [
        ("unit", OperationalFact.unit, "unit_comparison"),
        ("buyer", OperationalFact.buyer, "buyer_comparison"),
    ]:
        async def _totals(target: date, _col=col) -> dict[str, float]:
            result = await session.execute(
                select(
                    _col.label("group_key"),
                    func.coalesce(func.sum(OperationalFact.value_numeric), 0).label("total"),
                )
                .select_from(OperationalFact)
                .join(UploadedFile, UploadedFile.id == OperationalFact.uploaded_file_id)
                .where(*base, OperationalFact.report_date == target, _col.is_not(None))
                .group_by(_col)
            )
            return {row.group_key: _safe_float(row.total) for row in result.all()}

        cur = await _totals(current_date)
        prev = await _totals(previous_date)

        # Rank by current value descending, take top 5.
        ranked = sorted(cur.items(), key=lambda kv: kv[1], reverse=True)[:5]

        rows = []
        for key, cur_val in ranked:
            prev_val = prev.get(key, 0)
            rows.append({
                "key": key,
                "label": key,
                "current_value": round(cur_val),
                "previous_value": round(prev_val),
                "difference": round(cur_val - prev_val),
            })
        charts[chart_key] = rows

    return charts


async def _resolve_dates(session: AsyncSession) -> tuple[date | None, date | None]:
    """Resolve the two most recent report dates from active facts."""
    base = _active_fact_base_filters()
    result = await session.execute(
        select(OperationalFact.report_date)
        .select_from(OperationalFact)
        .join(UploadedFile, UploadedFile.id == OperationalFact.uploaded_file_id)
        .where(*base, OperationalFact.report_date.is_not(None))
        .group_by(OperationalFact.report_date)
        .order_by(OperationalFact.report_date.desc())
        .limit(2)
    )
    dates = [row[0] for row in result.all()]
    current = dates[0] if len(dates) > 0 else None
    previous = dates[1] if len(dates) > 1 else None
    return current, previous


async def _resolve_trend_dates(session: AsyncSession, limit: int = 10) -> list[date]:
    """Resolve the latest N distinct report dates in chronological ascending order."""
    base = _active_fact_base_filters()
    result = await session.execute(
        select(OperationalFact.report_date)
        .select_from(OperationalFact)
        .join(UploadedFile, UploadedFile.id == OperationalFact.uploaded_file_id)
        .where(*base, OperationalFact.report_date.is_not(None))
        .group_by(OperationalFact.report_date)
        .order_by(OperationalFact.report_date.desc())
        .limit(limit)
    )
    dates = [row[0] for row in result.all()]
    dates.reverse()
    return dates


async def _historical_trends(session: AsyncSession, trend_dates: list[date]) -> list[dict[str, Any]]:
    """Return historical trend points for the wait_for_test metric over target dates."""
    if not trend_dates:
        return []
    base = _active_fact_base_filters()
    result = await session.execute(
        select(
            OperationalFact.report_date,
            func.coalesce(func.sum(OperationalFact.value_numeric), 0).label("total")
        )
        .select_from(OperationalFact)
        .join(UploadedFile, UploadedFile.id == OperationalFact.uploaded_file_id)
        .where(
            *base,
            OperationalFact.report_date.in_(trend_dates),
            OperationalFact.metric_key == "wait_for_test"
        )
        .group_by(OperationalFact.report_date)
    )
    totals = {row.report_date.isoformat(): _safe_float(row.total) for row in result.all()}
    points = []
    for d in trend_dates:
        d_str = d.isoformat()
        points.append({
            "date": d_str,
            "wait_for_test": round(totals.get(d_str, 0.0))
        })
    return points


async def _get_active_report_types_summaries(session: AsyncSession) -> list[dict[str, Any]]:
    """Return each report type's KPI snapshot for its latest report date."""
    base = _active_fact_base_filters()
    result = await session.execute(
        select(
            ReportType.id,
            ReportType.name,
            ReportType.code,
            func.max(OperationalFact.report_date).label("latest_report_date"),
        )
        .select_from(OperationalFact)
        .join(UploadedFile, UploadedFile.id == OperationalFact.uploaded_file_id)
        .join(ReportType, ReportType.id == UploadedFile.report_type_id)
        .where(
            *base,
            ReportType.deleted_at.is_(None),
            ReportType.is_active.is_(True),
            OperationalFact.report_date.is_not(None),
        )
        .group_by(ReportType.id, ReportType.name, ReportType.code)
        .order_by(func.max(OperationalFact.report_date).desc(), ReportType.name)
    )

    summaries: list[dict[str, Any]] = []
    for row in result.all():
        kpi_result = await session.execute(
            select(
                OperationalFact.metric_key,
                func.max(OperationalFact.metric_label).label("label"),
                func.coalesce(func.sum(OperationalFact.value_numeric), 0).label("value"),
            )
            .select_from(OperationalFact)
            .join(UploadedFile, UploadedFile.id == OperationalFact.uploaded_file_id)
            .where(
                *base,
                UploadedFile.report_type_id == row.id,
                OperationalFact.report_date == row.latest_report_date,
                OperationalFact.metric_key.in_(_LANDING_KPI_METRICS),
            )
            .group_by(OperationalFact.metric_key)
        )
        kpis_by_key = {
            item.metric_key: {
                "metric_key": item.metric_key,
                "label": item.label or item.metric_key,
                "value": round(_safe_float(item.value)),
            }
            for item in kpi_result.all()
        }

        preview_metric_result = await session.execute(
            select(
                OperationalFact.metric_key,
                func.max(OperationalFact.metric_label).label("label"),
            )
            .select_from(OperationalFact)
            .join(UploadedFile, UploadedFile.id == OperationalFact.uploaded_file_id)
            .where(
                *base,
                UploadedFile.report_type_id == row.id,
                OperationalFact.report_date == row.latest_report_date,
                OperationalFact.unit.is_not(None),
            )
            .group_by(OperationalFact.metric_key)
            .order_by(
                (OperationalFact.metric_key == "t_stock").desc(),
                OperationalFact.metric_key,
            )
            .limit(1)
        )
        preview_metric = preview_metric_result.one_or_none()
        preview_chart: list[dict[str, Any]] = []
        if preview_metric is not None:
            preview_result = await session.execute(
                select(
                    OperationalFact.unit.label("unit"),
                    func.coalesce(func.sum(OperationalFact.value_numeric), 0).label("value"),
                )
                .select_from(OperationalFact)
                .join(UploadedFile, UploadedFile.id == OperationalFact.uploaded_file_id)
                .where(
                    *base,
                    UploadedFile.report_type_id == row.id,
                    OperationalFact.report_date == row.latest_report_date,
                    OperationalFact.metric_key == preview_metric.metric_key,
                    OperationalFact.unit.is_not(None),
                )
                .group_by(OperationalFact.unit)
                .order_by(func.sum(OperationalFact.value_numeric).desc())
                .limit(10)
            )
            preview_chart = [
                {"unit": item.unit, "value": round(_safe_float(item.value))}
                for item in preview_result.all()
            ]

        summaries.append({
            "report_type_id": str(row.id),
            "report_type_name": row.name,
            "report_type_code": row.code,
            "latest_report_date": row.latest_report_date.isoformat(),
            "kpis": [
                kpis_by_key[metric_key]
                for metric_key in _LANDING_KPI_METRICS
                if metric_key in kpis_by_key
            ],
            "preview_metric_key": preview_metric.metric_key if preview_metric else None,
            "preview_metric_label": (
                preview_metric.label or preview_metric.metric_key
                if preview_metric
                else None
            ),
            "preview_chart": preview_chart,
        })
    return summaries


async def _wf_test_t_stock_preview(session: AsyncSession) -> list[dict[str, Any]]:
    """Return top units by t_stock for the latest date of the WF Test report type."""
    # Find the report type for 'WF_TEST_AND_SHADE'
    rt_stmt = select(ReportType).where(
        func.lower(ReportType.code) == "wf_test_and_shade",
        ReportType.deleted_at.is_(None),
        ReportType.is_active.is_(True)
    )
    rt_res = await session.execute(rt_stmt)
    rt = rt_res.scalar_one_or_none()
    if not rt:
        return []

    base = _active_fact_base_filters()

    # Find the latest report date for this report type
    date_stmt = (
        select(OperationalFact.report_date)
        .select_from(OperationalFact)
        .join(UploadedFile, UploadedFile.id == OperationalFact.uploaded_file_id)
        .where(
            *base,
            UploadedFile.report_type_id == rt.id,
            OperationalFact.metric_key == "t_stock",
            OperationalFact.report_date.is_not(None)
        )
        .group_by(OperationalFact.report_date)
        .order_by(OperationalFact.report_date.desc())
        .limit(1)
    )
    date_res = await session.execute(date_stmt)
    latest_date = date_res.scalar_one_or_none()
    if not latest_date:
        return []

    # Get the top 5 units by t_stock for this latest date
    stmt = (
        select(
            OperationalFact.unit.label("unit"),
            func.coalesce(func.sum(OperationalFact.value_numeric), 0).label("value")
        )
        .select_from(OperationalFact)
        .join(UploadedFile, UploadedFile.id == OperationalFact.uploaded_file_id)
        .where(
            *base,
            UploadedFile.report_type_id == rt.id,
            OperationalFact.metric_key == "t_stock",
            OperationalFact.report_date == latest_date,
            OperationalFact.unit.is_not(None)
        )
        .group_by(OperationalFact.unit)
        .order_by(func.sum(OperationalFact.value_numeric).desc())
        .limit(5)
    )
    res = await session.execute(stmt)
    return [
        {
            "unit": row.unit,
            "value": round(_safe_float(row.value)),
            "date": latest_date.isoformat()
        }
        for row in res.all()
    ]


# ---------------------------------------------------------------------------
# Public endpoint
# ---------------------------------------------------------------------------


@router.get("/landing-snapshot")
async def get_landing_snapshot(session: SessionDep) -> dict[str, Any]:
    """Return the public landing page snapshot.

    No authentication required.  Returns only sanitized, aggregated
    operational data suitable for public display.
    """
    hero = await _hero_stats(session)
    workbook = await _latest_workbook_summary(session)

    current_date, previous_date = await _resolve_dates(session)

    kpis: list[dict[str, Any]] = []
    insights: list[dict[str, Any]] = []
    charts: dict[str, Any] = {"unit_comparison": [], "buyer_comparison": []}
    trends: list[dict[str, Any]] = []

    if current_date is not None:
        kpis = await _kpi_snapshot(session, current_date, previous_date)
        insights = await _executive_insights(session, current_date, previous_date)
        charts = await _preview_charts(session, current_date, previous_date)
        trend_dates = await _resolve_trend_dates(session, limit=10)
        trends = await _historical_trends(session, trend_dates)

    report_types_summaries = await _get_active_report_types_summaries(session)
    wf_test_chart = await _wf_test_t_stock_preview(session)

    # Serialize workbook summary for JSON transport.
    workbook_summary = None
    if workbook is not None:
        workbook_summary = {
            "filename": workbook["filename"],
            "report_type_name": workbook.get("report_type_name"),
            "report_date": workbook.get("report_date_text"),
            "uploaded_at": workbook["uploaded_at"].isoformat() if workbook.get("uploaded_at") else None,
            "status": workbook.get("status"),
            "fact_count": workbook.get("fact_count", 0),
            "unit_count": workbook.get("unit_count", 0),
            "buyer_count": workbook.get("buyer_count", 0),
        }

    return {
        "hero": hero,
        "workbook": workbook_summary,
        "current_date": current_date.isoformat() if current_date else None,
        "previous_date": previous_date.isoformat() if previous_date else None,
        "kpis": kpis,
        "insights": insights,
        "preview_charts": charts,
        "trends": trends,
        "report_types": report_types_summaries,
        "wf_test_preview_chart": wf_test_chart,
    }
