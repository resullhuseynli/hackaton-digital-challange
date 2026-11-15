/**
 * Adapters between the backend's actual payloads and the frontend types.
 * Each accepts both the backend shape and the shape the mock/contract uses.
 */
import type { Overview, SosType, TimeseriesBucket } from '@/types/api';

type Rec = Record<string, unknown>;
const num = (v: unknown, fallback = 0) =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;
const pick = (o: Rec, ...keys: string[]) => {
  for (const k of keys) if (o[k] !== undefined) return o[k];
  return undefined;
};

/** Backend field names (contract); also accepts the legacy mock names. */
export function normalizeOverview(v: unknown): Overview {
  const o = (v ?? {}) as Rec;
  return {
    active_sos: num(o.active_sos),
    active_sos_mobility_impaired: num(o.active_sos_mobility_impaired),
    resolved_sos: num(o.resolved_sos),
    citizens_safe: num(pick(o, 'citizens_safe', 'safe_citizens')),
    citizens_in_danger: num(pick(o, 'citizens_in_danger', 'in_danger_citizens')),
    brigades_idle: num(pick(o, 'brigades_idle', 'idle_brigades')),
    brigades_busy: num(pick(o, 'brigades_busy', 'busy_brigades')),
    avg_occupancy_pct: num(o.avg_occupancy_pct),
    active_alerts: num(o.active_alerts),
    suspected_sos: num(o.suspected_sos),
    routing_status:
      o.routing_status === 'online' || o.routing_status === 'fallback' ? o.routing_status : null,
  };
}

const TYPES: SosType[] = ['fire', 'collapse', 'flood', 'medical'];

/** Backend: {series: [{minute, total, by_type: {fire, ...}}]}; mock: [{ts, fire, ...}]. */
export function normalizeTimeseries(v: unknown): TimeseriesBucket[] {
  const list = Array.isArray(v)
    ? v
    : Array.isArray((v as Rec | null)?.series)
      ? ((v as Rec).series as unknown[])
      : [];
  return list.map((raw) => {
    const b = raw as Rec;
    const byType = (b.by_type ?? b) as Rec;
    const bucket = { ts: String(pick(b, 'ts', 'minute') ?? '') } as TimeseriesBucket;
    for (const t of TYPES) bucket[t] = num(byType[t]);
    return bucket;
  });
}
