import { describe, expect, it } from 'vitest';
import { formatDistance, formatEta, formatMmSs, timeAgo } from './format';
import { along, circleRing, distanceToSegment, haversine, pointInPolygon } from './geo';
import { occupancyLevel, priorityLevel, priorityValue } from './status';
import { sameId } from './utils';

describe('geo', () => {
  it('haversine ~ 1.11 km per 0.01° latitude', () => {
    const d = haversine({ lat: 40.4, lng: 49.86 }, { lat: 40.41, lng: 49.86 });
    expect(d).toBeGreaterThan(1100);
    expect(d).toBeLessThan(1125);
  });

  it('distance to a segment is 0 on the segment', () => {
    const a = { lat: 40.4, lng: 49.8 };
    const b = { lat: 40.4, lng: 49.9 };
    expect(distanceToSegment({ lat: 40.4, lng: 49.85 }, a, b)).toBeLessThan(1);
  });

  it('along() interpolates by length', () => {
    const p = along(
      {
        type: 'LineString',
        coordinates: [
          [49.8, 40.4],
          [49.9, 40.4],
        ],
      },
      0.5,
    );
    expect(p.lng).toBeCloseTo(49.85, 3);
  });

  it('circle ring is closed and contains its centre', () => {
    const ring = circleRing({ lat: 40.4, lng: 49.86 }, 500);
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    expect(pointInPolygon({ lat: 40.4, lng: 49.86 }, ring)).toBe(true);
    expect(pointInPolygon({ lat: 40.41, lng: 49.86 }, ring)).toBe(false);
  });
});

describe('format (az)', () => {
  it('formats distances', () => {
    expect(formatDistance(432)).toBe('430 m');
    expect(formatDistance(1530)).toBe('1,5 km');
  });
  it('formats ETA and countdowns', () => {
    expect(formatEta(0.4)).toBe('<1 dəq');
    expect(formatEta(7.2)).toBe('7 dəq');
    expect(formatMmSs(65)).toBe('1:05');
  });
  it('formats relative time', () => {
    const now = Date.parse('2026-01-01T12:00:00Z');
    expect(timeAgo('2026-01-01T11:57:00Z', now)).toBe('3 dəq əvvəl');
    expect(timeAgo('2026-01-01T11:59:58Z', now)).toBe('indicə');
  });
});

describe('status thresholds', () => {
  it('occupancy: <70 green, 70–90 amber, ≥90 red', () => {
    expect(occupancyLevel(69)).toBe('safe');
    expect(occupancyLevel(70)).toBe('warning');
    expect(occupancyLevel(89.9)).toBe('warning');
    expect(occupancyLevel(90)).toBe('danger');
    expect(occupancyLevel(90.5)).toBe('danger');
  });
  it('priority accepts 0..1 or 0..100', () => {
    expect(priorityValue(0.82)).toBe(82);
    expect(priorityLevel(82)).toBe('danger');
    expect(priorityLevel(0.3)).toBe('safe');
  });
  it('sameId compares numbers and strings', () => {
    expect(sameId(5, '5')).toBe(true);
    expect(sameId(null, null)).toBe(false);
  });
});
