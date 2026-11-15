"""Asynchronous crisis evaluation.

POST /sos only stores the SOS and returns; the SOS id is pushed to a Redis list. Every API worker runs
consumer task(s) that pop ids and run the expensive part (priority, crisis-window bookkeeping, RED ALERT
detection/merging, recommendations) in their own transaction. Floods therefore can't hold request
latency hostage, and the alert-row lock is contended by a handful of consumers, not by every request.

Reliability: `sos_signals.evaluated_at` marks processed SOS; the periodic job re-enqueues anything left
unevaluated (e.g. a worker died mid-item). Processing is idempotent (skips evaluated/suspected SOS).
"""
import asyncio
import logging
from datetime import timedelta

from sqlalchemy import select

from app.config import settings
from app.db import SessionLocal
from app.models import SosSignal, utcnow
from app.realtime.events import EventList, bus

log = logging.getLogger("app.crisis_queue")
QUEUE = "crisis:queue"
STALE_AFTER = timedelta(seconds=15)


async def enqueue(sos_ids: list[int]) -> bool:
    """False if the queue is unavailable (caller then evaluates inline)."""
    if not sos_ids or bus.redis is None:
        return False
    try:
        await bus.redis.lpush(QUEUE, *sos_ids)
        return True
    except Exception as exc:  # noqa: BLE001
        log.warning("crisis queue unavailable (%r); evaluating inline", exc)
        return False


async def process(sos_id: int) -> bool:
    from app.services.sos import activate_sos  # avoid an import cycle

    events: EventList = []
    async with SessionLocal() as session:
        sos = await session.scalar(select(SosSignal).where(SosSignal.id == sos_id).with_for_update(skip_locked=True))
        if sos is None or sos.evaluated_at is not None or sos.is_suspected or sos.status == "rejected":
            return False
        await activate_sos(session, sos, events, utcnow(), emit_created=False)
        await session.commit()
    await bus.publish_many(events)
    return True


async def drain(max_items: int = 100_000) -> int:
    """Process everything currently queued (tests, shutdown)."""
    done = 0
    while done < max_items and bus.redis is not None:
        raw = await bus.redis.rpop(QUEUE)
        if raw is None:
            break
        await process(int(raw))
        done += 1
    return done


async def consumer_loop() -> None:
    while True:
        try:
            item = await bus.redis.brpop(QUEUE, timeout=5)
            if item is not None:
                await process(int(item[1]))
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001 - keep consuming
            log.exception("crisis consumer error")
            await asyncio.sleep(1)


async def requeue_stale(session) -> int:
    """Safety net (called by the periodic job): unevaluated SOS older than STALE_AFTER."""
    ids = (await session.scalars(select(SosSignal.id).where(
        SosSignal.evaluated_at.is_(None), SosSignal.is_suspected.is_(False), SosSignal.status == "new",
        SosSignal.created_at < utcnow() - STALE_AFTER).limit(1000))).all()
    if ids:
        log.warning("re-enqueuing %d unevaluated SOS", len(ids))
        await enqueue(list(ids))
    return len(ids)


def consumers() -> list:
    """0 is allowed for a dedicated deployment where only some processes consume (and for diagnostics)."""
    return [consumer_loop() for _ in range(max(0, settings.crisis_consumers_per_worker))]
