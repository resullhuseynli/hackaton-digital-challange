import { motion } from 'framer-motion';
import { AlertTriangle, CheckCircle2, TrendingUp } from 'lucide-react';
import { tr } from '@/i18n';
import { formatPct } from '@/lib/format';
import { occupancyColor, occupancyLabel, occupancyLevel } from '@/lib/status';
import { cn } from '@/lib/utils';

const ICONS = { safe: CheckCircle2, warning: TrendingUp, danger: AlertTriangle } as const;
/** Text needs darker tones than the bar fill to reach WCAG AA (4.5:1) on light and dark cards. */
const TEXT = {
  safe: 'text-green-700 dark:text-green-400',
  warning: 'text-amber-700 dark:text-amber-300',
  danger: 'text-red-700 dark:text-red-400',
} as const;

/** Animated occupancy bar: colour + icon + percentage (never colour alone). */
export function OccupancyBar({
  pct,
  className,
  showLabel = true,
  size = 'md',
}: {
  pct: number;
  className?: string;
  showLabel?: boolean;
  size?: 'sm' | 'md';
}) {
  const value = Math.max(0, Math.min(100, pct));
  const level = occupancyLevel(value);
  const Icon = ICONS[level];
  const color = occupancyColor(value);
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <div
        className={cn(
          'relative w-full overflow-hidden rounded-full bg-muted',
          size === 'sm' ? 'h-1.5' : 'h-2.5',
        )}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(value)}
        aria-label={`${tr.occupancy.label}: ${formatPct(value)}`}
      >
        <motion.div
          className="h-full rounded-full"
          style={{ backgroundColor: color }}
          initial={{ width: 0 }}
          animate={{ width: `${value}%` }}
          transition={{ type: 'spring', stiffness: 90, damping: 20 }}
        />
      </div>
      {showLabel && (
        <div className="flex items-center justify-between text-xs">
          <span className={cn('inline-flex items-center gap-1 font-medium', TEXT[level])}>
            <Icon className="h-3.5 w-3.5" aria-hidden />
            {occupancyLabel(value)}
          </span>
          <span className="tabular font-semibold">{formatPct(value)}</span>
        </div>
      )}
    </div>
  );
}
