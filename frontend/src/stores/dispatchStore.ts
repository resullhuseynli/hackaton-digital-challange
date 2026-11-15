import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  Alert,
  BarrierType,
  Id,
  LatLng,
  RoadProps,
  SosStatus,
  SosType,
  SuspectedData,
} from '@/types/api';

export type RightTab = 'sos' | 'alerts' | 'brigades' | 'quarantine' | 'sim';

export type LayerKey =
  'sos' | 'heatmap' | 'zones' | 'points' | 'brigades' | 'roads' | 'barriers' | 'alerts';
export type SimMode = null | 'close' | 'open' | 'congest' | 'barrier' | 'burst';
export type Selection =
  | { kind: 'sos'; id: Id }
  | { kind: 'point'; id: Id }
  | { kind: 'brigade'; id: Id }
  | { kind: 'zone'; id: Id }
  | { kind: 'road'; id: Id; lat: number; lng: number; props?: Partial<RoadProps> }
  | null;

export interface SosFilters {
  zone: string;
  type: SosType | 'all';
  status: SosStatus | 'active' | 'all';
  search: string;
}

interface DispatchState {
  layers: Record<LayerKey, boolean>;
  filters: SosFilters;
  demoMode: boolean;
  navCollapsed: boolean;
  /** Right sidebar tab on the main dispatcher view. */
  rightTab: RightTab;
  setRightTab: (t: RightTab) => void;
  /** Latest aggregated `sos.suspected` event (flood banner + quarantine badge). */
  suspected: (SuspectedData & { at: number }) | null;
  setSuspected: (d: SuspectedData | null) => void;
  muted: boolean;
  simOpen: boolean;
  simMode: SimMode;
  burstLocation: LatLng | null;
  selection: Selection;
  /** Alert currently shown in the RED ALERT modal. */
  openAlertId: Id | null;
  /** Alerts the dispatcher has not looked at yet (queue). */
  unseenAlertIds: string[];
  highlightSosIds: string[];
  reroutedCount: number;
  focus: { lat: number; lng: number; zoom?: number; ts: number } | null;

  toggleLayer: (k: LayerKey) => void;
  setFilters: (f: Partial<SosFilters>) => void;
  setDemoMode: (v: boolean) => void;
  toggleNav: () => void;
  setMuted: (v: boolean) => void;
  setSimOpen: (v: boolean) => void;
  setSimMode: (m: SimMode) => void;
  /** Barrier type applied by a map click in 'barrier' mode (null removes a barrier). */
  simBarrier: BarrierType | null;
  setSimBarrier: (b: BarrierType | null) => void;
  /** Human-readable outcome of the last simulation command (shown in the Simulation tab). */
  simResult: { text: string; at: number } | null;
  setSimResult: (text: string) => void;
  setBurstLocation: (p: LatLng | null) => void;
  select: (s: Selection) => void;
  openAlert: (id: Id | null) => void;
  queueAlert: (id: Id) => void;
  forgetAlert: (id: Id) => void;
  highlightSos: (id: Id) => void;
  /** Last alert.resolved payload (confirm result summary / dismiss reason). */
  alertOutcome: Partial<Alert> | null;
  setAlertOutcome: (a: Partial<Alert> | null) => void;
  addRerouted: (count?: number) => void;
  focusOn: (p: LatLng, zoom?: number) => void;
}

export const useDispatchStore = create<DispatchState>()(
  persist(
    (set, get) => ({
      layers: {
        sos: true,
        heatmap: false,
        zones: true,
        points: true,
        brigades: true,
        roads: true,
        barriers: true,
        alerts: true,
      },
      filters: { zone: 'all', type: 'all', status: 'active', search: '' },
      demoMode: true,
      navCollapsed: false,
      rightTab: 'sos',
      setRightTab: (rightTab) => set({ rightTab }),
      suspected: null,
      setSuspected: (d) => set({ suspected: d ? { ...d, at: Date.now() } : null }),
      toggleNav: () => set((s) => ({ navCollapsed: !s.navCollapsed })),
      muted: false,
      simOpen: false,
      simMode: null,
      burstLocation: null,
      selection: null,
      openAlertId: null,
      unseenAlertIds: [],
      highlightSosIds: [],
      reroutedCount: 0,
      focus: null,

      toggleLayer: (k) => set((s) => ({ layers: { ...s.layers, [k]: !s.layers[k] } })),
      setFilters: (f) => set((s) => ({ filters: { ...s.filters, ...f } })),
      setDemoMode: (demoMode) =>
        set({ demoMode, simOpen: demoMode ? get().simOpen : false, simMode: null }),
      setMuted: (muted) => set({ muted }),
      setSimOpen: (simOpen) => set({ simOpen, simMode: simOpen ? get().simMode : null }),
      setSimMode: (simMode) => set({ simMode }),
      simBarrier: 'stairs',
      setSimBarrier: (simBarrier) => set({ simBarrier }),
      simResult: null,
      setSimResult: (text) => set({ simResult: { text, at: Date.now() } }),
      setBurstLocation: (burstLocation) => set({ burstLocation }),
      select: (selection) => set({ selection }),
      openAlert: (id) =>
        set((s) => ({
          openAlertId: id,
          unseenAlertIds:
            id == null ? s.unseenAlertIds : s.unseenAlertIds.filter((x) => x !== String(id)),
        })),
      queueAlert: (id) =>
        set((s) => {
          const key = String(id);
          if (s.openAlertId == null) return { openAlertId: id };
          if (String(s.openAlertId) === key || s.unseenAlertIds.includes(key)) return {};
          return { unseenAlertIds: [...s.unseenAlertIds, key] };
        }),
      forgetAlert: (id) =>
        set((s) => ({ unseenAlertIds: s.unseenAlertIds.filter((x) => x !== String(id)) })),
      highlightSos: (id) => {
        const key = String(id);
        set((s) => ({ highlightSosIds: [...s.highlightSosIds, key] }));
        window.setTimeout(
          () => set((s) => ({ highlightSosIds: s.highlightSosIds.filter((x) => x !== key) })),
          4000,
        );
      },
      alertOutcome: null,
      setAlertOutcome: (alertOutcome) => set({ alertOutcome }),
      addRerouted: (count = 1) => set((s) => ({ reroutedCount: s.reroutedCount + count })),
      focusOn: (p, zoom) => set({ focus: { ...p, zoom, ts: Date.now() } }),
    }),
    {
      name: 'evac.dispatch',
      partialize: (s) => ({
        layers: s.layers,
        filters: s.filters,
        demoMode: s.demoMode,
        muted: s.muted,
        navCollapsed: s.navCollapsed,
      }),
      // New layer keys default to on for sessions saved before they existed.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<DispatchState>;
        return { ...current, ...p, layers: { ...current.layers, ...(p.layers ?? {}) } };
      },
    },
  ),
);
