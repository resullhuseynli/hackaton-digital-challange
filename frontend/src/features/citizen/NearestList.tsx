import { History, MapPinned } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { EmptyState, ErrorState, ListSkeleton } from '@/components/ui/states';
import { tr } from '@/i18n';
import { sameId } from '@/lib/utils';
import type { Id, NearestPoint } from '@/types/api';
import { ApproxDistancesNote } from '@/features/routing/RouteRoutingInfo';
import { PointCard } from './PointCard';

interface Props {
  data: NearestPoint[] | undefined;
  cached: NearestPoint[] | null;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
  selectedId: Id | null;
  routingId: Id | null;
  onSelect: (n: NearestPoint) => void;
  onRoute: (n: NearestPoint) => void;
}

export function NearestList({
  data,
  cached,
  isLoading,
  isError,
  error,
  onRetry,
  selectedId,
  routingId,
  onSelect,
  onRoute,
}: Props) {
  const usingCache = !data && isError && !!cached?.length;
  const items = data ?? (usingCache ? cached : undefined);

  if (isLoading && !items) return <ListSkeleton rows={3} />;
  if (!items && isError) {
    return <ErrorState title={tr.citizen.nearest.error} error={error} onRetry={onRetry} />;
  }
  if (!items?.length) {
    return (
      <EmptyState
        title={tr.citizen.nearest.empty}
        hint={tr.citizen.nearest.emptyHint}
        icon={<MapPinned className="h-6 w-6" aria-hidden />}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {usingCache && (
        <Badge variant="warning" className="self-start">
          <History aria-hidden />
          {tr.citizen.nearest.offlineCached}
        </Badge>
      )}
      <ApproxDistancesNote items={items} />
      <ul className="flex flex-col gap-3" aria-label={tr.citizen.nearest.title}>
        {items.map((n, i) => (
          <PointCard
            key={String(n.point.id)}
            item={n}
            index={i}
            selected={sameId(n.point.id, selectedId)}
            approx={n.source === 'static_matrix'}
            routing={sameId(n.point.id, routingId)}
            disabled={routingId != null}
            onSelect={() => onSelect(n)}
            onRoute={() => onRoute(n)}
          />
        ))}
      </ul>
    </div>
  );
}
