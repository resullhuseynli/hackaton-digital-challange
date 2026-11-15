"""ORM -> API dict conversion (field names follow the public API contract exactly)."""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.geo import geojson_line, latlng, line_coords
from app.i18n import DEFAULT_LANG, t
from app.models import Alert, AssemblyPoint, Brigade, Citizen, Route, SosSignal, Zone


def assembly_point_out(p: AssemblyPoint) -> dict:
    lat, lng = latlng(p.location)
    return {"id": p.id, "name": p.name, "type": p.type, "lat": lat, "lng": lng, "zone_id": p.zone_id,
            "capacity": p.capacity, "current_count": p.current_count, "occupancy_pct": p.occupancy_pct,
            "status": p.status, "wheelchair_accessible": p.wheelchair_accessible}


def citizen_out(c: Citizen) -> dict:
    ll = latlng(c.location)
    return {"id": c.id, "device_id": c.device_id, "phone": c.phone, "lat": ll[0] if ll else None,
            "lng": ll[1] if ll else None, "zone_id": c.zone_id, "status": c.status,
            "target_point_id": c.target_point_id, "mobility_impaired": c.mobility_impaired,
            "updated_at": c.updated_at}


def route_out(r: Route, lang: str = DEFAULT_LANG) -> dict:
    return {"id": r.id, "target_point_id": r.target_point_id, "geometry": geojson_line(line_coords(r.geometry)),
            "distance_m": r.distance_m, "eta_min": r.eta_min, "version": r.version, "reason": r.reason,
            "accessible": r.accessible, "source": r.source,
            "routing_status": "fallback" if r.degraded else "online",
            "notice": label("ROUTING_FALLBACK", lang) if r.degraded else None,
            "created_at": r.created_at}


def brigade_eta_min(distance_m: float) -> float:
    return round(distance_m / (settings.brigade_speed_kmh / 3.6) / 60.0, 2)


def brigade_remaining_eta(b: Brigade | None) -> float | None:
    if b is None:
        return None
    if b.status == "on_site":
        return 0.0
    if b.status == "en_route":
        return brigade_eta_min(max(0.0, b.route_length_m - b.route_progress_m))
    return None


def brigade_out(b: Brigade) -> dict:
    lat, lng = latlng(b.location)
    coords = line_coords(b.route_geometry)
    return {"id": b.id, "name": b.name, "type": b.type, "lat": lat, "lng": lng, "status": b.status,
            "target_sos_id": b.target_sos_id, "route_geometry": geojson_line(coords) if coords else None}


# Dispatcher ordering: persons with reduced mobility first ("Priority #1"), then by score, then oldest first
SOS_DISPATCH_ORDER = (SosSignal.is_suspected.asc(),
                      (SosSignal.citizen_mobility_impaired & ~SosSignal.is_suspected).desc(),
                      SosSignal.priority_score.desc(), SosSignal.created_at)


def label(code: str, lang: str = DEFAULT_LANG) -> dict:
    return {"code": code, "text": t(code, lang)}


def sos_out(s: SosSignal, brigade: Brigade | None = None, lang: str = DEFAULT_LANG) -> dict:
    lat, lng = latlng(s.location)
    eta = brigade_remaining_eta(brigade) if brigade is not None and s.status == "assigned" else None
    return {"id": s.id, "citizen_id": s.citizen_id, "type": s.type, "lat": lat, "lng": lng, "zone_id": s.zone_id,
            "note": s.note, "priority_score": s.priority_score, "status": s.status,
            "assigned_brigade_id": s.assigned_brigade_id, "brigade_eta_min": eta, "created_at": s.created_at,
            "citizen_mobility_impaired": s.citizen_mobility_impaired,
            "labels": ([label("SUSPECTED_SPAM", lang)] if s.is_suspected else [])
            + ([label("MOBILITY_IMPAIRED", lang)] if s.citizen_mobility_impaired else []),
            "is_suspected": s.is_suspected, "suspicion_reason": s.suspicion_reason,
            "duplicate_count": s.duplicate_count}


async def alert_out(session: AsyncSession, a: Alert, lang: str = DEFAULT_LANG) -> dict:
    zone = await session.get(Zone, a.zone_id) if a.zone_id else None
    brigade = await session.get(Brigade, a.recommended_brigade_id) if a.recommended_brigade_id else None
    point = await session.get(AssemblyPoint, a.recommended_new_point_id) if a.recommended_new_point_id else None
    impaired = sorted((await session.scalars(select(SosSignal.id).where(
        SosSignal.id.in_(list(a.sos_ids)), SosSignal.citizen_mobility_impaired.is_(True)))).all()) if a.sos_ids else []
    lat, lng = latlng(a.center)
    return {
        "mobility_impaired_sos_ids": impaired,
        "labels": [label("MOBILITY_IMPAIRED", lang)] if impaired else [],
        "id": a.id, "kind": a.kind, "zone_id": a.zone_id, "zone_name": zone.name if zone else None,
        "center": {"lat": lat, "lng": lng}, "radius_m": a.radius_m, "sos_ids": list(a.sos_ids),
        "distinct_citizens": a.distinct_citizens, "point_id": a.point_id,
        "recommended_brigade": {"id": brigade.id, "name": brigade.name, "type": brigade.type,
                                "eta_min": a.recommended_brigade_eta_min} if brigade else None,
        "recommended_new_point": {"id": point.id, "name": point.name, "capacity": point.capacity,
                                  "distance_m": a.recommended_new_point_distance_m} if point else None,
        "status": a.status, "created_at": a.created_at, "updated_at": a.updated_at,
    }
