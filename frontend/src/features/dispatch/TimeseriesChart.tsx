import { useMemo } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Skeleton } from '@/components/ui/misc';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { tr } from '@/i18n';
import { formatHm } from '@/lib/format';
import { SOS_META } from '@/lib/status';
import type { SosType } from '@/types/api';
import { useTimeseries } from './queries';

const AXIS = { fontSize: 11, fill: 'hsl(215 20% 70%)' };
const GRID = 'hsl(217 28% 20%)';
const SURFACE = 'hsl(222 40% 10%)';
const TOOLTIP_STYLE = {
  background: 'hsl(222 40% 11%)',
  border: '1px solid hsl(217 28% 24%)',
  borderRadius: 12,
  fontSize: 12,
  color: 'hsl(210 40% 97%)',
};
/** Stack order keeps the two warm hues (fire, collapse) apart; legend + tooltip name each series. */
const STACK: SosType[] = ['collapse', 'flood', 'fire', 'medical'];

/** SOS per minute, stacked by type (GET /dispatch/timeseries?minutes=30). */
export function TimeseriesChart({ height = 150 }: { height?: number }) {
  const ts = useTimeseries();
  const data = useMemo(
    () => (ts.data ?? []).map((b) => ({ ...b, label: formatHm(new Date(b.ts)) })),
    [ts.data],
  );

  if (ts.isLoading) return <Skeleton className="w-full" style={{ height }} />;
  if (ts.isError && !ts.data) {
    return (
      <ErrorState
        compact
        title={tr.dispatch.analytics.error}
        error={ts.error}
        onRetry={() => ts.refetch()}
      />
    );
  }
  if (!data.length) return <EmptyState title={tr.dispatch.analytics.empty} />;

  return (
    <figure aria-label={tr.dispatch.analytics.perMinute} style={{ height }}>
      <ResponsiveContainer>
        <BarChart
          data={data}
          margin={{ top: 4, right: 8, bottom: 0, left: -20 }}
          barCategoryGap={2}
        >
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis
            dataKey="label"
            tick={AXIS}
            axisLine={false}
            tickLine={false}
            interval="preserveStartEnd"
            minTickGap={28}
          />
          <YAxis allowDecimals={false} tick={AXIS} axisLine={false} tickLine={false} />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            cursor={{ fill: 'hsl(217 30% 20% / 0.5)' }}
            formatter={(v: number, key: string) => [v, SOS_META[key as SosType]?.label ?? key]}
          />
          <Legend
            iconType="square"
            iconSize={10}
            wrapperStyle={{ fontSize: 12 }}
            formatter={(key: string) => SOS_META[key as SosType]?.label ?? key}
          />
          {STACK.map((t, i) => (
            <Bar
              key={t}
              dataKey={t}
              stackId="sos"
              fill={SOS_META[t].color}
              // 1 px surface gap between stacked segments so adjacent hues stay distinguishable.
              stroke={SURFACE}
              strokeWidth={1}
              radius={i === STACK.length - 1 ? [3, 3, 0, 0] : 0}
              isAnimationActive={false}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </figure>
  );
}
