import type { Feature, LineString } from 'geojson';
import { useEffect, useMemo } from 'react';
import { Layer, Source, useMap } from 'react-map-gl/maplibre';

// "Marching ants" dash sequence used to animate route direction.
const DASH_SEQ: number[][] = [
  [0, 4, 3],
  [0.5, 4, 2.5],
  [1, 4, 2],
  [1.5, 4, 1.5],
  [2, 4, 1],
  [2.5, 4, 0.5],
  [3, 4, 0],
  [0, 0.5, 3, 3.5],
  [0, 1, 3, 3],
  [0, 1.5, 3, 2.5],
  [0, 2, 3, 2],
  [0, 2.5, 3, 1.5],
  [0, 3, 3, 1],
  [0, 3.5, 3, 0.5],
];

interface Props {
  id: string;
  geometry: LineString;
  /** Old route after a reroute: thin, gray, no animation. */
  faded?: boolean;
  color?: string;
  /** Rough estimate (routing backup, static matrix): static dashed line, no direction animation. */
  dashed?: boolean;
}

export function RouteLayer({ id, geometry, faded, dashed, color = '#2563EB' }: Props) {
  const { current: map } = useMap();
  const data = useMemo<Feature<LineString>>(
    () => ({ type: 'Feature', properties: {}, geometry }),
    [geometry],
  );
  const dashId = `${id}-dash`;

  useEffect(() => {
    if (faded || dashed || !map) return;
    let step = 0;
    let raf = 0;
    let last = 0;
    const tick = (t: number) => {
      if (t - last > 60) {
        last = t;
        step = (step + 1) % DASH_SEQ.length;
        const m = map.getMap();
        if (m.getLayer(dashId)) m.setPaintProperty(dashId, 'line-dasharray', DASH_SEQ[step]);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [map, dashId, faded, dashed]);

  if (faded) {
    return (
      <Source id={id} type="geojson" data={data}>
        <Layer
          id={`${id}-line`}
          type="line"
          layout={{ 'line-cap': 'round', 'line-join': 'round' }}
          paint={{
            'line-color': '#94A3B8',
            'line-width': 5,
            'line-opacity': 0.55,
            'line-dasharray': [1, 1.5],
          }}
        />
      </Source>
    );
  }

  return (
    <Source id={id} type="geojson" data={data}>
      <Layer
        id={`${id}-casing`}
        type="line"
        layout={{ 'line-cap': 'round', 'line-join': 'round' }}
        paint={{ 'line-color': '#ffffff', 'line-width': 11, 'line-opacity': 0.95 }}
      />
      {/* Layers must be direct children of <Source> (it injects the source id); no fragments. */}
      {dashed && (
        // Separate layer id: maplibre cannot drop a dasharray from an existing layer cleanly.
        <Layer
          id={`${id}-line-dashed`}
          type="line"
          layout={{ 'line-cap': 'butt', 'line-join': 'round' }}
          paint={{ 'line-color': color, 'line-width': 7, 'line-dasharray': [1.6, 1.2] }}
        />
      )}
      {!dashed && (
        <Layer
          id={`${id}-line`}
          type="line"
          layout={{ 'line-cap': 'round', 'line-join': 'round' }}
          paint={{ 'line-color': color, 'line-width': 7 }}
        />
      )}
      {!dashed && (
        <Layer
          id={dashId}
          type="line"
          layout={{ 'line-cap': 'butt', 'line-join': 'round' }}
          paint={{ 'line-color': '#ffffff', 'line-width': 3, 'line-dasharray': DASH_SEQ[0] }}
        />
      )}
    </Source>
  );
}
