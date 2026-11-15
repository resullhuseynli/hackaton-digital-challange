import type { LatLng, Zone } from '@/types/api';
import { polygonCentroid } from './geo';

export function zoneCenter(z: Zone): LatLng | null {
  if (z.center) return z.center;
  if (z.geometry?.type === 'Polygon') return polygonCentroid(z.geometry.coordinates[0]);
  if (z.geometry?.type === 'MultiPolygon') return polygonCentroid(z.geometry.coordinates[0][0]);
  return null;
}
