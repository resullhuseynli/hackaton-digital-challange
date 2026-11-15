from typing import Literal

from fastapi import APIRouter, Body, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.deps import current_dispatcher, require_dispatcher
from app.models import Alert, Dispatcher
from app.realtime.events import EventList, bus
from app.schemas.common import ErrorResponse
from app.schemas.ops import AlertConfirmIn, AlertDismissIn, AlertOut
from app.services.crisis_engine import confirm_alert, dismiss_alert
from app.i18n import language_params
from app.services.overview import add_overview_event
from app.services.serialize import alert_out

router = APIRouter(prefix="/alerts", tags=["alerts"])
ERRORS = {403: {"model": ErrorResponse}, 404: {"model": ErrorResponse}, 409: {"model": ErrorResponse}}


@router.get("", response_model=list[AlertOut])
async def list_alerts(status: Literal["active", "confirmed", "dismissed"] | None = None,
                      _: Dispatcher = Depends(current_dispatcher), session: AsyncSession = Depends(get_session),
                  lang: str = Depends(language_params)):
    q = select(Alert).order_by(Alert.created_at.desc())
    if status:
        q = q.where(Alert.status == status)
    return [await alert_out(session, a, lang) for a in (await session.scalars(q)).all()]


@router.post("/{alert_id}/confirm", response_model=AlertOut, responses=ERRORS,
             summary="One-click execution of the alert recommendation (single DB transaction)")
async def confirm(alert_id: int, body: AlertConfirmIn | None = Body(None),
                  dispatcher: Dispatcher = Depends(require_dispatcher), session: AsyncSession = Depends(get_session),
                  lang: str = Depends(language_params)):
    body = body or AlertConfirmIn()
    events: EventList = []
    alert = await confirm_alert(session, alert_id, dispatcher.username, events,
                                brigade_id=body.brigade_id, new_point_id=body.new_point_id)
    out = await alert_out(session, alert, lang)
    await add_overview_event(session, events)
    await session.commit()  # everything above is committed atomically, or not at all
    await bus.publish_many(events)
    return out


@router.post("/{alert_id}/dismiss", response_model=AlertOut, responses=ERRORS)
async def dismiss(alert_id: int, body: AlertDismissIn, dispatcher: Dispatcher = Depends(require_dispatcher),
                  session: AsyncSession = Depends(get_session),
                  lang: str = Depends(language_params)):
    events: EventList = []
    alert = await dismiss_alert(session, alert_id, dispatcher.username, body.reason, events)
    out = await alert_out(session, alert, lang)
    await session.commit()
    await bus.publish_many(events)
    return out
