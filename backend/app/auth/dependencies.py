from collections.abc import Callable
from typing import Annotated
from uuid import UUID

from fastapi import Depends, Header, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession
from supabase import AsyncClient

from app.auth.constants import ACCESS_TOKEN_COOKIE, Permission, UserRole
from app.auth.schemas import AuthUser
from app.auth.service import get_user_profile, has_explicit_permission
from app.core.supabase import get_required_supabase_client
from app.db.session import get_db_session

SessionDep = Annotated[AsyncSession, Depends(get_db_session)]
SupabaseDep = Annotated[AsyncClient, Depends(get_required_supabase_client)]


def _get_bearer_token(authorization: str | None) -> str | None:
    if not authorization:
        return None

    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        return None

    return token.strip()


async def get_current_user(
    request: Request,
    session: SessionDep,
    supabase: SupabaseDep,
    authorization: Annotated[str | None, Header()] = None,
) -> AuthUser:
    token = _get_bearer_token(authorization) or request.cookies.get(ACCESS_TOKEN_COOKIE)
    if token is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication is required.",
        )

    try:
        user_response = await supabase.auth.get_user(token)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired authentication token.",
        ) from exc

    if user_response is None or user_response.user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication token.",
        )

    profile = await get_user_profile(
        session,
        user_id=UUID(user_response.user.id),
        email=user_response.user.email,
    )
    if profile is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User profile is not provisioned.",
        )

    return profile


CurrentUserDep = Annotated[AuthUser, Depends(get_current_user)]


def require_permission(
    permission: Permission,
    *,
    resource_type: str | None = None,
    resource_id_param: str | None = None,
) -> Callable[..., object]:
    async def dependency(
        request: Request,
        user: CurrentUserDep,
        session: SessionDep,
    ) -> AuthUser:
        if user.role == UserRole.ADMIN:
            return user

        if permission == Permission.REPORTS_READ and user.role in {
            UserRole.EDITOR,
            UserRole.VIEWER,
        }:
            return user

        resource_id = (
            str(request.path_params[resource_id_param])
            if resource_id_param and resource_id_param in request.path_params
            else None
        )
        if user.role == UserRole.EDITOR and await has_explicit_permission(
            session,
            user_id=user.id,
            permission=permission,
            resource_type=resource_type,
            resource_id=resource_id,
        ):
            return user

        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to access this resource.",
        )

    return dependency
