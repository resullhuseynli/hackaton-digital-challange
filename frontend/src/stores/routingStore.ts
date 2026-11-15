import { create } from 'zustand';
import type { BreakerState, Notice, Route, RoutingStatus, RoutingStatusOut } from '@/types/api';

export interface RoutingLogEntry {
  at: number;
  status: RoutingStatus;
  state: BreakerState | null;
  error: string | null;
}

interface RoutingState {
  /** `unknown` until the first /routing/status, event or route response. */
  status: RoutingStatus | 'unknown';
  notice: Notice | null;
  breaker: RoutingStatusOut['breaker'] | null;
  /** Epoch ms of the next half-open trial (from breaker.retry_in_sec), or null. */
  retryAt: number | null;
  /** Dispatcher event log: one entry per status / breaker-state transition (newest first). */
  log: RoutingLogEntry[];
  /** Height of the citizen fallback banner, so map overlays and pages can move below it. */
  bannerH: number;
  apply: (s: RoutingStatusOut) => void;
  /** A route served in fallback switches the mode before the WS event arrives. */
  fromRoute: (r: Route | null | undefined) => void;
  setBannerH: (h: number) => void;
}

const LOG_MAX = 20;

export const useRoutingStore = create<RoutingState>((set, get) => ({
  status: 'unknown',
  notice: null,
  breaker: null,
  retryAt: null,
  log: [],
  bannerH: 0,
  apply: (s) => {
    const prev = get();
    const changed = prev.status !== s.status || prev.breaker?.state !== s.breaker.state;
    set({
      status: s.status,
      notice: s.notice,
      breaker: s.breaker,
      retryAt: s.breaker.retry_in_sec != null ? Date.now() + s.breaker.retry_in_sec * 1000 : null,
      log: changed
        ? [
            {
              at: Date.now(),
              status: s.status,
              state: s.breaker.state,
              error: s.breaker.last_error,
            },
            ...prev.log,
          ].slice(0, LOG_MAX)
        : prev.log,
    });
  },
  fromRoute: (r) => {
    if (r?.routing_status !== 'fallback') return;
    const prev = get();
    if (prev.status === 'fallback') {
      if (!prev.notice && r.notice) set({ notice: r.notice });
      return;
    }
    set({
      status: 'fallback',
      notice: r.notice ?? prev.notice,
      log: [
        { at: Date.now(), status: 'fallback' as const, state: null, error: null },
        ...prev.log,
      ].slice(0, LOG_MAX),
    });
  },
  setBannerH: (bannerH) => set({ bannerH }),
}));
