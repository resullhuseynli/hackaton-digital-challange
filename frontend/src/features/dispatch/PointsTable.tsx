import { MapPin } from 'lucide-react';
import { useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { OccupancyBar } from '@/components/ui/occupancy-bar';
import { EmptyState, ErrorState, ListSkeleton } from '@/components/ui/states';
import { tr } from '@/i18n';
import { formatNumber } from '@/lib/format';
import { POINT_META } from '@/lib/status';
import { cn } from '@/lib/utils';
import type { PointStatus } from '@/types/api';
import { useDispatchPoints, useDispatchZones } from './queries';
import { useShowOnMap } from './useDispatchActions';

const STATUS_VARIANT: Record<PointStatus, 'safe' | 'info' | 'neutral'> = {
  active: 'safe',
  reserve: 'info',
  closed: 'neutral',
};

export function PointsTable() {
  const q = useDispatchPoints();
  const zones = useDispatchZones().data;
  const showOnMap = useShowOnMap();
  const zoneName = useMemo(
    () => new Map((zones ?? []).map((z) => [String(z.id), z.name])),
    [zones],
  );
  const list = useMemo(
    () =>
      [...(q.data ?? [])].sort(
        (a, b) =>
          Number(a.status !== 'active') - Number(b.status !== 'active') ||
          b.occupancy_pct - a.occupancy_pct,
      ),
    [q.data],
  );

  if (q.isLoading) return <ListSkeleton rows={8} />;
  if (q.isError && !q.data) {
    return (
      <ErrorState title={tr.dispatch.points.error} error={q.error} onRetry={() => q.refetch()} />
    );
  }
  if (!list.length) return <EmptyState title={tr.dispatch.points.empty} />;

  const c = tr.pages.col;
  return (
    <div className="overflow-hidden rounded-2xl border bg-card">
      <table className="w-full text-sm">
        <caption className="sr-only">{tr.nav.points}</caption>
        <thead className="sticky top-0 z-10 bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground backdrop-blur">
          <tr>
            <th scope="col" className="px-4 py-3 font-medium">
              {c.name}
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              {c.type}
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              {c.zone}
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              {c.status}
            </th>
            <th scope="col" className="px-4 py-3 text-right font-medium">
              {c.people}
            </th>
            <th scope="col" className="w-[26%] px-4 py-3 font-medium">
              {c.occupancy}
            </th>
            <th scope="col" className="px-4 py-3">
              <span className="sr-only">{c.actions}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {list.map((p) => {
            const meta = POINT_META[p.type];
            const Icon = meta.icon;
            return (
              <tr
                key={String(p.id)}
                className={cn(
                  'border-t hover:bg-accent/40',
                  p.status !== 'active' && 'text-muted-foreground',
                )}
              >
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2.5">
                    <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="font-medium text-foreground">{p.name}</span>
                  </div>
                </td>
                <td className="px-4 py-2.5">{meta.label}</td>
                <td className="px-4 py-2.5">{zoneName.get(String(p.zone_id)) ?? '—'}</td>
                <td className="px-4 py-2.5">
                  <Badge variant={STATUS_VARIANT[p.status]}>{tr.pointStatus[p.status]}</Badge>
                </td>
                <td className="tabular px-4 py-2.5 text-right">
                  {formatNumber(p.current_count)} / {formatNumber(p.capacity)}
                </td>
                <td className="px-4 py-2.5">
                  {p.status === 'active' ? (
                    <OccupancyBar pct={p.occupancy_pct} size="sm" />
                  ) : (
                    <span className="text-xs">—</span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => showOnMap({ kind: 'point', id: p.id }, p, 15)}
                    aria-label={`${tr.nav.showOnMap}: ${p.name}`}
                  >
                    <MapPin className="h-4 w-4" aria-hidden />
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
