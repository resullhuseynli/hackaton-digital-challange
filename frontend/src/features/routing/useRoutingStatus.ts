import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { toast } from 'sonner';
import { routingApi } from '@/api/endpoints';
import { qk } from '@/api/queryKeys';
import { tr, useLang } from '@/i18n';
import { announce } from '@/lib/announce';
import { useRoutingStore, type RoutingLogEntry } from '@/stores/routingStore';
import type { Route } from '@/types/api';

/** Toast text for one dispatcher log entry (closed → open → half-open → closed). */
export function routingLogText(e: RoutingLogEntry): string {
  if (e.state === 'half_open') return tr.routing.toastHalfOpen;
  return e.status === 'fallback' ? tr.routing.toastOpen : tr.routing.toastClosed;
}

/**
 * Keeps the global routing mode in sync: GET /routing/status on start, after every socket
 * reconnect (the sockets refetch active queries) and after a language switch (the key holds
 * the language, so `notice.text` is re-localized); polled every 60 s while in fallback.
 * `routing.status` socket events and route responses update the same store directly.
 */
export function useRoutingStatus(channel: 'citizen' | 'dispatch') {
  const qc = useQueryClient();
  const lang = useLang();
  const fallback = useRoutingStore((s) => s.status === 'fallback');

  const q = useQuery({
    queryKey: qk.routingStatus(lang),
    queryFn: routingApi.status,
    refetchInterval: fallback ? 60_000 : false,
    staleTime: 0,
  });

  useEffect(() => {
    if (q.data) useRoutingStore.getState().apply(q.data);
  }, [q.data, q.dataUpdatedAt]);

  useEffect(
    () =>
      useRoutingStore.subscribe((s, p) => {
        if (channel === 'citizen') {
          if (p.status === 'fallback' && s.status === 'online') {
            toast.success(tr.routing.restored);
            announce(tr.routing.restored, 'polite');
            // The active route may be outdated; fetch the server's copy (no automatic rebuild).
            const route = qc.getQueryData<Route | null>(qk.route);
            if (route?.routing_status === 'fallback') {
              void qc.refetchQueries({ queryKey: qk.route });
            }
          }
          return;
        }
        // Dispatcher: one toast per transition (the log itself is rendered in the Simulation tab).
        const entry = s.log[0];
        if (entry && entry !== p.log[0] && p.status !== 'unknown') {
          const text = routingLogText(entry);
          if (entry.status === 'fallback') {
            toast.warning(text, { description: entry.error ?? undefined });
          } else {
            toast.success(text);
          }
        }
      }),
    [channel, qc],
  );

  return q;
}
