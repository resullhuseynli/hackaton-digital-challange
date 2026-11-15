import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence } from 'framer-motion';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { citizenApi } from '@/api/endpoints';
import { ApiError, errorMessage } from '@/api/http';
import { qk } from '@/api/queryKeys';
import { CheckInSuccess } from '@/features/citizen/CheckInSuccess';
import { CitizenHeader } from '@/features/citizen/CitizenHeader';
import {
  CitizenContext,
  HEADER_H,
  TAB_BAR_H,
  type CitizenCtx,
} from '@/features/citizen/citizenContext';
import { OfflineBar } from '@/features/citizen/OfflineBar';
import { RoutingBanner } from '@/features/routing/RoutingBanner';
import { useRoutingStatus } from '@/features/routing/useRoutingStatus';
import { nextAccessiblePoint, useCreateRoute, useZones } from '@/features/citizen/queries';
import { RerouteBanner } from '@/features/citizen/RerouteBanner';
import { SosFab } from '@/features/citizen/SosFab';
import { SosSheet } from '@/features/citizen/SosSheet';
import { TabBar } from '@/features/citizen/TabBar';
import { sosFallbackLocation, useCitizenLocation } from '@/features/citizen/useCitizenLocation';
import { useCitizenSocket } from '@/features/citizen/useCitizenSocket';
import {
  useLocationReporter,
  useMySos,
  useRegistration,
  useSosQueueFlusher,
} from '@/features/citizen/useCitizenSync';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useSystemTheme } from '@/hooks/useSystemTheme';
import { fill, tr } from '@/i18n';
import { useCitizenStore } from '@/stores/citizenStore';
import { useConnectionStore } from '@/stores/connectionStore';
import { useRoutingStore } from '@/stores/routingStore';
import type { AssemblyPoint, Id, Route } from '@/types/api';
import MapTab from './MapTab';

/**
 * Citizen shell: owns location, sync hooks and the live socket so they keep running whichever
 * tab is open. SOS, the offline bar and reroute alerts are available on every tab.
 */
export default function CitizenLayout() {
  useSystemTheme();
  const online = useOnlineStatus();
  const socketStatus = useConnectionStore((s) => s.citizenSocket);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const onboarded = useCitizenStore((s) => s.onboarded);
  const reroute = useCitizenStore((s) => s.reroute);
  const sosQueue = useCitizenStore((s) => s.sosQueue);
  const checkedIn = useCitizenStore((s) => s.checkedIn);
  const sosOpen = useCitizenStore((s) => s.sosOpen);
  const store = useCitizenStore.getState;

  const { location, geo } = useCitizenLocation();
  const zones = useZones();
  const [manualMode, setManualMode] = useState(false);

  useRegistration();
  useLocationReporter(onboarded ? location : null);
  useMySos();
  useSosQueueFlusher();
  useCitizenSocket(onboarded);
  useRoutingStatus('citizen');
  const bannerH = useRoutingStore((s) => s.bannerH);

  const createRoute = useCreateRoute();
  const [routingId, setRoutingId] = useState<Id | null>(null);

  const startRoute = useCallback(
    async (point: AssemblyPoint) => {
      if (!location) {
        toast.error(tr.citizen.route.error, { description: tr.citizen.sos.noLocation });
        return false;
      }
      setRoutingId(point.id);
      try {
        await createRoute.mutateAsync({ pointId: point.id, lat: location.lat, lng: location.lng });
        return true;
      } catch (e) {
        // No step-free way to this point: suggest the next accessible one from the nearest list.
        const code = e instanceof ApiError ? e.code : '';
        const alt =
          code === 'POINT_NOT_ACCESSIBLE' || code === 'NO_ACCESSIBLE_ROUTE'
            ? nextAccessiblePoint(qc, point.id)
            : null;
        toast.error(tr.citizen.route.error, {
          description: alt
            ? `${errorMessage(e)} ${fill(tr.citizen.route.suggest, { name: alt.name })}`
            : errorMessage(e),
          duration: alt ? 15_000 : 6_000,
          action: alt
            ? { label: tr.citizen.nearest.route, onClick: () => void startRouteRef.current(alt) }
            : undefined,
        });
        return false;
      } finally {
        setRoutingId(null);
      }
    },
    [location, createRoute, qc],
  );
  const startRouteRef = useRef(startRoute);
  startRouteRef.current = startRoute;

  const checkInM = useMutation({
    mutationFn: (p: AssemblyPoint) =>
      citizenApi.checkIn(p.id).then((fresh) => ({ ...p, ...fresh })),
    onSuccess: (p) => {
      const st = store();
      st.setCheckedIn(p);
      st.setReroute(null);
      // Check-in makes the citizen "safe" on the server.
      st.setCitizenStatus('safe');
      st.setSafeSince(new Date().toISOString());
      qc.setQueryData<Route | null>(qk.route, null);
    },
    onError: (e) => toast.error(tr.citizen.checkIn.error, { description: errorMessage(e) }),
  });

  const ctx = useMemo<CitizenCtx>(
    () => ({
      location,
      geo,
      zones: zones.data,
      manualMode,
      setManualMode,
      startRoute,
      routingId,
      checkIn: (p) => checkInM.mutate(p),
      checkingIn: checkInM.isPending,
    }),
    [location, geo, zones.data, manualMode, startRoute, routingId, checkInM],
  );

  const offline = !online || socketStatus === 'closed';
  const onMapTab = pathname === '/';

  return (
    <CitizenContext.Provider value={ctx}>
      <div className="relative h-full overflow-hidden bg-background">
        <h1 className="sr-only">{tr.app.name}</h1>
        <CitizenHeader />
        <OfflineBar offline={offline} queued={sosQueue.length} />
        <RoutingBanner />

        {/* Until onboarding is done, the map (with the onboarding card) is the only screen. */}
        {onboarded ? <Outlet /> : <MapTab />}

        {onboarded && (
          <>
            {/* Off the map tab, surface reroutes here and keep SOS one tap away. */}
            {!onMapTab && (
              <div
                className="safe-top pointer-events-none fixed inset-x-0 top-0 z-50 mx-auto max-w-xl px-3"
                style={{ paddingTop: HEADER_H + bannerH + 12 }}
              >
                <AnimatePresence>
                  {reroute && (
                    <RerouteBanner
                      key="reroute"
                      data={reroute}
                      onAck={() => {
                        store().setReroute(null);
                        navigate('/');
                      }}
                    />
                  )}
                </AnimatePresence>
              </div>
            )}
            {!onMapTab && (
              <div
                className="fixed right-4 z-40"
                style={{ bottom: `calc(${TAB_BAR_H + 16}px + env(safe-area-inset-bottom))` }}
              >
                <SosFab onPress={() => store().setSosOpen(true)} queued={sosQueue.length} />
              </div>
            )}
            <TabBar />
          </>
        )}

        <SosSheet
          open={sosOpen}
          onClose={() => store().setSosOpen(false)}
          location={sosFallbackLocation(location, zones.data)}
          hasPreciseLocation={location?.source === 'gps'}
        />
        <CheckInSuccess point={checkedIn} onClose={() => store().setCheckedIn(null)} />
      </div>
    </CitizenContext.Provider>
  );
}
