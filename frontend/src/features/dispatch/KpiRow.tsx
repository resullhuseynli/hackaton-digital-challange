import type { LucideIcon } from 'lucide-react';
import { CheckCircle2, Gauge, Siren, Truck, TriangleAlert, Users } from 'lucide-react';
import type { ReactNode } from 'react';
import { AnimatedNumber } from '@/components/ui/animated-number';
import { Skeleton } from '@/components/ui/misc';
import { ErrorState } from '@/components/ui/states';
import { fill, tr } from '@/i18n';
import { occupancyColor } from '@/lib/status';
import { RoutingTile } from '@/features/routing/RoutingTile';
import { cn } from '@/lib/utils';
import type { Overview } from '@/types/api';
import { useOverview } from './queries';

function Tile({
  icon: Icon,
  label,
  color,
  pulse,
  children,
}: {
  icon: LucideIcon;
  label: string;
  color: string;
  pulse?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        'flex min-w-0 items-center gap-3 rounded-2xl border bg-card px-3 py-2.5 shadow-soft',
        pulse && 'animate-pulse border-danger/70 bg-danger/10',
      )}
    >
      <div
        className="grid h-10 w-10 shrink-0 place-items-center rounded-xl"
        style={{ backgroundColor: `${color}22`, color }}
      >
        <Icon className="h-5 w-5" aria-hidden />
      </div>
      <div className="min-w-0">
        <p className="line-clamp-2 text-[11px] font-medium uppercase leading-tight tracking-wide text-muted-foreground">
          {label}
        </p>
        {children}
      </div>
    </div>
  );
}

const big = 'tabular text-2xl font-bold leading-tight';

/** "a / b" pair; b is tinted, both are labelled in the tile title. */
function Pair({ a, b, bColor }: { a: number; b: number; bColor: string }) {
  return (
    <p className={big}>
      <AnimatedNumber value={a} />
      <span className="mx-1 text-base text-muted-foreground" aria-hidden>
        /
      </span>
      <span style={{ color: bColor }}>
        <AnimatedNumber value={b} />
      </span>
    </p>
  );
}

export function KpiRow() {
  const q = useOverview();
  const o: Overview | undefined = q.data;

  if (q.isError && !o) {
    return (
      <div className="rounded-2xl border bg-card">
        <ErrorState
          compact
          title={tr.dispatch.analytics.error}
          error={q.error}
          onRetry={() => q.refetch()}
          className="flex-row py-2"
        />
      </div>
    );
  }
  const loading = <Skeleton className="mt-1 h-6 w-14" />;

  return (
    <section className="grid grid-cols-7 gap-3" aria-label="KPI">
      <Tile
        icon={Siren}
        label={tr.dispatch.kpi.activeSos}
        color={o && o.active_sos > 0 ? '#DC2626' : '#16A34A'}
      >
        {o ? (
          <div className="flex items-center gap-2">
            <AnimatedNumber value={o.active_sos} className={big} />
            {o.active_sos_mobility_impaired > 0 && (
              <span
                className="rounded-md bg-violet-600 px-1.5 py-0.5 text-xs font-bold text-white"
                title={fill(tr.a11y.miCountAria, { n: o.active_sos_mobility_impaired })}
              >
                <span aria-hidden>
                  {fill(tr.a11y.miCount, { n: o.active_sos_mobility_impaired })}
                </span>
                <span className="sr-only">
                  {fill(tr.a11y.miCountAria, { n: o.active_sos_mobility_impaired })}
                </span>
              </span>
            )}
          </div>
        ) : (
          loading
        )}
      </Tile>
      <Tile icon={CheckCircle2} label={tr.dispatch.kpi.resolved} color="#16A34A">
        {o ? <AnimatedNumber value={o.resolved_sos} className={big} /> : loading}
      </Tile>
      <Tile
        icon={Users}
        label={`${tr.dispatch.kpi.citizens}: ${tr.dispatch.kpi.dangerSafe}`}
        color="#F59E0B"
      >
        {o ? <Pair a={o.citizens_in_danger} b={o.citizens_safe} bColor="#22C55E" /> : loading}
      </Tile>
      <Tile
        icon={Truck}
        label={`${tr.dispatch.kpi.brigades}: ${tr.dispatch.kpi.idleBusy}`}
        color={o && o.brigades_idle === 0 ? '#DC2626' : '#2563EB'}
      >
        {o ? <Pair a={o.brigades_idle} b={o.brigades_busy} bColor="#F59E0B" /> : loading}
      </Tile>
      <Tile
        icon={Gauge}
        label={tr.dispatch.kpi.avgOccupancy}
        color={o ? occupancyColor(o.avg_occupancy_pct) : '#64748B'}
      >
        {o ? (
          <AnimatedNumber
            value={o.avg_occupancy_pct}
            format={(n) => `${Math.round(n)}%`}
            className={big}
          />
        ) : (
          loading
        )}
      </Tile>
      <Tile
        icon={TriangleAlert}
        label={tr.dispatch.kpi.activeAlerts}
        color={o && o.active_alerts > 0 ? '#DC2626' : '#64748B'}
        pulse={!!o && o.active_alerts > 0}
      >
        {o ? <AnimatedNumber value={o.active_alerts} className={big} /> : loading}
      </Tile>
      <RoutingTile overviewStatus={o?.routing_status} />
    </section>
  );
}
