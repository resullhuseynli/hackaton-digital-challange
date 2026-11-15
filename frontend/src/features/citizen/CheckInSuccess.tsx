import { AnimatePresence, motion } from 'framer-motion';
import { ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { tr } from '@/i18n';
import type { AssemblyPoint } from '@/types/api';

export function CheckInSuccess({
  point,
  onClose,
}: {
  point: AssemblyPoint | null;
  onClose: () => void;
}) {
  return (
    <AnimatePresence>
      {point && (
        <motion.div
          className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-6 bg-safe p-8 text-center text-white"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="checkin-title"
        >
          <motion.div
            initial={{ scale: 0, rotate: -30 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: 'spring', stiffness: 200, damping: 12, delay: 0.1 }}
            className="relative grid h-32 w-32 place-items-center rounded-full bg-white text-safe shadow-2xl"
          >
            <span
              className="absolute inset-0 animate-pulse-ring rounded-full border-4 border-white"
              aria-hidden
            />
            <ShieldCheck className="h-16 w-16" aria-hidden />
          </motion.div>
          <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.3 }}
          >
            <h1 id="checkin-title" className="text-3xl font-extrabold leading-tight">
              {tr.citizen.checkIn.title}
            </h1>
            <p className="mt-2 text-lg font-semibold opacity-95">{point.name}</p>
            <p className="mx-auto mt-4 max-w-sm text-base opacity-90">
              {tr.citizen.checkIn.subtitle}
            </p>
          </motion.div>
          <Button
            size="xl"
            onClick={onClose}
            className="w-full max-w-xs bg-white text-safe hover:bg-white/90"
            autoFocus
          >
            {tr.citizen.checkIn.done}
          </Button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
