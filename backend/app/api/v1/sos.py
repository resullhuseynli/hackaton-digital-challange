from typing import Literal

from fastapi import APIRouter, Depends, Header, Query, Request, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db import get_session
from app.deps import current_citizen, current_dispatcher, require_dispatcher
from app.errors import AppError, citizen_not_registered
from app.i18n import language_params
from app.models import AuditLog, Brigade, Citizen, Dispatcher, SosSignal, utcnow
from app.realtime.events import Event, EventList, bus
from app.schemas.common import ErrorResponse, SosType
from app.schemas.ops import CitizenSosOut, SosCreate, SosOut
from app.services import antispam, crisis_queue
from app.services.brigade_sim import send_home
from app.services.overview import add_overview_event
from app.services.serialize import SOS_DISPATCH_ORDER, sos_out
from app.services.sos import activate_sos, create_sos

router = APIRouter(tags=["sos"])


def citizen_view(out: dict) -> dict:
    """Hide quarantine markers from the citizen-facing response."""
    return out | {"labels": [lbl for lbl in out["labels"] if lbl["code"] != "SUSPECTED_SPAM"]}


@router.post("/sos", response_model=CitizenSosOut, status_code=201, summary="Send an SOS (citizen)",
             dependencies=[Depends(antispam.limit_sos)],
             description="Protected against floods: per-IP rate limit (429 `RATE_LIMITED`), per-device cooldown "
                         "(429 `SOS_COOLDOWN`), `Idempotency-Key` replay (200), and merging of identical reports "
                         "from the same spot/IP (200, header `X-Duplicate-Of`). Suspicious SOS are quarantined "
                         "for dispatcher review.",
             responses={200: {"description": "Idempotent replay or merged duplicate"},
                        429: {"model": ErrorResponse, "description": "RATE_LIMITED / SOS_COOLDOWN"}})
async def send_sos(body: SosCreate, request: Request, response: Response,
                   session: AsyncSession = Depends(get_session), lang: str = Depends(language_params),
                   x_device_id: str | None = Header(None, alias="X-Device-Id"),
                   idempotency_key: str | None = Header(None, alias="Idempotency-Key", max_length=128)):
    # Order matters under floods: all Redis checks first, DB work last and short (a pooled connection is
    # only held for SELECT citizen + INSERT + COMMIT).
    if not x_device_id:
        raise AppError(401, "MISSING_DEVICE_ID")
    ip_hash = antispam.request_ip_hash(request)

    # 1) client retry with the same Idempotency-Key -> same SOS
    idem = antispam.idempotency_key(x_device_id, idempotency_key) if idempotency_key else None
    if idem and (prev_id := await antispam.get_int(idem)):
        prev = await session.get(SosSignal, prev_id)
        if prev is not None:
            response.status_code = 200
            response.headers["Idempotent-Replay"] = "true"
            return citizen_view(sos_out(prev, lang=lang))

    # 2-4) cooldown, duplicate lookup, flood counter, registration counter: one Redis round trip
    fp = antispam.fingerprint(body.type, body.lat, body.lng, ip_hash)
    cd_ok, cd_ttl, dup_id, flood, registrations = await antispam.precheck(
        x_device_id, settings.sos_cooldown_sec, fp, ip_hash)
    if not cd_ok:  # same device: cooldown
        retry = max(1, cd_ttl)
        raise AppError(429, "SOS_COOLDOWN", {"retry_after_sec": retry}, headers={"Retry-After": str(retry)},
                       seconds=retry)

    citizen = await session.scalar(select(Citizen).where(Citizen.device_id == x_device_id))
    if citizen is None:
        raise citizen_not_registered()

    # another device, same IP, same spot and type, within the window -> merge into the first report
    if dup_id is not None:
        dup = await session.scalar(select(SosSignal).where(SosSignal.id == dup_id).with_for_update())
        if dup is not None and dup.citizen_id != citizen.id and dup.status != "rejected":
            dup.duplicate_count += 1
            await session.commit()
            response.status_code = 200
            response.headers["X-Duplicate-Of"] = str(dup.id)
            # the merged incident, without the other reporter's identity or note
            return citizen_view(sos_out(dup, lang=lang)) | {"citizen_id": citizen.id, "note": None}

    # quarantine decision, then create
    now = utcnow()
    suspected, reason = antispam.assess_with(citizen, registrations, flood, now)
    events: EventList = []
    deferred = settings.crisis_async and not suspected
    sos = await create_sos(session, citizen, body.type, body.lat, body.lng, body.note, events, now=now,
                           cooldown=False, suspected=suspected, suspicion_reason=reason, ip_hash=ip_hash,
                           defer=deferred)
    if suspected:
        async def payload():
            pending = await session.scalar(select(func.count()).select_from(SosSignal).where(
                SosSignal.is_suspected.is_(True), SosSignal.status == "new"))
            return {"quarantined_pending": pending, "reason": reason, "flood_mode": flood}
        await antispam.notify_quarantine(events, payload)
    await session.commit()
    await antispam.remember(fp, sos.id, settings.spam_dup_window_sec)
    if idem:
        await antispam.remember(idem, sos.id, 600)
    await bus.publish_many(events)
    if deferred and not await crisis_queue.enqueue([sos.id]):
        await crisis_queue.process(sos.id)  # queue unavailable: evaluate inline, never skip the crisis engine
    return citizen_view(sos_out(sos, lang=lang))


@router.get("/sos/me", response_model=list[CitizenSosOut], summary="Citizen's own SOS signals")
async def my_sos(citizen: Citizen = Depends(current_citizen), session: AsyncSession = Depends(get_session),
                 lang: str = Depends(language_params)):
    rows = (await session.execute(
        select(SosSignal, Brigade).outerjoin(Brigade, Brigade.id == SosSignal.assigned_brigade_id)
        .where(SosSignal.citizen_id == citizen.id).order_by(SosSignal.created_at.desc()))).all()
    return [citizen_view(sos_out(s, b, lang)) for s, b in rows]


@router.get("/sos", response_model=list[SosOut], summary="SOS queue for dispatchers (any panel role)",
            description="Order: persons with reduced mobility first, then `priority_score` desc, then oldest. "
                        "Quarantined (suspected spam) SOS are excluded unless `suspected_only=true` or "
                        "`include_suspected=true`; rejected SOS only with `status=rejected`. Paginated "
                        "(`limit`, `offset`), total in the `X-Total-Count` header.")
async def list_sos(response: Response, status: str | None = None, zone_id: int | None = None,
                   type: SosType | None = None, include_suspected: bool = False, suspected_only: bool = False,
                   limit: int = Query(200, ge=1, le=1000), offset: int = Query(0, ge=0),
                   _: Dispatcher = Depends(current_dispatcher), session: AsyncSession = Depends(get_session),
                   lang: str = Depends(language_params)):
    conds = []
    if status:
        conds.append(SosSignal.status == status)
    else:
        conds.append(SosSignal.status != "rejected")
    if suspected_only:
        conds.append(SosSignal.is_suspected.is_(True))
    elif not include_suspected:
        conds.append(SosSignal.is_suspected.is_(False))
    if zone_id is not None:
        conds.append(SosSignal.zone_id == zone_id)
    if type:
        conds.append(SosSignal.type == type)
    total = await session.scalar(select(func.count()).select_from(SosSignal).where(*conds))
    response.headers["X-Total-Count"] = str(total)
    q = (select(SosSignal, Brigade).outerjoin(Brigade, Brigade.id == SosSignal.assigned_brigade_id)
         .where(*conds).order_by(*SOS_DISPATCH_ORDER).limit(limit).offset(offset))
    rows = (await session.execute(q)).all()
    return [sos_out(s, b, lang) for s, b in rows]


class ReviewIn(BaseModel):
    model_config = ConfigDict(json_schema_extra={"examples": [{"sos_ids": [12, 13], "verdict": "genuine"},
                                                              {"sos_ids": [14], "verdict": "spam"}]})
    sos_ids: list[int] = Field(..., min_length=1, max_length=1000)
    verdict: Literal["genuine", "spam"]


class ReviewOut(BaseModel):
    updated: int
    alert_ids: list[int]


@router.post("/sos/review", response_model=ReviewOut, summary="Review quarantined SOS (dispatcher role)",
             description="`genuine`: released into the queue (priority, live event, crisis engine). "
                         "`spam`: status `rejected`. Bulk up to 1000 ids.")
async def review_sos(body: ReviewIn, dispatcher: Dispatcher = Depends(require_dispatcher),
                     session: AsyncSession = Depends(get_session)):
    rows = (await session.scalars(select(SosSignal).where(
        SosSignal.id.in_(body.sos_ids), SosSignal.is_suspected.is_(True), SosSignal.status == "new")
        .order_by(SosSignal.created_at).with_for_update())).all()
    events: EventList = []
    now = utcnow()
    for s in rows:
        if body.verdict == "spam":
            s.status = "rejected"
            continue
        s.is_suspected = False
        citizen = await session.get(Citizen, s.citizen_id)
        if citizen is not None:
            citizen.status = "in_danger"
        await session.flush()
        await activate_sos(session, s, events, now)
    session.add(AuditLog(actor=dispatcher.username, action=f"sos.review.{body.verdict}",
                         payload={"sos_ids": [s.id for s in rows]}))
    await add_overview_event(session, events)
    await session.commit()
    await bus.publish_many(events)
    alert_ids = sorted({e.data["id"] for e in events if e.type in ("alert.raised", "alert.updated")})
    return {"updated": len(rows), "alert_ids": alert_ids}


@router.post("/sos/{sos_id}/resolve", response_model=SosOut, summary="Resolve an SOS (dispatcher role)",
             responses={403: {"model": ErrorResponse}, 404: {"model": ErrorResponse}, 409: {"model": ErrorResponse}})
async def resolve_sos(sos_id: int, dispatcher: Dispatcher = Depends(require_dispatcher),
                      session: AsyncSession = Depends(get_session), lang: str = Depends(language_params)):
    sos = await session.scalar(select(SosSignal).where(SosSignal.id == sos_id).with_for_update())
    if sos is None:
        raise AppError(404, "SOS_NOT_FOUND")
    if sos.status == "resolved":
        raise AppError(409, "SOS_ALREADY_RESOLVED")
    events: EventList = []
    sos.status = "resolved"
    brigade = await session.get(Brigade, sos.assigned_brigade_id) if sos.assigned_brigade_id else None
    if brigade is not None and brigade.status in ("en_route", "on_site"):
        still_open = await session.scalar(select(SosSignal.id).where(
            SosSignal.assigned_brigade_id == brigade.id, SosSignal.status == "assigned",
            SosSignal.id != sos.id).limit(1))
        if still_open is None:  # brigade has nothing left to do here -> drive back to base
            await send_home(session, brigade, events)
    session.add(AuditLog(actor=dispatcher.username, action="sos.resolve", payload={"sos_id": sos.id}))
    await session.flush()
    out = sos_out(sos, brigade, lang)
    events.append(Event("sos.updated", out, citizen_ids=[str(sos.citizen_id)]))
    await add_overview_event(session, events)
    await session.commit()
    await bus.publish_many(events)
    return out
