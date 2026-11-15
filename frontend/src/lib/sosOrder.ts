import type { Label, Sos } from '@/types/api';
import { sameId } from './utils';

/**
 * The backend's queue order: persons with reduced mobility first, then priority_score
 * descending, then oldest first. GET /sos is already in this order — the client never re-sorts
 * it, and only uses this rule to place an item that arrives (or changes) over the WebSocket.
 */
export function compareSos(a: Sos, b: Sos): number {
  const mi = Number(b.citizen_mobility_impaired) - Number(a.citizen_mobility_impaired);
  if (mi) return mi;
  const score = b.priority_score - a.priority_score;
  if (score) return score;
  return a.created_at.localeCompare(b.created_at);
}

type SosPatch = Partial<Sos> & Pick<Sos, 'id'>;

const isFull = (s: SosPatch): s is Sos =>
  s.type != null && s.lat != null && s.created_at != null && s.priority_score != null;

/**
 * Merges a full or partial SOS into a server-ordered list. Only the changed item moves; every
 * other row keeps the position the server gave it.
 */
export function mergeSos(list: Sos[] | undefined, patch: SosPatch): Sos[] {
  const current = list ?? [];
  const idx = current.findIndex((s) => sameId(s.id, patch.id));
  if (idx < 0 && !isFull(patch)) return current; // partial update for something we don't show
  const item: Sos = idx < 0 ? (patch as Sos) : { ...current[idx], ...patch };
  const rest = idx < 0 ? current : [...current.slice(0, idx), ...current.slice(idx + 1)];

  // Keep the old slot if the item still fits there (ties stay where the server put them).
  if (idx >= 0) {
    const before = rest[idx - 1];
    const after = rest[idx];
    const fits =
      (!before || compareSos(before, item) <= 0) && (!after || compareSos(item, after) <= 0);
    if (fits) return [...rest.slice(0, idx), item, ...rest.slice(idx)];
  }
  let at = rest.findIndex((s) => compareSos(item, s) < 0);
  if (at < 0) at = rest.length;
  return [...rest.slice(0, at), item, ...rest.slice(at)];
}

/** True for SOS shown as ♿ priority #1 (flag or MOBILITY_IMPAIRED label). */
export const isMiSos = (s: { citizen_mobility_impaired?: boolean; labels?: Label[] }) =>
  !!s.citizen_mobility_impaired || !!s.labels?.some((l) => l.code === 'MOBILITY_IMPAIRED');
