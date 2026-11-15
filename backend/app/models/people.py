import uuid
from datetime import datetime
from typing import Any

from geoalchemy2 import Geometry
from sqlalchemy import BigInteger, Boolean, DateTime, Float, ForeignKey, Index, Integer, String, false, func, true
from sqlalchemy.dialects.postgresql import ARRAY, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, utcnow


class Citizen(Base):
    __tablename__ = "citizens"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    device_id: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    phone: Mapped[str | None] = mapped_column(String(32))
    location: Mapped[Any] = mapped_column(Geometry("POINT", srid=4326, spatial_index=True), nullable=True)
    zone_id: Mapped[int | None] = mapped_column(ForeignKey("zones.id"), index=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="unknown", index=True)
    target_point_id: Mapped[int | None] = mapped_column(ForeignKey("assembly_points.id"), index=True)
    is_simulated: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # "Hərəkət məhdudiyyətli şəxs" - person with reduced mobility; always top priority for dispatchers
    mobility_impaired: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=false())
    # device age is an anti-spam signal (bot floods register thousands of fresh devices)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, server_default=func.now(),
                                                 nullable=False, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class Route(Base):
    __tablename__ = "routes"
    __table_args__ = (
        Index("ix_routes_citizen_active", "citizen_id", "is_active"),
        Index("ix_routes_segment_ids_gin", "segment_ids", postgresql_using="gin"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    citizen_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("citizens.id", ondelete="CASCADE"), nullable=False)
    target_point_id: Mapped[int] = mapped_column(ForeignKey("assembly_points.id"), index=True, nullable=False)
    # bigint[]: OSM node ids do not fit into int4
    node_path: Mapped[list[int]] = mapped_column(ARRAY(BigInteger), nullable=False, default=list)
    segment_ids: Mapped[list[int]] = mapped_column(ARRAY(Integer), nullable=False, default=list)
    geometry: Mapped[Any] = mapped_column(Geometry("LINESTRING", srid=4326, spatial_index=True), nullable=False)
    distance_m: Mapped[float] = mapped_column(Float, nullable=False)
    eta_min: Mapped[float] = mapped_column(Float, nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    reason: Mapped[str] = mapped_column(String(32), nullable=False, default="initial")
    # True when computed in step-free mode (no stairs/steep/underpass segments)
    accessible: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=false())
    # where the route came from: external | local_graph | cache | static_matrix
    source: Mapped[str] = mapped_column(String(16), nullable=False, default="local_graph",
                                        server_default="local_graph")
    # served by the backup chain while the external map/routing API was unavailable
    degraded: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=false())
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class Dispatcher(Base):
    __tablename__ = "dispatchers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(128), nullable=False)
    # RBAC: operator (read-only) < dispatcher (brigades, alerts, SOS) < admin (+ simulation)
    role: Mapped[str] = mapped_column(String(16), nullable=False, default="dispatcher", server_default="dispatcher")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default=true())
