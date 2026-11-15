import type { LucideIcon } from 'lucide-react';
import {
  Building2,
  Flame,
  HeartPulse,
  Landmark,
  ShieldPlus,
  Trees,
  Truck,
  Ambulance,
  Waves,
  LifeBuoy,
} from 'lucide-react';
import { tr } from '@/i18n';
import type { BrigadeStatus, BrigadeType, PointType, SosStatus, SosType } from '@/types/api';

export const COLORS = {
  safe: '#16A34A',
  warning: '#F59E0B',
  danger: '#DC2626',
  info: '#2563EB',
  slate: '#64748B',
} as const;

export type Level = 'safe' | 'warning' | 'danger';

/** < 70 % green, 70–90 % amber, ≥ 90 % red (brief §3.2). */
export function occupancyLevel(pct: number): Level {
  if (pct >= 90) return 'danger';
  if (pct >= 70) return 'warning';
  return 'safe';
}

export const levelColor = (l: Level) => COLORS[l];
export const occupancyColor = (pct: number) => COLORS[occupancyLevel(pct)];

export function occupancyLabel(pct: number): string {
  const l = occupancyLevel(pct);
  return l === 'danger' ? tr.occupancy.high : l === 'warning' ? tr.occupancy.mid : tr.occupancy.low;
}

export const SOS_META: Record<SosType, { label: string; color: string; icon: LucideIcon }> = {
  fire: {
    get label() {
      return tr.sosType.fire;
    },
    color: '#EA580C',
    icon: Flame,
  },
  collapse: {
    get label() {
      return tr.sosType.collapse;
    },
    color: '#78716C',
    icon: Building2,
  },
  flood: {
    get label() {
      return tr.sosType.flood;
    },
    color: '#2563EB',
    icon: Waves,
  },
  medical: {
    get label() {
      return tr.sosType.medical;
    },
    color: '#DC2626',
    icon: HeartPulse,
  },
};

export const SOS_TYPES: SosType[] = ['fire', 'collapse', 'flood', 'medical'];

export const POINT_META: Record<PointType, { label: string; icon: LucideIcon }> = {
  shelter: {
    get label() {
      return tr.pointType.shelter;
    },
    icon: ShieldPlus,
  },
  park: {
    get label() {
      return tr.pointType.park;
    },
    icon: Trees,
  },
  stadium: {
    get label() {
      return tr.pointType.stadium;
    },
    icon: Landmark,
  },
};

export const BRIGADE_META: Record<BrigadeType, { label: string; color: string; icon: LucideIcon }> =
  {
    fire: {
      get label() {
        return tr.brigadeType.fire;
      },
      color: '#EA580C',
      icon: Truck,
    },
    medical: {
      get label() {
        return tr.brigadeType.medical;
      },
      color: '#E11D48',
      icon: Ambulance,
    },
    rescue: {
      get label() {
        return tr.brigadeType.rescue;
      },
      color: '#0EA5E9',
      icon: LifeBuoy,
    },
  };

/** Priority badge level from a 0..100 (or 0..1) priority score. */
export function priorityLevel(score: number): Level {
  const s = score <= 1 ? score * 100 : score;
  if (s >= 70) return 'danger';
  if (s >= 40) return 'warning';
  return 'safe';
}

export function priorityValue(score: number): number {
  return Math.round(score <= 1 ? score * 100 : score);
}

export const SOS_STATUS_VARIANT: Record<SosStatus, Level> = {
  new: 'danger',
  assigned: 'warning',
  resolved: 'safe',
  // Closed during quarantine review (spam); shown neutrally as finished.
  rejected: 'safe',
};

export const BRIGADE_STATUS_VARIANT: Record<BrigadeStatus, Level | 'info'> = {
  idle: 'safe',
  en_route: 'warning',
  on_site: 'danger',
  returning: 'info',
};

/** Route colours: a step-free route is violet and always paired with a ♿ marker/badge. */
export const ROUTE_COLOR = '#2563EB';
export const STEP_FREE_COLOR = '#6D28D9';
