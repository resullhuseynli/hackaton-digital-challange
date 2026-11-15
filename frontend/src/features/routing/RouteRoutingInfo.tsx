import { CloudOff, History, Loader2, RefreshCw, Signpost } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { tr } from '@/i18n';
import { useRoutingStore } from '@/stores/routingStore';
import type { NearestPoint, Route } from '@/types/api';
import { isFallbackRoute } from './routeMeta';

/** Small "Ehtiyat rejimi" / "Backup mode" badge (icon + text, never colour alone). */
export function BackupBadge({ className }: { className?: string }) {
  return (
    <Badge variant="warning" className={className}>
      <CloudOff aria-hidden />
      {tr.routing.backupBadge}
    </Badge>
  );
}

/**
 * Route-card extras for backup routing: the cache / approximate hints, and — once the online
 * service is back — a "Refresh route" button (the route is never rebuilt automatically).
 */
export function RouteRoutingHints({
  route,
  onRefresh,
  refreshing,
}: {
  route: Route;
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  const online = useRoutingStore((s) => s.status === 'online');
  const canRefresh = online && isFallbackRoute(route) && onRefresh;
  if (route.source !== 'cache' && route.source !== 'static_matrix' && !canRefresh) return null;

  return (
    <div className="mt-2 flex flex-col gap-1.5">
      {route.source === 'cache' && (
        <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <History className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {tr.routing.cached}
        </p>
      )}
      {route.source === 'static_matrix' && (
        <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-800 dark:text-amber-300">
          <Signpost className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {tr.routing.approximate}
        </p>
      )}
      {canRefresh && (
        <Button
          variant="outline"
          size="sm"
          className="h-10"
          onClick={onRefresh}
          disabled={refreshing}
        >
          {refreshing ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <RefreshCw className="h-4 w-4" aria-hidden />
          )}
          {tr.routing.refresh}
        </Button>
      )}
    </div>
  );
}

/** One-line note above a nearest list when any distance is a static-matrix estimate. */
export function ApproxDistancesNote({
  items,
}: {
  items: Pick<NearestPoint, 'source'>[] | null | undefined;
}) {
  if (!items?.some((n) => n.source === 'static_matrix')) return null;
  return (
    <p className="flex items-center gap-1.5 text-xs font-medium text-amber-800 dark:text-amber-300">
      <Signpost className="h-3.5 w-3.5 shrink-0" aria-hidden />
      {tr.routing.approxDistances}
    </p>
  );
}
