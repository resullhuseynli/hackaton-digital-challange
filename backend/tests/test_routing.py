from app.geo import haversine_m
from app.services.routing import DRIVE, WALK, graph
from tests.conftest import NASIMI, YASAMAL


async def test_astar_walk_route_and_pedestrian_eta():
    r = graph.route(*YASAMAL, *NASIMI, WALK)
    assert r is not None and r.segment_ids
    # ETA is computed at walking speed (5 km/h) on free-flowing roads
    assert abs(r.eta_min - r.distance_m / (5 / 3.6) / 60) < 0.05
    assert r.distance_m >= haversine_m(*YASAMAL, *NASIMI)
    # geometry starts at the requested start and ends at the requested end
    assert r.coords[0] == (YASAMAL[1], YASAMAL[0])
    assert r.coords[-1] == (NASIMI[1], NASIMI[0])
    # consecutive segments are connected
    for a, b in zip(r.segment_ids, r.segment_ids[1:]):
        assert graph.segments[a].v == graph.segments[b].u


async def test_astar_avoids_closed_segment():
    before = graph.route(*YASAMAL, *NASIMI, WALK)
    closed = before.segment_ids[len(before.segment_ids) // 2]
    graph.set_segment(closed, "closed")
    graph.set_segment(graph.twin(closed), "closed")
    after = graph.route(*YASAMAL, *NASIMI, WALK)
    assert after is not None
    assert closed not in after.segment_ids
    assert graph.twin(closed) not in after.segment_ids
    assert after.distance_m >= before.distance_m - 1e-6
    # reopening restores the edge in the routing graph
    graph.set_segment(closed, "open")
    s = graph.segments[closed]
    assert graph.g.has_edge(s.u, s.v)


async def test_congestion_factor_increases_weight():
    before = graph.route(*YASAMAL, *NASIMI, WALK)
    for sid in before.segment_ids:
        graph.set_segment(sid, "congested", 10.0)
    after = graph.route(*YASAMAL, *NASIMI, WALK)
    # the router routes around the heavily congested corridor
    assert set(after.segment_ids) != set(before.segment_ids)


async def test_drive_mode_is_faster_than_walking():
    walk = graph.route(*YASAMAL, *NASIMI, WALK)
    drive = graph.route(*YASAMAL, *NASIMI, DRIVE)
    assert drive.duration_s < walk.duration_s / 3
