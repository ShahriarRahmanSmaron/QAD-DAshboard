import logging
import time
from collections.abc import AsyncIterator

from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import settings

logger = logging.getLogger("app.db")

engine = create_async_engine(
    settings.database_url,
    pool_pre_ping=True,
    pool_size=5,
    max_overflow=10,
    pool_recycle=1800,
)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)


# Slow query logging via sync engine events (asyncpg exposes the sync engine underneath)
_sync_engine = engine.sync_engine


@event.listens_for(_sync_engine, "before_cursor_execute")
def _before_cursor_execute(conn, cursor, statement, parameters, context, executemany):  # noqa: ANN001, ANN201
    conn.info["query_start_time"] = time.perf_counter()


@event.listens_for(_sync_engine, "after_cursor_execute")
def _after_cursor_execute(conn, cursor, statement, parameters, context, executemany):  # noqa: ANN001, ANN201
    elapsed_ms = (time.perf_counter() - conn.info.get("query_start_time", 0)) * 1000
    if elapsed_ms >= settings.slow_query_threshold_ms:
        # Truncate statement for readability
        stmt_preview = statement[:200] + "..." if len(statement) > 200 else statement
        logger.warning(
            "slow query (%.1fms): %s",
            elapsed_ms,
            stmt_preview,
        )


async def get_db_session() -> AsyncIterator[AsyncSession]:
    async with AsyncSessionLocal() as session:
        yield session
