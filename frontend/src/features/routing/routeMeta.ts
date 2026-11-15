import type { NearestPoint, Route } from '@/types/api';

/** "≈ " for rough static-matrix estimates (route or nearest item), "" otherwise. */
export const approxPrefix = (x: Pick<Route, 'source'> | Pick<NearestPoint, 'source'> | null) =>
  x?.source === 'static_matrix' ? '≈ ' : '';

/** Route served while the external routing API was down. */
export const isFallbackRoute = (r: Route | null | undefined) => r?.routing_status === 'fallback';
