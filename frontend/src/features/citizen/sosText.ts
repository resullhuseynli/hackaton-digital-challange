import { fill, tr } from '@/i18n';
import type { Sos } from '@/types/api';

export function sosStatusText(s: Sos): string {
  if (s.status === 'assigned') {
    return s.brigade_eta_min != null
      ? fill(tr.citizen.sos.statusAssignedEta, { eta: Math.max(1, Math.round(s.brigade_eta_min)) })
      : tr.citizen.sos.statusAssigned;
  }
  if (s.status === 'resolved') return tr.citizen.sos.statusResolved;
  return tr.citizen.sos.statusNew;
}

/** Wall-clock time the brigade should arrive, from the latest brigade_eta_min (for a countdown). */
export function etaDeadline(s: Sos): number | null {
  if (s.status !== 'assigned' || s.brigade_eta_min == null) return null;
  return Date.now() + s.brigade_eta_min * 60_000;
}
