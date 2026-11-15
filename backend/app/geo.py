"""Small geometry helpers shared by services (coordinates are always (lat, lng) in function
signatures and (lng, lat) inside WKT/GeoJSON, as the formats require)."""
import math
from typing import Any

from geoalchemy2.shape import to_shape
from shapely import wkt as shapely_wkt
from sqlalchemy import func

EARTH_R = 6371008.8


def haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_R * math.asin(min(1.0, math.sqrt(a)))


def offset_point(lat: float, lng: float, north_m: float, east_m: float) -> tuple[float, float]:
    dlat = north_m / EARTH_R
    dlng = east_m / (EARTH_R * math.cos(math.radians(lat)))
    return lat + math.degrees(dlat), lng + math.degrees(dlng)


def point_ewkt(lat: float, lng: float) -> str:
    return f"SRID=4326;POINT({lng} {lat})"


def line_ewkt(coords: list[tuple[float, float]]) -> str:
    """coords are (lng, lat). A LINESTRING needs >= 2 points; duplicate a lone point."""
    if len(coords) == 1:
        coords = [coords[0], coords[0]]
    return "SRID=4326;LINESTRING(" + ", ".join(f"{x} {y}" for x, y in coords) + ")"


def sql_point(lat: float, lng: float):
    return func.ST_SetSRID(func.ST_MakePoint(lng, lat), 4326)


def _shape(geom: Any):
    """Accepts WKB/WKT elements loaded from the DB and EWKT strings assigned in this session
    (an ORM attribute keeps the raw string until the row is reloaded)."""
    if isinstance(geom, str):
        return shapely_wkt.loads(geom.split(";", 1)[1] if geom.upper().startswith("SRID=") else geom)
    return to_shape(geom)


def latlng(geom: Any) -> tuple[float, float] | None:
    if geom is None:
        return None
    p = _shape(geom)
    return p.y, p.x


def line_coords(geom: Any) -> list[tuple[float, float]]:
    if geom is None:
        return []
    return [(x, y) for x, y, *_ in _shape(geom).coords]


def geojson_line(coords: list[tuple[float, float]]) -> dict:
    return {"type": "LineString", "coordinates": [[x, y] for x, y in coords]}


def line_length_m(coords: list[tuple[float, float]]) -> float:
    return sum(haversine_m(a[1], a[0], b[1], b[0]) for a, b in zip(coords, coords[1:]))
