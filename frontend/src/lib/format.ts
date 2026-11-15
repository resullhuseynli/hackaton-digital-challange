import { fill, localeTag, tr } from '@/i18n';

// Intl formatters are cached per locale; the active one is picked on every call.
const numberFormats = new Map<string, Intl.NumberFormat>();
function nf(opts: Intl.NumberFormatOptions = {}): Intl.NumberFormat {
  const key = `${localeTag()}|${JSON.stringify(opts)}`;
  let f = numberFormats.get(key);
  if (!f) {
    f = new Intl.NumberFormat(localeTag(), opts);
    numberFormats.set(key, f);
  }
  return f;
}

export const formatNumber = (n: number) => nf().format(Math.round(n));

/** Up to one decimal, locale-aware: 3,2 (az) / 3.2 (en). */
export const formatNumber1 = (n: number) => nf({ maximumFractionDigits: 1 }).format(n);

export function formatDistance(m: number | null | undefined): string {
  if (m == null) return '—';
  if (m < 1000) return `${Math.round(m / 10) * 10} ${tr.units.m}`;
  const digits = m < 10000 ? 1 : 0;
  const km = nf({ minimumFractionDigits: digits, maximumFractionDigits: digits }).format(m / 1000);
  return `${km} ${tr.units.km}`;
}

export function formatEta(min: number | null | undefined): string {
  if (min == null) return '—';
  if (min < 1) return `<1 ${tr.units.min}`;
  return `${Math.round(min)} ${tr.units.min}`;
}

export function timeAgo(iso: string, now: number = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 10) return tr.time.justNow;
  if (s < 60) return fill(tr.time.secondsAgo, { n: s });
  const m = Math.floor(s / 60);
  if (m < 60) return fill(tr.time.minutesAgo, { n: m });
  return fill(tr.time.hoursAgo, { n: Math.floor(m / 60) });
}

export function formatClock(d: Date): string {
  return d.toLocaleTimeString(localeTag(), {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

export function formatHm(d: Date): string {
  return d.toLocaleTimeString(localeTag(), { hour: '2-digit', minute: '2-digit', hour12: false });
}

export function formatMmSs(totalSec: number): string {
  const s = Math.max(0, Math.ceil(totalSec));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${mm}:${ss.toString().padStart(2, '0')}`;
}

export const formatPct = (p: number) => `${Math.round(p)}%`;
