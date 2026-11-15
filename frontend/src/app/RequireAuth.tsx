import { useEffect, type ReactNode } from 'react';
import { tr } from '@/i18n';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';

export function RequireAuth({ children }: { children: ReactNode }) {
  const token = useAuthStore((s) => s.token);
  const role = useAuthStore((s) => s.role);
  const location = useLocation();
  // A session from before roles were stored: sign in again rather than guess the role.
  const stale = !!token && !role;
  useEffect(() => {
    if (stale) useAuthStore.getState().logout(tr.auth.sessionExpired);
  }, [stale]);
  if (!token || stale)
    return <Navigate to="/dispatcher/login" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}
