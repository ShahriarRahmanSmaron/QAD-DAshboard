from datetime import date, datetime
from decimal import Decimal
from typing import Any
from uuid import UUID
from sqlalchemy import select, func, or_, and_
from sqlalchemy.ext.asyncio import AsyncSession
from app.auth.schemas import AuthUser
from app.reporting.models import OperationalFact, UploadedFile
from app.reporting.repository import _uploaded_file_access_filter, _with_default_grain, OperationalFactFilters, _operational_fact_filters

async def get_active_report_dates(
    session: AsyncSession,
    user: AuthUser,
    date_from: date | None = None,
    date_to: date | None = None,
) -> list[date]:
    """Get all distinct report dates available in the active workbooks in chronological order."""
    stmt = (
        select(OperationalFact.report_date)
        .join(UploadedFile, UploadedFile.id == OperationalFact.uploaded_file_id)
        .where(
            OperationalFact.deleted_at.is_(None),
            OperationalFact.is_active.is_(True),
            UploadedFile.deleted_at.is_(None),
            UploadedFile.is_active_workbook.is_(True),
            UploadedFile.archived_at.is_(None),
            _uploaded_file_access_filter(user),
            OperationalFact.report_date.is_not(None)
        )
    )
    if date_from:
        stmt = stmt.where(OperationalFact.report_date >= date_from)
    if date_to:
        stmt = stmt.where(OperationalFact.report_date <= date_to)
    
    stmt = stmt.group_by(OperationalFact.report_date).order_by(OperationalFact.report_date.asc())
    result = await session.execute(stmt)
    return [row[0] for row in result.all()]

async def get_buyer_history(
    session: AsyncSession,
    user: AuthUser,
    buyer: str,
    metric: str,
    date_from: date | None = None,
    date_to: date | None = None,
) -> list[dict[str, Any]]:
    """Return date-by-date values of the metric for the buyer, including delta and percent change."""
    # 1. Get all chronological report dates in system
    report_dates = await get_active_report_dates(session, user, date_from, date_to)
    if not report_dates:
        return []

    # 2. Query buyer facts
    filters = OperationalFactFilters(
        metric_key=metric,
        buyer=buyer,
        date_from=date_from,
        date_to=date_to,
        row_classification="detail",
    )
    clauses = _operational_fact_filters(user, filters)
    stmt = (
        select(
            OperationalFact.report_date.label("report_date"),
            func.sum(OperationalFact.value_numeric).label("value")
        )
        .join(UploadedFile, UploadedFile.id == OperationalFact.uploaded_file_id)
        .where(*clauses)
        .group_by(OperationalFact.report_date)
        .order_by(OperationalFact.report_date.asc())
    )
    result = await session.execute(stmt)
    buyer_data = {row.report_date: row.value for row in result.all()}

    history = []
    prev_val: Decimal | None = None

    for r_date in report_dates:
        is_present = r_date in buyer_data
        curr_val = buyer_data.get(r_date, Decimal("0"))
        
        delta: Decimal | None = None
        pct_change: float | None = None
        
        if prev_val is not None:
            delta = curr_val - prev_val
            if prev_val != 0:
                pct_change = float((delta / prev_val) * 100)
            else:
                pct_change = 100.0 if delta > 0 else (0.0 if delta == 0 else -100.0)
        
        history.append({
            "date": r_date.isoformat(),
            "value": float(curr_val),
            "delta": float(delta) if delta is not None else None,
            "percent_change": pct_change,
            "is_present": is_present
        })
        
        prev_val = curr_val

    return history

async def get_buyer_presence_matrix(
    session: AsyncSession,
    user: AuthUser,
    buyer: str,
    date_from: date | None = None,
    date_to: date | None = None,
) -> list[dict[str, Any]]:
    """Returns matrix of Date -> Yes/No availability for the buyer."""
    report_dates = await get_active_report_dates(session, user, date_from, date_to)
    if not report_dates:
        return []

    filters = OperationalFactFilters(
        buyer=buyer,
        date_from=date_from,
        date_to=date_to,
    )
    clauses = _operational_fact_filters(user, filters)
    stmt = (
        select(OperationalFact.report_date)
        .join(UploadedFile, UploadedFile.id == OperationalFact.uploaded_file_id)
        .where(*clauses)
        .group_by(OperationalFact.report_date)
    )
    result = await session.execute(stmt)
    present_dates = {row[0] for row in result.all()}

    return [
        {
            "date": r_date.isoformat(),
            "is_present": r_date in present_dates
        }
        for r_date in report_dates
    ]

async def get_buyer_contribution(
    session: AsyncSession,
    user: AuthUser,
    buyer: str,
    metric: str,
    target_date: date | None = None,
) -> list[dict[str, Any]]:
    """Get contribution by unit for selected buyer + metric on target_date (or latest date)."""
    if target_date is None:
        # Find latest date where the buyer has facts for this metric
        filters = OperationalFactFilters(
            metric_key=metric,
            buyer=buyer,
            row_classification="detail",
        )
        clauses = _operational_fact_filters(user, filters)
        stmt = (
            select(func.max(OperationalFact.report_date))
            .join(UploadedFile, UploadedFile.id == OperationalFact.uploaded_file_id)
            .where(*clauses)
        )
        result = await session.execute(stmt)
        target_date = result.scalar_one_or_none()
        if not target_date:
            return []

    filters = OperationalFactFilters(
        metric_key=metric,
        buyer=buyer,
        report_date=target_date,
        row_classification="detail",
    )
    clauses = _operational_fact_filters(user, filters)
    stmt = (
        select(
            OperationalFact.unit.label("unit"),
            func.sum(OperationalFact.value_numeric).label("value")
        )
        .join(UploadedFile, UploadedFile.id == OperationalFact.uploaded_file_id)
        .where(*clauses)
        .group_by(OperationalFact.unit)
        .order_by(func.sum(OperationalFact.value_numeric).desc())
    )
    result = await session.execute(stmt)
    return [{"unit": row.unit or "Unknown", "value": float(row.value or 0)} for row in result.all()]

async def get_buyer_contribution_trend(
    session: AsyncSession,
    user: AuthUser,
    buyer: str,
    metric: str,
    date_from: date | None = None,
    date_to: date | None = None,
) -> list[dict[str, Any]]:
    """Returns (date, unit, value) list for stacked contribution charts."""
    filters = OperationalFactFilters(
        metric_key=metric,
        buyer=buyer,
        date_from=date_from,
        date_to=date_to,
        row_classification="detail",
    )
    clauses = _operational_fact_filters(user, filters)
    stmt = (
        select(
            OperationalFact.report_date.label("date"),
            OperationalFact.unit.label("unit"),
            func.sum(OperationalFact.value_numeric).label("value")
        )
        .join(UploadedFile, UploadedFile.id == OperationalFact.uploaded_file_id)
        .where(*clauses)
        .group_by(OperationalFact.report_date, OperationalFact.unit)
        .order_by(OperationalFact.report_date.asc(), func.sum(OperationalFact.value_numeric).desc())
    )
    result = await session.execute(stmt)
    return [
        {
            "date": row.date.isoformat(),
            "unit": row.unit or "Unknown",
            "value": float(row.value or 0)
        }
        for row in result.all()
    ]

async def get_buyer_unit_drilldown(
    session: AsyncSession,
    user: AuthUser,
    buyer: str,
    unit: str,
    metric: str,
    date_from: date | None = None,
    date_to: date | None = None,
) -> list[dict[str, Any]]:
    """Return trend data for selected buyer + metric under a specific unit."""
    report_dates = await get_active_report_dates(session, user, date_from, date_to)
    if not report_dates:
        return []

    filters = OperationalFactFilters(
        metric_key=metric,
        buyer=buyer,
        unit=unit,
        date_from=date_from,
        date_to=date_to,
        row_classification="detail",
    )
    clauses = _operational_fact_filters(user, filters)
    stmt = (
        select(
            OperationalFact.report_date.label("date"),
            func.sum(OperationalFact.value_numeric).label("value")
        )
        .join(UploadedFile, UploadedFile.id == OperationalFact.uploaded_file_id)
        .where(*clauses)
        .group_by(OperationalFact.report_date)
        .order_by(OperationalFact.report_date.asc())
    )
    result = await session.execute(stmt)
    drilldown_data = {row.date: row.value for row in result.all()}

    return [
        {
            "date": r_date.isoformat(),
            "value": float(drilldown_data.get(r_date, Decimal("0")))
        }
        for r_date in report_dates
    ]

async def get_buyer_date_comparison(
    session: AsyncSession,
    user: AuthUser,
    buyer: str,
    metric: str,
    date_a: date,
    date_b: date,
) -> dict[str, Any]:
    """Compare a buyer's metric values between Date A (Previous) and Date B (Current)."""
    async def _val_for(target_date: date) -> Decimal:
        filters = OperationalFactFilters(
            metric_key=metric,
            buyer=buyer,
            report_date=target_date,
            row_classification="detail",
        )
        clauses = _operational_fact_filters(user, filters)
        stmt = (
            select(func.sum(OperationalFact.value_numeric))
            .join(UploadedFile, UploadedFile.id == OperationalFact.uploaded_file_id)
            .where(*clauses)
        )
        result = await session.execute(stmt)
        return result.scalar_one_or_none() or Decimal("0")

    val_a = await _val_for(date_a)
    val_b = await _val_for(date_b)

    delta = val_b - val_a
    pct_change: float | None = None
    if val_a != 0:
        pct_change = float((delta / val_a) * 100)
    else:
        pct_change = 100.0 if delta > 0 else (0.0 if delta == 0 else -100.0)

    return {
        "previous_date": date_a.isoformat(),
        "current_date": date_b.isoformat(),
        "previous_value": float(val_a),
        "current_value": float(val_b),
        "delta": float(delta),
        "percent_change": pct_change
    }

async def get_buyer_ranking_trend(
    session: AsyncSession,
    user: AuthUser,
    buyer: str,
    metric: str,
    date_from: date | None = None,
    date_to: date | None = None,
) -> list[dict[str, Any]]:
    """Compute the rank of the target buyer among all buyers across each report date chronologically."""
    report_dates = await get_active_report_dates(session, user, date_from, date_to)
    if not report_dates:
        return []

    # Get buyer totals for all dates
    filters = OperationalFactFilters(
        metric_key=metric,
        date_from=date_from,
        date_to=date_to,
        row_classification="detail",
    )
    clauses = _operational_fact_filters(user, filters)
    stmt = (
        select(
            OperationalFact.report_date.label("date"),
            OperationalFact.buyer.label("buyer"),
            func.sum(OperationalFact.value_numeric).label("value")
        )
        .join(UploadedFile, UploadedFile.id == OperationalFact.uploaded_file_id)
        .where(*clauses)
        .group_by(OperationalFact.report_date, OperationalFact.buyer)
    )
    result = await session.execute(stmt)
    
    # Organize data: date -> list of (buyer, value) sorted descending
    by_date_data: dict[date, list[tuple[str, Decimal]]] = {}
    for row in result.all():
        if row.date not in by_date_data:
            by_date_data[row.date] = []
        by_date_data[row.date].append((row.buyer.strip().lower() if row.buyer else "", row.value or Decimal("0")))

    # Sort each date's list descending by value
    for d, lst in by_date_data.items():
        lst.sort(key=lambda x: x[1], reverse=True)

    target_buyer_lower = buyer.strip().lower()
    ranking_trend = []

    for r_date in report_dates:
        rank = None
        buyers_list = by_date_data.get(r_date, [])
        for i, (b_name, b_val) in enumerate(buyers_list):
            if b_name == target_buyer_lower:
                rank = i + 1
                break
        
        ranking_trend.append({
            "date": r_date.isoformat(),
            "rank": rank  # None if not found on that date
        })

    return ranking_trend

async def get_buyer_insights(
    session: AsyncSession,
    user: AuthUser,
    buyer: str,
    metric: str,
    date_from: date | None = None,
    date_to: date | None = None,
) -> dict[str, Any]:
    """Compute and generate insights like largest increase, reduction, fastest growth, and stable periods."""
    history = await get_buyer_history(session, user, buyer, metric, date_from, date_to)
    
    largest_inc = {"delta": -1e9, "date_from": None, "date_to": None}
    largest_red = {"delta": 1e9, "date_from": None, "date_to": None}
    fastest_growth = {"pct": -1e9, "date_from": None, "date_to": None}
    most_stable = {"delta_abs": 1e9, "date_from": None, "date_to": None}

    for i in range(1, len(history)):
        prev = history[i - 1]
        curr = history[i]
        
        d_val = curr["delta"]
        pct = curr["percent_change"]
        
        if d_val is not None:
            if d_val > largest_inc["delta"]:
                largest_inc = {"delta": d_val, "date_from": prev["date"], "date_to": curr["date"]}
            if d_val < largest_red["delta"]:
                largest_red = {"delta": d_val, "date_from": prev["date"], "date_to": curr["date"]}
            if pct is not None and pct > fastest_growth["pct"]:
                fastest_growth = {"pct": pct, "date_from": prev["date"], "date_to": curr["date"]}
            if abs(d_val) < most_stable["delta_abs"]:
                most_stable = {"delta_abs": abs(d_val), "date_from": prev["date"], "date_to": curr["date"]}

    return {
        "largest_increase": largest_inc if largest_inc["date_from"] else None,
        "largest_reduction": largest_red if largest_red["date_to"] else None,
        "fastest_growth_pct": fastest_growth if fastest_growth["date_from"] else None,
        "most_stable_period": most_stable if most_stable["date_from"] else None
    }
