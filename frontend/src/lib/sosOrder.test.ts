import { describe, expect, it } from 'vitest';
import type { Sos } from '@/types/api';
import { compareSos, mergeSos } from './sosOrder';

const sos = (id: number, score: number, mi = false, minute = 0): Sos => ({
  id,
  citizen_id: `c${id}`,
  type: 'collapse',
  lat: 40.4,
  lng: 49.86,
  zone_id: 1,
  note: null,
  priority_score: score,
  status: 'new',
  assigned_brigade_id: null,
  brigade_eta_min: null,
  created_at: `2026-01-01T12:${String(minute).padStart(2, '0')}:00Z`,
  citizen_mobility_impaired: mi,
  labels: mi ? [{ code: 'MOBILITY_IMPAIRED', text: 'Hərəkət məhdudiyyətli şəxs' }] : [],
});

describe('SOS queue order (♿ first)', () => {
  it('ranks mobility-impaired above a higher score, then score, then oldest', () => {
    const list = [sos(1, 90), sos(2, 40, true), sos(3, 90, false, 5), sos(4, 70)];
    const sorted = [...list].sort(compareSos).map((s) => s.id);
    expect(sorted).toEqual([2, 1, 3, 4]);
  });

  it('inserts a new ♿ SOS at the top even with a low score', () => {
    const queue = [sos(1, 95), sos(2, 80)];
    const next = mergeSos(queue, sos(3, 10, true));
    expect(next.map((s) => s.id)).toEqual([3, 1, 2]);
  });

  it('keeps the server order untouched when a partial update does not change rank', () => {
    const queue = [sos(1, 50), sos(2, 50)]; // equal rank: server decided the order
    const next = mergeSos(queue, { id: 2, status: 'assigned' });
    expect(next.map((s) => s.id)).toEqual([1, 2]);
    expect(next[1].status).toBe('assigned');
  });

  it('moves a row when the periodic recompute changes its priority', () => {
    const queue = [sos(1, 80), sos(2, 60), sos(3, 40)];
    const next = mergeSos(queue, { id: 3, priority_score: 99 });
    expect(next.map((s) => s.id)).toEqual([3, 1, 2]);
  });

  it('ignores a partial update for an SOS that is not cached', () => {
    const queue = [sos(1, 80)];
    expect(mergeSos(queue, { id: 9, priority_score: 10 })).toBe(queue);
  });
});
