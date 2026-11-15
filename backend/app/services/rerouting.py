"""Automatic rerouting.

Triggers:
  a) a road segment closes (or becomes heavily congested) -> citizens whose active route uses it
  b) an assembly point reaches REROUTE_OCCUPANCY_PCT       -> citizens whose active route targets it
Each affected citizen gets a fresh best route (closed roads and near-full points excluded), the old
route is deactivated, the new one stored with version+1, and a `route.rerouted` event is pushed.
"""
import logging
from collections.abc import Sequence

from geoalchemy2 import Geography
from sqlalchemy import and_, cast, exists, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.geo import latlng, line_coords
from app.models import AssemblyPoint, Citizen, RoadSegment, Route
from app.realtime.events import Event, EventList
from app.services.citizens import active_route, save_route
from app.services.nearest import find_nearest
from app.services.routing_gateway import routing_gateway
from app.services.serialize import route_out

log = logging.getLogger("app.rerouting")


def _start_of(citizen: Citizen, old: Route | None) -> tuple[float, float] | None:
    here = latlng(citizen.location)
    if here:
        return here
    if old is not None:
        lng, lat = line_coords(old.geometry)[0]
        return lat, lng
    return None


async def reroute_citizen(session: AsyncSession, citizen: Citizen, reason: str, events: EventList, *,
                          exclude_point_ids: Sequence[int] = (), force_point: AssemblyPoint | None = None
                          ) -> Route | None:
    old = await active_route(session, citizen.id)
    start = _start_of(citizen, old)
    if start is None:
        return None
    accessible = citizen.mobility_impaired  # persons with reduced mobility always get step-free routes
    if force_point is not None:
        point = force_point
    else:
        items = await find_nearest(session, start[0], start[1], zone_id=citizen.zone_id, limit=1,
                                   exclude_ids=list(exclude_point_ids), exclude_near_full=True, candidate_limit=8,
                                   accessible=accessible)
        if not items:
            log.warning("no alternative point for citizen %s", citizen.id)
            return None
        point = items[0].point
    plat, plng = latlng(point.location)
    # final route through the resilient gateway (external API with circuit breaker + local fallbacks)
    routed = await routing_gateway.route(session, start, (plat, plng), accessible=accessible, events=events)
    if routed is None and accessible and force_point is not None:
        # dispatcher-chosen point without a step-free path: still evacuate (route.accessible = false)
        log.warning("no step-free route to point %s for citizen %s", point.id, citizen.id)
        routed = await routing_gateway.route(session, start, (plat, plng), events=events)
    if routed is None:
        return None
    old_out = route_out(old) if old else None
    new = await save_route(session, citizen, point, routed.result, reason, routed.source, routed.degraded)
    new_out = route_out(new)
    events.append(Event("route.rerouted", {
        "citizen_id": str(citizen.id),
        "old_route": old_out,
        "new_route": new_out,
        "reason": reason,
        "eta_diff_min": round(new.eta_min - old.eta_min, 2) if old else None,
    }, dispatch=False, citizen_ids=[str(citizen.id)]))
    return new


async def _reroute_routes(session: AsyncSession, routes: Sequence[Route], reason: str, events: EventList,
                          exclude_point_ids: Sequence[int] = ()) -> int:
    count = 0
    for r in routes:
        citizen = await session.get(Citizen, r.citizen_id)
        if citizen is None or citizen.status == "safe":
            continue
        if await reroute_citizen(session, citizen, reason, events, exclude_point_ids=exclude_point_ids):
            count += 1
    return count


async def reroute_for_segments(session: AsyncSession, segment_ids: Sequence[int], events: EventList,
                               reason: str = "road_closed", only_mobility_impaired: bool = False) -> int:
    # local-graph routes are matched by segment id; external / cached / static routes by geometry
    near_segment = exists(select(RoadSegment.id).where(
        RoadSegment.id.in_(list(segment_ids)),
        func.ST_DWithin(cast(RoadSegment.geometry, Geography), cast(Route.geometry, Geography), 8.0)))
    q = select(Route).where(Route.is_active.is_(True), or_(
        Route.segment_ids.overlap(list(segment_ids)), and_(Route.source != "local_graph", near_segment)))
    if only_mobility_impaired:  # a new barrier only blocks persons with reduced mobility
        q = q.join(Citizen, Citizen.id == Route.citizen_id).where(Citizen.mobility_impaired.is_(True))
    routes = (await session.scalars(q)).all()
    count = await _reroute_routes(session, routes, reason, events)
    if count:
        events.append(Event("route.rerouted", {"count": count, "reason": reason, "segment_ids": list(segment_ids)}))
    return count


async def reroute_for_point(session: AsyncSession, point: AssemblyPoint, events: EventList) -> int:
    routes = (await session.scalars(select(Route).where(
        Route.is_active.is_(True), Route.target_point_id == point.id))).all()
    count = await _reroute_routes(session, routes, "point_full", events, exclude_point_ids=[point.id])
    if count:
        events.append(Event("route.rerouted", {"count": count, "reason": "point_full", "point_id": point.id}))
    return count
