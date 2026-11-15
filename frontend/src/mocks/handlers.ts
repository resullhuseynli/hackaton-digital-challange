import { delay, http, HttpResponse, ws } from 'msw';
import { env } from '@/lib/env';
import type {
  CitizenStatus,
  Id,
  RoadCollection,
  RoadStatus,
  SimOccupancy,
  SimRoadClosure,
  SimSosBurst,
  SosType,
} from '@/types/api';
import { getEngine } from './engine';

const API = env.apiUrl;

const err = (status: number, code: string, message: string, extra: Record<string, unknown> = {}) =>
  HttpResponse.json({ error: { code, message, ...extra } }, { status });

const latency = () => delay(120 + Math.random() * 260);

function deviceId(request: Request): string | null {
  return request.headers.get('X-Device-Id');
}

function authed(request: Request): boolean {
  const h = request.headers.get('Authorization');
  return !!h && h.startsWith('Bearer mock.');
}

const unauthorized = () => err(401, 'UNAUTHORIZED', 'Avtorizasiya tələb olunur');

export const handlers = [
  // ---------------- auth ----------------
  http.post(`${API}/auth/login`, async ({ request }) => {
    await latency();
    const body = (await request.json()) as { username?: string; password?: string };
    if (!body.username || !body.password) {
      return err(422, 'VALIDATION', 'İstifadəçi adı və şifrə tələb olunur');
    }
    if (body.password === 'wrong') {
      return err(401, 'INVALID_CREDENTIALS', 'İstifadəçi adı və ya şifrə yanlışdır');
    }
    return HttpResponse.json({
      access_token: `mock.${btoa(encodeURIComponent(body.username))}.${Date.now()}`,
      token_type: 'bearer',
    });
  }),

  // ---------------- citizen ----------------
  http.post(`${API}/citizens/register`, async ({ request }) => {
    await latency();
    const body = (await request.json()) as { device_id: string };
    const c = getEngine().citizen(body.device_id);
    return HttpResponse.json({ id: c.id, device_id: c.device_id, status: c.status });
  }),

  http.patch(`${API}/citizens/me/location`, async ({ request }) => {
    const id = deviceId(request);
    if (!id) return err(400, 'NO_DEVICE', 'Cihaz identifikatoru yoxdur');
    const body = (await request.json()) as { lat: number; lng: number };
    getEngine().setCitizenLocation(id, body.lat, body.lng);
    return HttpResponse.json({ ok: true });
  }),

  http.patch(`${API}/citizens/me/status`, async ({ request }) => {
    await latency();
    const id = deviceId(request);
    if (!id) return err(400, 'NO_DEVICE', 'Cihaz identifikatoru yoxdur');
    const body = (await request.json()) as { status: CitizenStatus };
    const c = getEngine().setCitizenStatus(id, body.status);
    return HttpResponse.json({ id: c.id, device_id: c.device_id, status: c.status });
  }),

  http.get(`${API}/zones`, async () => {
    await latency();
    return HttpResponse.json(getEngine().zones);
  }),

  http.get(`${API}/assembly-points/nearest`, async ({ request }) => {
    await latency();
    const url = new URL(request.url);
    const e = getEngine();
    let lat = Number(url.searchParams.get('lat'));
    let lng = Number(url.searchParams.get('lng'));
    const zoneId = url.searchParams.get('zone_id');
    if ((!lat || !lng) && zoneId) {
      const z = e.zones.find((x) => String(x.id) === zoneId);
      if (z?.center) ({ lat, lng } = z.center);
    }
    if (!lat || !lng) return err(422, 'NO_LOCATION', 'Yerləşmə və ya rayon göstərilməyib');
    const limit = Number(url.searchParams.get('limit') ?? 5) || 5;
    return HttpResponse.json(e.nearest({ lat, lng }, limit));
  }),

  http.get(`${API}/assembly-points`, async ({ request }) => {
    await latency();
    const url = new URL(request.url);
    const zone = url.searchParams.get('zone_id');
    const status = url.searchParams.get('status');
    return HttpResponse.json(
      getEngine().points.filter(
        (p) => (!zone || String(p.zone_id) === zone) && (!status || p.status === status),
      ),
    );
  }),

  http.post(`${API}/assembly-points/:id/check-in`, async ({ request, params }) => {
    await latency();
    const id = deviceId(request);
    if (!id) return err(400, 'NO_DEVICE', 'Cihaz identifikatoru yoxdur');
    const p = getEngine().checkIn(id, params.id as string);
    if (!p) return err(404, 'NOT_FOUND', 'Məntəqə tapılmadı');
    return HttpResponse.json({ ok: true, point: p });
  }),

  http.post(`${API}/citizens/me/route`, async ({ request }) => {
    await latency();
    const id = deviceId(request);
    if (!id) return err(400, 'NO_DEVICE', 'Cihaz identifikatoru yoxdur');
    const body = (await request.json()) as { point_id: Id; lat: number; lng: number };
    const r = getEngine().createCitizenRoute(id, body.point_id, { lat: body.lat, lng: body.lng });
    if (!r) return err(404, 'NOT_FOUND', 'Məntəqə tapılmadı');
    return HttpResponse.json(r);
  }),

  http.get(`${API}/citizens/me/route`, async ({ request }) => {
    await latency();
    const id = deviceId(request);
    if (!id) return err(400, 'NO_DEVICE', 'Cihaz identifikatoru yoxdur');
    const r = getEngine().citizen(id).route;
    if (!r) return err(404, 'NO_ROUTE', 'Aktiv marşrut yoxdur');
    return HttpResponse.json(r);
  }),

  http.post(`${API}/sos`, async ({ request }) => {
    await latency();
    const id = deviceId(request);
    if (!id) return err(400, 'NO_DEVICE', 'Cihaz identifikatoru yoxdur');
    const e = getEngine();
    const left = e.sosCooldownLeft(id);
    if (left > 0) {
      return HttpResponse.json(
        {
          error: {
            code: 'SOS_COOLDOWN',
            message: `Siz artıq SOS göndərmisiniz. Növbəti siqnal üçün ${left} saniyə gözləyin.`,
            retry_after: left,
          },
        },
        { status: 429, headers: { 'Retry-After': String(left) } },
      );
    }
    const body = (await request.json()) as {
      type: SosType;
      lat: number;
      lng: number;
      note?: string;
    };
    return HttpResponse.json(e.createCitizenSos(id, body.type, body, body.note), { status: 201 });
  }),

  http.get(`${API}/sos/me`, async ({ request }) => {
    await latency();
    const id = deviceId(request);
    if (!id) return err(400, 'NO_DEVICE', 'Cihaz identifikatoru yoxdur');
    return HttpResponse.json(getEngine().citizen(id).sos);
  }),

  http.get(`${API}/traffic/segments`, async ({ request }) => {
    await latency();
    const bbox = new URL(request.url).searchParams.get('bbox');
    const [minLng, minLat, maxLng, maxLat] = (bbox ?? '').split(',').map(Number);
    const inBox = (c: number[]) =>
      !bbox || (c[0] >= minLng && c[0] <= maxLng && c[1] >= minLat && c[1] <= maxLat);
    const fc: RoadCollection = {
      type: 'FeatureCollection',
      features: getEngine().roads.filter((r) => r.geometry.coordinates.some(inBox)),
    };
    return HttpResponse.json(fc);
  }),

  // ---------------- dispatcher ----------------
  http.get(`${API}/dispatch/overview`, async ({ request }) => {
    if (!authed(request)) return unauthorized();
    await latency();
    return HttpResponse.json(getEngine().overview());
  }),

  http.get(`${API}/dispatch/timeseries`, async ({ request }) => {
    if (!authed(request)) return unauthorized();
    await latency();
    const minutes = Number(new URL(request.url).searchParams.get('minutes') ?? 30) || 30;
    return HttpResponse.json(getEngine().timeseries(minutes));
  }),

  http.get(`${API}/sos`, async ({ request }) => {
    if (!authed(request)) return unauthorized();
    await latency();
    const q = new URL(request.url).searchParams;
    return HttpResponse.json(
      getEngine().listSos({
        status: q.get('status'),
        zone_id: q.get('zone_id'),
        type: q.get('type'),
      }),
    );
  }),

  http.post(`${API}/sos/:id/resolve`, async ({ request, params }) => {
    if (!authed(request)) return unauthorized();
    await latency();
    const s = getEngine().resolveSos(params.id as string);
    if (!s) return err(404, 'NOT_FOUND', 'SOS tapılmadı');
    return HttpResponse.json(s);
  }),

  http.get(`${API}/brigades`, async ({ request }) => {
    if (!authed(request)) return unauthorized();
    await latency();
    return HttpResponse.json(getEngine().brigades);
  }),

  http.post(`${API}/brigades/:id/assign`, async ({ request, params }) => {
    if (!authed(request)) return unauthorized();
    await latency();
    const body = (await request.json()) as { sos_id: Id };
    const e = getEngine();
    const b = e.brigades.find((x) => String(x.id) === params.id);
    if (!b) return err(404, 'NOT_FOUND', 'Briqada tapılmadı');
    if (b.status !== 'idle') return err(409, 'BRIGADE_BUSY', 'Briqada artıq məşğuldur');
    return HttpResponse.json(e.assign(b.id, body.sos_id));
  }),

  http.get(`${API}/alerts`, async ({ request }) => {
    if (!authed(request)) return unauthorized();
    await latency();
    return HttpResponse.json(getEngine().activeAlerts());
  }),

  http.post(`${API}/alerts/:id/confirm`, async ({ request, params }) => {
    if (!authed(request)) return unauthorized();
    await delay(700);
    const body = (await request.json()) as { brigade_id?: Id; new_point_id?: Id };
    const a = getEngine().confirmAlert(params.id as string, body.brigade_id, body.new_point_id);
    if (!a) return err(409, 'ALERT_NOT_ACTIVE', 'Həyəcan artıq aktiv deyil');
    return HttpResponse.json(a);
  }),

  http.post(`${API}/alerts/:id/dismiss`, async ({ request, params }) => {
    if (!authed(request)) return unauthorized();
    await latency();
    const a = getEngine().dismissAlert(params.id as string);
    if (!a) return err(404, 'NOT_FOUND', 'Həyəcan tapılmadı');
    return HttpResponse.json(a);
  }),

  // ---------------- simulation ----------------
  http.post(`${API}/sim/road-closure`, async ({ request }) => {
    if (!authed(request)) return unauthorized();
    await latency();
    const body = (await request.json()) as SimRoadClosure;
    const r = getEngine().simRoad(
      { lat: body.lat ?? 0, lng: body.lng ?? 0 },
      body.status as RoadStatus,
    );
    if (!r) return err(404, 'NO_ROAD', 'Yaxınlıqda yol seqmenti tapılmadı');
    return HttpResponse.json(r);
  }),

  http.post(`${API}/sim/occupancy`, async ({ request }) => {
    if (!authed(request)) return unauthorized();
    await latency();
    const body = (await request.json()) as SimOccupancy;
    const e = getEngine();
    const cur = e.points.find((x) => String(x.id) === String(body.point_id));
    const count =
      'current_count' in body ? body.current_count : (cur?.current_count ?? 0) + body.delta;
    const p = e.simOccupancy(body.point_id, count);
    if (!p) return err(404, 'NOT_FOUND', 'Məntəqə tapılmadı');
    return HttpResponse.json({ point: p, rerouted: 0, alert_id: null });
  }),

  http.post(`/sim/sos-burst`, async ({ request }) => {
    if (!authed(request)) return unauthorized();
    await latency();
    const body = (await request.json()) as SimSosBurst;
    getEngine().simBurst(body);
    return HttpResponse.json({ ok: true, scheduled: body.count });
  }),

  http.post(`${API}/sim/reset`, async ({ request }) => {
    if (!authed(request)) return unauthorized();
    await latency();
    getEngine().reset();
    return HttpResponse.json({ ok: true });
  }),
];

// ---------------- WebSockets ----------------
const citizenWs = ws.link(`${env.wsUrl}/ws/citizen`);
const dispatchWs = ws.link(`${env.wsUrl}/ws/dispatch`);

export const wsHandlers = [
  citizenWs.addEventListener('connection', ({ client }) => {
    const device = new URL(client.url).searchParams.get('device_id');
    if (!device) {
      client.close(4001, 'device_id required');
      return;
    }
    const off = getEngine().addCitizenListener(device, (f) => client.send(f));
    client.addEventListener('message', (e) => {
      if (e.data === 'ping') {
        client.send('pong');
      } else if (typeof e.data === 'string' && e.data.includes('"ping"')) {
        client.send(JSON.stringify({ type: 'pong', data: null, ts: new Date().toISOString() }));
      }
    });
    client.addEventListener('close', () => off());
  }),

  dispatchWs.addEventListener('connection', ({ client }) => {
    const token = new URL(client.url).searchParams.get('token');
    if (!token || !token.startsWith('mock.')) {
      client.close(4401, 'unauthorized');
      return;
    }
    const e = getEngine();
    const off = e.addDispatchListener((f) => client.send(f));
    client.addEventListener('message', (m) => {
      if (m.data === 'ping') {
        client.send('pong');
      } else if (typeof m.data === 'string' && m.data.includes('"ping"')) {
        client.send(JSON.stringify({ type: 'pong', data: null, ts: new Date().toISOString() }));
      }
    });
    client.addEventListener('close', () => off());
  }),
];
