import { MapPin } from 'lucide-react';
import { useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { EmptyState, ErrorState, ListSkeleton } from '@/components/ui/states';
import { tr } from '@/i18n';
import { BRIGADE_META, BRIGADE_STATUS_VARIANT, SOS_META } from '@/lib/status';
import { sameId } from '@/lib/utils';
import type { BrigadeStatus } from '@/types/api';
import { useBrigades, useSosList } from './queries';
import { useShowOnMap } from './useDispatchActions';

const ORDER: Record<BrigadeStatus, number> = { en_route: 0, on_site: 1, returning: 2, idle: 3 };
const STATUSES: BrigadeStatus[] = ['idle', 'en_route', 'on_site', 'returning'];

export function BrigadesView({ compact = false }: { compact?: boolean }) {
  const q = useBrigades();
  const sos = useSosList().data;
  const showOnMap = useShowOnMap();
  const list = useMemo(
    () => [...(q.data ?? [])].sort((a, b) => ORDER[a.status] - ORDER[b.status]),
    [q.data],
  );
  const counts = useMemo(
    () =>
      Object.fromEntries(
        STATUSES.map((s) => [s, list.filter((b) => b.status === s).length]),
      ) as Record<BrigadeStatus, number>,
    [list],
  );

  if (q.isLoading) return <ListSkeleton rows={6} />;
  if (q.isError && !q.data) {
    return (
      <ErrorState title={tr.dispatch.brigades.error} error={q.error} onRetry={() => q.refetch()} />
    );
  }
  if (!list.length) return <EmptyState title={tr.dispatch.brigades.empty} />;

  if (compact) {
    return (
      <ul className="flex flex-col gap-1.5" aria-label={tr.dispatch.tabs.brigades}>
        {list.map((b) => {
          const m = BRIGADE_META[b.type];
          const Icon = m.icon;
          const target = sos?.find((s) => sameId(s.id, b.target_sos_id));
          return (
            <li key={String(b.id)}>
              <button
                type="button"
                onClick={() => showOnMap({ kind: 'brigade', id: b.id }, b, 14.5)}
                className="flex min-h-11 w-full items-center gap-2.5 rounded-xl border bg-background/40 p-2.5 text-left hover:bg-accent focus-visible:bg-accent"
              >
                <span
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-white"
                  style={{ backgroundColor: m.color }}
                >
                  <Icon className="h-4 w-4" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{b.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {m.label} ·{' '}
                    {target
                      ? `${tr.dispatch.brigades.target}: ${SOS_META[target.type]?.label} #${String(target.id).slice(-5)}`
                      : tr.dispatch.brigades.noTarget}
                  </span>
                </span>
                <Badge variant={BRIGADE_STATUS_VARIANT[b.status]}>
                  {tr.brigadeStatus[b.status]}
                </Badge>
              </button>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-4 gap-3" aria-label={tr.pages.total}>
        {STATUSES.map((s) => (
          <div key={s} className="flex items-center justify-between rounded-2xl border bg-card p-4">
            <Badge variant={BRIGADE_STATUS_VARIANT[s]}>{tr.brigadeStatus[s]}</Badge>
            <span className="tabular text-2xl font-bold">{counts[s]}</span>
          </div>
        ))}
      </div>
      <ul className="grid grid-cols-2 gap-3 xl:grid-cols-3 2xl:grid-cols-4">
        {list.map((b) => {
          const m = BRIGADE_META[b.type];
          const Icon = m.icon;
          const target = sos?.find((s) => sameId(s.id, b.target_sos_id));
          return (
            <li key={String(b.id)} className="flex flex-col gap-3 rounded-2xl border bg-card p-4">
              <div className="flex items-start gap-3">
                <span
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-white"
                  style={{ backgroundColor: m.color }}
                >
                  <Icon className="h-5 w-5" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{b.name}</p>
                  <p className="text-xs text-muted-foreground">{m.label}</p>
                </div>
                <Badge variant={BRIGADE_STATUS_VARIANT[b.status]}>
                  {tr.brigadeStatus[b.status]}
                </Badge>
              </div>
              <p className="min-h-[2.5rem] text-sm text-muted-foreground">
                {target ? (
                  <>
                    <span className="font-medium text-foreground">
                      {tr.dispatch.brigades.target}:
                    </span>{' '}
                    {SOS_META[target.type]?.label} #{String(target.id).slice(-5)}
                    {target.brigade_eta_min != null &&
                      ` · ${Math.round(target.brigade_eta_min)} ${tr.units.min}`}
                  </>
                ) : (
                  tr.dispatch.brigades.noTarget
                )}
              </p>
              <button
                type="button"
                onClick={() => showOnMap({ kind: 'brigade', id: b.id }, b, 14.5)}
                className="inline-flex items-center gap-1.5 self-start rounded-lg text-sm font-medium text-primary hover:underline focus-visible:underline"
              >
                <MapPin className="h-4 w-4" aria-hidden />
                {tr.nav.showOnMap}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
