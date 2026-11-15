import type {
  Alert,
  AssemblyPoint,
  Brigade,
  Citizen,
  CitizenStatus,
  Id,
  LoginResponse,
  NearestPoint,
  Overview,
  PointStatus,
  RoadCollection,
  RoadStatus,
  Route,
  RoutingStatusOut,
  SimRoutingFault,
  SimRoutingFaultResult,
  SimBarrier,
  SimBarrierResult,
  SimOccupancy,
  SimOccupancyResult,
  SimRoadClosure,
  SimRoadClosureResult,
  SimSosBurst,
  SimSosBurstResult,
  Sos,
  SosReviewResult,
  SosStatus,
  SosType,
  TimeseriesBucket,
  Zone,
} from '@/types/api';
import { ApiError, request, requestFull } from './http';
import { normalizeOverview, normalizeTimeseries } from './normalize';

/** Accept either a bare array or a {items|results|data: []} envelope. */
function unwrapList<T>(v: unknown): T[] {
  if (Array.isArray(v)) return v as T[];
  if (v && typeof v === 'object') {
    for (const k of ['items', 'results', 'data', 'buckets', 'series']) {
      const inner = (v as Record<string, unknown>)[k];
      if (Array.isArray(inner)) return inner as T[];
    }
  }
  return [];
}

/** The backend sends zone shapes as `polygon`; normalise to `geometry`. */
function normalizeZones(v: unknown): Zone[] {
  return unwrapList<Zone & { polygon?: Zone['geometry'] }>(v).map(({ polygon, ...z }) => ({
    ...z,
    geometry: z.geometry ?? polygon ?? null,
  }));
}

// ---------------- Routing (public) ----------------
export const routingApi = {
  /** Public; `notice.text` is localized via Accept-Language. */
  status: () => request<RoutingStatusOut>('/routing/status'),
};

// ---------------- Citizen ----------------
export const citizenApi = {
  /** Idempotent: calling again updates the profile. Omit mobility_impaired to keep it. */
  register: (
    deviceId: string,
    profile: { phone?: string | null; mobility_impaired?: boolean } = {},
  ) =>
    request<Citizen>('/citizens/register', {
      method: 'POST',
      auth: 'device',
      body: {
        device_id: deviceId,
        ...(profile.phone ? { phone: profile.phone } : {}),
        ...(profile.mobility_impaired !== undefined
          ? { mobility_impaired: profile.mobility_impaired }
          : {}),
      },
    }),
  updateLocation: (lat: number, lng: number) =>
    request<Citizen>('/citizens/me/location', {
      method: 'PATCH',
      auth: 'device',
      body: { lat, lng },
    }),
  updateStatus: (status: Exclude<CitizenStatus, 'unknown'>) =>
    request<Citizen>('/citizens/me/status', { method: 'PATCH', auth: 'device', body: { status } }),
  zones: async () => normalizeZones(await request<unknown>('/zones', { auth: 'device' })),
  points: async (params: { zone_id?: Id; status?: PointStatus } = {}) =>
    unwrapList<AssemblyPoint>(
      await request<unknown>('/assembly-points', { auth: 'device', query: params }),
    ),
  nearest: async (params: { lat?: number; lng?: number; zone_id?: Id; limit?: number }) =>
    unwrapList<NearestPoint>(
      await request<unknown>('/assembly-points/nearest', { auth: 'device', query: params }),
    ),
  checkIn: (pointId: Id) =>
    request<AssemblyPoint>(`/assembly-points/${pointId}/check-in`, {
      method: 'POST',
      auth: 'device',
    }),
  createRoute: (pointId: Id, lat: number, lng: number) =>
    request<Route>('/citizens/me/route', {
      method: 'POST',
      auth: 'device',
      body: { point_id: pointId, lat, lng },
    }),
  getRoute: async (): Promise<Route | null> => {
    try {
      return await request<Route | null>('/citizens/me/route', { auth: 'device' });
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return null;
      throw e;
    }
  },
  /**
   * `idempotencyKey` is reused for retries of the same report, so the server returns the SOS it
   * already created instead of a second one. `duplicateOf`: the report was merged into an
   * identical one from the same spot (header `X-Duplicate-Of`).
   */
  createSos: async (
    body: { type: SosType; lat: number; lng: number; note?: string },
    idempotencyKey: string,
  ): Promise<{ sos: Sos; duplicateOf: string | null; replay: boolean }> => {
    const { data, headers } = await requestFull<Sos>('/sos', {
      method: 'POST',
      auth: 'device',
      body,
      headers: { 'Idempotency-Key': idempotencyKey },
    });
    return {
      sos: data,
      duplicateOf: headers.get('X-Duplicate-Of'),
      replay: headers.get('Idempotent-Replay') === 'true',
    };
  },
  mySos: async () => unwrapList<Sos>(await request<unknown>('/sos/me', { auth: 'device' })),
};

// ---------------- Dispatcher ----------------
export const dispatchApi = {
  login: (username: string, password: string) =>
    request<LoginResponse>('/auth/login', { method: 'POST', body: { username, password } }),
  overview: async (): Promise<Overview> =>
    normalizeOverview(await request<unknown>('/dispatch/overview', { auth: 'dispatcher' })),
  timeseries: async (minutes = 30): Promise<TimeseriesBucket[]> =>
    normalizeTimeseries(
      await request<unknown>('/dispatch/timeseries', { auth: 'dispatcher', query: { minutes } }),
    ),
  sos: async (params: { status?: SosStatus; zone_id?: Id; type?: SosType } = {}) =>
    unwrapList<Sos>(await request<unknown>('/sos', { auth: 'dispatcher', query: params })),
  /** Quarantined (suspected spam) SOS awaiting review. */
  suspectedSos: async () =>
    unwrapList<Sos>(
      await request<unknown>('/sos', {
        auth: 'dispatcher',
        query: { suspected_only: true, limit: 1000 },
      }),
    ),
  /** Bulk review: `genuine` releases into the queue, `spam` rejects. */
  reviewSos: (ids: Id[], verdict: 'genuine' | 'spam') =>
    request<SosReviewResult>('/sos/review', {
      method: 'POST',
      auth: 'dispatcher',
      body: { sos_ids: ids, verdict },
    }),
  resolveSos: (id: Id) =>
    request<Sos>(`/sos/${id}/resolve`, { method: 'POST', auth: 'dispatcher' }),
  brigades: async () =>
    unwrapList<Brigade>(await request<unknown>('/brigades', { auth: 'dispatcher' })),
  assignBrigade: (brigadeId: Id, sosId: Id) =>
    request<Brigade>(`/brigades/${brigadeId}/assign`, {
      method: 'POST',
      auth: 'dispatcher',
      body: { sos_id: sosId },
    }),
  alerts: async () =>
    unwrapList<Alert>(
      await request<unknown>('/alerts', { auth: 'dispatcher', query: { status: 'active' } }),
    ).filter((a) => !a.status || a.status === 'active'),
  confirmAlert: (id: Id, body: { brigade_id?: Id; new_point_id?: Id }) =>
    request<Alert>(`/alerts/${id}/confirm`, { method: 'POST', auth: 'dispatcher', body }),
  dismissAlert: (id: Id, reason: string) =>
    request<Alert>(`/alerts/${id}/dismiss`, {
      method: 'POST',
      auth: 'dispatcher',
      body: { reason },
    }),
  zones: async () => normalizeZones(await request<unknown>('/zones', { auth: 'dispatcher' })),
  points: async () =>
    unwrapList<AssemblyPoint>(await request<unknown>('/assembly-points', { auth: 'dispatcher' })),
  /** Always pass the viewport bbox (the whole city is ~17k segments). */
  traffic: (bbox: string, filter: { status?: RoadStatus; has_barrier?: boolean } = {}) =>
    request<RoadCollection>('/traffic/segments', {
      auth: 'dispatcher',
      query: { bbox, ...filter },
    }),
};

// ---------------- Simulation ----------------
export const simApi = {
  roadClosure: (body: SimRoadClosure) =>
    request<SimRoadClosureResult>('/sim/road-closure', {
      method: 'POST',
      auth: 'dispatcher',
      body,
    }),
  /** Reroutes mobility-impaired citizens only. barrier: null removes it. */
  barrier: (body: SimBarrier) =>
    request<SimBarrierResult>('/sim/barrier', { method: 'POST', auth: 'dispatcher', body }),
  occupancy: (body: SimOccupancy) =>
    request<SimOccupancyResult>('/sim/occupancy', { method: 'POST', auth: 'dispatcher', body }),
  sosBurst: (body: SimSosBurst) =>
    request<SimSosBurstResult>('/sim/sos-burst', { method: 'POST', auth: 'dispatcher', body }),
  reset: () => request<unknown>('/sim/reset', { method: 'POST', auth: 'dispatcher' }),
  /** Breaks or repairs the mock external routing provider. 502 ROUTING_FAULT_UNAVAILABLE if none. */
  routingFault: (body: SimRoutingFault) =>
    request<SimRoutingFaultResult>('/sim/routing-fault', {
      method: 'POST',
      auth: 'dispatcher',
      body,
    }),
};
