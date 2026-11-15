import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Clock, Loader2 } from 'lucide-react';
import { useMemo } from 'react';
import { toast } from 'sonner';
import { dispatchApi } from '@/api/endpoints';
import { qk } from '@/api/queryKeys';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { EmptyState, ErrorState, ListSkeleton } from '@/components/ui/states';
import { tr } from '@/i18n';
import { formatEta } from '@/lib/format';
import { estimateEta } from '@/lib/eta';
import { BRIGADE_META, SOS_META } from '@/lib/status';
import { sameId } from '@/lib/utils';
import type { Brigade, BrigadeType, Sos } from '@/types/api';
import { useBrigades } from './queries';
import { actionErrorToast } from '@/lib/actionError';
import { usePermissions } from '@/stores/authStore';

const PREFERRED: Record<Sos['type'], BrigadeType> = {
  fire: 'fire',
  medical: 'medical',
  collapse: 'rescue',
  flood: 'rescue',
};

export function AssignDialog({ sos, onClose }: { sos: Sos | null; onClose: () => void }) {
  const { write } = usePermissions();
  const brigades = useBrigades();
  const qc = useQueryClient();
  const idle = useMemo(() => {
    if (!sos) return [];
    return (brigades.data ?? [])
      .filter((b) => b.status === 'idle')
      .map((b) => ({ b, eta: estimateEta(b, sos), match: b.type === PREFERRED[sos.type] }))
      .sort((a, b) => Number(b.match) - Number(a.match) || a.eta - b.eta);
  }, [brigades.data, sos]);

  const assign = useMutation({
    mutationFn: (b: Brigade) => dispatchApi.assignBrigade(b.id, sos!.id),
    onSuccess: (brigade, b) => {
      qc.setQueryData<Brigade[]>(qk.brigades, (old) =>
        old?.map((x) => (sameId(x.id, b.id) ? { ...x, ...brigade } : x)),
      );
      qc.setQueryData<Sos[]>(qk.sos, (old) =>
        old?.map((s) =>
          sameId(s.id, sos!.id) && s.status === 'new'
            ? { ...s, status: 'assigned', assigned_brigade_id: b.id }
            : s,
        ),
      );
      toast.success(tr.dispatch.assign.success, { description: b.name });
      onClose();
    },
    onError: (e) => actionErrorToast(e, tr.dispatch.assign.error),
  });

  const meta = sos ? SOS_META[sos.type] : null;

  return (
    <Dialog open={sos != null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{tr.dispatch.assign.title}</DialogTitle>
          <DialogDescription>
            {meta?.label} #{String(sos?.id ?? '').slice(-5)} · {tr.dispatch.assign.subtitle}
          </DialogDescription>
        </DialogHeader>
        {brigades.isLoading ? (
          <ListSkeleton rows={3} />
        ) : brigades.isError ? (
          <ErrorState
            title={tr.dispatch.brigades.error}
            error={brigades.error}
            onRetry={() => brigades.refetch()}
          />
        ) : idle.length === 0 ? (
          <EmptyState title={tr.dispatch.assign.empty} />
        ) : (
          <ul className="flex max-h-[50vh] flex-col gap-2 overflow-y-auto">
            {idle.map(({ b, eta, match }) => {
              const m = BRIGADE_META[b.type];
              const Icon = m.icon;
              const pending = assign.isPending && sameId(assign.variables?.id, b.id);
              return (
                <li key={String(b.id)} className="flex items-center gap-3 rounded-xl border p-2.5">
                  <span
                    className="grid h-10 w-10 place-items-center rounded-lg text-white"
                    style={{ backgroundColor: m.color }}
                  >
                    <Icon className="h-5 w-5" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{b.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {m.label}
                      {match && ' · ✓'}
                    </p>
                  </div>
                  <span className="tabular inline-flex items-center gap-1 text-sm font-semibold">
                    <Clock className="h-4 w-4 text-muted-foreground" aria-hidden />
                    {formatEta(eta)}
                  </span>
                  <Button
                    size="sm"
                    onClick={() => assign.mutate(b)}
                    disabled={assign.isPending || !write}
                    title={write ? undefined : tr.rbac.readOnly}
                  >
                    {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                    {tr.dispatch.assign.action}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
