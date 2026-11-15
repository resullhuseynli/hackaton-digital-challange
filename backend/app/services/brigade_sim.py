"""Brigade dispatching and movement simulation.

dispatch_brigade(): computes a driving route and sets the brigade en_route.
tick(): moves en_route / returning brigades along their route geometry at BRIGADE_SPEED_KMH.
        en_route  -> on_site on arrival
        returning -> idle    on arrival (back at home base)
"""
import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.errors import AppError
from app.geo import haversine_m, latlng, line_coords, line_ewkt, line_length_m, point_ewkt
from app.models import Brigade, SosSignal
from app.realtime.events import Event, EventList
from app.services.routing import DRIVE, graph
from app.services.serialize import brigade_out

log = logging.getLogger("app.brigades")


def _set_route(b: Brigade, coords: list[tuple[float, float]]) -> None:
    b.route_geometry = line_ewkt(coords)
    b.route_length_m = line_length_m(coords)
    b.route_progress_m = 0.0


async def dispatch_brigade(session: AsyncSession, brigade: Brigade, sos: SosSignal, events: EventList) -> float:
    """Route the brigade to the SOS location. Returns the route distance (m)."""
    blat, blng = latlng(brigade.location)
    slat, slng = latlng(sos.location)
    r = graph.route(blat, blng, slat, slng, DRIVE)
    if r is None:
        raise AppError(409, "BRIGADE_UNREACHABLE")
    brigade.status = "en_route"
    brigade.target_sos_id = sos.id
    brigade.target_location = point_ewkt(slat, slng)
    _set_route(brigade, r.coords)
    await session.flush()
    events.append(Event("brigade.updated", brigade_out(brigade)))
    return r.distance_m


async def send_home(session: AsyncSession, brigade: Brigade, events: EventList) -> None:
    """After the SOS is resolved the brigade drives back to its base ("returning")."""
    blat, blng = latlng(brigade.location)
    hlat, hlng = latlng(brigade.home_location)
    brigade.target_sos_id = None
    brigade.target_location = None
    r = graph.route(blat, blng, hlat, hlng, DRIVE) if haversine_m(blat, blng, hlat, hlng) > 1 else None
    if r is None:
        brigade.status = "idle"
        brigade.location = point_ewkt(hlat, hlng)
        brigade.route_geometry = None
        brigade.route_length_m = brigade.route_progress_m = 0.0
    else:
        brigade.status = "returning"
        _set_route(brigade, r.coords)
    await session.flush()
    events.append(Event("brigade.updated", brigade_out(brigade)))


def interpolate(coords: list[tuple[float, float]], distance_m: float) -> tuple[float, float]:
    """Point (lat, lng) located `distance_m` along the polyline."""
    walked = 0.0
    for (x1, y1), (x2, y2) in zip(coords, coords[1:]):
        seg = haversine_m(y1, x1, y2, x2)
        if walked + seg >= distance_m and seg > 0:
            t = (distance_m - walked) / seg
            return y1 + (y2 - y1) * t, x1 + (x2 - x1) * t
        walked += seg
    return coords[-1][1], coords[-1][0]


async def tick(session: AsyncSession, events: EventList, dt_sec: float) -> int:
    step = settings.brigade_speed_kmh / 3.6 * dt_sec
    moving = (await session.scalars(select(Brigade).where(Brigade.status.in_(("en_route", "returning"))))).all()
    for b in moving:
        coords = line_coords(b.route_geometry)
        if len(coords) < 2:
            b.route_progress_m = b.route_length_m
        else:
            b.route_progress_m = min(b.route_length_m, b.route_progress_m + step)
        lat, lng = interpolate(coords, b.route_progress_m) if coords else latlng(b.location)
        b.location = point_ewkt(lat, lng)
        if b.route_progress_m >= b.route_length_m - 1e-6:
            if b.status == "en_route":
                b.status = "on_site"
            else:
                b.status = "idle"
                b.route_geometry = None
                b.route_length_m = b.route_progress_m = 0.0
        await session.flush()
        await session.refresh(b)
        events.append(Event("brigade.updated", brigade_out(b)))
    return len(moving)
