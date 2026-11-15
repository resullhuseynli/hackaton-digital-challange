"""Per-worker WebSocket registry. Receives every message from the Redis bus and fans it out to the
sockets connected to *this* worker. Also applies worker-to-worker graph sync messages.
Each socket remembers its language (az/en) so localized parts of a payload (labels) are rendered per socket."""
import asyncio
import logging
from collections import defaultdict

from fastapi import WebSocket

from app.config import settings
from app.i18n import DEFAULT_LANG, localize_labels
from app.realtime.events import dumps, now_iso
from app.services.routing import graph

log = logging.getLogger("app.ws")


class WSManager:
    def __init__(self) -> None:
        self.dispatch: dict[WebSocket, str] = {}
        self.citizens: dict[str, dict[WebSocket, str]] = defaultdict(dict)

    # ------------------------------------------------------------ registry
    def add_dispatch(self, ws: WebSocket, lang: str = DEFAULT_LANG) -> None:
        self.dispatch[ws] = lang

    def add_citizen(self, citizen_id: str, ws: WebSocket, lang: str = DEFAULT_LANG) -> None:
        self.citizens[citizen_id][ws] = lang

    def remove(self, ws: WebSocket) -> None:
        self.dispatch.pop(ws, None)
        for cid in [c for c, socks in self.citizens.items() if ws in socks]:
            self.citizens[cid].pop(ws, None)
            if not self.citizens[cid]:
                del self.citizens[cid]

    def all_sockets(self) -> list[WebSocket]:
        return list(self.dispatch) + [ws for socks in self.citizens.values() for ws in socks]

    # ------------------------------------------------------------ delivery
    async def _send(self, ws: WebSocket, text: str) -> None:
        try:
            await ws.send_text(text)
        except Exception:  # noqa: BLE001 - dead socket
            self.remove(ws)

    def _apply_graph_sync(self, msg: dict) -> None:
        if msg["type"] == "road.updated":
            for seg in msg["data"].get("segments", []):
                if seg.get("status") is not None:
                    graph.set_segment(seg["id"], seg["status"], seg["congestion_factor"])
                if "barrier" in seg:
                    graph.set_barrier(seg["id"], seg["barrier"])
        elif msg["type"] == "graph.reset":
            graph.reset()
        elif msg["type"] == "routing.status":
            from app.services.routing_gateway import routing_gateway
            routing_gateway.apply_remote_status(msg["data"])

    async def handle_bus_message(self, msg: dict) -> None:
        self._apply_graph_sync(msg)  # idempotent; keeps every worker's graph in sync
        if msg.get("internal"):
            return
        targets: dict[WebSocket, str] = dict(self.dispatch) if msg.get("dispatch") else {}
        for cid in msg.get("citizen_ids") or []:
            targets.update(self.citizens.get(cid, {}))
        if msg.get("all_citizens"):
            for socks in self.citizens.values():
                targets.update(socks)
        if not targets:
            return
        rendered: dict[str, str] = {}  # one serialization per language
        for lang in set(targets.values()):
            rendered[lang] = dumps({"type": msg["type"], "data": localize_labels(msg["data"], lang), "ts": msg["ts"]})
        await asyncio.gather(*(self._send(ws, rendered[lang]) for ws, lang in targets.items()))

    async def heartbeat_loop(self) -> None:
        while True:
            await asyncio.sleep(settings.ws_heartbeat_sec)
            text = dumps({"type": "ping", "data": {}, "ts": now_iso()})
            sockets = self.all_sockets()
            if sockets:
                await asyncio.gather(*(self._send(ws, text) for ws in sockets))


manager = WSManager()
