import { motion } from 'framer-motion';
import { CheckCircle2, Radio, Truck, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { tr } from '@/i18n';
import { SOS_META } from '@/lib/status';
import { cn } from '@/lib/utils';
import type { Sos, SosStatus } from '@/types/api';
import { BrigadeEta } from './BrigadeEta';
import { sosStatusText } from './sosText';

const ORDER = ['new', 'assigned', 'resolved'] as const;
const STEP_ICON = { new: Radio, assigned: Truck, resolved: CheckCircle2 } as const;

export function SosSteps({ status }: { status: SosStatus }) {
  // A rejected SOS (closed during review) is shown as finished.
  const idx = ORDER.indexOf(status === 'rejected' ? 'resolved' : status);
  return (
    <ol className="flex items-center gap-1" aria-label={tr.sosStatus[status]}>
      {ORDER.map((s, i) => {
        const Icon = STEP_ICON[s];
        const done = i <= idx;
        const current = i === idx;
        return (
          <li key={s} className="flex flex-1 items-center gap-1">
            <div className="flex flex-col items-center gap-1">
              <motion.div
                className={cn(
                  'relative grid h-9 w-9 place-items-center rounded-full border-2',
                  done
                    ? 'border-safe bg-safe text-white'
                    : 'border-muted-foreground/30 text-muted-foreground',
                )}
                animate={current && s !== 'resolved' ? { scale: [1, 1.08, 1] } : { scale: 1 }}
                transition={{ repeat: Infinity, duration: 1.4 }}
              >
                <Icon className="h-4 w-4" aria-hidden />
              </motion.div>
              <span
                className={cn(
                  'whitespace-nowrap text-[11px] font-semibold',
                  done ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                {tr.citizen.sos.steps[s]}
              </span>
              {current && <span className="sr-only">●</span>}
            </div>
            {i < ORDER.length - 1 && (
              <div className="mb-5 h-1 flex-1 overflow-hidden rounded-full bg-muted">
                <motion.div
                  className="h-full bg-safe"
                  initial={false}
                  animate={{ width: i < idx ? '100%' : '0%' }}
                  transition={{ duration: 0.6 }}
                />
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** Compact live card on the main screen after an SOS was sent. */
export function SosStatusCard({
  sos,
  onOpen,
  onHide,
}: {
  sos: Sos;
  onOpen: () => void;
  onHide: () => void;
}) {
  const meta = SOS_META[sos.type];
  const Icon = meta.icon;
  return (
    <motion.div
      initial={{ y: -20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: -20, opacity: 0 }}
      className="pointer-events-auto rounded-2xl border-2 border-danger/60 bg-card/95 p-3 shadow-lift backdrop-blur"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={onOpen}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-white"
          style={{ backgroundColor: meta.color }}
          aria-label={meta.label}
        >
          <Icon className="h-6 w-6" aria-hidden />
        </button>
        <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
          <p className="text-sm font-bold">{tr.citizen.sos.received}</p>
          <p className="text-sm text-muted-foreground">{sosStatusText(sos)}</p>
        </button>
        <Button variant="ghost" size="icon" onClick={onHide} aria-label={tr.app.close}>
          <X className="h-5 w-5" aria-hidden />
        </Button>
      </div>
      <div className="mt-3">
        <SosSteps status={sos.status} />
        <BrigadeEta sos={sos} className="mt-3" />
      </div>
    </motion.div>
  );
}
