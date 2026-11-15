import { Accessibility, ShieldHalf } from 'lucide-react';
import { LanguageSwitcher } from '@/components/ui/language-switcher';
import { tr } from '@/i18n';
import { cn } from '@/lib/utils';
import { useCitizenStore } from '@/stores/citizenStore';
import { useConnectionStore } from '@/stores/connectionStore';
import { HEADER_H } from './citizenContext';

/** Always-visible header: app name, live-connection dot, ♿ mode chip and AZ | EN. */
export function CitizenHeader() {
  const online = useConnectionStore((s) => s.online);
  const socket = useConnectionStore((s) => s.citizenSocket);
  const mi = useCitizenStore((s) => s.mobilityImpaired);
  const live = online && socket === 'open';
  const status = live ? tr.citizen.header.online : tr.citizen.header.offline;

  return (
    <header
      className="safe-top fixed inset-x-0 top-0 z-[45] border-b bg-card/95 backdrop-blur"
      aria-label={tr.app.name}
    >
      <div className="mx-auto flex max-w-xl items-center gap-2 px-3" style={{ height: HEADER_H }}>
        <span
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-danger text-white"
          aria-hidden
        >
          <ShieldHalf className="h-4 w-4" />
        </span>
        <span className="min-w-0 truncate text-sm font-bold">{tr.app.name}</span>
        <span
          className="inline-flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground"
          role="status"
          title={status}
        >
          <span
            className={cn('h-2.5 w-2.5 rounded-full', live ? 'bg-safe' : 'bg-slate-400')}
            aria-hidden
          />
          <span className="sr-only">{status}</span>
        </span>
        <div className="ml-auto flex items-center gap-2">
          {mi && (
            <span
              className="inline-flex h-8 items-center gap-1 rounded-full bg-violet-700 px-2.5 text-xs font-bold text-white"
              title={tr.a11y.stepFreeMode}
            >
              <Accessibility className="h-4 w-4" aria-hidden />
              <span className="sr-only">{tr.a11y.stepFreeMode}</span>
            </span>
          )}
          <LanguageSwitcher size="sm" />
        </div>
      </div>
    </header>
  );
}
