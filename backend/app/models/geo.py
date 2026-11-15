from datetime import datetime
from typing import Any

from geoalchemy2 import Geometry
from sqlalchemy import (BigInteger, Boolean, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint,
                        true)
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, utcnow


class Zone(Base):
    __tablename__ = "zones"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    polygon: Mapped[Any] = mapped_column(Geometry("POLYGON", srid=4326, spatial_index=True), nullable=False)
    population: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class AssemblyPoint(Base):
    __tablename__ = "assembly_points"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    type: Mapped[str] = mapped_column(String(16), nullable=False)  # shelter | park | stadium
    location: Mapped[Any] = mapped_column(Geometry("POINT", srid=4326, spatial_index=True), nullable=False)
    zone_id: Mapped[int | None] = mapped_column(ForeignKey("zones.id"), index=True)
    capacity: Mapped[int] = mapped_column(Integer, nullable=False)
    current_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="active", index=True)
    # step-free entrance; metro shelters usually are not (stairs/escalators)
    wheelchair_accessible: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default=true())

    @property
    def occupancy_raw(self) -> float:
        """Unrounded occupancy percent; used for threshold comparisons."""
        return self.current_count * 100.0 / self.capacity if self.capacity else 100.0

    @property
    def occupancy_pct(self) -> float:
        return round(self.occupancy_raw, 1)


class RoadNode(Base):
    __tablename__ = "road_nodes"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=False)
    location: Mapped[Any] = mapped_column(Geometry("POINT", srid=4326, spatial_index=True), nullable=False)


class RoadSegment(Base):
    __tablename__ = "road_segments"
    __table_args__ = (UniqueConstraint("from_node", "to_node", name="uq_road_segments_nodes"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    from_node: Mapped[int] = mapped_column(ForeignKey("road_nodes.id"), index=True, nullable=False)
    to_node: Mapped[int] = mapped_column(ForeignKey("road_nodes.id"), index=True, nullable=False)
    length_m: Mapped[float] = mapped_column(Float, nullable=False)
    speed_kmh: Mapped[float] = mapped_column(Float, nullable=False, default=40)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="open")  # open|closed|congested
    congestion_factor: Mapped[float] = mapped_column(Float, nullable=False, default=1.0)
    # obstacle for persons with reduced mobility: stairs | steep | underpass | curb | narrow; NULL = step-free
    barrier: Mapped[str | None] = mapped_column(String(16))
    base_barrier: Mapped[str | None] = mapped_column(String(16))  # seed value, restored by /sim/reset
    geometry: Mapped[Any] = mapped_column(Geometry("LINESTRING", srid=4326, spatial_index=True), nullable=False)


class RoadEvent(Base):
    __tablename__ = "road_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    segment_id: Mapped[int] = mapped_column(ForeignKey("road_segments.id", ondelete="CASCADE"), index=True)
    event: Mapped[str] = mapped_column(String(16), nullable=False)  # closed|opened|congested
    reason: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
