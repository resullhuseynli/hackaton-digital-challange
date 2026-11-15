import { useQueryClient } from '@tanstack/react-query';
import { CloudOff, Route as RouteIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { qk } from '@/api/queryKeys';
import { fill, tr } from '@/i18n';
import { cn } from '@/lib/utils';
import { useRoutingStore } from '@/stores/routingStore';
import type { RoutingStatus } from '@/types/api';

/** Seconds left until `at` (epoch ms), ticking once a second; null when there is no deadline. */
function useCountdown(at: number | null): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (at == null) return;
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [at]);
  return at == null ? null : Math.max(0, Math.ceil((at - now) / 1000));
}

/**
 * Dispatcher KPI tile "Routing service": green Online / amber Backup mode. In backup mode it
 * shows the breaker state, failure count, last error and a live countdown to the next
 * half-open trial; at 0 it refreshes GET /routing/status.
 */
export function RoutingTile({ overviewStatus }: { overviewStatus?: RoutingStatus | null }) {
  const qc = useQueryClient();
  const live = useRoutingStore((s) => s.status);
  const breaker = useRoutingStore((s) => s.breaker);
  const retryAt = useRoutingStore((s) => s.retryAt);
  const left = useCountdown(retryAt);
  const status = live !== 'unknown' ? live : (overviewStatus ?? null);
  const fallback = status === 'fallback';

  // Refresh once when the countdown reaches zero.
  const firedFor = useRef<number | null>(null);
  useEffect(() => {
    if (left === 0 && retryAt != null && firedFor.current !== retryAt) {
      firedFor.current = retryAt;
      void qc.invalidateQueries({ queryKey: qk.routingStatusAll });
    }
  }, [left, retryAt, qc]);

  const color = status == null ? '#64748B' : fallback ? '#F59E0B' : '#16A34A';
  const Icon = fallback ? CloudOff : RouteIcon;

  return (
    <div
      className={cn(
        'flex min-w-0 items-center gap-3 rounded-2xl border bg-card px-3 py-2.5 shadow-soft',
        fallback && 'border-amber-500/60 bg-amber-500/10',
      )}
    >
      <div
        className="grid h-10 w-10 shrink-0 place-items-center rounded-xl"
        style={{ backgroundColor: `${color}22`, color }}
      >
        <Icon className="h-5 w-5" aria-hidden />
      </div>
      <div className="min-w-0">
        <p className="line-clamp-2 text-[11px] font-medium uppercase leading-tight tracking-wide text-muted-foreground">
          {tr.routing.service}
        </p>
        {/* Tiles are ~150 px wide at 1280–1400 px: wrap instead of truncating. */}
        <p className="text-sm font-bold leading-tight" style={{ color }}>
          {status == null ? '—' : fallback ? tr.routing.backupBadge : tr.routing.online}
        </p>
        {fallback && breaker && (
          <>
            <p
              className="tabular text-[11px] leading-tight text-muted-foreground"
              title={`${tr.routing.breaker}: ${breaker.state}`}
            >
              <span className="font-semibold">{breaker.state}</span> · {breaker.failures}{' '}
              {tr.routing.failures}
              {breaker.last_error && <span className="block">{breaker.last_error}</span>}
            </p>
            {left != null && (
              <p className="tabular text-[11px] font-semibold text-amber-600 dark:text-amber-300">
                {left > 0 ? fill(tr.routing.nextTrial, { s: left }) : tr.routing.checking}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
