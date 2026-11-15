import { FlaskConical, ShieldQuestion, Siren, TriangleAlert, Truck } from 'lucide-react';
import { useEffect } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { tr } from '@/i18n';
import { cn } from '@/lib/utils';
import { usePermissions } from '@/stores/authStore';
import { useDispatchStore, type RightTab } from '@/stores/dispatchStore';
import { AlertsView } from './AlertsView';
import { BrigadesView } from './BrigadesView';
import { QuarantineView } from './QuarantineView';
import { useSuspectedCount } from './useSuspectedCount';
import { useAlerts, useSosList } from './queries';
import { SimTab } from './SimTab';
import { SosFeed } from './SosFeed';

/**
 * Right sidebar of the main dispatcher view: SOS | Alerts | Brigades | Quarantine | Simulation.
 * Simulation is admin-only (the backend answers 403 for other roles), so it is not shown at all.
 */
export function RightTabs() {
  const tab = useDispatchStore((s) => s.rightTab);
  const setTab = useDispatchStore((s) => s.setRightTab);
  const demoMode = useDispatchStore((s) => s.demoMode);
  const { sim } = usePermissions();
  const newSos = (useSosList().data ?? []).filter((s) => s.status === 'new').length;
  const alerts = useAlerts().data?.length ?? 0;
  const suspected = useSuspectedCount();

  // Lost (or never had) simulation rights: leave the tab and any map-click sim mode.
  useEffect(() => {
    if (sim) return;
    const st = useDispatchStore.getState();
    if (st.rightTab === 'sim') st.setRightTab('sos');
    if (st.simMode) st.setSimMode(null);
  }, [sim]);

  return (
    <Tabs
      value={tab}
      onValueChange={(v) => setTab(v as RightTab)}
      className="flex min-h-0 flex-col rounded-2xl border bg-card"
    >
      <TabsList className={cn('m-2 mb-0 grid h-auto gap-1', sim ? 'grid-cols-5' : 'grid-cols-4')}>
        <TabsTrigger value="sos" className="min-h-10 px-1 text-xs">
          <Siren className="h-4 w-4" aria-hidden />
          {tr.dispatch.tabs.sos}
          {newSos > 0 && <Count n={newSos} />}
        </TabsTrigger>
        <TabsTrigger value="alerts" className="min-h-10 px-1 text-xs">
          <TriangleAlert className="h-4 w-4" aria-hidden />
          {tr.dispatch.tabs.alerts}
          {alerts > 0 && <Count n={alerts} />}
        </TabsTrigger>
        <TabsTrigger value="brigades" className="min-h-10 px-1 text-xs">
          <Truck className="h-4 w-4" aria-hidden />
          {tr.dispatch.tabs.brigades}
        </TabsTrigger>
        <TabsTrigger value="quarantine" className="min-h-10 px-1 text-xs">
          <ShieldQuestion className="h-4 w-4" aria-hidden />
          {tr.quarantine.tab}
          {suspected > 0 && <Count n={suspected} amber />}
        </TabsTrigger>
        {sim && (
          <TabsTrigger value="sim" className="min-h-10 px-1 text-xs" disabled={!demoMode}>
            <FlaskConical className="h-4 w-4" aria-hidden />
            {tr.dispatch.tabs.simulation}
          </TabsTrigger>
        )}
      </TabsList>
      {/* The SOS feed brings its own header, filters and scroll area. */}
      <TabsContent value="sos" className="mt-2 min-h-0 flex-1 data-[state=active]:flex">
        <div className="flex min-h-0 flex-1 flex-col [&>section]:rounded-none [&>section]:border-0">
          <SosFeed />
        </div>
      </TabsContent>
      <TabsContent value="alerts" className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-2">
        <AlertsView compact />
      </TabsContent>
      <TabsContent value="brigades" className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-2">
        <BrigadesView compact />
      </TabsContent>
      <TabsContent value="quarantine" className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-2">
        <QuarantineView />
      </TabsContent>
      {sim && (
        <TabsContent value="sim" className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-2">
          <SimTab />
        </TabsContent>
      )}
    </Tabs>
  );
}

function Count({ n, amber }: { n: number; amber?: boolean }) {
  return (
    <span
      className={cn(
        'tabular ml-0.5 rounded-full px-1.5 text-[10px] font-bold',
        amber ? 'bg-amber-500 text-slate-950' : 'bg-danger text-white',
      )}
    >
      {n > 999 ? '999+' : n}
    </span>
  );
}
