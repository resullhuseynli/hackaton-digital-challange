from datetime import timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Alert, AssemblyPoint, Brigade, Citizen, SosSignal, utcnow
from app.realtime.events import Event, EventList
from app.services.routing_gateway import routing_gateway

SOS_TYPES = ("fire", "collapse", "flood", "medical")


async def overview(session: AsyncSession) -> dict:
    async def count(model, *where) -> int:
        return await session.scalar(select(func.count()).select_from(model).where(*where)) or 0

    avg = await session.scalar(select(func.avg(AssemblyPoint.current_count * 100.0 / AssemblyPoint.capacity))
                               .where(AssemblyPoint.status == "active"))
    return {
        "active_sos": await count(SosSignal, SosSignal.status.in_(("new", "assigned")),
                                  SosSignal.is_suspected.is_(False)),
        "active_sos_mobility_impaired": await count(SosSignal, SosSignal.status.in_(("new", "assigned")),
                                                    SosSignal.is_suspected.is_(False),
                                                    SosSignal.citizen_mobility_impaired.is_(True)),
        "suspected_sos": await count(SosSignal, SosSignal.status == "new", SosSignal.is_suspected.is_(True)),
        "resolved_sos": await count(SosSignal, SosSignal.status == "resolved"),
        "citizens_safe": await count(Citizen, Citizen.status == "safe"),
        "citizens_in_danger": await count(Citizen, Citizen.status == "in_danger"),
        "brigades_idle": await count(Brigade, Brigade.status == "idle"),
        "brigades_busy": await count(Brigade, Brigade.status != "idle"),
        "avg_occupancy_pct": round(float(avg or 0.0), 1),
        "active_alerts": await count(Alert, Alert.status == "active"),
        "routing_status": routing_gateway.status()["status"],
    }


async def add_overview_event(session: AsyncSession, events: EventList) -> None:
    events.append(Event("overview.updated", await overview(session)))


async def timeseries(session: AsyncSession, minutes: int) -> dict:
    now = utcnow().replace(second=0, microsecond=0)
    start = now - timedelta(minutes=minutes - 1)
    bucket = func.date_trunc("minute", SosSignal.created_at)
    rows = (await session.execute(select(bucket, SosSignal.type, func.count())
                                  .where(SosSignal.created_at >= start, SosSignal.is_suspected.is_(False))
                                  .group_by(bucket, SosSignal.type))).all()
    counts: dict = {}
    for minute, type_, n in rows:
        counts.setdefault(minute, {})[type_] = n
    series = []
    for i in range(minutes):
        minute = start + timedelta(minutes=i)
        by_type = {t: counts.get(minute, {}).get(t, 0) for t in SOS_TYPES}
        series.append({"minute": minute, "total": sum(by_type.values()), "by_type": by_type})
    return {"minutes": minutes, "series": series}
