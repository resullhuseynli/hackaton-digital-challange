"""Periodic background jobs. With several API workers each job runs once per tick cluster-wide,
guarded by a short Redis lock (SET NX PX)."""
import asyncio
import logging
from collections.abc import Awaitable, Callable

from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db import SessionLocal
from app.realtime.events import EventList, bus
from app.services import crisis_queue
from app.services.brigade_sim import tick
from app.services.overview import add_overview_event
from app.services.priority import refresh_priorities

log = logging.getLogger("app.jobs")
Job = Callable[[AsyncSession, EventList], Awaitable[None]]


async def run_locked(name: str, interval_sec: float, job: Job) -> None:
    while True:
        await asyncio.sleep(interval_sec)
        try:
            if bus.redis is not None and not await bus.redis.set(
                    f"lock:{name}", "1", nx=True, px=max(100, int(interval_sec * 900))):
                continue  # another worker owns this tick
            events: EventList = []
            async with SessionLocal() as session:
                await job(session, events)
                await session.commit()
            await bus.publish_many(events)
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001 - keep the loop alive
            log.exception("job %s failed", name)


async def priority_job(session: AsyncSession, events: EventList) -> None:
    """Every 30 s: recompute open SOS priorities and push a fresh dispatcher overview."""
    await refresh_priorities(session, events)
    await add_overview_event(session, events)
    await crisis_queue.requeue_stale(session)  # safety net for the async crisis queue


async def brigade_job(session: AsyncSession, events: EventList) -> None:
    """Every 2 s: move en_route / returning brigades along their routes."""
    moved = await tick(session, events, settings.brigade_tick_sec)
    if moved and any(e.data.get("status") in ("on_site", "idle") for e in events):
        await add_overview_event(session, events)


def background_coroutines() -> list:
    return [run_locked("priority", settings.priority_tick_sec, priority_job),
            run_locked("brigades", settings.brigade_tick_sec, brigade_job)]
