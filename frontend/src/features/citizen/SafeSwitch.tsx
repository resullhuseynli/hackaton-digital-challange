import { useMutation } from '@tanstack/react-query';
import { Loader2, ShieldCheck, ShieldQuestion } from 'lucide-react';
import { toast } from 'sonner';
import { citizenApi } from '@/api/endpoints';
import { errorMessage } from '@/api/http';
import { announce } from '@/lib/announce';
import { tr } from '@/i18n';
import { cn, vibrate } from '@/lib/utils';
import { useCitizenStore } from '@/stores/citizenStore';

/** "Təhlükəsizəm" switch → PATCH /citizens/me/status {safe | in_danger}. */
export function SafeSwitch({ className }: { className?: string }) {
  const status = useCitizenStore((s) => s.citizenStatus);
  const safe = status === 'safe';
  const m = useMutation({
    mutationFn: (next: 'safe' | 'in_danger') => citizenApi.updateStatus(next),
    onSuccess: (c, next) => {
      const st = useCitizenStore.getState();
      st.setCitizenStatus(c?.status ?? next);
      st.setSafeSince(next === 'safe' ? new Date().toISOString() : null);
      vibrate(120);
      const msg = next === 'safe' ? tr.citizen.status.on : tr.citizen.status.off;
      toast.success(msg);
      announce(msg, 'polite');
    },
    onError: (e) => toast.error(tr.citizen.status.error, { description: errorMessage(e) }),
  });

  return (
    <button
      type="button"
      role="switch"
      aria-checked={safe}
      aria-describedby="safe-switch-desc"
      disabled={m.isPending}
      onClick={() => m.mutate(safe ? 'in_danger' : 'safe')}
      className={cn(
        'flex min-h-[56px] w-full items-center gap-3 rounded-2xl border-2 px-4 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-70',
        safe ? 'border-green-700 bg-green-700 text-white' : 'border-green-700/60 bg-card',
        className,
      )}
    >
      {m.isPending ? (
        <Loader2 className="h-6 w-6 shrink-0 animate-spin" aria-hidden />
      ) : safe ? (
        <ShieldCheck className="h-6 w-6 shrink-0" aria-hidden />
      ) : (
        <ShieldQuestion
          className="h-6 w-6 shrink-0 text-green-700 dark:text-green-400"
          aria-hidden
        />
      )}
      <span className="min-w-0 flex-1">
        <span className="block text-base font-bold">{tr.citizen.status.switch}</span>
        <span
          id="safe-switch-desc"
          className={cn('block text-xs', safe ? 'text-white/90' : 'text-muted-foreground')}
        >
          {safe ? tr.citizen.status.on : tr.citizen.status.off}
        </span>
      </span>
      {/* Visual track */}
      <span
        className={cn(
          'relative h-7 w-12 shrink-0 rounded-full transition-colors',
          safe ? 'bg-white/30' : 'bg-muted-foreground/30',
        )}
        aria-hidden
      >
        <span
          className={cn(
            'absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all',
            safe ? 'left-[22px]' : 'left-0.5',
          )}
        />
      </span>
    </button>
  );
}
