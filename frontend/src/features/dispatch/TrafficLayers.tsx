import type { FeatureCollection, Polygon } from 'geojson';
import { useMemo } from 'react';
import { Layer, Marker, Source } from 'react-map-gl/maplibre';
import { tr } from '@/i18n';
import { circleRing } from '@/lib/geo';
import type { Alert, RoadCollection, RoadFeature } from '@/types/api';
import { BarrierIcon } from './BarrierIcon';
import { BARRIER_TYPES } from './trafficData';

/** Closed = red dashed, congested = orange with width by congestion_factor. Open roads hidden. */
export function TrafficLayer({ data }: { data: RoadCollection }) {
  return (
    <Source id="roads" type="geojson" data={data}>
      <Layer
        id="roads-congested"
        type="line"
        filter={['==', ['get', 'status'], 'congested']}
        layout={{ 'line-cap': 'round', 'line-join': 'round' }}
        paint={{
          'line-color': '#F97316',
          'line-opacity': 0.9,
          // Thicker = worse congestion (factor 1 … 5+), scaled with zoom.
          'line-width': [
            '*',
            ['interpolate', ['linear'], ['zoom'], 11, 0.6, 16, 1.6],
            ['interpolate', ['linear'], ['coalesce', ['get', 'congestion_factor'], 1], 1, 3, 5, 9],
          ],
        }}
      />
      <Layer
        id="roads-closed-casing"
        type="line"
        filter={['==', ['get', 'status'], 'closed']}
        paint={{
          'line-color': '#ffffff',
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 5, 16, 11],
          'line-opacity': 0.75,
        }}
      />
      <Layer
        id="roads-closed"
        type="line"
        filter={['==', ['get', 'status'], 'closed']}
        paint={{
          'line-color': '#DC2626',
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 3, 16, 7],
          'line-dasharray': [1.5, 1],
        }}
      />
    </Source>
  );
}

function midpoint(f: RoadFeature): [number, number] {
  const c = f.geometry.coordinates;
  const a = c[Math.floor((c.length - 1) / 2)];
  const b = c[Math.ceil((c.length - 1) / 2)];
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

/** Barrier segments (violet) with a type glyph at their midpoint when zoomed in. */
export function BarriersLayer({
  data,
  zoom,
  onSelect,
}: {
  data: RoadCollection;
  zoom: number;
  onSelect: (f: RoadFeature, at: { lat: number; lng: number }) => void;
}) {
  // Two directions of a street share one glyph.
  const glyphs = useMemo(() => {
    const seen = new Set<string>();
    return data.features.filter((f) => {
      if (!f.properties.barrier) return false;
      const [lng, lat] = midpoint(f);
      const key = `${lng.toFixed(5)},${lat.toFixed(5)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [data]);

  return (
    <>
      <Source id="barriers" type="geojson" data={data}>
        <Layer
          id="barriers-line"
          type="line"
          layout={{ 'line-cap': 'round' }}
          paint={{
            'line-color': '#8B5CF6',
            'line-width': ['interpolate', ['linear'], ['zoom'], 12, 2, 16, 6],
            'line-opacity': 0.9,
          }}
        />
      </Source>
      {zoom >= 14 &&
        glyphs.slice(0, 400).map((f) => {
          const [lng, lat] = midpoint(f);
          const b = f.properties.barrier!;
          return (
            <Marker key={`bar-${f.properties.id}`} longitude={lng} latitude={lat} anchor="center">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect(f, { lat, lng });
                }}
                className="grid h-6 w-6 place-items-center rounded-full border-2 border-violet-400 bg-slate-900 text-xs leading-none shadow"
                aria-label={`${tr.dispatch.popover.barrier}: ${tr.barrier[b]}`}
                title={tr.barrier[b]}
              >
                <BarrierIcon type={b} className="h-3.5 w-3.5 text-violet-200" />
              </button>
            </Marker>
          );
        })}
    </>
  );
}

/** Active alert areas: red circle of `radius_m` around the cluster centre. */
export function AlertCirclesLayer({ alerts }: { alerts: Alert[] }) {
  const data = useMemo<FeatureCollection<Polygon>>(
    () => ({
      type: 'FeatureCollection',
      features: alerts.map((a) => ({
        type: 'Feature',
        properties: { id: String(a.id) },
        geometry: { type: 'Polygon', coordinates: [circleRing(a.center, a.radius_m || 500)] },
      })),
    }),
    [alerts],
  );
  return (
    <Source id="alert-circles" type="geojson" data={data}>
      <Layer
        id="alert-circles-fill"
        type="fill"
        paint={{ 'fill-color': '#DC2626', 'fill-opacity': 0.14 }}
      />
      <Layer
        id="alert-circles-line"
        type="line"
        paint={{ 'line-color': '#EF4444', 'line-width': 2.5, 'line-dasharray': [2, 1] }}
      />
    </Source>
  );
}

/** Legend for traffic + barriers (text, colour and glyph — never colour alone). */
export function MapLegend({
  showBarriers,
  showRoads,
}: {
  showBarriers: boolean;
  showRoads: boolean;
}) {
  if (!showBarriers && !showRoads) return null;
  return (
    <section
      aria-label={tr.dispatch.layers.legend}
      className="pointer-events-auto rounded-xl border bg-card/90 p-2.5 text-xs shadow-lg backdrop-blur"
    >
      {showRoads && (
        <ul className="mb-1.5 flex flex-col gap-1">
          <li className="flex items-center gap-2">
            <span
              className="h-1 w-6 rounded bg-[repeating-linear-gradient(90deg,#DC2626_0_6px,transparent_6px_10px)]"
              aria-hidden
            />
            {tr.dispatch.layers.closed}
          </li>
          <li className="flex items-center gap-2">
            <span className="h-1.5 w-6 rounded bg-orange-500" aria-hidden />
            {tr.dispatch.layers.congested}
          </li>
        </ul>
      )}
      {showBarriers && (
        <>
          <p className="mb-1 max-w-[200px] font-semibold text-muted-foreground">
            {tr.barrier.legend}
          </p>
          <ul className="grid grid-cols-2 gap-x-3 gap-y-0.5">
            {BARRIER_TYPES.map((b) => (
              <li key={b} className="flex items-center gap-1.5">
                <BarrierIcon type={b} className="h-3.5 w-3.5 text-violet-300" />
                {tr.barrier[b]}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
