import math
import uuid

from sqlalchemy import update

from app.models import AssemblyPoint
from tests.conftest import YASAMAL, register_citizen

API = "/api/v1"


async def test_register_is_idempotent(client):
    device_id = str(uuid.uuid4())
    a = (await client.post(f"{API}/citizens/register", json={"device_id": device_id})).json()
    b = (await client.post(f"{API}/citizens/register", json={"device_id": device_id, "phone": "+994501112233"})).json()
    assert a["id"] == b["id"] and b["phone"] == "+994501112233" and a["status"] == "unknown"


async def test_error_envelope_for_missing_and_unknown_device(client):
    r = await client.get(f"{API}/citizens/me/route")
    assert r.status_code == 401 and r.json()["error"]["code"] == "MISSING_DEVICE_ID"
    r = await client.get(f"{API}/citizens/me/route", headers={"X-Device-Id": str(uuid.uuid4())})
    assert r.status_code == 401 and r.json()["error"]["code"] == "CITIZEN_NOT_REGISTERED"


async def test_validation_error_envelope(client):
    r = await client.get(f"{API}/assembly-points/nearest", params={"lat": 200, "lng": 49.8})
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "VALIDATION_ERROR"
    assert r.json()["error"]["message"] == "Sorğu məlumatları yanlışdır."


async def test_location_sets_zone_via_st_contains(client):
    h = await register_citizen(client)
    r = await client.patch(f"{API}/citizens/me/location", json={"lat": YASAMAL[0], "lng": YASAMAL[1]}, headers=h)
    assert r.json()["zone_id"] == 2  # Yasamal
    r = await client.patch(f"{API}/citizens/me/status", json={"status": "in_danger"}, headers=h)
    assert r.json()["status"] == "in_danger"


async def test_zones_endpoint_returns_geojson(client):
    zones = (await client.get(f"{API}/zones")).json()
    assert len(zones) == 11
    assert {z["name"] for z in zones} >= {"Nəsimi", "Yasamal", "Qaradağ"}
    assert zones[0]["polygon"]["type"] == "Polygon"


async def test_list_points_filters(client):
    reserve = (await client.get(f"{API}/assembly-points", params={"status": "reserve"})).json()
    assert len(reserve) == 6 and all(p["status"] == "reserve" for p in reserve)
    yas = (await client.get(f"{API}/assembly-points", params={"zone_id": 2})).json()
    assert yas and all(p["zone_id"] == 2 for p in yas)
    p = yas[0]
    assert set(p) == {"id", "name", "type", "lat", "lng", "zone_id", "capacity", "current_count",
                      "occupancy_pct", "status", "wheelchair_accessible"}


async def test_nearest_ranking_and_near_full_flag(client, session):
    params = {"lat": YASAMAL[0], "lng": YASAMAL[1], "zone_id": 2, "limit": 20}
    items = (await client.get(f"{API}/assembly-points/nearest", params=params)).json()
    assert items and all(i["point"]["status"] == "active" for i in items)
    scores = [i["score"] for i in items]
    assert scores == sorted(scores)
    assert set(items[0]) == {"point", "distance_m", "eta_min", "score", "near_full", "source"}

    best = items[0]["point"]
    await session.execute(update(AssemblyPoint).where(AssemblyPoint.id == best["id"])
                          .values(current_count=math.ceil(best["capacity"] * 0.92)))
    await session.commit()
    items = (await client.get(f"{API}/assembly-points/nearest", params=params)).json()
    flagged = [i for i in items if i["point"]["id"] == best["id"]]
    assert flagged and flagged[0]["near_full"] is True
    assert items[-1]["point"]["id"] == best["id"]  # near-full points are ranked last


async def test_route_lifecycle(client):
    h = await register_citizen(client, *YASAMAL)
    r = await client.get(f"{API}/citizens/me/route", headers=h)
    assert r.status_code == 404 and r.json()["error"]["code"] == "ROUTE_NOT_FOUND"

    best = (await client.get(f"{API}/assembly-points/nearest",
                             params={"lat": YASAMAL[0], "lng": YASAMAL[1]})).json()[0]
    body = {"point_id": best["point"]["id"], "lat": YASAMAL[0], "lng": YASAMAL[1]}
    first = (await client.post(f"{API}/citizens/me/route", json=body, headers=h)).json()
    assert first["version"] == 1 and first["reason"] == "initial"
    assert first["geometry"]["type"] == "LineString" and len(first["geometry"]["coordinates"]) >= 2
    assert abs(first["eta_min"] - best["eta_min"]) < 0.01

    second = (await client.post(f"{API}/citizens/me/route", json=body, headers=h)).json()
    assert second["version"] == 2
    active = (await client.get(f"{API}/citizens/me/route", headers=h)).json()
    assert active["id"] == second["id"]


async def test_route_to_reserve_point_rejected(client):
    h = await register_citizen(client, *YASAMAL)
    reserve = (await client.get(f"{API}/assembly-points", params={"status": "reserve"})).json()[0]
    r = await client.post(f"{API}/citizens/me/route",
                          json={"point_id": reserve["id"], "lat": YASAMAL[0], "lng": YASAMAL[1]}, headers=h)
    assert r.status_code == 409 and r.json()["error"]["code"] == "POINT_NOT_ACTIVE"


async def test_check_in_increments_and_marks_safe(client):
    h = await register_citizen(client, *YASAMAL)
    point = (await client.get(f"{API}/assembly-points", params={"zone_id": 2, "status": "active"})).json()[0]
    r = await client.post(f"{API}/assembly-points/{point['id']}/check-in", headers=h)
    assert r.status_code == 200
    assert r.json()["current_count"] == point["current_count"] + 1
    me = (await client.patch(f"{API}/citizens/me/location", json={"lat": YASAMAL[0], "lng": YASAMAL[1]},
                             headers=h)).json()
    assert me["status"] == "safe" and me["target_point_id"] == point["id"]
