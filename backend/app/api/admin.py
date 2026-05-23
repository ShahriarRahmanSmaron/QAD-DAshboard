import json
import secrets
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from supabase import AsyncClient

from app.admin.schemas import (
    AdminPasswordResetRequest,
    AdminRoleListResponse,
    AdminStatusResponse,
    AdminUser,
    AdminUserCreateRequest,
    AdminUserListResponse,
    AdminUserUpdateRequest,
    SupabaseAdminUser,
)
from app.admin.service import (
    create_audit_log,
    get_admin_user,
    list_admin_user_profiles,
    list_roles,
    set_user_active,
    upsert_admin_user,
)
from app.auth.constants import UserRole
from app.auth.dependencies import CurrentUserDep
from app.auth.schemas import AuthUser
from app.core.supabase import get_required_supabase_admin_client
from app.db.session import get_db_session

router = APIRouter(prefix="/admin", tags=["admin"])
SessionDep = Annotated[AsyncSession, Depends(get_db_session)]
AdminSupabaseDep = Annotated[AsyncClient, Depends(get_required_supabase_admin_client)]


async def require_admin(user: CurrentUserDep) -> AuthUser:
    if user.role != UserRole.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access is required.",
        )

    return user


AdminUserDep = Annotated[AuthUser, Depends(require_admin)]


async def find_supabase_user_by_email(
    supabase: AsyncClient,
    email: str,
) -> SupabaseAdminUser | None:
    users = await supabase.auth.admin.list_users()
    for user in users:
        auth_user = SupabaseAdminUser.model_validate(user)
        if auth_user.email and auth_user.email.lower() == email.lower():
            return auth_user

    return None


def _get_auth_user_full_name(auth_user: SupabaseAdminUser) -> str | None:
    metadata = getattr(auth_user, "user_metadata", None)
    if isinstance(metadata, dict):
        full_name = metadata.get("full_name")
        if isinstance(full_name, str) and full_name.strip():
            return full_name.strip()

    return None


def _serialize_unprovisioned_auth_user(auth_user: SupabaseAdminUser) -> AdminUser:
    return AdminUser(
        id=UUID(auth_user.id),
        email=auth_user.email or "",
        full_name=_get_auth_user_full_name(auth_user),
        role=UserRole.VIEWER,
        is_active=False,
        is_provisioned=False,
        permissions=[],
        created_at=str(getattr(auth_user, "created_at", "")),
        updated_at=str(getattr(auth_user, "updated_at", "")),
    )


def _matches_user_filters(
    user: AdminUser,
    *,
    search: str,
    role: str,
    status: str,
) -> bool:
    search_value = search.strip().lower()
    if search_value and search_value not in user.email.lower() and search_value not in (
        user.full_name or ""
    ).lower():
        return False
    if role and user.role.value != role:
        return False
    if status == "active" and not (user.is_provisioned and user.is_active):
        return False
    if status == "disabled" and (user.is_provisioned and user.is_active):
        return False
    return True


@router.get("/roles", response_model=AdminRoleListResponse)
async def get_roles(
    session: SessionDep,
    _admin: AdminUserDep,
) -> AdminRoleListResponse:
    return AdminRoleListResponse(roles=await list_roles(session))


@router.get("/users", response_model=AdminUserListResponse)
async def get_users(
    session: SessionDep,
    supabase: AdminSupabaseDep,
    _admin: AdminUserDep,
    search: str = "",
    role: str = "",
    account_status: Annotated[str, Query(alias="status")] = "",
    unit: str = "",
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=5, le=100)] = 20,
) -> AdminUserListResponse:
    if role not in {"", "admin", "editor", "viewer"}:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Invalid role.",
        )
    if account_status not in {"", "active", "disabled"}:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Invalid account status.",
        )

    auth_users = await supabase.auth.admin.list_users()
    profiles = await list_admin_user_profiles(session)
    merged_users = [
        profiles.get(UUID(str(auth_user.id)))
        or _serialize_unprovisioned_auth_user(SupabaseAdminUser.model_validate(auth_user))
        for auth_user in auth_users
    ]
    filtered_users = [
        user
        for user in merged_users
        if _matches_user_filters(
            user,
            search=search,
            role=role,
            status=account_status,
        )
    ]
    filtered_users.sort(key=lambda user: user.created_at, reverse=True)
    total = len(filtered_users)
    page_start = (page - 1) * page_size
    users = filtered_users[page_start : page_start + page_size]
    return AdminUserListResponse(
        users=users,
        total=total,
        page=page,
        page_size=page_size,
    )


@router.post("/users", response_model=AdminUser, status_code=status.HTTP_201_CREATED)
async def create_user(
    payload: AdminUserCreateRequest,
    session: SessionDep,
    supabase: AdminSupabaseDep,
    admin: AdminUserDep,
) -> AdminUser:
    auth_user = await find_supabase_user_by_email(supabase, payload.email)
    if auth_user is None:
        try:
            auth_response = await supabase.auth.admin.create_user(
                {
                    "email": payload.email,
                    "password": secrets.token_urlsafe(18),
                    "email_confirm": True,
                    "user_metadata": {"full_name": payload.full_name},
                }
            )
            auth_user = SupabaseAdminUser.model_validate(auth_response.user)
        except Exception as exc:
            fallback_user = await find_supabase_user_by_email(supabase, payload.email)
            if fallback_user is None:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Unable to create Supabase Auth user: {exc}",
                ) from exc
            auth_user = fallback_user

    user = await upsert_admin_user(
        session,
        user_id=UUID(auth_user.id),
        email=auth_user.email or payload.email,
        full_name=payload.full_name,
        role=payload.role,
        is_active=True,
        permissions=payload.permissions,
        actor=admin,
    )
    await create_audit_log(
        session,
        actor=admin,
        action="user.created",
        target_id=user.id,
        metadata=json.dumps(
            {
                "email": user.email,
                "role": user.role.value,
                "permissions": [permission.value for permission in user.permissions],
            }
        ),
    )
    await session.commit()
    return user


@router.put("/users/{user_id}", response_model=AdminUser)
async def update_user(
    user_id: UUID,
    payload: AdminUserUpdateRequest,
    session: SessionDep,
    supabase: AdminSupabaseDep,
    admin: AdminUserDep,
) -> AdminUser:
    existing = await get_admin_user(session, user_id)
    if existing is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")

    try:
        await supabase.auth.admin.update_user_by_id(
            str(user_id),
            {
                "user_metadata": {"full_name": payload.full_name},
                "ban_duration": "none" if payload.is_active else "876000h",
            },
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unable to update Supabase Auth user.",
        ) from exc

    user = await upsert_admin_user(
        session,
        user_id=user_id,
        email=existing.email,
        full_name=payload.full_name,
        role=payload.role,
        is_active=payload.is_active,
        permissions=payload.permissions,
        actor=admin,
    )
    await create_audit_log(
        session,
        actor=admin,
        action="user.updated",
        target_id=user.id,
        metadata=json.dumps(
            {
                "role": user.role.value,
                "is_active": user.is_active,
                "permissions": [permission.value for permission in user.permissions],
            }
        ),
    )
    await session.commit()
    return user


@router.post("/users/{user_id}/reset-password", response_model=AdminStatusResponse)
async def reset_password(
    user_id: UUID,
    payload: AdminPasswordResetRequest,
    session: SessionDep,
    supabase: AdminSupabaseDep,
    admin: AdminUserDep,
) -> AdminStatusResponse:
    existing = await get_admin_user(session, user_id)
    if existing is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")

    try:
        await supabase.auth.admin.update_user_by_id(str(user_id), {"password": payload.password})
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unable to reset user password.",
        ) from exc

    await create_audit_log(
        session,
        actor=admin,
        action="user.password_reset",
        target_id=user_id,
        metadata=json.dumps({"email": existing.email}),
    )
    await session.commit()
    return AdminStatusResponse(ok=True)


@router.post("/users/{user_id}/disable", response_model=AdminStatusResponse)
async def disable_user(
    user_id: UUID,
    session: SessionDep,
    supabase: AdminSupabaseDep,
    admin: AdminUserDep,
) -> AdminStatusResponse:
    existing = await get_admin_user(session, user_id)
    if existing is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")
    if user_id == admin.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Admins cannot disable their own account.",
        )

    try:
        await supabase.auth.admin.update_user_by_id(str(user_id), {"ban_duration": "876000h"})
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unable to disable Supabase Auth user.",
        ) from exc

    await set_user_active(session, user_id=user_id, is_active=False)
    await create_audit_log(
        session,
        actor=admin,
        action="user.disabled",
        target_id=user_id,
        metadata=json.dumps({"email": existing.email}),
    )
    await session.commit()
    return AdminStatusResponse(ok=True)


@router.post("/users/{user_id}/enable", response_model=AdminStatusResponse)
async def enable_user(
    user_id: UUID,
    session: SessionDep,
    supabase: AdminSupabaseDep,
    admin: AdminUserDep,
) -> AdminStatusResponse:
    existing = await get_admin_user(session, user_id)
    if existing is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")

    try:
        await supabase.auth.admin.update_user_by_id(str(user_id), {"ban_duration": "none"})
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unable to enable Supabase Auth user.",
        ) from exc

    await set_user_active(session, user_id=user_id, is_active=True)
    await create_audit_log(
        session,
        actor=admin,
        action="user.enabled",
        target_id=user_id,
        metadata=json.dumps({"email": existing.email}),
    )
    await session.commit()
    return AdminStatusResponse(ok=True)
