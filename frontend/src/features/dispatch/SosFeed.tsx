import { AnimatePresence, motion } from 'framer-motion';
import { CheckCheck, ExternalLink, Loader2, Truck } from 'lucide-react';
import { memo, useRef, useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorState, ListSkeleton } from '@/components/ui/states';
import { useNow } from '@/hooks/useNow';
import { fill, plural, tr } from '@/i18n';
import { timeAgo } from '@/lib/format';
import { SOS_META, SOS_STATUS_VARIANT, priorityLevel, priorityValue } from '@/lib/status';
import { isMiSos } from '@/lib/sosOrder';
import { cn, sameId } from '@/lib/utils';
import { useDispatchStore } from '@/stores/dispatchStore';
import type { Brigade, Sos } from '@/types/api';
import { AssignDialog } from './AssignDialog';
import { LabelList, PriorityOneMarker } from './LabelBadge';
import { SosFilterBar } from './SosFilterBar';
import { useResolveSos } from './useDispatchActions';
import { useFilteredSos } from './useFilteredSos';
import { usePermissions } from '@/stores/authStore';

/** Compact SOS feed beside the map. The full table lives on the SOS page. */
export function SosFeed() {
  const { sos, rows, zoneById, brigadeById } = useFilteredSos();
  const highlight = useDispatchStore((s) => s.highlightSosIds);
  const selection = useDispatchStore((s) => s.selection);
  const [assignFor, setAssignFor] = useState<Sos | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const now = useNow(10_000);

  // Arrow-key navigation between rows.
  const onKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const items = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[data-row]') ?? []);
    const i = items.indexOf(document.activeElement as HTMLElement);
    const next =
      items[Math.max(0, Math.min(items.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
    if (next) {
      e.preventDefault();
      next.focus();
    }
  };

  return (
    <section
      className="flex h-full min-h-0 flex-col rounded-2xl border bg-card"
      aria-labelledby="feed-title"
    >
      <header className="flex flex-col gap-2 border-b p-3">
        <div className="flex items-center justify-between gap-2">
          <h2 id="feed-title" className="font-bold">
            {tr.dispatch.feed.title}
          </h2>
          <div className="flex items-center gap-1.5">
            <Badge variant="neutral" className="tabular">
              {plural(tr.dispatch.feed.count, rows.length)}
            </Badge>
            <Button asChild variant="ghost" size="sm" className="h-7 px-2">
              <Link to="/dispatcher/sos" aria-label={tr.nav.openTable}>
                <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              </Link>
            </Button>
          </div>
        </div>
        <SosFilterBar />
      </header>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-2">
        {sos.isLoading ? (
          <ListSkeleton rows={6} />
        ) : sos.isError && !sos.data ? (
          <ErrorState
            title={tr.dispatch.feed.error}
            error={sos.error}
            onRetry={() => sos.refetch()}
          />
        ) : rows.length === 0 ? (
          <EmptyState title={tr.dispatch.feed.empty} />
        ) : (
          <ul
            ref={listRef}
            className="flex flex-col gap-1.5"
            onKeyDown={onKeyDown}
            aria-label={tr.dispatch.feed.title}
          >
            <AnimatePresence initial={false}>
              {rows.map((s) => (
                <SosRow
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
                  selected={selection?.kind === 'sos' && sameId(selection.id, s.id)}
                  onAssign={setAssignFor}
                />
              ))}
            </AnimatePresence>
          </ul>
        )}
      </div>
      <AssignDialog sos={assignFor} onClose={() => setAssignFor(null)} />
    </section>
  );
}

const SosRow = memo(function SosRow({
  sos,
  zone,
  brigade,
  now,
  highlighted,
  selected,
  onAssign,
}: {
  sos: Sos;
  zone: string;
  brigade: Brigade | undefined;
  now: number;
  highlighted: boolean;
  selected: boolean;
  onAssign: (s: Sos) => void;
}) {
  const meta = SOS_META[sos.type];
  const Icon = meta.icon;
  const level = priorityLevel(sos.priority_score);
  const resolve = useResolveSos(sos);
  const { write } = usePermissions();
  const readOnly = write ? undefined : tr.rbac.readOnly;
  const mi = isMiSos(sos);

  // On the map page the map is already visible: just select and fly.
  const focusOnMap = () => {
    const st = useDispatchStore.getState();
    st.select({ kind: 'sos', id: sos.id });
    st.focusOn(sos, 15);
  };

  return (
    <motion.li
      layout="position"
      initial={{ opacity: 0, x: -24 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.25 }}
      className={cn(
        'rounded-xl border bg-background/40',
        // ♿ priority #1: coloured left border + tinted row (never colour alone: badge + marker too).
        mi && 'border-l-[6px] border-l-violet-500 bg-violet-600/10',
        highlighted && 'animate-row-flash border-danger/60',
        selected && 'border-primary ring-1 ring-primary',
      )}
    >
      <div
        role="button"
        tabIndex={0}
        data-row
        onClick={focusOnMap}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            focusOnMap();
          }
        }}
        className="flex cursor-pointer items-start gap-2.5 rounded-xl p-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`${mi ? `${tr.a11y.priority1}, ${tr.a11y.mobilityImpaired}, ` : ''}${meta.label}, ${zone}, ${tr.sosStatus[sos.status]}`}
      >
        <span
          className="relative grid h-9 w-9 shrink-0 place-items-center rounded-lg text-white"
          style={{ backgroundColor: meta.color }}
        >
          {sos.status === 'new' && (
            <span
              className="absolute inset-0 animate-pulse-ring rounded-lg"
              style={{ backgroundColor: meta.color }}
              aria-hidden
            />
          )}
          <Icon className="relative h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          {(mi || sos.labels?.length > 0) && (
            <div className="mb-1 flex flex-wrap items-center gap-1">
              {mi && <PriorityOneMarker />}
              <LabelList labels={sos.labels} size="sm" />
            </div>
          )}
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-sm font-semibold">
              {meta.label} · {zone}
            </p>
            <Badge variant={level} className="tabular shrink-0" title={tr.dispatch.feed.priority}>
              P{priorityValue(sos.priority_score)}
            </Badge>
          </div>
          <div className="mt-0.5 flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>{timeAgo(sos.created_at, now)}</span>
            <Badge variant={SOS_STATUS_VARIANT[sos.status]}>{tr.sosStatus[sos.status]}</Badge>
          </div>
          {brigade && sos.status !== 'resolved' && (
            <p className="mt-1 truncate text-xs text-muted-foreground">
              <Truck className="mr-1 inline h-3 w-3" aria-hidden />
              {fill(tr.dispatch.feed.assignedTo, { name: brigade.name })}
              {sos.brigade_eta_min != null && ` · ${sos.brigade_eta_min} ${tr.units.min}`}
            </p>
          )}
          {sos.note && (
            <p className="mt-1 line-clamp-1 text-xs italic text-muted-foreground">“{sos.note}”</p>
          )}
        </div>
      </div>
      {sos.status !== 'resolved' && sos.status !== 'rejected' && (
        <div className="flex gap-1.5 px-2.5 pb-2.5">
          {sos.status === 'new' && (
            <Button
              size="sm"
              className="h-8 flex-1"
              onClick={() => onAssign(sos)}
              disabled={!write}
              title={readOnly}
            >
              <Truck className="h-3.5 w-3.5" aria-hidden />
              {tr.dispatch.feed.assign}
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            className="h-8 flex-1"
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
        </div>
      )}
    </motion.li>
  );
});
