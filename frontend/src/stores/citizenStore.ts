import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  AssemblyPoint,
  CitizenStatus,
  Id,
  LatLng,
  NearestPoint,
  Sos,
  SosType,
} from '@/types/api';
import type { ReroutedData } from '@/types/ws';

export interface QueuedSos {
  localId: string;
  note?: string;
  type: SosType;
  lat: number;
  lng: number;
  queuedAt: number;
}

interface CitizenState {
  // persisted
  onboarded: boolean;
  registered: boolean;
  /** The registration form (phone + ♿ checkbox) has been completed on this device. */
  profileDone: boolean;
  /** Profile, sent with POST /citizens/register. */
  phone: string;
  mobilityImpaired: boolean;
  /** Last status reported by the server (safe / in_danger / unknown). */
  citizenStatus: CitizenStatus;
  manualLocation: LatLng | null;
  zoneId: Id | null;
  sosQueue: QueuedSos[];
  activeSos: Sos | null;
  /** Wall-clock arrival time of the assigned brigade (drives the ETA countdown). */
  sosEtaAt: number | null;
  sosCardHidden: boolean;
  cooldownUntil: number | null;
  safeSince: string | null;
  lastNearest: NearestPoint[] | null;
  lastPoints: AssemblyPoint[] | null;
  lastKnown: LatLng | null;
  // transient
  reroute: ReroutedData | null;
  selectedPointId: Id | null;
  checkedIn: AssemblyPoint | null;
  sosOpen: boolean;

  setOnboarded: (v: boolean) => void;
  setRegistered: (v: boolean) => void;
  setProfileDone: (v: boolean) => void;
  setProfile: (p: { phone: string; mobilityImpaired: boolean }) => void;
  setCitizenStatus: (s: CitizenStatus) => void;
  setManualLocation: (p: LatLng | null) => void;
  setZoneId: (id: Id | null) => void;
  enqueueSos: (s: QueuedSos) => void;
  dequeueSos: (localId: string) => void;
  setActiveSos: (s: Sos | null) => void;
  setSosCardHidden: (v: boolean) => void;
  setCooldownUntil: (t: number | null) => void;
  setSafeSince: (iso: string | null) => void;
  setLastNearest: (n: NearestPoint[]) => void;
  setLastPoints: (p: AssemblyPoint[]) => void;
  setLastKnown: (p: LatLng) => void;
  setReroute: (r: ReroutedData | null) => void;
  selectPoint: (id: Id | null) => void;
  setCheckedIn: (p: AssemblyPoint | null) => void;
  setSosOpen: (v: boolean) => void;
}

export const useCitizenStore = create<CitizenState>()(
  persist(
    (set) => ({
      onboarded: false,
      registered: false,
      profileDone: false,
      phone: '',
      mobilityImpaired: false,
      citizenStatus: 'unknown',
      manualLocation: null,
      zoneId: null,
      sosQueue: [],
      activeSos: null,
      sosEtaAt: null,
      sosCardHidden: false,
      cooldownUntil: null,
      safeSince: null,
      lastNearest: null,
      lastPoints: null,
      lastKnown: null,
      reroute: null,
      selectedPointId: null,
      checkedIn: null,
      sosOpen: false,

      setOnboarded: (onboarded) => set({ onboarded }),
      setRegistered: (registered) => set({ registered }),
      setProfileDone: (profileDone) => set({ profileDone }),
      setProfile: ({ phone, mobilityImpaired }) => set({ phone, mobilityImpaired }),
      setCitizenStatus: (citizenStatus) => set({ citizenStatus }),
      setManualLocation: (manualLocation) => set({ manualLocation }),
      setZoneId: (zoneId) => set({ zoneId }),
      enqueueSos: (s) => set((st) => ({ sosQueue: [...st.sosQueue, s] })),
      dequeueSos: (id) => set((st) => ({ sosQueue: st.sosQueue.filter((q) => q.localId !== id) })),
      setActiveSos: (activeSos) =>
        set({
          activeSos,
          sosCardHidden: false,
          sosEtaAt:
            activeSos?.status === 'assigned' && activeSos.brigade_eta_min != null
              ? Date.now() + activeSos.brigade_eta_min * 60_000
              : null,
        }),
      setSosCardHidden: (sosCardHidden) => set({ sosCardHidden }),
      setCooldownUntil: (cooldownUntil) => set({ cooldownUntil }),
      setSafeSince: (safeSince) => set({ safeSince }),
      setLastNearest: (lastNearest) => set({ lastNearest }),
      setLastPoints: (lastPoints) => set({ lastPoints }),
      setLastKnown: (lastKnown) => set({ lastKnown }),
      setReroute: (reroute) => set({ reroute }),
      selectPoint: (selectedPointId) => set({ selectedPointId }),
      setCheckedIn: (checkedIn) => set({ checkedIn }),
      setSosOpen: (sosOpen) => set({ sosOpen }),
    }),
    {
      name: 'evac.citizen',
      partialize: (s) => ({
        onboarded: s.onboarded,
        registered: s.registered,
        profileDone: s.profileDone,
        phone: s.phone,
        mobilityImpaired: s.mobilityImpaired,
        citizenStatus: s.citizenStatus,
        manualLocation: s.manualLocation,
        zoneId: s.zoneId,
        sosQueue: s.sosQueue,
        activeSos: s.activeSos,
        sosEtaAt: s.sosEtaAt,
        sosCardHidden: s.sosCardHidden,
        cooldownUntil: s.cooldownUntil,
        safeSince: s.safeSince,
        lastNearest: s.lastNearest,
        lastPoints: s.lastPoints,
        lastKnown: s.lastKnown,
      }),
    },
  ),
);
