from uuid import UUID

from sqlalchemy import text
from sqlalchemy.engine import RowMapping
from sqlalchemy.ext.asyncio import AsyncSession

from app.admin.schemas import AdminRoleOption, AdminUser
from app.auth.constants import Permission, UserRole
from app.auth.schemas import AuthUser

USER_LIST_QUERY = text(
    """
    with filtered_users as (
      select
        u.id,
        u.email,
        u.full_name,
        r.name as role,
        u.is_active,
        u.created_at,
        u.updated_at,
        coalesce(array_remove(array_agg(distinct up.permission), null), '{}') as permissions
      from public.users u
      join public.roles r on r.id = u.role_id
      left join public.user_permissions up on up.user_id = u.id
      where (:search = '' or u.email ilike :search_pattern or u.full_name ilike :search_pattern)
        and (:role = '' or r.name = :role)
        and (
          :status = ''
          or (:status = 'active' and u.is_active)
          or (:status = 'disabled' and not u.is_active)
        )
      group by u.id, u.email, u.full_name, r.name, u.is_active, u.created_at, u.updated_at
    )
    select *, count(*) over() as total_count
    from filtered_users
    order by created_at desc, email asc
    limit :limit
    offset :offset
    """
)

USER_PROFILE_LIST_QUERY = text(
    """
    select
      u.id,
      u.email,
      u.full_name,
      r.name as role,
      u.is_active,
      u.created_at,
      u.updated_at,
      coalesce(array_remove(array_agg(distinct up.permission), null), '{}') as permissions
    from public.users u
    join public.roles r on r.id = u.role_id
    left join public.user_permissions up on up.user_id = u.id
    group by u.id, u.email, u.full_name, r.name, u.is_active, u.created_at, u.updated_at
    """
)

ROLE_LIST_QUERY = text(
    """
    select id, name, description
    from public.roles
    order by id
    """
)

USER_BY_ID_QUERY = text(
    """
    select
      u.id,
      u.email,
      u.full_name,
      r.name as role,
      u.is_active,
      u.created_at,
      u.updated_at,
      coalesce(array_remove(array_agg(distinct up.permission), null), '{}') as permissions
    from public.users u
    join public.roles r on r.id = u.role_id
    left join public.user_permissions up on up.user_id = u.id
    where u.id = cast(:user_id as uuid)
    group by u.id, u.email, u.full_name, r.name, u.is_active, u.created_at, u.updated_at
    """
)

UPSERT_USER_QUERY = text(
    """
    insert into public.users (id, email, full_name, role_id, is_active)
    select cast(:user_id as uuid), :email, :full_name, roles.id, :is_active
    from public.roles roles
    where roles.name = :role
    on conflict (id) do update
    set
      email = excluded.email,
      full_name = excluded.full_name,
      role_id = excluded.role_id,
      is_active = excluded.is_active
    """
)

DELETE_USER_PERMISSIONS_QUERY = text(
    """
    delete from public.user_permissions
    where user_id = cast(:user_id as uuid)
    """
)

INSERT_USER_PERMISSION_QUERY = text(
    """
    insert into public.user_permissions (user_id, permission)
    values (cast(:user_id as uuid), :permission)
    on conflict (user_id, permission, resource_type, resource_id) do nothing
    """
)

SET_USER_ACTIVE_QUERY = text(
    """
    update public.users
    set is_active = :is_active
    where id = cast(:user_id as uuid)
    """
)

INSERT_AUDIT_LOG_QUERY = text(
    """
    insert into public.audit_logs (
      actor_id,
      actor_user_id,
      action,
      entity_type,
      entity_id,
      target_type,
      target_id,
      metadata
    )
      values (
        cast(:actor_user_id as uuid),
        cast(:actor_user_id as uuid),
        :action,
        :target_type,
        :target_id_text,
        :target_type,
        cast(:target_id as uuid),
        cast(:metadata as jsonb)
      )
    """
)


def _serialize_user(row: RowMapping) -> AdminUser:
    permissions_value = row["permissions"] or []
    return AdminUser(
        id=UUID(str(row["id"])),
        email=str(row["email"]),
        full_name=str(row["full_name"]) if row["full_name"] else None,
        role=UserRole(str(row["role"])),
        is_active=bool(row["is_active"]),
        is_provisioned=True,
        permissions=[Permission(str(permission)) for permission in permissions_value],
        created_at=str(row["created_at"]),
        updated_at=str(row["updated_at"]),
    )


async def list_admin_user_profiles(session: AsyncSession) -> dict[UUID, AdminUser]:
    result = await session.execute(USER_PROFILE_LIST_QUERY)
    users = [_serialize_user(row) for row in result.mappings().all()]
    return {user.id: user for user in users}


async def list_admin_users(
    session: AsyncSession,
    *,
    search: str,
    role: str,
    status: str,
    unit: str,
    page: int,
    page_size: int,
) -> tuple[list[AdminUser], int]:
    search_value = search.strip()
    result = await session.execute(
        USER_LIST_QUERY,
        {
            "search": search_value,
            "search_pattern": f"%{search_value}%",
            "role": role,
            "status": status,
            "limit": page_size,
            "offset": (page - 1) * page_size,
        },
    )
    rows = result.mappings().all()
    users = [_serialize_user(row) for row in rows]
    total = int(rows[0]["total_count"]) if rows else 0
    return users, total


async def list_roles(session: AsyncSession) -> list[AdminRoleOption]:
    result = await session.execute(ROLE_LIST_QUERY)
    return [
        AdminRoleOption(
            id=int(row["id"]),
            name=UserRole(str(row["name"])),
            description=str(row["description"]),
        )
        for row in result.mappings().all()
    ]


async def get_admin_user(session: AsyncSession, user_id: UUID) -> AdminUser | None:
    result = await session.execute(USER_BY_ID_QUERY, {"user_id": str(user_id)})
    row = result.mappings().one_or_none()
    if row is None:
        return None
    return _serialize_user(row)


async def upsert_admin_user(
    session: AsyncSession,
    *,
    user_id: UUID,
    email: str,
    full_name: str,
    role: UserRole,
    is_active: bool,
    permissions: list[Permission],
    actor: AuthUser,
) -> AdminUser:
    await session.execute(
        UPSERT_USER_QUERY,
        {
            "user_id": str(user_id),
            "email": email,
            "full_name": full_name,
            "role": role.value,
            "is_active": is_active,
        },
    )
    await replace_user_permissions(session, user_id=user_id, permissions=permissions)
    user = await get_admin_user(session, user_id)
    if user is None:
        raise RuntimeError("User was not created.")
    return user


async def replace_user_permissions(
    session: AsyncSession,
    *,
    user_id: UUID,
    permissions: list[Permission],
) -> None:
    await session.execute(DELETE_USER_PERMISSIONS_QUERY, {"user_id": str(user_id)})
    for permission in permissions:
        await session.execute(
            INSERT_USER_PERMISSION_QUERY,
            {
                "user_id": str(user_id),
                "permission": permission.value,
            },
        )


async def set_user_active(
    session: AsyncSession,
    *,
    user_id: UUID,
    is_active: bool,
) -> None:
    await session.execute(
        SET_USER_ACTIVE_QUERY,
        {"user_id": str(user_id), "is_active": is_active},
    )


async def create_audit_log(
    session: AsyncSession,
    *,
    actor: AuthUser,
    action: str,
    target_id: UUID,
    metadata: str,
) -> None:
    await session.execute(
        INSERT_AUDIT_LOG_QUERY,
        {
            "actor_user_id": str(actor.id),
            "action": action,
            "target_type": "user",
            "target_id_text": str(target_id),
            "target_id": str(target_id),
            "metadata": metadata,
        },
    )
