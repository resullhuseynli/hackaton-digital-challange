import { BarChart3, Building2, Siren, TriangleAlert, Truck } from 'lucide-react';
import type { ReactNode } from 'react';
import { AlertsView } from '@/features/dispatch/AlertsView';
import { AnalyticsView } from '@/features/dispatch/AnalyticsView';
import { BrigadesView } from '@/features/dispatch/BrigadesView';
import { PageHeader } from '@/features/dispatch/PageHeader';
import { PointsTable } from '@/features/dispatch/PointsTable';
import { SosTable } from '@/features/dispatch/SosTable';
import { tr } from '@/i18n';

function Scroll({ children }: { children: ReactNode }) {
  // Children must not shrink: a flex item with overflow-hidden (e.g. the points table card)
  // would otherwise be squeezed to the viewport and clip its rows instead of scrolling.
  return (
    <div className="scrollbar-thin flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 [&>*]:shrink-0">
      {children}
    </div>
  );
}

export function SosPage() {
  // The table manages its own scroll so the header row can stay sticky.
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 p-4">
      <PageHeader icon={Siren} title={tr.nav.sos} subtitle={tr.pages.sosSubtitle} />
      <SosTable />
    </div>
  );
}

export function AlertsPage() {
  return (
    <Scroll>
      <PageHeader icon={TriangleAlert} title={tr.nav.alerts} subtitle={tr.pages.alertsSubtitle} />
      <AlertsView />
    </Scroll>
  );
}

export function BrigadesPage() {
  return (
    <Scroll>
      <PageHeader icon={Truck} title={tr.nav.brigades} subtitle={tr.pages.brigadesSubtitle} />
      <BrigadesView />
    </Scroll>
  );
}

export function PointsPage() {
  return (
    <Scroll>
      <PageHeader icon={Building2} title={tr.nav.points} subtitle={tr.pages.pointsSubtitle} />
      <PointsTable />
    </Scroll>
  );
}

export function AnalyticsPage() {
  return (
    <Scroll>
      <PageHeader icon={BarChart3} title={tr.nav.analytics} subtitle={tr.pages.analyticsSubtitle} />
      <AnalyticsView />
    </Scroll>
  );
}
