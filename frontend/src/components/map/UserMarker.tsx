import type { FeatureCollection, Polygon } from 'geojson';
import { useMemo } from 'react';
import { Layer, Marker, Source } from 'react-map-gl/maplibre';
import { tr } from '@/i18n';
import { circleRing } from '@/lib/geo';

export function UserMarker({
  lat,
  lng,
  accuracy,
}: {
  lat: number;
  lng: number;
  accuracy?: number | null;
}) {
  const circle = useMemo<FeatureCollection<Polygon>>(
    () => ({
      type: 'FeatureCollection',
      features:
        accuracy && accuracy > 5
          ? [
              {
                type: 'Feature',
                properties: {},
                geometry: { type: 'Polygon', coordinates: [circleRing({ lat, lng }, accuracy)] },
              },
            ]
          : [],
    }),
    [lat, lng, accuracy],
  );

  return (
    <>
      <Source id="user-accuracy" type="geojson" data={circle}>
        <Layer
          id="user-accuracy-fill"
          type="fill"
          paint={{ 'fill-color': '#2563EB', 'fill-opacity': 0.12 }}
        />
        <Layer
          id="user-accuracy-line"
          type="line"
          paint={{ 'line-color': '#2563EB', 'line-opacity': 0.4, 'line-width': 1 }}
        />
      </Source>
      <Marker latitude={lat} longitude={lng} anchor="center" style={{ zIndex: 10 }}>
        <div
          className="relative grid h-6 w-6 place-items-center"
          role="img"
          aria-label={tr.citizen.location.me}
        >
          <span
            className="absolute inset-0 animate-pulse-ring rounded-full bg-blue-500/40"
            aria-hidden
          />
          <span className="relative h-5 w-5 rounded-full border-[3px] border-white bg-info shadow-lg" />
        </div>
      </Marker>
    </>
  );
}
