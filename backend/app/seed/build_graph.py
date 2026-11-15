"""Road graph builder.

    python -m app.seed.build_graph --source osm         # OSMnx download (needs osmnx + internet)
    python -m app.seed.build_graph --source synthetic   # offline synthetic street grid

`--source osm` automatically falls back to the synthetic grid if OSMnx is not installed or the
download fails, so the project always runs offline.
"""
import argparse
import asyncio
import math
import random

from shapely.geometry import Point, Polygon
from shapely.ops import unary_union
from shapely.prepared import prep
from sqlalchemy import delete, insert, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.geo import haversine_m, line_ewkt, point_ewkt
from app.models import RoadEvent, RoadNode, RoadSegment
from app.seed.data import SYNTHETIC_BARRIERS

Node = tuple[int, float, float]  # (id, lng, lat)


def _pick_barrier(rng: random.Random) -> str | None:
    x, acc = rng.random(), 0.0
    for name, share in SYNTHETIC_BARRIERS:
        acc += share
        if x < acc:
            return name
    return None


def synthetic_graph(zone_polygons: list[list[tuple[float, float]]], spacing_m: float = 450.0,
                    bbox: tuple[float, float, float, float] = (49.68, 40.28, 50.22, 40.52), seed: int = 42):
    """Regular two-way street grid clipped to the district polygons. Every 4th street is an
    avenue (60 km/h), the rest are 40 km/h streets. A deterministic share of links gets a barrier
    for persons with reduced mobility (stairs / underpass / steep) on both directions."""
    rng = random.Random(seed)
    area = prep(unary_union([Polygon(p) for p in zone_polygons]).buffer(0.002))
    min_lng, min_lat, max_lng, max_lat = bbox
    lat0 = (min_lat + max_lat) / 2
    dlat = spacing_m / 111_320.0
    dlng = spacing_m / (111_320.0 * math.cos(math.radians(lat0)))
    rows = int((max_lat - min_lat) / dlat) + 1
    cols = int((max_lng - min_lng) / dlng) + 1

    grid: dict[tuple[int, int], Node] = {}
    for r in range(rows):
        for c in range(cols):
            lng, lat = min_lng + c * dlng, min_lat + r * dlat
            if area.contains(Point(lng, lat)):
                grid[(r, c)] = (1 + r * cols + c, lng, lat)

    segments: list[dict] = []
    seg_id = 1
    for (r, c), a in grid.items():
        for (nr, nc), avenue in (((r, c + 1), r % 4 == 0), ((r + 1, c), c % 4 == 0)):
            b = grid.get((nr, nc))
            if b is None:
                continue
            length = haversine_m(a[2], a[1], b[2], b[1])
            speed = 60.0 if avenue else 40.0
            barrier = _pick_barrier(rng)
            for u, v in ((a, b), (b, a)):
                segments.append({"id": seg_id, "from_node": u[0], "to_node": v[0], "length_m": length,
                                 "speed_kmh": speed, "coords": [(u[1], u[2]), (v[1], v[2])], "barrier": barrier})
                seg_id += 1
    return list(grid.values()), segments


def _osm_barrier(d: dict) -> str | None:
    """Map OSM tags to a barrier for persons with reduced mobility."""
    def first(v):
        return v[0] if isinstance(v, list) else v
    if first(d.get("highway")) == "steps":
        return "stairs"
    if first(d.get("wheelchair")) == "no":
        return "inaccessible"
    if first(d.get("tunnel")) in ("yes", "building_passage") and first(d.get("highway")) in ("footway", "path"):
        return "underpass"
    incline = str(first(d.get("incline")) or "").rstrip("%")
    try:
        if abs(float(incline)) > 8:
            return "steep"
    except ValueError:
        pass
    return None


def osm_graph(place: str = "Baku, Azerbaijan", network_type: str = "walk"):
    """`walk` includes footways and steps (needed for step-free routing); `drive` is car roads only."""
    import osmnx as ox  # optional dependency

    for tag in ("wheelchair", "incline", "tunnel"):
        if tag not in ox.settings.useful_tags_way:
            ox.settings.useful_tags_way = [*ox.settings.useful_tags_way, tag]
    g = ox.graph_from_place(place, network_type=network_type, simplify=True)
    g = ox.add_edge_speeds(g)
    nodes = [(int(n), float(d["x"]), float(d["y"])) for n, d in g.nodes(data=True)]
    xy = {n: (x, y) for n, x, y in nodes}
    best: dict[tuple[int, int], dict] = {}
    for u, v, _k, d in g.edges(keys=True, data=True):
        if u == v:
            continue
        if (u, v) not in best or d["length"] < best[(u, v)]["length"]:
            best[(u, v)] = d
    segments = []
    for i, ((u, v), d) in enumerate(best.items(), start=1):
        coords = list(d["geometry"].coords) if "geometry" in d else [xy[u], xy[v]]
        segments.append({"id": i, "from_node": int(u), "to_node": int(v), "length_m": float(d["length"]),
                         "speed_kmh": float(d.get("speed_kph") or 40.0), "coords": coords,
                         "barrier": _osm_barrier(d)})
    return nodes, segments


def build(source: str, zone_polygons, network_type: str = "walk"):
    if source == "osm":
        try:
            nodes, segments = osm_graph(network_type=network_type)
            print(f"[graph] OSM graph: {len(nodes)} nodes, {len(segments)} segments")
            return nodes, segments
        except Exception as exc:  # noqa: BLE001 - any failure => offline fallback
            print(f"[graph] OSM download unavailable ({exc!r}); falling back to synthetic grid")
    nodes, segments = synthetic_graph(zone_polygons)
    print(f"[graph] synthetic grid: {len(nodes)} nodes, {len(segments)} segments")
    return nodes, segments


async def store_graph(session: AsyncSession, nodes: list[Node], segments: list[dict]) -> None:
    await session.execute(delete(RoadEvent))
    await session.execute(delete(RoadSegment))
    await session.execute(delete(RoadNode))
    chunk = 5000
    node_rows = [{"id": n, "location": point_ewkt(lat, lng)} for n, lng, lat in nodes]
    for i in range(0, len(node_rows), chunk):
        await session.execute(insert(RoadNode), node_rows[i:i + chunk])
    seg_rows = [{"id": s["id"], "from_node": s["from_node"], "to_node": s["to_node"], "length_m": s["length_m"],
                 "speed_kmh": s["speed_kmh"], "status": "open", "congestion_factor": 1.0,
                 "barrier": s.get("barrier"), "base_barrier": s.get("barrier"),
                 "geometry": line_ewkt(s["coords"])} for s in segments]
    for i in range(0, len(seg_rows), chunk):
        await session.execute(insert(RoadSegment), seg_rows[i:i + chunk])
    await session.execute(text(
        "SELECT setval(pg_get_serial_sequence('road_segments','id'), COALESCE((SELECT MAX(id) FROM road_segments), 1))"))


async def _main(source: str, network_type: str) -> None:
    from app.db import SessionLocal
    from app.seed.data import ZONES

    nodes, segments = build(source, [z["polygon"] for z in ZONES], network_type)
    async with SessionLocal() as session:
        await store_graph(session, nodes, segments)
        await session.commit()
    print("[graph] stored. Restart the API so workers reload the graph.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", choices=["osm", "synthetic"], default="osm")
    parser.add_argument("--network", choices=["walk", "drive"], default="walk",
                        help="OSM network type; 'walk' contains steps needed for step-free routing")
    args = parser.parse_args()
    asyncio.run(_main(args.source, args.network))
