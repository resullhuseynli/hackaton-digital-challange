import { Crosshair, Layers, MousePointerClick, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Marker, Popup, type MapLayerMouseEvent, type MapRef } from 'react-map-gl/maplibre';
import { BaseMap } from '@/components/map/BaseMap';
import { PointMarker } from '@/components/map/PointMarker';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger, Switch } from '@/components/ui/misc';
import { OccupancyBar } from '@/components/ui/occupancy-bar';
import { useNow } from '@/hooks/useNow';
import { tr } from '@/i18n';
import { formatEta, formatNumber, timeAgo } from '@/lib/format';
import { BRIGADE_META, POINT_META, SOS_META, priorityValue } from '@/lib/status';
import { sameId } from '@/lib/utils';
import { zoneCenter } from '@/lib/zones';
import { useDispatchStore, type LayerKey } from '@/stores/dispatchStore';
import type { RoadProps, RoadStatus } from '@/types/api';
import { BrigadesLayer, HeatmapLayer, SosMarkers, ZonesLayer } from './MapLayers';
import { useAlerts, useBrigades, useDispatchPoints, useDispatchZones, useSosList } from './queries';
import { AlertCirclesLayer, BarriersLayer, MapLegend, TrafficLayer } from './TrafficLayers';
import { BarrierIcon } from './BarrierIcon';
import { useDispatchTraffic } from './trafficData';
import { useInterpolatedPositions } from './useInterpolated';
import { useSim } from './useSim';

const LAYER_KEYS: LayerKey[] = [
  'sos',
  'heatmap',
  'zones',
  'points',
  'brigades',
  'roads',
  'barriers',
  'alerts',
];
const SIM_STATUS: Record<'close' | 'open' | 'congest', RoadStatus> = {
  close: 'closed',
  open: 'open',
  congest: 'congested',
};

export function DispatchMap({ children }: { children?: ReactNode }) {
  const mapRef = useRef<MapRef>(null);
  const layers = useDispatchStore((s) => s.layers);
  const toggleLayer = useDispatchStore((s) => s.toggleLayer);
  const selection = useDispatchStore((s) => s.selection);
  const select = useDispatchStore((s) => s.select);
  const simMode = useDispatchStore((s) => s.simMode);
  const setSimMode = useDispatchStore((s) => s.setSimMode);
  const burstLocation = useDispatchStore((s) => s.burstLocation);
  const setBurstLocation = useDispatchStore((s) => s.setBurstLocation);
  const focus = useDispatchStore((s) => s.focus);

  const sos = useSosList();
  const brigades = useBrigades();
  const points = useDispatchPoints();
  const zones = useDispatchZones();
  const alerts = useAlerts();
  const traffic = useDispatchTraffic();
  const { updateFromMap } = traffic;
  const sim = useSim();
  const positions = useInterpolatedPositions(brigades.data);

  const [zoom, setZoom] = useState(12.5);
  const [bounds, setBounds] = useState<[number, number, number, number] | null>(null);

  const syncView = useCallback(() => {
    const m = mapRef.current;
    if (!m) return;
    const b = m.getBounds();
    setBounds([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
    setZoom(m.getZoom());
    updateFromMap(m);
  }, [updateFromMap]);

  useEffect(() => {
    if (focus) {
      mapRef.current?.flyTo({
        center: [focus.lng, focus.lat],
        zoom: focus.zoom ?? 15,
        duration: 900,
      });
    }
  }, [focus]);

  const activeSos = useMemo(
    () => (sos.data ?? []).filter((s) => s.status !== 'resolved'),
    [sos.data],
  );

  const onClick = (e: MapLayerMouseEvent) => {
    const p = { lat: e.lngLat.lat, lng: e.lngLat.lng };
    if (simMode === 'close' || simMode === 'open' || simMode === 'congest') {
      sim.road.mutate({ ...p, status: SIM_STATUS[simMode] });
      return;
    }
    if (simMode === 'barrier') {
      sim.barrier.mutate({ ...p, barrier: useDispatchStore.getState().simBarrier });
      return;
    }
    if (simMode === 'burst') {
      setBurstLocation(p);
      setSimMode(null);
      return;
    }
    const f = e.features?.[0];
    if (f && f.properties?.id != null) {
      select({
        kind: 'road',
        id: f.properties.id as string,
        ...p,
        props: f.properties as Partial<RoadProps>,
      });
      return;
    }
    select(null);
  };

  const interactive = [
    ...(layers.roads ? ['roads-closed', 'roads-congested'] : []),
    ...(layers.barriers ? ['barriers-line'] : []),
  ];

  return (
    <div className="relative h-full overflow-hidden rounded-2xl border">
      <BaseMap
        ref={mapRef}
        theme="dark"
        className="absolute inset-0"
        ariaLabel={tr.dispatch.layers.title}
        onLoad={() => {
          syncView();
          // A "show on map" request from another page that arrived before the map loaded.
          const f = useDispatchStore.getState().focus;
          if (f && Date.now() - f.ts < 10_000) {
            mapRef.current?.jumpTo({ center: [f.lng, f.lat], zoom: f.zoom ?? 15 });
          }
        }}
        onMoveEnd={syncView}
        onClick={onClick}
        interactiveLayerIds={interactive}
        cursor={simMode ? 'crosshair' : undefined}
        initialZoom={12.3}
      >
        {layers.zones && zones.data && (
          <ZonesLayer
            zones={zones.data}
            alerts={alerts.data ?? []}
            onSelect={(z) => select({ kind: 'zone', id: z.id })}
          />
        )}
        {layers.heatmap && <HeatmapLayer sos={sos.data ?? []} />}
        {layers.alerts && <AlertCirclesLayer alerts={alerts.data ?? []} />}
        {layers.roads && <TrafficLayer data={traffic.roads} />}
        {layers.barriers && (
          <BarriersLayer
            data={traffic.barriers}
            zoom={zoom}
            onSelect={(f, at) =>
              select({ kind: 'road', id: f.properties.id, ...at, props: f.properties })
            }
          />
        )}
        {layers.points &&
          (points.data ?? []).map((p) => (
            <PointMarker
              key={`p-${p.id}`}
              point={p}
              size={36}
              showLabel={zoom >= 13.5}
              selected={selection?.kind === 'point' && sameId(selection.id, p.id)}
              onClick={(pt) => select({ kind: 'point', id: pt.id })}
            />
          ))}
        {layers.brigades && brigades.data && (
          <BrigadesLayer
            brigades={brigades.data}
            positions={positions}
            selectedId={selection?.kind === 'brigade' ? String(selection.id) : null}
            onSelect={(b) => select({ kind: 'brigade', id: b.id })}
          />
        )}
        {layers.sos && (
          <SosMarkers
            sos={activeSos}
            zoom={zoom}
            bounds={bounds}
            selectedId={selection?.kind === 'sos' ? String(selection.id) : null}
            onSelect={(s) => select({ kind: 'sos', id: s.id })}
            onClusterClick={(p, z) =>
              mapRef.current?.flyTo({ center: [p.lng, p.lat], zoom: z, duration: 700 })
            }
          />
        )}
        {burstLocation && (
          <Marker latitude={burstLocation.lat} longitude={burstLocation.lng} anchor="center">
            <div className="grid h-10 w-10 place-items-center rounded-full border-2 border-dashed border-warning bg-warning/20 text-warning">
              <Crosshair className="h-5 w-5" aria-hidden />
            </div>
          </Marker>
        )}
        <SelectionPopup />
      </BaseMap>

      {/* Layer toggles */}
      <div className="absolute right-3 top-3 z-10">
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="secondary" size="sm" className="shadow-lg">
              <Layers className="h-4 w-4" aria-hidden />
              {tr.dispatch.layers.title}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-60">
            <ul className="flex flex-col gap-1">
              {LAYER_KEYS.map((k) => (
                <li key={k}>
                  <label className="flex cursor-pointer items-center justify-between rounded-lg px-2 py-1.5 text-sm hover:bg-accent">
                    {tr.dispatch.layers[k]}
                    <Switch checked={layers[k]} onCheckedChange={() => toggleLayer(k)} />
                  </label>
                </li>
              ))}
            </ul>
          </PopoverContent>
        </Popover>
      </div>

      {simMode && (
        <div
          className="absolute left-1/2 top-3 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full bg-warning px-4 py-2 text-sm font-semibold text-slate-950 shadow-lg"
          role="status"
        >
          <MousePointerClick className="h-4 w-4" aria-hidden />
          {simMode === 'burst'
            ? tr.sim.burstPick
            : simMode === 'barrier'
              ? `${tr.sim.addBarrier}: ${simBarrierLabel()}`
              : `${tr.sim[simMode === 'close' ? 'closeRoad' : simMode === 'open' ? 'openRoad' : 'congest']}: ${tr.sim.clickHint}`}
          <button
            type="button"
            onClick={() => setSimMode(null)}
            className="ml-1 rounded-full p-0.5 hover:bg-slate-950/10"
            aria-label={tr.sim.cancelMode}
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      )}
      <div className="pointer-events-none absolute bottom-3 right-3 z-10">
        <MapLegend showRoads={layers.roads} showBarriers={layers.barriers} />
      </div>
      {children}
    </div>
  );
}

function simBarrierLabel() {
  const b = useDispatchStore.getState().simBarrier;
  return b ? tr.barrier[b] : tr.barrier.none;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{children}</span>
    </div>
  );
}

function SelectionPopup() {
  const selection = useDispatchStore((s) => s.selection);
  const select = useDispatchStore((s) => s.select);
  const sos = useSosList().data;
  const points = useDispatchPoints().data;
  const brigades = useBrigades().data;
  const zones = useDispatchZones().data;
  const now = useNow(15_000);
  if (!selection) return null;

  const zoneName = (id: unknown) => zones?.find((z) => sameId(z.id, id as string))?.name ?? '—';
  const close = () => select(null);
  let lat: number | null = null;
  let lng: number | null = null;
  let body: ReactNode = null;

  if (selection.kind === 'sos') {
    const s = sos?.find((x) => sameId(x.id, selection.id));
    if (!s) return null;
    const m = SOS_META[s.type];
    const Icon = m.icon;
    const b = brigades?.find((x) => sameId(x.id, s.assigned_brigade_id));
    ({ lat, lng } = s);
    body = (
      <>
        <div className="flex items-center gap-2">
          <span
            className="grid h-8 w-8 place-items-center rounded-lg text-white"
            style={{ backgroundColor: m.color }}
          >
            <Icon className="h-4 w-4" aria-hidden />
          </span>
          <p className="font-bold">
            {m.label} #{String(s.id).slice(-5)}
          </p>
        </div>
        <Row label={tr.dispatch.popover.zone}>{zoneName(s.zone_id)}</Row>
        <Row label={tr.dispatch.popover.status}>{tr.sosStatus[s.status]}</Row>
        <Row label={tr.dispatch.popover.priority}>{priorityValue(s.priority_score)}</Row>
        <Row label={tr.dispatch.popover.created}>{timeAgo(s.created_at, now)}</Row>
        {b && <Row label={tr.dispatch.tabs.brigades}>{b.name}</Row>}
        {s.brigade_eta_min != null && (
          <Row label={tr.dispatch.popover.eta}>{formatEta(s.brigade_eta_min)}</Row>
        )}
        {s.note && <p className="rounded-lg bg-muted p-2 text-xs">{s.note}</p>}
      </>
    );
  } else if (selection.kind === 'point') {
    const p = points?.find((x) => sameId(x.id, selection.id));
    if (!p) return null;
    const Icon = POINT_META[p.type].icon;
    ({ lat, lng } = p);
    body = (
      <>
        <div className="flex items-center gap-2">
          <Icon className="h-5 w-5 text-info" aria-hidden />
          <p className="font-bold">{p.name}</p>
        </div>
        <Row label={tr.dispatch.popover.type}>{POINT_META[p.type].label}</Row>
        <Row label={tr.dispatch.popover.zone}>{zoneName(p.zone_id)}</Row>
        <Row label={tr.dispatch.popover.status}>
          <Badge
            variant={p.status === 'active' ? 'safe' : p.status === 'reserve' ? 'info' : 'neutral'}
          >
            {tr.pointStatus[p.status]}
          </Badge>
        </Row>
        <Row label={tr.dispatch.popover.capacity}>
          {formatNumber(p.current_count)} / {formatNumber(p.capacity)}
        </Row>
        <OccupancyBar pct={p.occupancy_pct} />
      </>
    );
  } else if (selection.kind === 'brigade') {
    const b = brigades?.find((x) => sameId(x.id, selection.id));
    if (!b) return null;
    const meta = BRIGADE_META[b.type];
    const target = sos?.find((x) => sameId(x.id, b.target_sos_id));
    ({ lat, lng } = b);
    body = (
      <>
        <p className="font-bold">{b.name}</p>
        <Row label={tr.dispatch.popover.type}>{meta.label}</Row>
        <Row label={tr.dispatch.popover.status}>{tr.brigadeStatus[b.status]}</Row>
        <Row label={tr.dispatch.popover.target}>
          {target
            ? `${SOS_META[target.type].label} #${String(target.id).slice(-5)}`
            : tr.dispatch.brigades.noTarget}
        </Row>
        {target?.brigade_eta_min != null && (
          <Row label={tr.dispatch.popover.eta}>{formatEta(target.brigade_eta_min)}</Row>
        )}
      </>
    );
  } else if (selection.kind === 'zone') {
    const z = zones?.find((x) => sameId(x.id, selection.id));
    const c = z ? zoneCenter(z) : null;
    if (!z || !c) return null;
    ({ lat, lng } = c);
    const active = (sos ?? []).filter(
      (s) => sameId(s.zone_id, z.id) && s.status !== 'resolved',
    ).length;
    const zp = (points ?? []).filter((p) => sameId(p.zone_id, z.id) && p.status === 'active');
    const avg = zp.length ? zp.reduce((a, p) => a + p.occupancy_pct, 0) / zp.length : 0;
    body = (
      <>
        <p className="font-bold">{z.name}</p>
        <Row label={tr.dispatch.analytics.activeSos}>{active}</Row>
        <Row label={tr.dispatch.tabs.points}>{zp.length}</Row>
        <OccupancyBar pct={avg} />
      </>
    );
  } else if (selection.kind === 'road') {
    ({ lat, lng } = selection);
    const pr = selection.props ?? {};
    body = (
      <>
        <p className="font-bold">
          {tr.dispatch.popover.road} #{String(selection.id)}
        </p>
        {pr.status && <Row label={tr.dispatch.popover.status}>{tr.roadStatus[pr.status]}</Row>}
        {pr.congestion_factor != null && pr.congestion_factor !== 1 && (
          <Row label={tr.dispatch.popover.congestion}>×{pr.congestion_factor}</Row>
        )}
        {pr.barrier && (
          <Row label={tr.dispatch.popover.barrier}>
            <BarrierIcon type={pr.barrier} className="mr-1 inline h-3.5 w-3.5" />
            {tr.barrier[pr.barrier]}
          </Row>
        )}
      </>
    );
  }

  if (lat == null || lng == null) return null;
  return (
    <Popup
      latitude={lat}
      longitude={lng}
      anchor="bottom"
      offset={22}
      onClose={close}
      closeOnClick={false}
      maxWidth="280px"
    >
      <div className="flex w-64 flex-col gap-2 p-3 pr-8">{body}</div>
    </Popup>
  );
}
