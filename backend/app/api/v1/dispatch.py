import json

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.deps import current_dispatcher
from app.errors import AppError
from app.models import Dispatcher, RoadSegment
from app.schemas.dispatch import OverviewOut, TimeseriesOut
from app.services.overview import overview, timeseries

router = APIRouter(tags=["dispatch"])


@router.get("/dispatch/overview", response_model=OverviewOut)
async def get_overview(_: Dispatcher = Depends(current_dispatcher), session: AsyncSession = Depends(get_session)):
    return await overview(session)


@router.get("/dispatch/timeseries", response_model=TimeseriesOut, summary="SOS count per minute, per type")
async def get_timeseries(minutes: int = Query(30, ge=1, le=1440), _: Dispatcher = Depends(current_dispatcher),
                         session: AsyncSession = Depends(get_session)):
    return await timeseries(session, minutes)


@router.get("/traffic/segments", summary="Road segments as a GeoJSON FeatureCollection",
            description="`bbox=minLng,minLat,maxLng,maxLat`. Optional `status` filter (e.g. `closed`) and "
                        "`has_barrier=true` (segments with stairs/steep/underpass...).")
async def traffic_segments(bbox: str | None = Query(None, examples=["49.78,40.36,49.86,40.42"]),
                           status: str | None = None, has_barrier: bool | None = None,
                           _: Dispatcher = Depends(current_dispatcher),
                           session: AsyncSession = Depends(get_session)):
    q = select(RoadSegment.id, RoadSegment.from_node, RoadSegment.to_node, RoadSegment.status,
               RoadSegment.congestion_factor, RoadSegment.speed_kmh, RoadSegment.length_m,
               func.ST_AsGeoJSON(RoadSegment.geometry), RoadSegment.barrier)
    if bbox:
        try:
            min_lng, min_lat, max_lng, max_lat = (float(v) for v in bbox.split(","))
        except ValueError:
            raise AppError(422, "INVALID_BBOX") from None
        q = q.where(func.ST_Intersects(RoadSegment.geometry,
                                       func.ST_MakeEnvelope(min_lng, min_lat, max_lng, max_lat, 4326)))
    if status:
        q = q.where(RoadSegment.status == status)
    if has_barrier is not None:
        q = q.where(RoadSegment.barrier.isnot(None) if has_barrier else RoadSegment.barrier.is_(None))
    rows = (await session.execute(q.order_by(RoadSegment.id))).all()
    return {"type": "FeatureCollection", "features": [
        {"type": "Feature", "id": r[0], "geometry": json.loads(r[7]),
         "properties": {"id": r[0], "from_node": r[1], "to_node": r[2], "status": r[3], "congestion_factor": r[4],
                        "speed_kmh": r[5], "length_m": round(r[6], 1), "barrier": r[8],
                        "accessible": r[8] is None}} for r in rows]}
