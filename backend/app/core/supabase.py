from supabase import AsyncClient, create_async_client

from app.core.config import settings


async def get_supabase_client() -> AsyncClient | None:
    if not settings.supabase_url or not settings.supabase_service_role_key:
        return None

    return await create_async_client(str(settings.supabase_url), settings.supabase_service_role_key)
