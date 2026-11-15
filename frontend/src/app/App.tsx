import { QueryClientProvider } from '@tanstack/react-query';
import { lazy, Suspense, useEffect, useRef } from 'react';
import { createBrowserRouter, Navigate, RouterProvider, useLocation } from 'react-router-dom';
import { Toaster } from 'sonner';
import { LiveAnnouncer } from '@/components/ui/live-announcer';
import { TooltipProvider } from '@/components/ui/misc';
import { useLang } from '@/i18n';
import { env } from '@/lib/env';
// Citizen tabs load eagerly: they are small and must work offline from the PWA cache.
import CitizenLayout from '@/pages/citizen/CitizenLayout';
import MapTab from '@/pages/citizen/MapTab';
import MeTab from '@/pages/citizen/MeTab';
import PointsTab from '@/pages/citizen/PointsTab';
import SosTab from '@/pages/citizen/SosTab';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { PageLoader } from '@/pages/PageLoader';
import { RequireAuth } from './RequireAuth';
import { queryClient } from './queryClient';

// The dispatcher panel is heavy (charts, clustering) — split it from the citizen PWA bundle.
const DispatchPage = lazy(() => import('@/pages/DispatchPage'));
const LoginPage = lazy(() => import('@/pages/LoginPage'));
// Dispatcher sub-pages, each loaded on demand (charts only load with Analytics).
const MapPage = lazy(() => import('@/pages/dispatch/MapPage'));
const subPage = (
  name: 'SosPage' | 'AlertsPage' | 'BrigadesPage' | 'PointsPage' | 'AnalyticsPage',
) => lazy(() => import('@/pages/dispatch/SubPages').then((m) => ({ default: m[name] })));
const SosPage = subPage('SosPage');
const AlertsPage = subPage('AlertsPage');
const BrigadesPage = subPage('BrigadesPage');
const PointsPage = subPage('PointsPage');
const AnalyticsPage = subPage('AnalyticsPage');

const router = createBrowserRouter(
  [
    {
      path: '/',
      // Dispatcher-only deployments (e.g. :3001) open straight into the panel.
      element: env.app === 'dispatch' ? <Navigate to="/dispatcher" replace /> : <CitizenLayout />,
      children:
        env.app === 'dispatch'
          ? undefined
          : [
              { index: true, element: <MapTab /> },
              { path: 'points', element: <PointsTab /> },
              { path: 'sos', element: <SosTab /> },
              { path: 'me', element: <MeTab /> },
            ],
    },
    {
      path: '/dispatcher/login',
      element: (
        <Suspense fallback={<PageLoader dark />}>
          <LoginPage />
        </Suspense>
      ),
    },
    {
      path: '/dispatcher',
      element: (
        <RequireAuth>
          <Suspense fallback={<PageLoader dark />}>
            <DispatchPage />
          </Suspense>
        </RequireAuth>
      ),
      children: [
        { index: true, element: <MapPage /> },
        { path: 'sos', element: <SosPage /> },
        { path: 'alerts', element: <AlertsPage /> },
        { path: 'brigades', element: <BrigadesPage /> },
        { path: 'points', element: <PointsPage /> },
        { path: 'analytics', element: <AnalyticsPage /> },
        { path: '*', element: <Navigate to="/dispatcher" replace /> },
      ],
    },
    // Old links (/dispatch, /dispatch/login, /dispatch/sos …) keep working.
    { path: '/dispatch/*', element: <LegacyDispatchRedirect /> },
    { path: '*', element: <NotFoundPage /> },
  ],
  {
    future: {
      v7_relativeSplatPath: true,
      v7_fetcherPersist: true,
      v7_normalizeFormMethod: true,
      v7_partialHydration: true,
      v7_skipActionErrorRevalidation: true,
    },
  },
);

function LegacyDispatchRedirect() {
  const { pathname, search } = useLocation();
  return <Navigate to={pathname.replace(/^\/dispatch/, '/dispatcher') + search} replace />;
}

export function App() {
  const lang = useLang();
  // Server texts (labels[].text, error messages) come localized per request, so cached data
  // must be refetched in the new language. (Sockets reopen with ?lang= on their own.)
  const firstLang = useRef(lang);
  useEffect(() => {
    if (lang === firstLang.current) return;
    firstLang.current = lang;
    void queryClient.invalidateQueries();
  }, [lang]);
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={300}>
        <LiveAnnouncer />
        {/* Re-mount on language change so memoised components pick up the new strings. */}
        <RouterProvider key={lang} router={router} future={{ v7_startTransition: true }} />
        <Toaster
          position="top-center"
          richColors
          closeButton
          toastOptions={{ className: 'rounded-2xl font-sans' }}
        />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
