import type { LucideIcon } from 'lucide-react';
import { Building2, Map as MapIcon, Radio, UserRound } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { tr } from '@/i18n';
import { cn } from '@/lib/utils';
import { useCitizenStore } from '@/stores/citizenStore';
import { TAB_BAR_H } from './citizenContext';

interface Tab {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  dot?: boolean;
}

/** Bottom navigation for the citizen app (thumb-reachable, 64 px tall). */
export function TabBar() {
  const activeSos = useCitizenStore((s) => s.activeSos);
  const queued = useCitizenStore((s) => s.sosQueue.length);
  const safe = useCitizenStore((s) => s.safeSince);

  const tabs: Tab[] = [
    { to: '/', label: tr.citizen.tabs.map, icon: MapIcon, end: true },
    { to: '/points', label: tr.citizen.tabs.points, icon: Building2 },
    {
      to: '/sos',
      label: tr.citizen.tabs.sos,
      icon: Radio,
      dot: queued > 0 || (activeSos != null && activeSos.status !== 'resolved'),
    },
    { to: '/me', label: tr.citizen.tabs.me, icon: UserRound, dot: !safe },
  ];

  return (
    <nav
      aria-label={tr.citizen.tabs.label}
      className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t bg-card/95 backdrop-blur"
    >
      <ul className="mx-auto flex max-w-xl" style={{ height: TAB_BAR_H }}>
        {tabs.map((t) => {
          const Icon = t.icon;
          return (
            <li key={t.to} className="flex-1">
              <NavLink
                to={t.to}
                end={t.end}
                className={({ isActive }) =>
                  cn(
                    'flex h-full flex-col items-center justify-center gap-1 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                    isActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <span
                      className={cn(
                        'relative grid h-8 w-14 place-items-center rounded-full transition-colors',
                        isActive && 'bg-primary/10',
                      )}
                    >
                      <Icon className="h-5 w-5" aria-hidden />
                      {t.dot && (
                        <span className="absolute right-3 top-1 h-2.5 w-2.5 rounded-full border-2 border-card bg-danger" />
                      )}
                    </span>
                    {t.label}
                  </>
                )}
              </NavLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
