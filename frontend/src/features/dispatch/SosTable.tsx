import { CheckCheck, Loader2, MapPin, Truck } from 'lucide-react';
import { memo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorState, ListSkeleton } from '@/components/ui/states';
import { useNow } from '@/hooks/useNow';
import { plural, tr } from '@/i18n';
import { timeAgo } from '@/lib/format';
import { SOS_META, SOS_STATUS_VARIANT, priorityLevel, priorityValue } from '@/lib/status';
import { isMiSos } from '@/lib/sosOrder';
import { cn } from '@/lib/utils';
import { useDispatchStore } from '@/stores/dispatchStore';
import type { Brigade, Sos } from '@/types/api';
import { AssignDialog } from './AssignDialog';
import { LabelList, PriorityOneMarker } from './LabelBadge';
import { SosFilterBar } from './SosFilterBar';
import { useResolveSos, useShowOnMap } from './useDispatchActions';
import { useFilteredSos } from './useFilteredSos';
import { usePermissions } from '@/stores/authStore';

/** Full-width SOS table for the dedicated SOS page. */
export function SosTable() {
  const { sos, rows, zoneById, brigadeById } = useFilteredSos();
  const highlight = useDispatchStore((s) => s.highlightSosIds);
  const [assignFor, setAssignFor] = useState<Sos | null>(null);
  const now = useNow(10_000);
  const c = tr.pages.col;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex items-center justify-between gap-3 rounded-2xl border bg-card p-3">
        <SosFilterBar wide />
        <Badge variant="neutral" className="tabular shrink-0">
          {plural(tr.dispatch.feed.count, rows.length)}
        </Badge>
      </div>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-auto rounded-2xl border bg-card">
        {sos.isLoading ? (
          <ListSkeleton rows={8} className="p-3" />
        ) : sos.isError && !sos.data ? (
          <ErrorState
            title={tr.dispatch.feed.error}
            error={sos.error}
            onRetry={() => sos.refetch()}
          />
        ) : rows.length === 0 ? (
          <EmptyState title={tr.dispatch.feed.empty} />
        ) : (
          <table className="w-full text-sm">
            <caption className="sr-only">{tr.nav.sos}</caption>
            <thead className="sticky top-0 z-10 bg-muted/80 text-left text-xs uppercase tracking-wide text-muted-foreground backdrop-blur">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">
                  {c.type}
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  {c.zone}
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  {c.time}
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  {c.priority}
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  {c.status}
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  {c.brigade}
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  {c.note}
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  {c.actions}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <SosTableRow
                  key={String(s.id)}
                  sos={s}
                  zone={zoneById.get(String(s.zone_id))?.name ?? '—'}
                  brigade={
                    s.assigned_brigade_id != null
                      ? brigadeById.get(String(s.assigned_brigade_id))
                      : undefined
                  }
                  now={now}
                  highlighted={highlight.includes(String(s.id))}
                  onAssign={setAssignFor}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>
      <AssignDialog sos={assignFor} onClose={() => setAssignFor(null)} />
    </div>
  );
}

const SosTableRow = memo(function SosTableRow({
  sos,
  zone,
  brigade,
  now,
  highlighted,
  onAssign,
}: {
  sos: Sos;
  zone: string;
  brigade: Brigade | undefined;
  now: number;
  highlighted: boolean;
  onAssign: (s: Sos) => void;
}) {
  const meta = SOS_META[sos.type];
  const Icon = meta.icon;
  const resolve = useResolveSos(sos);
  const { write } = usePermissions();
  const readOnly = write ? undefined : tr.rbac.readOnly;
  const showOnMap = useShowOnMap();
  const mi = isMiSos(sos);

  return (
    <tr
      className={cn(
        'border-t align-middle hover:bg-accent/40',
        mi && 'bg-violet-600/10 shadow-[inset_6px_0_0_0_rgb(139_92_246)]',
        highlighted && 'animate-row-flash',
      )}
    >
      <td className="px-4 py-2.5">
        <div className="flex flex-col gap-1">
          {(mi || sos.labels?.length > 0) && (
            <span className="flex flex-wrap items-center gap-1">
              {mi && <PriorityOneMarker />}
              <LabelList labels={sos.labels} size="sm" />
            </span>
          )}
          <span className="inline-flex items-center gap-2 font-medium">
            <span
              className="grid h-7 w-7 place-items-center rounded-md text-white"
              style={{ backgroundColor: meta.color }}
            >
              <Icon className="h-4 w-4" aria-hidden />
            </span>
            {meta.label}
            <span className="tabular text-xs text-muted-foreground">
              #{String(sos.id).slice(-5)}
            </span>
          </span>
        </div>
      </td>
      <td className="px-4 py-2.5">{zone}</td>
      <td className="whitespace-nowrap px-4 py-2.5 text-muted-foreground">
        {timeAgo(sos.created_at, now)}
      </td>
      <td className="px-4 py-2.5">
        <Badge variant={priorityLevel(sos.priority_score)} className="tabular">
          P{priorityValue(sos.priority_score)}
        </Badge>
      </td>
      <td className="px-4 py-2.5">
        <Badge variant={SOS_STATUS_VARIANT[sos.status]}>{tr.sosStatus[sos.status]}</Badge>
      </td>
      <td className="px-4 py-2.5 text-muted-foreground">
        {brigade ? (
          <span>
            {brigade.name}
            {sos.brigade_eta_min != null && sos.status !== 'resolved' && (
              <span className="tabular">
                {' '}
                · {Math.round(sos.brigade_eta_min)} {tr.units.min}
              </span>
            )}
          </span>
        ) : (
          '—'
        )}
      </td>
      <td
        className="max-w-[260px] truncate px-4 py-2.5 italic text-muted-foreground"
        title={sos.note ?? undefined}
      >
        {sos.note ?? '—'}
      </td>
      <td className="px-4 py-2.5">
        <div className="flex justify-end gap-1.5">
          {sos.status === 'new' && (
            <Button
              size="sm"
              className="h-8"
              onClick={() => onAssign(sos)}
              disabled={!write}
              title={readOnly}
            >
              <Truck className="h-3.5 w-3.5" aria-hidden />
              {tr.dispatch.feed.assign}
            </Button>
          )}
          {sos.status !== 'resolved' && sos.status !== 'rejected' && (
            <Button
              size="sm"
              variant="outline"
              className="h-8"
              onClick={() => resolve.mutate()}
              disabled={resolve.isPending || !write}
              title={readOnly}
            >
              {resolve.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <CheckCheck className="h-3.5 w-3.5" aria-hidden />
              )}
              {tr.dispatch.feed.resolve}
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="h-8"
            onClick={() => showOnMap({ kind: 'sos', id: sos.id }, sos, 15)}
            aria-label={tr.nav.showOnMap}
          >
            <MapPin className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      </td>
    </tr>
  );
});
