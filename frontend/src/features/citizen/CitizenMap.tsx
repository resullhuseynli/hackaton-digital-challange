import type { FeatureCollection, MultiPolygon, Polygon } from 'geojson';
import { Accessibility } from 'lucide-react';
import { forwardRef, useImperativeHandle, useMemo, useRef } from 'react';
import { Layer, Marker, Source, type MapLayerMouseEvent, type MapRef } from 'react-map-gl/maplibre';
import { BaseMap } from '@/components/map/BaseMap';
import { PointMarker } from '@/components/map/PointMarker';
import { RouteLayer } from '@/components/map/RouteLayer';
import { UserMarker } from '@/components/map/UserMarker';
import { tr } from '@/i18n';
import { boundsOf } from '@/lib/geo';
import { ROUTE_COLOR, STEP_FREE_COLOR } from '@/lib/status';
import { sameId } from '@/lib/utils';
import type { AssemblyPoint, Id, LatLng, Route, Zone } from '@/types/api';
import type { CitizenLocation } from './useCitizenLocation';

export interface CitizenMapHandle {
  flyTo: (p: LatLng, zoom?: number) => void;
  fitRoute: (route: Route, extra?: LatLng) => void;
}

interface Props {
  theme: 'light' | 'dark';
  location: CitizenLocation | null;
  points: AssemblyPoint[];
  zones: Zone[] | undefined;
  route: Route | null;
  oldRoute: Route | null;
  selectedPointId: Id | null;
  onSelectPoint: (p: AssemblyPoint) => void;
  onMapClick?: (p: LatLng) => void;
  pickMode?: boolean;
  bottomPadding: number;
  topPadding: number;
}

export const CitizenMap = forwardRef<CitizenMapHandle, Props>(function CitizenMap(
  {
    theme,
    location,
    points,
    zones,
    route,
    oldRoute,
    selectedPointId,
    onSelectPoint,
    onMapClick,
    pickMode,
    bottomPadding,
    topPadding,
  },
  ref,
) {
  const mapRef = useRef<MapRef>(null);

  useImperativeHandle(
    ref,
    () => ({
      flyTo: (p, zoom = 15) =>
        mapRef.current?.flyTo({
          center: [p.lng, p.lat],
          zoom,
          duration: 900,
          padding: { top: topPadding, bottom: bottomPadding, left: 20, right: 20 },
        }),
      fitRoute: (r, extra) => {
        const coords = [...r.geometry.coordinates];
        if (extra) coords.push([extra.lng, extra.lat]);
        const b = boundsOf(coords);
        if (b)
          mapRef.current?.fitBounds(b, {
            padding: { top: topPadding + 20, bottom: bottomPadding + 40, left: 40, right: 40 },
            duration: 900,
            maxZoom: 16,
          });
      },
    }),
    [bottomPadding, topPadding],
  );

  const zoneData = useMemo<FeatureCollection<Polygon | MultiPolygon>>(
    () => ({
      type: 'FeatureCollection',
      features: (zones ?? [])
        .filter((z) => z.geometry)
        .map((z) => ({ type: 'Feature', properties: { name: z.name }, geometry: z.geometry! })),
    }),
    [zones],
  );

  const handleClick = (e: MapLayerMouseEvent) => {
    onMapClick?.({ lat: e.lngLat.lat, lng: e.lngLat.lng });
  };

  const targetId = route?.target_point_id ?? null;
  const start = route?.geometry.coordinates[0];

  return (
    <BaseMap
      ref={mapRef}
      theme={theme}
      className="absolute inset-0"
      ariaLabel={tr.citizen.nearest.title}
      initialCenter={location ?? undefined}
      initialZoom={location ? 14.5 : 12.5}
      onClick={handleClick}
      cursor={pickMode ? 'crosshair' : undefined}
    >
      <Source id="zones" type="geojson" data={zoneData}>
        <Layer
          id="zones-outline"
          type="line"
          paint={{
            'line-color': theme === 'dark' ? '#94A3B8' : '#64748B',
            'line-opacity': 0.45,
            'line-width': 1.25,
            'line-dasharray': [3, 2],
          }}
        />
      </Source>
      {oldRoute && <RouteLayer id="route-old" geometry={oldRoute.geometry} faded />}
      {route && (
        <RouteLayer
          id="route-active"
          geometry={route.geometry}
          color={route.accessible ? STEP_FREE_COLOR : ROUTE_COLOR}
          dashed={route.source === 'static_matrix'}
        />
      )}
      {route?.accessible && start && (
        <Marker longitude={start[0]} latitude={start[1]} anchor="center" style={{ zIndex: 9 }}>
          <span
            className="grid h-8 w-8 place-items-center rounded-full border-2 border-white text-white shadow-lg"
            style={{ backgroundColor: STEP_FREE_COLOR }}
            role="img"
            aria-label={tr.a11y.stepFreeRoute}
          >
            <Accessibility className="h-4 w-4" strokeWidth={2.75} aria-hidden />
          </span>
        </Marker>
      )}
      {/* Citizens only see active points; reserve and closed ones are hidden. */}
      {points
        .filter((p) => p.status === 'active' || sameId(p.id, targetId))
        .map((p) => (
          <PointMarker
            key={String(p.id)}
            point={p}
            selected={sameId(p.id, selectedPointId) || sameId(p.id, targetId)}
            dimmed={targetId != null && !sameId(p.id, targetId)}
            showLabel={sameId(p.id, targetId)}
            onClick={onSelectPoint}
          />
        ))}
      {location && (
        <UserMarker lat={location.lat} lng={location.lng} accuracy={location.accuracy} />
      )}
    </BaseMap>
  );
});
