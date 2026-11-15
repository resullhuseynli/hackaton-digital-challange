import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MapRef } from 'react-map-gl/maplibre';
import { dispatchApi } from '@/api/endpoints';
import { qk } from '@/api/queryKeys';
import type { BarrierType, RoadCollection, RoadStatus } from '@/types/api';

const EMPTY: RoadCollection = { type: 'FeatureCollection', features: [] };
const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** All barrier types, in legend order. */
export const BARRIER_TYPES: BarrierType[] = [
  'stairs',
  'underpass',
  'steep',
  'curb',
  'narrow',
  'inaccessible',
];

/**
 * Viewport-scoped traffic data (the city has ~17k segments, so a bbox is always sent).
 * The bbox is debounced 300 ms after the map stops moving. One request per status, since the
 * API filters by a single status, plus one for barriers.
 */
export function useDispatchTraffic() {
  const [bbox, setBbox] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  const updateFromMap = useCallback((map: MapRef | null) => {
    if (!map) return;
    if (timer.current != null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const b = map.getBounds();
      const next = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map(r3).join(',');
      setBbox((prev) => (prev === next ? prev : next));
    }, 300);
  }, []);
  useEffect(
    () => () => {
      if (timer.current != null) window.clearTimeout(timer.current);
    },
    [],
  );

  const q = (status?: RoadStatus, has_barrier?: boolean) => ({
    queryKey: [
      ...qk.traffic(bbox ?? ''),
      status ?? 'any',
      has_barrier ? 'barrier' : 'all',
    ] as const,
    queryFn: () => dispatchApi.traffic(bbox!, { status, has_barrier }),
    enabled: bbox != null,
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });
  const closed = useQuery(q('closed'));
  const congested = useQuery(q('congested'));
  const barriers = useQuery(q(undefined, true));

  const roads = useMemo<RoadCollection>(
    () => ({
      type: 'FeatureCollection',
      features: [...(closed.data?.features ?? []), ...(congested.data?.features ?? [])],
    }),
    [closed.data, congested.data],
  );

  return { roads, barriers: barriers.data ?? EMPTY, updateFromMap };
}
