"""In-memory zone lookup (the 11 district polygons are static seed data).

Replaces a `ST_Contains` round trip on every SOS / location update - one less DB query per request
on the hot path during floods. Semantics match ST_Contains (points on the boundary are outside).
"""
import json

from shapely.geometry import Point, shape
from shapely.prepared import prep
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Zone


class ZoneIndex:
    def __init__(self) -> None:
        self._zones: list[tuple[int, object, tuple[float, float, float, float]]] = []
        self.loaded = False

    async def load(self, session: AsyncSession) -> None:
        rows = (await session.execute(select(Zone.id, func.ST_AsGeoJSON(Zone.polygon)).order_by(Zone.id))).all()
        zones = []
        for zid, geojson in rows:
            poly = shape(json.loads(geojson))
            zones.append((zid, prep(poly), poly.bounds))
        self._zones = zones
        self.loaded = True

    def find(self, lat: float, lng: float) -> int | None:
        pt = Point(lng, lat)
        for zid, prepared, (minx, miny, maxx, maxy) in self._zones:
            if minx <= lng <= maxx and miny <= lat <= maxy and prepared.contains(pt):
                return zid
        return None


zone_index = ZoneIndex()
