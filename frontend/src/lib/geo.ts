import type { LineString, Position } from 'geojson';
import type { LatLng } from '@/types/api';

const R = 6371000;
const toRad = (d: number) => (d * Math.PI) / 180;

/** Great-circle distance in metres. */
export function haversine(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export const pos = (p: Position): LatLng => ({ lng: p[0], lat: p[1] });

export function lineLength(line: LineString): number {
  let d = 0;
  for (let i = 1; i < line.coordinates.length; i++) {
    d += haversine(pos(line.coordinates[i - 1]), pos(line.coordinates[i]));
  }
  return d;
}

/** Distance from point p to segment ab in metres (equirectangular approximation). */
export function distanceToSegment(p: LatLng, a: LatLng, b: LatLng): number {
  const kx = Math.cos(toRad(p.lat)) * 111320;
  const ky = 110540;
  const ax = (a.lng - p.lng) * kx;
  const ay = (a.lat - p.lat) * ky;
  const bx = (b.lng - p.lng) * kx;
  const by = (b.lat - p.lat) * ky;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.sqrt(cx * cx + cy * cy);
}

export function distanceToLine(p: LatLng, line: LineString): number {
  let best = Infinity;
  const c = line.coordinates;
  for (let i = 1; i < c.length; i++) {
    best = Math.min(best, distanceToSegment(p, pos(c[i - 1]), pos(c[i])));
  }
  return best;
}

export type Bounds = [[number, number], [number, number]];

/** [[minLng, minLat], [maxLng, maxLat]] for a list of coordinates. */
export function boundsOf(coords: Position[]): Bounds | null {
  if (!coords.length) return null;
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const [lng, lat] of coords) {
    minLng = Math.min(minLng, lng);
    minLat = Math.min(minLat, lat);
    maxLng = Math.max(maxLng, lng);
    maxLat = Math.max(maxLat, lat);
  }
  return [
    [minLng, minLat],
    [maxLng, maxLat],
  ];
}

/** Point along a line at fraction t (0..1) by length. */
export function along(line: LineString, t: number): LatLng {
  const c = line.coordinates;
  if (c.length === 1 || t <= 0) return pos(c[0]);
  const total = lineLength(line);
  let target = total * Math.min(1, t);
  for (let i = 1; i < c.length; i++) {
    const a = pos(c[i - 1]);
    const b = pos(c[i]);
    const seg = haversine(a, b);
    if (target <= seg && seg > 0) {
      const f = target / seg;
      return { lat: a.lat + (b.lat - a.lat) * f, lng: a.lng + (b.lng - a.lng) * f };
    }
    target -= seg;
  }
  return pos(c[c.length - 1]);
}

/** Circle polygon ring (for radius overlays). */
export function circleRing(center: LatLng, radiusM: number, steps = 64): Position[] {
  const ring: Position[] = [];
  const dLat = radiusM / 110540;
  const dLng = radiusM / (111320 * Math.cos(toRad(center.lat)));
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    ring.push([center.lng + dLng * Math.cos(a), center.lat + dLat * Math.sin(a)]);
  }
  return ring;
}

/** Random point within radius (uniform over the disc). */
export function randomWithin(center: LatLng, radiusM: number): LatLng {
  const r = radiusM * Math.sqrt(Math.random());
  const a = Math.random() * Math.PI * 2;
  return {
    lat: center.lat + (r * Math.sin(a)) / 110540,
    lng: center.lng + (r * Math.cos(a)) / (111320 * Math.cos(toRad(center.lat))),
  };
}

export function pointInPolygon(p: LatLng, ring: Position[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect =
      yi > p.lat !== yj > p.lat && p.lng < ((xj - xi) * (p.lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function polygonCentroid(ring: Position[]): LatLng {
  let x = 0;
  let y = 0;
  const n = ring.length - 1 || 1;
  for (let i = 0; i < n; i++) {
    x += ring[i][0];
    y += ring[i][1];
  }
  return { lng: x / n, lat: y / n };
}

export const BAKU_CENTER: LatLng = { lat: 40.4005, lng: 49.8671 };
