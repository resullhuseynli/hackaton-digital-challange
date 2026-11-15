from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect
from sqlalchemy import select

from app.db import SessionLocal
from app.deps import dispatcher_from_token
from app.i18n import lang_of, t
from app.models import Citizen
from app.realtime.events import dumps, now_iso
from app.realtime.ws_manager import manager

router = APIRouter()


async def _pump(ws: WebSocket) -> None:
    """Keep the socket open; answer client pings."""
    try:
        while True:
            msg = await ws.receive_text()
            if msg.strip().lower() in ("ping", '{"type":"ping"}'):
                await ws.send_text(dumps({"type": "pong", "data": {}, "ts": now_iso()}))
    except WebSocketDisconnect:
        pass
    finally:
        manager.remove(ws)


@router.websocket("/ws/citizen")
async def ws_citizen(ws: WebSocket, device_id: str = Query(...)):
    async with SessionLocal() as session:
        citizen = await session.scalar(select(Citizen).where(Citizen.device_id == device_id))
    if citizen is None:
        await ws.close(code=4401, reason=t("CITIZEN_NOT_REGISTERED", lang_of(ws)))
        return
    await ws.accept()
    manager.add_citizen(str(citizen.id), ws, lang_of(ws))
    await ws.send_text(dumps({"type": "connected", "data": {"citizen_id": str(citizen.id)}, "ts": now_iso()}))
    await _pump(ws)


@router.websocket("/ws/dispatch")
async def ws_dispatch(ws: WebSocket, token: str = Query(...)):
    async with SessionLocal() as session:
        dispatcher = await dispatcher_from_token(token, session)
    if dispatcher is None:
        await ws.close(code=4401, reason=t("INVALID_TOKEN", lang_of(ws)))
        return
    await ws.accept()
    manager.add_dispatch(ws, lang_of(ws))
    await ws.send_text(dumps({"type": "connected", "data": {"dispatcher": dispatcher.username}, "ts": now_iso()}))
    await _pump(ws)
