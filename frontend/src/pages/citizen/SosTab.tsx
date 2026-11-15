import { useQuery } from '@tanstack/react-query';
import { CloudOff, History, Radio, ShieldAlert } from 'lucide-react';
import { citizenApi } from '@/api/endpoints';
import { qk } from '@/api/queryKeys';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorState, ListSkeleton } from '@/components/ui/states';
import { BrigadeEta } from '@/features/citizen/BrigadeEta';
import { SosSteps } from '@/features/citizen/SosStatus';
import { sosStatusText } from '@/features/citizen/sosText';
import { useNow } from '@/hooks/useNow';
import { fill, tr } from '@/i18n';
import { formatMmSs, timeAgo } from '@/lib/format';
import { SOS_META, SOS_STATUS_VARIANT } from '@/lib/status';
import { sameId } from '@/lib/utils';
import { useCitizenStore } from '@/stores/citizenStore';
import { TabPage } from './TabPage';

/** The citizen's SOS: live status of the current one, the offline queue and history. */
export default function SosTab() {
  const activeSos = useCitizenStore((s) => s.activeSos);
  const queue = useCitizenStore((s) => s.sosQueue);
  const cooldownUntil = useCitizenStore((s) => s.cooldownUntil);
  const now = useNow(1000);
  const history = useQuery({ queryKey: qk.mySos, queryFn: citizenApi.mySos, staleTime: 10_000 });

  const past = (history.data ?? [])
    .filter((s) => !sameId(s.id, activeSos?.id))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const cooldownLeft = cooldownUntil ? (cooldownUntil - now) / 1000 : 0;

  return (
    <TabPage icon={Radio} title={tr.citizen.sosTab.title} subtitle={tr.citizen.sosTab.subtitle}>
      <Button
        variant="danger"
        size="xl"
        className="h-16 w-full text-xl font-black"
        onClick={() => useCitizenStore.getState().setSosOpen(true)}
      >
        <ShieldAlert className="h-7 w-7" aria-hidden />
        {tr.citizen.sosTab.send}
      </Button>
      {cooldownLeft > 0 && (
        <p className="tabular -mt-2 text-center text-sm text-muted-foreground" aria-live="polite">
          {fill(tr.citizen.sosTab.cooldown, { s: formatMmSs(cooldownLeft) })}
        </p>
      )}

      {queue.length > 0 && (
        <section
          className="rounded-2xl border border-warning/50 bg-warning/10 p-4"
          aria-labelledby="q-title"
        >
          <h3 id="q-title" className="flex items-center gap-2 font-bold">
            <CloudOff className="h-5 w-5 text-amber-600" aria-hidden />
            {tr.citizen.sosTab.queued}
            <Badge variant="warning">{queue.length}</Badge>
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">{tr.citizen.sosTab.queuedHint}</p>
          <ul className="mt-3 flex flex-col gap-2">
            {queue.map((q) => {
              const m = SOS_META[q.type];
              const Icon = m.icon;
              return (
                <li key={q.localId} className="flex items-center gap-2 text-sm">
                  <Icon className="h-4 w-4" style={{ color: m.color }} aria-hidden />
                  <span className="font-medium">{m.label}</span>
                  <span className="text-muted-foreground">
                    · {timeAgo(new Date(q.queuedAt).toISOString(), now)}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {activeSos && (
        <section
          className="rounded-2xl border-2 border-danger/50 bg-card p-4"
          aria-labelledby="cur-title"
        >
          <h3
            id="cur-title"
            className="mb-3 text-sm font-bold uppercase tracking-wide text-muted-foreground"
          >
            {tr.citizen.sosTab.current}
          </h3>
          <div className="flex items-start gap-3">
            {(() => {
              const m = SOS_META[activeSos.type];
              const Icon = m.icon;
              return (
                <span
                  className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-white"
                  style={{ backgroundColor: m.color }}
                >
                  <Icon className="h-6 w-6" aria-hidden />
                </span>
              );
            })()}
            <div className="min-w-0 flex-1">
              <p className="font-bold">{SOS_META[activeSos.type].label}</p>
              <p className="text-sm text-muted-foreground" aria-live="polite">
                {sosStatusText(activeSos)}
              </p>
              <p className="text-xs text-muted-foreground">{timeAgo(activeSos.created_at, now)}</p>
            </div>
          </div>
          <div className="mt-4">
            <SosSteps status={activeSos.status} />
            <BrigadeEta sos={activeSos} className="mt-3" />
          </div>
        </section>
      )}

      <section aria-labelledby="hist-title">
        <h3 id="hist-title" className="mb-2 flex items-center gap-2 font-bold">
          <History className="h-5 w-5 text-muted-foreground" aria-hidden />
          {tr.citizen.sosTab.history}
        </h3>
        {history.isLoading ? (
          <ListSkeleton rows={2} />
        ) : history.isError && !history.data ? (
          <ErrorState
            compact
            title={tr.citizen.sosTab.error}
            error={history.error}
            onRetry={() => history.refetch()}
          />
        ) : past.length === 0 && !activeSos ? (
          <EmptyState
            title={tr.citizen.sosTab.empty}
            hint={tr.citizen.sosTab.emptyHint}
            className="rounded-2xl border bg-card"
          />
        ) : past.length === 0 ? null : (
          <ul className="flex flex-col gap-2">
            {past.map((s) => {
              const m = SOS_META[s.type];
              const Icon = m.icon;
              return (
                <li
                  key={String(s.id)}
                  className="flex items-center gap-3 rounded-2xl border bg-card p-3"
                >
                  <span
                    className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-white"
                    style={{ backgroundColor: m.color }}
                  >
                    <Icon className="h-5 w-5" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{m.label}</p>
                    <p className="text-xs text-muted-foreground">{timeAgo(s.created_at, now)}</p>
                  </div>
                  <Badge variant={SOS_STATUS_VARIANT[s.status]}>{tr.sosStatus[s.status]}</Badge>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </TabPage>
  );
}
