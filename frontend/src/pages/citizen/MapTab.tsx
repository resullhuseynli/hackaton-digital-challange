import { useQueryClient } from '@tanstack/react-query';
import { AnimatePresence } from 'framer-motion';
import { Accessibility, Hand, LocateFixed, ShieldAlert } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { qk } from '@/api/queryKeys';
import { Button } from '@/components/ui/button';
import { BottomSheet, type SnapIndex } from '@/features/citizen/BottomSheet';
import { HEADER_H, TAB_BAR_H, useCitizen } from '@/features/citizen/citizenContext';
import { CitizenMap, type CitizenMapHandle } from '@/features/citizen/CitizenMap';
import { NearestList } from '@/features/citizen/NearestList';
import { Onboarding } from '@/features/citizen/Onboarding';
import { useNearest, usePoints, useRoute } from '@/features/citizen/queries';
import { RerouteBanner } from '@/features/citizen/RerouteBanner';
import { RouteCard } from '@/features/citizen/RouteCard';
import { SafeSwitch } from '@/features/citizen/SafeSwitch';
import { SosFab } from '@/features/citizen/SosFab';
import { SosStatusCard } from '@/features/citizen/SosStatus';
import { useSystemTheme } from '@/hooks/useSystemTheme';
import { tr } from '@/i18n';
import { sameId, withoutWheelchair } from '@/lib/utils';
import { useCitizenStore } from '@/stores/citizenStore';
import { useRoutingStore } from '@/stores/routingStore';
import type { AssemblyPoint, Route } from '@/types/api';

/** Space for the fixed header plus a little air above map overlays. */
const TOP = HEADER_H + 12;
/** Collapsed sheet height while a route is shown: drag handle + list title only. */
const ROUTE_SHEET_PEEK = 68;
/** Room for the floating SOS button above the sheet, so the route end is not hidden under it. */
const SOS_CLEARANCE = 110;

/** Main tab: full-screen map, nearest points sheet, active route and SOS status. */
export default function MapTab() {
  const theme = useSystemTheme();
  const qc = useQueryClient();
  const {
    location,
    geo,
    zones,
    manualMode,
    setManualMode,
    startRoute,
    routingId,
    checkIn,
    checkingIn,
  } = useCitizen();

  const onboarded = useCitizenStore((s) => s.onboarded);
  const mi = useCitizenStore((s) => s.mobilityImpaired);
  const zoneId = useCitizenStore((s) => s.zoneId);
  const lastPoints = useCitizenStore((s) => s.lastPoints);
  const lastNearest = useCitizenStore((s) => s.lastNearest);
  const selectedPointId = useCitizenStore((s) => s.selectedPointId);
  const reroute = useCitizenStore((s) => s.reroute);
  const activeSos = useCitizenStore((s) => s.activeSos);
  const sosCardHidden = useCitizenStore((s) => s.sosCardHidden);
  const sosQueue = useCitizenStore((s) => s.sosQueue);
  const checkedIn = useCitizenStore((s) => s.checkedIn);
  const store = useCitizenStore.getState;
  // Overlays sit below the routing-fallback banner when it is shown.
  const top = TOP + useRoutingStore((s) => s.bannerH);

  const points = usePoints();
  const nearest = useNearest(onboarded ? location : null, zoneId);
  const route = useRoute();

  const mapRef = useRef<CitizenMapHandle>(null);
  const [snap, setSnap] = useState<SnapIndex>(1);
  const [sheetVisible, setSheetVisible] = useState(300);
  const bottomOffset = onboarded ? TAB_BAR_H : 0;

  const allPoints: AssemblyPoint[] = useMemo(() => {
    const base = points.data ?? lastPoints ?? [];
    const near = (nearest.data ?? []).map((n) => n.point);
    const map = new Map(base.map((p) => [String(p.id), p]));
    near.forEach((p) => map.set(String(p.id), { ...map.get(String(p.id)), ...p }));
    return [...map.values()];
  }, [points.data, lastPoints, nearest.data]);

  const activeRoute = route.data ?? null;
  const targetPoint = activeRoute
    ? allPoints.find((p) => sameId(p.id, activeRoute.target_point_id))
    : undefined;

  // Fit the map to a new or rerouted route (also when arriving here from another tab).
  const routeKey = activeRoute ? `${activeRoute.id}-${activeRoute.version}` : null;
  useEffect(() => {
    if (activeRoute) {
      const t = window.setTimeout(
        () => mapRef.current?.fitRoute(activeRoute, location ?? undefined),
        50,
      );
      setSnap(0);
      return () => window.clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeKey]);

  // Back to the half sheet after a successful check-in.
  useEffect(() => {
    if (checkedIn) setSnap(1);
  }, [checkedIn]);

  // Focus a point chosen on the Points tab.
  useEffect(() => {
    if (selectedPointId == null || activeRoute) return;
    const p = allPoints.find((x) => sameId(x.id, selectedPointId));
    if (p) window.setTimeout(() => mapRef.current?.flyTo(p, 15.5), 50);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSelect = useCallback((p: AssemblyPoint) => {
    useCitizenStore.getState().selectPoint(p.id);
    mapRef.current?.flyTo(p, 15.5);
  }, []);

  const stepFreeBanner = mi && (
    <p
      className="flex items-center gap-2 rounded-xl bg-violet-700 px-3 py-2 text-sm font-bold text-white"
      role="status"
    >
      <Accessibility className="h-5 w-5 shrink-0" aria-hidden />
      {withoutWheelchair(tr.a11y.stepFreeMode)}
    </p>
  );

  const closeRoute = () => {
    store().setReroute(null);
    qc.setQueryData<Route | null>(qk.route, null);
    setSnap(1);
  };

  return (
    <>
      <CitizenMap
        ref={mapRef}
        theme={theme}
        location={onboarded || location ? location : null}
        points={allPoints}
        zones={zones}
        route={activeRoute}
        oldRoute={reroute?.old_route ?? null}
        selectedPointId={selectedPointId}
        onSelectPoint={handleSelect}
        pickMode={!onboarded && manualMode}
        onMapClick={(p) => {
          if (!onboarded && manualMode) store().setManualLocation(p);
        }}
        bottomPadding={sheetVisible + bottomOffset + (activeRoute ? SOS_CLEARANCE : 0)}
        topPadding={top + (activeRoute ? 150 : 40)}
      />

      {/* Top stack: reroute banner, route card, SOS status */}
      <div
        className="safe-top pointer-events-none fixed inset-x-0 top-0 z-40 mx-auto flex max-w-xl flex-col gap-2 px-3"
        style={{ paddingTop: top }}
      >
        <AnimatePresence>
          {reroute && (
            <RerouteBanner key="reroute" data={reroute} onAck={() => store().setReroute(null)} />
          )}
          {activeRoute && !reroute && (
            <RouteCard
              key="route"
              route={activeRoute}
              point={targetPoint}
              location={location}
              mobilityImpaired={mi}
              checkingIn={checkingIn}
              onArrived={() => targetPoint && checkIn(targetPoint)}
              onClose={closeRoute}
              onRefresh={() => targetPoint && void startRoute(targetPoint)}
              refreshing={routingId != null}
            />
          )}
          {activeSos && !sosCardHidden && !activeRoute && !reroute && (
            <SosStatusCard
              key="sos"
              sos={activeSos}
              onOpen={() => store().setSosOpen(true)}
              onHide={() => store().setSosCardHidden(true)}
            />
          )}
        </AnimatePresence>
      </div>

      {onboarded && !activeRoute && (
        <div className="safe-top fixed left-3 z-30 flex gap-2" style={{ top }}>
          {location?.source === 'manual' && (
            <Button
              variant="outline"
              size="sm"
              className="h-11 bg-card/90 shadow-soft backdrop-blur"
              onClick={() => {
                store().setOnboarded(false);
                setManualMode(true);
              }}
            >
              <Hand className="h-4 w-4" aria-hidden />
              {tr.citizen.onboarding.manual}
            </Button>
          )}
        </div>
      )}

      {onboarded && location && !activeRoute && (
        <Button
          variant="outline"
          size="icon-lg"
          className="safe-top fixed right-3 z-30 rounded-full bg-card/90 shadow-soft backdrop-blur"
          style={{ top }}
          onClick={() => mapRef.current?.flyTo(location, 15.5)}
          aria-label={tr.citizen.location.recenter}
        >
          <LocateFixed className="h-5 w-5" aria-hidden />
        </Button>
      )}

      {onboarded ? (
        <BottomSheet
          snap={snap}
          onSnapChange={setSnap}
          onVisibleHeight={setSheetVisible}
          bottomOffset={bottomOffset}
          floating={<SosFab onPress={() => store().setSosOpen(true)} queued={sosQueue.length} />}
          // While a route is shown the sheet collapses to a slim title strip so the map stays readable.
          collapsedHeight={activeRoute ? ROUTE_SHEET_PEEK : undefined}
          header={
            activeRoute ? (
              <div className="px-4 pb-2 pt-0.5">
                <h2 className="text-base font-bold leading-tight">{tr.citizen.nearest.title}</h2>
              </div>
            ) : (
              <div className="flex flex-col gap-3 px-4 pb-3 pt-1">
                {stepFreeBanner}
                <SafeSwitch />
                <div>
                  <h2 className="text-lg font-bold leading-tight">{tr.citizen.nearest.title}</h2>
                  <p className="text-xs text-muted-foreground">
                    {mi ? tr.citizen.nearest.miSubtitle : tr.citizen.nearest.subtitle}
                  </p>
                </div>
              </div>
            )
          }
        >
          {activeRoute && (
            <div className="mb-3 flex flex-col gap-3">
              {stepFreeBanner}
              <SafeSwitch />
            </div>
          )}
          <NearestList
            data={nearest.data}
            cached={lastNearest}
            isLoading={nearest.isLoading || (!location && zoneId == null)}
            isError={nearest.isError}
            error={nearest.error}
            onRetry={() => nearest.refetch()}
            selectedId={selectedPointId}
            routingId={routingId}
            onSelect={(n) => handleSelect(n.point)}
            onRoute={(n) => void startRoute(n.point)}
          />
        </BottomSheet>
      ) : (
        <>
          <Onboarding
            permission={geo.permission}
            locating={geo.locating}
            hasFix={geo.fix != null}
            onRequest={geo.request}
            manualMode={manualMode}
            setManualMode={setManualMode}
          />
          {/* SOS stays reachable even during onboarding. */}
          <div className="fixed right-3 z-40" style={{ top }}>
            <Button
              variant="danger"
              size="lg"
              className="h-12 rounded-full font-black"
              onClick={() => store().setSosOpen(true)}
              aria-label={tr.citizen.sos.buttonAria}
            >
              <ShieldAlert className="h-5 w-5" aria-hidden />
              {tr.citizen.sos.button}
            </Button>
          </div>
        </>
      )}
    </>
  );
}
