"""Restore the seeded baseline (used by POST /sim/reset and by the test-suite)."""
from sqlalchemy import text, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AssemblyPoint, Brigade, RoadSegment
from app.realtime.events import Event, EventList, bus
from app.seed.data import BRIGADES
from app.seed.seed import assembly_point_rows
from app.geo import point_ewkt
from app.services.routing import graph

DYNAMIC_TABLES = ("audit_log", "alerts", "routes", "sos_signals", "citizens", "road_events")
REDIS_PATTERNS = ("crisis:*", "sos:cooldown:*", "lock:*", "routecache:*", "rl:*", "spam:*", "idem:*")


async def reset_state(session: AsyncSession, events: EventList) -> None:
    await session.execute(text(f"TRUNCATE {', '.join(DYNAMIC_TABLES)} RESTART IDENTITY CASCADE"))
    await session.execute(update(AssemblyPoint), [
        {"id": r["id"], "current_count": r["current_count"], "status": r["status"], "capacity": r["capacity"],
         "wheelchair_accessible": r["wheelchair_accessible"]} for r in assembly_point_rows()])
    await session.execute(update(Brigade), [
        {"id": i, "location": point_ewkt(lat, lng), "status": "idle", "target_sos_id": None,
         "target_location": None, "route_geometry": None, "route_length_m": 0.0, "route_progress_m": 0.0}
        for i, (_n, _t, lat, lng) in enumerate(BRIGADES, start=1)])
    await session.execute(update(RoadSegment).where(
        (RoadSegment.status != "open") | (RoadSegment.congestion_factor != 1.0)
        | RoadSegment.barrier.is_distinct_from(RoadSegment.base_barrier)
    ).values(status="open", congestion_factor=1.0, barrier=RoadSegment.base_barrier))
    graph.reset()
    if bus.redis is not None:
        for pattern in REDIS_PATTERNS:
            keys = [k async for k in bus.redis.scan_iter(pattern)]
            if keys:
                await bus.redis.delete(*keys)
    events.append(Event("graph.reset", {}, dispatch=False, internal=True))
    events.append(Event("sim.reset", {}))
