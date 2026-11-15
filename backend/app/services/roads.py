from collections.abc import Sequence

from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import RoadEvent, RoadSegment
from app.realtime.events import Event, EventList
from app.services.rerouting import reroute_for_segments
from app.services.routing import graph

DEFAULT_CONGESTION_FACTOR = 3.0
_EVENT_NAME = {"closed": "closed", "open": "opened", "congested": "congested"}


def _seg_payload(segment_id: int) -> dict:
    s = graph.segments.get(segment_id)
    return {"id": segment_id, "status": s.status if s else None, "congestion_factor": s.factor if s else None,
            "barrier": s.barrier if s else None, "accessible": s.accessible if s else None}


async def set_segments_barrier(session: AsyncSession, segment_ids: Sequence[int], barrier: str | None,
                               reason: str | None, events: EventList) -> dict:
    """Add (barrier='stairs'|...) or remove (None) an obstacle for persons with reduced mobility.
    Only their routes are affected: they are rerouted with reason 'barrier'."""
    ids = list(dict.fromkeys(segment_ids))
    await session.execute(update(RoadSegment).where(RoadSegment.id.in_(ids)).values(barrier=barrier))
    session.add_all([RoadEvent(segment_id=i, event="barrier_added" if barrier else "barrier_removed",
                               reason=f"{barrier or '-'}: {reason or ''}") for i in ids])
    for i in ids:
        graph.set_barrier(i, barrier)
    events.append(Event("road.updated", {"segments": [_seg_payload(i) for i in ids], "reason": reason}))
    rerouted = 0
    if barrier is not None:
        rerouted = await reroute_for_segments(session, ids, events, "barrier", only_mobility_impaired=True)
    return {"segment_ids": ids, "barrier": barrier, "rerouted": rerouted}


async def set_segments_status(session: AsyncSession, segment_ids: Sequence[int], status: str, reason: str | None,
                              events: EventList, congestion_factor: float | None = None) -> dict:
    """Persist the status, update the in-memory graph immediately, emit `road.updated` and reroute
    citizens if the road became unusable (closed or heavily congested)."""
    ids = list(dict.fromkeys(segment_ids))
    factor = (congestion_factor or DEFAULT_CONGESTION_FACTOR) if status == "congested" else 1.0
    await session.execute(update(RoadSegment).where(RoadSegment.id.in_(ids))
                          .values(status=status, congestion_factor=factor))
    session.add_all([RoadEvent(segment_id=i, event=_EVENT_NAME[status], reason=reason) for i in ids])
    for i in ids:
        graph.set_segment(i, status, factor)
    events.append(Event("road.updated", {"segments": [_seg_payload(i) for i in ids], "reason": reason}))

    rerouted = 0
    if status == "closed" or (status == "congested" and factor >= settings.congestion_reroute_factor):
        rerouted = await reroute_for_segments(session, ids, events, "road_closed")
    return {"segment_ids": ids, "status": status, "congestion_factor": factor, "rerouted": rerouted}
