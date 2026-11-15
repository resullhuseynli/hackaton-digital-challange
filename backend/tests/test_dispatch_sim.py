"""Dispatcher endpoints, simulation controls and brigade movement."""
import math

from sqlalchemy import select

from app.models import Brigade, RoadSegment, Route
from app.services.brigade_sim import tick
from app.services.routing import graph
from tests.conftest import YASAMAL, register_citizen

API = "/api/v1"


async def _routed_citizen(client):
    h = await register_citizen(client, *YASAMAL)
    best = (await client.get(f"{API}/assembly-points/nearest", params={"lat": YASAMAL[0], "lng": YASAMAL[1]})).json()[0]
    route = (await client.post(f"{API}/citizens/me/route", headers=h,
                               json={"point_id": best["point"]["id"], "lat": YASAMAL[0], "lng": YASAMAL[1]})).json()
    return h, route, best["point"]


async def test_overview_and_timeseries(client, admin_headers):
    h = await register_citizen(client)
    await client.post(f"{API}/sos", json={"type": "medical", "lat": 40.38, "lng": 49.84}, headers=h)
    ov = (await client.get(f"{API}/dispatch/overview", headers=admin_headers)).json()
    assert ov["active_sos"] == 1 and ov["citizens_in_danger"] == 1 and ov["brigades_idle"] == 10
    assert ov["brigades_busy"] == 0 and ov["active_alerts"] == 0 and 0 < ov["avg_occupancy_pct"] < 100
    ts = (await client.get(f"{API}/dispatch/timeseries", params={"minutes": 30}, headers=admin_headers)).json()
    assert ts["minutes"] == 30 and len(ts["series"]) == 30
    assert ts["series"][-1]["by_type"]["medical"] == 1 and ts["series"][-1]["total"] == 1
    assert sum(p["total"] for p in ts["series"]) == 1


async def test_sim_road_closure_by_coordinate_reroutes(client, session, admin_headers):
    h, route, _ = await _routed_citizen(client)
    coords = route["geometry"]["coordinates"]
    mid = len(coords) // 2
    (lng1, lat1), (lng2, lat2) = coords[mid], coords[mid + 1]
    r = await client.post(f"{API}/sim/road-closure", headers=admin_headers, json={
        "lat": (lat1 + lat2) / 2, "lng": (lng1 + lng2) / 2, "status": "closed", "reason": "Uçqun"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert len(body["segment_ids"]) == 2 and body["status"] == "closed" and body["rerouted"] == 1
    new = (await client.get(f"{API}/citizens/me/route", headers=h)).json()
    assert new["reason"] == "road_closed" and new["version"] == 2
    db_route = await session.get(Route, new["id"])
    assert not set(body["segment_ids"]) & set(db_route.segment_ids)
    # in-memory graph and DB agree
    seg = await session.get(RoadSegment, body["segment_ids"][0])
    assert seg.status == "closed" and not graph.g.has_edge(seg.from_node, seg.to_node)

    fc = (await client.get(f"{API}/traffic/segments", params={"status": "closed"}, headers=admin_headers)).json()
    assert fc["type"] == "FeatureCollection" and {f["id"] for f in fc["features"]} == set(body["segment_ids"])
    assert fc["features"][0]["geometry"]["type"] == "LineString"

    # reopening restores the edge
    r = await client.post(f"{API}/sim/road-closure", headers=admin_headers,
                          json={"segment_id": body["segment_ids"][0], "status": "open"})
    assert r.json()["rerouted"] == 0 and graph.g.has_edge(seg.from_node, seg.to_node)


async def test_traffic_bbox_filter(client, admin_headers):
    fc = (await client.get(f"{API}/traffic/segments", params={"bbox": "49.79,40.38,49.81,40.40"},
                           headers=admin_headers)).json()
    assert 0 < len(fc["features"]) < 500
    for f in fc["features"]:
        assert all(49.78 <= x <= 49.82 and 40.37 <= y <= 40.41 for x, y in f["geometry"]["coordinates"])
    r = await client.get(f"{API}/traffic/segments", params={"bbox": "nonsense"}, headers=admin_headers)
    assert r.status_code == 422 and r.json()["error"]["code"] == "INVALID_BBOX"


async def test_sim_road_closure_requires_target(client, admin_headers):
    r = await client.post(f"{API}/sim/road-closure", json={"status": "closed"}, headers=admin_headers)
    assert r.status_code == 422 and r.json()["error"]["code"] == "VALIDATION_ERROR"


async def test_sim_occupancy_triggers_reroute_then_alert(client, admin_headers):
    h, _, point = await _routed_citizen(client)
    r = await client.post(f"{API}/sim/occupancy", headers=admin_headers,
                          json={"point_id": point["id"], "current_count": math.ceil(point["capacity"] * 0.91)})
    body = r.json()
    assert body["rerouted"] == 1 and body["alert_id"] is None and body["point"]["occupancy_pct"] >= 90
    assert (await client.get(f"{API}/citizens/me/route", headers=h)).json()["reason"] == "point_full"

    r = await client.post(f"{API}/sim/occupancy", headers=admin_headers,
                          json={"point_id": point["id"], "delta": math.ceil(point["capacity"] * 0.05)})
    assert r.json()["alert_id"] is not None
    alerts = (await client.get(f"{API}/alerts", params={"status": "active"}, headers=admin_headers)).json()
    assert alerts[0]["kind"] == "POINT_OVERLOAD" and alerts[0]["point_id"] == point["id"]

    r = await client.post(f"{API}/sim/occupancy", headers=admin_headers, json={"point_id": point["id"]})
    assert r.status_code == 422


async def test_sim_sos_burst_raises_red_alert(client, admin_headers):
    r = await client.post(f"{API}/sim/sos-burst", headers=admin_headers, json={
        "lat": 40.3960, "lng": 49.7950, "count": 4, "radius_m": 400, "window_sec": 120, "type": "collapse", "seed": 7})
    assert r.status_code == 200, r.text
    body = r.json()
    assert len(body["citizen_ids"]) == 4 and len(body["sos_ids"]) == 4 and len(body["alert_ids"]) == 1
    alert = (await client.get(f"{API}/alerts", params={"status": "active"}, headers=admin_headers)).json()[0]
    assert alert["distinct_citizens"] == 4 and sorted(alert["sos_ids"]) == sorted(body["sos_ids"])


async def test_sim_sos_burst_below_threshold(client, admin_headers):
    r = await client.post(f"{API}/sim/sos-burst", headers=admin_headers, json={
        "lat": 40.3960, "lng": 49.7950, "count": 3, "radius_m": 200, "window_sec": 60, "seed": 1})
    assert r.json()["alert_ids"] == []


async def test_sim_reset_restores_baseline(client, session, admin_headers):
    await _routed_citizen(client)
    await client.post(f"{API}/sim/sos-burst", headers=admin_headers,
                      json={"lat": 40.3960, "lng": 49.7950, "count": 4, "radius_m": 300, "window_sec": 60})
    await client.post(f"{API}/sim/road-closure", headers=admin_headers, json={"segment_id": 10, "status": "closed"})
    assert (await client.post(f"{API}/sim/reset", headers=admin_headers)).json() == {"ok": True}
    ov = (await client.get(f"{API}/dispatch/overview", headers=admin_headers)).json()
    assert ov["active_sos"] == 0 and ov["active_alerts"] == 0 and ov["citizens_in_danger"] == 0
    assert (await client.get(f"{API}/traffic/segments", params={"status": "closed"},
                             headers=admin_headers)).json()["features"] == []
    s = graph.segments[10]
    assert graph.g.has_edge(s.u, s.v)


async def test_brigade_assign_move_arrive_resolve_return(client, session, admin_headers):
    h = await register_citizen(client)
    sos = (await client.post(f"{API}/sos", json={"type": "fire", "lat": 40.3790, "lng": 49.8410}, headers=h)).json()
    r = await client.post(f"{API}/brigades/1/assign", json={"sos_id": sos["id"]}, headers=admin_headers)
    assert r.status_code == 200, r.text
    b = r.json()
    assert b["status"] == "en_route" and b["target_sos_id"] == sos["id"]
    assert b["route_geometry"]["type"] == "LineString"

    mine = (await client.get(f"{API}/sos/me", headers=h)).json()[0]
    assert mine["status"] == "assigned" and mine["assigned_brigade_id"] == 1 and mine["brigade_eta_min"] > 0

    # busy brigade cannot be assigned again
    r = await client.post(f"{API}/brigades/1/assign", json={"sos_id": sos["id"]}, headers=admin_headers)
    assert r.status_code == 409 and r.json()["error"]["code"] == "BRIGADE_BUSY"

    # one 2 s tick at 40 km/h moves the brigade ~22 m along its route
    brigade = await session.get(Brigade, 1)
    events = []
    await tick(session, events, 2.0)
    assert math.isclose(brigade.route_progress_m, 40 / 3.6 * 2, rel_tol=1e-6)
    assert events and events[0].type == "brigade.updated"
    eta_before = mine["brigade_eta_min"]
    await session.commit()
    mine = (await client.get(f"{API}/sos/me", headers=h)).json()[0]
    assert mine["brigade_eta_min"] < eta_before

    # arrival -> on_site
    await tick(session, [], 10_000)
    assert brigade.status == "on_site"
    await session.commit()

    # dispatcher resolves -> returning -> idle at home
    r = await client.post(f"{API}/sos/{sos['id']}/resolve", headers=admin_headers)
    assert r.status_code == 200 and r.json()["status"] == "resolved"
    session.expire_all()
    brigade = await session.get(Brigade, 1)
    assert brigade.status == "returning" and brigade.target_sos_id is None
    await tick(session, [], 10_000)
    assert brigade.status == "idle" and brigade.route_geometry is None
    await session.commit()
    brigades = (await client.get(f"{API}/brigades", headers=admin_headers)).json()
    home = brigades[0]
    assert home["status"] == "idle" and math.isclose(home["lat"], 40.3850, abs_tol=1e-4)

    r = await client.post(f"{API}/sos/{sos['id']}/resolve", headers=admin_headers)
    assert r.status_code == 409 and r.json()["error"]["code"] == "SOS_ALREADY_RESOLVED"


async def test_brigades_listing_contract(client, admin_headers):
    brigades = (await client.get(f"{API}/brigades", headers=admin_headers)).json()
    assert len(brigades) == 10
    assert set(brigades[0]) == {"id", "name", "type", "lat", "lng", "status", "target_sos_id", "route_geometry"}
