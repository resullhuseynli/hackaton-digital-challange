from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import AssemblyPoint, Citizen
from app.realtime.events import Event, EventList
from app.services.crisis_engine import evaluate_point
from app.services.rerouting import reroute_for_point
from app.services.serialize import assembly_point_out


async def on_occupancy_change(session: AsyncSession, point: AssemblyPoint, events: EventList) -> dict:
    """Called after a point's current_count changed (inside the caller's transaction).
    Emits point.occupancy, reroutes citizens heading to a near-full point (>= REROUTE_OCCUPANCY_PCT)
    and runs the crisis engine's POINT_OVERLOAD condition (>= RED_ALERT_OCCUPANCY_PCT)."""
    targeting = (await session.scalars(select(Citizen.id).where(Citizen.target_point_id == point.id))).all()
    events.append(Event("point.occupancy", assembly_point_out(point), citizen_ids=[str(c) for c in targeting]))
    rerouted = 0
    if point.occupancy_raw >= settings.reroute_occupancy_pct:
        rerouted = await reroute_for_point(session, point, events)
    alert = await evaluate_point(session, point, events)
    return {"rerouted": rerouted, "alert_id": alert.id if alert else None}
