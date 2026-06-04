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
    ReportTypeListFlatResponse,
    ReportTypeOptionWithCounts,
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


from app.reporting.parser_registry import get_manifest

@router.get("/report-types", response_model=ReportTypeListFlatResponse)
async def list_report_types(session: SessionDep, _user: ReaderDep) -> ReportTypeListFlatResponse:
    """Dynamic report-type registry (MD07-5 Phase 5).

    Report types are generated from active workbook sources — never from
    hardcoded constants, seeded templates, or report definitions. Only report
    types backed by at least one active, non-archived, processed workbook are
    returned, each with its active-workbook count. Deleting, archiving, or
    deactivating the last workbook of a kind removes it here immediately;
    restoring or uploading one makes it reappear, with zero code changes for new
    workbook kinds.
    """
    report_types_with_counts = await repository.list_report_types_with_workbook_counts(session)
    return ReportTypeListFlatResponse(
        report_types=[
            ReportTypeOptionWithCounts(
                id=item["report_type"].id,
                code=item["report_type"].code,
                name=item["report_type"].name,
                description=item["report_type"].description,
                version=item["report_type"].version,
                is_active=item["report_type"].is_active,
                active_workbooks=item["active_workbooks"],
                manifest=get_manifest(item["report_type"].code),
            )
            for item in report_types_with_counts
        ]
    )
