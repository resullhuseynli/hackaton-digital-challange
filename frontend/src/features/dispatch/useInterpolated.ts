import { useEffect, useRef, useState } from 'react';
import type { Brigade, LatLng } from '@/types/api';

interface Anim {
  from: LatLng;
  to: LatLng;
  start: number;
}

const DURATION = 1000;
const ease = (t: number) => 1 - (1 - t) ** 3;

/** Smoothly interpolates brigade positions between `brigade.updated` events. */
export function useInterpolatedPositions(brigades: Brigade[] | undefined): Map<string, LatLng> {
  const anims = useRef(new Map<string, Anim>());
  const current = useRef(new Map<string, LatLng>());
  const [, force] = useState(0);
  const raf = useRef<number | null>(null);

  useEffect(() => {
    if (!brigades) return;
    const now = performance.now();
    let changed = false;
    for (const b of brigades) {
      const key = String(b.id);
      const to = { lat: b.lat, lng: b.lng };
      const cur = current.current.get(key);
      if (!cur) {
        current.current.set(key, to);
        changed = true;
        continue;
      }
      const prevTarget = anims.current.get(key)?.to ?? cur;
      if (prevTarget.lat !== to.lat || prevTarget.lng !== to.lng) {
        anims.current.set(key, { from: { ...cur }, to, start: now });
      }
    }
    if (changed) force((n) => n + 1);

    const step = () => {
      const t = performance.now();
      let active = false;
      anims.current.forEach((a, key) => {
        const k = Math.min(1, (t - a.start) / DURATION);
        const e = ease(k);
        current.current.set(key, {
          lat: a.from.lat + (a.to.lat - a.from.lat) * e,
          lng: a.from.lng + (a.to.lng - a.from.lng) * e,
        });
        if (k >= 1) anims.current.delete(key);
        else active = true;
      });
      force((n) => n + 1);
      raf.current = active ? requestAnimationFrame(step) : null;
    };
    if (anims.current.size && raf.current == null) raf.current = requestAnimationFrame(step);
  }, [brigades]);

  useEffect(
    () => () => {
      if (raf.current != null) cancelAnimationFrame(raf.current);
    },
    [],
  );

  return current.current;
}
