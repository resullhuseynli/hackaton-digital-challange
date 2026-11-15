from datetime import datetime
from typing import Literal

from pydantic import BaseModel


class ZoneOut(BaseModel):
    id: int
    name: str
    population: int
    polygon: dict  # GeoJSON Polygon


class AssemblyPointOut(BaseModel):
    id: int
    name: str
    type: Literal["shelter", "park", "stadium"]
    lat: float
    lng: float
    zone_id: int | None
    capacity: int
    current_count: int
    occupancy_pct: float
    status: Literal["active", "reserve", "closed"]
    wheelchair_accessible: bool  # step-free entrance


class NearestPointOut(BaseModel):
    point: AssemblyPointOut
    distance_m: float
    eta_min: float
    score: float
    near_full: bool
    source: Literal["local_graph", "static_matrix"] = "local_graph"


class Notice(BaseModel):
    code: str  # e.g. ROUTING_FALLBACK
    text: str  # localized


class RoutingBreaker(BaseModel):
    state: Literal["closed", "open", "half_open"]
    failures: int
    last_error: str | None
    retry_in_sec: float | None


class RoutingStatusOut(BaseModel):
    status: Literal["online", "fallback"]
    external_configured: bool
    breaker: RoutingBreaker
    fallback_chain: list[str]
    notice: Notice | None


class RouteOut(BaseModel):
    id: int
    target_point_id: int
    geometry: dict  # GeoJSON LineString
    distance_m: float
    eta_min: float
    version: int
    reason: Literal["initial", "road_closed", "point_full", "alert_new_point", "barrier"]
    accessible: bool  # step-free route (no stairs/steep/underpass); always requested for mobility-impaired citizens
    source: Literal["external", "local_graph", "cache", "static_matrix"]
    routing_status: Literal["online", "fallback"]
    notice: Notice | None  # "Oflayn/Ehtiyat marşrut rejimində işləyir" while the external API is down
    created_at: datetime
