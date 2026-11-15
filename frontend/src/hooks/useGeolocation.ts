import { useCallback, useEffect, useRef, useState } from 'react';

export type GeoPermission = 'unknown' | 'prompt' | 'granted' | 'denied' | 'unavailable';

export interface GeoFix {
  lat: number;
  lng: number;
  accuracy: number;
  at: number;
}

/**
 * Watches the device position once `enabled`. `request()` triggers the
 * permission prompt (must be called from a user gesture on iOS).
 */
export function useGeolocation(enabled: boolean) {
  const [permission, setPermission] = useState<GeoPermission>(
    'geolocation' in navigator ? 'unknown' : 'unavailable',
  );
  const [fix, setFix] = useState<GeoFix | null>(null);
  const [locating, setLocating] = useState(false);
  const watchId = useRef<number | null>(null);

  useEffect(() => {
    if (!('permissions' in navigator)) return;
    let status: PermissionStatus | null = null;
    const update = () => status && setPermission(status.state as GeoPermission);
    navigator.permissions
      .query({ name: 'geolocation' })
      .then((s) => {
        status = s;
        update();
        s.addEventListener('change', update);
      })
      .catch(() => undefined);
    return () => status?.removeEventListener('change', update);
  }, []);

  const startWatch = useCallback(() => {
    if (!('geolocation' in navigator) || watchId.current != null) return;
    setLocating(true);
    watchId.current = navigator.geolocation.watchPosition(
      (p) => {
        setLocating(false);
        setPermission('granted');
        setFix({
          lat: p.coords.latitude,
          lng: p.coords.longitude,
          accuracy: p.coords.accuracy,
          at: p.timestamp,
        });
      },
      (err) => {
        setLocating(false);
        if (err.code === err.PERMISSION_DENIED) {
          setPermission('denied');
          if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current);
          watchId.current = null;
        }
      },
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000 },
    );
  }, []);

  useEffect(() => {
    if (enabled && permission !== 'denied' && permission !== 'unavailable') startWatch();
  }, [enabled, permission, startWatch]);

  useEffect(
    () => () => {
      // Reset the id so a remount (StrictMode, HMR) starts a fresh watch.
      if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
    },
    [],
  );

  return { permission, fix, locating, request: startWatch };
}
