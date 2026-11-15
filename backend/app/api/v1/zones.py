import json

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.models import Zone
from app.schemas.geo import ZoneOut

router = APIRouter(tags=["zones"])


@router.get("/zones", response_model=list[ZoneOut])
async def list_zones(session: AsyncSession = Depends(get_session)):
    rows = (await session.execute(
        select(Zone.id, Zone.name, Zone.population, func.ST_AsGeoJSON(Zone.polygon)).order_by(Zone.id))).all()
    return [{"id": r[0], "name": r[1], "population": r[2], "polygon": json.loads(r[3])} for r in rows]
