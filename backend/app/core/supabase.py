from fastapi import HTTPException, status
from supabase import AsyncClient, create_async_client

from app.core.config import settings


async def get_supabase_client() -> AsyncClient | None:
    if not settings.supabase_url or not settings.supabase_anon_key:
        return None

    return await create_async_client(str(settings.supabase_url), settings.supabase_anon_key)


async def get_required_supabase_client() -> AsyncClient:
    client = await get_supabase_client()
    if client is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Supabase is not configured.",
        )

    return client


async def get_supabase_admin_client() -> AsyncClient | None:
    if not settings.supabase_url or not settings.supabase_service_role_key:
        return None

    return await create_async_client(
        str(settings.supabase_url),
        settings.supabase_service_role_key,
    )


async def get_required_supabase_admin_client() -> AsyncClient:
    client = await get_supabase_admin_client()
    if client is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Supabase admin client is not configured.",
        )

    return client
