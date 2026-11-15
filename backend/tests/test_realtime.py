import asyncio
import json

from app.realtime.events import CHANNEL, Event, bus
from app.realtime.ws_manager import WSManager
from app.services.routing import graph


class FakeWS:
    def __init__(self, fail: bool = False):
        self.sent: list[dict] = []
        self.fail = fail

    async def send_text(self, text: str):
        if self.fail:
            raise RuntimeError("closed")
        self.sent.append(json.loads(text))


def _msg(type_, data, dispatch=True, citizen_ids=None, internal=False):
    return {"type": type_, "data": data, "ts": "2026-01-01T00:00:00Z", "dispatch": dispatch,
            "citizen_ids": citizen_ids, "internal": internal}


async def test_fan_out_respects_audience():
    m = WSManager()
    d, c1, c2 = FakeWS(), FakeWS(), FakeWS()
    m.add_dispatch(d)
    m.add_citizen("c1", c1)
    m.add_citizen("c2", c2)

    await m.handle_bus_message(_msg("route.rerouted", {"x": 1}, dispatch=False, citizen_ids=["c1"]))
    await m.handle_bus_message(_msg("sos.created", {"id": 5}))
    assert [e["type"] for e in c1.sent] == ["route.rerouted"]
    assert c2.sent == []
    assert [e["type"] for e in d.sent] == ["sos.created"]
    # envelope contract
    assert set(d.sent[0]) == {"type", "data", "ts"}


async def test_internal_messages_are_not_delivered_and_dead_sockets_dropped():
    m = WSManager()
    d, dead = FakeWS(), FakeWS(fail=True)
    m.add_dispatch(d)
    m.add_dispatch(dead)
    await m.handle_bus_message(_msg("graph.reset", {}, dispatch=False, internal=True))
    assert d.sent == []
    await m.handle_bus_message(_msg("alert.raised", {"id": 1}))
    assert dead not in m.dispatch and len(d.sent) == 1


async def test_road_updated_message_syncs_graph_on_other_workers():
    m = WSManager()
    seg_id = next(iter(graph.segments))
    s = graph.segments[seg_id]
    await m.handle_bus_message(_msg("road.updated", {"segments": [
        {"id": seg_id, "status": "closed", "congestion_factor": 1.0}]}))
    assert not graph.g.has_edge(s.u, s.v)
    await m.handle_bus_message(_msg("graph.reset", {}, internal=True))
    assert graph.g.has_edge(s.u, s.v)


async def test_events_travel_through_redis_pubsub():
    received: list[dict] = []
    ready = asyncio.Event()
    pubsub = bus.redis.pubsub()
    await pubsub.subscribe(CHANNEL)
    await pubsub.get_message(timeout=1)  # subscription confirmation

    async def reader():
        ready.set()
        while not received:
            msg = await pubsub.get_message(ignore_subscribe_messages=True, timeout=1)
            if msg:
                received.append(json.loads(msg["data"]))

    task = asyncio.create_task(reader())
    await ready.wait()
    await bus.publish(Event("sos.created", {"id": 42}, citizen_ids=["abc"]))
    await asyncio.wait_for(task, 5)
    await pubsub.aclose()
    assert received[0]["type"] == "sos.created" and received[0]["data"] == {"id": 42}
    assert received[0]["citizen_ids"] == ["abc"] and received[0]["ts"].endswith("Z")
