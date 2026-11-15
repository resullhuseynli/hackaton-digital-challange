import math

from sqlalchemy import select

from app.models import AssemblyPoint, Citizen, Route
from app.services.occupancy import on_occupancy_change
from app.services.roads import set_segments_status
from app.services.routing import graph
from tests.conftest import YASAMAL, register_citizen

API = "/api/v1"


async def _citizen_with_route(client, session):
    h = await register_citizen(client, *YASAMAL)
    best = (await client.get(f"{API}/assembly-points/nearest",
                             params={"lat": YASAMAL[0], "lng": YASAMAL[1]})).json()[0]
    route = (await client.post(f"{API}/citizens/me/route", headers=h,
                               json={"point_id": best["point"]["id"], "lat": YASAMAL[0], "lng": YASAMAL[1]})).json()
    citizen = await session.scalar(select(Citizen).where(Citizen.device_id == h["X-Device-Id"]))
    db_route = await session.get(Route, route["id"])
    return h, citizen, db_route


async def test_road_closure_reroutes_affected_citizen(client, session):
    h, citizen, old = await _citizen_with_route(client, session)
    closed = old.segment_ids[len(old.segment_ids) // 2]
    events = []
    result = await set_segments_status(session, [closed, graph.twin(closed)], "closed", "Zəlzələ dağıntısı", events)
    await session.commit()
    assert result["rerouted"] == 1

    new = (await client.get(f"{API}/citizens/me/route", headers=h)).json()
    assert new["version"] == 2 and new["reason"] == "road_closed"
    db_new = await session.get(Route, new["id"])
    assert closed not in db_new.segment_ids

    citizen_evt = next(e for e in events if e.type == "route.rerouted" and e.citizen_ids)
    assert citizen_evt.citizen_ids == [str(citizen.id)] and citizen_evt.dispatch is False
    assert citizen_evt.data["old_route"]["id"] == old.id
    assert citizen_evt.data["new_route"]["id"] == new["id"]
    assert citizen_evt.data["reason"] == "road_closed"
    assert math.isclose(citizen_evt.data["eta_diff_min"], new["eta_min"] - old.eta_min, abs_tol=0.01)
    agg = next(e for e in events if e.type == "route.rerouted" and e.dispatch)
    assert agg.data["count"] == 1
    assert any(e.type == "road.updated" for e in events)


async def test_closure_of_unrelated_segment_does_not_reroute(client, session):
    _, _, old = await _citizen_with_route(client, session)
    unrelated = next(s for s in graph.segments if s not in old.segment_ids and graph.twin(s) not in old.segment_ids)
    events = []
    result = await set_segments_status(session, [unrelated], "closed", "test", events)
    assert result["rerouted"] == 0


async def test_light_congestion_does_not_reroute_but_heavy_does(client, session):
    _, _, old = await _citizen_with_route(client, session)
    seg = old.segment_ids[0]
    assert (await set_segments_status(session, [seg], "congested", "tıxac", [], 1.5))["rerouted"] == 0
    assert (await set_segments_status(session, [seg], "congested", "tıxac", [], 4.0))["rerouted"] == 1


async def _set_pct(session, point: AssemblyPoint, pct: float) -> None:
    point.current_count = math.ceil(point.capacity * pct / 100)
    await session.flush()


async def test_reroute_triggers_at_90_percent_not_89(client, session):
    h, citizen, old = await _citizen_with_route(client, session)
    point = await session.get(AssemblyPoint, old.target_point_id)

    await _set_pct(session, point, 89)
    events = []
    assert (await on_occupancy_change(session, point, events))["rerouted"] == 0
    occ = next(e for e in events if e.type == "point.occupancy")
    assert occ.citizen_ids == [str(citizen.id)]  # only citizens heading to this point

    await _set_pct(session, point, 90)
    events = []
    assert (await on_occupancy_change(session, point, events))["rerouted"] == 1
    await session.commit()
    new = (await client.get(f"{API}/citizens/me/route", headers=h)).json()
    assert new["reason"] == "point_full" and new["version"] == 2
    assert new["target_point_id"] != point.id


async def test_safe_citizens_are_not_rerouted(client, session):
    h, citizen, old = await _citizen_with_route(client, session)
    citizen.status = "safe"
    point = await session.get(AssemblyPoint, old.target_point_id)
    await _set_pct(session, point, 95)
    assert (await on_occupancy_change(session, point, []))["rerouted"] == 0
