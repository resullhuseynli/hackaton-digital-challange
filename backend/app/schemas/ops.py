import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.common import Lat, LatLng, Lng, SosType


class SosCreate(BaseModel):
    model_config = ConfigDict(json_schema_extra={
        "examples": [{"type": "collapse", "lat": 40.3893, "lng": 49.8020, "note": "Bina çöküb, 3 nəfər içəridədir"}]})
    type: SosType
    lat: float = Lat
    lng: float = Lng
    note: str | None = Field(None, max_length=1000)


class Label(BaseModel):
    code: str   # language-independent, e.g. "MOBILITY_IMPAIRED"
    text: str   # localized text to display as a badge


SosStatus = Literal["new", "assigned", "resolved", "rejected"]


class CitizenSosOut(BaseModel):
    """The SOS contract for citizens: same as for dispatchers, minus anti-spam internals
    (a bot must not learn that it was quarantined)."""
    id: int
    citizen_id: uuid.UUID
    type: SosType
    lat: float
    lng: float
    zone_id: int | None
    note: str | None
    priority_score: float
    status: SosStatus
    assigned_brigade_id: int | None
    brigade_eta_min: float | None
    created_at: datetime
    citizen_mobility_impaired: bool
    labels: list[Label]


class SosOut(BaseModel):
    id: int
    citizen_id: uuid.UUID
    type: SosType
    lat: float
    lng: float
    zone_id: int | None
    note: str | None
    priority_score: float
    status: SosStatus
    assigned_brigade_id: int | None
    brigade_eta_min: float | None
    created_at: datetime
    citizen_mobility_impaired: bool  # ranked first in the dispatcher list regardless of priority_score
    labels: list[Label]
    is_suspected: bool               # quarantined as possible spam, awaiting review
    suspicion_reason: str | None     # ip_mass_registration | flood_new_device
    duplicate_count: int             # identical reports merged into this SOS


class BrigadeOut(BaseModel):
    id: int
    name: str
    type: Literal["fire", "medical", "rescue"]
    lat: float
    lng: float
    status: Literal["idle", "en_route", "on_site", "returning"]
    target_sos_id: int | None
    route_geometry: dict | None  # GeoJSON LineString


class AssignIn(BaseModel):
    model_config = ConfigDict(json_schema_extra={"examples": [{"sos_id": 1}]})
    sos_id: int


class RecommendedBrigade(BaseModel):
    id: int
    name: str
    type: str
    eta_min: float | None


class RecommendedPoint(BaseModel):
    id: int
    name: str
    capacity: int
    distance_m: float | None


class AlertOut(BaseModel):
    id: int
    kind: Literal["SOS_CLUSTER", "POINT_OVERLOAD"]
    zone_id: int | None
    zone_name: str | None
    center: LatLng
    radius_m: float
    sos_ids: list[int]
    distinct_citizens: int
    point_id: int | None
    recommended_brigade: RecommendedBrigade | None
    recommended_new_point: RecommendedPoint | None
    mobility_impaired_sos_ids: list[int]  # SOS in this alert from persons with reduced mobility
    labels: list[Label]
    status: Literal["active", "confirmed", "dismissed"]
    created_at: datetime
    updated_at: datetime


class AlertConfirmIn(BaseModel):
    model_config = ConfigDict(json_schema_extra={"examples": [{}, {"brigade_id": 3, "new_point_id": 28}]})
    brigade_id: int | None = None
    new_point_id: int | None = None


class AlertDismissIn(BaseModel):
    model_config = ConfigDict(json_schema_extra={"examples": [{"reason": "Yalançı siqnal, yerində yoxlanıldı"}]})
    reason: str = Field(..., min_length=1, max_length=500)
