import { create } from 'zustand';

interface AnnounceState {
  polite: { text: string; n: number };
  assertive: { text: string; n: number };
}

export const useAnnounceStore = create<AnnounceState>(() => ({
  polite: { text: '', n: 0 },
  assertive: { text: '', n: 0 },
}));

/**
 * Speaks a message through the page-wide live region (<LiveAnnouncer/>). Use 'assertive' for
 * urgent changes (reroutes, SOS status) and 'polite' for everything else.
 */
export function announce(text: string, mode: 'polite' | 'assertive' = 'polite') {
  useAnnounceStore.setState((s) => ({ [mode]: { text, n: s[mode].n + 1 } }));
}
