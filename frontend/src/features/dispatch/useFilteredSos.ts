import { useMemo } from 'react';
import { SOS_META } from '@/lib/status';
import { useDispatchStore } from '@/stores/dispatchStore';
import { useBrigades, useDispatchZones, useSosList } from './queries';

/** SOS list filtered by the shared dispatcher filters, in the server's order. */
export function useFilteredSos() {
  const sos = useSosList();
  const zones = useDispatchZones();
  const brigades = useBrigades();
  const filters = useDispatchStore((s) => s.filters);

  const zoneById = useMemo(
    () => new Map((zones.data ?? []).map((z) => [String(z.id), z])),
    [zones.data],
  );
  const brigadeById = useMemo(
    () => new Map((brigades.data ?? []).map((b) => [String(b.id), b])),
    [brigades.data],
  );

  const rows = useMemo(() => {
    const q = filters.search.trim().toLocaleLowerCase('az');
    return (sos.data ?? [])
      .filter((s) =>
        filters.status === 'all'
          ? true
          : filters.status === 'active'
            ? s.status !== 'resolved'
            : s.status === filters.status,
      )
      .filter((s) => filters.zone === 'all' || String(s.zone_id) === filters.zone)
      .filter((s) => filters.type === 'all' || s.type === filters.type)
      .filter((s) => {
        if (!q) return true;
        const hay = [
          String(s.id),
          s.note ?? '',
          SOS_META[s.type]?.label ?? '',
          zoneById.get(String(s.zone_id))?.name ?? '',
        ]
          .join(' ')
          .toLocaleLowerCase('az');
        return hay.includes(q);
      });
    // No sorting: GET /sos is already ordered (♿ first, then priority, then oldest) and WS
    // updates are merged with the same rule (lib/sosOrder). Filtering keeps that order.
  }, [sos.data, filters, zoneById]);

  return { sos, rows, zoneById, brigadeById };
}
