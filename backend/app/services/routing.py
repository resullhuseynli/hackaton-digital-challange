"""In-memory road graph (NetworkX DiGraph) with A* routing.

Edge weight (seconds):
  drive: length_m / (speed_kmh / 3.6) * congestion_factor
  walk : length_m / (walk_speed_kmh / 3.6) * congestion_factor   (default mode: evacuation on foot)
  walk + accessible: segments with a barrier (stairs, steep slope, underpass...) are skipped and the
         slower ACCESSIBLE_WALK_SPEED_KMH is used - for persons with reduced mobility.
Closed segments are removed from the routing graph; `set_segment` keeps it in sync with the DB.
"""
import json
import math
from dataclasses import dataclass

import networkx as nx
import numpy as np
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.geo import haversine_m
from app.models import RoadNode, RoadSegment

WALK = "walk"
DRIVE = "drive"
SNAP_DRIVE_KMH = 30.0  # speed for the off-graph leg between a coordinate and its snapped node


@dataclass
class Segment:
    id: int
    u: int
    v: int
    length_m: float
    speed_kmh: float
    status: str
    factor: float
    coords: list[tuple[float, float]]  # (lng, lat)
    barrier: str | None = None       # current barrier (stairs/steep/underpass/...), None = step-free
    base_barrier: str | None = None  # barrier from the seed graph; restored by reset()

    @property
    def accessible(self) -> bool:
        return self.barrier is None


@dataclass
class RouteResult:
    node_path: list[int]
    segment_ids: list[int]
    coords: list[tuple[float, float]]  # (lng, lat)
    distance_m: float
    duration_s: float
    accessible: bool = False  # computed in step-free mode

    @property
    def eta_min(self) -> float:
        return round(self.duration_s / 60.0, 2)


class RoadGraph:
    def __init__(self) -> None:
        self.g = nx.DiGraph()
        self.segments: dict[int, Segment] = {}
        self.by_nodes: dict[tuple[int, int], int] = {}
        self.nodes: dict[int, tuple[float, float]] = {}
        self._ids = np.empty(0, dtype=np.int64)
        self._lat = np.empty(0)
        self._lng = np.empty(0)
        self.max_speed_kmh = 60.0
        self.loaded = False
        # Undirected copy for pedestrians (one-way rules don't apply on foot); rebuilt lazily.
        self._walk_g: nx.Graph | None = None

    # ---------------------------------------------------------------- building
    def build(self, nodes: list[tuple[int, float, float]], segments: list[Segment]) -> None:
        self.g = nx.DiGraph()
        self.segments, self.by_nodes, self.nodes = {}, {}, {}
        for nid, lng, lat in nodes:
            self.nodes[nid] = (lng, lat)
            self.g.add_node(nid)
        for s in segments:
            self.segments[s.id] = s
            self.by_nodes[(s.u, s.v)] = s.id
            if s.status != "closed":
                self._add_edge(s)
        self._ids = np.fromiter(self.nodes.keys(), dtype=np.int64, count=len(self.nodes))
        self._lng = np.array([self.nodes[i][0] for i in self._ids])
        self._lat = np.array([self.nodes[i][1] for i in self._ids])
        self.max_speed_kmh = max((s.speed_kmh for s in segments), default=60.0)
        self._walk_g = None
        self.loaded = True

    async def load(self, session: AsyncSession) -> None:
        node_rows = (await session.execute(
            select(RoadNode.id, func.ST_X(RoadNode.location), func.ST_Y(RoadNode.location)))).all()
        seg_rows = (await session.execute(select(
            RoadSegment.id, RoadSegment.from_node, RoadSegment.to_node, RoadSegment.length_m, RoadSegment.speed_kmh,
            RoadSegment.status, RoadSegment.congestion_factor, func.ST_AsGeoJSON(RoadSegment.geometry),
            RoadSegment.barrier, RoadSegment.base_barrier))).all()
        segments = [Segment(r[0], r[1], r[2], r[3], r[4], r[5], r[6],
                            [tuple(c) for c in json.loads(r[7])["coordinates"]], r[8], r[9]) for r in seg_rows]
        self.build([(r[0], r[1], r[2]) for r in node_rows], segments)

    def _add_edge(self, s: Segment) -> None:
        self.g.add_edge(s.u, s.v, segment_id=s.id, length_m=s.length_m, speed_kmh=s.speed_kmh, factor=s.factor,
                        accessible=s.accessible)

    # ------------------------------------------------------------------ sync
    def set_segment(self, segment_id: int, status: str, factor: float = 1.0) -> None:
        s = self.segments.get(segment_id)
        if s is None:
            return
        s.status, s.factor = status, factor
        self._walk_g = None
        if status == "closed":
            if self.g.has_edge(s.u, s.v) and self.g[s.u][s.v]["segment_id"] == s.id:
                self.g.remove_edge(s.u, s.v)
        else:
            self._add_edge(s)

    def set_barrier(self, segment_id: int, barrier: str | None) -> None:
        s = self.segments.get(segment_id)
        if s is None:
            return
        s.barrier = barrier
        self._walk_g = None
        if self.g.has_edge(s.u, s.v) and self.g[s.u][s.v]["segment_id"] == s.id:
            self.g[s.u][s.v]["accessible"] = s.accessible

    def reset(self) -> None:
        self._walk_g = None
        for s in self.segments.values():
            s.status, s.factor, s.barrier = "open", 1.0, s.base_barrier
            self._add_edge(s)

    def twin(self, segment_id: int) -> int | None:
        s = self.segments.get(segment_id)
        return self.by_nodes.get((s.v, s.u)) if s else None

    # -------------------------------------------------------------- queries
    def nearest_nodes(self, lat: float, lng: float, k: int = 5) -> list[tuple[int, float]]:
        if not len(self._ids):
            return []
        dx = (self._lng - lng) * math.cos(math.radians(lat))
        dy = self._lat - lat
        d2 = dx * dx + dy * dy
        k = min(k, len(d2))
        idx = np.argpartition(d2, k - 1)[:k]
        idx = idx[np.argsort(d2[idx])]
        return [(int(self._ids[i]), haversine_m(lat, lng, self._lat[i], self._lng[i])) for i in idx]

    @staticmethod
    def _walk_kmh(accessible: bool) -> float:
        return settings.accessible_walk_speed_kmh if accessible else settings.walk_speed_kmh

    def _weight_fn(self, mode: str, accessible: bool = False):
        if mode == WALK:
            walk_ms = self._walk_kmh(accessible) / 3.6
            if accessible:  # returning None hides the edge from A*
                return lambda u, v, d: d["length_m"] / walk_ms * d["factor"] if d.get("accessible", True) else None
            return lambda u, v, d: d["length_m"] / walk_ms * d["factor"]
        return lambda u, v, d: d["length_m"] / (d["speed_kmh"] / 3.6) * d["factor"]

    def _heuristic(self, mode: str, accessible: bool = False):
        vmax = (self._walk_kmh(accessible) if mode == WALK else self.max_speed_kmh) / 3.6
        nodes = self.nodes

        def h(a: int, b: int) -> float:
            (x1, y1), (x2, y2) = nodes[a], nodes[b]
            return haversine_m(y1, x1, y2, x2) / vmax
        return h

    def distances_to(self, lat: float, lng: float) -> tuple[dict[int, float], float]:
        """Driving distance (m) from EVERY node to the point, via one Dijkstra on the reversed directed
        graph (instead of one A* per vehicle). Returns ({node: meters}, snap distance of the target)."""
        ends = [(n, d) for n, d in self.nearest_nodes(lat, lng, 6) if self.g.in_degree(n) > 0]
        if not ends:
            return {}, 0.0
        target, snap = ends[0]
        lengths = nx.single_source_dijkstra_path_length(self.g.reverse(copy=False), target, weight="length_m")
        return lengths, snap

    def _graph_for(self, mode: str) -> nx.Graph:
        """Vehicles follow one-way rules (directed graph); pedestrians may walk either way."""
        if mode != WALK:
            return self.g
        if self._walk_g is None:
            self._walk_g = self.g.to_undirected()
        return self._walk_g

    def route(self, start_lat: float, start_lng: float, end_lat: float, end_lng: float,
              mode: str = WALK, accessible: bool = False) -> RouteResult | None:
        """A* between two coordinates, snapping each to a nearby graph node that still has open roads
        (with accessible=True: a node that still has a step-free road)."""
        g = self._graph_for(mode)
        accessible = accessible and mode == WALK
        if accessible:
            ok = lambda n: any(d.get("accessible", True) for _, _, d in g.edges(n, data=True))  # noqa: E731
            starts = [n for n, _ in self.nearest_nodes(start_lat, start_lng, 10) if ok(n)][:3]
            ends = [n for n, _ in self.nearest_nodes(end_lat, end_lng, 10) if ok(n)][:3]
        elif mode == WALK:
            starts = [n for n, _ in self.nearest_nodes(start_lat, start_lng, 6) if g.degree(n) > 0][:3]
            ends = [n for n, _ in self.nearest_nodes(end_lat, end_lng, 6) if g.degree(n) > 0][:3]
        else:
            starts = [n for n, _ in self.nearest_nodes(start_lat, start_lng, 6) if g.out_degree(n) > 0][:3]
            ends = [n for n, _ in self.nearest_nodes(end_lat, end_lng, 6) if g.in_degree(n) > 0][:3]
        weight, h = self._weight_fn(mode, accessible), self._heuristic(mode, accessible)
        for s in starts:
            for t in ends:
                try:
                    path = nx.astar_path(g, s, t, heuristic=h, weight=weight)
                except nx.NetworkXNoPath:
                    continue
                return self._result(g, path, (start_lat, start_lng), (end_lat, end_lng), mode, weight, accessible)
        return None

    def _result(self, g: nx.Graph, path, start, end, mode, weight, accessible: bool = False) -> RouteResult:
        seg_ids: list[int] = []
        first = self.nodes[path[0]]
        coords: list[tuple[float, float]] = [(start[1], start[0]), first]
        distance = duration = 0.0
        for a, b in zip(path, path[1:]):
            d = g[a][b]
            seg = self.segments[d["segment_id"]]
            if seg.u != a:
                # Walk graph is undirected: prefer the segment stored in the walked direction so
                # segment ids stay consistent with closures/rerouting; else walk a one-way street backwards.
                twin = self.by_nodes.get((a, b))
                if twin is not None and self.segments[twin].status != "closed" and (
                        not accessible or self.segments[twin].accessible):
                    seg = self.segments[twin]
            seg_ids.append(seg.id)
            distance += seg.length_m
            duration += weight(a, b, d)
            pts = seg.coords if seg.u == a else seg.coords[::-1]
            coords.extend(pts[1:])
        last = self.nodes[path[-1]]
        coords.append((end[1], end[0]))
        legs = haversine_m(start[0], start[1], first[1], first[0]) + haversine_m(last[1], last[0], end[0], end[1])
        leg_speed = (self._walk_kmh(accessible) if mode == WALK else SNAP_DRIVE_KMH) / 3.6
        distance += legs
        duration += legs / leg_speed
        dedup = [coords[0]] + [c for p, c in zip(coords, coords[1:]) if c != p]
        return RouteResult(list(path), seg_ids, dedup, round(distance, 1), duration, accessible)


graph = RoadGraph()
