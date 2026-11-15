import asyncio
import contextlib
import logging
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1 import api_router
from app.config import settings
from app.db import SessionLocal, warm_pool
from app.errors import install_error_handlers
from app.i18n import lang_of
from app.realtime.events import bus
from app.realtime.ws_manager import manager
from app.realtime.ws_routes import router as ws_router
from app.services.routing import graph
from app.services.routing_gateway import routing_gateway

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("app")


@asynccontextmanager
async def lifespan(_: FastAPI):
    await bus.connect()
    async with SessionLocal() as session:
        await graph.load(session)
        log.info("road graph loaded: %d nodes, %d edges", graph.g.number_of_nodes(), graph.g.number_of_edges())
        await routing_gateway.matrix.build(session)  # static backup matrix for the routing fallback
    routing_gateway.start()
    log.info("external routing API: %s", settings.external_routing_url or "disabled (local graph is primary)")
    await warm_pool()
    tasks = [asyncio.create_task(bus.listen(manager.handle_bus_message), name="bus-listener"),
             asyncio.create_task(manager.heartbeat_loop(), name="ws-heartbeat")]
    tasks += background_tasks()
    yield
    for t in tasks:
        t.cancel()
    for t in tasks:
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await t
    await routing_gateway.stop()
    await bus.close()


def background_tasks() -> list[asyncio.Task]:
    """Crisis-queue consumers (always, when async evaluation is on) and periodic jobs (priority recompute,
    brigade movement, queue safety net; disabled in tests)."""
    from app.services import crisis_queue
    tasks = [asyncio.create_task(c) for c in crisis_queue.consumers()] if settings.crisis_async else []
    if settings.enable_background_tasks:
        from app.services.jobs import background_coroutines
        tasks += [asyncio.create_task(c) for c in background_coroutines()]
    return tasks


app = FastAPI(
    title="Baku Evacuation & Dispatch API",
    version="1.0.0",
    description="Emergency evacuation and dispatch platform for Baku. Citizens identify with the "
                "`X-Device-Id` header; dispatcher endpoints require a JWT from `POST /api/v1/auth/login`.\n\n"
                "**Localization:** messages are returned in Azerbaijani (`az`, default) or English (`en`). "
                "Choose with the `Accept-Language` header or the `?lang=` query parameter (which wins). "
                "Error `code` values are language-independent.",
    lifespan=lifespan,
)
# expose_headers: the browser panel/PWA must read these (duplicate merge, idempotent replay, rate limits).
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origin_list, allow_credentials=True,
                   allow_methods=["*"], allow_headers=["*"],
                   expose_headers=["X-Duplicate-Of", "Idempotent-Replay", "Retry-After", "X-Total-Count"])
install_error_handlers(app)


class ContentLanguageMiddleware:
    """Pure ASGI (no BaseHTTPMiddleware task per request - matters under SOS floods).
    Adds Content-Language/Vary and `Server-Timing: app;dur=<ms>` (server-side processing time)."""

    def __init__(self, app_):
        self.app = app_

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        lang = lang_of(Request(scope)).encode()
        started = time.perf_counter()

        async def send_wrapper(message):
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", []))
                names = {k.lower() for k, _ in headers}
                if b"content-language" not in names:
                    headers.append((b"content-language", lang))
                if b"vary" not in names:
                    headers.append((b"vary", b"Accept-Language"))
                headers.append((b"server-timing", f"app;dur={(time.perf_counter() - started) * 1000:.1f}".encode()))
                message = {**message, "headers": headers}
            await send(message)

        await self.app(scope, receive, send_wrapper)


app.add_middleware(ContentLanguageMiddleware)


app.include_router(api_router)
app.include_router(ws_router)


@app.get("/health", tags=["meta"])
async def health():
    return {"status": "ok", "graph_nodes": graph.g.number_of_nodes(), "graph_edges": graph.g.number_of_edges(),
            "routing": routing_gateway.status()["status"]}
