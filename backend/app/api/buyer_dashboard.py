from datetime import date
from typing import Annotated, TypedDict
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
    available_reports: list[BuyerReportTypeOption]
    available_buyers: list[BuyerOption]


class QadCard(BaseModel):
    key: str
    label: str
    value: float | None = None
    previous_value: float | None = None
    delta: float | None = None
    pct_change: float | None = None


class QadAnalysisResponse(BaseModel):
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

    return BuyerDashboardBootstrapResponse(
        default_report_type_id=rt.id,
        latest_date=latest_date_str,
        available_reports=available_reports,
        available_buyers=available_buyers
    )


def _get_metric_agg_func(key: str):
    if "pct" in key.lower() or "percent" in key.lower():
        return func.avg(OperationalFact.value_numeric)
    return func.sum(OperationalFact.value_numeric)


async def _query_buyer_metric_value(
    session: AsyncSession,
    user: AuthUser,
    report_type_id: UUID,
    buyer: str,
    target_date: date,
    metric_keys: list[str],
) -> float | None:
    agg_func = _get_metric_agg_func(metric_keys[0])
    stmt = (
        select(agg_func)
        .select_from(OperationalFact)
        .join(UploadedFile, UploadedFile.id == OperationalFact.uploaded_file_id)
        .where(
            UploadedFile.report_type_id == report_type_id,
            func.lower(OperationalFact.buyer) == buyer.strip().lower(),
            OperationalFact.report_date == target_date,
            OperationalFact.metric_key.in_(metric_keys),
            OperationalFact.row_classification == "detail",
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

    # 2. Check if any facts exist for this buyer on the target date
    check_stmt = (
        select(func.count(OperationalFact.id))
        .select_from(OperationalFact)
        .join(UploadedFile, UploadedFile.id == OperationalFact.uploaded_file_id)
        .where(
            UploadedFile.report_type_id == report_type_id,
            func.lower(OperationalFact.buyer) == buyer.strip().lower(),
            OperationalFact.report_date == date,
            OperationalFact.row_classification == "detail",
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

    # DIAGNOSTIC: Log all distinct metric_keys for this report_type
    import logging
    _qad_log = logging.getLogger(__name__)
    keys_stmt = (
        select(
            func.distinct(OperationalFact.metric_key),
            func.count(OperationalFact.id).label("cnt"),
        )
        .select_from(OperationalFact)
        .join(UploadedFile, UploadedFile.id == OperationalFact.uploaded_file_id)
        .where(
            UploadedFile.report_type_id == report_type_id,
            OperationalFact.row_classification == "detail",
            OperationalFact.deleted_at.is_(None),
            OperationalFact.is_active.is_(True),
            UploadedFile.deleted_at.is_(None),
            UploadedFile.is_active_workbook.is_(True),
            UploadedFile.archived_at.is_(None),
            get_fact_visibility_filter(user),
        )
        .group_by(OperationalFact.metric_key)
        .order_by(func.count(OperationalFact.id).desc())
    )
    keys_result = await session.execute(keys_stmt)
    actual_keys = [(row[0], row[1]) for row in keys_result.all()]
    _qad_log.warning("QAD_DIAG: Actual metric_keys in DB for report_type=%s: %s", report_type_id, actual_keys)

    class MetricDefinition(TypedDict):
        key: str
        label: str
        db_keys: list[str]

    # 3. Define metrics to query (with synonyms for robustness)
    metric_definitions: list[MetricDefinition] = [
        {"key": "wait_for_test", "label": "Wait For Test", "db_keys": ["wait_for_test"]},
        {"key": "pass_pct", "label": "Pass %", "db_keys": ["pass_pct", "pass", "pass_percent"]},
        {"key": "fail_pct", "label": "Fail %", "db_keys": ["fail_pct", "fail", "fail_percent"]},
        {
            "key": "need_approval_pct",
            "label": "Need Approval %",
            "db_keys": ["need_approval_pct", "need_approval", "need_approval_percent"],
        },
        {
            "key": "no_app_pct",
            "label": "No App %",
            "db_keys": ["no_app_pct", "no_app", "no_app_percent"],
        },
        {"key": "total_weight", "label": "Total Weight", "db_keys": ["total_weight", "total_wgt"]},
    ]

    cards = []
    for defn in metric_definitions:
        val = await _query_buyer_metric_value(
            session, user, report_type_id, buyer, date, defn["db_keys"]
        )

        prev_val = None
        delta = None
        pct_change = None

        if compare_date:
            prev_val = await _query_buyer_metric_value(
                session, user, report_type_id, buyer, compare_date, defn["db_keys"]
            )
            if val is not None and prev_val is not None:
                delta = val - prev_val
                if prev_val != 0:
                    pct_change = (delta / prev_val) * 100
                else:
                    pct_change = 100.0 if delta > 0 else (-100.0 if delta < 0 else 0.0)

        cards.append(
            QadCard(
                key=defn["key"],
                label=defn["label"],
                value=val,
                previous_value=prev_val,
                delta=delta,
                pct_change=pct_change
            )
        )

    return QadAnalysisResponse(cards=cards)
