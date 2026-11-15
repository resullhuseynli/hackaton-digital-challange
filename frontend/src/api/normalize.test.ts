import { describe, expect, it } from 'vitest';
import { normalizeOverview, normalizeTimeseries } from './normalize';

describe('normalizeOverview', () => {
  it('keeps the contract field names', () => {
    const raw = {
      active_sos: 5,
      active_sos_mobility_impaired: 2,
      resolved_sos: 0,
      citizens_safe: 3,
      citizens_in_danger: 5,
      brigades_idle: 9,
      brigades_busy: 1,
      avg_occupancy_pct: 33.7,
      active_alerts: 1,
      routing_status: 'fallback',
      suspected_sos: 2,
    };
    expect(normalizeOverview(raw)).toEqual(raw);
  });
  it('maps legacy mock names and never yields NaN', () => {
    const o = normalizeOverview({ safe_citizens: 2, idle_brigades: 4 });
    expect(o.citizens_safe).toBe(2);
    expect(o.brigades_idle).toBe(4);
    expect(o.brigades_busy).toBe(0);
    expect(o.active_alerts).toBe(0);
  });
});

describe('normalizeTimeseries', () => {
  it('flattens the backend {series: [{minute, by_type}]} shape', () => {
    const t = normalizeTimeseries({
      minutes: 2,
      series: [
        {
          minute: '2026-11-15T08:11:00Z',
          total: 1,
          by_type: { fire: 1, collapse: 0, flood: 0, medical: 0 },
        },
        {
          minute: '2026-11-15T08:12:00Z',
          total: 2,
          by_type: { fire: 0, collapse: 2, flood: 0, medical: 0 },
        },
      ],
    });
    expect(t).toEqual([
      { ts: '2026-11-15T08:11:00Z', fire: 1, collapse: 0, flood: 0, medical: 0 },
      { ts: '2026-11-15T08:12:00Z', fire: 0, collapse: 2, flood: 0, medical: 0 },
    ]);
  });
  it('accepts the flat mock shape', () => {
    expect(
      normalizeTimeseries([{ ts: 'x', fire: 1, collapse: 0, flood: 2, medical: 0 }])[0].flood,
    ).toBe(2);
  });
});
