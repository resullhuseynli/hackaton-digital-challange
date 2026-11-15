from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.schemas.common import SosType
from app.schemas.geo import AssemblyPointOut


class OverviewOut(BaseModel):
    active_sos: int
    active_sos_mobility_impaired: int
    resolved_sos: int
    citizens_safe: int
    citizens_in_danger: int
    brigades_idle: int
    brigades_busy: int
    avg_occupancy_pct: float
    active_alerts: int
    suspected_sos: int  # quarantined SOS awaiting review
    routing_status: Literal["online", "fallback"]


class TimeseriesPoint(BaseModel):
    minute: datetime
    total: int
    by_type: dict[str, int]


class TimeseriesOut(BaseModel):
    minutes: int
    series: list[TimeseriesPoint]


class RoadClosureIn(BaseModel):
    model_config = ConfigDict(json_schema_extra={"examples": [
        {"segment_id": 120, "status": "closed", "reason": "Bina uçqunu yolu bağlayıb"},
        {"lat": 40.3950, "lng": 49.8000, "status": "congested", "congestion_factor": 3.0, "reason": "Sıxlıq"},
    ]})
    segment_id: int | None = None
    lat: float | None = Field(None, ge=-90, le=90)
    lng: float | None = Field(None, ge=-180, le=180)
    status: Literal["closed", "open", "congested"]
    reason: str | None = Field(None, max_length=500)
    congestion_factor: float | None = Field(None, ge=1.0, le=50.0)
    both_directions: bool = True

    @model_validator(mode="after")
    def _target(self):
        if self.segment_id is None and (self.lat is None or self.lng is None):
            raise ValueError("segment_id or lat/lng is required")
        return self


class RoadClosureOut(BaseModel):
    segment_ids: list[int]
    status: str
    congestion_factor: float
    rerouted: int


class BarrierIn(BaseModel):
    model_config = ConfigDict(json_schema_extra={"examples": [
        {"lat": 40.3950, "lng": 49.8000, "barrier": "stairs", "reason": "Piyada keçidi yalnız pilləkənlə"},
        {"segment_id": 120, "barrier": None, "reason": "Pandus quraşdırıldı"},
    ]})
    segment_id: int | None = None
    lat: float | None = Field(None, ge=-90, le=90)
    lng: float | None = Field(None, ge=-180, le=180)
    barrier: Literal["stairs", "steep", "underpass", "curb", "narrow", "inaccessible"] | None
    reason: str | None = Field(None, max_length=500)
    both_directions: bool = True

    @model_validator(mode="after")
    def _target(self):
        if self.segment_id is None and (self.lat is None or self.lng is None):
            raise ValueError("segment_id or lat/lng is required")
        return self


class BarrierOut(BaseModel):
    segment_ids: list[int]
    barrier: str | None
    rerouted: int


class OccupancyIn(BaseModel):
    model_config = ConfigDict(json_schema_extra={"examples": [{"point_id": 15, "delta": 500},
                                                              {"point_id": 15, "current_count": 4550}]})
    point_id: int
    current_count: int | None = Field(None, ge=0)
    delta: int | None = None

    @model_validator(mode="after")
    def _one_of(self):
        if (self.current_count is None) == (self.delta is None):
            raise ValueError("exactly one of current_count or delta is required")
        return self


class OccupancyOut(BaseModel):
    point: AssemblyPointOut
    rerouted: int
    alert_id: int | None


class SosBurstIn(BaseModel):
    model_config = ConfigDict(json_schema_extra={"examples": [
        {"lat": 40.3960, "lng": 49.7950, "count": 4, "radius_m": 400, "window_sec": 120, "type": "collapse"}]})
    lat: float = Field(..., ge=-90, le=90)
    lng: float = Field(..., ge=-180, le=180)
    count: int = Field(4, ge=1, le=200)
    radius_m: float = Field(300, gt=0, le=5000)
    window_sec: float = Field(120, ge=0, le=3600)
    type: SosType = "collapse"
    seed: int | None = None


class SosBurstOut(BaseModel):
    citizen_ids: list[str]
    sos_ids: list[int]
    alert_ids: list[int]
