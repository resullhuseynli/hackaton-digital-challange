import { useMutation } from '@tanstack/react-query';
import { CheckCircle2, Clock, Loader2, ServerCrash } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { simApi } from '@/api/endpoints';
import { ApiError, errorMessage } from '@/api/http';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/misc';
import { fill, tr } from '@/i18n';
import { formatClock } from '@/lib/format';
import { useDispatchStore } from '@/stores/dispatchStore';
import { useRoutingStore } from '@/stores/routingStore';
import type { RoutingFaultMode } from '@/types/api';
import { routingLogText } from './useRoutingStatus';

/**
 * Simulation card "External routing API": break or repair the mock provider for drills
 * (POST /sim/routing-fault), show the resulting routing mode and the transition log.
 */
export function RoutingFaultCard() {
  const [delay, setDelay] = useState(8);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const status = useRoutingStore((s) => s.status);
  const breaker = useRoutingStore((s) => s.breaker);
  const log = useRoutingStore((s) => s.log);

  const fault = useMutation({
    mutationFn: (mode: RoutingFaultMode) =>
      simApi.routingFault(mode === 'timeout' ? { mode, delay_sec: delay } : { mode }),
    onSuccess: (r, mode) => {
      useRoutingStore.getState().apply(r.routing);
      const text = fill(tr.sim.routingDone, { mode });
      useDispatchStore.getState().setSimResult(text);
      toast.success(tr.sim.done, { description: text });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'ROUTING_FAULT_UNAVAILABLE') {
        setUnavailable(e.message);
        return;
      }
      toast.error(tr.sim.error, { description: errorMessage(e) });
    },
  });

  const disabled = unavailable != null || fault.isPending;
  const pending = fault.isPending ? fault.variables : null;
  const spin = (m: RoutingFaultMode) =>
    pending === m ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null;

  return (
    <section
      className="flex flex-col gap-2 rounded-xl border bg-background/40 p-3"
      aria-labelledby="routing-api-title"
      aria-disabled={unavailable != null || undefined}
    >
      <h3
        id="routing-api-title"
        className="text-xs font-bold uppercase tracking-wider text-muted-foreground"
      >
        {tr.sim.routingApi}
      </h3>
      {unavailable && (
        <p
          role="alert"
          className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-2 text-xs"
        >
          {unavailable}
        </p>
      )}
      <div className="grid grid-cols-2 gap-1.5">
        <Button
          size="sm"
          variant="outline"
          className="h-10"
          disabled={disabled}
          onClick={() => fault.mutate('ok')}
        >
          {spin('ok') ?? <CheckCircle2 className="h-4 w-4" aria-hidden />}
          {tr.sim.routingOk}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-10"
          disabled={disabled}
          onClick={() => fault.mutate('error_503')}
        >
          {spin('error_503') ?? <ServerCrash className="h-4 w-4" aria-hidden />}
          {tr.sim.routing503}
        </Button>
      </div>
      <div className="flex items-end gap-1.5">
        <div className="flex w-24 flex-col gap-1">
          <Label htmlFor="routing-delay" className="text-xs text-muted-foreground">
            {tr.sim.delaySec}
          </Label>
          <Input
            id="routing-delay"
            type="number"
            inputMode="numeric"
            min={1}
            max={60}
            value={delay}
            onChange={(e) => setDelay(Math.max(1, Number(e.target.value) || 1))}
            className="h-10"
            disabled={disabled}
          />
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-10 flex-1"
          disabled={disabled}
          onClick={() => fault.mutate('timeout')}
        >
          {spin('timeout') ?? <Clock className="h-4 w-4" aria-hidden />}
          {tr.sim.routingTimeout}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{tr.sim.routingHelp}</p>
      {status !== 'unknown' && (
        <p className="text-xs">
          {tr.sim.routingStatus}:{' '}
          <span className="font-semibold">
            {status === 'fallback' ? tr.routing.backupBadge : tr.routing.online}
          </span>
          {breaker && (
            <span className="tabular text-muted-foreground">
              {' '}
              · {tr.routing.breaker}: {breaker.state} · {breaker.failures} {tr.routing.failures}
            </span>
          )}
        </p>
      )}
      {log.length > 0 && (
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
            {tr.routing.log}
          </p>
          <ol className="mt-1 flex max-h-32 flex-col gap-0.5 overflow-y-auto text-xs">
            {log.map((e) => (
              <li key={e.at + (e.state ?? '')} className="tabular flex gap-2">
                <time className="text-muted-foreground" dateTime={new Date(e.at).toISOString()}>
                  {formatClock(new Date(e.at))}
                </time>
                <span>
                  {e.state ?? e.status} — {routingLogText(e)}
                  {e.status === 'fallback' && e.error ? ` (${e.error})` : ''}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}
