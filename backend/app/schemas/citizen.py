import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.common import Lat, Lng


class CitizenRegister(BaseModel):
    model_config = ConfigDict(json_schema_extra={
        "examples": [{"device_id": "3f2b8c1e-7a4d-4b6e-9f1a-2c3d4e5f6a7b", "phone": "+994501234567",
                      "mobility_impaired": True}]})
    device_id: uuid.UUID
    phone: str | None = Field(None, max_length=32)
    mobility_impaired: bool | None = Field(
        None, description="Registration checkbox \"Hərəkət məhdudiyyətli şəxs\" (person with reduced mobility). "
                          "Their SOS signals are always ranked first for dispatchers. Omit to keep the current value.")


class CitizenOut(BaseModel):
    id: uuid.UUID
    device_id: str
    phone: str | None
    lat: float | None
    lng: float | None
    zone_id: int | None
    status: Literal["unknown", "in_danger", "safe"]
    target_point_id: int | None
    mobility_impaired: bool
    updated_at: datetime


class LocationIn(BaseModel):
    model_config = ConfigDict(json_schema_extra={"examples": [{"lat": 40.3893, "lng": 49.8020}]})
    lat: float = Lat
    lng: float = Lng


class StatusIn(BaseModel):
    model_config = ConfigDict(json_schema_extra={"examples": [{"status": "safe"}]})
    status: Literal["safe", "in_danger"]


class RouteRequest(BaseModel):
    model_config = ConfigDict(json_schema_extra={"examples": [{"point_id": 15, "lat": 40.3893, "lng": 49.8020}]})
    point_id: int
    lat: float = Lat
    lng: float = Lng
