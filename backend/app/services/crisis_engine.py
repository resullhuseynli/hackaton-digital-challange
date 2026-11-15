"""RED ALERT crisis engine.

Condition A (SOS_CLUSTER): within the last CLUSTER_WINDOW_MIN minutes at least CLUSTER_MIN_DISTINCT
DISTINCT citizens sent SOS either
   (1) in the same zone          -> Redis sliding window (ZSET per zone: member=citizen, score=last ts)
   (2) within CLUSTER_RADIUS_M of the new SOS -> PostGIS ST_DWithin on geography
Repeated SOS from the same citizen count once.
Condition B (POINT_OVERLOAD): an assembly point's occupancy >= RED_ALERT_OCCUPANCY_PCT.

De-duplication: an active alert for the same zone / nearby cluster center (or the same point) is
updated instead of creating a new one.
"""
import logging
from collections import Counter
from collections.abc import Sequence
from datetime import datetime, timedelta

from geoalchemy2 import Geography
from sqlalchemy import cast, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.errors import AppError
from app.geo import latlng, point_ewkt, sql_point
from app.models import Alert, AssemblyPoint, AuditLog, Brigade, Citizen, Route, SosSignal, utcnow
from app.realtime.events import Event, EventList, bus
from app.services.brigade_sim import dispatch_brigade
from app.services.priority import refresh_priorities
from app.services.rerouting import reroute_citizen
from app.services.routing import WALK, graph
from app.services.serialize import SOS_DISPATCH_ORDER, alert_out, assembly_point_out, brigade_eta_min, sos_out

log = logging.getLogger("app.crisis")

ZONE_KEY = "crisis:zone:{}"
BRIGADE_FOR_SOS = {"medical": "medical", "fire": "fire", "collapse": "rescue", "flood": "rescue"}


def _window() -> timedelta:
    return timedelta(minutes=settings.cluster_window_min)


def _geog(col):
    return cast(col, Geography)


# --------------------------------------------------------------------------- Redis sliding window
async def record_sos(sos: SosSignal) -> None:
    if sos.zone_id is None or bus.redis is None:
        return
    key = ZONE_KEY.format(sos.zone_id)
    await bus.redis.zadd(key, {str(sos.citizen_id): sos.created_at.timestamp()}, gt=True)
    await bus.redis.expire(key, int(_window().total_seconds() * 3) + 60)


async def zone_distinct_count(zone_id: int, now: datetime) -> int:
    if bus.redis is None:
        return 0
    key = ZONE_KEY.format(zone_id)
    lo = (now - _window()).timestamp()
    await bus.redis.zremrangebyscore(key, "-inf", f"({lo}")  # slide the window
    return await bus.redis.zcount(key, lo, now.timestamp())


# --------------------------------------------------------------------------- recommendations
async def recommend_brigade(session: AsyncSession, lat: float, lng: float, sos_type: str | None
                            ) -> tuple[Brigade, float] | None:
    """Idle brigade with the lowest driving ETA, preferring the type matching the dominant SOS type."""
    preferred = BRIGADE_FOR_SOS.get(sos_type or "")
    best_pref: tuple[Brigade, float] | None = None
    best_any: tuple[Brigade, float] | None = None
    idle = (await session.scalars(select(Brigade).where(Brigade.status == "idle"))).all()
    if not idle:
        return None
    to_target, target_snap = graph.distances_to(lat, lng)  # one search for all brigades
    for b in idle:
        blat, blng = latlng(b.location)
        starts = [(n, d) for n, d in graph.nearest_nodes(blat, blng, 6) if graph.g.out_degree(n) > 0]
        reachable = [(to_target[n] + d, n) for n, d in starts if n in to_target]
        if not reachable:
            continue
        eta = brigade_eta_min(min(reachable)[0] + target_snap)
        if best_any is None or eta < best_any[1]:
            best_any = (b, eta)
        if b.type == preferred and (best_pref is None or eta < best_pref[1]):
            best_pref = (b, eta)
    return best_pref or best_any


async def recommend_point(session: AsyncSession, lat: float, lng: float, required: int,
                          exclude_ids: Sequence[int] = (), accessible: bool = False
                          ) -> tuple[AssemblyPoint, float] | None:
    """Nearest reserve point reachable on open roads with enough free capacity. With accessible=True
    (persons with reduced mobility among the evacuees) a wheelchair-accessible point with a step-free
    route is preferred; otherwise falls back to any point."""
    if accessible:
        found = await _recommend_point(session, lat, lng, required, exclude_ids, accessible=True)
        if found:
            return found
    return await _recommend_point(session, lat, lng, required, exclude_ids, accessible=False)


async def _recommend_point(session: AsyncSession, lat: float, lng: float, required: int,
                           exclude_ids: Sequence[int], accessible: bool) -> tuple[AssemblyPoint, float] | None:
    here = _geog(sql_point(lat, lng))
    q = select(AssemblyPoint).where(AssemblyPoint.status == "reserve")
    if accessible:
        q = q.where(AssemblyPoint.wheelchair_accessible.is_(True))
    if exclude_ids:
        q = q.where(AssemblyPoint.id.not_in(list(exclude_ids)))
    for p in (await session.scalars(q.order_by(func.ST_Distance(_geog(AssemblyPoint.location), here)).limit(10))).all():
        if p.capacity - p.current_count < required:
            continue
        plat, plng = latlng(p.location)
        r = graph.route(lat, lng, plat, plng, WALK, accessible=accessible)
        if r is not None:
            return p, r.distance_m
    return None


async def affected_citizens(session: AsyncSession, alert: Alert) -> list[Citizen]:
    """Citizens to evacuate to the alert's new point."""
    if alert.kind == "POINT_OVERLOAD":
        heading = select(Route.citizen_id).where(Route.is_active.is_(True), Route.target_point_id == alert.point_id)
        q = select(Citizen).where(Citizen.status != "safe",
                                  or_(Citizen.id.in_(heading), Citizen.target_point_id == alert.point_id))
    else:
        c_lat, c_lng = latlng(alert.center)
        near = func.ST_DWithin(_geog(Citizen.location), _geog(sql_point(c_lat, c_lng)), alert.radius_m)
        cond = or_(Citizen.zone_id == alert.zone_id, near) if alert.zone_id is not None else near
        q = select(Citizen).where(Citizen.status != "safe", cond)
    return list((await session.scalars(q)).all())


async def _apply_recommendations(session: AsyncSession, alert: Alert, dominant_type: str | None) -> None:
    lat, lng = latlng(alert.center)
    if alert.kind == "SOS_CLUSTER":
        rec = await recommend_brigade(session, lat, lng, dominant_type)
        alert.recommended_brigade_id = rec[0].id if rec else None
        alert.recommended_brigade_eta_min = rec[1] if rec else None
    affected = await affected_citizens(session, alert)
    required = max(len(affected), alert.distinct_citizens, 1)
    exclude = [alert.point_id] if alert.point_id else []
    needs_access = any(c.mobility_impaired for c in affected)
    point = await recommend_point(session, lat, lng, required, exclude, accessible=needs_access)
    alert.recommended_new_point_id = point[0].id if point else None
    alert.recommended_new_point_distance_m = round(point[1], 1) if point else None


async def _distinct_citizens(session: AsyncSession, sos_ids: Sequence[int]) -> int:
    return await session.scalar(select(func.count(func.distinct(SosSignal.citizen_id)))
                                .where(SosSignal.id.in_(list(sos_ids)))) or 0


# --------------------------------------------------------------------------- condition A
async def evaluate_sos(session: AsyncSession, sos: SosSignal, events: EventList,
                       now: datetime | None = None) -> Alert | None:
    now = now or utcnow()
    start = now - _window()
    lat, lng = latlng(sos.location)
    in_window = (SosSignal.created_at >= start, SosSignal.created_at <= now,
                 SosSignal.is_suspected.is_(False), SosSignal.status != "rejected")
    cols = (SosSignal.id, SosSignal.citizen_id, SosSignal.type,
            func.ST_Y(SosSignal.location), func.ST_X(SosSignal.location))

    rows = (await session.execute(select(*cols).where(*in_window, func.ST_DWithin(
        _geog(SosSignal.location), _geog(sql_point(lat, lng)), settings.cluster_radius_m)))).all()
    if len({r[1] for r in rows}) < settings.cluster_min_distinct:
        rows = []
        if sos.zone_id is not None and await zone_distinct_count(sos.zone_id, now) >= settings.cluster_min_distinct:
            zone_rows = (await session.execute(select(*cols).where(*in_window, SosSignal.zone_id == sos.zone_id))).all()
            if len({r[1] for r in zone_rows}) >= settings.cluster_min_distinct:  # DB confirms the Redis window
                rows = zone_rows
    if not rows:
        return None

    sos_ids = sorted(r[0] for r in rows)
    distinct = len({r[1] for r in rows})
    dominant = Counter(r[2] for r in rows).most_common(1)[0][0]
    c_lat = sum(r[3] for r in rows) / len(rows)
    c_lng = sum(r[4] for r in rows) / len(rows)
    radius = settings.cluster_radius_m

    same_area = func.ST_DWithin(_geog(Alert.center), _geog(sql_point(c_lat, c_lng)), radius)
    match = or_(Alert.zone_id == sos.zone_id, same_area) if sos.zone_id is not None else same_area
    existing = await session.scalar(select(Alert).where(
        Alert.status == "active", Alert.kind == "SOS_CLUSTER", match)
        .order_by(Alert.created_at).limit(1).with_for_update())

    if existing is not None:
        merged = sorted(set(existing.sos_ids) | set(sos_ids))
        if merged == sorted(existing.sos_ids):
            return existing
        existing.sos_ids = merged
        existing.distinct_citizens = await _distinct_citizens(session, merged)
        existing.updated_at = now
        rec = await session.get(Brigade, existing.recommended_brigade_id) if existing.recommended_brigade_id else None
        if rec is None or rec.status != "idle" or existing.recommended_new_point_id is None:
            await _apply_recommendations(session, existing, dominant)
        await session.flush()
        events.append(Event("alert.updated", await alert_out(session, existing)))
        log.warning("alert %s updated: %d distinct citizens", existing.id, existing.distinct_citizens)
        return existing

    alert = Alert(kind="SOS_CLUSTER", zone_id=sos.zone_id, center=point_ewkt(c_lat, c_lng), radius_m=radius,
                  sos_ids=sos_ids, distinct_citizens=distinct, status="active", created_at=now, updated_at=now)
    session.add(alert)
    await session.flush()
    await session.refresh(alert)
    await _apply_recommendations(session, alert, dominant)
    await session.flush()
    await refresh_priorities(session, events, sos_ids, now)  # +15 bonus for SOS in an alerted zone
    events.append(Event("alert.raised", await alert_out(session, alert)))
    log.warning("RED ALERT %s raised (SOS_CLUSTER, zone=%s, %d citizens)", alert.id, sos.zone_id, distinct)
    return alert


# --------------------------------------------------------------------------- condition B
async def evaluate_point(session: AsyncSession, point: AssemblyPoint, events: EventList) -> Alert | None:
    if point.occupancy_raw < settings.red_alert_occupancy_pct:
        return None
    now = utcnow()
    existing = await session.scalar(select(Alert).where(
        Alert.status == "active", Alert.kind == "POINT_OVERLOAD", Alert.point_id == point.id).with_for_update())
    if existing is not None:
        existing.updated_at = now
        if existing.recommended_new_point_id is None:
            await _apply_recommendations(session, existing, None)
        await session.flush()
        events.append(Event("alert.updated", await alert_out(session, existing)))
        return existing
    alert = Alert(kind="POINT_OVERLOAD", zone_id=point.zone_id, center=point.location,
                  radius_m=settings.cluster_radius_m, sos_ids=[], distinct_citizens=0, point_id=point.id,
                  status="active", created_at=now, updated_at=now)
    session.add(alert)
    await session.flush()
    await session.refresh(alert)
    await _apply_recommendations(session, alert, None)
    await session.flush()
    events.append(Event("alert.raised", await alert_out(session, alert)))
    log.warning("RED ALERT %s raised (POINT_OVERLOAD, point=%s, %.1f%%)", alert.id, point.id, point.occupancy_raw)
    return alert


# --------------------------------------------------------------------------- dispatcher actions
async def _locked_active_alert(session: AsyncSession, alert_id: int) -> Alert:
    alert = await session.scalar(select(Alert).where(Alert.id == alert_id).with_for_update())
    if alert is None:
        raise AppError(404, "ALERT_NOT_FOUND")
    if alert.status != "active":
        raise AppError(409, "ALERT_NOT_ACTIVE")
    return alert


async def confirm_alert(session: AsyncSession, alert_id: int, actor: str, events: EventList,
                        brigade_id: int | None = None, new_point_id: int | None = None) -> Alert:
    """One-click execution. Runs inside the caller's transaction: any error -> nothing is committed."""
    alert = await _locked_active_alert(session, alert_id)
    brigade_id = brigade_id or alert.recommended_brigade_id
    new_point_id = new_point_id or alert.recommended_new_point_id
    summary: dict = {"alert_id": alert.id, "kind": alert.kind, "brigade_id": None, "new_point_id": None,
                     "assigned_sos_ids": [], "rerouted": 0,
                     "overridden": {"brigade": brigade_id != alert.recommended_brigade_id,
                                    "point": new_point_id != alert.recommended_new_point_id}}

    # 1) brigade -> highest-priority open SOS of the alert; all related SOS become "assigned"
    open_sos = (await session.scalars(select(SosSignal).where(
        SosSignal.id.in_(list(alert.sos_ids)), SosSignal.status != "resolved")
        .order_by(*SOS_DISPATCH_ORDER))).all()
    if open_sos and brigade_id:
        brigade = await session.scalar(select(Brigade).where(Brigade.id == brigade_id).with_for_update())
        if brigade is None:
            raise AppError(404, "BRIGADE_NOT_FOUND")
        if brigade.status != "idle":
            raise AppError(409, "BRIGADE_BUSY")
        await dispatch_brigade(session, brigade, open_sos[0], events)
        for s in open_sos:
            s.status = "assigned"
            s.assigned_brigade_id = brigade.id
        await session.flush()
        for s in open_sos:
            events.append(Event("sos.updated", sos_out(s, brigade), citizen_ids=[str(s.citizen_id)]))
        summary["brigade_id"] = brigade.id
        summary["assigned_sos_ids"] = [s.id for s in open_sos]

    # 2) activate the reserve point and 3) evacuate the affected citizens to it
    if new_point_id:
        point = await session.scalar(select(AssemblyPoint).where(AssemblyPoint.id == new_point_id).with_for_update())
        if point is None:
            raise AppError(404, "POINT_NOT_FOUND")
        if point.status == "closed":
            raise AppError(409, "POINT_CLOSED")
        point.status = "active"
        await session.flush()
        events.append(Event("point.occupancy", assembly_point_out(point)))
        rerouted = 0
        for c in await affected_citizens(session, alert):
            if await reroute_citizen(session, c, "alert_new_point", events, force_point=point):
                rerouted += 1
        if rerouted:
            events.append(Event("route.rerouted", {"count": rerouted, "reason": "alert_new_point",
                                                   "point_id": point.id, "alert_id": alert.id}))
        summary["new_point_id"] = point.id
        summary["rerouted"] = rerouted

    # 4) close the alert + audit trail
    alert.status = "confirmed"
    alert.confirmed_by = actor
    alert.updated_at = utcnow()
    session.add(AuditLog(actor=actor, action="alert.confirm", payload=summary))
    await session.flush()
    events.append(Event("alert.resolved", await alert_out(session, alert) | {"result": summary}))
    return alert


async def dismiss_alert(session: AsyncSession, alert_id: int, actor: str, reason: str, events: EventList) -> Alert:
    alert = await _locked_active_alert(session, alert_id)
    alert.status = "dismissed"
    alert.dismiss_reason = reason
    alert.updated_at = utcnow()
    session.add(AuditLog(actor=actor, action="alert.dismiss", payload={"alert_id": alert.id, "reason": reason}))
    await session.flush()
    events.append(Event("alert.resolved", await alert_out(session, alert) | {"reason": reason}))
    return alert
