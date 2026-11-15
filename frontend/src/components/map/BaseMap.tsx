import 'maplibre-gl/dist/maplibre-gl.css';
import { forwardRef, type ReactNode } from 'react';
import Map, {
  AttributionControl,
  type MapLayerMouseEvent,
  type MapRef,
  type ViewStateChangeEvent,
} from 'react-map-gl/maplibre';
import { BAKU_CENTER } from '@/lib/geo';

export const MAP_STYLES = {
  light: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
  dark: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
} as const;

/** Fallback if CARTO is unreachable. */
export const MAP_STYLE_FALLBACK = 'https://tiles.openfreemap.org/styles/positron';

export interface BaseMapProps {
  theme: 'light' | 'dark';
  children?: ReactNode;
  initialZoom?: number;
  initialCenter?: { lat: number; lng: number };
  interactiveLayerIds?: string[];
  onClick?: (e: MapLayerMouseEvent) => void;
  onMoveEnd?: (e: ViewStateChangeEvent) => void;
  onLoad?: () => void;
  cursor?: string;
  className?: string;
  ariaLabel: string;
  interactive?: boolean;
}

export const BaseMap = forwardRef<MapRef, BaseMapProps>(function BaseMap(
  {
    theme,
    children,
    initialZoom = 12.5,
    initialCenter = BAKU_CENTER,
    interactiveLayerIds,
    onClick,
    onMoveEnd,
    onLoad,
    cursor,
    className,
    ariaLabel,
    interactive = true,
  },
  ref,
) {
  return (
    <div className={className} role="region" aria-label={ariaLabel}>
      <Map
        ref={ref}
        initialViewState={{
          latitude: initialCenter.lat,
          longitude: initialCenter.lng,
          zoom: initialZoom,
        }}
        mapStyle={MAP_STYLES[theme]}
        style={{ width: '100%', height: '100%' }}
        attributionControl={false}
        interactiveLayerIds={interactiveLayerIds}
        onClick={onClick}
        onMoveEnd={onMoveEnd}
        onLoad={onLoad}
        cursor={cursor}
        dragRotate={false}
        pitchWithRotate={false}
        touchPitch={false}
        maxZoom={18}
        minZoom={9}
        interactive={interactive}
      >
        <AttributionControl compact position="bottom-left" />
        {children}
      </Map>
    </div>
  );
});
