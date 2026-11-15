import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { toast } from 'sonner';
import { qk } from '@/api/queryKeys';
import { LiveSocket } from '@/api/ws';
import { citizenApi } from '@/api/endpoints';
import { announce } from '@/lib/announce';
import { tr, useLang } from '@/i18n';
import { getDeviceId } from '@/lib/deviceId';
import { env } from '@/lib/env';
import { sameId, vibrate } from '@/lib/utils';
import { useCitizenStore } from '@/stores/citizenStore';
import { useConnectionStore } from '@/stores/connectionStore';
import { useRoutingStore } from '@/stores/routingStore';
import type { AssemblyPoint, NearestPoint, Route, Sos } from '@/types/api';
import type { CitizenEvent, PointOccupancyData } from '@/types/ws';
import { etaDeadline, sosStatusText } from './sosText';

export function applyPointOccupancy(qc: QueryClient, d: PointOccupancyData) {
  const id = d.point_id ?? d.id;
  if (id == null) return;
  const patch = (p: AssemblyPoint): AssemblyPoint =>
    sameId(p.id, id)
      ? {
          ...p,
          ...Object.fromEntries(Object.entries(d).filter(([k]) => k !== 'point_id')),
          id: p.id,
        }
      : p;
  qc.setQueriesData<AssemblyPoint[]>({ queryKey: qk.points }, (old) => old?.map(patch));
  qc.setQueriesData<NearestPoint[]>({ queryKey: qk.nearestAll }, (old) =>
    old?.map((n) => {
      const point = patch(n.point);
      return point === n.point ? n : { ...n, point, near_full: point.occupancy_pct >= 85 };
    }),
  );
}

/** Citizen WebSocket: reroutes, SOS status, live occupancy, official broadcasts. */
export function useCitizenSocket(enabled: boolean) {
  const qc = useQueryClient();
  const lang = useLang();
  const setStatus = useConnectionStore((s) => s.setCitizenSocket);

  useEffect(() => {
    if (!enabled) return;
    const socket = new LiveSocket<CitizenEvent>({
      url: () =>
        `${env.wsUrl}/ws/citizen?device_id=${encodeURIComponent(getDeviceId())}&lang=${lang}`,
      onStatus: setStatus,
      onReconnect: () => void qc.refetchQueries({ type: 'active' }),
      // Unknown device (e.g. after a backend reset): any REST call re-registers it silently.
      onHandshakeFail: () => void citizenApi.mySos().catch(() => undefined),
      onEvent: (e) => {
        const store = useCitizenStore.getState();
        switch (e.type) {
          case 'route.rerouted':
            qc.setQueryData<Route | null>(qk.route, e.data.new_route);
            useRoutingStore.getState().fromRoute(e.data.new_route);
            store.setReroute(e.data);
            vibrate([250, 120, 250, 120, 400]);
            announce(
              `${tr.citizen.reroute.title}: ${tr.rerouteReason[e.data.reason]}`,
              'assertive',
            );
            break;
          case 'sos.updated': {
            const patch = e.data;
            qc.setQueryData<Sos[]>(qk.mySos, (old) =>
              old?.some((s) => sameId(s.id, patch.id))
                ? old.map((s) => (sameId(s.id, patch.id) ? { ...s, ...patch } : s))
                : patch.type
                  ? [patch as Sos, ...(old ?? [])]
                  : old,
            );
            const active = store.activeSos;
            if (active && sameId(active.id, patch.id)) {
              const next = { ...active, ...patch };
              if (active.status !== next.status) {
                vibrate(180);
                announce(sosStatusText(next), 'assertive');
              }
              useCitizenStore.setState({ activeSos: next, sosEtaAt: etaDeadline(next) });
            }
            break;
          }
          case 'point.occupancy':
            applyPointOccupancy(qc, e.data);
            break;
          case 'routing.status':
            useRoutingStore.getState().apply(e.data);
            break;
          case 'broadcast.message':
            toast(e.data.title ?? tr.citizen.broadcast, {
              description: e.data.message,
              duration: 12_000,
            });
            vibrate(300);
            break;
          default:
            break;
        }
      },
    });
    socket.start();
    return () => socket.stop();
  }, [enabled, lang, qc, setStatus]);
}
