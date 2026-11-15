"""Simulation controls for demos and drills (dispatcher JWT required)."""
import math
import random
import uuid
from datetime import timedelta

from typing import Literal

import httpx
from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, Field

from app.config import settings
from app.services.routing_gateway import routing_gateway
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.deps import require_admin
from app.errors import AppError, point_not_found
from app.geo import offset_point, sql_point
from app.models import AssemblyPoint, AuditLog, Citizen, Dispatcher, RoadSegment, utcnow
from app.realtime.events import EventList, bus
from app.schemas.common import ErrorResponse, OkResponse
from app.schemas.dispatch import (BarrierIn, BarrierOut, OccupancyIn, OccupancyOut, RoadClosureIn, RoadClosureOut,
                                  SosBurstIn, SosBurstOut)
from app.services.occupancy import on_occupancy_change
from app.services.overview import add_overview_event
from app.services.roads import set_segments_barrier, set_segments_status
from app.services.routing import graph
from app.services.serialize import assembly_point_out
from app.services.sos import create_sos
from app.services.state import reset_state

router = APIRouter(prefix="/sim", tags=["simulation"],
                   responses={403: {"model": ErrorResponse, "description": "admin role required"}})


async def _target_segments(session: AsyncSession, segment_id: int | None, lat: float | None, lng: float | None,
                           both_directions: bool) -> list[int]:
    if segment_id is not None:
        seg_id = await session.scalar(select(RoadSegment.id).where(RoadSegment.id == segment_id))
    else:  # KNN on the GIST index
        seg_id = await session.scalar(select(RoadSegment.id).order_by(
            RoadSegment.geometry.op("<->")(sql_point(lat, lng))).limit(1))
    if seg_id is None:
        raise AppError(404, "SEGMENT_NOT_FOUND")
    ids = [seg_id]
    twin = graph.twin(seg_id)
    if both_directions and twin is not None:
        ids.append(twin)
    return ids


@router.post("/road-closure", response_model=RoadClosureOut, responses={404: {"model": ErrorResponse}},
             summary="Close / open / congest a road (segment_id, or the segment nearest to lat,lng)")
async def road_closure(body: RoadClosureIn, dispatcher: Dispatcher = Depends(require_admin),
                       session: AsyncSession = Depends(get_session)):
    ids = await _target_segments(session, body.segment_id, body.lat, body.lng, body.both_directions)
    events: EventList = []
    result = await set_segments_status(session, ids, body.status, body.reason, events, body.congestion_factor)
    session.add(AuditLog(actor=dispatcher.username, action="sim.road", payload={**result, "reason": body.reason}))
    await session.commit()
    await bus.publish_many(events)
    return result


@router.post("/barrier", response_model=BarrierOut, responses={404: {"model": ErrorResponse}},
             summary="Add / remove an obstacle for persons with reduced mobility (stairs, steep slope, ...)",
             description="Only step-free routing is affected: citizens registered as Hərəkət məhdudiyyətli şəxs "
                         "whose active route uses the segment are rerouted (reason `barrier`). "
                         "`barrier: null` removes the obstacle.")
async def set_barrier(body: BarrierIn, dispatcher: Dispatcher = Depends(require_admin),
                      session: AsyncSession = Depends(get_session)):
    ids = await _target_segments(session, body.segment_id, body.lat, body.lng, body.both_directions)
    events: EventList = []
    result = await set_segments_barrier(session, ids, body.barrier, body.reason, events)
    session.add(AuditLog(actor=dispatcher.username, action="sim.barrier", payload={**result, "reason": body.reason}))
    await session.commit()
    await bus.publish_many(events)
    return result


class RoutingFaultIn(BaseModel):
    model_config = ConfigDict(json_schema_extra={"examples": [{"mode": "error_503"}, {"mode": "timeout", "delay_sec": 8},
                                                              {"mode": "ok"}]})
    mode: Literal["ok", "error_503", "timeout"]
    delay_sec: float = Field(8.0, ge=0, le=60)


@router.post("/routing-fault", responses={502: {"model": ErrorResponse}},
             summary="Inject a failure into the (mock) external map & routing API",
             description="`error_503`: provider answers HTTP 503; `timeout`: provider answers after `delay_sec` "
                         "(> EXTERNAL_ROUTING_TIMEOUT_SEC = 5 s); `ok`: healthy. Watch `GET /routing/status`.")
async def routing_fault(body: RoutingFaultIn, dispatcher: Dispatcher = Depends(require_admin),
                        session: AsyncSession = Depends(get_session)):
    url = settings.external_routing_fault_url or (
        f"{settings.external_routing_url.rstrip('/')}/__fault" if settings.external_routing_url else "")
    if not url:
        raise AppError(502, "ROUTING_FAULT_UNAVAILABLE")
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            r = await client.post(url, json=body.model_dump())
            r.raise_for_status()
            provider = r.json()
    except httpx.HTTPError:
        raise AppError(502, "ROUTING_FAULT_UNAVAILABLE") from None
    session.add(AuditLog(actor=dispatcher.username, action="sim.routing_fault", payload=body.model_dump()))
    await session.commit()
    return {"provider": provider, "routing": routing_gateway.status()}


@router.post("/occupancy", response_model=OccupancyOut, responses={404: {"model": ErrorResponse}})
async def set_occupancy(body: OccupancyIn, dispatcher: Dispatcher = Depends(require_admin),
                        session: AsyncSession = Depends(get_session)):
    point = await session.scalar(select(AssemblyPoint).where(AssemblyPoint.id == body.point_id).with_for_update())
    if point is None:
        raise point_not_found()
    new_count = body.current_count if body.current_count is not None else point.current_count + body.delta
    point.current_count = max(0, new_count)
    await session.flush()
    events: EventList = []
    result = await on_occupancy_change(session, point, events)
    session.add(AuditLog(actor=dispatcher.username, action="sim.occupancy",
                         payload={"point_id": point.id, "current_count": point.current_count, **result}))
    await add_overview_event(session, events)
    await session.commit()
    await bus.publish_many(events)
    return {"point": assembly_point_out(point), **result}


@router.post("/sos-burst", response_model=SosBurstOut,
             summary="Create `count` fake distinct citizens sending SOS within radius_m over the last window_sec")
async def sos_burst(body: SosBurstIn, dispatcher: Dispatcher = Depends(require_admin),
                    session: AsyncSession = Depends(get_session)):
    rng = random.Random(body.seed)
    now = utcnow()
    events: EventList = []
    citizen_ids, sos_ids = [], []
    for i in range(body.count):
        r = body.radius_m * math.sqrt(rng.random())
        theta = rng.random() * 2 * math.pi
        lat, lng = offset_point(body.lat, body.lng, r * math.cos(theta), r * math.sin(theta))
        citizen = Citizen(device_id=str(uuid.uuid4()), status="unknown", is_simulated=True)
        session.add(citizen)
        await session.flush()
        frac = (body.count - 1 - i) / max(body.count - 1, 1)  # chronological; the last one is "now"
        sos = await create_sos(session, citizen, body.type, lat, lng, "Simulyasiya", events,
                               created_at=now - timedelta(seconds=body.window_sec * frac), now=now, cooldown=False)
        citizen_ids.append(str(citizen.id))
        sos_ids.append(sos.id)
    alert_ids = sorted({e.data["id"] for e in events if e.type in ("alert.raised", "alert.updated")})
    session.add(AuditLog(actor=dispatcher.username, action="sim.sos_burst",
                         payload={**body.model_dump(), "sos_ids": sos_ids, "alert_ids": alert_ids}))
    await add_overview_event(session, events)
    await session.commit()
    await bus.publish_many(events)
    return {"citizen_ids": citizen_ids, "sos_ids": sos_ids, "alert_ids": alert_ids}


@router.post("/reset", response_model=OkResponse, summary="Restore the seeded baseline state")
async def reset(dispatcher: Dispatcher = Depends(require_admin), session: AsyncSession = Depends(get_session)):
    events: EventList = []
    await reset_state(session, events)
    session.add(AuditLog(actor=dispatcher.username, action="sim.reset", payload={}))
    await add_overview_event(session, events)
    await session.commit()
    await bus.publish_many(events)
    return {"ok": True}
