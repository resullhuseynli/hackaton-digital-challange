import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import azJson from './locales/az.json';
import enJson from './locales/en.json';

export type Lang = 'az' | 'en';
export const LANGS: readonly Lang[] = ['az', 'en'];

/** Shape of a dictionary — derived from az.json, so en.json must provide every key (tsc). */
export type Dict = typeof azJson;
const enDict: Dict = enJson;
const DICTS: Record<Lang, Dict> = { az: azJson, en: enDict };

/** BCP-47 tags used for number/date formatting. */
// Chrome's ICU formats 'az-AZ' as English; the explicit Latin-script tag gives "1,2 km".
const LOCALE_TAGS: Record<Lang, string> = { az: 'az-Latn-AZ', en: 'en-US' };

interface LangState {
  lang: Lang;
  setLang: (lang: Lang) => void;
}

export const useLangStore = create<LangState>()(
  persist(
    (set) => ({
      lang: 'az', // Azerbaijani is the default for everyone
      setLang: (lang) => set({ lang }),
    }),
    { name: 'evac.lang' },
  ),
);

/**
 * The active dictionary. Every property read resolves against the current language, so
 * `tr.app.name` is always up to date. Read it during render (or lazily) — never cache a
 * string in a module-level constant, or it will not switch language.
 */
export const tr: Dict = new Proxy({} as Dict, {
  get: (_target, key) => (DICTS[useLangStore.getState().lang] as Record<PropertyKey, unknown>)[key],
});

export const useLang = () => useLangStore((s) => s.lang);
export const currentLang = () => useLangStore.getState().lang;
export const localeTag = () => LOCALE_TAGS[useLangStore.getState().lang];

type Vars = Record<string, string | number>;

/** Fills `{name}` placeholders: fill(tr.time.minutesAgo, { n: 3 }) → "3 dəq əvvəl". */
export function fill(template: string, vars: Vars): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/** Picks the plural form for `n` in the active language, then fills `{n}` (and `vars`). */
export function plural(forms: { one: string; other: string }, n: number, vars: Vars = {}): string {
  const cat = new Intl.PluralRules(localeTag()).select(n);
  return fill(cat === 'one' ? forms.one : forms.other, { n, ...vars });
}

// Keep <html lang> in sync for screen readers and hyphenation.
if (typeof document !== 'undefined') {
  const apply = (lang: Lang) => document.documentElement.setAttribute('lang', lang);
  apply(useLangStore.getState().lang);
  useLangStore.subscribe((s) => apply(s.lang));
}
