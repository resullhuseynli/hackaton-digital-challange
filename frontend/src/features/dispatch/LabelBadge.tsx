import { Accessibility, Tag } from 'lucide-react';
import { tr } from '@/i18n';
import { cn, withoutWheelchair } from '@/lib/utils';
import type { Label } from '@/types/api';

/**
 * A server label as a badge. `text` is already localized by the backend. MOBILITY_IMPAIRED gets
 * a high-contrast violet badge with a ♿ icon (white on violet-700 ≈ 7:1 contrast).
 */
export function LabelBadge({ label, size = 'md' }: { label: Label; size?: 'sm' | 'md' }) {
  const mi = label.code === 'MOBILITY_IMPAIRED';
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1 rounded-md font-bold',
        size === 'sm' ? 'px-1.5 py-0.5 text-[11px]' : 'px-2 py-0.5 text-xs',
        mi ? 'bg-violet-700 text-white' : 'bg-secondary text-secondary-foreground',
      )}
    >
      {mi ? (
        <Accessibility className="h-3.5 w-3.5 shrink-0" aria-hidden />
      ) : (
        <Tag className="h-3.5 w-3.5 shrink-0" aria-hidden />
      )}
      <span className="truncate">{mi ? withoutWheelchair(label.text) : label.text}</span>
    </span>
  );
}

export function LabelList({ labels, size }: { labels: Label[] | undefined; size?: 'sm' | 'md' }) {
  if (!labels?.length) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {labels.map((l) => (
        <LabelBadge key={`${l.code}-${l.text}`} label={l} size={size} />
      ))}
    </span>
  );
}

/** "#1 PRİORİTET" marker shown on SOS from persons with reduced mobility. */
export function PriorityOneMarker() {
  return (
    <span className="inline-flex items-center rounded-md border-2 border-violet-500 px-1.5 py-0.5 text-[11px] font-black tracking-wide text-violet-700 dark:text-violet-300">
      {tr.a11y.priority1}
    </span>
  );
}
