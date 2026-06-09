from datetime import date
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.constants import Permission, UserRole
from app.auth.dependencies import (
    CurrentUserDep,
    SessionDep,
    get_user_buyer_filter,
)
from app.auth.schemas import AuthUser
from app.reporting.models import OperationalFact, ReportType, UploadedFile
from app.reporting.parser_registry import METRICS_REGISTRY, get_manifest
from app.reporting.repository import get_fact_visibility_filter

router = APIRouter(prefix="/buyer-dashboard", tags=["buyer-dashboard"])


async def require_buyer_dashboard_access(user: CurrentUserDep) -> AuthUser:
    """Buyer Dashboard: ADMIN (full access) or VIEWER with buyers:access. EDITOR is denied."""
    if user.role == UserRole.ADMIN:
        return user
    if user.role == UserRole.EDITOR:
        raise HTTPException(status_code=403, detail="EDITOR role cannot access Buyer Dashboard.")
    if user.role == UserRole.VIEWER and Permission.BUYERS_ACCESS.value in user.permissions:
        return user
    raise HTTPException(status_code=403, detail="Buyer Dashboard requires buyers:access permission.")


DashboardReaderDep = Annotated[AuthUser, Depends(require_buyer_dashboard_access)]


class BuyerReportTypeOption(BaseModel):
    id: UUID
    name: str
    supports_buyer_analysis: bool


class BuyerOption(BaseModel):
    name: str


class BuyerDashboardBootstrapResponse(BaseModel):
    default_report_type_id: UUID | None
    latest_date: str | None
    report_type_name: str | None
    default_analysis_metric: str | None
    primary_metrics: list[str]
    available_reports: list[BuyerReportTypeOption]
    available_buyers: list[BuyerOption]


class QadCard(BaseModel):
    key: str
    label: str
    value: float | None = None
    previous_value: float | None = None
    delta: float | None = None
    pct_change: float | None = None
    unit: str | None = None
    display_format: str = "number"
    display_order: int = 99


class QadAnalysisResponse(BaseModel):
    report_type: str
    report_date: str
    buyer: str
    cards: list[QadCard]


@router.get("/bootstrap", response_model=BuyerDashboardBootstrapResponse)
async def get_buyer_dashboard_bootstrap(
    session: SessionDep,
    user: DashboardReaderDep,
) -> BuyerDashboardBootstrapResponse:
    # 1. Resolve default report type (WF Test & Shade)
    stmt = select(ReportType).where(
        func.lower(ReportType.code) == "wf_test_and_shade",
        ReportType.deleted_at.is_(None),
        ReportType.is_active.is_(True)
    ).limit(1)
    rt = (await session.execute(stmt)).scalar_one_or_none()

    if not rt:
        return BuyerDashboardBootstrapResponse(
            default_report_type_id=None,
            latest_date=None,
            report_type_name=None,
            default_analysis_metric=None,
            primary_metrics=[],
            available_reports=[],
            available_buyers=[]
        )

    # 2. Get report-specific latest date
    latest_date_stmt = (
        select(func.max(OperationalFact.report_date))
        .select_from(OperationalFact)
        .join(UploadedFile, UploadedFile.id == OperationalFact.uploaded_file_id)
        .where(
            UploadedFile.report_type_id == rt.id,
            OperationalFact.deleted_at.is_(None),
            OperationalFact.is_active.is_(True),
            UploadedFile.deleted_at.is_(None),
            UploadedFile.is_active_workbook.is_(True),
            UploadedFile.archived_at.is_(None),
            get_fact_visibility_filter(user)
        )
    )
    latest_date = (await session.execute(latest_date_stmt)).scalar_one_or_none()
    latest_date_str = latest_date.isoformat() if latest_date else None

    # 3. Available reports metadata
    available_reports = [
        BuyerReportTypeOption(
            id=rt.id,
            name=rt.name,
            supports_buyer_analysis=True
        )
    ]

    # 4. Security-aware available buyers
    buyer_names = await get_user_buyer_filter(user, session)
    available_buyers = [BuyerOption(name=name) for name in buyer_names]

    # 5. Look up manifest for primary_metrics and default_analysis_metric
    manifest = get_manifest(rt.code) if rt.code else None
    dashboard_cfg = manifest.get("dashboard") if manifest else None
    primary_metrics = dashboard_cfg.get("primary_metrics", []) if dashboard_cfg else []
    default_analysis_metric = dashboard_cfg.get("default_analysis_metric") if dashboard_cfg else None

    return BuyerDashboardBootstrapResponse(
        default_report_type_id=rt.id,
        latest_date=latest_date_str,
        report_type_name=rt.name,
        default_analysis_metric=default_analysis_metric,
        primary_metrics=primary_metrics,
        available_reports=available_reports,
        available_buyers=available_buyers
    )


def _get_metric_agg_func(metric_key: str):
    meta = METRICS_REGISTRY.get(metric_key)
    if meta and meta.get("aggregation") in ("avg", "formula"):
        return func.avg(OperationalFact.value_numeric)
    return func.sum(OperationalFact.value_numeric)


async def _query_single_metric_value(
    session: AsyncSession,
    user: AuthUser,
    report_type_id: UUID,
    buyer: str,
    target_date: date,
    metric_key: str,
) -> float | None:
    agg_func = _get_metric_agg_func(metric_key)
    stmt = (
        select(agg_func)
        .select_from(OperationalFact)
        .join(UploadedFile, UploadedFile.id == OperationalFact.uploaded_file_id)
        .where(
            UploadedFile.report_type_id == report_type_id,
            func.lower(OperationalFact.buyer) == buyer.strip().lower(),
            OperationalFact.report_date == target_date,
            OperationalFact.metric_key == metric_key,
            OperationalFact.deleted_at.is_(None),
            OperationalFact.is_active.is_(True),
            UploadedFile.deleted_at.is_(None),
            UploadedFile.is_active_workbook.is_(True),
            UploadedFile.archived_at.is_(None),
            get_fact_visibility_filter(user)
        )
    )
    res = await session.execute(stmt)
    val = res.scalar_one_or_none()
    return float(val) if val is not None else None


@router.get("/qad-analysis", response_model=QadAnalysisResponse | None)
async def get_buyer_qad_analysis(
    session: SessionDep,
    user: DashboardReaderDep,
    report_type_id: UUID,
    buyer: str,
    date: date,
    compare_date: date | None = None,
) -> QadAnalysisResponse | None:
    # 1. Enforce buyer permissions check
    allowed_buyer_names = await get_user_buyer_filter(user, session)
    if buyer.strip().lower() not in {b.lower() for b in allowed_buyer_names}:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to access data for this buyer."
        )

    # 2. Check if any facts exist for this buyer on the target date (no row_classification filter)
    check_stmt = (
        select(func.count(OperationalFact.id))
        .select_from(OperationalFact)
        .join(UploadedFile, UploadedFile.id == OperationalFact.uploaded_file_id)
        .where(
            UploadedFile.report_type_id == report_type_id,
            func.lower(OperationalFact.buyer) == buyer.strip().lower(),
            OperationalFact.report_date == date,
            OperationalFact.deleted_at.is_(None),
            OperationalFact.is_active.is_(True),
            UploadedFile.deleted_at.is_(None),
            UploadedFile.is_active_workbook.is_(True),
            UploadedFile.archived_at.is_(None),
            get_fact_visibility_filter(user)
        )
    )
    count_val = (await session.execute(check_stmt)).scalar_one()
    if count_val == 0:
        return None

    # 3. Resolve report type name for response context
    rt_stmt = select(ReportType.name).where(
        ReportType.id == report_type_id,
        ReportType.deleted_at.is_(None),
    )
    rt_name = (await session.execute(rt_stmt)).scalar_one_or_none() or "Unknown"

    # 4. Discover distinct metrics for this report_type on this date for this buyer
    discovery_stmt = (
        select(
            OperationalFact.metric_key,
            OperationalFact.metric_label,
            OperationalFact.unit_of_measure,
        )
        .distinct()
        .select_from(OperationalFact)
        .join(UploadedFile, UploadedFile.id == OperationalFact.uploaded_file_id)
        .where(
            UploadedFile.report_type_id == report_type_id,
            func.lower(OperationalFact.buyer) == buyer.strip().lower(),
            OperationalFact.report_date == date,
            OperationalFact.deleted_at.is_(None),
            OperationalFact.is_active.is_(True),
            UploadedFile.deleted_at.is_(None),
            UploadedFile.is_active_workbook.is_(True),
            UploadedFile.archived_at.is_(None),
            get_fact_visibility_filter(user),
        )
    )
    discovered = (await session.execute(discovery_stmt)).all()

    if not discovered:
        return None

    # 5. Build metric info list with registry lookup
    metric_infos = []
    for row in discovered:
        mk = row[0]  # metric_key
        ml = row[1] or mk.replace("_", " ").title()  # metric_label (fallback to derived)
        uom = row[2]  # unit_of_measure

        meta = METRICS_REGISTRY.get(mk)
        display_format = meta.get("display_format", "number") if meta else "number"
        display_order = meta.get("display_order", 999) if meta else 999

        metric_infos.append((mk, ml, uom, display_format, display_order))

    # 6. Sort by (display_order, metric_label)
    metric_infos.sort(key=lambda x: (x[4], x[1]))

    # 7. Aggregate value for each metric
    cards = []
    for mk, ml, uom, display_format, display_order in metric_infos:
        val = await _query_single_metric_value(
            session, user, report_type_id, buyer, date, mk
        )

        prev_val = None
        delta = None
        pct_change = None

        if compare_date:
            prev_val = await _query_single_metric_value(
                session, user, report_type_id, buyer, compare_date, mk
            )
            if val is not None and prev_val is not None:
                delta = val - prev_val
                if prev_val != 0:
                    pct_change = (delta / prev_val) * 100
                else:
                    pct_change = 100.0 if delta > 0 else (-100.0 if delta < 0 else 0.0)

        cards.append(
            QadCard(
                key=mk,
                label=ml,
                value=val,
                previous_value=prev_val,
                delta=delta,
                pct_change=pct_change,
                unit=uom,
                display_format=display_format,
                display_order=display_order,
            )
        )

    return QadAnalysisResponse(
        report_type=rt_name,
        report_date=date.isoformat(),
        buyer=buyer,
        cards=cards,
    )
