from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.geo import line_ewkt, point_ewkt, sql_point
from app.models import AssemblyPoint, Citizen, Route, Zone
from app.services.routing import RouteResult
from app.services.zones import zone_index


async def zone_for(session: AsyncSession, lat: float, lng: float) -> int | None:
    """In-memory polygon lookup (loaded once); PostGIS ST_Contains only as a fallback."""
    if not zone_index.loaded:
        try:
            await zone_index.load(session)
        except Exception:  # noqa: BLE001
            return await session.scalar(
                select(Zone.id).where(func.ST_Contains(Zone.polygon, sql_point(lat, lng))).limit(1))
    return zone_index.find(lat, lng)


async def set_location(session: AsyncSession, citizen: Citizen, lat: float, lng: float) -> None:
    citizen.location = point_ewkt(lat, lng)
    citizen.zone_id = await zone_for(session, lat, lng)


async def active_route(session: AsyncSession, citizen_id) -> Route | None:
    return await session.scalar(select(Route).where(Route.citizen_id == citizen_id, Route.is_active.is_(True))
                                .order_by(Route.version.desc()).limit(1))


async def save_route(session: AsyncSession, citizen: Citizen, point: AssemblyPoint, result: RouteResult,
                     reason: str, source: str = "local_graph", degraded: bool = False) -> Route:
    """Deactivate the citizen's current route(s) and store `result` as the new active one."""
    last_version = await session.scalar(select(func.max(Route.version)).where(Route.citizen_id == citizen.id))
    await session.execute(update(Route).where(Route.citizen_id == citizen.id, Route.is_active.is_(True))
                          .values(is_active=False))
    route = Route(citizen_id=citizen.id, target_point_id=point.id, node_path=result.node_path,
                  segment_ids=result.segment_ids, geometry=line_ewkt(result.coords), distance_m=result.distance_m,
                  eta_min=result.eta_min, version=(last_version or 0) + 1, reason=reason, is_active=True,
                  accessible=result.accessible, source=source, degraded=degraded)
    session.add(route)
    citizen.target_point_id = point.id
    await session.flush()
    await session.refresh(route)
    return route
