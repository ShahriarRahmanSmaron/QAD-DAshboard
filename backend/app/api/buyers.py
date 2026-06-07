from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status

from app.auth.constants import Permission
from app.auth.dependencies import (
    CurrentUserDep,
    SessionDep,
    get_user_buyer_filter,
    require_permission,
)
from app.buyer.schemas import BuyerAssignmentListResponse, BuyerEntry
from app.buyer.service import get_user_assigned_buyers

router = APIRouter(tags=["buyers"])


@router.get("/buyers/assigned", response_model=BuyerAssignmentListResponse)
async def get_assigned_buyers(
    user: Annotated[CurrentUserDep, Depends(require_permission(Permission.BUYERS_ACCESS))],
    session: SessionDep,
) -> BuyerAssignmentListResponse:
    buyers = await get_user_assigned_buyers(session, user.id)
    return BuyerAssignmentListResponse(buyers=buyers)


@router.get("/buyers/permissions", response_model=BuyerAssignmentListResponse)
async def get_buyer_permissions(
    user: CurrentUserDep,
    session: SessionDep,
) -> BuyerAssignmentListResponse:
    buyer_names = await get_user_buyer_filter(user, session)
    return BuyerAssignmentListResponse(
        buyers=[BuyerEntry(name=name) for name in buyer_names]
    )
