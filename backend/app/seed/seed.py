"""Seed Baku reference data: zones, assembly points, brigades, dispatcher, road graph.

    python -m app.seed.seed [--if-empty] [--graph synthetic|osm]
"""
import argparse
import asyncio

from sqlalchemy import func, insert, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.geo import point_ewkt
from app.models import AssemblyPoint, Brigade, Dispatcher, Zone
from app.security import hash_password
from app.seed.build_graph import build, store_graph
from app.seed.data import ASSEMBLY_POINTS, BRIGADES, DISPATCHERS, NOT_WHEELCHAIR_ACCESSIBLE, ZONES

ALL_TABLES = ("audit_log", "alerts", "routes", "sos_signals", "citizens", "brigades", "assembly_points",
              "road_events", "road_segments", "road_nodes", "zones", "dispatchers")


def polygon_ewkt(coords) -> str:
    ring = list(coords) + [coords[0]]
    return "SRID=4326;POLYGON((" + ", ".join(f"{x} {y}" for x, y in ring) + "))"


def assembly_point_rows() -> list[dict]:
    return [{"id": i, "name": n, "type": t, "location": point_ewkt(lat, lng), "capacity": cap,
             "current_count": cur, "status": st, "wheelchair_accessible": n not in NOT_WHEELCHAIR_ACCESSIBLE}
            for i, (n, t, lat, lng, cap, cur, st) in enumerate(ASSEMBLY_POINTS, start=1)]


def brigade_rows() -> list[dict]:
    return [{"id": i, "name": n, "type": t, "location": point_ewkt(lat, lng), "home_location": point_ewkt(lat, lng),
             "status": "idle"} for i, (n, t, lat, lng) in enumerate(BRIGADES, start=1)]


async def assign_point_zones(session: AsyncSession) -> None:
    await session.execute(text(
        "UPDATE assembly_points ap SET zone_id = z.id FROM zones z WHERE ST_Contains(z.polygon, ap.location)"))


async def reset_sequences(session: AsyncSession) -> None:
    for table in ("zones", "assembly_points", "brigades", "dispatchers"):
        await session.execute(text(
            f"SELECT setval(pg_get_serial_sequence('{table}','id'), COALESCE((SELECT MAX(id) FROM {table}), 1))"))


async def seed_all(session: AsyncSession, graph_source: str = "synthetic") -> None:
    await session.execute(text(f"TRUNCATE {', '.join(ALL_TABLES)} RESTART IDENTITY CASCADE"))
    await session.execute(insert(Zone), [
        {"id": z["id"], "name": z["name"], "population": z["population"], "polygon": polygon_ewkt(z["polygon"])}
        for z in ZONES])
    await session.execute(insert(AssemblyPoint), assembly_point_rows())
    await assign_point_zones(session)
    await session.execute(insert(Brigade), brigade_rows())
    await session.execute(insert(Dispatcher), [
        {"username": u, "password_hash": hash_password(p), "role": r} for u, p, r in DISPATCHERS])
    nodes, segments = build(graph_source, [z["polygon"] for z in ZONES])
    await store_graph(session, nodes, segments)
    await reset_sequences(session)


async def _main(if_empty: bool, graph_source: str) -> None:
    from app.db import SessionLocal

    async with SessionLocal() as session:
        if if_empty and (await session.scalar(select(func.count()).select_from(Zone))):
            print("[seed] data already present, skipping")
            return
        await seed_all(session, graph_source)
        await session.commit()
    print("[seed] done")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--if-empty", action="store_true")
    parser.add_argument("--graph", choices=["synthetic", "osm"], default="synthetic")
    args = parser.parse_args()
    asyncio.run(_main(args.if_empty, args.graph))
