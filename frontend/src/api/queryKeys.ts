import type { Id } from '@/types/api';

/** Single source of truth for TanStack Query keys. */
export const qk = {
  zones: ['zones'] as const,
  routingStatus: (lang: string) => ['routing', 'status', lang] as const,
  routingStatusAll: ['routing', 'status'] as const,
  points: ['points'] as const,
  nearest: (lat: number | null, lng: number | null, zoneId: Id | null) =>
    ['nearest', lat, lng, zoneId] as const,
  nearestAll: ['nearest'] as const,
  route: ['route', 'me'] as const,
  mySos: ['sos', 'me'] as const,
  traffic: (bbox: string) => ['traffic', bbox] as const,
  trafficAll: ['traffic'] as const,
  overview: ['dispatch', 'overview'] as const,
  timeseries: ['dispatch', 'timeseries'] as const,
  sos: ['dispatch', 'sos'] as const,
  suspected: ['dispatch', 'sos', 'suspected'] as const,
  brigades: ['dispatch', 'brigades'] as const,
  alerts: ['dispatch', 'alerts'] as const,
  dispatchPoints: ['dispatch', 'points'] as const,
  dispatchZones: ['dispatch', 'zones'] as const,
};
