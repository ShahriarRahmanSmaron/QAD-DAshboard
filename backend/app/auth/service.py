from uuid import UUID
import logging

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.constants import Permission, UserRole
from app.auth.models import UserPermission
from app.auth.schemas import AuthUser

logger = logging.getLogger(__name__)

USER_PROFILE_QUERY = text(
    """
    select
      u.id,
      coalesce(u.email, :email) as email,
      u.full_name,
      r.name as role,
      coalesce(array_remove(array_agg(distinct up.permission), null), '{}') as permissions
    from public.users u
    join public.roles r on r.id = u.role_id
    left join public.user_permissions up on up.user_id = u.id
    where u.id = cast(:user_id as uuid)
      and u.is_active = true
    group by u.id, u.email, u.full_name, r.name
    """
)


async def get_user_profile(
    session: AsyncSession,
    *,
    user_id: UUID,
    email: str | None,
) -> AuthUser | None:
    result = await session.execute(
        USER_PROFILE_QUERY,
        {"user_id": str(user_id), "email": email or ""},
    )
    row = result.mappings().one_or_none()
    if row is None:
        return None

    permissions_value = row["permissions"] or []
    permissions = [str(permission) for permission in permissions_value]
    role = UserRole(str(row["role"]))

    logger.warning(
        "AUTH_DIAG role=%s permissions=%s",
        role,
        permissions,
    )

    # Mirror require_permission decorator's role-based grants (dependencies.py:111-115)
    # VIEWER and EDITOR roles always have reports:read access
    if role in {UserRole.EDITOR, UserRole.VIEWER}:
        if Permission.REPORTS_READ.value not in permissions:
            permissions.append(Permission.REPORTS_READ.value)

    return AuthUser(
        id=UUID(str(row["id"])),
        email=str(row["email"]),
        full_name=str(row["full_name"]) if row["full_name"] else None,
        role=role,
        permissions=permissions,
    )


async def has_explicit_permission(
    session: AsyncSession,
    *,
    user_id: UUID,
    permission: Permission,
    resource_type: str | None = None,
    resource_id: str | None = None,
) -> bool:
    stmt = select(UserPermission.id).where(
        UserPermission.user_id == user_id,
        UserPermission.permission == permission.value,
    )

    if resource_type is not None:
        stmt = stmt.where(UserPermission.resource_type == resource_type)

    if resource_id is not None:
        stmt = stmt.where(UserPermission.resource_id == UUID(resource_id))

    stmt = stmt.limit(1)

    result = await session.execute(stmt)
    return result.scalar_one_or_none() is not None
