import { create } from 'zustand';
import type { SocketStatus } from '@/api/ws';

interface ConnectionState {
  online: boolean;
  citizenSocket: SocketStatus;
  dispatchSocket: SocketStatus;
  setOnline: (v: boolean) => void;
  setCitizenSocket: (s: SocketStatus) => void;
  setDispatchSocket: (s: SocketStatus) => void;
}

export const useConnectionStore = create<ConnectionState>((set) => ({
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  citizenSocket: 'idle',
  dispatchSocket: 'idle',
  setOnline: (online) => set({ online }),
  setCitizenSocket: (citizenSocket) => set({ citizenSocket }),
  setDispatchSocket: (dispatchSocket) => set({ dispatchSocket }),
}));
