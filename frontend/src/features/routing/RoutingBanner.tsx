import { AnimatePresence, motion } from 'framer-motion';
import { CloudOff } from 'lucide-react';
import { useLayoutEffect, useRef } from 'react';
import { HEADER_H } from '@/features/citizen/citizenContext';
import { tr } from '@/i18n';
import { useRoutingStore } from '@/stores/routingStore';

/**
 * Persistent, non-blocking banner under the citizen header while routing runs on the local
 * backup. Amber (the service still works), announced once politely. Its height is published
 * to the routing store so map overlays and tab pages move down instead of being covered.
 */
export function RoutingBanner() {
  const fallback = useRoutingStore((s) => s.status === 'fallback');
  const notice = useRoutingStore((s) => s.notice);
  const setBannerH = useRoutingStore((s) => s.setBannerH);
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!fallback || !el) {
      setBannerH(0);
      return;
    }
    const ro = new ResizeObserver(() => setBannerH(el.offsetHeight));
    ro.observe(el);
    setBannerH(el.offsetHeight);
    return () => {
      ro.disconnect();
      setBannerH(0);
    };
  }, [fallback, setBannerH]);

  return (
    // The live region stays mounted so the text change is announced (once) when it appears.
    <div
      role="status"
      aria-live="polite"
      className="safe-top pointer-events-none fixed inset-x-0 top-0 z-[45]"
      style={{ paddingTop: HEADER_H }}
    >
      <AnimatePresence>
        {fallback && (
          <motion.div
            ref={ref}
            key="routing-fallback"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="border-b border-amber-500/50 bg-amber-100 text-amber-950 shadow-sm dark:bg-amber-950 dark:text-amber-100"
          >
            <div className="mx-auto flex max-w-xl items-start gap-2 px-4 py-2">
              <CloudOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <div className="min-w-0 text-sm leading-snug">
                <p className="font-semibold">{notice?.text ?? tr.routing.fallback}</p>
                <p className="text-xs opacity-80">{tr.routing.fallbackDetail}</p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
