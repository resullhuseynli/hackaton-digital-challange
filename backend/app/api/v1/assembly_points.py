from typing import Literal

from fastapi import APIRouter, Depends, Header, Query
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.deps import current_citizen
from app.errors import AppError, point_not_found
from app.models import AssemblyPoint, Citizen, Route
from app.realtime.events import EventList, bus
from app.schemas.common import ErrorResponse
from app.schemas.geo import AssemblyPointOut, NearestPointOut
from app.services.nearest import find_nearest
from app.services.occupancy import on_occupancy_change
from app.services.serialize import assembly_point_out

router = APIRouter(prefix="/assembly-points", tags=["assembly-points"])


@router.get("", response_model=list[AssemblyPointOut])
async def list_points(zone_id: int | None = None,
                      status: Literal["active", "reserve", "closed"] | None = None,
                      session: AsyncSession = Depends(get_session)):
    q = select(AssemblyPoint).order_by(AssemblyPoint.id)
    if zone_id is not None:
        q = q.where(AssemblyPoint.zone_id == zone_id)
    if status is not None:
        q = q.where(AssemblyPoint.status == status)
    return [assembly_point_out(p) for p in (await session.scalars(q)).all()]


@router.get("/nearest", response_model=list[NearestPointOut],
            summary="Nearest active points ranked by walking ETA and occupancy",
            description="`accessible=true` returns only wheelchair-accessible points with step-free routes. "
                        "If `accessible` is omitted and `X-Device-Id` belongs to a citizen registered as "
                        "Hərəkət məhdudiyyətli şəxs, step-free mode is applied automatically.")
async def nearest(lat: float = Query(..., ge=-90, le=90, examples=[40.3893]),
                  lng: float = Query(..., ge=-180, le=180, examples=[49.8020]),
                  zone_id: int | None = None, limit: int = Query(5, ge=1, le=20),
                  accessible: bool | None = Query(None, description="Step-free routes to accessible points only"),
                  x_device_id: str | None = Header(None, alias="X-Device-Id"),
                  session: AsyncSession = Depends(get_session)):
    if accessible is None:
        accessible = bool(x_device_id) and bool(await session.scalar(
            select(Citizen.mobility_impaired).where(Citizen.device_id == x_device_id)))
    items = await find_nearest(session, lat, lng, zone_id=zone_id, limit=limit, accessible=accessible)
    return [{"point": assembly_point_out(i.point), "distance_m": i.distance_m, "eta_min": i.eta_min,
             "score": i.score, "near_full": i.near_full, "source": i.source} for i in items]


@router.post("/{point_id}/check-in", response_model=AssemblyPointOut,
             responses={404: {"model": ErrorResponse}, 409: {"model": ErrorResponse}})
async def check_in(point_id: int, citizen: Citizen = Depends(current_citizen),
                   session: AsyncSession = Depends(get_session)):
    point = await session.get(AssemblyPoint, point_id)
    if point is None:
        raise point_not_found()
    if point.status != "active":
        raise AppError(409, "POINT_NOT_ACTIVE")
    # atomic increment guarded by capacity (safe with concurrent check-ins)
    new_count = await session.scalar(
        update(AssemblyPoint)
        .where(AssemblyPoint.id == point_id, AssemblyPoint.current_count < AssemblyPoint.capacity)
        .values(current_count=AssemblyPoint.current_count + 1)
        .returning(AssemblyPoint.current_count))
    if new_count is None:
        raise AppError(409, "POINT_FULL")
    await session.refresh(point)
    citizen.status = "safe"
    citizen.target_point_id = point.id
    await session.execute(update(Route).where(Route.citizen_id == citizen.id, Route.is_active.is_(True))
                          .values(is_active=False))
    events: EventList = []
    await on_occupancy_change(session, point, events)
    await session.commit()
    await bus.publish_many(events)
    return assembly_point_out(point)
