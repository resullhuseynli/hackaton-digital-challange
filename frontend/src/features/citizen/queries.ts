import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { useEffect } from 'react';
import { citizenApi } from '@/api/endpoints';
import { qk } from '@/api/queryKeys';
import { useCitizenStore } from '@/stores/citizenStore';
import { useRoutingStore } from '@/stores/routingStore';
import { sameId } from '@/lib/utils';
import type { AssemblyPoint, Id, NearestPoint, Route } from '@/types/api';
import type { CitizenLocation } from './useCitizenLocation';

const round = (v: number) => Math.round(v * 1000) / 1000; // ~100 m buckets

export function useZones() {
  return useQuery({ queryKey: qk.zones, queryFn: citizenApi.zones, staleTime: 1000 * 60 * 30 });
}

export function usePoints() {
  const setLast = useCitizenStore((s) => s.setLastPoints);
  const q = useQuery({
    queryKey: qk.points,
    queryFn: () => citizenApi.points(),
    staleTime: 30_000,
  });
  useEffect(() => {
    if (q.data) setLast(q.data);
  }, [q.data, setLast]);
  return q;
}

export function useNearest(loc: CitizenLocation | null, zoneId: Id | null) {
  const setLast = useCitizenStore((s) => s.setLastNearest);
  const lat = loc ? round(loc.lat) : null;
  const lng = loc ? round(loc.lng) : null;
  const q = useQuery({
    queryKey: qk.nearest(lat, lng, lat == null ? zoneId : null),
    queryFn: () =>
      citizenApi.nearest(
        lat != null && lng != null
          ? { lat, lng, limit: 5 }
          : { zone_id: zoneId ?? undefined, limit: 5 },
      ),
    enabled: lat != null || zoneId != null,
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });
  useEffect(() => {
    if (q.data) setLast(q.data);
  }, [q.data, setLast]);
  return q;
}

export function useRoute() {
  const q = useQuery({ queryKey: qk.route, queryFn: citizenApi.getRoute, staleTime: 60_000 });
  useEffect(() => {
    useRoutingStore.getState().fromRoute(q.data);
  }, [q.data]);
  return q;
}

export function useCreateRoute() {
  const qc = useQueryClient();
  const setReroute = useCitizenStore((s) => s.setReroute);
  return useMutation({
    mutationFn: (v: { pointId: Id; lat: number; lng: number }) =>
      citizenApi.createRoute(v.pointId, v.lat, v.lng),
    onSuccess: (route) => {
      useRoutingStore.getState().fromRoute(route);
      setReroute(null);
      qc.setQueryData<Route | null>(qk.route, route);
    },
  });
}

/**
 * Best wheelchair-accessible alternative from the cached nearest lists (already ranked
 * best-first by the backend, near_full last), skipping `excludeId`.
 */
export function nextAccessiblePoint(qc: QueryClient, excludeId: Id): AssemblyPoint | null {
  const lists = qc.getQueriesData<NearestPoint[]>({ queryKey: qk.nearestAll });
  for (const [, data] of lists) {
    const hit = (data ?? []).find(
      (n) =>
        n.point.wheelchair_accessible &&
        n.point.status === 'active' &&
        !sameId(n.point.id, excludeId) &&
        !n.near_full,
    );
    if (hit) return hit.point;
  }
  return null;
}
