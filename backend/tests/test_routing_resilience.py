"""External map & routing API outage: circuit breaker + local fallback (never crash)."""
import time
import uuid
from types import SimpleNamespace

import httpx
import pytest
import pytest_asyncio
from sqlalchemy import select

from app.models import Route
from app.realtime.ws_manager import WSManager
from app.services import routing as routing_module
from app.services.circuit_breaker import CLOSED, HALF_OPEN, OPEN, CircuitBreaker
from app.services.roads import set_segments_status
from app.services.routing import graph
from app.services.routing_gateway import (CACHE, EXTERNAL, LOCAL, STATIC, ExternalRoutingClient, RouteCache,
                                          routing_gateway)
from mock_routing import main as mock
from tests.conftest import NASIMI, YASAMAL

API = "/api/v1"
FALLBACK_AZ = "Oflayn/Ehtiyat marşrut rejimində işləyir"
FALLBACK_EN = "Running in offline/backup routing mode"
TIMEOUT = 0.3  # stands in for EXTERNAL_ROUTING_TIMEOUT_SEC = 5 to keep the suite fast


class FakeClock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now


@pytest_asyncio.fixture(loop_scope="session")
async def external():
    """Plug the mock third-party provider (mock_routing) into the gateway over ASGI."""
    calls = {"n": 0}
    inner = httpx.ASGITransport(app=mock.app)

    class Counting(httpx.AsyncBaseTransport):
        async def handle_async_request(self, request):
            calls["n"] += 1
            return await inner.handle_async_request(request)

    mock.fault.update(mode="ok", delay_sec=1.0)
    await mock.ensure_graph()  # warm the provider (its first request would otherwise load the graph)
    routing_gateway.client = ExternalRoutingClient("http://mock-provider", "foot", TIMEOUT, Counting())
    routing_gateway.breaker = CircuitBreaker("external-routing", 3, 30)
    routing_gateway.cache = RouteCache()
    yield SimpleNamespace(calls=calls)
    await routing_gateway.stop()
    routing_gateway.breaker = CircuitBreaker("external-routing", 3, 30)
    routing_gateway.cache = RouteCache()
    mock.fault.update(mode="ok")


async def citizen(client, lat=YASAMAL[0], lng=YASAMAL[1]) -> dict:
    device = str(uuid.uuid4())
    await client.post(f"{API}/citizens/register", json={"device_id": device})
    return {"X-Device-Id": device}


async def build_route(client, h, lang="az", lat=YASAMAL[0], lng=YASAMAL[1]):
    best = (await client.get(f"{API}/assembly-points/nearest", params={"lat": lat, "lng": lng})).json()[0]
    return await client.post(f"{API}/citizens/me/route", headers=h | {"Accept-Language": lang},
                             json={"point_id": best["point"]["id"], "lat": lat, "lng": lng})


# ----------------------------------------------------------------------------- circuit breaker unit
def test_circuit_breaker_state_machine():
    clock = FakeClock()
    cb = CircuitBreaker("x", failure_threshold=3, reset_timeout_sec=30, clock=clock)
    assert cb.allow() and cb.state == CLOSED
    assert cb.record_failure("503") is False and cb.record_failure("503") is False
    assert cb.record_failure("503") is True and cb.state == OPEN        # 3rd failure opens
    assert cb.allow() is False                                         # short-circuited
    assert cb.snapshot().retry_in_sec == 30
    clock.now += 30
    assert cb.allow() is True and cb.state == HALF_OPEN                # one trial
    assert cb.allow() is False                                         # only one at a time
    assert cb.record_failure("timeout") is True and cb.state == OPEN   # trial failed -> re-open
    clock.now += 30
    assert cb.allow() and cb.record_success() is True and cb.state == CLOSED
    assert cb.failures == 0


def test_success_resets_failure_count():
    cb = CircuitBreaker("x", 3, 30, clock=FakeClock())
    cb.record_failure("a")
    cb.record_failure("b")
    cb.record_success()
    cb.record_failure("c")
    assert cb.state == CLOSED and cb.failures == 1


# ----------------------------------------------------------------------------- online path
async def test_online_route_comes_from_external_provider(client, external):
    r = await build_route(client, await citizen(client))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["source"] == EXTERNAL and body["routing_status"] == "online" and body["notice"] is None
    assert external.calls["n"] == 1
    status = (await client.get(f"{API}/routing/status")).json()
    assert status["status"] == "online" and status["breaker"]["state"] == "closed"
    assert status["external_configured"] is True and status["notice"] is None


# ----------------------------------------------------------------------------- HTTP 503
async def test_http_503_falls_back_without_crashing_and_opens_breaker(client, external):
    mock.fault.update(mode="error_503")
    h = await citizen(client)
    for i in range(3):
        r = await build_route(client, h)
        assert r.status_code == 200, r.text  # no 5xx / unhandled exception reaches the user
        body = r.json()
        assert body["source"] == LOCAL and body["routing_status"] == "fallback"
        assert body["notice"] == {"code": "ROUTING_FALLBACK", "text": FALLBACK_AZ}
    assert external.calls["n"] == 3
    status = (await client.get(f"{API}/routing/status", headers={"Accept-Language": "en"})).json()
    assert status["status"] == "fallback" and status["breaker"]["state"] == "open"
    assert status["breaker"]["last_error"] == "HTTP 503"
    assert status["notice"] == {"code": "ROUTING_FALLBACK", "text": FALLBACK_EN}

    # breaker is open: no more calls to the broken provider, still served (and localized)
    r = await build_route(client, h, lang="en")
    assert r.status_code == 200 and r.json()["notice"]["text"] == FALLBACK_EN
    assert external.calls["n"] == 3
    # the stored route keeps its fallback flag
    assert (await client.get(f"{API}/citizens/me/route", headers=h)).json()["routing_status"] == "fallback"


# ----------------------------------------------------------------------------- timeout > limit
async def test_timeout_is_cut_at_the_deadline_and_falls_back(client, external):
    mock.fault.update(mode="timeout", delay_sec=2.0)  # provider would answer after 2 s, limit is 0.3 s
    h = await citizen(client)
    t0 = time.perf_counter()
    r = await build_route(client, h)
    elapsed = time.perf_counter() - t0
    assert r.status_code == 200 and r.json()["routing_status"] == "fallback"
    assert elapsed < 1.5, f"request waited {elapsed:.2f}s - the deadline was not enforced"
    assert routing_gateway.breaker.last_error.startswith("timeout")


# ----------------------------------------------------------------------------- recovery
async def test_half_open_trial_recovers_to_online(client, external):
    mock.fault.update(mode="error_503")
    h = await citizen(client)
    for _ in range(3):
        await build_route(client, h)
    assert routing_gateway.breaker.state == OPEN
    mock.fault.update(mode="ok")
    routing_gateway.breaker.opened_at -= 31  # reset timeout elapsed
    events = []
    routed = await routing_gateway.route(None, YASAMAL, NASIMI, events=events)
    assert routed.source == EXTERNAL and routed.degraded is False
    assert routing_gateway.breaker.state == CLOSED
    assert [e.type for e in events] == ["routing.status"] and events[0].data["status"] == "online"


async def test_breaker_transition_is_broadcast_to_everyone(client, external):
    mock.fault.update(mode="error_503")
    events = []
    for _ in range(3):
        await routing_gateway.route(None, YASAMAL, NASIMI, events=events)
    (evt,) = [e for e in events if e.type == "routing.status"]
    assert evt.dispatch is True and evt.all_citizens is True and evt.data["status"] == "fallback"

    class FakeWS:
        def __init__(self):
            self.sent = []

        async def send_text(self, text):
            import json
            self.sent.append(json.loads(text))

    m = WSManager()
    az, en, disp = FakeWS(), FakeWS(), FakeWS()
    m.add_citizen("a", az, "az")
    m.add_citizen("b", en, "en")
    m.add_dispatch(disp, "az")
    await m.handle_bus_message({"type": evt.type, "data": evt.data, "ts": "2026-01-01T00:00:00Z",
                                "dispatch": True, "citizen_ids": None, "internal": False, "all_citizens": True})
    assert az.sent[0]["data"]["notice"]["text"] == FALLBACK_AZ
    assert en.sent[0]["data"]["notice"]["text"] == FALLBACK_EN
    assert disp.sent[0]["type"] == "routing.status"


async def test_other_workers_adopt_the_breaker_state(external):
    m = WSManager()
    await m.handle_bus_message({"type": "routing.status", "ts": "x", "dispatch": True, "citizen_ids": None,
                                "internal": False, "data": {"breaker": {"state": "open", "last_error": "HTTP 503"}}})
    assert routing_gateway.breaker.state == OPEN and routing_gateway.degraded
    await m.handle_bus_message({"type": "routing.status", "ts": "x", "dispatch": True, "citizen_ids": None,
                                "internal": False, "data": {"breaker": {"state": "closed"}}})
    assert routing_gateway.breaker.state == CLOSED


# ----------------------------------------------------------------------------- deeper fallbacks
async def test_cached_route_then_static_matrix_when_local_graph_also_fails(client, external, monkeypatch):
    first = await routing_gateway.route(None, YASAMAL, NASIMI)  # online -> cached
    assert first.source == EXTERNAL
    mock.fault.update(mode="error_503")

    def broken(*args, **kwargs):
        raise RuntimeError("graph corrupted")
    monkeypatch.setattr(routing_module.RoadGraph, "route", broken)

    cached = await routing_gateway.route(None, YASAMAL, NASIMI)
    assert cached.source == CACHE and cached.degraded is True
    assert cached.result.coords == first.result.coords

    static = await routing_gateway.route(None, YASAMAL, (40.3667, 49.8352))  # never routed before
    assert static.source == STATIC and static.degraded is True
    assert static.result.distance_m > 0 and static.result.eta_min > 0 and len(static.result.coords) >= 2


async def test_api_survives_total_routing_failure(client, external, monkeypatch):
    mock.fault.update(mode="error_503")
    monkeypatch.setattr(routing_module.RoadGraph, "route", lambda *a, **k: 1 / 0)
    h = await citizen(client)
    nearest = (await client.get(f"{API}/assembly-points/nearest",
                                params={"lat": YASAMAL[0], "lng": YASAMAL[1]})).json()
    assert nearest and all(i["source"] == "static_matrix" for i in nearest)
    r = await client.post(f"{API}/citizens/me/route", headers=h,
                          json={"point_id": nearest[0]["point"]["id"], "lat": YASAMAL[0], "lng": YASAMAL[1]})
    assert r.status_code == 200, r.text
    assert r.json()["source"] == STATIC and r.json()["notice"]["text"] == FALLBACK_AZ


# ----------------------------------------------------------------------------- safety with external routes
async def test_external_route_over_a_closed_road_is_rejected(client, session, external):
    online = await routing_gateway.route(session, YASAMAL, NASIMI)
    assert online.source == EXTERNAL
    local = graph.route(*YASAMAL, *NASIMI)
    seg = local.segment_ids[len(local.segment_ids) // 2]
    await set_segments_status(session, [seg, graph.twin(seg)], "closed", "test", [])
    again = await routing_gateway.route(session, YASAMAL, NASIMI)
    assert again.source == LOCAL and again.degraded is False  # safety override, not an outage
    assert seg not in again.result.segment_ids


async def test_closure_reroutes_citizens_on_external_routes(client, session, external):
    h = await citizen(client)
    r = (await build_route(client, h)).json()
    assert r["source"] == EXTERNAL
    db_route = await session.get(Route, r["id"])
    assert db_route.segment_ids == []  # provider routes carry geometry only
    # close a local segment lying on that geometry -> matched by geometry
    coords = r["geometry"]["coordinates"]
    (x1, y1), (x2, y2) = coords[len(coords) // 2], coords[len(coords) // 2 + 1]
    seg = graph.by_nodes.get((graph.nearest_nodes(y1, x1, 1)[0][0], graph.nearest_nodes(y2, x2, 1)[0][0]))
    assert seg is not None
    result = await set_segments_status(session, [seg, graph.twin(seg)], "closed", "uçqun", [])
    await session.commit()
    assert result["rerouted"] == 1
    new = (await client.get(f"{API}/citizens/me/route", headers=h)).json()
    assert new["reason"] == "road_closed" and new["version"] == 2


# ----------------------------------------------------------------------------- misc
async def test_overview_and_health_report_routing_mode(client, admin_headers, external):
    mock.fault.update(mode="error_503")
    for _ in range(3):
        await routing_gateway.route(None, YASAMAL, NASIMI)
    ov = (await client.get(f"{API}/dispatch/overview", headers=admin_headers)).json()
    assert ov["routing_status"] == "fallback"
    assert (await client.get("/health")).json()["routing"] == "fallback"


async def test_routing_fault_endpoint_without_provider_is_a_clean_error(client, admin_headers):
    r = await client.post(f"{API}/sim/routing-fault", json={"mode": "error_503"}, headers=admin_headers)
    assert r.status_code == 502 and r.json()["error"]["code"] == "ROUTING_FAULT_UNAVAILABLE"


async def test_without_external_provider_local_graph_is_primary(client):
    assert routing_gateway.external_configured is False
    r = (await build_route(client, await citizen(client))).json()
    assert r["source"] == LOCAL and r["routing_status"] == "online" and r["notice"] is None
    assert (await client.get(f"{API}/routing/status")).json()["status"] == "online"


@pytest.mark.parametrize("status_code", [500, 502, 503, 504])
async def test_any_5xx_counts_as_outage(status_code):
    transport = httpx.MockTransport(lambda req: httpx.Response(status_code, json={"code": "Error"}))
    client = ExternalRoutingClient("http://x", "foot", 1.0, transport)
    from app.services.routing_gateway import ExternalRoutingError
    with pytest.raises(ExternalRoutingError):
        await client.route(YASAMAL, NASIMI, 5.0)
    await client.close()


async def test_no_route_4xx_and_malformed_bodies():
    from app.services.routing_gateway import ExternalRoutingError
    nr = ExternalRoutingClient("http://x", "foot", 1.0, httpx.MockTransport(
        lambda req: httpx.Response(400, json={"code": "NoRoute"})))
    assert await nr.route(YASAMAL, NASIMI, 5.0) is None  # provider is up, just no route: not an outage
    bad = ExternalRoutingClient("http://x", "foot", 1.0, httpx.MockTransport(
        lambda req: httpx.Response(200, text="<html>gateway</html>")))
    with pytest.raises(ExternalRoutingError):
        await bad.route(YASAMAL, NASIMI, 5.0)
    await nr.close()
    await bad.close()
