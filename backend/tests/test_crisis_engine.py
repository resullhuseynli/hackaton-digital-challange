"""Crisis engine edge cases (CLUSTER_MIN_DISTINCT=4, CLUSTER_RADIUS_M=500, CLUSTER_WINDOW_MIN=5)."""
import math
import uuid
from datetime import timedelta

from sqlalchemy import func, select

from app.models import Alert, AssemblyPoint, Brigade, Citizen, utcnow
from app.services.occupancy import on_occupancy_change
from app.services.priority import compute_priority
from app.services.sos import create_sos
from tests.conftest import OFFSHORE, project

# Four corners of Yasamal: all >2 km apart, so only the same-zone rule can link them
YASAMAL_CORNERS = [(40.3650, 49.7800), (40.4200, 49.7800), (40.3650, 49.8100), (40.4200, 49.8100)]


async def new_citizen(session) -> Citizen:
    c = Citizen(device_id=str(uuid.uuid4()), status="unknown")
    session.add(c)
    await session.flush()
    return c


async def sos(session, citizen, lat, lng, *, now, age_sec=0.0, type_="collapse", events=None):
    return await create_sos(session, citizen, type_, lat, lng, None, events if events is not None else [],
                            created_at=now - timedelta(seconds=age_sec), now=now, cooldown=False)


async def active_alerts(session, kind="SOS_CLUSTER") -> list[Alert]:
    return list((await session.scalars(select(Alert).where(Alert.status == "active", Alert.kind == kind))).all())


async def cluster_offshore(session, n_distinct: int, now, last_offset=(0.0, 0.0)):
    """n_distinct citizens send one SOS each near OFFSHORE (no zone -> radius rule only)."""
    for i in range(n_distinct):
        lat, lng = await project(session, *OFFSHORE, 60.0 * i, 90)
        await sos(session, await new_citizen(session), lat, lng, now=now, age_sec=30 * (n_distinct - i))


# ----------------------------------------------------------------------------- distinct citizens
async def test_three_distinct_citizens_do_not_raise_alert(session):
    now = utcnow()
    await cluster_offshore(session, 3, now)
    assert await active_alerts(session) == []


async def test_four_distinct_citizens_raise_alert(session):
    now = utcnow()
    events = []
    for i in range(4):
        lat, lng = await project(session, *OFFSHORE, 60.0 * i, 90)
        await sos(session, await new_citizen(session), lat, lng, now=now, age_sec=10 * (4 - i), events=events)
    alerts = await active_alerts(session)
    assert len(alerts) == 1
    assert alerts[0].distinct_citizens == 4 and len(alerts[0].sos_ids) == 4
    assert alerts[0].zone_id is None and alerts[0].radius_m == 500
    assert [e.type for e in events].count("alert.raised") == 1


async def test_same_citizen_sending_four_times_counts_once(session):
    now = utcnow()
    c = await new_citizen(session)
    for i in range(4):
        await sos(session, c, *OFFSHORE, now=now, age_sec=10 * (4 - i))
    assert await active_alerts(session) == []
    # three more distinct citizens with the repeat sender -> 4 distinct -> alert
    others = [await new_citizen(session) for _ in range(2)]
    for o in others:
        await sos(session, o, *OFFSHORE, now=now)
    assert await active_alerts(session) == []  # still 3 distinct
    await sos(session, await new_citizen(session), *OFFSHORE, now=now)
    alerts = await active_alerts(session)
    assert len(alerts) == 1 and alerts[0].distinct_citizens == 4 and len(alerts[0].sos_ids) == 7


# ----------------------------------------------------------------------------- radius boundary
async def _radius_case(session, far_distance_m: float) -> list[Alert]:
    now = utcnow()
    near1 = await project(session, *OFFSHORE, 100, 180)
    near2 = await project(session, *OFFSHORE, 200, 270)
    far = await project(session, *OFFSHORE, far_distance_m, 0)
    for point in (near1, near2, far):
        await sos(session, await new_citizen(session), *point, now=now, age_sec=60)
    # the new SOS is evaluated against everything within 500 m of itself
    await sos(session, await new_citizen(session), *OFFSHORE, now=now)
    return await active_alerts(session)


async def test_citizen_at_499m_is_inside_cluster(session):
    alerts = await _radius_case(session, 499)
    assert len(alerts) == 1 and alerts[0].distinct_citizens == 4


async def test_citizen_at_501m_is_outside_cluster(session):
    assert await _radius_case(session, 501) == []


# ----------------------------------------------------------------------------- time window
async def _window_case(session, oldest_age_sec: float) -> list[Alert]:
    now = utcnow()
    await sos(session, await new_citizen(session), *OFFSHORE, now=now, age_sec=oldest_age_sec)
    await sos(session, await new_citizen(session), *OFFSHORE, now=now, age_sec=120)
    await sos(session, await new_citizen(session), *OFFSHORE, now=now, age_sec=60)
    await sos(session, await new_citizen(session), *OFFSHORE, now=now)
    return await active_alerts(session)


async def test_sos_4min59s_old_is_inside_window(session):
    alerts = await _window_case(session, 4 * 60 + 59)
    assert len(alerts) == 1 and alerts[0].distinct_citizens == 4


async def test_sos_5min01s_old_is_outside_window(session):
    assert await _window_case(session, 5 * 60 + 1) == []


# ----------------------------------------------------------------------------- same zone rule
async def test_same_zone_condition_links_distant_sos(session):
    now = utcnow()
    for i, corner in enumerate(YASAMAL_CORNERS[:3]):
        await sos(session, await new_citizen(session), *corner, now=now, age_sec=100 - i)
    assert await active_alerts(session) == []
    await sos(session, await new_citizen(session), *YASAMAL_CORNERS[3], now=now)
    alerts = await active_alerts(session)
    assert len(alerts) == 1
    assert alerts[0].zone_id == 2 and alerts[0].distinct_citizens == 4


async def test_same_zone_window_expires(session):
    now = utcnow()
    await sos(session, await new_citizen(session), *YASAMAL_CORNERS[0], now=now, age_sec=5 * 60 + 1)
    for corner in YASAMAL_CORNERS[1:]:
        await sos(session, await new_citizen(session), *corner, now=now)
    assert await active_alerts(session) == []


# ----------------------------------------------------------------------------- de-duplication
async def test_alert_deduplication_merges_into_existing(session):
    now = utcnow()
    await cluster_offshore(session, 4, now)
    events = []
    lat, lng = await project(session, *OFFSHORE, 150, 0)
    await sos(session, await new_citizen(session), lat, lng, now=now, events=events)
    alerts = await active_alerts(session)
    assert len(alerts) == 1
    assert alerts[0].distinct_citizens == 5 and len(alerts[0].sos_ids) == 5
    assert [e.type for e in events].count("alert.updated") == 1
    assert "alert.raised" not in [e.type for e in events]


async def test_new_alert_after_previous_one_was_handled(session):
    now = utcnow()
    await cluster_offshore(session, 4, now)
    (first,) = await active_alerts(session)
    first.status = "dismissed"
    await session.flush()
    await sos(session, await new_citizen(session), *OFFSHORE, now=now)
    alerts = await active_alerts(session)
    assert len(alerts) == 1 and alerts[0].id != first.id


# ----------------------------------------------------------------------------- recommendations
async def test_recommendation_matches_dominant_type_and_reserve_point(session):
    now = utcnow()
    center = (40.3960, 49.7950)  # Yasamal, near the reserve "Yasamal idman kompleksi"
    for i in range(4):
        lat, lng = await project(session, *center, 50.0 * i, 45)
        await sos(session, await new_citizen(session), lat, lng, now=now, type_="medical")
    (alert,) = await active_alerts(session)
    brigade = await session.get(Brigade, alert.recommended_brigade_id)
    assert brigade.type == "medical" and brigade.status == "idle"
    assert alert.recommended_brigade_eta_min > 0
    point = await session.get(AssemblyPoint, alert.recommended_new_point_id)
    assert point.status == "reserve" and point.name == "Yasamal idman kompleksi"
    assert alert.recommended_new_point_distance_m > 0


# ----------------------------------------------------------------------------- POINT_OVERLOAD
async def _set_pct(session, point, pct):
    point.current_count = math.ceil(point.capacity * pct / 100)
    await session.flush()


async def test_point_overload_alert_at_95_percent_not_94(session):
    point = await session.get(AssemblyPoint, 1)
    await _set_pct(session, point, 94)
    assert (await on_occupancy_change(session, point, []))["alert_id"] is None
    assert await active_alerts(session, "POINT_OVERLOAD") == []

    await _set_pct(session, point, 95)
    events = []
    result = await on_occupancy_change(session, point, events)
    (alert,) = await active_alerts(session, "POINT_OVERLOAD")
    assert result["alert_id"] == alert.id and alert.point_id == point.id
    assert "alert.raised" in [e.type for e in events]
    rec = await session.get(AssemblyPoint, alert.recommended_new_point_id)
    assert rec.status == "reserve" and rec.id != point.id


async def test_point_overload_is_deduplicated(session):
    point = await session.get(AssemblyPoint, 1)
    await _set_pct(session, point, 96)
    await on_occupancy_change(session, point, [])
    await _set_pct(session, point, 99)
    events = []
    await on_occupancy_change(session, point, events)
    assert len(await active_alerts(session, "POINT_OVERLOAD")) == 1
    assert "alert.updated" in [e.type for e in events]


# ----------------------------------------------------------------------------- priority
async def test_priority_formula(session):
    now = utcnow()
    center = YASAMAL_CORNERS[0]
    target = await sos(session, await new_citizen(session), *center, now=now, age_sec=10 * 60, type_="medical")
    assert await compute_priority(session, target, now) == 35 + 20  # wait 10 min -> 20 pts
    for d in (100, 200):
        p = await project(session, *center, d, 90)
        await sos(session, await new_citizen(session), *p, now=now, type_="fire")
    assert await compute_priority(session, target, now) == 35 + 20 + 2 * 5
    session.add(Alert(kind="POINT_OVERLOAD", zone_id=2, center="SRID=4326;POINT(49.78 40.365)", radius_m=500,
                      sos_ids=[], status="active"))
    await session.flush()
    assert await compute_priority(session, target, now) == 35 + 20 + 10 + 15
    # wait bonus is capped at 30
    assert await compute_priority(session, target, now + timedelta(hours=1)) == 35 + 30 + 0 + 15


async def test_alert_count_is_not_affected_by_repeat_tests(session):
    assert await session.scalar(select(func.count()).select_from(Alert)) == 0
