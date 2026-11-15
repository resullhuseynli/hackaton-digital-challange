import { motion } from 'framer-motion';
import { useNow } from '@/hooks/useNow';
import { fill, tr } from '@/i18n';
import { alarm } from '@/lib/alarm';
import { formatMmSs } from '@/lib/format';
import { cn, vibrate } from '@/lib/utils';
import { useCitizenStore } from '@/stores/citizenStore';

/** The big red SOS button (88 px). Disabled with a countdown while the server cooldown runs. */
export function SosFab({ onPress, queued }: { onPress: () => void; queued: number }) {
  const cooldownUntil = useCitizenStore((s) => s.cooldownUntil);
  const now = useNow(1000);
  const left = cooldownUntil ? (cooldownUntil - now) / 1000 : 0;
  const cooling = left > 0;
  const label = cooling
    ? `${tr.citizen.sos.buttonAria}. ${fill(tr.citizen.sos.cooldownLeft, { s: formatMmSs(left) })}`
    : tr.citizen.sos.buttonAria;

  return (
    <motion.button
      type="button"
      disabled={cooling}
      onClick={() => {
        vibrate(60);
        alarm.unlock();
        onPress();
      }}
      whileTap={cooling ? undefined : { scale: 0.92 }}
      className={cn(
        'relative grid h-[88px] w-[88px] place-items-center rounded-full text-white ring-4 ring-white/90 focus-visible:ring-offset-2 dark:ring-slate-900/90',
        cooling
          ? 'cursor-not-allowed bg-slate-600'
          : 'bg-danger shadow-[0_10px_30px_-6px_rgba(220,38,38,0.8)]',
      )}
      aria-label={label}
    >
      {!cooling && (
        <span
          className="absolute inset-0 animate-pulse-ring rounded-full bg-danger/50"
          aria-hidden
        />
      )}
      <span className="relative flex flex-col items-center leading-none" aria-hidden>
        <span className={cn('font-black tracking-wider', cooling ? 'text-lg' : 'text-2xl')}>
          {tr.citizen.sos.button}
        </span>
        {cooling && <span className="tabular mt-1 text-sm font-bold">{formatMmSs(left)}</span>}
      </span>
      {queued > 0 && (
        <span className="absolute -right-1 -top-1 grid h-7 min-w-7 place-items-center rounded-full bg-warning px-1 text-xs font-bold text-slate-950">
          {queued}
        </span>
      )}
    </motion.button>
  );
}
