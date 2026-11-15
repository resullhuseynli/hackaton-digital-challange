"""Resilient routing for the citizen module.

Primary source: external map & routing API (OSRM-compatible, `EXTERNAL_ROUTING_URL`), protected by a
5 s timeout and a circuit breaker. If it fails (HTTP 5xx, timeout, connection error, malformed body)
or the breaker is open, the request is served from the local backup chain - it never raises:

    1. local road graph (NetworkX A*, knows live closures and barriers)
    2. last cached route for the same start cell / destination (Redis, in-memory LRU if Redis is down)
    3. static coordinate matrix (zone centroid -> assembly point road distances precomputed at startup)

Results served while the external API is unavailable are flagged `degraded=True`; the API then shows
the notice "Oflayn/Ehtiyat marşrut rejimində işləyir" (ROUTING_FALLBACK).
"""
import asyncio
import json
import logging
from collections import OrderedDict
from dataclasses import asdict, dataclass

import httpx
import networkx as nx
from geoalchemy2 import Geography
from sqlalchemy import cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.geo import haversine_m, latlng, line_ewkt
from app.models import AssemblyPoint, RoadSegment, Zone
from app.realtime.events import Event, EventList, bus
from app.services.circuit_breaker import CLOSED, OPEN, CircuitBreaker
from app.services.routing import WALK, RouteResult, graph

log = logging.getLogger("app.routing_gateway")

EXTERNAL, LOCAL, CACHE, STATIC = "external", "local_graph", "cache", "static_matrix"
CLOSURE_TOLERANCE_M = 8.0
STATIC_DETOUR_FACTOR = 1.35  # straight line -> street distance when nothing better is known


class ExternalRoutingError(Exception):
    """The external provider is unavailable (counts as a circuit-breaker failure)."""


@dataclass
class RoutedResult:
    result: RouteResult
    source: str        # external | local_graph | cache | static_matrix
    degraded: bool     # served by the backup chain because the external API is unavailable


# --------------------------------------------------------------------------- external client
class ExternalRoutingClient:
    def __init__(self, base_url: str, profile: str, timeout_sec: float,
                 transport: httpx.AsyncBaseTransport | None = None) -> None:
        self.base_url = base_url.rstrip("/")
        self.profile = profile
        self.timeout_sec = timeout_sec
        self._client = httpx.AsyncClient(timeout=httpx.Timeout(timeout_sec), transport=transport)

    async def close(self) -> None:
        await self._client.aclose()

    async def route(self, start: tuple[float, float], end: tuple[float, float], walk_kmh: float) -> RouteResult | None:
        """Returns None when the provider answers but finds no route (4xx NoRoute - not an outage)."""
        url = (f"{self.base_url}/route/v1/{self.profile}/"
               f"{start[1]:.6f},{start[0]:.6f};{end[1]:.6f},{end[0]:.6f}")
        try:
            # hard overall deadline: httpx timeouts are per phase, a slow-trickling server could exceed them
            r = await asyncio.wait_for(
                self._client.get(url, params={"overview": "full", "geometries": "geojson"}), self.timeout_sec)
        except (httpx.TimeoutException, asyncio.TimeoutError) as exc:
            raise ExternalRoutingError(f"timeout after {self.timeout_sec}s") from exc
        except httpx.HTTPError as exc:
            raise ExternalRoutingError(f"transport error: {exc.__class__.__name__}") from exc
        if r.status_code >= 500:
            raise ExternalRoutingError(f"HTTP {r.status_code}")
        if r.status_code >= 400:
            return None
        try:
            body = r.json()
            if body.get("code") != "Ok" or not body.get("routes"):
                return None
            best = body["routes"][0]
            coords = [(float(x), float(y)) for x, y, *_ in best["geometry"]["coordinates"]]
            distance = float(best["distance"])
        except (ValueError, KeyError, TypeError) as exc:
            raise ExternalRoutingError(f"malformed response: {exc.__class__.__name__}") from exc
        if len(coords) < 2:
            raise ExternalRoutingError("malformed response: empty geometry")
        # evacuation ETA is computed with our walking speed, independent of the provider's profile
        return RouteResult([], [], coords, round(distance, 1), distance / (walk_kmh / 3.6), False)


# --------------------------------------------------------------------------- route cache
class RouteCache:
    """Last successful route per (start cell ~100 m, destination, accessible). Redis + in-process LRU."""

    def __init__(self, max_local: int = 2000) -> None:
        self._local: OrderedDict[str, dict] = OrderedDict()
        self._max = max_local

    @staticmethod
    def key(start, end, accessible: bool) -> str:
        return (f"routecache:v1:{int(accessible)}:{start[0]:.3f}:{start[1]:.3f}:"
                f"{end[0]:.4f}:{end[1]:.4f}")

    async def put(self, start, end, accessible: bool, r: RouteResult) -> None:
        k, data = self.key(start, end, accessible), asdict(r)
        self._local[k] = data
        self._local.move_to_end(k)
        while len(self._local) > self._max:
            self._local.popitem(last=False)
        try:
            if bus.redis is not None:
                await bus.redis.set(k, json.dumps(data), ex=settings.route_cache_ttl_sec)
        except Exception as exc:  # noqa: BLE001 - cache is best effort
            log.debug("route cache write failed: %r", exc)

    async def get(self, start, end, accessible: bool) -> RouteResult | None:
        k = self.key(start, end, accessible)
        data = None
        try:
            if bus.redis is not None:
                raw = await bus.redis.get(k)
                data = json.loads(raw) if raw else None
        except Exception as exc:  # noqa: BLE001
            log.debug("route cache read failed: %r", exc)
        data = data or self._local.get(k)
        if not data:
            return None
        data["coords"] = [tuple(c) for c in data["coords"]]
        return RouteResult(**data)


# --------------------------------------------------------------------------- static matrix
class StaticMatrix:
    """Zone-centroid x assembly-point walking distances computed once from the road graph.
    Used only when both the external API and the live graph are unavailable."""

    def __init__(self) -> None:
        self.centroids: list[tuple[int, float, float]] = []
        self.points: dict[int, tuple[float, float]] = {}
        self.dist: dict[tuple[int, int], float] = {}

    async def build(self, session: AsyncSession) -> None:
        self.centroids = [(r[0], r[1], r[2]) for r in (await session.execute(select(
            Zone.id, func.ST_Y(func.ST_Centroid(Zone.polygon)), func.ST_X(func.ST_Centroid(Zone.polygon))))).all()]
        self.points = {p.id: latlng(p.location) for p in (await session.scalars(select(AssemblyPoint))).all()}
        self.dist = {}
        if not graph.loaded or not graph.nodes:
            return
        g = graph.g.to_undirected()
        point_nodes = {pid: graph.nearest_nodes(lat, lng, 1)[0] for pid, (lat, lng) in self.points.items()}
        for zid, zlat, zlng in self.centroids:
            src, src_off = graph.nearest_nodes(zlat, zlng, 1)[0]
            lengths = nx.single_source_dijkstra_path_length(g, src, weight="length_m")
            for pid, (node, off) in point_nodes.items():
                if node in lengths:
                    self.dist[(zid, pid)] = src_off + lengths[node] + off
        log.info("static routing matrix: %d zones x %d points (%d pairs)",
                 len(self.centroids), len(self.points), len(self.dist))

    def estimate(self, start, end, accessible: bool) -> RouteResult:
        kmh = settings.accessible_walk_speed_kmh if accessible else settings.walk_speed_kmh
        point_id = next((pid for pid, (lat, lng) in self.points.items()
                         if haversine_m(lat, lng, end[0], end[1]) < 50), None)
        coords = [(start[1], start[0]), (end[1], end[0])]
        distance = haversine_m(*start, *end) * STATIC_DETOUR_FACTOR
        if point_id is not None and self.centroids:
            zid, zlat, zlng = min(self.centroids, key=lambda c: haversine_m(start[0], start[1], c[1], c[2]))
            if (zid, point_id) in self.dist:
                via = haversine_m(start[0], start[1], zlat, zlng) * STATIC_DETOUR_FACTOR + self.dist[(zid, point_id)]
                if via < distance * 1.6:  # use the matrix unless going via the centroid is a big detour
                    distance = via
                    coords = [(start[1], start[0]), (zlng, zlat), (end[1], end[0])]
        # step-free cannot be guaranteed for an estimate
        return RouteResult([], [], coords, round(distance, 1), distance / (kmh / 3.6), False)


# --------------------------------------------------------------------------- gateway
class RoutingGateway:
    def __init__(self) -> None:
        self.breaker = CircuitBreaker("external-routing", settings.routing_cb_failure_threshold,
                                      settings.routing_cb_reset_sec)
        self.client: ExternalRoutingClient | None = None
        self.cache = RouteCache()
        self.matrix = StaticMatrix()

    # lifecycle
    def start(self, transport: httpx.AsyncBaseTransport | None = None) -> None:
        if settings.external_routing_url:
            self.client = ExternalRoutingClient(settings.external_routing_url, settings.external_routing_profile,
                                                settings.external_routing_timeout_sec, transport)

    async def stop(self) -> None:
        if self.client is not None:
            await self.client.close()
            self.client = None

    @property
    def external_configured(self) -> bool:
        return self.client is not None

    @property
    def degraded(self) -> bool:
        return self.external_configured and self.breaker.state != CLOSED

    def status(self) -> dict:
        snap = self.breaker.snapshot()
        return {"status": "fallback" if self.degraded else "online",
                "external_configured": self.external_configured,
                "breaker": {"state": snap.state, "failures": snap.failures, "last_error": snap.last_error,
                            "retry_in_sec": snap.retry_in_sec},
                "fallback_chain": [LOCAL, CACHE, STATIC],
                "notice": {"code": "ROUTING_FALLBACK", "text": ""} if self.degraded else None}

    def _status_event(self) -> Event:
        return Event("routing.status", self.status(), dispatch=True, all_citizens=True)

    # main entry point
    async def route(self, session: AsyncSession | None, start: tuple[float, float], end: tuple[float, float], *,
                    accessible: bool = False, events: EventList | None = None) -> RoutedResult | None:
        """Never raises for provider/graph failures. Returns None only when the live local graph
        positively finds no path (e.g. every road is closed) - a real "no route", not an outage."""
        events = events if events is not None else []
        external_failed = False

        # 1) external provider (skipped for step-free requests: it has no data on stairs/barriers)
        if self.client is not None and not accessible:
            if self.breaker.allow():
                try:
                    walk = settings.walk_speed_kmh
                    ext = await self.client.route(start, end, walk)
                    if self.breaker.record_success():
                        log.warning("external routing recovered -> online mode")
                        events.append(self._status_event())
                    if ext is not None and not await self._crosses_closure(session, ext.coords):
                        await self.cache.put(start, end, False, ext)
                        return RoutedResult(ext, EXTERNAL, False)
                except ExternalRoutingError as exc:
                    external_failed = True
                    log.warning("external routing failed: %s", exc)
                    if self.breaker.record_failure(str(exc)):
                        log.error("circuit breaker OPEN for external routing (%s) -> fallback mode", exc)
                        events.append(self._status_event())
                except Exception as exc:  # noqa: BLE001 - never let the citizen request crash
                    external_failed = True
                    log.exception("unexpected external routing error")
                    if self.breaker.record_failure(f"unexpected: {exc.__class__.__name__}"):
                        events.append(self._status_event())
            else:
                external_failed = True  # short-circuited by the open breaker
        degraded = external_failed or self.degraded

        # 2) live local road graph
        try:
            if graph.loaded:
                local = graph.route(start[0], start[1], end[0], end[1], WALK, accessible=accessible)
                if local is None:
                    return None
                await self.cache.put(start, end, accessible, local)
                return RoutedResult(local, LOCAL, degraded)
        except Exception:  # noqa: BLE001
            log.exception("local graph routing failed; trying cache/static matrix")

        # 3) last cached route, 4) static coordinate matrix
        cached = await self.cache.get(start, end, accessible)
        if cached is not None:
            return RoutedResult(cached, CACHE, True)
        return RoutedResult(self.matrix.estimate(start, end, accessible), STATIC, True)

    async def _crosses_closure(self, session: AsyncSession, coords) -> bool:
        """The external provider doesn't know our live incidents: reject routes over closed roads."""
        q = select(RoadSegment.id).where(
            RoadSegment.status == "closed",
            func.ST_DWithin(cast(RoadSegment.geometry, Geography),
                            cast(func.ST_GeomFromEWKT(line_ewkt(coords)), Geography), CLOSURE_TOLERANCE_M),
        ).limit(1)
        try:
            if session is None:
                from app.db import SessionLocal
                async with SessionLocal() as own:
                    return await own.scalar(q) is not None
            return await session.scalar(q) is not None
        except Exception:  # noqa: BLE001
            log.exception("closure check failed; using local graph")
            return True

    def apply_remote_status(self, data: dict) -> None:
        """Another worker announced a breaker transition (via Redis pub/sub)."""
        state = (data.get("breaker") or {}).get("state")
        if state in (OPEN, CLOSED):
            self.breaker.force(state, (data.get("breaker") or {}).get("last_error"))


routing_gateway = RoutingGateway()
