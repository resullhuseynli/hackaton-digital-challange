import { AnimatePresence, motion } from 'framer-motion';
import { WifiOff } from 'lucide-react';
import { tr } from '@/i18n';

export function OfflineBar({ offline, queued }: { offline: boolean; queued: number }) {
  return (
    <AnimatePresence>
      {offline && (
        <motion.div
          initial={{ y: -48, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -48, opacity: 0 }}
          className="safe-top pointer-events-auto fixed inset-x-0 top-0 z-50 bg-slate-900 text-white shadow-lg dark:bg-slate-100 dark:text-slate-900"
          role="status"
          aria-live="polite"
        >
          <div className="mx-auto flex max-w-xl items-center gap-2 px-4 py-2.5 text-sm font-semibold">
            <WifiOff className="h-4 w-4 shrink-0 text-warning" aria-hidden />
            <span className="flex-1">{tr.citizen.offline.bar}</span>
            {queued > 0 && (
              <span className="rounded-full bg-danger px-2 py-0.5 text-xs text-white">
                SOS · {queued}
              </span>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
