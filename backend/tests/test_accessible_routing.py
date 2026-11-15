"""Step-free routing for persons with reduced mobility (Hərəkət məhdudiyyətli şəxs)."""
import uuid

from sqlalchemy import func, select

from app.models import AssemblyPoint, RoadSegment, Route
from app.services.crisis_engine import recommend_point
from app.services.routing import WALK, graph
from tests.conftest import NASIMI, YASAMAL

API = "/api/v1"


async def register(client, impaired: bool, lat=YASAMAL[0], lng=YASAMAL[1]) -> dict:
    device = str(uuid.uuid4())
    await client.post(f"{API}/citizens/register", json={"device_id": device, "mobility_impaired": impaired})
    h = {"X-Device-Id": device}
    await client.patch(f"{API}/citizens/me/location", json={"lat": lat, "lng": lng}, headers=h)
    return h


async def route_to_best(client, h) -> dict:
    best = (await client.get(f"{API}/assembly-points/nearest", params={"lat": YASAMAL[0], "lng": YASAMAL[1]},
                             headers=h)).json()[0]
    r = await client.post(f"{API}/citizens/me/route", headers=h,
                          json={"point_id": best["point"]["id"], "lat": YASAMAL[0], "lng": YASAMAL[1]})
    assert r.status_code == 200, r.text
    return r.json()


def barrier_free(segment_ids) -> bool:
    return all(graph.segments[s].accessible for s in segment_ids)


async def test_seed_has_barriers_and_inaccessible_points(session):
    total = await session.scalar(select(func.count()).select_from(RoadSegment))
    with_barrier = await session.scalar(select(func.count()).select_from(RoadSegment)
                                        .where(RoadSegment.barrier.isnot(None)))
    assert 0.05 < with_barrier / total < 0.2
    kinds = set((await session.scalars(select(RoadSegment.barrier).distinct())).all())
    assert {"stairs", "underpass", "steep"} <= kinds
    blocked = (await session.scalars(select(AssemblyPoint.name)
                                     .where(AssemblyPoint.wheelchair_accessible.is_(False)))).all()
    assert len(blocked) == 9 and all("sığınacağı" in n for n in blocked)


async def test_accessible_route_avoids_barriers_and_uses_wheelchair_speed():
    normal = graph.route(*YASAMAL, *NASIMI, WALK)
    # put stairs on the middle of the normal route
    seg = normal.segment_ids[len(normal.segment_ids) // 2]
    for s in (seg, graph.twin(seg)):
        graph.set_barrier(s, "stairs")
    again = graph.route(*YASAMAL, *NASIMI, WALK)
    step_free = graph.route(*YASAMAL, *NASIMI, WALK, accessible=True)
    assert seg in again.segment_ids and again.accessible is False      # regular walkers may take stairs
    assert seg not in step_free.segment_ids and step_free.accessible is True
    assert barrier_free(step_free.segment_ids)
    assert abs(step_free.eta_min - step_free.distance_m / (3.5 / 3.6) / 60) < 0.05


async def test_nearest_accessible_filters_points(client):
    params = {"lat": 40.3800, "lng": 49.8450, "limit": 20}  # central Nəsimi, several metro shelters around
    regular = (await client.get(f"{API}/assembly-points/nearest", params=params)).json()
    assert any(not i["point"]["wheelchair_accessible"] for i in regular)
    acc = (await client.get(f"{API}/assembly-points/nearest", params=params | {"accessible": "true"})).json()
    assert acc and all(i["point"]["wheelchair_accessible"] for i in acc)
    # automatic for a registered person with reduced mobility
    h = await register(client, True, 40.3800, 49.8450)
    auto = (await client.get(f"{API}/assembly-points/nearest", params=params, headers=h)).json()
    assert [i["point"]["id"] for i in auto] == [i["point"]["id"] for i in acc]
    # explicit accessible=false overrides
    off = (await client.get(f"{API}/assembly-points/nearest", params=params | {"accessible": "false"},
                            headers=h)).json()
    assert len(off) == len(regular)


async def test_impaired_citizen_gets_step_free_route(client, session):
    h = await register(client, True)
    route = await route_to_best(client, h)
    assert route["accessible"] is True
    db_route = await session.get(Route, route["id"])
    assert barrier_free(db_route.segment_ids)

    regular = await route_to_best(client, await register(client, False))
    assert regular["accessible"] is False


async def test_impaired_citizen_cannot_target_inaccessible_point(client):
    h = await register(client, True, 40.3800, 49.8450)
    points = (await client.get(f"{API}/assembly-points", params={"status": "active"})).json()
    metro = next(p for p in points if not p["wheelchair_accessible"])
    r = await client.post(f"{API}/citizens/me/route", headers=h | {"Accept-Language": "en"},
                          json={"point_id": metro["id"], "lat": 40.3800, "lng": 49.8450})
    assert r.status_code == 409
    assert r.json()["error"] == {"code": "POINT_NOT_ACCESSIBLE", "message":
                                 "This assembly point is not accessible for persons with reduced mobility."}


async def test_new_barrier_reroutes_only_impaired_citizens(client, session, admin_headers):
    impaired = await register(client, True)
    regular = await register(client, False)
    r_imp = await route_to_best(client, impaired)
    db_imp = await session.get(Route, r_imp["id"])
    seg = db_imp.segment_ids[len(db_imp.segment_ids) // 2]
    # make the regular citizen walk the same way by giving them the same route request
    r_reg = (await client.post(f"{API}/citizens/me/route", headers=regular,
                               json={"point_id": r_imp["target_point_id"], "lat": YASAMAL[0],
                                     "lng": YASAMAL[1]})).json()

    r = await client.post(f"{API}/sim/barrier", headers=admin_headers,
                          json={"segment_id": seg, "barrier": "stairs", "reason": "Yeraltı keçid"})
    assert r.status_code == 200, r.text
    assert r.json()["barrier"] == "stairs" and r.json()["rerouted"] == 1

    new_imp = (await client.get(f"{API}/citizens/me/route", headers=impaired)).json()
    assert new_imp["reason"] == "barrier" and new_imp["version"] == 2 and new_imp["accessible"] is True
    assert seg not in (await session.get(Route, new_imp["id"])).segment_ids
    assert (await client.get(f"{API}/citizens/me/route", headers=regular)).json()["id"] == r_reg["id"]

    fc = (await client.get(f"{API}/traffic/segments", params={"has_barrier": "true", "bbox": "49.70,40.30,50.0,40.50"},
                           headers=admin_headers)).json()
    props = {f["id"]: f["properties"] for f in fc["features"]}
    assert props[seg]["barrier"] == "stairs" and props[seg]["accessible"] is False

    # removing the barrier, then reset restores the seed barriers
    r = await client.post(f"{API}/sim/barrier", headers=admin_headers, json={"segment_id": seg, "barrier": None})
    assert r.json()["rerouted"] == 0 and graph.segments[seg].accessible
    await client.post(f"{API}/sim/barrier", headers=admin_headers, json={"segment_id": seg, "barrier": "steep"})
    await session.rollback()  # release the test session's read locks before /sim/reset TRUNCATEs
    await client.post(f"{API}/sim/reset", headers=admin_headers)
    session.expire_all()
    db_seg = await session.get(RoadSegment, seg)
    assert db_seg.barrier == db_seg.base_barrier and graph.segments[seg].barrier == db_seg.base_barrier


async def test_point_full_reroute_stays_accessible(client, session, admin_headers):
    h = await register(client, True)
    route = await route_to_best(client, h)
    point = (await client.get(f"{API}/assembly-points")).json()
    target = next(p for p in point if p["id"] == route["target_point_id"])
    await client.post(f"{API}/sim/occupancy", headers=admin_headers,
                      json={"point_id": target["id"], "current_count": int(target["capacity"] * 0.92)})
    new = (await client.get(f"{API}/citizens/me/route", headers=h)).json()
    assert new["reason"] == "point_full" and new["accessible"] is True
    new_point = await session.get(AssemblyPoint, new["target_point_id"])
    assert new_point.wheelchair_accessible


async def test_alert_recommends_accessible_reserve_when_needed(session):
    # right next to the (inaccessible) reserve "Nizami kinoteatrı sığınacağı"
    lat, lng = 40.3830, 49.8300
    any_point, _ = await recommend_point(session, lat, lng, 1)
    assert any_point.name == "Nizami kinoteatrı sığınacağı"
    acc_point, _ = await recommend_point(session, lat, lng, 1, accessible=True)
    assert acc_point.wheelchair_accessible and acc_point.status == "reserve"
