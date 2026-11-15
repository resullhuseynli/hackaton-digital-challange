import { motion, useReducedMotion } from 'framer-motion';
import {
  Accessibility,
  Ban,
  Building,
  ShieldPlus,
  Shuffle,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { fill, tr } from '@/i18n';
import { withoutWheelchair } from '@/lib/utils';
import { formatEta, formatNumber1 } from '@/lib/format';
import type { RouteReason } from '@/types/api';
import type { ReroutedData } from '@/types/ws';
import { BackupBadge } from '@/features/routing/RouteRoutingInfo';
import { isFallbackRoute } from '@/features/routing/routeMeta';

const REASON_ICON: Record<RouteReason, typeof Ban> = {
  initial: Shuffle,
  road_closed: Ban,
  point_full: Building,
  alert_new_point: ShieldPlus,
  barrier: Accessibility,
};

/** "+3,2 dəq" / "−6 min" — one decimal only when needed. */
function etaDiffText(diff: number | null | undefined): { text: string; faster: boolean } {
  const d = Math.round((diff ?? 0) * 10) / 10;
  if (d === 0) return { text: tr.citizen.reroute.diffZero, faster: false };
  const n = formatNumber1(Math.abs(d));
  return d > 0
    ? { text: fill(tr.citizen.reroute.diffPlus, { n }), faster: false }
    : { text: fill(tr.citizen.reroute.diffMinus, { n }), faster: true };
}

export function RerouteBanner({ data, onAck }: { data: ReroutedData; onAck: () => void }) {
  const reduce = useReducedMotion();
  const Icon = REASON_ICON[data.reason] ?? Shuffle;
  const diff = etaDiffText(data.eta_diff_min);

  return (
    <motion.div
      initial={{ y: -80, opacity: 0, scale: 0.96 }}
      animate={{ y: 0, opacity: 1, scale: 1 }}
      exit={{ y: -80, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 260, damping: 22 }}
      className="pointer-events-auto overflow-hidden rounded-2xl bg-warning text-slate-950 shadow-lift"
      role="alertdialog"
      aria-labelledby="reroute-title"
      aria-describedby="reroute-desc"
    >
      <motion.div
        className="h-1 bg-slate-950/30"
        initial={{ scaleX: 0 }}
        animate={{ scaleX: 1 }}
        style={{ originX: 0 }}
        transition={{ duration: 0.8 }}
      />
      <div className="flex items-start gap-3 p-4">
        <motion.div
          className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-slate-950 text-warning"
          animate={reduce ? undefined : { rotate: [0, -8, 8, -6, 6, 0] }}
          transition={{ duration: 0.8, repeat: 2, repeatDelay: 1 }}
        >
          <Icon className="h-6 w-6" aria-hidden />
        </motion.div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold uppercase tracking-wide opacity-80">
            {tr.citizen.reroute.title}
          </p>
          <p id="reroute-title" className="text-lg font-bold leading-tight">
            {tr.rerouteReason[data.reason]}
          </p>
          <p
            id="reroute-desc"
            className="mt-1 flex flex-wrap items-center gap-1.5 text-sm font-medium"
          >
            <span>
              {tr.citizen.reroute.newEta}:{' '}
              <span className="tabular font-bold">{formatEta(data.new_route.eta_min)}</span>
            </span>
            <span
              className={
                diff.faster
                  ? 'tabular inline-flex items-center gap-1 rounded-md bg-green-800 px-1.5 py-0.5 font-bold text-white'
                  : 'tabular inline-flex items-center gap-1 rounded-md bg-slate-950/15 px-1.5 py-0.5 font-bold'
              }
            >
              {diff.faster ? (
                <TrendingDown className="h-3.5 w-3.5" aria-hidden />
              ) : (
                <TrendingUp className="h-3.5 w-3.5" aria-hidden />
              )}
              {diff.text}
            </span>
            {data.new_route.accessible && (
              <span className="rounded-md bg-violet-700 px-1.5 py-0.5 font-bold text-white">
                {withoutWheelchair(tr.a11y.stepFreeRoute)}
              </span>
            )}
            {isFallbackRoute(data.new_route) && (
              <BackupBadge className="border-slate-950/30 bg-slate-950/10 text-slate-950" />
            )}
          </p>
        </div>
      </div>
      <div className="px-4 pb-4">
        <Button
          onClick={onAck}
          size="lg"
          className="w-full bg-slate-950 text-white hover:bg-slate-800"
          autoFocus
        >
          {tr.citizen.reroute.ok}
        </Button>
      </div>
    </motion.div>
  );
}
