"""Redis pub/sub event bus.

Services never write to sockets directly: they append `Event`s to a list while working inside a DB
transaction, and the caller publishes them after commit. Every API worker subscribes to the same
channel and fans messages out to its own WebSocket connections (see ws_manager), so events reach
clients regardless of which worker produced them.
"""
import json
import logging
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlparse

import redis.asyncio as aioredis

from app.config import settings

log = logging.getLogger("app.events")


def _channel_for(redis_url: str) -> str:
    """Pub/sub channels are global across Redis DB numbers, so namespace the channel by the DB index:
    a test run (DB 15) must never reach the dev server's workers (DB 0) and mutate their road graph."""
    db = (urlparse(redis_url).path or "/0").lstrip("/") or "0"
    return f"baku:events:{db}"


CHANNEL = _channel_for(settings.redis_url)


@dataclass
class Event:
    type: str
    data: dict
    dispatch: bool = True                 # deliver to /ws/dispatch
    citizen_ids: list[str] | None = None  # deliver to these citizens' /ws/citizen sockets
    internal: bool = False                # worker-to-worker only (e.g. graph sync), never sent to clients
    all_citizens: bool = False            # deliver to every connected citizen socket (system notices)


EventList = list[Event]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _json_default(o: Any):
    if isinstance(o, uuid.UUID):
        return str(o)
    if isinstance(o, datetime):
        return o.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    raise TypeError(f"not serializable: {type(o)}")


def dumps(obj: Any) -> str:
    return json.dumps(obj, default=_json_default, ensure_ascii=False)


class EventBus:
    def __init__(self) -> None:
        self.redis: aioredis.Redis | None = None

    async def connect(self, url: str | None = None) -> None:
        # bounded, reused connections: a flood must not open hundreds of new Redis sockets per worker
        pool = aioredis.BlockingConnectionPool.from_url(
            url or settings.redis_url, decode_responses=True, max_connections=settings.redis_max_connections,
            timeout=5)
        self.redis = aioredis.Redis(connection_pool=pool)

    async def close(self) -> None:
        if self.redis is not None:
            await self.redis.aclose()
            self.redis = None

    async def publish(self, event: Event) -> None:
        if self.redis is None:
            log.warning("event bus not connected; dropping %s", event.type)
            return
        message = {"type": event.type, "data": event.data, "ts": now_iso(), "dispatch": event.dispatch,
                   "citizen_ids": [str(c) for c in event.citizen_ids] if event.citizen_ids else None,
                   "internal": event.internal, "all_citizens": event.all_citizens}
        await self.redis.publish(CHANNEL, dumps(message))

    async def publish_many(self, events: EventList) -> None:
        for e in events:
            await self.publish(e)

    async def listen(self, handler) -> None:
        """Blocking loop: forwards every bus message to `handler(dict)`."""
        assert self.redis is not None
        pubsub = self.redis.pubsub()
        await pubsub.subscribe(CHANNEL)
        try:
            async for msg in pubsub.listen():
                if msg.get("type") != "message":
                    continue
                try:
                    await handler(json.loads(msg["data"]))
                except Exception:  # noqa: BLE001 - one bad message must not kill the listener
                    log.exception("event handler failed")
        finally:
            await pubsub.aclose()


bus = EventBus()
