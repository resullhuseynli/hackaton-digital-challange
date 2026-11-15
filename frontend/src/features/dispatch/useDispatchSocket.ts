import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { toast } from 'sonner';
import { dispatchApi } from '@/api/endpoints';
import { normalizeOverview } from '@/api/normalize';
import { qk } from '@/api/queryKeys';
import { LiveSocket } from '@/api/ws';
import { fill, tr, useLang } from '@/i18n';
import { alarm } from '@/lib/alarm';
import { env } from '@/lib/env';
import { mergeSos } from '@/lib/sosOrder';
import { sameId } from '@/lib/utils';
import { useAuthStore } from '@/stores/authStore';
import { useConnectionStore } from '@/stores/connectionStore';
import { useDispatchStore } from '@/stores/dispatchStore';
import { useRoutingStore } from '@/stores/routingStore';
import type {
  Alert,
  AssemblyPoint,
  Brigade,
  Overview,
  RoadCollection,
  RoadProps,
  Sos,
  TimeseriesBucket,
} from '@/types/api';
import type { DispatchEvent, PointOccupancyData, RoadUpdatedData } from '@/types/ws';

/** Merge a (possibly partial) event into a cached list by id. Unknown partial rows are skipped. */
function upsert<T extends { id: Sos['id'] }>(
  list: T[] | undefined,
  item: Partial<T> & Pick<T, 'id'>,
  isComplete: (x: Partial<T>) => boolean,
): T[] | undefined {
  const i = list?.findIndex((x) => sameId(x.id, item.id)) ?? -1;
  if (i < 0) {
    if (!isComplete(item)) return list;
    return [...(list ?? []), item as T];
  }
  const next = list!.slice();
  next[i] = { ...next[i], ...item };
  return next;
}

const isFullBrigade = (b: Partial<Brigade>) => b.type != null && b.lat != null && b.name != null;
const isFullAlert = (a: Partial<Alert>) => a.kind != null && a.center != null;

function bumpTimeseries(qc: QueryClient, s: Sos) {
  qc.setQueryData<TimeseriesBucket[]>(qk.timeseries, (old) => {
    if (!old?.length) return old;
    const minute = Math.floor(new Date(s.created_at).getTime() / 60_000) * 60_000;
    const last = old[old.length - 1];
    const lastMinute = Math.floor(new Date(last.ts).getTime() / 60_000) * 60_000;
    if (minute === lastMinute) {
      return [...old.slice(0, -1), { ...last, [s.type]: last[s.type] + 1 }];
    }
    if (minute > lastMinute) {
      const fresh: TimeseriesBucket = {
        ts: new Date(minute).toISOString(),
        fire: 0,
        collapse: 0,
        flood: 0,
        medical: 0,
        [s.type]: 1,
      };
      return [...old.slice(1), fresh];
    }
    return old;
  });
}

function patchPoint(qc: QueryClient, d: PointOccupancyData) {
  const id = d.point_id ?? d.id;
  if (id == null) return;
  qc.setQueryData<AssemblyPoint[]>(qk.dispatchPoints, (old) =>
    old?.map((p) =>
      sameId(p.id, id)
        ? {
            ...p,
            ...Object.fromEntries(Object.entries(d).filter(([k]) => k !== 'point_id')),
            id: p.id,
          }
        : p,
    ),
  );
}

let trafficRefetch: number | null = null;

/**
 * `road.updated` is `{segments: [{id, status, congestion_factor, barrier, accessible}]}` from the
 * backend (one GeoJSON feature from the mock). Patch what is cached right away, then refetch the
 * visible traffic/barrier layers once, because a segment can enter or leave a filtered layer.
 */
function patchRoad(qc: QueryClient, data: RoadUpdatedData) {
  const updates: { id: RoadProps['id']; props: Partial<RoadProps> }[] =
    'segments' in data
      ? data.segments.map(({ id, ...rest }) => ({ id, props: rest }))
      : [{ id: data.properties.id, props: data.properties }];
  qc.setQueriesData<RoadCollection>({ queryKey: qk.trafficAll }, (old) => {
    if (!old) return old;
    return {
      ...old,
      features: old.features.map((f) => {
        const u = updates.find((x) => sameId(x.id, f.properties.id));
        return u ? { ...f, properties: { ...f.properties, ...u.props } } : f;
      }),
    };
  });
  if (trafficRefetch != null) window.clearTimeout(trafficRefetch);
  trafficRefetch = window.setTimeout(() => {
    trafficRefetch = null;
    void qc.invalidateQueries({ queryKey: qk.trafficAll });
  }, 400);
}

/**
 * KPIs change with these events, but the backend does not always push `overview.updated`
 * for each one, so refetch the overview (at most once per second).
 */
const KPI_EVENTS = new Set([
  'sos.created',
  'sos.updated',
  'alert.raised',
  'alert.resolved',
  'point.occupancy',
]);
let overviewTimer: number | null = null;
function refreshOverviewSoon(qc: QueryClient) {
  if (overviewTimer != null) return;
  overviewTimer = window.setTimeout(() => {
    overviewTimer = null;
    void qc.invalidateQueries({ queryKey: qk.overview });
  }, 1000);
}

function onAlertRaised(a: Alert) {
  const st = useDispatchStore.getState();
  st.queueAlert(a.id);
  if (!st.muted) alarm.play(8);
  toast.error(fill(tr.alert.toast, { zone: a.zone_name ?? tr.alert.kind[a.kind] }), {
    description: `${tr.alert.kind[a.kind]} · ${a.distinct_citizens} ${tr.alert.signals.toLowerCase()}`,
    duration: 10_000,
    action: { label: tr.alert.title, onClick: () => useDispatchStore.getState().openAlert(a.id) },
  });
}

/**
 * Dispatcher WebSocket: every event patches the TanStack Query cache in place. Reopened when the
 * language changes (labels arrive localized per socket); refetches everything after a reconnect.
 */
export function useDispatchSocket() {
  const qc = useQueryClient();
  const token = useAuthStore((s) => s.token);
  const lang = useLang();
  const setStatus = useConnectionStore((s) => s.setDispatchSocket);

  useEffect(() => {
    if (!token) return;
    const socket = new LiveSocket<DispatchEvent>({
      url: () => `${env.wsUrl}/ws/dispatch?token=${encodeURIComponent(token)}&lang=${lang}`,
      onStatus: setStatus,
      onReconnect: () => void qc.refetchQueries({ type: 'active' }),
      // A rejected handshake usually means the token expired: a REST call returns 401 → logout.
      onHandshakeFail: () => void dispatchApi.overview().catch(() => undefined),
      onEvent: (e) => {
        if (KPI_EVENTS.has(e.type)) refreshOverviewSoon(qc);
        switch (e.type) {
          case 'sos.created': {
            qc.setQueryData<Sos[]>(qk.sos, (old) => mergeSos(old, e.data));
            const st = useDispatchStore.getState();
            st.highlightSos(e.data.id);
            if (e.data.citizen_mobility_impaired && !st.muted) alarm.chime();
            bumpTimeseries(qc, e.data);
            break;
          }
          case 'sos.updated':
            qc.setQueryData<Sos[]>(qk.sos, (old) => mergeSos(old, e.data));
            break;
          case 'point.occupancy':
            patchPoint(qc, e.data);
            break;
          case 'road.updated':
            patchRoad(qc, e.data);
            break;
          case 'route.rerouted':
            // Aggregated {count} from the backend; one event per citizen from the mock.
            useDispatchStore.getState().addRerouted(e.data.count ?? 1);
            break;
          case 'brigade.updated':
            qc.setQueryData<Brigade[]>(qk.brigades, (old) => upsert(old, e.data, isFullBrigade));
            break;
          case 'alert.raised':
            qc.setQueryData<Alert[]>(qk.alerts, (old) => upsert(old, e.data, isFullAlert));
            onAlertRaised(e.data);
            break;
          case 'alert.updated':
            qc.setQueryData<Alert[]>(qk.alerts, (old) => upsert(old, e.data, isFullAlert));
            break;
          case 'alert.resolved':
            useDispatchStore.getState().setAlertOutcome(e.data);
            qc.setQueryData<Alert[]>(qk.alerts, (old) =>
              old?.filter((a) => !sameId(a.id, e.data.id)),
            );
            useDispatchStore.getState().forgetAlert(e.data.id);
            break;
          case 'overview.updated': {
            const o = normalizeOverview(e.data);
            qc.setQueryData(qk.overview, o);
            // Mode changed without a routing.status event (e.g. missed): fetch breaker details.
            const routing = useRoutingStore.getState().status;
            if (o.routing_status && routing !== 'unknown' && o.routing_status !== routing) {
              void qc.invalidateQueries({ queryKey: qk.routingStatusAll });
            }
            break;
          }
          case 'routing.status':
            useRoutingStore.getState().apply(e.data);
            break;
          case 'sos.suspected': {
            // Aggregated (≤ 1 per 5 s) instead of one event per fake SOS: badge, banner, list.
            useDispatchStore.getState().setSuspected(e.data);
            qc.setQueryData<Overview>(qk.overview, (o) =>
              o ? { ...o, suspected_sos: e.data.quarantined_pending } : o,
            );
            void qc.invalidateQueries({ queryKey: qk.suspected });
            break;
          }
          case 'sim.reset':
            // Baseline restored: drop local selections and refetch everything.
            useDispatchStore.setState({
              selection: null,
              openAlertId: null,
              unseenAlertIds: [],
              burstLocation: null,
            });
            void qc.invalidateQueries();
            break;
          default:
            break;
        }
      },
    });
    socket.start();
    return () => socket.stop();
  }, [token, lang, qc, setStatus]);
}
