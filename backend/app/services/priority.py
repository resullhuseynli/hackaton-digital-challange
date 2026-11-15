"""SOS priority score.

priority = type_weight (collapse 40, medical 35, fire 30, flood 20)
         + min(wait_minutes * 2, 30)
         + nearby_sos_count_last_5min * 5          (other SOS within CLUSTER_RADIUS_M)
         + 15 if an active alert exists in the zone
"""
from datetime import datetime, timedelta

from geoalchemy2 import Geography
from sqlalchemy import cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import Alert, SosSignal, utcnow
from app.realtime.events import Event, EventList

TYPE_WEIGHT = {"collapse": 40, "medical": 35, "fire": 30, "flood": 20}
NEARBY_WINDOW = timedelta(minutes=5)


async def compute_priority(session: AsyncSession, sos: SosSignal, now: datetime | None = None) -> float:
    now = now or utcnow()
    wait_min = max(0.0, (now - sos.created_at).total_seconds() / 60.0)
    ref = select(SosSignal.location).where(SosSignal.id == sos.id).scalar_subquery()
    nearby = await session.scalar(select(func.count()).select_from(SosSignal).where(
        SosSignal.id != sos.id, SosSignal.is_suspected.is_(False),
        SosSignal.created_at >= now - NEARBY_WINDOW, SosSignal.created_at <= now,
        func.ST_DWithin(cast(SosSignal.location, Geography), cast(ref, Geography), settings.cluster_radius_m)))
    alert_bonus = 0
    if sos.zone_id is not None:
        has_alert = await session.scalar(select(func.count()).select_from(Alert).where(
            Alert.status == "active", Alert.zone_id == sos.zone_id))
        alert_bonus = 15 if has_alert else 0
    return float(TYPE_WEIGHT.get(sos.type, 0) + min(wait_min * 2, 30) + nearby * 5 + alert_bonus)


async def refresh_priorities(session: AsyncSession, events: EventList, sos_ids: list[int] | None = None,
                             now: datetime | None = None) -> int:
    """Recompute scores of open SOS signals (all, or the given ids). Emits sos.updated for changed ones."""
    q = select(SosSignal).where(SosSignal.status.in_(("new", "assigned")), SosSignal.is_suspected.is_(False))
    if sos_ids is not None:
        q = q.where(SosSignal.id.in_(sos_ids))
    # rows another transaction is working on are skipped (their own pass recomputes them): no deadlocks
    # between concurrent crisis-queue consumers; the 30 s job catches anything skipped
    q = q.order_by(SosSignal.id).with_for_update(skip_locked=True)
    changed = 0
    for s in (await session.scalars(q)).all():
        score = round(await compute_priority(session, s, now), 2)
        if abs(score - s.priority_score) > 1e-9:
            s.priority_score = score
            changed += 1
            events.append(Event("sos.updated", {"id": s.id, "priority_score": score, "status": s.status}))
    return changed
