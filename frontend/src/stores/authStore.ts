import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { PanelRole } from '@/types/api';

interface AuthState {
  token: string | null;
  username: string | null;
  /** From the login response. The server re-checks it on every request; this only drives the UI. */
  role: PanelRole | null;
  /** Reason shown on the login page after a forced logout. */
  logoutReason: string | null;
  login: (token: string, username: string, role: PanelRole) => void;
  logout: (reason?: string) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      username: null,
      role: null,
      logoutReason: null,
      login: (token, username, role) => set({ token, username, role, logoutReason: null }),
      logout: (reason) =>
        set({ token: null, username: null, role: null, logoutReason: reason ?? null }),
    }),
    {
      name: 'evac.auth',
      // Token lives in memory + sessionStorage: closing the tab ends the dispatcher session.
      storage: createJSONStorage(() => sessionStorage),
      partialize: (s) => ({ token: s.token, username: s.username, role: s.role }),
    },
  ),
);

const LEVEL: Record<PanelRole, number> = { operator: 1, dispatcher: 2, admin: 3 };

/** What the signed-in role may do (mirrors the backend RBAC table). */
export interface Permissions {
  role: PanelRole | null;
  /** Assign, resolve, confirm/dismiss alerts, review quarantine (dispatcher+). */
  write: boolean;
  /** Simulation and drills (admin only). */
  sim: boolean;
}

export function permissionsFor(role: PanelRole | null): Permissions {
  const level = role ? LEVEL[role] : 0;
  return { role, write: level >= LEVEL.dispatcher, sim: level >= LEVEL.admin };
}

export const usePermissions = (): Permissions => permissionsFor(useAuthStore((s) => s.role));
