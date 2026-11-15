import { useMemo, type ReactNode } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { EmptyState, ErrorState, ListSkeleton } from '@/components/ui/states';
import { tr } from '@/i18n';
import { formatHm } from '@/lib/format';
import { SOS_META, SOS_TYPES, occupancyColor } from '@/lib/status';
import { sameId } from '@/lib/utils';
import type { SosType } from '@/types/api';
import { useDispatchPoints, useDispatchZones, useSosList, useTimeseries } from './queries';

const AXIS = { fontSize: 11, fill: 'hsl(215 20% 65%)' };
const GRID = 'hsl(217 28% 20%)';
const TOOLTIP_STYLE = {
  background: 'hsl(222 40% 11%)',
  border: '1px solid hsl(217 28% 24%)',
  borderRadius: 12,
  fontSize: 12,
  color: 'hsl(210 40% 97%)',
};

type Point = { label: string } & Record<SosType, number>;

function Panel({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="rounded-2xl border bg-card p-4">
      <h2 id={id} className="mb-3 font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function AnalyticsView() {
  const ts = useTimeseries();
  const sos = useSosList().data;
  const points = useDispatchPoints().data;
  const zones = useDispatchZones().data;

  const series = useMemo<Point[]>(
    () =>
      (ts.data ?? []).map((b) => ({
        ...b,
        label: formatHm(new Date(b.ts)),
      })),
    [ts.data],
  );
  const yMax = useMemo(
    () => Math.max(2, ...series.flatMap((b) => SOS_TYPES.map((t) => b[t]))),
    [series],
  );

  const zoneLoad = useMemo(
    () =>
      (zones ?? []).map((z) => {
        const zp = (points ?? []).filter((p) => sameId(p.zone_id, z.id) && p.status === 'active');
        return {
          name: z.name,
          active: (sos ?? []).filter((s) => sameId(s.zone_id, z.id) && s.status !== 'resolved')
            .length,
          occupancy: zp.length
            ? Math.round(zp.reduce((a, p) => a + p.occupancy_pct, 0) / zp.length)
            : 0,
        };
      }),
    [zones, points, sos],
  );
  const zoneHeight = Math.max(240, zoneLoad.length * 28 + 40);

  return (
    <div className="flex flex-col gap-4">
      <Panel id="ts-title" title={tr.dispatch.analytics.perMinute}>
        {ts.isLoading ? (
          <ListSkeleton rows={2} />
        ) : ts.isError && !ts.data ? (
          <ErrorState
            compact
            title={tr.dispatch.analytics.error}
            error={ts.error}
            onRetry={() => ts.refetch()}
          />
        ) : !series.length ? (
          <EmptyState title={tr.dispatch.analytics.empty} />
        ) : (
          // Small multiples: one panel per SOS type on a shared y-scale.
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            {SOS_TYPES.map((t) => (
              <TypeChart key={t} type={t} data={series} yMax={yMax} />
            ))}
          </div>
        )}
      </Panel>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel
          id="zl-title"
          title={`${tr.dispatch.analytics.zoneLoad} — ${tr.dispatch.analytics.activeSos}`}
        >
          {!zoneLoad.length ? (
            <EmptyState title={tr.dispatch.analytics.empty} />
          ) : (
            <div style={{ height: zoneHeight }}>
              <ResponsiveContainer>
                <BarChart
                  data={zoneLoad}
                  layout="vertical"
                  margin={{ left: 0, right: 16, top: 0, bottom: 0 }}
                  barCategoryGap={6}
                >
                  <CartesianGrid horizontal={false} stroke={GRID} />
                  <XAxis
                    type="number"
                    allowDecimals={false}
                    tick={AXIS}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={90}
                    interval={0}
                    tick={AXIS}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    cursor={{ fill: 'hsl(217 30% 20% / 0.5)' }}
                    contentStyle={TOOLTIP_STYLE}
                    formatter={(v: number) => [v, tr.dispatch.analytics.activeSos]}
                  />
                  <Bar dataKey="active" fill="#3B82F6" radius={[0, 4, 4, 0]} maxBarSize={16} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Panel>

        <Panel
          id="zo-title"
          title={`${tr.dispatch.analytics.zoneLoad} — ${tr.dispatch.analytics.occupancy}`}
        >
          {!zoneLoad.length ? (
            <EmptyState title={tr.dispatch.analytics.empty} />
          ) : (
            <div style={{ height: zoneHeight }}>
              <ResponsiveContainer>
                <BarChart
                  data={zoneLoad}
                  layout="vertical"
                  margin={{ left: 0, right: 16, top: 0, bottom: 0 }}
                  barCategoryGap={6}
                >
                  <CartesianGrid horizontal={false} stroke={GRID} />
                  <XAxis
                    type="number"
                    domain={[0, 100]}
                    tick={AXIS}
                    axisLine={false}
                    tickLine={false}
                    unit="%"
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={90}
                    interval={0}
                    tick={AXIS}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    cursor={{ fill: 'hsl(217 30% 20% / 0.5)' }}
                    contentStyle={TOOLTIP_STYLE}
                    formatter={(v: number) => [`${v}%`, tr.dispatch.analytics.occupancy]}
                  />
                  <Bar dataKey="occupancy" radius={[0, 4, 4, 0]} maxBarSize={16}>
                    {zoneLoad.map((z) => (
                      <Cell key={z.name} fill={occupancyColor(z.occupancy)} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}

function TypeChart({ type, data, yMax }: { type: SosType; data: Point[]; yMax: number }) {
  const m = SOS_META[type];
  const Icon = m.icon;
  const total = data.reduce((a, b) => a + b[type], 0);
  return (
    <figure className="rounded-xl border bg-background/40 p-3">
      <figcaption className="mb-2 flex items-center justify-between text-sm">
        <span className="inline-flex items-center gap-1.5 font-semibold">
          <Icon className="h-4 w-4" style={{ color: m.color }} aria-hidden />
          {m.label}
        </span>
        <span className="tabular text-muted-foreground">
          {tr.pages.total}: <span className="font-semibold text-foreground">{total}</span>
        </span>
      </figcaption>
      <div className="h-32">
        <ResponsiveContainer>
          <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -24 }}>
            <CartesianGrid vertical={false} stroke={GRID} />
            <YAxis
              domain={[0, yMax]}
              allowDecimals={false}
              tick={AXIS}
              axisLine={false}
              tickLine={false}
            />
            <XAxis
              dataKey="label"
              tick={AXIS}
              axisLine={false}
              tickLine={false}
              interval="preserveStartEnd"
              minTickGap={40}
            />
            <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => [v, m.label]} />
            <Area
              type="monotone"
              dataKey={type}
              stroke={m.color}
              strokeWidth={2}
              fill={m.color}
              fillOpacity={0.18}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
