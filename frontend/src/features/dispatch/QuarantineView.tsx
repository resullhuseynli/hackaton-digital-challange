import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Ban, CheckCircle2, Loader2, ShieldQuestion } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { dispatchApi } from '@/api/endpoints';
import { qk } from '@/api/queryKeys';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorState, ListSkeleton } from '@/components/ui/states';
import { fill, tr } from '@/i18n';
import { actionErrorToast } from '@/lib/actionError';
import { timeAgo } from '@/lib/format';
import { SOS_META } from '@/lib/status';
import { cn } from '@/lib/utils';
import { usePermissions } from '@/stores/authStore';
import { useDispatchStore } from '@/stores/dispatchStore';
import type { Id, Overview, Sos } from '@/types/api';
import { LabelList } from './LabelBadge';
import { useSuspectedSos } from './queries';

/**
 * Quarantine: SOS from new devices flagged as possible spam. They are hidden from the main queue
 * until a dispatcher marks them genuine (released into the queue) or spam (rejected).
 */
export function QuarantineView() {
  const qc = useQueryClient();
  const q = useSuspectedSos();
  const { write } = usePermissions();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const list = useMemo(() => q.data ?? [], [q.data]);
  const ids = list.map((s) => String(s.id));
  const selected = ids.filter((id) => picked.has(id));
  const all = ids.length > 0 && selected.length === ids.length;

  const review = useMutation({
    mutationFn: (verdict: 'genuine' | 'spam') =>
      dispatchApi.reviewSos(
        list.filter((s) => picked.has(String(s.id))).map((s) => s.id as Id),
        verdict,
      ),
    onSuccess: (r, verdict) => {
      const done = new Set(selected);
      const keep = (old: Sos[] | undefined) => old?.filter((s) => !done.has(String(s.id)));
      // Spam leaves both lists; genuine leaves quarantine and arrives in the queue (refetch).
      qc.setQueryData<Sos[]>(qk.suspected, keep);
      if (verdict === 'spam') qc.setQueryData<Sos[]>(qk.sos, keep);
      void qc.invalidateQueries({ queryKey: qk.sos, exact: true });
      void qc.invalidateQueries({ queryKey: qk.alerts });
      void qc.invalidateQueries({ queryKey: qk.overview });
      qc.setQueryData<Overview>(qk.overview, (o) =>
        o ? { ...o, suspected_sos: Math.max(0, (o.suspected_sos ?? 0) - r.updated) } : o,
      );
      setPicked(new Set());
      const text =
        verdict === 'genuine'
          ? fill(tr.quarantine.releasedN, { n: r.updated })
          : fill(tr.quarantine.rejectedN, { n: r.updated });
      const firstAlert = r.alert_ids[0];
      toast.success(text, {
        description: r.alert_ids.length
          ? fill(tr.quarantine.alertsRaised, { n: r.alert_ids.length })
          : undefined,
        action:
          firstAlert != null
            ? {
                label: tr.alert.title,
                onClick: () => useDispatchStore.getState().openAlert(firstAlert),
              }
            : undefined,
      });
    },
    onError: (e) => actionErrorToast(e, tr.quarantine.error),
  });

  if (q.isLoading) return <ListSkeleton rows={4} />;
  if (q.isError && !q.data) {
    return <ErrorState title={tr.quarantine.error} error={q.error} onRetry={() => q.refetch()} />;
  }
  if (!list.length) {
    return (
      <EmptyState
        title={tr.quarantine.empty}
        icon={<ShieldQuestion className="h-6 w-6" aria-hidden />}
      />
    );
  }

  const toggle = (id: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const readOnly = write ? undefined : tr.rbac.readOnly;
  const disabled = !write || !selected.length || review.isPending;

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">{tr.quarantine.hint}</p>
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-xl border bg-card/95 p-2 backdrop-blur">
        <label className="flex items-center gap-2 text-xs font-semibold">
          <input
            type="checkbox"
            className="h-4 w-4 accent-primary"
            checked={all}
            onChange={() => setPicked(all ? new Set() : new Set(ids))}
          />
          {fill(tr.quarantine.selected, { n: selected.length, total: ids.length })}
        </label>
        <div className="ml-auto flex gap-1.5">
          <Button
            size="sm"
            variant="safe"
            className="h-8"
            disabled={disabled}
            title={readOnly}
            onClick={() => review.mutate('genuine')}
          >
            {review.isPending && review.variables === 'genuine' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
            )}
            {tr.quarantine.genuine}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 border-danger/50 text-red-300"
            disabled={disabled}
            title={readOnly}
            onClick={() => review.mutate('spam')}
          >
            {review.isPending && review.variables === 'spam' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Ban className="h-3.5 w-3.5" aria-hidden />
            )}
            {tr.quarantine.spam}
          </Button>
        </div>
      </div>
      <ul className="flex flex-col gap-1.5" aria-label={tr.quarantine.title}>
        {list.map((s) => {
          const id = String(s.id);
          const meta = SOS_META[s.type];
          const Icon = meta.icon;
          const on = picked.has(id);
          return (
            <li
              key={id}
              className={cn(
                'flex items-start gap-2 rounded-xl border bg-background/40 p-2.5',
                on && 'border-primary/60 bg-primary/5',
              )}
            >
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 shrink-0 accent-primary"
                checked={on}
                onChange={() => toggle(id)}
                aria-label={`${meta.label} #${id}`}
              />
              <Icon className="mt-0.5 h-4 w-4 shrink-0" style={{ color: meta.color }} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-x-2 text-sm font-semibold">
                  {meta.label} <span className="tabular text-muted-foreground">#{id}</span>
                  <span className="text-xs font-normal text-muted-foreground">
                    {timeAgo(s.created_at)}
                  </span>
                </p>
                <p className="text-xs text-amber-300">
                  {s.suspicion_reason
                    ? tr.quarantine.reason[s.suspicion_reason]
                    : tr.quarantine.reasonUnknown}
                </p>
                <div className="mt-1">
                  <LabelList labels={s.labels} size="sm" />
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
