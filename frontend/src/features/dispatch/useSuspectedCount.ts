import { useDispatchStore } from '@/stores/dispatchStore';
import { useOverview, useSuspectedSos } from './queries';

/** Pending quarantine count: the live `sos.suspected` event, else the overview, else the list. */
export function useSuspectedCount(): number {
  const live = useDispatchStore((s) => s.suspected?.quarantined_pending);
  const overview = useOverview().data?.suspected_sos;
  const list = useSuspectedSos().data?.length;
  return live ?? overview ?? list ?? 0;
}
