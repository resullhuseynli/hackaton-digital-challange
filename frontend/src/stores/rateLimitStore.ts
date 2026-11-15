import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/**
 * Server-imposed waits: registration (429 RATE_LIMITED) and the login lock (429 LOGIN_LOCKED).
 * The SOS cooldown lives in the citizen store (`cooldownUntil`), next to the active SOS.
 */
export type LimitKind = 'register' | 'login';

interface RateLimitState {
  /** Epoch ms until which the action is blocked (null = allowed). */
  until: Record<LimitKind, number | null>;
  /** The login lock is per (IP, username) on the server: remember which username it applies to. */
  loginUser: string | null;
  block: (kind: LimitKind, seconds: number, loginUser?: string) => void;
  clear: (kind: LimitKind) => void;
}

/**
 * Persisted to localStorage so a reload does not lose the countdown and immediately hit the
 * server again (nothing retries automatically while a limit is active).
 */
export const useRateLimitStore = create<RateLimitState>()(
  persist(
    (set) => ({
      until: { register: null, login: null },
      loginUser: null,
      block: (kind, seconds, loginUser) =>
        set((s) => ({
          until: { ...s.until, [kind]: Date.now() + Math.max(1, Math.ceil(seconds)) * 1000 },
          ...(kind === 'login' ? { loginUser: loginUser ?? null } : {}),
        })),
      clear: (kind) => set((s) => ({ until: { ...s.until, [kind]: null } })),
    }),
    { name: 'evac.limits', storage: createJSONStorage(() => localStorage) },
  ),
);

/** Seconds left for `kind` right now (0 = allowed). Safe to call outside React. */
export function limitLeft(kind: LimitKind): number {
  const until = useRateLimitStore.getState().until[kind];
  return until ? Math.max(0, Math.ceil((until - Date.now()) / 1000)) : 0;
}

/** Live countdown (seconds) for `kind`, ticking every second; 0 when not limited. */
export function useLimitCountdown(kind: LimitKind): number {
  const until = useRateLimitStore((s) => s.until[kind]);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!until || until <= Date.now()) return;
    setNow(Date.now());
    const t = window.setInterval(() => {
      setNow(Date.now());
      if (Date.now() >= until) window.clearInterval(t);
    }, 1000);
    return () => window.clearInterval(t);
  }, [until]);
  return until ? Math.max(0, Math.ceil((until - now) / 1000)) : 0;
}
