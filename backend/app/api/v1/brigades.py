from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.deps import current_dispatcher, require_dispatcher
from app.errors import AppError
from app.models import AuditLog, Brigade, Dispatcher, SosSignal
from app.realtime.events import Event, EventList, bus
from app.schemas.common import ErrorResponse
from app.schemas.ops import AssignIn, BrigadeOut
from app.services.brigade_sim import dispatch_brigade
from app.services.serialize import brigade_out, sos_out

router = APIRouter(prefix="/brigades", tags=["brigades"])


@router.get("", response_model=list[BrigadeOut])
async def list_brigades(_: Dispatcher = Depends(current_dispatcher), session: AsyncSession = Depends(get_session)):
    return [brigade_out(b) for b in (await session.scalars(select(Brigade).order_by(Brigade.id))).all()]


@router.post("/{brigade_id}/assign", response_model=BrigadeOut,
             summary="Send a brigade to an SOS (dispatcher role)",
             responses={403: {"model": ErrorResponse}, 404: {"model": ErrorResponse}, 409: {"model": ErrorResponse}})
async def assign(brigade_id: int, body: AssignIn, dispatcher: Dispatcher = Depends(require_dispatcher),
                 session: AsyncSession = Depends(get_session)):
    brigade = await session.scalar(select(Brigade).where(Brigade.id == brigade_id).with_for_update())
    if brigade is None:
        raise AppError(404, "BRIGADE_NOT_FOUND")
    if brigade.status != "idle":
        raise AppError(409, "BRIGADE_BUSY")
    sos = await session.scalar(select(SosSignal).where(SosSignal.id == body.sos_id).with_for_update())
    if sos is None:
        raise AppError(404, "SOS_NOT_FOUND")
    if sos.status == "resolved":
        raise AppError(409, "SOS_ALREADY_RESOLVED")
    events: EventList = []
    await dispatch_brigade(session, brigade, sos, events)
    sos.status = "assigned"
    sos.assigned_brigade_id = brigade.id
    session.add(AuditLog(actor=dispatcher.username, action="brigade.assign",
                         payload={"brigade_id": brigade.id, "sos_id": sos.id}))
    await session.flush()
    events.append(Event("sos.updated", sos_out(sos, brigade), citizen_ids=[str(sos.citizen_id)]))
    out = brigade_out(brigade)
    await session.commit()
    await bus.publish_many(events)
    return out
