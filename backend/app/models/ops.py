import uuid
from datetime import datetime
from typing import Any

from geoalchemy2 import Geometry
from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Index, Integer, String, Text, false
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, utcnow


class Brigade(Base):
    __tablename__ = "brigades"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    type: Mapped[str] = mapped_column(String(16), nullable=False)  # fire | medical | rescue
    location: Mapped[Any] = mapped_column(Geometry("POINT", srid=4326, spatial_index=True), nullable=False)
    home_location: Mapped[Any] = mapped_column(Geometry("POINT", srid=4326, spatial_index=True), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="idle", index=True)
    # plain int (no FK) to avoid a circular FK with sos_signals.assigned_brigade_id
    target_sos_id: Mapped[int | None] = mapped_column(Integer)
    target_location: Mapped[Any] = mapped_column(Geometry("POINT", srid=4326, spatial_index=True), nullable=True)
    route_geometry: Mapped[Any] = mapped_column(Geometry("LINESTRING", srid=4326, spatial_index=True), nullable=True)
    route_length_m: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    route_progress_m: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class SosSignal(Base):
    __tablename__ = "sos_signals"
    __table_args__ = (Index("ix_sos_signals_queue", "is_suspected", "status"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    citizen_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("citizens.id", ondelete="CASCADE"), index=True)
    type: Mapped[str] = mapped_column(String(16), nullable=False)  # fire|collapse|flood|medical
    location: Mapped[Any] = mapped_column(Geometry("POINT", srid=4326, spatial_index=True), nullable=False)
    zone_id: Mapped[int | None] = mapped_column(ForeignKey("zones.id"), index=True)
    note: Mapped[str | None] = mapped_column(Text)
    priority_score: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    # copied from the citizen when the SOS is created; such SOS are always ranked first
    citizen_mobility_impaired: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False,
                                                            server_default=false())
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="new", index=True)  # +rejected
    # anti-spam: quarantined SOS are hidden from the queue and ignored by the crisis engine until reviewed
    is_suspected: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=false())
    suspicion_reason: Mapped[str | None] = mapped_column(String(32))
    duplicate_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    source_ip_hash: Mapped[str | None] = mapped_column(String(32), index=True)  # HMAC of the client IP
    # set when the crisis engine has processed this SOS (async queue); NULL + old = re-enqueue (safety net)
    evaluated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    assigned_brigade_id: Mapped[int | None] = mapped_column(ForeignKey("brigades.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False, index=True)


class Alert(Base):
    __tablename__ = "alerts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    kind: Mapped[str] = mapped_column(String(32), nullable=False)  # SOS_CLUSTER | POINT_OVERLOAD
    zone_id: Mapped[int | None] = mapped_column(ForeignKey("zones.id"), index=True)
    center: Mapped[Any] = mapped_column(Geometry("POINT", srid=4326, spatial_index=True), nullable=False)
    radius_m: Mapped[float] = mapped_column(Float, nullable=False)
    sos_ids: Mapped[list[int]] = mapped_column(ARRAY(Integer), nullable=False, default=list)
    distinct_citizens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    point_id: Mapped[int | None] = mapped_column(ForeignKey("assembly_points.id"), index=True)
    recommended_brigade_id: Mapped[int | None] = mapped_column(ForeignKey("brigades.id"))
    recommended_brigade_eta_min: Mapped[float | None] = mapped_column(Float)
    recommended_new_point_id: Mapped[int | None] = mapped_column(ForeignKey("assembly_points.id"))
    recommended_new_point_distance_m: Mapped[float | None] = mapped_column(Float)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="active", index=True)
    confirmed_by: Mapped[str | None] = mapped_column(String(64))
    dismiss_reason: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class AuditLog(Base):
    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    actor: Mapped[str] = mapped_column(String(64), nullable=False)
    action: Mapped[str] = mapped_column(String(64), nullable=False)
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False, index=True)
