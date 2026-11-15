import { Clock, Truck } from 'lucide-react';
import { useNow } from '@/hooks/useNow';
import { fill, tr } from '@/i18n';
import { formatMmSs } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useCitizenStore } from '@/stores/citizenStore';
import type { Sos } from '@/types/api';

/** "Briqada №7 · Gəlişinə: 4:12" — live countdown from the latest brigade_eta_min. */
export function BrigadeEta({ sos, className }: { sos: Sos; className?: string }) {
  const etaAt = useCitizenStore((s) => s.sosEtaAt);
  const now = useNow(1000);
  if (sos.status !== 'assigned' || sos.assigned_brigade_id == null) return null;
  const left = etaAt != null ? (etaAt - now) / 1000 : null;
  return (
    <p
      className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 text-sm font-semibold', className)}
    >
      <span className="inline-flex items-center gap-1.5">
        <Truck className="h-4 w-4" aria-hidden />
        {fill(tr.citizen.sos.brigade, { id: sos.assigned_brigade_id })}
      </span>
      {left != null && (
        <span className="tabular inline-flex items-center gap-1.5" aria-live="off">
          <Clock className="h-4 w-4" aria-hidden />
          {left > 0
            ? fill(tr.citizen.sos.etaCountdown, { t: formatMmSs(left) })
            : tr.citizen.sos.etaArriving}
        </span>
      )}
    </p>
  );
}
