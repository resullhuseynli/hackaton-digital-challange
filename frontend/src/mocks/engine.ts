/* In-browser simulation of the backend used in mock mode (VITE_USE_MOCKS=true). */
import type { LineString, Polygon, Position } from 'geojson';
import {
  along,
  distanceToLine,
  haversine,
  lineLength,
  pointInPolygon,
  randomWithin,
} from '@/lib/geo';
import type {
  Alert,
  AssemblyPoint,
  Brigade,
  BrigadeType,
  CitizenStatus,
  Id,
  LatLng,
  NearestPoint,
  Overview,
  RoadFeature,
  RoadStatus,
  Route,
  RouteReason,
  SimSosBurst,
  Sos,
  SosStatus,
  SosType,
  TimeseriesBucket,
  Zone,
} from '@/types/api';
import { compareSos } from '@/lib/sosOrder';
import { BRIGADES, POINTS, ROADS, SOS_NOTES, ZONES } from './data';

const WALK_M_PER_MIN = 80;
const DRIVE_M_PER_MIN = 600;
const BRIGADE_SIM_SPEED_MPS = 45; // accelerated for demos
const CLUSTER_RADIUS_M = 500;
const CLUSTER_WINDOW_MIN = 10;
const CLUSTER_MIN_CITIZENS = 4;
const SOS_COOLDOWN_S = 60;
const NEAR_FULL_PCT = 85;

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const rid = () => Math.floor(Math.random() * 900_000_000) + 100_000;
const nowIso = () => new Date().toISOString();
const same = (a: Id | null | undefined, b: Id | null | undefined) =>
  a != null && b != null && String(a) === String(b);
const ll = (p: { lat: number; lng: number }): LatLng => ({ lat: p.lat, lng: p.lng });
const rnd = <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)];

interface MockCitizen {
  id: number;
  device_id: string;
  status: CitizenStatus;
  lat: number | null;
  lng: number | null;
  route: Route | null;
  lastSosAt: number | null;
  sos: Sos[];
}

interface BrigadeTask {
  owner: string;
  phase: 'en_route' | 'on_site' | 'returning';
  route: LineString;
  total: number;
  traveled: number;
  onSiteUntil: number;
  home: LatLng;
}

type Replication =
  | { k: 'sos'; sos: Sos }
  | { k: 'brigade'; brigade: Brigade }
  | { k: 'point'; point: AssemblyPoint }
  | { k: 'road'; road: RoadFeature }
  | { k: 'reset' };

type Listener = (frame: string) => void;

export class MockEngine {
  readonly tabId = Math.random().toString(36).slice(2);
  zones: Zone[] = clone(ZONES);
  points: AssemblyPoint[] = [];
  roads: RoadFeature[] = [];
  brigades: Brigade[] = [];
  sos: Sos[] = [];
  alerts: Alert[] = [];
  buckets = new Map<number, TimeseriesBucket>();
  citizens = new Map<string, MockCitizen>();
  private homes = new Map<string, LatLng>();
  private tasks = new Map<string, BrigadeTask>();
  private noAutoAssign = new Set<string>();
  private overloadAlerted = new Set<string>();
  private checkIns = 0;
  private dispatchListeners = new Set<Listener>();
  private citizenListeners = new Map<string, Set<Listener>>();
  private channel: BroadcastChannel | null = null;
  private overviewTimer: number | null = null;
  private tickCount = 0;

  constructor() {
    this.loadCitizens();
    this.seed();
    try {
      this.channel = new BroadcastChannel('evac-mock-sync');
      this.channel.onmessage = (e: MessageEvent<Replication>) => this.applyRemote(e.data);
    } catch {
      this.channel = null;
    }
    window.setInterval(() => this.tick(), 1000);
  }

  // ------------------------------------------------------------------ setup
  private seed() {
    this.points = clone(POINTS);
    this.roads = clone(ROADS);
    this.brigades = clone(BRIGADES);
    this.homes = new Map(this.brigades.map((b) => [String(b.id), ll(b)]));
    this.sos = [];
    this.alerts = [];
    this.tasks.clear();
    this.noAutoAssign.clear();
    this.overloadAlerted.clear();
    this.buckets.clear();
    this.checkIns = 0;

    const now = Date.now();
    for (let m = 30; m >= 0; m--) {
      const key = this.minuteKey(now - m * 60_000);
      this.buckets.set(key, {
        ts: new Date(key).toISOString(),
        fire: Math.random() < 0.5 ? Math.round(Math.random() * 2) : 0,
        collapse: Math.random() < 0.3 ? 1 : 0,
        flood: Math.random() < 0.25 ? 1 : 0,
        medical: Math.round(Math.random() * 2),
      });
    }
    // A handful of existing incidents.
    for (let i = 0; i < 14; i++) {
      const z = rnd(this.zones);
      const c = z.center ?? { lat: 40.4, lng: 49.86 };
      const p = randomWithin(c, 1400);
      const created = new Date(now - Math.random() * 25 * 60_000).toISOString();
      const s = this.makeSos(rid(), rnd(['fire', 'collapse', 'flood', 'medical']), p, created);
      if (i < 3) s.status = 'resolved';
      this.sos.push(s);
      this.noAutoAssign.add(String(s.id));
    }
  }

  private loadCitizens() {
    try {
      const raw = localStorage.getItem('evac.mock.citizens');
      if (!raw) return;
      const list = JSON.parse(raw) as MockCitizen[];
      for (const c of list) this.citizens.set(c.device_id, c);
    } catch {
      /* ignore */
    }
  }

  private saveCitizens() {
    try {
      localStorage.setItem('evac.mock.citizens', JSON.stringify([...this.citizens.values()]));
    } catch {
      /* ignore */
    }
  }

  reset(fromRemote = false) {
    this.seed();
    for (const c of this.citizens.values()) {
      c.route = null;
      c.lastSosAt = null;
      c.sos = [];
      c.status = 'unknown';
    }
    this.saveCitizens();
    if (!fromRemote) this.replicate({ k: 'reset' });
    this.scheduleOverview();
  }

  // -------------------------------------------------------------- listeners
  addDispatchListener(fn: Listener) {
    this.dispatchListeners.add(fn);
    this.scheduleOverview();
    return () => this.dispatchListeners.delete(fn);
  }

  addCitizenListener(deviceId: string, fn: Listener) {
    const set = this.citizenListeners.get(deviceId) ?? new Set<Listener>();
    set.add(fn);
    this.citizenListeners.set(deviceId, set);
    return () => set.delete(fn);
  }

  private frame(type: string, data: unknown) {
    return JSON.stringify({ type, data, ts: nowIso() });
  }

  private emitD(type: string, data: unknown) {
    if (!this.dispatchListeners.size) return;
    const f = this.frame(type, data);
    this.dispatchListeners.forEach((l) => l(f));
  }

  private emitC(deviceId: string | null, type: string, data: unknown) {
    const f = this.frame(type, data);
    if (deviceId == null) {
      this.citizenListeners.forEach((set) => set.forEach((l) => l(f)));
      return;
    }
    this.citizenListeners.get(deviceId)?.forEach((l) => l(f));
  }

  private replicate(msg: Replication) {
    try {
      this.channel?.postMessage(msg);
    } catch {
      /* ignore */
    }
  }

  private applyRemote(msg: Replication) {
    switch (msg.k) {
      case 'reset':
        this.reset(true);
        this.emitD('overview.updated', this.overview());
        break;
      case 'sos': {
        const idx = this.sos.findIndex((s) => same(s.id, msg.sos.id));
        if (idx >= 0) {
          this.sos[idx] = msg.sos;
          this.emitD('sos.updated', msg.sos);
        } else {
          this.sos.push(msg.sos);
          this.bump(msg.sos);
          this.emitD('sos.created', msg.sos);
          this.detectCluster(msg.sos);
        }
        this.syncCitizenSos(msg.sos);
        this.scheduleOverview();
        break;
      }
      case 'brigade': {
        const idx = this.brigades.findIndex((b) => same(b.id, msg.brigade.id));
        if (idx >= 0) this.brigades[idx] = msg.brigade;
        // Another tab drives this brigade now.
        const t = this.tasks.get(String(msg.brigade.id));
        if (t && t.owner === this.tabId) this.tasks.delete(String(msg.brigade.id));
        this.emitD('brigade.updated', msg.brigade);
        this.scheduleOverview();
        break;
      }
      case 'point': {
        const idx = this.points.findIndex((p) => same(p.id, msg.point.id));
        const before = idx >= 0 ? this.points[idx] : null;
        if (idx >= 0) this.points[idx] = msg.point;
        this.emitPoint(msg.point);
        this.checkPointReroutes(msg.point, before);
        this.scheduleOverview();
        break;
      }
      case 'road': {
        const idx = this.roads.findIndex((r) => same(r.properties.id, msg.road.properties.id));
        if (idx >= 0) this.roads[idx] = msg.road;
        this.emitD('road.updated', msg.road);
        if (msg.road.properties.status === 'closed') this.checkRoadReroutes(msg.road);
        break;
      }
    }
  }

  // ---------------------------------------------------------------- helpers
  private minuteKey(t: number) {
    return Math.floor(t / 60_000) * 60_000;
  }

  zoneOf(p: LatLng): Zone | null {
    for (const z of this.zones) {
      const g = z.geometry as Polygon | undefined;
      if (g && pointInPolygon(p, g.coordinates[0])) return z;
    }
    return null;
  }

  private makeSos(
    id: Id,
    type: SosType,
    p: LatLng,
    createdAt = nowIso(),
    citizenId: Id = rid(),
  ): Sos {
    const base = { medical: 72, collapse: 78, fire: 66, flood: 54 }[type];
    return {
      id,
      citizen_id: citizenId,
      type,
      lat: p.lat,
      lng: p.lng,
      zone_id: this.zoneOf(p)?.id ?? null,
      note: rnd(SOS_NOTES),
      priority_score: Math.min(100, base + Math.round(Math.random() * 18)),
      status: 'new',
      assigned_brigade_id: null,
      brigade_eta_min: null,
      created_at: createdAt,
      citizen_mobility_impaired: false,
      labels: [],
    };
  }

  private bump(s: Sos) {
    const key = this.minuteKey(new Date(s.created_at).getTime());
    const b =
      this.buckets.get(key) ??
      ({
        ts: new Date(key).toISOString(),
        fire: 0,
        collapse: 0,
        flood: 0,
        medical: 0,
      } as TimeseriesBucket);
    b[s.type] += 1;
    this.buckets.set(key, b);
  }

  private recomputePct(p: AssemblyPoint) {
    p.current_count = Math.max(0, Math.min(Math.round(p.capacity * 1.05), p.current_count));
    p.occupancy_pct = Math.round((p.current_count / p.capacity) * 1000) / 10;
  }

  private emitPoint(p: AssemblyPoint) {
    const data = { ...p, point_id: p.id };
    this.emitD('point.occupancy', data);
    this.emitC(null, 'point.occupancy', data);
  }

  overview(): Overview {
    const active = this.sos.filter((s) => s.status !== 'resolved');
    const resolved = this.sos.length - active.length;
    const activePoints = this.points.filter((p) => p.status === 'active');
    const localSafe = [...this.citizens.values()].filter((c) => c.status === 'safe').length;
    return {
      active_sos: active.length,
      resolved_sos: 57 + resolved,
      active_sos_mobility_impaired: active.filter((s) => s.citizen_mobility_impaired).length,
      citizens_safe: 1240 + resolved * 2 + this.checkIns + localSafe,
      citizens_in_danger: 286 + new Set(active.map((s) => String(s.citizen_id))).size,
      brigades_idle: this.brigades.filter((b) => b.status === 'idle').length,
      brigades_busy: this.brigades.filter((b) => b.status !== 'idle').length,
      active_alerts: this.alerts.filter((a) => a.status === 'active').length,
      avg_occupancy_pct:
        Math.round(
          (activePoints.reduce((a, p) => a + p.occupancy_pct, 0) /
            Math.max(1, activePoints.length)) *
            10,
        ) / 10,
    };
  }

  private scheduleOverview() {
    if (this.overviewTimer != null) return;
    this.overviewTimer = window.setTimeout(() => {
      this.overviewTimer = null;
      this.emitD('overview.updated', this.overview());
    }, 600);
  }

  timeseries(minutes: number): TimeseriesBucket[] {
    const now = Date.now();
    const out: TimeseriesBucket[] = [];
    for (let m = minutes - 1; m >= 0; m--) {
      const key = this.minuteKey(now - m * 60_000);
      out.push(
        this.buckets.get(key) ?? {
          ts: new Date(key).toISOString(),
          fire: 0,
          collapse: 0,
          flood: 0,
          medical: 0,
        },
      );
    }
    return out;
  }

  // ---------------------------------------------------------------- routing
  private closedRoads() {
    return this.roads.filter((r) => r.properties.status === 'closed');
  }

  private densify(coords: Position[], stepM = 120): Position[] {
    const out: Position[] = [coords[0]];
    for (let i = 1; i < coords.length; i++) {
      const a = coords[i - 1];
      const b = coords[i];
      const d = haversine({ lng: a[0], lat: a[1] }, { lng: b[0], lat: b[1] });
      const n = Math.max(1, Math.round(d / stepM));
      for (let k = 1; k <= n; k++) {
        out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
      }
    }
    return out;
  }

  /** L-shaped / detour path candidates; picks the first that stays clear of closed roads. */
  buildPath(from: LatLng, to: LatLng, avoidWithinM = 120): LineString {
    const f: Position = [from.lng, from.lat];
    const t: Position = [to.lng, to.lat];
    const mid: Position = [(f[0] + t[0]) / 2, (f[1] + t[1]) / 2];
    const dx = t[0] - f[0];
    const dy = t[1] - f[1];
    const off = 0.45;
    const candidates: Position[][] = [
      [f, [f[0] + dx * 0.15, f[1] + dy * 0.55], [f[0] + dx * 0.7, f[1] + dy * 0.75], t],
      [f, [t[0], f[1]], t],
      [f, [f[0], t[1]], t],
      [f, [mid[0] - dy * off, mid[1] + dx * off], t],
      [f, [mid[0] + dy * off, mid[1] - dx * off], t],
    ];
    const closed = this.closedRoads();
    for (const c of candidates) {
      const line: LineString = { type: 'LineString', coordinates: this.densify(c) };
      const blocked = closed.some((r) =>
        this.densify(r.geometry.coordinates, 40).some(
          (p) => distanceToLine({ lng: p[0], lat: p[1] }, line) < avoidWithinM,
        ),
      );
      if (!blocked) return line;
    }
    return { type: 'LineString', coordinates: this.densify(candidates[3]) };
  }

  private makeRoute(
    from: LatLng,
    point: AssemblyPoint,
    reason: RouteReason,
    version: number,
  ): Route {
    // After a closure, keep a wide berth so the detour is visibly different.
    const geometry = this.buildPath(from, ll(point), reason === 'road_closed' ? 450 : 120);
    const distance = lineLength(geometry);
    return {
      id: rid(),
      target_point_id: point.id,
      geometry,
      distance_m: Math.round(distance),
      eta_min: Math.max(1, Math.round(distance / WALK_M_PER_MIN)),
      version,
      reason,
      accessible: false,
      created_at: nowIso(),
    };
  }

  // ---------------------------------------------------------------- citizen
  citizen(deviceId: string): MockCitizen {
    let c = this.citizens.get(deviceId);
    if (!c) {
      c = {
        id: rid(),
        device_id: deviceId,
        status: 'unknown',
        lat: null,
        lng: null,
        route: null,
        lastSosAt: null,
        sos: [],
      };
      this.citizens.set(deviceId, c);
      this.saveCitizens();
    }
    return c;
  }

  setCitizenLocation(deviceId: string, lat: number, lng: number) {
    const c = this.citizen(deviceId);
    c.lat = lat;
    c.lng = lng;
    this.saveCitizens();
  }

  setCitizenStatus(deviceId: string, status: CitizenStatus) {
    const c = this.citizen(deviceId);
    c.status = status;
    this.saveCitizens();
    this.scheduleOverview();
    return c;
  }

  nearest(p: LatLng, limit = 5, exclude?: Id): NearestPoint[] {
    return this.points
      .filter((pt) => pt.status === 'active' && !same(pt.id, exclude))
      .map((pt) => {
        const distance = haversine(p, ll(pt)) * 1.25;
        const crowd = Math.max(0, pt.occupancy_pct - 70) / 30;
        return {
          point: pt,
          distance_m: Math.round(distance),
          eta_min: Math.max(1, Math.round(distance / WALK_M_PER_MIN)),
          score: Math.round(distance * (1 + crowd * 1.5)),
          near_full: pt.occupancy_pct >= NEAR_FULL_PCT,
        };
      })
      .sort((a, b) => a.score - b.score)
      .slice(0, limit);
  }

  createCitizenRoute(deviceId: string, pointId: Id, from: LatLng): Route | null {
    const point = this.points.find((p) => same(p.id, pointId));
    if (!point) return null;
    const c = this.citizen(deviceId);
    c.lat = from.lat;
    c.lng = from.lng;
    c.route = this.makeRoute(from, point, 'initial', (c.route?.version ?? 0) + 1);
    this.saveCitizens();
    return c.route;
  }

  checkIn(deviceId: string, pointId: Id) {
    const point = this.points.find((p) => same(p.id, pointId));
    if (!point) return null;
    point.current_count += 1;
    this.recomputePct(point);
    this.checkIns += 1;
    const c = this.citizen(deviceId);
    c.status = 'safe';
    c.route = null;
    this.saveCitizens();
    this.emitPoint(point);
    this.replicate({ k: 'point', point });
    this.scheduleOverview();
    return point;
  }

  private reroute(c: MockCitizen, target: AssemblyPoint, reason: RouteReason) {
    if (!c.route || c.lat == null || c.lng == null) return;
    const old = c.route;
    const next = this.makeRoute({ lat: c.lat, lng: c.lng }, target, reason, old.version + 1);
    c.route = next;
    this.saveCitizens();
    const data = {
      old_route: old,
      new_route: next,
      reason,
      eta_diff_min: next.eta_min - old.eta_min,
      citizen_id: c.id,
    };
    this.emitC(c.device_id, 'route.rerouted', data);
    this.emitD('route.rerouted', data);
  }

  private checkRoadReroutes(road: RoadFeature) {
    for (const c of this.citizens.values()) {
      if (!c.route) continue;
      const near = this.densify(road.geometry.coordinates, 40).some(
        (p) => distanceToLine({ lng: p[0], lat: p[1] }, c.route!.geometry) < 400,
      );
      if (!near) continue;
      const target = this.points.find((p) => same(p.id, c.route!.target_point_id));
      if (target) this.reroute(c, target, 'road_closed');
    }
  }

  private checkPointReroutes(point: AssemblyPoint, before: AssemblyPoint | null) {
    for (const c of this.citizens.values()) {
      if (!c.route || c.lat == null || c.lng == null) continue;
      const here = { lat: c.lat, lng: c.lng };
      if (same(c.route.target_point_id, point.id) && point.occupancy_pct >= 90) {
        const alt = this.nearest(here, 1, point.id)[0];
        if (alt) this.reroute(c, alt.point, 'point_full');
        continue;
      }
      const opened = before?.status === 'reserve' && point.status === 'active';
      if (opened) {
        const current = this.points.find((p) => same(p.id, c.route!.target_point_id));
        const dNew = haversine(here, ll(point));
        const dOld = current ? haversine(here, ll(current)) : Infinity;
        if (dNew < dOld * 1.3 || dNew < 2500) this.reroute(c, point, 'alert_new_point');
      }
    }
  }

  // -------------------------------------------------------------------- SOS
  sosCooldownLeft(deviceId: string): number {
    const c = this.citizen(deviceId);
    if (!c.lastSosAt) return 0;
    return Math.max(0, Math.ceil(SOS_COOLDOWN_S - (Date.now() - c.lastSosAt) / 1000));
  }

  createCitizenSos(deviceId: string, type: SosType, p: LatLng, note?: string): Sos {
    const c = this.citizen(deviceId);
    const s = this.makeSos(rid(), type, p, nowIso(), c.id);
    s.note = note ?? null;
    c.lastSosAt = Date.now();
    c.status = 'in_danger';
    c.sos = [s, ...c.sos].slice(0, 10);
    this.saveCitizens();
    this.addSos(s);
    // Demo: auto-dispatch if nobody assigns within 12 s.
    window.setTimeout(() => {
      const cur = this.sos.find((x) => same(x.id, s.id));
      if (cur && cur.status === 'new') this.autoAssign(cur);
    }, 12_000);
    return s;
  }

  private addSos(s: Sos) {
    this.sos.push(s);
    this.bump(s);
    this.emitD('sos.created', s);
    this.replicate({ k: 'sos', sos: s });
    this.detectCluster(s);
    this.scheduleOverview();
  }

  private updateSos(s: Sos) {
    this.emitD('sos.updated', s);
    this.syncCitizenSos(s);
    this.replicate({ k: 'sos', sos: s });
    this.scheduleOverview();
  }

  private syncCitizenSos(s: Sos) {
    for (const c of this.citizens.values()) {
      const i = c.sos.findIndex((x) => same(x.id, s.id));
      if (i >= 0) {
        c.sos[i] = s;
        this.saveCitizens();
        this.emitC(c.device_id, 'sos.updated', s);
      }
    }
  }

  listSos(f: { status?: string | null; zone_id?: string | null; type?: string | null }) {
    return this.sos
      .filter((s) => !f.status || s.status === f.status)
      .filter((s) => !f.zone_id || String(s.zone_id) === f.zone_id)
      .filter((s) => !f.type || s.type === f.type)
      .sort(compareSos); // same order as the backend: ♿ first, then priority, then oldest
  }

  resolveSos(id: Id): Sos | null {
    const s = this.sos.find((x) => same(x.id, id));
    if (!s) return null;
    s.status = 'resolved';
    s.brigade_eta_min = null;
    this.updateSos(s);
    // Send the assigned brigade home on the next tick.
    const b = this.brigades.find((x) => same(x.target_sos_id, s.id));
    const t = b ? this.tasks.get(String(b.id)) : undefined;
    if (t) {
      t.phase = 'on_site';
      t.onSiteUntil = 0;
    }
    return s;
  }

  // -------------------------------------------------------------- brigades
  private etaFor(b: Brigade, p: LatLng) {
    return Math.max(1, Math.round((haversine(ll(b), p) * 1.3) / DRIVE_M_PER_MIN));
  }

  private bestBrigade(p: LatLng, prefer?: BrigadeType): Brigade | null {
    const idle = this.brigades.filter((b) => b.status === 'idle');
    if (!idle.length) return null;
    const scored = idle
      .map((b) => ({ b, d: haversine(ll(b), p) * (prefer && b.type !== prefer ? 1.8 : 1) }))
      .sort((a, b) => a.d - b.d);
    return scored[0].b;
  }

  private autoAssign(s: Sos) {
    const prefer: BrigadeType =
      s.type === 'fire' ? 'fire' : s.type === 'medical' ? 'medical' : 'rescue';
    const b = this.bestBrigade(ll(s), prefer);
    if (b) this.assign(b.id, s.id);
  }

  assign(brigadeId: Id, sosId: Id): Brigade | null {
    const b = this.brigades.find((x) => same(x.id, brigadeId));
    const s = this.sos.find((x) => same(x.id, sosId));
    if (!b || !s) return null;
    const route = this.buildPath(ll(b), ll(s), 0);
    b.status = 'en_route';
    b.target_sos_id = s.id;
    b.route_geometry = route;
    this.tasks.set(String(b.id), {
      owner: this.tabId,
      phase: 'en_route',
      route,
      total: lineLength(route),
      traveled: 0,
      onSiteUntil: 0,
      home: this.homes.get(String(b.id)) ?? ll(b),
    });
    s.status = 'assigned';
    s.assigned_brigade_id = b.id;
    s.brigade_eta_min = this.etaFor(b, ll(s));
    this.emitD('brigade.updated', b);
    this.replicate({ k: 'brigade', brigade: b });
    this.updateSos(s);
    return b;
  }

  idleBrigadesFor(p: LatLng) {
    return this.brigades
      .filter((b) => b.status === 'idle')
      .map((b) => ({ brigade: b, eta_min: this.etaFor(b, p) }))
      .sort((a, b) => a.eta_min - b.eta_min);
  }

  private moveBrigades() {
    const now = Date.now();
    for (const [id, t] of this.tasks) {
      if (t.owner !== this.tabId) continue;
      const b = this.brigades.find((x) => String(x.id) === id);
      if (!b) continue;
      if (t.phase === 'on_site') {
        if (now >= t.onSiteUntil) {
          const s = this.sos.find((x) => same(x.id, b.target_sos_id));
          if (s && s.status !== 'resolved') {
            s.status = 'resolved';
            s.brigade_eta_min = null;
            this.updateSos(s);
          }
          const back = this.buildPath(ll(b), t.home, 0);
          Object.assign(t, {
            phase: 'returning',
            route: back,
            total: lineLength(back),
            traveled: 0,
          });
          b.status = 'returning';
          b.target_sos_id = null;
          b.route_geometry = back;
          this.emitD('brigade.updated', b);
          this.replicate({ k: 'brigade', brigade: b });
        }
        continue;
      }
      t.traveled = Math.min(t.total, t.traveled + BRIGADE_SIM_SPEED_MPS);
      const p = along(t.route, t.total ? t.traveled / t.total : 1);
      b.lat = p.lat;
      b.lng = p.lng;
      const arrived = t.traveled >= t.total;
      if (arrived && t.phase === 'en_route') {
        t.phase = 'on_site';
        t.onSiteUntil = now + 15_000;
        b.status = 'on_site';
        b.route_geometry = null;
        const s = this.sos.find((x) => same(x.id, b.target_sos_id));
        if (s) {
          s.brigade_eta_min = 0;
          this.updateSos(s);
        }
      } else if (arrived && t.phase === 'returning') {
        this.tasks.delete(id);
        b.status = 'idle';
        b.route_geometry = null;
      } else if (t.phase === 'en_route' && this.tickCount % 5 === 0) {
        const s = this.sos.find((x) => same(x.id, b.target_sos_id));
        if (s) {
          s.brigade_eta_min = Math.max(
            1,
            Math.round(((t.total - t.traveled) * 13) / DRIVE_M_PER_MIN / 10),
          );
          this.updateSos(s);
        }
      }
      this.emitD('brigade.updated', b);
      this.replicate({ k: 'brigade', brigade: b });
      if (arrived) this.scheduleOverview();
    }
  }

  // ---------------------------------------------------------------- alerts
  private detectCluster(s: Sos) {
    if (s.status === 'resolved') return;
    const since = Date.now() - CLUSTER_WINDOW_MIN * 60_000;
    const near = this.sos.filter(
      (x) =>
        x.status !== 'resolved' &&
        new Date(x.created_at).getTime() >= since &&
        haversine(ll(x), ll(s)) <= CLUSTER_RADIUS_M,
    );
    const distinct = new Set(near.map((x) => String(x.citizen_id))).size;
    const existing = this.alerts.find(
      (a) =>
        a.status === 'active' &&
        a.kind === 'SOS_CLUSTER' &&
        haversine(a.center, ll(s)) <= CLUSTER_RADIUS_M * 1.2,
    );
    if (existing) {
      const ids = new Set(existing.sos_ids.map(String));
      near.forEach((x) => ids.add(String(x.id)));
      existing.sos_ids = this.sos.filter((x) => ids.has(String(x.id))).map((x) => x.id);
      existing.distinct_citizens = new Set(
        this.sos.filter((x) => ids.has(String(x.id))).map((x) => String(x.citizen_id)),
      ).size;
      existing.updated_at = nowIso();
      this.emitD('alert.updated', existing);
      return;
    }
    if (distinct < CLUSTER_MIN_CITIZENS || !this.dispatchListeners.size) return;
    const center = {
      lat: near.reduce((a, x) => a + x.lat, 0) / near.length,
      lng: near.reduce((a, x) => a + x.lng, 0) / near.length,
    };
    this.raiseAlert(
      'SOS_CLUSTER',
      center,
      near.map((x) => x.id),
      distinct,
      null,
    );
  }

  private raiseAlert(
    kind: Alert['kind'],
    center: LatLng,
    sosIds: Id[],
    distinct: number,
    pointId: Id | null,
  ) {
    const zone = this.zoneOf(center);
    const brigade = this.bestBrigade(center, 'rescue');
    const reserve = this.points
      .filter((p) => p.status === 'reserve')
      .map((p) => ({ p, d: haversine(center, ll(p)) }))
      .sort((a, b) => a.d - b.d)[0];
    const alert: Alert = {
      id: rid(),
      kind,
      zone_id: zone?.id ?? null,
      zone_name: zone?.name ?? null,
      center,
      radius_m: CLUSTER_RADIUS_M,
      sos_ids: sosIds,
      distinct_citizens: distinct,
      point_id: pointId,
      recommended_brigade: brigade
        ? {
            id: brigade.id,
            name: brigade.name,
            type: brigade.type,
            eta_min: this.etaFor(brigade, center),
          }
        : null,
      recommended_new_point: reserve
        ? {
            id: reserve.p.id,
            name: reserve.p.name,
            capacity: reserve.p.capacity,
            distance_m: Math.round(reserve.d),
          }
        : null,
      status: 'active',
      created_at: nowIso(),
      updated_at: nowIso(),
      window_min: CLUSTER_WINDOW_MIN,
      mobility_impaired_sos_ids: [],
      labels: [],
    };
    this.alerts.push(alert);
    this.emitD('alert.raised', alert);
    return alert;
  }

  activeAlerts() {
    return this.alerts.filter((a) => a.status === 'active');
  }

  confirmAlert(id: Id, brigadeId?: Id, pointId?: Id): Alert | null {
    const a = this.alerts.find((x) => same(x.id, id));
    if (!a || a.status !== 'active') return null;
    const bId = brigadeId ?? a.recommended_brigade?.id;
    if (bId != null) {
      const target = this.sos
        .filter((s) => a.sos_ids.some((x) => same(x, s.id)) && s.status === 'new')
        .sort((x, y) => y.priority_score - x.priority_score)[0];
      const b = this.brigades.find((x) => same(x.id, bId));
      if (b && b.status === 'idle') {
        if (target) this.assign(b.id, target.id);
        else {
          const any = this.sos.find((s) => a.sos_ids.some((x) => same(x, s.id)));
          if (any) this.assign(b.id, any.id);
        }
      }
    }
    const pId = pointId ?? a.recommended_new_point?.id;
    const point = this.points.find((p) => same(p.id, pId));
    if (point && point.status !== 'active') {
      const before = { ...point };
      point.status = 'active';
      this.emitPoint(point);
      this.replicate({ k: 'point', point });
      this.checkPointReroutes(point, before);
    }
    a.status = 'confirmed';
    a.updated_at = nowIso();
    this.emitD('alert.resolved', a);
    this.scheduleOverview();
    return a;
  }

  dismissAlert(id: Id): Alert | null {
    const a = this.alerts.find((x) => same(x.id, id));
    if (!a) return null;
    a.status = 'dismissed';
    a.updated_at = nowIso();
    this.emitD('alert.resolved', a);
    return a;
  }

  // ------------------------------------------------------------ simulation
  simRoad(p: LatLng, status: RoadStatus): RoadFeature | null {
    let best: RoadFeature | null = null;
    let bestD = Infinity;
    for (const r of this.roads) {
      const d = distanceToLine(p, r.geometry);
      if (d < bestD) {
        bestD = d;
        best = r;
      }
    }
    if (!best || bestD > 800) return null;
    best.properties.status = status;
    this.emitD('road.updated', best);
    this.replicate({ k: 'road', road: best });
    if (status === 'closed') this.checkRoadReroutes(best);
    return best;
  }

  simOccupancy(pointId: Id, currentCount: number): AssemblyPoint | null {
    const p = this.points.find((x) => same(x.id, pointId));
    if (!p) return null;
    const before = { ...p };
    p.current_count = Math.max(0, Math.round(currentCount));
    this.recomputePct(p);
    this.emitPoint(p);
    this.replicate({ k: 'point', point: p });
    this.checkPointReroutes(p, before);
    this.checkOverload(p);
    this.scheduleOverview();
    return p;
  }

  private checkOverload(p: AssemblyPoint) {
    if (p.status !== 'active' || p.occupancy_pct < 95) {
      if (p.occupancy_pct < 85) this.overloadAlerted.delete(String(p.id));
      return;
    }
    if (this.overloadAlerted.has(String(p.id)) || !this.dispatchListeners.size) return;
    this.overloadAlerted.add(String(p.id));
    this.raiseAlert('POINT_OVERLOAD', ll(p), [], 0, p.id);
  }

  simBurst(body: SimSosBurst) {
    const count = Math.max(1, Math.min(40, Math.round(body.count)));
    const windowMs = Math.max(60, body.window_sec) * 1000;
    const start = Date.now() - windowMs * 0.8;
    for (let i = 0; i < count; i++) {
      window.setTimeout(() => {
        const p = randomWithin({ lat: body.lat, lng: body.lng }, body.radius_m);
        const created = new Date(start + (windowMs * 0.8 * (i + 1)) / count).toISOString();
        const s = this.makeSos(rid(), body.type, p, created);
        this.noAutoAssign.add(String(s.id));
        this.addSos(s);
      }, i * 650);
    }
  }

  // ------------------------------------------------------------------ tick
  private tick() {
    this.tickCount += 1;
    this.moveBrigades();
    if (!this.dispatchListeners.size) return;

    // Ambient incidents (~1 per 10 s).
    if (Math.random() < 0.1) {
      const z = rnd(this.zones);
      const c = z.center ?? { lat: 40.4, lng: 49.86 };
      const s = this.makeSos(
        rid(),
        rnd(['fire', 'collapse', 'flood', 'medical', 'medical']),
        randomWithin(c, 1500),
      );
      this.addSos(s);
    }
    // Auto-dispatch stale ambient incidents to keep the demo alive.
    if (this.tickCount % 7 === 0) {
      const stale = this.sos.find(
        (s) =>
          s.status === 'new' &&
          !this.noAutoAssign.has(String(s.id)) &&
          Date.now() - new Date(s.created_at).getTime() > 50_000,
      );
      if (stale) this.autoAssign(stale);
    }
    // Points slowly fill up as people evacuate.
    if (this.tickCount % 4 === 0) {
      const active = this.points.filter((p) => p.status === 'active' && p.occupancy_pct < 99);
      if (active.length) {
        const p = rnd(active);
        p.current_count += Math.round(p.capacity * (0.002 + Math.random() * 0.01));
        this.recomputePct(p);
        this.emitPoint(p);
        this.replicate({ k: 'point', point: p });
        this.checkPointReroutes(p, null);
        this.checkOverload(p);
        this.scheduleOverview();
      }
    }
  }
}

let engine: MockEngine | null = null;
export function getEngine(): MockEngine {
  if (!engine) engine = new MockEngine();
  return engine;
}

export type MockSosStatus = SosStatus;
