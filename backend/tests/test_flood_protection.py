"""SOS flood / spam attack: rate limiting, duplicates, quarantine, RBAC, JWT hardening, latency."""
import asyncio
import statistics
import time
import uuid
from datetime import datetime, timedelta, timezone

import httpx
import jwt
import pytest
import pytest_asyncio
from sqlalchemy import func, select, update

from app.config import settings
from app.main import app
from app.models import Alert, Citizen, Dispatcher, SosSignal
from app.realtime.events import bus
from tests.conftest import project

API = "/api/v1"
CENTER = (40.3960, 49.7950)  # Yasamal


@pytest.fixture
def limits(monkeypatch):
    """Tighten abuse limits for one test (the suite default is relaxed)."""
    def apply(**kw):
        for k, v in kw.items():
            monkeypatch.setattr(settings, k, v)
    return apply


def client_from(ip: str) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app, client=(ip, 40000)), base_url="http://test")


async def register(c: httpx.AsyncClient, impaired: bool = False) -> dict:
    device = str(uuid.uuid4())
    r = await c.post(f"{API}/citizens/register", json={"device_id": device, "mobility_impaired": impaired})
    assert r.status_code == 200, r.text
    return {"X-Device-Id": device}


async def age_device(session, h: dict, minutes: int = 30) -> None:
    await session.execute(update(Citizen).where(Citizen.device_id == h["X-Device-Id"])
                          .values(created_at=datetime.now(timezone.utc) - timedelta(minutes=minutes)))
    await session.commit()


async def sos(c, h, lat, lng, type_="collapse", **headers):
    return await c.post(f"{API}/sos", json={"type": type_, "lat": lat, "lng": lng}, headers=h | headers)


async def token_for(c, username: str, password: str) -> dict:
    r = await c.post(f"{API}/auth/login", json={"username": username, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest_asyncio.fixture(loop_scope="session")
async def roles(client):
    return {"operator": await token_for(client, "operator", "operator123"),
            "dispatcher": await token_for(client, "dispatcher", "dispatcher123"),
            "admin": await token_for(client, "admin", "admin123")}


# ----------------------------------------------------------------------------- rate limiting
async def test_sos_rate_limit_per_ip(session, limits):
    limits(rate_sos_per_ip_per_min=3)
    async with client_from("10.0.0.1") as bot, client_from("10.0.0.2") as other:
        codes = []
        for i in range(4):
            h = await register(bot)
            r = await sos(bot, h, 40.38 + i * 0.002, 49.84)
            codes.append(r.status_code)
        assert codes == [201, 201, 201, 429]
        assert r.json()["error"]["code"] == "RATE_LIMITED" and int(r.headers["Retry-After"]) >= 1
        assert "saniyə sonra yenidən cəhd edin" in r.json()["error"]["message"]
        assert (await sos(other, await register(other), 40.39, 49.84)).status_code == 201  # other IPs unaffected
    assert await session.scalar(select(func.count()).select_from(SosSignal)) == 4


async def test_registration_rate_limit_per_ip(limits):
    limits(rate_register_per_ip_per_min=2)
    async with client_from("10.0.0.3") as bot:
        codes = [(await bot.post(f"{API}/citizens/register", json={"device_id": str(uuid.uuid4())})).status_code
                 for _ in range(3)]
    assert codes == [200, 200, 429]


# ----------------------------------------------------------------------------- duplicates
async def test_idempotency_key_replays_the_same_sos(client, session):
    h = await register(client)
    first = await sos(client, h, 40.38, 49.84, **{"Idempotency-Key": "k-1"})
    again = await sos(client, h, 40.38, 49.84, **{"Idempotency-Key": "k-1"})  # within cooldown: still a replay
    assert first.status_code == 201 and again.status_code == 200
    assert again.headers["Idempotent-Replay"] == "true" and again.json()["id"] == first.json()["id"]
    assert await session.scalar(select(func.count()).select_from(SosSignal)) == 1


async def test_identical_reports_from_same_ip_are_merged(session):
    async with client_from("10.0.0.4") as nat, client_from("10.0.0.5") as elsewhere:
        a = await nat.post(f"{API}/sos", json={"type": "collapse", "lat": 40.38, "lng": 49.84, "note": "3-cü mərtəbə"},
                           headers=await register(nat))
        second = await register(nat)
        b = await sos(nat, second, 40.38001, 49.84001)  # same ~11 m cell, other device
        assert a.status_code == 201 and b.status_code == 200
        assert b.headers["X-Duplicate-Of"] == str(a.json()["id"]) and b.json()["id"] == a.json()["id"]
        # no leak of the first reporter: the response carries the caller's own id and no note
        me = (await nat.post(f"{API}/citizens/register", json={"device_id": second["X-Device-Id"]})).json()
        assert b.json()["citizen_id"] == me["id"] != a.json()["citizen_id"] and b.json()["note"] is None
        c = await sos(elsewhere, await register(elsewhere), 40.38, 49.84)  # different IP -> separate report
        assert c.status_code == 201
    original = await session.get(SosSignal, a.json()["id"])
    assert original.duplicate_count == 1
    assert await session.scalar(select(func.count()).select_from(SosSignal)) == 2


# ----------------------------------------------------------------------------- quarantine
async def test_bot_farm_is_quarantined_and_cannot_block_the_panel(session, limits, admin_headers, client):
    limits(spam_reg_per_ip_10min=3)
    async with client_from("10.6.6.6") as bot, client_from("10.0.0.7") as citizen_net:
        bots = [await register(bot, impaired=(i == 0)) for i in range(6)]  # one bot ticks the mobility box
        for i, h in enumerate(bots):
            lat, lng = await project(session, *CENTER, 60.0 * i, 45)
            assert (await sos(bot, h, lat, lng)).status_code == 201  # bots get no hint
        legit = await register(citizen_net)
        await age_device(session, legit)
        real = (await sos(citizen_net, legit, 40.4450, 49.9500, "flood")).json()

    queue = (await client.get(f"{API}/sos", headers=admin_headers)).json()
    assert [s["id"] for s in queue] == [real["id"]]  # the panel only shows the real SOS
    quarantined = (await client.get(f"{API}/sos", params={"suspected_only": "true"}, headers=admin_headers)).json()
    assert len(quarantined) == 6
    assert all(s["is_suspected"] and s["suspicion_reason"] == "ip_mass_registration" for s in quarantined)
    assert all(s["labels"][0]["code"] == "SUSPECTED_SPAM" for s in quarantined)
    # a bot with the mobility checkbox is NOT Priority #1
    mixed = (await client.get(f"{API}/sos", params={"include_suspected": "true"}, headers=admin_headers)).json()
    assert mixed[0]["id"] == real["id"]
    # 6 distinct "citizens" within 300 m did not trigger a RED ALERT
    assert await session.scalar(select(func.count()).select_from(Alert)) == 0
    ov = (await client.get(f"{API}/dispatch/overview", headers=admin_headers)).json()
    assert ov["suspected_sos"] == 6 and ov["active_sos"] == 1 and ov["citizens_in_danger"] == 1


async def test_established_devices_are_never_quarantined(session, limits):
    limits(spam_reg_per_ip_10min=1)
    async with client_from("10.6.6.7") as shared_ip:
        for _ in range(3):
            await register(shared_ip)
        old = await register(shared_ip)
        await age_device(session, old)
        r = await sos(shared_ip, old, 40.38, 49.84)
    assert (await session.get(SosSignal, r.json()["id"])).is_suspected is False


async def test_flood_mode_quarantines_new_devices_from_many_ips(session, limits):
    limits(spam_flood_sos_per_10s=5)
    flagged = []
    for i in range(8):
        async with client_from(f"10.8.0.{i}") as c:
            r = await sos(c, await register(c), 40.38 + i * 0.003, 49.84)
            flagged.append((await session.get(SosSignal, r.json()["id"])).suspicion_reason)
    assert flagged[:5] == [None] * 5 and set(flagged[5:]) == {"flood_new_device"}
    async with client_from("10.8.1.1") as c:  # an established user during the flood
        h = await register(c)
        await age_device(session, h)
        r = await sos(c, h, 40.41, 49.86)
    session.expire_all()
    assert (await session.get(SosSignal, r.json()["id"])).is_suspected is False


async def test_review_releases_genuine_and_rejects_spam(session, limits, client, roles):
    limits(spam_reg_per_ip_10min=1)
    async with client_from("10.6.6.8") as bot:
        hs = [await register(bot) for _ in range(6)]
        ids = []
        for i, h in enumerate(hs):
            lat, lng = await project(session, *CENTER, 60.0 * i, 45)
            ids.append((await sos(bot, h, lat, lng)).json()["id"])
    r = await client.post(f"{API}/sos/review", json={"sos_ids": ids[:4], "verdict": "genuine"},
                          headers=roles["operator"])
    assert r.status_code == 403 and r.json()["error"]["code"] == "INSUFFICIENT_ROLE"
    r = await client.post(f"{API}/sos/review", json={"sos_ids": ids[:4], "verdict": "genuine"},
                          headers=roles["dispatcher"])
    assert r.status_code == 200 and r.json()["updated"] == 4 and len(r.json()["alert_ids"]) == 1  # now it counts
    r = await client.post(f"{API}/sos/review", json={"sos_ids": ids[4:], "verdict": "spam"},
                          headers=roles["dispatcher"])
    assert r.json()["updated"] == 2
    queue = (await client.get(f"{API}/sos", params={"include_suspected": "true"}, headers=roles["operator"])).json()
    assert sorted(s["id"] for s in queue) == sorted(ids[:4])
    rejected = (await client.get(f"{API}/sos", params={"status": "rejected", "include_suspected": "true"},
                                 headers=roles["operator"])).json()
    assert sorted(s["id"] for s in rejected) == sorted(ids[4:])


async def test_quarantine_sends_one_aggregated_event(session, limits, monkeypatch):
    limits(spam_reg_per_ip_10min=1)
    published = []
    original = bus.publish_many

    async def capture(events):
        published.extend(events)
        await original(events)
    monkeypatch.setattr(bus, "publish_many", capture)
    async with client_from("10.6.6.9") as bot:
        hs = [await register(bot) for _ in range(5)]
        for i, h in enumerate(hs):
            await sos(bot, h, 40.38 + i * 0.002, 49.84)
    types = [e.type for e in published]
    assert "sos.created" not in types
    assert types.count("sos.suspected") == 1  # throttled: one notification for the whole burst


# ----------------------------------------------------------------------------- RBAC
async def test_role_matrix(client, roles):
    op, disp, adm = roles["operator"], roles["dispatcher"], roles["admin"]
    h = await register(client)
    s = (await sos(client, h, 40.38, 49.84)).json()
    for path in ("/sos", "/dispatch/overview", "/brigades", "/alerts", "/dispatch/timeseries"):
        assert (await client.get(f"{API}{path}", headers=op)).status_code == 200, path

    r = await client.post(f"{API}/brigades/1/assign", json={"sos_id": s["id"]}, headers=op)
    assert r.status_code == 403
    assert r.json()["error"] == {"code": "INSUFFICIENT_ROLE",
                                 "message": "Bu əməliyyat üçün səlahiyyətiniz çatmır (dispatcher rolu tələb olunur)."}
    assert (await client.post(f"{API}/sos/{s['id']}/resolve", headers=op)).status_code == 403
    assert (await client.post(f"{API}/alerts/1/confirm", headers=op)).status_code == 403
    assert (await client.post(f"{API}/alerts/1/dismiss", json={"reason": "x"}, headers=op)).status_code == 403
    assert (await client.post(f"{API}/sim/reset", headers=op)).status_code == 403

    assert (await client.post(f"{API}/brigades/1/assign", json={"sos_id": s["id"]}, headers=disp)).status_code == 200
    r = await client.post(f"{API}/sim/reset", headers=disp | {"Accept-Language": "en"})
    assert r.status_code == 403 and "requires role: admin" in r.json()["error"]["message"]
    assert (await client.post(f"{API}/sim/reset", headers=adm)).status_code == 200


async def test_login_returns_role(client):
    r = await client.post(f"{API}/auth/login", json={"username": "operator", "password": "operator123"})
    body = r.json()
    assert body["role"] == "operator" and body["expires_in"] == settings.jwt_expire_minutes * 60
    claims = jwt.decode(body["access_token"], options={"verify_signature": False})
    assert {"sub", "role", "iat", "exp", "iss", "aud", "jti"} <= set(claims)


def _forge(**overrides) -> str:
    now = datetime.now(timezone.utc)
    claims = {"sub": "operator", "role": "admin", "iat": now, "exp": now + timedelta(hours=1),
              "iss": settings.jwt_issuer, "aud": settings.jwt_audience} | overrides
    secret = claims.pop("_secret", settings.jwt_secret)
    alg = claims.pop("_alg", "HS256")
    return jwt.encode(claims, secret if alg != "none" else None, algorithm=alg)


@pytest.mark.parametrize("token", [
    pytest.param(lambda: _forge(_secret="attacker-secret"), id="wrong-secret"),
    pytest.param(lambda: _forge(role="admin"), id="role-escalation-not-matching-db"),
    pytest.param(lambda: _forge(aud="other-app", role="operator"), id="wrong-audience"),
    pytest.param(lambda: _forge(iss="evil", role="operator"), id="wrong-issuer"),
    pytest.param(lambda: _forge(exp=datetime.now(timezone.utc) - timedelta(seconds=1), role="operator"),
                 id="expired"),
    pytest.param(lambda: _forge(_alg="none", role="operator"), id="alg-none"),
])
async def test_forged_tokens_are_rejected(client, token):
    r = await client.get(f"{API}/sos", headers={"Authorization": f"Bearer {token()}"})
    assert r.status_code == 401 and r.json()["error"]["code"] == "UNAUTHORIZED"


async def test_demoted_or_disabled_user_loses_access_immediately(client, session):
    tok = await token_for(client, "dispatcher", "dispatcher123")
    await session.execute(update(Dispatcher).where(Dispatcher.username == "dispatcher").values(role="operator"))
    await session.commit()
    try:
        assert (await client.get(f"{API}/sos", headers=tok)).status_code == 401  # stale role in token
        op_tok = await token_for(client, "dispatcher", "dispatcher123")
        assert (await client.get(f"{API}/sos", headers=op_tok)).status_code == 200
        await session.execute(update(Dispatcher).where(Dispatcher.username == "dispatcher").values(is_active=False))
        await session.commit()
        assert (await client.get(f"{API}/sos", headers=op_tok)).status_code == 401
        r = await client.post(f"{API}/auth/login", json={"username": "dispatcher", "password": "dispatcher123"})
        assert r.status_code == 401
    finally:
        await session.execute(update(Dispatcher).where(Dispatcher.username == "dispatcher")
                              .values(role="dispatcher", is_active=True))
        await session.commit()


async def test_login_brute_force_lock(client):
    async with client_from("10.9.9.9") as attacker:
        for _ in range(settings.login_max_failures):
            r = await attacker.post(f"{API}/auth/login", json={"username": "admin", "password": "guess"})
            assert r.status_code == 401
        r = await attacker.post(f"{API}/auth/login", json={"username": "admin", "password": "admin123"})
        assert r.status_code == 429 and r.json()["error"]["code"] == "LOGIN_LOCKED" and "Retry-After" in r.headers
    # the real admin on another network is not locked out
    assert (await client.post(f"{API}/auth/login", json={"username": "admin", "password": "admin123"})).status_code == 200


# ----------------------------------------------------------------------------- async crisis queue
async def test_async_crisis_queue_evaluates_off_the_request_path(client, session, admin_headers, monkeypatch):
    from app.services import crisis_queue
    monkeypatch.setattr(settings, "crisis_async", True)
    ids = []
    for i in range(4):
        lat, lng = await project(session, *CENTER, 50.0 * i, 30)
        r = await sos(client, await register(client), lat, lng)
        assert r.status_code == 201
        ids.append(r.json()["id"])
    # stored and announced, but the crisis engine has not run inside the requests
    assert (await client.get(f"{API}/alerts", headers=admin_headers)).json() == []
    assert await bus.redis.llen(crisis_queue.QUEUE) == 4
    assert await crisis_queue.drain() == 4
    alerts = (await client.get(f"{API}/alerts", headers=admin_headers)).json()
    assert len(alerts) == 1 and sorted(alerts[0]["sos_ids"]) == sorted(ids)
    session.expire_all()
    rows = (await session.scalars(select(SosSignal).where(SosSignal.id.in_(ids)))).all()
    assert all(s.evaluated_at is not None for s in rows)
    assert all(s.priority_score >= 40 + 15 for s in rows)  # refined priority (collapse + alert in zone)
    assert await crisis_queue.drain() == 0  # idempotent


async def test_lost_queue_items_are_requeued_by_the_safety_net(client, session, monkeypatch):
    from app.services import crisis_queue
    monkeypatch.setattr(settings, "crisis_async", True)
    r = await sos(client, await register(client), 40.38, 49.84)
    await bus.redis.delete(crisis_queue.QUEUE)  # simulate a worker crash: the item is gone
    await session.execute(update(SosSignal).where(SosSignal.id == r.json()["id"])
                          .values(created_at=datetime.now(timezone.utc) - timedelta(seconds=30)))
    await session.commit()
    assert await crisis_queue.requeue_stale(session) == 1
    assert await crisis_queue.drain() == 1
    session.expire_all()
    assert (await session.get(SosSignal, r.json()["id"])).evaluated_at is not None


async def test_queue_outage_falls_back_to_inline_evaluation(client, session, monkeypatch):
    from app.services import crisis_queue
    monkeypatch.setattr(settings, "crisis_async", True)

    async def broken(ids):
        return False
    monkeypatch.setattr(crisis_queue, "enqueue", broken)
    r = await sos(client, await register(client), 40.38, 49.84)
    session.expire_all()
    assert (await session.get(SosSignal, r.json()["id"])).evaluated_at is not None


# ----------------------------------------------------------------------------- latency under flood
async def test_flood_of_500_requests_keeps_average_latency_below_300ms(limits, session, admin_headers, client,
                                                                     monkeypatch):
    """500 fake SOS from a bot network, 125 in flight at a time = one worker's share of a 500-request burst
    over the 4 uvicorn workers. All in-process on one core; scripts/load_test.py measures the full burst
    over real HTTP."""
    # test-harness artifact: httpx's ASGITransport tries `import trio` on every request (not installed ->
    # an uncached failed import, ~1 ms each). It is client-side only, so it is excluded from the measurement.
    import httpx._transports.asgi as asgi_transport
    monkeypatch.setattr(asgi_transport, "is_running_trio", lambda: False)
    limits(rate_sos_per_ip_per_min=20, spam_reg_per_ip_10min=5)
    async with client_from("10.66.0.1") as bot:
        devices = [await register(bot) for _ in range(20)]

        in_flight = asyncio.Semaphore(125)

        async def one(i: int):
            async with in_flight:
                t0 = time.perf_counter()
                r = await sos(bot, devices[i % len(devices)], 40.38 + (i % 50) * 0.001, 49.84)
                return r.status_code, time.perf_counter() - t0

        results = await asyncio.gather(*(one(i) for i in range(500)))
    latencies = [lat for _, lat in results]
    codes = [c for c, _ in results]
    assert statistics.mean(latencies) < 0.3, f"avg {statistics.mean(latencies) * 1000:.0f} ms"
    assert codes.count(201) <= 20 and codes.count(429) >= 480
    # the panel stays usable: the queue contains no bot SOS and answers quickly
    t0 = time.perf_counter()
    queue = await client.get(f"{API}/sos", headers=admin_headers)
    assert queue.status_code == 200 and queue.json() == [] and time.perf_counter() - t0 < 0.3
