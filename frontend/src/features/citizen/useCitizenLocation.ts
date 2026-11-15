import { useEffect, useMemo } from 'react';
import { useGeolocation } from '@/hooks/useGeolocation';
import { haversine } from '@/lib/geo';
import { zoneCenter } from '@/lib/zones';
import { useCitizenStore } from '@/stores/citizenStore';
import type { LatLng, Zone } from '@/types/api';

export interface CitizenLocation {
  lat: number;
  lng: number;
  accuracy: number | null;
  source: 'gps' | 'manual';
}

/** GPS fix if available, otherwise the manually chosen point. */
export function useCitizenLocation() {
  const onboarded = useCitizenStore((s) => s.onboarded);
  const manual = useCitizenStore((s) => s.manualLocation);
  const geo = useGeolocation(onboarded);

  const location = useMemo<CitizenLocation | null>(() => {
    if (geo.fix) {
      return { lat: geo.fix.lat, lng: geo.fix.lng, accuracy: geo.fix.accuracy, source: 'gps' };
    }
    if (manual) return { ...manual, accuracy: null, source: 'manual' };
    return null;
  }, [geo.fix, manual]);

  // Remember the last GPS position so SOS still works if the fix is lost later.
  useEffect(() => {
    if (!geo.fix) return;
    const prev = useCitizenStore.getState().lastKnown;
    if (!prev || haversine(prev, geo.fix) > 20) {
      useCitizenStore.getState().setLastKnown({ lat: geo.fix.lat, lng: geo.fix.lng });
    }
  }, [geo.fix]);

  return { location, geo };
}

/** Best location for an SOS: live → last known → chosen district centre. */
export function sosFallbackLocation(
  live: CitizenLocation | null,
  zones: Zone[] | undefined,
): LatLng | null {
  if (live) return live;
  const { lastKnown, zoneId } = useCitizenStore.getState();
  if (lastKnown) return lastKnown;
  const z = zones?.find((x) => String(x.id) === String(zoneId));
  return z ? zoneCenter(z) : null;
}
