"""Test setup: a dedicated PostGIS database (TEST_DATABASE_URL) and Redis DB (TEST_REDIS_URL).
The schema is created once per session and seeded with the synthetic Baku graph."""
import os

# must run before any `app.*` import so settings pick up the test infrastructure
if os.getenv("TEST_DATABASE_URL"):
    os.environ["DATABASE_URL"] = os.environ["TEST_DATABASE_URL"]
if os.getenv("TEST_REDIS_URL"):
    os.environ["REDIS_URL"] = os.environ["TEST_REDIS_URL"]
os.environ["ENABLE_BACKGROUND_TASKS"] = "false"
# tests use the local graph unless a test plugs in the mock external provider explicitly
os.environ["EXTERNAL_ROUTING_URL"] = ""
os.environ["EXTERNAL_ROUTING_FAULT_URL"] = ""
# the whole suite talks from one IP (127.0.0.1): abuse limits are relaxed globally and tightened
# per test in tests/test_flood_protection.py
# crisis evaluation inline (deterministic tests); the async queue has its own tests
os.environ["CRISIS_ASYNC"] = "false"
for _k in ("RATE_SOS_PER_IP_PER_MIN", "RATE_REGISTER_PER_IP_PER_MIN", "SPAM_REG_PER_IP_10MIN",
           "SPAM_FLOOD_SOS_PER_10S"):
    os.environ[_k] = "1000000"

import uuid  # noqa: E402

import httpx  # noqa: E402
import pytest  # noqa: E402
import pytest_asyncio  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app.db import SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Base  # noqa: E402
from app.realtime.events import bus  # noqa: E402
from app.seed.seed import seed_all  # noqa: E402
from app.services.routing import graph  # noqa: E402
from app.services.routing_gateway import routing_gateway  # noqa: E402
from app.services.state import reset_state  # noqa: E402

# Reference coordinates used across tests
YASAMAL = (40.4060, 49.7990)   # north Yasamal, ~1.5 km from the nearest assembly point
NASIMI = (40.3790, 49.8410)
OFFSHORE = (40.3000, 49.9000)  # Caspian Sea, outside every zone polygon


def pytest_collection_modifyitems(items):
    marker = pytest.mark.asyncio(loop_scope="session")
    for item in items:
        if pytest_asyncio.is_async_test(item):
            item.add_marker(marker, append=False)


@pytest_asyncio.fixture(scope="session", loop_scope="session", autouse=True)
async def database():
    async with engine.begin() as conn:
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS postgis"))
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    async with SessionLocal() as session:
        await seed_all(session, "synthetic")
        await session.commit()
        await graph.load(session)
        await routing_gateway.matrix.build(session)
    await bus.connect()
    await bus.redis.flushdb()
    yield
    await bus.close()
    await engine.dispose()


@pytest_asyncio.fixture(loop_scope="session", autouse=True)
async def clean_state(database):
    """Every test starts from the seeded baseline."""
    async with SessionLocal() as s:
        await reset_state(s, [])
        await s.commit()
    yield


@pytest_asyncio.fixture(loop_scope="session")
async def session():
    async with SessionLocal() as s:
        yield s


@pytest_asyncio.fixture(loop_scope="session")
async def client():
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


@pytest_asyncio.fixture(loop_scope="session")
async def admin_headers(client):
    r = await client.post("/api/v1/auth/login", json={"username": "admin", "password": "admin123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


async def project(session, lat: float, lng: float, distance_m: float, azimuth_deg: float = 0.0):
    """Exact geodesic offset computed by PostGIS itself (same spheroid as ST_DWithin)."""
    row = (await session.execute(text(
        "SELECT ST_Y(p::geometry), ST_X(p::geometry) FROM (SELECT ST_Project("
        "ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography, CAST(:d AS float8), radians(:az)) AS p) q"),
        {"lat": lat, "lng": lng, "d": distance_m, "az": azimuth_deg})).one()
    return row[0], row[1]


async def register_citizen(client, lat: float | None = None, lng: float | None = None) -> dict:
    """Registers a fresh device; returns the headers to act as that citizen."""
    device_id = str(uuid.uuid4())
    r = await client.post("/api/v1/citizens/register", json={"device_id": device_id})
    assert r.status_code == 200, r.text
    headers = {"X-Device-Id": device_id}
    if lat is not None:
        r = await client.patch("/api/v1/citizens/me/location", json={"lat": lat, "lng": lng}, headers=headers)
        assert r.status_code == 200, r.text
    return headers
