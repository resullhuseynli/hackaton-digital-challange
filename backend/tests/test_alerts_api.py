"""Alert confirm (one transaction), dismiss, and the SOS API incl. cooldown."""
import uuid

from sqlalchemy import select

from app.models import Alert, AssemblyPoint, AuditLog, Brigade, Citizen, Route, SosSignal
from tests.conftest import project, register_citizen

API = "/api/v1"
CLUSTER_CENTER = (40.3960, 49.7950)  # Yasamal


async def _raise_cluster(client, session, n=4, type_="collapse"):
    """n distinct registered citizens send SOS through the public API within ~150 m."""
    for i in range(n):
        lat, lng = await project(session, *CLUSTER_CENTER, 50.0 * i, 30)
        h = await register_citizen(client)
        r = await client.post(f"{API}/sos", json={"type": type_, "lat": lat, "lng": lng}, headers=h)
        assert r.status_code == 201, r.text


async def _evacuee_with_route(client):
    """A citizen in the cluster area already walking to a regular point."""
    h = await register_citizen(client, 40.3990, 49.7990)
    best = (await client.get(f"{API}/assembly-points/nearest", params={"lat": 40.3990, "lng": 49.7990})).json()[0]
    await client.post(f"{API}/citizens/me/route", headers=h,
                      json={"point_id": best["point"]["id"], "lat": 40.3990, "lng": 49.7990})
    return h


async def test_sos_api_and_cooldown(client):
    h = await register_citizen(client)
    r = await client.post(f"{API}/sos", json={"type": "fire", "lat": 40.38, "lng": 49.84, "note": "Tüstü"}, headers=h)
    assert r.status_code == 201
    body = r.json()
    assert body["status"] == "new" and body["zone_id"] == 1 and body["priority_score"] >= 30
    assert set(body) == {"id", "citizen_id", "type", "lat", "lng", "zone_id", "note", "priority_score", "status",
                         "assigned_brigade_id", "brigade_eta_min", "created_at", "citizen_mobility_impaired",
                         "labels"}
    assert body["citizen_mobility_impaired"] is False and body["labels"] == []

    r = await client.post(f"{API}/sos", json={"type": "fire", "lat": 40.38, "lng": 49.84}, headers=h)
    assert r.status_code == 429
    err = r.json()["error"]
    assert err["code"] == "SOS_COOLDOWN" and "saniyə gözləyin" in err["message"]
    assert 0 < err["details"]["retry_after_sec"] <= 60

    mine = (await client.get(f"{API}/sos/me", headers=h)).json()
    assert len(mine) == 1 and mine[0]["id"] == body["id"]
    me = (await client.patch(f"{API}/citizens/me/status", json={"status": "in_danger"}, headers=h)).json()
    assert me["status"] == "in_danger"


async def test_cooldown_is_per_citizen(client):
    a, b = await register_citizen(client), await register_citizen(client)
    assert (await client.post(f"{API}/sos", json={"type": "flood", "lat": 40.38, "lng": 49.84}, headers=a)).status_code == 201
    # a different spot (an identical report from the same IP would be merged as a duplicate)
    assert (await client.post(f"{API}/sos", json={"type": "flood", "lat": 40.39, "lng": 49.84}, headers=b)).status_code == 201


async def test_dispatcher_endpoints_require_jwt(client):
    r = await client.get(f"{API}/alerts")
    assert r.status_code == 401 and r.json()["error"]["code"] == "UNAUTHORIZED"
    r = await client.post(f"{API}/auth/login", json={"username": "admin", "password": "wrong"})
    assert r.status_code == 401 and r.json()["error"]["code"] == "INVALID_CREDENTIALS"


async def test_alert_listing_contract(client, session, admin_headers):
    await _raise_cluster(client, session)
    alerts = (await client.get(f"{API}/alerts", params={"status": "active"}, headers=admin_headers)).json()
    assert len(alerts) == 1
    a = alerts[0]
    assert a["kind"] == "SOS_CLUSTER" and a["zone_name"] == "Yasamal" and a["distinct_citizens"] == 4
    assert set(a["center"]) == {"lat", "lng"}
    assert set(a["recommended_brigade"]) == {"id", "name", "type", "eta_min"}
    assert a["recommended_brigade"]["type"] == "rescue"  # collapse -> rescue
    assert set(a["recommended_new_point"]) == {"id", "name", "capacity", "distance_m"}
    sos = (await client.get(f"{API}/sos", headers=admin_headers)).json()
    scores = [s["priority_score"] for s in sos]
    assert scores == sorted(scores, reverse=True)
    assert all(s >= 40 + 15 for s in scores)  # collapse + active alert in zone


async def test_confirm_executes_everything_in_one_transaction(client, session, admin_headers):
    evacuee = await _evacuee_with_route(client)
    await _raise_cluster(client, session)
    alert = (await client.get(f"{API}/alerts", params={"status": "active"}, headers=admin_headers)).json()[0]
    brigade_id = alert["recommended_brigade"]["id"]
    point_id = alert["recommended_new_point"]["id"]

    r = await client.post(f"{API}/alerts/{alert['id']}/confirm", headers=admin_headers)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "confirmed"

    session.expire_all()
    brigade = await session.get(Brigade, brigade_id)
    sos_rows = (await session.scalars(select(SosSignal).where(SosSignal.id.in_(alert["sos_ids"])))).all()
    top = max(sos_rows, key=lambda s: (s.priority_score, -s.created_at.timestamp()))
    assert brigade.status == "en_route" and brigade.target_sos_id == top.id
    assert brigade.route_geometry is not None and brigade.route_length_m > 0
    assert all(s.status == "assigned" and s.assigned_brigade_id == brigade_id for s in sos_rows)
    assert (await session.get(AssemblyPoint, point_id)).status == "active"

    route = (await client.get(f"{API}/citizens/me/route", headers=evacuee)).json()
    assert route["reason"] == "alert_new_point" and route["target_point_id"] == point_id

    db_alert = await session.get(Alert, alert["id"])
    assert db_alert.status == "confirmed" and db_alert.confirmed_by == "admin"
    audit = (await session.scalars(select(AuditLog).where(AuditLog.action == "alert.confirm"))).all()
    assert len(audit) == 1 and audit[0].payload["brigade_id"] == brigade_id
    assert audit[0].payload["rerouted"] >= 1

    # SOS senders see the assigned brigade and its ETA
    r = await client.post(f"{API}/alerts/{alert['id']}/confirm", headers=admin_headers)
    assert r.status_code == 409 and r.json()["error"]["code"] == "ALERT_NOT_ACTIVE"


async def test_confirm_rolls_back_completely_on_failure(client, session, admin_headers):
    evacuee = await _evacuee_with_route(client)
    await _raise_cluster(client, session)
    alert = (await client.get(f"{API}/alerts", params={"status": "active"}, headers=admin_headers)).json()[0]
    route_before = (await client.get(f"{API}/citizens/me/route", headers=evacuee)).json()

    # brigade dispatch + SOS assignment succeed inside the transaction, then the point override fails
    r = await client.post(f"{API}/alerts/{alert['id']}/confirm", json={"new_point_id": 99999},
                          headers=admin_headers)
    assert r.status_code == 404 and r.json()["error"]["code"] == "POINT_NOT_FOUND"

    session.expire_all()
    brigade = await session.get(Brigade, alert["recommended_brigade"]["id"])
    assert brigade.status == "idle" and brigade.route_geometry is None
    sos_rows = (await session.scalars(select(SosSignal).where(SosSignal.id.in_(alert["sos_ids"])))).all()
    assert all(s.status == "new" and s.assigned_brigade_id is None for s in sos_rows)
    assert (await session.get(Alert, alert["id"])).status == "active"
    assert (await client.get(f"{API}/citizens/me/route", headers=evacuee)).json()["id"] == route_before["id"]
    assert (await session.scalars(select(AuditLog))).all() == []


async def test_confirm_with_overrides_and_busy_brigade(client, session, admin_headers):
    await _raise_cluster(client, session)
    alert = (await client.get(f"{API}/alerts", params={"status": "active"}, headers=admin_headers)).json()[0]
    busy = await session.get(Brigade, 1)
    busy.status = "en_route"
    await session.commit()
    r = await client.post(f"{API}/alerts/{alert['id']}/confirm", json={"brigade_id": 1}, headers=admin_headers)
    assert r.status_code == 409 and r.json()["error"]["code"] == "BRIGADE_BUSY"

    reserve = (await client.get(f"{API}/assembly-points", params={"status": "reserve"})).json()
    other_point = next(p for p in reserve if p["id"] != alert["recommended_new_point"]["id"])
    r = await client.post(f"{API}/alerts/{alert['id']}/confirm",
                          json={"brigade_id": 2, "new_point_id": other_point["id"]}, headers=admin_headers)
    assert r.status_code == 200
    session.expire_all()
    assert (await session.get(Brigade, 2)).status == "en_route"
    assert (await session.get(AssemblyPoint, other_point["id"])).status == "active"
    audit = (await session.scalars(select(AuditLog))).one()
    assert audit.payload["overridden"] == {"brigade": True, "point": True}


async def test_dismiss_alert(client, session, admin_headers):
    await _raise_cluster(client, session)
    alert = (await client.get(f"{API}/alerts", params={"status": "active"}, headers=admin_headers)).json()[0]
    r = await client.post(f"{API}/alerts/{alert['id']}/dismiss", json={"reason": "Yalançı siqnal"},
                          headers=admin_headers)
    assert r.status_code == 200 and r.json()["status"] == "dismissed"
    session.expire_all()
    assert (await session.get(Alert, alert["id"])).dismiss_reason == "Yalançı siqnal"
    assert (await session.scalars(select(AuditLog).where(AuditLog.action == "alert.dismiss"))).one()
    assert (await client.get(f"{API}/alerts", params={"status": "active"}, headers=admin_headers)).json() == []
