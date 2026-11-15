import { Loader2 } from 'lucide-react';
import { tr } from '@/i18n';
import { cn } from '@/lib/utils';

export function PageLoader({ dark }: { dark?: boolean }) {
  return (
    <div
      className={cn(
        'grid h-full place-items-center',
        dark ? 'bg-slate-950 text-slate-300' : 'bg-background text-muted-foreground',
      )}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-3 text-sm font-medium">
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
        {tr.app.loading}
      </div>
    </div>
  );
}
