import { useEffect } from 'react';
import { useConnectionStore } from '@/stores/connectionStore';

/** Keeps the connection store's `online` flag in sync with the browser. */
export function useOnlineStatus(): boolean {
  const online = useConnectionStore((s) => s.online);
  const setOnline = useConnectionStore((s) => s.setOnline);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    setOnline(navigator.onLine);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, [setOnline]);
  return online;
}
