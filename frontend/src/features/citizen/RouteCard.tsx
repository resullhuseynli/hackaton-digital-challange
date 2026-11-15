import { AnimatePresence, motion } from 'framer-motion';
import {
  Accessibility,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Clock,
  Loader2,
  Ruler,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { OccupancyBar } from '@/components/ui/occupancy-bar';
import { fill, tr } from '@/i18n';
import { cn, withoutWheelchair } from '@/lib/utils';
import { formatDistance, formatEta } from '@/lib/format';
import { haversine } from '@/lib/geo';
import { POINT_META, ROUTE_COLOR, STEP_FREE_COLOR } from '@/lib/status';
import { BackupBadge, RouteRoutingHints } from '@/features/routing/RouteRoutingInfo';
import { approxPrefix, isFallbackRoute } from '@/features/routing/routeMeta';
import type { AssemblyPoint, LatLng, Route } from '@/types/api';

/** "Çatdım" unlocks within this distance of the target point (brief §3.6). */
export const ARRIVAL_RADIUS_M = 100;

interface Props {
  route: Route;
  point: AssemblyPoint | undefined;
  location: LatLng | null;
  mobilityImpaired: boolean;
  checkingIn: boolean;
  onArrived: () => void;
  onClose: () => void;
  /** Rebuild the same route (offered after the online routing service recovers). */
  onRefresh?: () => void;
  refreshing?: boolean;
}

/**
 * Compact route summary that leaves the map readable: destination, ETA and distance on two
 * lines. Occupancy and the "Çatdım" button sit behind "Details", and open by themselves once
 * the citizen is within the arrival radius (when the button becomes usable).
 */
export function RouteCard({
  route,
  point,
  location,
  mobilityImpaired,
  checkingIn,
  onArrived,
  onClose,
  onRefresh,
  refreshing,
}: Props) {
  const Icon = point ? POINT_META[point.type].icon : CheckCircle2;
  const toPoint = point && location ? haversine(location, point) : null;
  const near = toPoint != null && toPoint <= ARRIVAL_RADIUS_M;
  const accent = route.accessible ? STEP_FREE_COLOR : ROUTE_COLOR;
  const approx = approxPrefix(route);
  const [expanded, setExpanded] = useState(false);
  const open = expanded || near;
  const detailsId = `route-details-${route.id}`;

  return (
    <motion.div
      initial={{ y: -20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: -20, opacity: 0 }}
      className="pointer-events-auto rounded-2xl border bg-card/95 p-3 shadow-lift backdrop-blur"
      role="region"
      aria-label={tr.citizen.route.to}
    >
      <div className="flex items-center gap-3">
        <div
          className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-white"
          style={{ backgroundColor: accent }}
        >
          <Icon className="h-5 w-5" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {tr.citizen.route.to}
            <span
              className="tabular rounded bg-muted px-1 text-[10px] normal-case"
              aria-label={fill(tr.citizen.route.versionAria, { n: route.version })}
            >
              {fill(tr.citizen.route.version, { n: route.version })}
            </span>
          </p>
          <p className="truncate text-base font-bold leading-tight">{point?.name ?? '—'}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <span className="tabular inline-flex items-center gap-1 font-bold">
              <Clock className="h-4 w-4" style={{ color: accent }} aria-hidden />
              <span className="sr-only">{tr.citizen.route.eta}:</span>
              {approx}
              {formatEta(route.eta_min)}
            </span>
            <span className="tabular inline-flex items-center gap-1 font-semibold text-muted-foreground">
              <Ruler className="h-4 w-4" style={{ color: accent }} aria-hidden />
              <span className="sr-only">{tr.citizen.route.distance}:</span>
              {approx}
              {formatDistance(route.distance_m)}
            </span>
            {isFallbackRoute(route) && <BackupBadge className="px-1.5 py-0 text-[10px]" />}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-center">
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label={tr.citizen.route.cancel}
          >
            <X className="h-5 w-5" aria-hidden />
          </Button>
          {!near && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={open}
              aria-controls={detailsId}
              aria-label={open ? tr.citizen.route.hideDetails : tr.citizen.route.showDetails}
            >
              <ChevronDown
                className={cn('h-5 w-5 transition-transform', open && 'rotate-180')}
                aria-hidden
              />
            </Button>
          )}
        </div>
      </div>

      {route.accessible ? (
        <p
          className="mt-2 inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-bold text-white"
          style={{ backgroundColor: STEP_FREE_COLOR }}
        >
          <Accessibility className="h-3.5 w-3.5" aria-hidden />
          {withoutWheelchair(tr.a11y.stepFreeRoute)}
        </p>
      ) : (
        (mobilityImpaired || route.source === 'static_matrix') && (
          <p
            role="alert"
            className="mt-2 flex items-center gap-1.5 rounded-md border border-amber-500 bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-900 dark:bg-amber-500/15 dark:text-amber-200"
          >
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {tr.a11y.routeMayHaveObstacles}
          </p>
        )
      )}
      <RouteRoutingHints route={route} onRefresh={onRefresh} refreshing={refreshing} />

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={detailsId}
            key="details"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            {point && <OccupancyBar pct={point.occupancy_pct} className="mt-3" />}
            <Button
              variant="safe"
              size="lg"
              className="mt-3 w-full"
              onClick={onArrived}
              disabled={checkingIn || !near}
              aria-describedby={!near ? 'arrive-hint' : undefined}
            >
              {checkingIn ? (
                <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
              ) : (
                <CheckCircle2 className="h-5 w-5" aria-hidden />
              )}
              {tr.citizen.route.arrived}
            </Button>
            {!near && toPoint != null && (
              <p id="arrive-hint" className="mt-1.5 text-center text-xs text-muted-foreground">
                {fill(tr.citizen.route.arrivedHint, { d: formatDistance(toPoint) })}
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
