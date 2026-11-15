import { createContext, useContext } from 'react';
import type { GeoFix, GeoPermission } from '@/hooks/useGeolocation';
import type { AssemblyPoint, Id, Zone } from '@/types/api';
import type { CitizenLocation } from './useCitizenLocation';

export interface CitizenCtx {
  location: CitizenLocation | null;
  geo: { permission: GeoPermission; fix: GeoFix | null; locating: boolean; request: () => void };
  zones: Zone[] | undefined;
  manualMode: boolean;
  setManualMode: (v: boolean) => void;
  /** Builds a route to the point; resolves true on success. */
  startRoute: (point: AssemblyPoint) => Promise<boolean>;
  routingId: Id | null;
  checkIn: (point: AssemblyPoint) => void;
  checkingIn: boolean;
}

export const CitizenContext = createContext<CitizenCtx | null>(null);

export function useCitizen(): CitizenCtx {
  const ctx = useContext(CitizenContext);
  if (!ctx) throw new Error('useCitizen must be used inside CitizenLayout');
  return ctx;
}

/** Height of the fixed citizen header (excluding the safe-area inset). */
export const HEADER_H = 52;

/** Height of the bottom tab bar (excluding the safe-area inset). */
export const TAB_BAR_H = 64;
