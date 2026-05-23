from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.constants import Permission, UserRole
from app.auth.schemas import AuthUser

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

USER_PERMISSION_QUERY = text(
    """
    select 1
    from public.user_permissions
    where user_id = cast(:user_id as uuid)
      and permission = :permission
      and (:resource_type is null or resource_type = :resource_type)
      and (:resource_id is null or resource_id = cast(:resource_id as uuid))
    limit 1
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

    return AuthUser(
        id=UUID(str(row["id"])),
        email=str(row["email"]),
        full_name=str(row["full_name"]) if row["full_name"] else None,
        role=UserRole(str(row["role"])),
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
    result = await session.execute(
        USER_PERMISSION_QUERY,
        {
            "user_id": str(user_id),
            "permission": permission.value,
            "resource_type": resource_type,
            "resource_id": resource_id,
        },
    )
    return result.scalar_one_or_none() is not None
