import { BarChart3 } from 'lucide-react';
import { DispatchMap } from '@/features/dispatch/DispatchMap';
import { KpiRow } from '@/features/dispatch/KpiRow';
import { RightTabs } from '@/features/dispatch/RightTabs';
import { TimeseriesChart } from '@/features/dispatch/TimeseriesChart';
import { tr } from '@/i18n';

/**
 * Main dispatcher view (brief §4.2): KPI bar, large central map, right sidebar with
 * SOS | Alerts | Brigades | Simulation tabs, and the SOS-per-minute strip at the bottom.
 */
export default function MapPage() {
  return (
    <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)_auto] gap-3 p-3">
      <KpiRow />
      <div className="grid min-h-0 grid-cols-[minmax(0,1fr)_360px] gap-3 2xl:grid-cols-[minmax(0,1fr)_420px]">
        <DispatchMap />
        <RightTabs />
      </div>
      <section
        aria-labelledby="ts-strip-title"
        className="rounded-2xl border bg-card px-3 pb-1 pt-2"
      >
        <h2
          id="ts-strip-title"
          className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground"
        >
          <BarChart3 className="h-3.5 w-3.5" aria-hidden />
          {tr.dispatch.analytics.perMinute}
        </h2>
        <TimeseriesChart height={130} />
      </section>
    </div>
  );
}
