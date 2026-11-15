import { Building2, MapPinOff, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Input } from '@/components/ui/misc';
import { EmptyState, ErrorState, ListSkeleton } from '@/components/ui/states';
import { useCitizen } from '@/features/citizen/citizenContext';
import { PointCard } from '@/features/citizen/PointCard';
import { useNearest, usePoints } from '@/features/citizen/queries';
import { tr } from '@/i18n';
import { haversine } from '@/lib/geo';
import { POINT_META } from '@/lib/status';
import { cn, sameId } from '@/lib/utils';
import { useCitizenStore } from '@/stores/citizenStore';
import type { NearestPoint, PointType } from '@/types/api';
import { ApproxDistancesNote } from '@/features/routing/RouteRoutingInfo';
import { TabPage } from './TabPage';

const WALK_M_PER_MIN = 80;
const TYPES: (PointType | 'all')[] = ['all', 'shelter', 'park', 'stadium'];

/** Every active assembly point, sorted by distance, filterable by type. */
export default function PointsTab() {
  const { location, startRoute, routingId } = useCitizen();
  const points = usePoints();
  const cached = useCitizenStore((s) => s.lastPoints);
  const selectedId = useCitizenStore((s) => s.selectedPointId);
  const zoneId = useCitizenStore((s) => s.zoneId);
  const mi = useCitizenStore((s) => s.mobilityImpaired);
  const navigate = useNavigate();
  const [type, setType] = useState<PointType | 'all'>('all');
  const [q, setQ] = useState('');

  // Same query as the map tab: the backend's street-routed distances for the closest points.
  const nearest = useNearest(location, zoneId);

  const items = useMemo<(NearestPoint & { approx: boolean })[]>(() => {
    const routed = new Map((nearest.data ?? []).map((n) => [String(n.point.id), n]));
    // Step-free mode: only wheelchair-accessible points, like the backend's nearest list.
    const list = (points.data ?? cached ?? []).filter(
      (p) => p.status === 'active' && (!mi || p.wheelchair_accessible),
    );
    const needle = q.trim().toLocaleLowerCase('az');
    return list
      .filter((p) => type === 'all' || p.type === type)
      .filter((p) => !needle || p.name.toLocaleLowerCase('az').includes(needle))
      .map((p) => {
        const known = routed.get(String(p.id));
        // Routed by the backend; still an estimate when it came from the static matrix.
        if (known) {
          const approx = known.source === 'static_matrix';
          return { ...known, point: { ...p, ...known.point }, approx };
        }
        // Straight-line × 1.25 approximates street distance until a route is built.
        const d = location ? haversine(location, p) * 1.25 : 0;
        return {
          point: p,
          distance_m: d,
          eta_min: d / WALK_M_PER_MIN,
          score: d,
          near_full: p.occupancy_pct >= 85,
          approx: true,
        };
      })
      .sort((a, b) =>
        location ? a.distance_m - b.distance_m : a.point.name.localeCompare(b.point.name),
      );
  }, [points.data, cached, nearest.data, type, q, location, mi]);

  const toolbar = (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={tr.citizen.pointsTab.search}
          aria-label={tr.citizen.pointsTab.search}
          className="h-11 pl-9 text-base"
        />
      </div>
      <div
        role="radiogroup"
        aria-label={tr.citizen.pointsTab.filterLabel}
        className="scrollbar-thin -mx-1 flex gap-2 overflow-x-auto px-1 pb-1"
      >
        {TYPES.map((t) => {
          const Icon = t === 'all' ? Building2 : POINT_META[t].icon;
          const active = type === t;
          return (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setType(t)}
              className={cn(
                'inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full border px-4 text-sm font-semibold transition-colors',
                active
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'bg-card text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className="h-4 w-4" aria-hidden />
              {t === 'all' ? tr.citizen.pointsTab.all : POINT_META[t].label}
            </button>
          );
        })}
      </div>
    </div>
  );

  return (
    <TabPage
      icon={Building2}
      title={tr.citizen.pointsTab.title}
      subtitle={
        mi
          ? tr.citizen.nearest.miSubtitle
          : location
            ? tr.citizen.pointsTab.subtitle
            : tr.citizen.pointsTab.noLocation
      }
      toolbar={toolbar}
    >
      {points.isLoading && !cached ? (
        <ListSkeleton rows={4} />
      ) : points.isError && !items.length ? (
        <ErrorState
          title={tr.citizen.nearest.error}
          error={points.error}
          onRetry={() => points.refetch()}
        />
      ) : !items.length ? (
        <EmptyState
          title={tr.citizen.nearest.empty}
          icon={<MapPinOff className="h-6 w-6" aria-hidden />}
        />
      ) : (
        <>
          <ApproxDistancesNote items={nearest.data} />
          <ul className="flex flex-col gap-3" aria-label={tr.citizen.pointsTab.title}>
            {items.map((n, i) => (
              <PointCard
                key={String(n.point.id)}
                item={n}
                index={Math.min(i, 8)}
                selected={sameId(n.point.id, selectedId)}
                approx={n.approx && location != null}
                routing={sameId(n.point.id, routingId)}
                disabled={routingId != null || !location}
                onSelect={() => {
                  useCitizenStore.getState().selectPoint(n.point.id);
                  navigate('/');
                }}
                onRoute={async () => {
                  if (await startRoute(n.point)) navigate('/');
                }}
              />
            ))}
          </ul>
        </>
      )}
    </TabPage>
  );
}
