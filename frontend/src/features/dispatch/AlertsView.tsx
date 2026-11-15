import { MapPin, ShieldCheck, Siren, Truck, Users, Building2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorState, ListSkeleton } from '@/components/ui/states';
import { useNow } from '@/hooks/useNow';
import { tr } from '@/i18n';
import { formatDistance, formatEta, timeAgo } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useDispatchStore } from '@/stores/dispatchStore';
import { useAlerts } from './queries';
import { LabelList } from './LabelBadge';
import { useShowOnMap } from './useDispatchActions';

/** Active RED ALERTs; each opens the confirm/dismiss modal. */
export function AlertsView({ compact = false }: { compact?: boolean }) {
  const q = useAlerts();
  const openAlert = useDispatchStore((s) => s.openAlert);
  const showOnMap = useShowOnMap();
  const now = useNow(15_000);

  if (q.isLoading) return <ListSkeleton rows={3} />;
  if (q.isError && !q.data) {
    return <ErrorState title={tr.alert.error} error={q.error} onRetry={() => q.refetch()} />;
  }
  if (!q.data?.length) {
    return (
      <EmptyState
        title={tr.pages.alertsEmpty}
        hint={tr.pages.alertsEmptyHint}
        icon={<ShieldCheck className="h-6 w-6 text-safe" aria-hidden />}
        className={compact ? 'py-8' : 'rounded-2xl border bg-card py-16'}
      />
    );
  }

  return (
    <ul className={compact ? 'flex flex-col gap-3' : 'grid grid-cols-1 gap-4 xl:grid-cols-2'}>
      {q.data.map((a) => (
        <li
          key={String(a.id)}
          className="overflow-hidden rounded-2xl border-2 border-danger/60 bg-card"
        >
          <div className="flex items-center gap-3 bg-danger/15 px-4 py-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-danger text-white">
              <Siren className="h-5 w-5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-bold">{a.zone_name ?? '—'}</p>
              <p className="text-xs text-muted-foreground">
                {tr.alert.kind[a.kind]} · {timeAgo(a.created_at, now)}
              </p>
            </div>
            {a.kind === 'SOS_CLUSTER' && (
              <Badge variant="solidDanger" className="tabular">
                <Users aria-hidden />
                {a.distinct_citizens}
              </Badge>
            )}
          </div>
          {a.mobility_impaired_sos_ids?.length > 0 && (
            <div className="flex flex-col gap-1.5 border-b border-violet-500/40 bg-violet-600/10 px-4 py-2">
              <LabelList labels={a.labels} size="sm" />
              <p className="text-xs font-semibold text-violet-200">{tr.a11y.clusterHasMi}</p>
            </div>
          )}
          <dl className={cn('grid gap-3 p-4 text-sm', compact ? 'grid-cols-1' : 'grid-cols-2')}>
            <div>
              <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Truck className="h-3.5 w-3.5" aria-hidden />
                {tr.alert.recommendedBrigade}
              </dt>
              <dd className="font-medium">
                {a.recommended_brigade
                  ? `${a.recommended_brigade.name} · ${formatEta(a.recommended_brigade.eta_min)}`
                  : tr.alert.noBrigade}
              </dd>
            </div>
            <div>
              <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Building2 className="h-3.5 w-3.5" aria-hidden />
                {tr.alert.recommendedPoint}
              </dt>
              <dd className="font-medium">
                {a.recommended_new_point
                  ? `${a.recommended_new_point.name} · ${formatDistance(a.recommended_new_point.distance_m)}`
                  : tr.alert.noPoint}
              </dd>
            </div>
          </dl>
          <div className="flex gap-2 border-t p-3">
            <Button variant="danger" className="flex-1" onClick={() => openAlert(a.id)}>
              <Siren className="h-4 w-4" aria-hidden />
              {tr.pages.openAlert}
            </Button>
            <Button
              variant="outline"
              onClick={() => showOnMap({ kind: 'zone', id: a.zone_id ?? a.id }, a.center, 14.5)}
            >
              <MapPin className="h-4 w-4" aria-hidden />
              {tr.nav.showOnMap}
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}
