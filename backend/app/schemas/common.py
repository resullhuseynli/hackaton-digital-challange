from typing import Literal

from pydantic import BaseModel, Field

Lat = Field(..., ge=-90, le=90, examples=[40.3893])
Lng = Field(..., ge=-180, le=180, examples=[49.8020])

SosType = Literal["fire", "collapse", "flood", "medical"]


class LatLng(BaseModel):
    lat: float
    lng: float


class ErrorDetail(BaseModel):
    code: str
    message: str


class ErrorResponse(BaseModel):
    error: ErrorDetail


class OkResponse(BaseModel):
    ok: bool = True
