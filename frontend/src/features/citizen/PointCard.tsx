import { motion } from 'framer-motion';
import { Accessibility, AlertTriangle, Footprints, Loader2, Navigation } from 'lucide-react';
import { memo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { OccupancyBar } from '@/components/ui/occupancy-bar';
import { tr } from '@/i18n';
import { formatDistance, formatEta } from '@/lib/format';
import { POINT_META } from '@/lib/status';
import { cn } from '@/lib/utils';
import type { NearestPoint } from '@/types/api';

interface Props {
  item: NearestPoint;
  index: number;
  selected: boolean;
  /** Distance/ETA are a straight-line estimate, not a routed value. */
  approx?: boolean;
  routing: boolean;
  disabled?: boolean;
  onSelect: () => void;
  onRoute: () => void;
}

export const PointCard = memo(function PointCard({
  item,
  index,
  selected,
  approx,
  routing,
  disabled,
  onSelect,
  onRoute,
}: Props) {
  const { point } = item;
  const meta = POINT_META[point.type];
  const Icon = meta.icon;

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      className={cn(
        'rounded-2xl border bg-background/60 p-3 transition-colors',
        selected && 'border-primary ring-2 ring-primary/30',
      )}
    >
      <div className="flex gap-3">
        <button
          type="button"
          onClick={onSelect}
          className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary"
          aria-label={`${meta.label}: ${point.name}`}
        >
          <Icon className="h-6 w-6" aria-hidden />
        </button>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-start justify-between gap-2">
            <button type="button" onClick={onSelect} className="min-w-0 text-left">
              <p className="truncate font-semibold leading-tight">{point.name}</p>
              <p className="text-xs text-muted-foreground">{meta.label}</p>
            </button>
            <div className="flex shrink-0 flex-col items-end gap-1">
              {point.wheelchair_accessible && (
                <span
                  className="inline-flex items-center gap-1 rounded-full bg-blue-700 px-2 py-0.5 text-xs font-bold text-white"
                  title={tr.a11y.wheelchairAccessible}
                >
                  <Accessibility className="h-3.5 w-3.5" aria-hidden />
                  <span className="sr-only">{tr.a11y.wheelchairAccessible}</span>
                </span>
              )}
              {item.near_full && (
                <Badge variant="danger">
                  <AlertTriangle aria-hidden />
                  {tr.citizen.nearest.nearFull}
                </Badge>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="tabular font-semibold">
              {approx && '≈ '}
              {formatDistance(item.distance_m)}
            </span>
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <Footprints className="h-4 w-4" aria-hidden />
              <span className="tabular">
                {approx && '≈ '}
                {formatEta(item.eta_min)}
              </span>
              <span className="sr-only">{tr.citizen.nearest.walk}</span>
            </span>
          </div>
        </div>
      </div>
      <div className="mt-3 flex items-end gap-3">
        <OccupancyBar pct={point.occupancy_pct} className="flex-1" />
        <Button
          onClick={onRoute}
          disabled={routing || disabled}
          className="h-12 min-w-[120px]"
          aria-label={`${tr.citizen.nearest.route}: ${point.name}`}
        >
          {routing ? (
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
          ) : (
            <Navigation className="h-5 w-5" aria-hidden />
          )}
          {tr.citizen.nearest.route}
        </Button>
      </div>
    </motion.li>
  );
});
