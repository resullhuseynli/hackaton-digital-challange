import type { Feature, FeatureCollection, LineString, Point, Polygon, MultiPolygon } from 'geojson';
import { Accessibility } from 'lucide-react';
import { memo, useEffect, useMemo } from 'react';
import { Layer, Marker, Source, useMap } from 'react-map-gl/maplibre';
import Supercluster from 'supercluster';
import { fill, plural, tr } from '@/i18n';
import { BRIGADE_META, SOS_META } from '@/lib/status';
import { isMiSos } from '@/lib/sosOrder';
import { cn } from '@/lib/utils';
import { zoneCenter } from '@/lib/zones';
import type { Alert, Brigade, LatLng, Sos, Zone } from '@/types/api';

// ---------------------------------------------------------------- zones
export function ZonesLayer({
  zones,
  alerts,
  onSelect,
}: {
  zones: Zone[];
  alerts: Alert[];
  onSelect: (z: Zone) => void;
}) {
  const { current: map } = useMap();
  const alertZoneIds = useMemo(() => alerts.map((a) => String(a.zone_id)), [alerts]);
  const data = useMemo<FeatureCollection<Polygon | MultiPolygon>>(
    () => ({
      type: 'FeatureCollection',
      features: zones
        .filter((z) => z.geometry)
        .map((z) => ({
          type: 'Feature',
          id: String(z.id),
          properties: {
            id: String(z.id),
            name: z.name,
            alert: alertZoneIds.includes(String(z.id)),
          },
          geometry: z.geometry!,
        })),
    }),
    [zones, alertZoneIds],
  );

  // Pulse the fill of zones with an active alert.
  useEffect(() => {
    if (!map || !alertZoneIds.length) return;
    let raf = 0;
    const tick = (t: number) => {
      const m = map.getMap();
      if (m.getLayer('zones-alert-fill')) {
        m.setPaintProperty(
          'zones-alert-fill',
          'fill-opacity',
          0.12 + 0.18 * (0.5 + 0.5 * Math.sin(t / 220)),
        );
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [map, alertZoneIds.length]);

  return (
    <>
      <Source id="zones" type="geojson" data={data}>
        <Layer
          id="zones-fill"
          type="fill"
          paint={{ 'fill-color': '#60A5FA', 'fill-opacity': 0.04 }}
        />
        <Layer
          id="zones-alert-fill"
          type="fill"
          filter={['==', ['get', 'alert'], true]}
          paint={{ 'fill-color': '#DC2626', 'fill-opacity': 0.2 }}
        />
        <Layer
          id="zones-line"
          type="line"
          paint={{
            'line-color': ['case', ['==', ['get', 'alert'], true], '#EF4444', '#94A3B8'],
            'line-width': ['case', ['==', ['get', 'alert'], true], 2.5, 1],
            'line-opacity': 0.7,
            'line-dasharray': [3, 2],
          }}
        />
      </Source>
      {zones.map((z) => {
        const c = zoneCenter(z);
        if (!c) return null;
        const alert = alertZoneIds.includes(String(z.id));
        return (
          <Marker
            key={`zl-${z.id}`}
            latitude={c.lat}
            longitude={c.lng}
            anchor="center"
            style={{ zIndex: 0 }}
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onSelect(z);
              }}
              className={cn(
                'rounded-md px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wider',
                alert
                  ? 'bg-danger text-white shadow-lg'
                  : 'text-slate-300/80 hover:bg-slate-900/70',
              )}
              aria-label={`${tr.dispatch.popover.zone}: ${z.name}`}
            >
              {z.name}
            </button>
          </Marker>
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------- heatmap
export function HeatmapLayer({ sos }: { sos: Sos[] }) {
  const data = useMemo<FeatureCollection<Point>>(
    () => ({
      type: 'FeatureCollection',
      features: sos.map((s) => ({
        type: 'Feature',
        properties: { w: s.status === 'resolved' ? 0.3 : 1 },
        geometry: { type: 'Point', coordinates: [s.lng, s.lat] },
      })),
    }),
    [sos],
  );
  return (
    <Source id="sos-heat" type="geojson" data={data}>
      <Layer
        id="sos-heat-layer"
        type="heatmap"
        paint={{
          'heatmap-weight': ['get', 'w'],
          'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 10, 0.8, 15, 2],
          'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 10, 18, 15, 40],
          'heatmap-opacity': 0.75,
          'heatmap-color': [
            'interpolate',
            ['linear'],
            ['heatmap-density'],
            0,
            'rgba(0,0,0,0)',
            0.2,
            '#2563EB',
            0.45,
            '#F59E0B',
            0.7,
            '#EA580C',
            1,
            '#DC2626',
          ],
        }}
      />
    </Source>
  );
}

// ---------------------------------------------------------------- SOS (clustered)
type SosProps = { id: string; idx: number; mi: number };

export function SosMarkers({
  sos,
  zoom,
  bounds,
  selectedId,
  onSelect,
  onClusterClick,
}: {
  sos: Sos[];
  zoom: number;
  bounds: [number, number, number, number] | null;
  selectedId: string | null;
  onSelect: (s: Sos) => void;
  onClusterClick: (p: LatLng, zoom: number) => void;
}) {
  const index = useMemo(() => {
    // Clusters keep a count of ♿ SOS so a person with reduced mobility never "disappears".
    const sc = new Supercluster<SosProps, { mi: number }>({
      radius: 56,
      maxZoom: 14,
      map: (p) => ({ mi: p.mi }),
      reduce: (acc, p) => {
        acc.mi += p.mi;
      },
    });
    sc.load(
      sos.map((s, idx) => ({
        type: 'Feature',
        properties: { id: String(s.id), idx, mi: isMiSos(s) ? 1 : 0 },
        geometry: { type: 'Point', coordinates: [s.lng, s.lat] },
      })),
    );
    return sc;
  }, [sos]);

  const clusters = useMemo(
    () => (bounds ? index.getClusters(bounds, Math.round(zoom)) : []),
    [index, bounds, zoom],
  );

  return (
    <>
      {clusters.map((c) => {
        const [lng, lat] = c.geometry.coordinates;
        const props = c.properties as Partial<Supercluster.ClusterProperties> & Partial<SosProps>;
        if (props.cluster) {
          const count = props.point_count ?? 0;
          const miCount = props.mi ?? 0;
          const size = Math.min(60, 30 + Math.sqrt(count) * 5);
          return (
            <Marker
              key={`c-${props.cluster_id}`}
              latitude={lat}
              longitude={lng}
              anchor="center"
              style={{ zIndex: 3 }}
            >
              <button
                type="button"
                className={cn(
                  'relative grid place-items-center rounded-full border-2 border-white/80 bg-danger/85 font-bold text-white shadow-lg hover:bg-danger',
                  miCount > 0 && 'outline outline-4 outline-offset-1 outline-violet-500',
                )}
                style={{ width: size, height: size }}
                aria-label={`${plural(tr.dispatch.feed.count, count)}${
                  miCount > 0 ? `. ${fill(tr.a11y.miCountAria, { n: miCount })}` : ''
                }`}
                onClick={(e) => {
                  e.stopPropagation();
                  const z = Math.min(16, index.getClusterExpansionZoom(props.cluster_id!));
                  onClusterClick({ lat, lng }, z);
                }}
              >
                {count}
                {miCount > 0 && (
                  <span
                    className="absolute -bottom-2 -right-3 inline-flex items-center gap-0.5 rounded-full border-2 border-white bg-violet-700 px-1 text-[10px] leading-4"
                    aria-hidden
                  >
                    <Accessibility className="h-3 w-3" strokeWidth={2.75} />
                    {miCount}
                  </span>
                )}
              </button>
            </Marker>
          );
        }
        const s = sos[props.idx!];
        return (
          <SosMarker
            key={String(s.id)}
            sos={s}
            selected={selectedId === String(s.id)}
            onSelect={onSelect}
          />
        );
      })}
    </>
  );
}

const SosMarker = memo(function SosMarker({
  sos,
  selected,
  onSelect,
}: {
  sos: Sos;
  selected: boolean;
  onSelect: (s: Sos) => void;
}) {
  const meta = SOS_META[sos.type];
  const Icon = meta.icon;
  const isNew = sos.status === 'new';
  const mi = isMiSos(sos);
  return (
    <Marker
      latitude={sos.lat}
      longitude={sos.lng}
      anchor="center"
      style={{ zIndex: selected ? 10 : mi ? 7 : isNew ? 4 : 2 }}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onSelect(sos);
        }}
        className={cn(
          'relative grid h-8 w-8 place-items-center rounded-full border-2 border-white text-white shadow-lg transition-transform hover:scale-110',
          // ♿ halo: thick violet ring around the type colour.
          mi && 'outline outline-4 outline-offset-2 outline-violet-500',
          selected && 'scale-125 ring-4 ring-white/40',
          sos.status === 'resolved' && 'opacity-50',
        )}
        style={{ backgroundColor: meta.color }}
        aria-label={`${mi ? `${tr.a11y.priority1}, ${tr.a11y.mobilityImpaired}, ` : ''}${meta.label}, ${tr.sosStatus[sos.status]}`}
      >
        {(isNew || mi) && (
          <span
            className="absolute -inset-1 animate-pulse-ring rounded-full"
            style={{ backgroundColor: mi ? '#8B5CF6' : meta.color }}
            aria-hidden
          />
        )}
        <Icon className="relative h-4 w-4" aria-hidden />
        {mi && (
          <span
            className="absolute -bottom-2 -right-2 grid h-5 w-5 place-items-center rounded-full border-2 border-white bg-violet-700"
            aria-hidden
          >
            <Accessibility className="h-3 w-3" strokeWidth={2.75} />
          </span>
        )}
      </button>
    </Marker>
  );
});

// ---------------------------------------------------------------- brigades
export function BrigadesLayer({
  brigades,
  positions,
  selectedId,
  onSelect,
}: {
  brigades: Brigade[];
  positions: Map<string, LatLng>;
  selectedId: string | null;
  onSelect: (b: Brigade) => void;
}) {
  const routes = useMemo<FeatureCollection<LineString>>(
    () => ({
      type: 'FeatureCollection',
      features: brigades
        .filter((b) => b.route_geometry && (b.status === 'en_route' || b.status === 'returning'))
        .map((b): Feature<LineString> => ({
          type: 'Feature',
          properties: { status: b.status, color: BRIGADE_META[b.type].color },
          geometry: b.route_geometry!,
        })),
    }),
    [brigades],
  );

  return (
    <>
      <Source id="brigade-routes" type="geojson" data={routes}>
        <Layer
          id="brigade-routes-line"
          type="line"
          layout={{ 'line-cap': 'round', 'line-join': 'round' }}
          paint={{
            'line-color': ['get', 'color'],
            'line-width': 3,
            'line-opacity': ['case', ['==', ['get', 'status'], 'returning'], 0.35, 0.85],
            'line-dasharray': [2, 1.5],
          }}
        />
      </Source>
      {brigades.map((b) => {
        const p = positions.get(String(b.id)) ?? { lat: b.lat, lng: b.lng };
        const meta = BRIGADE_META[b.type];
        const Icon = meta.icon;
        const selected = selectedId === String(b.id);
        return (
          <Marker
            key={`b-${b.id}`}
            latitude={p.lat}
            longitude={p.lng}
            anchor="center"
            style={{ zIndex: selected ? 9 : 6 }}
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onSelect(b);
              }}
              className={cn(
                'grid h-8 w-8 place-items-center rounded-lg border-2 shadow-lg transition-transform hover:scale-110',
                b.status === 'idle' ? 'border-slate-400 bg-slate-800' : 'border-white',
                selected && 'scale-125 ring-4 ring-white/40',
              )}
              style={
                b.status === 'idle'
                  ? { color: meta.color }
                  : { backgroundColor: meta.color, color: 'white' }
              }
              aria-label={`${b.name}, ${tr.brigadeStatus[b.status]}`}
            >
              <Icon className="h-4 w-4" aria-hidden />
            </button>
          </Marker>
        );
      })}
    </>
  );
}
