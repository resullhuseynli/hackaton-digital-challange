import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { HEADER_H, TAB_BAR_H } from '@/features/citizen/citizenContext';
import { useRoutingStore } from '@/stores/routingStore';

/** Scrollable page frame for the non-map tabs (header + content above the tab bar). */
export function TabPage({
  icon: Icon,
  title,
  subtitle,
  toolbar,
  children,
}: {
  icon: LucideIcon;
  title: string;
  subtitle: string;
  toolbar?: ReactNode;
  children: ReactNode;
}) {
  const bannerH = useRoutingStore((s) => s.bannerH);
  return (
    // The scroll area starts below the fixed app header (plus the iOS safe area).
    <div
      className="scrollbar-thin h-full overflow-y-auto"
      style={{ paddingTop: `calc(${HEADER_H + bannerH}px + env(safe-area-inset-top))` }}
    >
      <div
        className="mx-auto flex max-w-xl flex-col gap-4 px-4"
        // Leave room for the tab bar and the floating SOS button.
        style={{ paddingBottom: `calc(${TAB_BAR_H + 120}px + env(safe-area-inset-bottom))` }}
      >
        <header className="sticky top-0 z-10 -mx-4 flex flex-col gap-3 border-b bg-background/95 px-4 pb-3 pt-4 backdrop-blur">
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-primary/10 text-primary">
              <Icon className="h-6 w-6" aria-hidden />
            </span>
            <div>
              <h2 className="text-xl font-extrabold leading-tight">{title}</h2>
              <p className="text-sm text-muted-foreground">{subtitle}</p>
            </div>
          </div>
          {toolbar}
        </header>
        {children}
      </div>
    </div>
  );
}
