from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.constants import Permission
from app.auth.dependencies import require_permission
from app.auth.schemas import AuthUser
from app.db.session import get_db_session
from app.reporting import repository
from app.reporting.schemas import (
    BuyerListResponse,
    BuyerOption,
    ReportTypeListResponse,
    ReportTypeOption,
    UnitListResponse,
    UnitOption,
)

router = APIRouter(tags=["lookups"])
SessionDep = Annotated[AsyncSession, Depends(get_db_session)]
ReaderDep = Annotated[AuthUser, Depends(require_permission(Permission.REPORTS_READ))]


@router.get("/buyers", response_model=BuyerListResponse)
async def list_buyers(session: SessionDep, _user: ReaderDep) -> BuyerListResponse:
    buyers = await repository.list_active_buyers(session)
    return BuyerListResponse(buyers=[BuyerOption.model_validate(buyer) for buyer in buyers])


@router.get("/units", response_model=UnitListResponse)
async def list_units(session: SessionDep, _user: ReaderDep) -> UnitListResponse:
    units = await repository.list_active_units(session)
    return UnitListResponse(units=[UnitOption.model_validate(unit) for unit in units])


@router.get("/report-types", response_model=ReportTypeListResponse)
async def list_report_types(session: SessionDep, _user: ReaderDep) -> ReportTypeListResponse:
    report_types = await repository.list_active_report_types(session)
    return ReportTypeListResponse(
        report_types=[ReportTypeOption.model_validate(report_type) for report_type in report_types]
    )
