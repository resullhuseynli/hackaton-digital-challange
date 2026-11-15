import { BellRing, FlaskConical, LogOut, ShieldHalf, Siren, Volume2, VolumeX } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { LanguageSwitcher } from '@/components/ui/language-switcher';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  Switch,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/misc';
import { useNow } from '@/hooks/useNow';
import { tr } from '@/i18n';
import { alarm } from '@/lib/alarm';
import { formatClock, timeAgo } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useAuthStore, usePermissions } from '@/stores/authStore';
import { useConnectionStore } from '@/stores/connectionStore';
import { useDispatchStore } from '@/stores/dispatchStore';
import { useAlerts } from './queries';

function Clock() {
  const now = useNow(1000);
  return (
    <time
      className="tabular hidden text-lg font-semibold text-slate-200 lg:block"
      dateTime={new Date(now).toISOString()}
    >
      {formatClock(new Date(now))}
    </time>
  );
}

function ConnectionIndicator() {
  const status = useConnectionStore((s) => s.dispatchSocket);
  const live = status === 'open';
  const connecting = status === 'connecting' || status === 'idle';
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold',
        live
          ? 'border-green-600/40 bg-green-600/10 text-green-400'
          : connecting
            ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
            : 'border-red-600/50 bg-red-600/15 text-red-400',
      )}
      role="status"
      aria-live="polite"
    >
      <span className="relative flex h-2.5 w-2.5">
        {live && (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-500 opacity-70" />
        )}
        <span
          className={cn(
            'relative inline-flex h-2.5 w-2.5 rounded-full',
            live ? 'bg-green-500' : connecting ? 'bg-amber-400' : 'bg-red-500',
          )}
        />
      </span>
      {live ? tr.dispatch.live : connecting ? tr.dispatch.connecting : tr.dispatch.disconnected}
    </div>
  );
}

function AlertsMenu() {
  const alerts = useAlerts();
  const openAlert = useDispatchStore((s) => s.openAlert);
  const unseen = useDispatchStore((s) => s.unseenAlertIds.length);
  const list = alerts.data ?? [];
  const now = useNow(15_000);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant={list.length ? 'danger' : 'outline'}
          size="sm"
          className={cn('relative', list.length > 0 && 'animate-pulse')}
          aria-label={`${tr.alert.activeAlerts}: ${list.length}`}
        >
          <BellRing className="h-4 w-4" aria-hidden />
          <span className="hidden xl:inline">{tr.alert.activeAlerts}</span>
          <span className="tabular rounded-full bg-white/20 px-1.5">{list.length}</span>
          {unseen > 0 && (
            <span className="absolute -right-1.5 -top-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-warning px-1 text-[11px] font-bold text-slate-950">
              {unseen}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-2">
        <p className="px-2 pb-2 pt-1 text-sm font-semibold">{tr.alert.activeAlerts}</p>
        {list.length === 0 ? (
          <p className="px-2 pb-2 text-sm text-muted-foreground">{tr.alert.noActive}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {list.map((a) => (
              <li key={String(a.id)}>
                <button
                  type="button"
                  onClick={() => openAlert(a.id)}
                  className="flex w-full items-center gap-3 rounded-xl p-2 text-left hover:bg-accent focus-visible:bg-accent"
                >
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-danger text-white">
                    <Siren className="h-5 w-5" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">
                      {a.zone_name ?? '—'}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {tr.alert.kind[a.kind]} · {timeAgo(a.created_at, now)}
                    </span>
                  </span>
                  {a.kind === 'SOS_CLUSTER' && (
                    <Badge variant="danger">{a.distinct_citizens}</Badge>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}

export function TopBar() {
  const username = useAuthStore((s) => s.username);
  const { role, sim } = usePermissions();
  const logout = useAuthStore((s) => s.logout);
  const demoMode = useDispatchStore((s) => s.demoMode);
  const setDemoMode = useDispatchStore((s) => s.setDemoMode);
  const muted = useDispatchStore((s) => s.muted);
  const setMuted = useDispatchStore((s) => s.setMuted);

  return (
    <header className="flex h-14 items-center gap-3 border-b bg-slate-950/80 px-4 backdrop-blur">
      <div className="flex items-center gap-2.5">
        <div
          className="grid h-9 w-9 place-items-center rounded-xl bg-danger text-white"
          aria-hidden
        >
          <ShieldHalf className="h-5 w-5" />
        </div>
        <div className="leading-tight">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">
            {tr.app.fhn}
          </p>
          <h1 className="text-base font-bold">{tr.app.dispatchTitle}</h1>
        </div>
      </div>
      <div className="mx-2 h-8 w-px bg-border" aria-hidden />
      <Clock />
      <ConnectionIndicator />
      <div className="ml-auto flex items-center gap-2">
        <AlertsMenu />
        <LanguageSwitcher size="sm" />
        {/* Simulation and drills are admin-only (403 for other roles). */}
        {sim && (
          <label className="flex items-center gap-2 rounded-xl border px-3 py-1.5 text-sm">
            <FlaskConical className="h-4 w-4 text-muted-foreground" aria-hidden />
            <span className="hidden xl:inline">{tr.dispatch.demoMode}</span>
            <Switch
              checked={demoMode}
              onCheckedChange={setDemoMode}
              aria-label={tr.dispatch.demoMode}
            />
          </label>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              onClick={() => {
                if (!muted) alarm.stop();
                else alarm.unlock();
                setMuted(!muted);
              }}
              aria-label={muted ? tr.dispatch.unmute : tr.dispatch.mute}
              aria-pressed={muted}
            >
              {muted ? (
                <VolumeX className="h-4 w-4" aria-hidden />
              ) : (
                <Volume2 className="h-4 w-4" aria-hidden />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{muted ? tr.dispatch.unmute : tr.dispatch.mute}</TooltipContent>
        </Tooltip>
        <span className="hidden text-sm text-muted-foreground 2xl:inline">{username}</span>
        {role && (
          <span
            className="rounded-md border px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground"
            title={tr.rbac.roleLabel}
          >
            {tr.rbac.role[role]}
          </span>
        )}
        <Button variant="ghost" size="sm" onClick={() => logout()}>
          <LogOut className="h-4 w-4" aria-hidden />
          <span className="hidden xl:inline">{tr.auth.logout}</span>
        </Button>
      </div>
    </header>
  );
}
