"""Registration checkbox "Hərəkət məhdudiyyətli şəxs": Priority #1 + label for dispatchers."""
import json
import uuid

from sqlalchemy import select

from app.models import Brigade, SosSignal
from app.realtime.ws_manager import WSManager
from tests.conftest import project

API = "/api/v1"
LABEL_AZ = {"code": "MOBILITY_IMPAIRED", "text": "Hərəkət məhdudiyyətli şəxs"}
LABEL_EN = {"code": "MOBILITY_IMPAIRED", "text": "Person with reduced mobility"}
CENTER = (40.3960, 49.7950)


async def register(client, mobility_impaired: bool | None = None) -> dict:
    device_id = str(uuid.uuid4())
    body = {"device_id": device_id}
    if mobility_impaired is not None:
        body["mobility_impaired"] = mobility_impaired
    r = await client.post(f"{API}/citizens/register", json=body)
    assert r.status_code == 200, r.text
    return {"X-Device-Id": device_id, "_citizen": r.json()}


async def send(client, h, type_, lat, lng):
    r = await client.post(f"{API}/sos", json={"type": type_, "lat": lat, "lng": lng},
                          headers={"X-Device-Id": h["X-Device-Id"]})
    assert r.status_code == 201, r.text
    return r.json()


async def test_register_with_checkbox_and_update(client):
    h = await register(client, True)
    assert h["_citizen"]["mobility_impaired"] is True
    device = {"device_id": h["X-Device-Id"]}
    # re-registering without the field keeps the value; sending it updates it
    assert (await client.post(f"{API}/citizens/register", json=device)).json()["mobility_impaired"] is True
    r = await client.post(f"{API}/citizens/register", json=device | {"mobility_impaired": False})
    assert r.json()["mobility_impaired"] is False
    plain = await register(client)
    assert plain["_citizen"]["mobility_impaired"] is False


async def test_sos_carries_label_in_both_languages(client, admin_headers):
    h = await register(client, True)
    sos = await send(client, h, "flood", 40.38, 49.84)
    assert sos["citizen_mobility_impaired"] is True and sos["labels"] == [LABEL_AZ]
    en = (await client.get(f"{API}/sos", headers=admin_headers | {"Accept-Language": "en"})).json()
    assert en[0]["labels"] == [LABEL_EN]
    mine = (await client.get(f"{API}/sos/me", headers={"X-Device-Id": h["X-Device-Id"]})).json()
    assert mine[0]["labels"] == [LABEL_AZ]


async def test_mobility_impaired_sos_is_priority_one_for_dispatcher(client, admin_headers):
    # two regular collapse SOS (weight 40) and one flood SOS (weight 20) from a person with reduced mobility
    for i in range(2):
        await send(client, await register(client), "collapse", 40.38 + i * 0.002, 49.84)
    impaired = await send(client, await register(client, True), "flood", 40.45, 49.95)
    listing = (await client.get(f"{API}/sos", headers=admin_headers)).json()
    assert listing[0]["id"] == impaired["id"]
    assert listing[0]["priority_score"] < listing[1]["priority_score"]  # first despite a lower score
    assert [s["labels"] for s in listing[1:]] == [[], []]
    # filters keep the ordering rule
    new_only = (await client.get(f"{API}/sos", params={"status": "new"}, headers=admin_headers)).json()
    assert new_only[0]["id"] == impaired["id"]
    ov = (await client.get(f"{API}/dispatch/overview", headers=admin_headers)).json()
    assert ov["active_sos"] == 3 and ov["active_sos_mobility_impaired"] == 1


async def test_flag_change_updates_open_sos(client, admin_headers):
    h = await register(client)
    sos = await send(client, h, "fire", 40.38, 49.84)
    assert sos["labels"] == []
    await client.post(f"{API}/citizens/register", json={"device_id": h["X-Device-Id"], "mobility_impaired": True})
    listing = (await client.get(f"{API}/sos", headers=admin_headers)).json()
    assert listing[0]["citizen_mobility_impaired"] is True and listing[0]["labels"] == [LABEL_AZ]


async def test_alert_shows_label_and_confirm_targets_impaired_person_first(client, session, admin_headers):
    # three regular collapse SOS + one medical SOS from a person with reduced mobility -> RED ALERT
    for i in range(3):
        lat, lng = await project(session, *CENTER, 50.0 * i, 30)
        await send(client, await register(client), "collapse", lat, lng)
    lat, lng = await project(session, *CENTER, 160, 30)
    impaired = await send(client, await register(client, True), "flood", lat, lng)

    alert = (await client.get(f"{API}/alerts", params={"status": "active"},
                              headers=admin_headers | {"Accept-Language": "en"})).json()[0]
    assert alert["mobility_impaired_sos_ids"] == [impaired["id"]]
    assert alert["labels"] == [LABEL_EN]

    r = await client.post(f"{API}/alerts/{alert['id']}/confirm", headers=admin_headers)
    assert r.status_code == 200
    session.expire_all()
    brigade = await session.get(Brigade, alert["recommended_brigade"]["id"])
    assert brigade.target_sos_id == impaired["id"]  # the brigade goes to the impaired person first
    top_score = max((await session.scalars(select(SosSignal.priority_score))).all())
    assert impaired["priority_score"] < top_score


async def test_alert_without_impaired_person_has_no_label(client, session, admin_headers):
    for i in range(4):
        lat, lng = await project(session, *CENTER, 50.0 * i, 30)
        await send(client, await register(client), "collapse", lat, lng)
    alert = (await client.get(f"{API}/alerts", headers=admin_headers)).json()[0]
    assert alert["mobility_impaired_sos_ids"] == [] and alert["labels"] == []


class FakeWS:
    def __init__(self):
        self.sent = []

    async def send_text(self, text):
        self.sent.append(json.loads(text))


async def test_websocket_labels_are_localized_per_socket():
    m = WSManager()
    az, en = FakeWS(), FakeWS()
    m.add_dispatch(az, "az")
    m.add_dispatch(en, "en")
    await m.handle_bus_message({"type": "sos.created", "ts": "2026-01-01T00:00:00Z", "dispatch": True,
                                "citizen_ids": None, "internal": False,
                                "data": {"id": 1, "labels": [{"code": "MOBILITY_IMPAIRED", "text": "x"}]}})
    assert az.sent[0]["data"]["labels"] == [LABEL_AZ]
    assert en.sent[0]["data"]["labels"] == [LABEL_EN]
