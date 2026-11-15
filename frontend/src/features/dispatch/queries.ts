import { useQuery } from '@tanstack/react-query';
import { dispatchApi } from '@/api/endpoints';
import { qk } from '@/api/queryKeys';

export const useOverview = () =>
  useQuery({ queryKey: qk.overview, queryFn: dispatchApi.overview, refetchInterval: 60_000 });

export const useTimeseries = () =>
  useQuery({
    queryKey: qk.timeseries,
    queryFn: () => dispatchApi.timeseries(30),
    refetchInterval: 30_000, // brief §4.8 (plus a live bump on every sos.created)
  });

/** All SOS (filtering happens client-side so WS updates stay simple). */
export const useSosList = () => useQuery({ queryKey: qk.sos, queryFn: () => dispatchApi.sos() });

export const useBrigades = () => useQuery({ queryKey: qk.brigades, queryFn: dispatchApi.brigades });

export const useAlerts = () => useQuery({ queryKey: qk.alerts, queryFn: dispatchApi.alerts });

export const useDispatchPoints = () =>
  useQuery({ queryKey: qk.dispatchPoints, queryFn: dispatchApi.points });

export const useDispatchZones = () =>
  useQuery({ queryKey: qk.dispatchZones, queryFn: dispatchApi.zones, staleTime: 1000 * 60 * 30 });

/** Quarantined (suspected spam) SOS awaiting review. */
export const useSuspectedSos = () =>
  useQuery({ queryKey: qk.suspected, queryFn: dispatchApi.suspectedSos, refetchInterval: 30_000 });
