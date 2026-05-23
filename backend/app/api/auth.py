from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from supabase import AsyncClient

from app.auth.dependencies import get_current_user
from app.auth.schemas import (
    AuthSessionResponse,
    AuthStatusResponse,
    AuthUser,
    CurrentUserResponse,
    LoginRequest,
    RefreshRequest,
    SupabaseSessionPayload,
)
from app.auth.service import get_user_profile
from app.core.supabase import get_required_supabase_client
from app.db.session import get_db_session

router = APIRouter(prefix="/auth", tags=["auth"])
SessionDep = Annotated[AsyncSession, Depends(get_db_session)]
SupabaseDep = Annotated[AsyncClient, Depends(get_required_supabase_client)]
CurrentUserDep = Annotated[AuthUser, Depends(get_current_user)]


@router.post("/login", response_model=AuthSessionResponse)
async def login(
    payload: LoginRequest,
    session: SessionDep,
    supabase: SupabaseDep,
) -> AuthSessionResponse:
    try:
        auth_response = await supabase.auth.sign_in_with_password(
            {"email": payload.email, "password": payload.password}
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password.",
        ) from exc

    if auth_response.session is None or auth_response.user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password.",
        )

    profile = await get_user_profile(
        session,
        user_id=UUID(auth_response.user.id),
        email=auth_response.user.email,
    )
    if profile is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User profile is not provisioned.",
        )

    auth_session = SupabaseSessionPayload.model_validate(auth_response.session)
    return AuthSessionResponse(**auth_session.model_dump(), user=profile)


@router.post("/refresh", response_model=AuthSessionResponse)
async def refresh_session(
    payload: RefreshRequest,
    session: SessionDep,
    supabase: SupabaseDep,
) -> AuthSessionResponse:
    try:
        auth_response = await supabase.auth.refresh_session(payload.refresh_token)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid refresh token.",
        ) from exc

    if auth_response.session is None or auth_response.session.user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid refresh token.",
        )

    profile = await get_user_profile(
        session,
        user_id=UUID(auth_response.session.user.id),
        email=auth_response.session.user.email,
    )
    if profile is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User profile is not provisioned.",
        )

    auth_session = SupabaseSessionPayload.model_validate(auth_response.session)
    return AuthSessionResponse(**auth_session.model_dump(), user=profile)


@router.get("/me", response_model=CurrentUserResponse)
async def me(user: CurrentUserDep) -> CurrentUserResponse:
    return CurrentUserResponse(user=user)


@router.post("/logout", response_model=AuthStatusResponse)
async def logout() -> AuthStatusResponse:
    return AuthStatusResponse(ok=True)
