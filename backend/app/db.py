from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import settings

engine = create_async_engine(settings.database_url, pool_pre_ping=True, pool_size=settings.db_pool_size,
                             max_overflow=settings.db_max_overflow, pool_timeout=10)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)


async def warm_pool() -> None:
    """Open the pool's base connections at startup, so a sudden flood doesn't pay for dozens of
    TCP + SCRAM handshakes at the worst possible moment."""
    conns = [await engine.connect() for _ in range(settings.db_pool_size)]
    for c in conns:
        await c.close()


async def get_session() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        yield session
