import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { citizenApi } from '@/api/endpoints';
import { ApiError } from '@/api/http';
import { qk } from '@/api/queryKeys';
import { tr } from '@/i18n';
import { getDeviceId } from '@/lib/deviceId';
import { haversine } from '@/lib/geo';
import { sameId } from '@/lib/utils';
import { useCitizenStore } from '@/stores/citizenStore';
import { useConnectionStore } from '@/stores/connectionStore';
import { useRateLimitStore } from '@/stores/rateLimitStore';
import type { CitizenLocation } from './useCitizenLocation';

/** POST /citizens/register once per device (retried when back online). */
export function useRegistration() {
  const registered = useCitizenStore((s) => s.registered);
  const profileDone = useCitizenStore((s) => s.profileDone);
  const online = useConnectionStore((s) => s.online);
  const limitedUntil = useRateLimitStore((s) => s.until.register);
  // Clear an expired registration limit, which re-runs the retry below once (no polling).
  useEffect(() => {
    if (!limitedUntil) return;
    const clear = () => useRateLimitStore.getState().clear('register');
    if (limitedUntil <= Date.now()) return clear();
    const t = window.setTimeout(clear, limitedUntil - Date.now() + 500);
    return () => window.clearTimeout(t);
  }, [limitedUntil]);
  useEffect(() => {
    // The registration form registers explicitly; this only retries (e.g. it was offline).
    if (!profileDone || registered || !online) return;
    if (limitedUntil && limitedUntil > Date.now()) return; // 429: wait, never spam
    let cancelled = false;
    const { phone, mobilityImpaired } = useCitizenStore.getState();
    citizenApi
      .register(getDeviceId(), { phone: phone || null, mobility_impaired: mobilityImpaired })
      .then((c) => {
        if (cancelled) return;
        const st = useCitizenStore.getState();
        st.setRegistered(true);
        st.setCitizenStatus(c.status);
      })
      .catch((e) => {
        if (e instanceof ApiError && e.status === 429) {
          useRateLimitStore.getState().block('register', e.retryAfter ?? 60);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [profileDone, registered, online, limitedUntil]);
}

/** PATCH /citizens/me/location — every 15 s at most, or sooner after moving > 50 m. */
export function useLocationReporter(loc: CitizenLocation | null) {
  const last = useRef<{ lat: number; lng: number; at: number } | null>(null);
  const online = useConnectionStore((s) => s.online);
  useEffect(() => {
    if (!loc || !online) return;
    const now = Date.now();
    const prev = last.current;
    const moved = prev ? haversine(prev, loc) : Infinity;
    const elapsed = prev ? now - prev.at : Infinity;
    const due = (moved > 50 && elapsed > 3000) || (elapsed >= 15_000 && moved > 5);
    if (!due) return;
    last.current = { lat: loc.lat, lng: loc.lng, at: now };
    citizenApi.updateLocation(loc.lat, loc.lng).catch(() => {
      last.current = prev;
    });
  }, [loc, online]);
}

/**
 * GET /sos/me drives the SOS status card: refreshes the current SOS after reload/reconnect, and
 * restores an open SOS even if this browser has no local record of it.
 */
export function useMySos() {
  const active = useCitizenStore((s) => s.activeSos);
  const profileDone = useCitizenStore((s) => s.profileDone);
  const q = useQuery({
    queryKey: qk.mySos,
    queryFn: citizenApi.mySos,
    enabled: profileDone,
    staleTime: 10_000,
  });
  useEffect(() => {
    if (!q.data) return;
    if (active) {
      const fresh = q.data.find((s) => sameId(s.id, active.id));
      if (
        fresh &&
        (fresh.status !== active.status || fresh.brigade_eta_min !== active.brigade_eta_min)
      ) {
        useCitizenStore.getState().setActiveSos({ ...active, ...fresh });
      }
      return;
    }
    const open = [...q.data]
      .filter((s) => s.status !== 'resolved')
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    if (open) useCitizenStore.getState().setActiveSos(open);
  }, [q.data, active]);
}

/** Sends queued SOS signals automatically once the connection is back. */
export function useSosQueueFlusher() {
  const queue = useCitizenStore((s) => s.sosQueue);
  const online = useConnectionStore((s) => s.online);
  const busy = useRef(false);

  useEffect(() => {
    if (!queue.length || !online) return;
    const flush = async () => {
      if (busy.current) return;
      // A server-imposed wait is running: don't send anything until it is over.
      const until = useCitizenStore.getState().cooldownUntil;
      if (until && until > Date.now()) return;
      busy.current = true;
      try {
        for (const item of useCitizenStore.getState().sosQueue) {
          try {
            // localId doubles as the Idempotency-Key: retries return the SOS already created.
            const { sos, duplicateOf } = await citizenApi.createSos(
              { type: item.type, lat: item.lat, lng: item.lng, note: item.note },
              item.localId,
            );
            const st = useCitizenStore.getState();
            st.dequeueSos(item.localId);
            st.setActiveSos(sos);
            st.setCooldownUntil(Date.now() + 60_000);
            toast.success(tr.citizen.offline.queuedSent, {
              description: duplicateOf != null ? tr.citizen.sos.duplicate : undefined,
            });
          } catch (e) {
            if (e instanceof ApiError && e.status === 429) {
              const st = useCitizenStore.getState();
              st.setCooldownUntil(Date.now() + (e.retryAfter ?? 60) * 1000);
              // SOS_COOLDOWN: an SOS is already in progress, so this one is a duplicate - drop it.
              // RATE_LIMITED: keep it and send once the wait is over.
              if (e.code === 'SOS_COOLDOWN') st.dequeueSos(item.localId);
              break;
            }
            if (e instanceof ApiError && !e.isNetwork && e.status < 500) {
              useCitizenStore.getState().dequeueSos(item.localId);
              continue;
            }
            break; // still offline — retry later
          }
        }
      } finally {
        busy.current = false;
      }
    };
    void flush();
    const id = window.setInterval(() => void flush(), 10_000);
    return () => window.clearInterval(id);
  }, [queue.length, online]);
}
