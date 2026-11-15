import { Suspense, useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { AlertBorder, AlertModal } from '@/features/dispatch/AlertModal';
import { FloodBanner } from '@/features/dispatch/FloodBanner';
import { Sidebar } from '@/features/dispatch/Sidebar';
import { TopBar } from '@/features/dispatch/TopBar';
import { useDispatchSocket } from '@/features/dispatch/useDispatchSocket';
import { useRoutingStatus } from '@/features/routing/useRoutingStatus';
import { useForceDark } from '@/hooks/useSystemTheme';
import { alarm } from '@/lib/alarm';
import { PageLoader } from './PageLoader';

/**
 * Dispatcher shell: top bar + left menu stay mounted across sub-pages, so the live
 * socket, alarm and RED ALERT modal keep working whichever page is open.
 */
export default function DispatchPage() {
  useForceDark();
  useDispatchSocket();
  useRoutingStatus('dispatch');

  // Browsers block audio until a user gesture; unlock on the first interaction.
  useEffect(() => {
    const unlock = () => alarm.unlock();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  return (
    <div className="grid h-full min-h-[640px] min-w-[1280px] grid-rows-[auto_minmax(0,1fr)] bg-background text-foreground">
      <TopBar />
      <div className="flex min-h-0">
        <Sidebar />
        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          <FloodBanner />
          <Suspense fallback={<PageLoader dark />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
      <AlertBorder />
      <AlertModal />
    </div>
  );
}
