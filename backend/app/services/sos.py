from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.errors import AppError
from app.geo import point_ewkt
from app.models import Citizen, SosSignal, utcnow
from app.realtime.events import Event, EventList, bus
from app.services.citizens import zone_for
from app.services.crisis_engine import evaluate_sos, record_sos
from app.services.priority import TYPE_WEIGHT, compute_priority
from app.services.serialize import sos_out

COOLDOWN_KEY = "sos:cooldown:{}"


async def enforce_cooldown(citizen: Citizen) -> None:
    """Atomic per-citizen cooldown (SET NX EX) so it holds across API workers."""
    if bus.redis is None:
        return
    key = COOLDOWN_KEY.format(citizen.device_id)
    if not await bus.redis.set(key, "1", nx=True, ex=settings.sos_cooldown_sec):
        ttl = max(1, await bus.redis.ttl(key))
        raise AppError(429, "SOS_COOLDOWN", {"retry_after_sec": ttl}, headers={"Retry-After": str(ttl)}, seconds=ttl)


async def create_sos(session: AsyncSession, citizen: Citizen, type_: str, lat: float, lng: float,
                     note: str | None, events: EventList, *, created_at: datetime | None = None,
                     now: datetime | None = None, cooldown: bool = True, suspected: bool = False,
                     suspicion_reason: str | None = None, ip_hash: str | None = None,
                     defer: bool = False) -> SosSignal:
    """defer=True (POST /sos with CRISIS_ASYNC): store + announce now, crisis evaluation by the queue
    consumers after commit (the caller enqueues the id)."""
    if cooldown:
        await enforce_cooldown(citizen)
    now = now or utcnow()
    zone_id = await zone_for(session, lat, lng)
    sos = SosSignal(citizen_id=citizen.id, type=type_, location=point_ewkt(lat, lng), zone_id=zone_id, note=note,
                    status="new", created_at=created_at or now,
                    citizen_mobility_impaired=citizen.mobility_impaired, is_suspected=suspected,
                    suspicion_reason=suspicion_reason, source_ip_hash=ip_hash)
    session.add(sos)
    citizen.location = point_ewkt(lat, lng)
    citizen.zone_id = zone_id
    if suspected:
        # quarantined: stored for review, but no in_danger count, no crisis engine, no live event.
        # Plausible score without extra queries (a 0 would tell a bot it was detected).
        sos.priority_score = float(TYPE_WEIGHT.get(type_, 0))
        await session.flush()  # no refresh: every field is already set (saves a SELECT per request)
        return sos
    citizen.status = "in_danger"
    if defer:
        sos.priority_score = float(TYPE_WEIGHT.get(type_, 0))  # refined by the consumer (sos.updated)
        await session.flush()
        events.append(Event("sos.created", sos_out(sos)))
        return sos
    await session.flush()
    await session.refresh(sos)
    await activate_sos(session, sos, events, now)
    return sos


async def activate_sos(session: AsyncSession, sos: SosSignal, events: EventList, now: datetime,
                       emit_created: bool = True) -> None:
    """Make a (new or reviewed-genuine) SOS count: crisis window, priority, live event, crisis engine."""
    await record_sos(sos)
    sos.priority_score = round(await compute_priority(session, sos, now), 2)
    sos.evaluated_at = now
    await session.flush()
    events.append(Event("sos.created" if emit_created else "sos.updated", sos_out(sos)))
    await evaluate_sos(session, sos, events, now)
