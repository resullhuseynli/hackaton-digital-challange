import { afterEach, describe, expect, it } from 'vitest';
import { formatDistance, formatEta, timeAgo } from '@/lib/format';
import { SOS_META } from '@/lib/status';
import { tr, useLangStore } from './index';
import azDict from './locales/az.json';
import enDict from './locales/en.json';

type Tree = Record<string, unknown>;

/** Flattens a dictionary to "path → kind" so both languages can be compared key by key. */
function shape(obj: unknown, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj as Tree)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'object' && v !== null && !Array.isArray(v))
      Object.assign(out, shape(v, path));
    else out[path] = Array.isArray(v) ? `array:${v.length}` : typeof v;
  }
  return out;
}

function emptyStrings(obj: unknown, prefix = ''): string[] {
  return Object.entries(obj as Tree).flatMap(([k, v]) => {
    const path = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') return v.trim() ? [] : [path];
    if (typeof v === 'object' && v !== null) return emptyStrings(v, path);
    return [];
  });
}

afterEach(() => useLangStore.setState({ lang: 'az' }));

describe('dictionaries', () => {
  it('English has exactly the same keys as Azerbaijani', () => {
    expect(shape(enDict)).toEqual(shape(azDict));
  });
  it('no empty strings', () => {
    expect(emptyStrings(azDict)).toEqual([]);
    expect(emptyStrings(enDict)).toEqual([]);
  });
});

describe('switching language', () => {
  it('defaults to Azerbaijani', () => {
    expect(tr.app.name).toBe('Bakı Təxliyə');
    expect(formatDistance(1530)).toBe('1,5 km');
    expect(formatEta(7)).toBe('7 dəq');
  });
  it('tr, formatting and lazy labels follow the active language', () => {
    useLangStore.setState({ lang: 'en' });
    expect(tr.app.name).toBe('Baku Evacuation');
    expect(formatDistance(1530)).toBe('1.5 km');
    expect(formatEta(7)).toBe('7 min');
    const now = Date.parse('2026-01-01T12:00:00Z');
    expect(timeAgo('2026-01-01T11:57:00Z', now)).toBe('3 min ago');
    // Module-level tables must not have captured the old language.
    expect(SOS_META.fire.label).toBe('Fire');
  });
});
