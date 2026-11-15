"""Nearest assembly points: PostGIS candidate search + real A* walking ETA + occupancy-aware score."""
import logging
from dataclasses import dataclass

from geoalchemy2 import Geography
from sqlalchemy import case, cast, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.geo import latlng, sql_point
from app.models import AssemblyPoint
from app.services.routing import WALK, RouteResult, graph

log = logging.getLogger("app.nearest")


@dataclass
class NearestItem:
    point: AssemblyPoint
    route: RouteResult
    score: float
    near_full: bool
    source: str = "local_graph"

    @property
    def distance_m(self) -> float:
        return self.route.distance_m

    @property
    def eta_min(self) -> float:
        return self.route.eta_min


def occupancy_penalty(pct: float) -> float:
    """0 below 70 %, linear up to 1.0 at 100 %."""
    if pct < 70:
        return 0.0
    return min(1.0, (pct - 70.0) / 30.0)


def is_near_full(p: AssemblyPoint) -> bool:
    return p.occupancy_raw >= settings.reroute_occupancy_pct or p.current_count >= p.capacity


async def find_nearest(session: AsyncSession, lat: float, lng: float, *, zone_id: int | None = None,
                       limit: int = 5, exclude_ids: tuple[int, ...] | list[int] = (),
                       exclude_near_full: bool = False, candidate_limit: int = 20,
                       accessible: bool = False) -> list[NearestItem]:
    """accessible=True (persons with reduced mobility): only wheelchair-accessible points, step-free routes."""
    here = cast(sql_point(lat, lng), Geography)
    loc = cast(AssemblyPoint.location, Geography)
    within = func.ST_DWithin(loc, here, settings.nearest_search_radius_m)
    cond = within if zone_id is None else or_(within, AssemblyPoint.zone_id == zone_id)
    q = select(AssemblyPoint).where(AssemblyPoint.status == "active", cond)
    if accessible:
        q = q.where(AssemblyPoint.wheelchair_accessible.is_(True))
    if exclude_ids:
        q = q.where(AssemblyPoint.id.not_in(list(exclude_ids)))
    order = [func.ST_Distance(loc, here)]
    if zone_id is not None:  # same-zone points are considered first, neighbours still included
        order.insert(0, case((AssemblyPoint.zone_id == zone_id, 0), else_=1))
    candidates = (await session.scalars(q.order_by(*order).limit(candidate_limit))).all()

    items: list[NearestItem] = []
    for p in candidates:
        near_full = is_near_full(p)
        if near_full and exclude_near_full:
            continue
        plat, plng = latlng(p.location)
        source = "local_graph"
        try:
            if not graph.loaded:
                raise RuntimeError("road graph not loaded")
            r = graph.route(lat, lng, plat, plng, WALK, accessible=accessible)
        except Exception:  # noqa: BLE001 - backup: static coordinate matrix estimate
            log.exception("nearest: local graph failed, using static matrix")
            from app.services.routing_gateway import routing_gateway
            r, source = routing_gateway.matrix.estimate((lat, lng), (plat, plng), accessible), "static_matrix"
        if r is None:
            continue
        score = round(r.eta_min * (1 + occupancy_penalty(p.occupancy_raw)), 2)
        items.append(NearestItem(p, r, score, near_full, source))
    items.sort(key=lambda i: (i.near_full, i.score, 0 if i.point.zone_id == zone_id else 1))
    return items[:limit]
