import { AlertTriangle, Inbox, RotateCw } from 'lucide-react';
import type { ReactNode } from 'react';
import { errorMessage } from '@/api/http';
import { tr } from '@/i18n';
import { cn } from '@/lib/utils';
import { Button } from './button';
import { Skeleton } from './misc';

export function EmptyState({
  title = tr.app.empty,
  hint,
  icon,
  className,
}: {
  title?: string;
  hint?: string;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-2 px-4 py-8 text-center text-muted-foreground',
        className,
      )}
      role="status"
    >
      <div className="grid h-12 w-12 place-items-center rounded-2xl bg-muted">
        {icon ?? <Inbox className="h-6 w-6" aria-hidden />}
      </div>
      <p className="text-sm font-semibold text-foreground">{title}</p>
      {hint && <p className="max-w-xs text-xs">{hint}</p>}
    </div>
  );
}

export function ErrorState({
  title,
  error,
  onRetry,
  className,
  compact,
}: {
  title: string;
  error?: unknown;
  onRetry?: () => void;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center gap-2 text-center',
        compact ? 'px-3 py-4' : 'px-4 py-8',
        className,
      )}
    >
      <div className="grid h-12 w-12 place-items-center rounded-2xl bg-red-600/15 text-danger">
        <AlertTriangle className="h-6 w-6" aria-hidden />
      </div>
      <p className="text-sm font-semibold">{title}</p>
      {error != null && (
        <p className="max-w-xs text-xs text-muted-foreground">{errorMessage(error)}</p>
      )}
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry} className="mt-1">
          <RotateCw className="h-4 w-4" aria-hidden />
          {tr.app.retry}
        </Button>
      )}
    </div>
  );
}

export function ListSkeleton({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <div
      className={cn('flex flex-col gap-3', className)}
      aria-busy="true"
      aria-label={tr.app.loading}
    >
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-2xl border bg-card p-3">
          <Skeleton className="h-11 w-11 shrink-0" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-1/3" />
            <Skeleton className="h-2 w-full" />
          </div>
        </div>
      ))}
    </div>
  );
}
