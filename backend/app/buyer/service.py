from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.buyer.schemas import BuyerEntry
from app.reporting.repository import list_active_buyers

GET_USER_BUYERS_QUERY = text("""
    SELECT buyer_name
    FROM public.user_buyers
    WHERE user_id = cast(:user_id as uuid)
    ORDER BY buyer_name
""")

DELETE_USER_BUYERS_QUERY = text("""
    DELETE FROM public.user_buyers
    WHERE user_id = cast(:user_id as uuid)
""")

INSERT_USER_BUYER_QUERY = text("""
    INSERT INTO public.user_buyers (user_id, buyer_name, granted_by)
    VALUES (cast(:user_id as uuid), :buyer_name, cast(:granted_by as uuid))
    ON CONFLICT (user_id, buyer_name) DO NOTHING
""")


async def get_user_assigned_buyers(
    session: AsyncSession,
    user_id: UUID,
) -> list[BuyerEntry]:
    result = await session.execute(
        GET_USER_BUYERS_QUERY,
        {"user_id": str(user_id)},
    )
    rows = result.mappings().all()
    return [BuyerEntry(name=str(row["buyer_name"])) for row in rows]


async def replace_user_buyers(
    session: AsyncSession,
    *,
    user_id: UUID,
    buyer_names: list[str],
    granted_by: UUID,
) -> None:
    valid_buyers = await list_active_buyers(session)
    valid_names = {buyer.name for buyer in valid_buyers}

    for name in buyer_names:
        if name not in valid_names:
            raise ValueError(
                f"Buyer '{name}' is not a valid active buyer."
            )

    await session.execute(DELETE_USER_BUYERS_QUERY, {"user_id": str(user_id)})
    for name in buyer_names:
        await session.execute(
            INSERT_USER_BUYER_QUERY,
            {
                "user_id": str(user_id),
                "buyer_name": name,
                "granted_by": str(granted_by),
            },
        )
