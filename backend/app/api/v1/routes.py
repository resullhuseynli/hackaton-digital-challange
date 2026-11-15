from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.deps import current_citizen
from app.errors import AppError, no_route, point_not_found
from app.geo import latlng
from app.models import AssemblyPoint, Citizen
from app.schemas.citizen import RouteRequest
from app.schemas.common import ErrorResponse
from app.schemas.geo import RouteOut
from app.services.citizens import active_route, save_route, set_location
from app.i18n import language_params
from app.realtime.events import EventList, bus
from app.services.routing_gateway import routing_gateway
from app.services.serialize import route_out

router = APIRouter(prefix="/citizens/me", tags=["routes"])


@router.post("/route", response_model=RouteOut, summary="Build a walking route; it becomes the active route",
             description="For citizens registered as **Hərəkət məhdudiyyətli şəxs** the route is step-free "
                         "(no stairs / steep slopes / underpasses, wheelchair speed) and the point must be "
                         "`wheelchair_accessible` (409 `POINT_NOT_ACCESSIBLE`, 422 `NO_ACCESSIBLE_ROUTE`).",
             responses={404: {"model": ErrorResponse}, 409: {"model": ErrorResponse}, 422: {"model": ErrorResponse}})
async def create_route(body: RouteRequest, citizen: Citizen = Depends(current_citizen),
                       session: AsyncSession = Depends(get_session), lang: str = Depends(language_params)):
    point = await session.get(AssemblyPoint, body.point_id)
    if point is None:
        raise point_not_found()
    if point.status != "active":
        raise AppError(409, "POINT_NOT_ACTIVE")
    accessible = citizen.mobility_impaired  # step-free route for persons with reduced mobility
    if accessible and not point.wheelchair_accessible:
        raise AppError(409, "POINT_NOT_ACCESSIBLE")
    plat, plng = latlng(point.location)
    events: EventList = []
    # external API -> circuit breaker -> local graph / cached route / static matrix (never raises)
    routed = await routing_gateway.route(session, (body.lat, body.lng), (plat, plng), accessible=accessible,
                                         events=events)
    if routed is None:
        raise AppError(422, "NO_ACCESSIBLE_ROUTE") if accessible else no_route()
    await set_location(session, citizen, body.lat, body.lng)
    route = await save_route(session, citizen, point, routed.result, "initial", routed.source, routed.degraded)
    await session.commit()
    await bus.publish_many(events)
    return route_out(route, lang)


@router.get("/route", response_model=RouteOut, responses={404: {"model": ErrorResponse}})
async def get_route(citizen: Citizen = Depends(current_citizen), session: AsyncSession = Depends(get_session),
                    lang: str = Depends(language_params)):
    route = await active_route(session, citizen.id)
    if route is None:
        raise AppError(404, "ROUTE_NOT_FOUND")
    return route_out(route, lang)
