const trimSlash = (s: string) => s.replace(/\/+$/, '');

const apiBase = trimSlash(import.meta.env.VITE_API_URL ?? 'http://localhost:8000');
const wsBase = trimSlash(import.meta.env.VITE_WS_URL ?? apiBase.replace(/^http/, 'ws'));

/** Which app this build serves: both (default), citizen-only or dispatcher-only. */
export type AppMode = 'all' | 'citizen' | 'dispatch';
const rawApp = import.meta.env.VITE_APP;
const app: AppMode = rawApp === 'citizen' || rawApp === 'dispatch' ? rawApp : 'all';

export const env = {
  apiUrl: `${apiBase}/api/v1`,
  wsUrl: wsBase,
  useMocks: import.meta.env.VITE_USE_MOCKS === 'true',
  app,
} as const;
