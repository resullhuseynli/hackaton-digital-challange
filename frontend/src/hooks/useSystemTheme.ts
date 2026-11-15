import { useEffect, useState } from 'react';

const query = '(prefers-color-scheme: dark)';

/** Follows the OS colour scheme and keeps the <html> `dark` class in sync. */
export function useSystemTheme(): 'light' | 'dark' {
  const [dark, setDark] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = (e: MediaQueryListEvent) => setDark(e.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);
  return dark ? 'dark' : 'light';
}

/** Forces dark mode while mounted (dispatcher command center). */
export function useForceDark() {
  useEffect(() => {
    const el = document.documentElement;
    const had = el.classList.contains('dark');
    el.classList.add('dark');
    return () => {
      if (!had) el.classList.remove('dark');
    };
  }, []);
}
