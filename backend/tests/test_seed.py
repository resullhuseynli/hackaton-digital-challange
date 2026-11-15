from sqlalchemy import func, select, text

from app.models import AssemblyPoint, Brigade, Dispatcher, RoadNode, RoadSegment, Zone
from app.security import verify_password


async def test_seed_counts(session):
    assert await session.scalar(select(func.count()).select_from(Zone)) == 11
    points = await session.scalar(select(func.count()).select_from(AssemblyPoint))
    assert 28 <= points <= 35
    reserve = await session.scalar(
        select(func.count()).select_from(AssemblyPoint).where(AssemblyPoint.status == "reserve"))
    assert reserve == 6
    assert await session.scalar(select(func.count()).select_from(Brigade)) == 10
    types = set((await session.scalars(select(Brigade.type))).all())
    assert types == {"fire", "medical", "rescue"}


async def test_every_point_lies_inside_a_zone(session):
    missing = (await session.scalars(select(AssemblyPoint.name).where(AssemblyPoint.zone_id.is_(None)))).all()
    assert missing == []


async def test_zones_do_not_overlap(session):
    overlaps = await session.scalar(text(
        "SELECT count(*) FROM zones a JOIN zones b ON a.id < b.id "
        "WHERE ST_Area(ST_Intersection(a.polygon, b.polygon)) > 1e-9"))
    assert overlaps == 0


async def test_capacity_and_occupancy_ranges(session):
    rows = (await session.execute(select(AssemblyPoint.capacity, AssemblyPoint.current_count))).all()
    assert all(500 <= cap <= 20000 for cap, _ in rows)
    assert all(0 <= cur < cap for cap, cur in rows)


async def test_road_graph_seeded(session):
    assert await session.scalar(select(func.count()).select_from(RoadNode)) > 1000
    assert await session.scalar(select(func.count()).select_from(RoadSegment)) > 4000


async def test_admin_dispatcher_hashed(session):
    d = await session.scalar(select(Dispatcher).where(Dispatcher.username == "admin"))
    assert d is not None and d.password_hash != "admin123"
    assert verify_password("admin123", d.password_hash)


async def test_gist_indexes_on_all_geometry_columns(session):
    geom_cols = (await session.execute(text(
        "SELECT f_table_name, f_geometry_column FROM geometry_columns WHERE f_table_schema='public'"))).all()
    gist = (await session.execute(text(
        "SELECT tablename, indexdef FROM pg_indexes WHERE schemaname='public' AND indexdef ILIKE '%USING gist%'"))).all()
    for table, column in geom_cols:
        assert any(t == table and f"({column})" in d for t, d in gist), f"missing GIST on {table}.{column}"
