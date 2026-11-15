import { uuid } from './utils';

const KEY = 'evac.device_id';
let cached: string | null = null;

/** Stable per-device UUID, generated on first launch. */
export function getDeviceId(): string {
  if (cached) return cached;
  try {
    const existing = localStorage.getItem(KEY);
    if (existing) {
      cached = existing;
      return existing;
    }
    const id = uuid();
    localStorage.setItem(KEY, id);
    cached = id;
    return id;
  } catch {
    cached = cached ?? uuid();
    return cached;
  }
}
