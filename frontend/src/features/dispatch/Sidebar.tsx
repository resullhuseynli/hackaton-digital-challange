import type { LucideIcon } from 'lucide-react';
import {
  BarChart3,
  Building2,
  ChevronsLeft,
  ChevronsRight,
  Map as MapIcon,
  Siren,
  TriangleAlert,
  Truck,
} from 'lucide-react';
import { useMemo } from 'react';
import { NavLink } from 'react-router-dom';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/misc';
import { tr } from '@/i18n';
import { cn } from '@/lib/utils';
import { useDispatchStore } from '@/stores/dispatchStore';
import { useAlerts, useBrigades, useDispatchPoints, useSosList } from './queries';

interface Item {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  badge?: number;
  tone?: 'danger' | 'warning' | 'neutral';
}

/** Left navigation for the dispatcher panel, with live counters. */
export function Sidebar() {
  const collapsed = useDispatchStore((s) => s.navCollapsed);
  const toggle = useDispatchStore((s) => s.toggleNav);
  const sos = useSosList().data;
  const alerts = useAlerts().data;
  const brigades = useBrigades().data;
  const points = useDispatchPoints().data;

  const items = useMemo<Item[]>(() => {
    const newSos = (sos ?? []).filter((s) => s.status === 'new').length;
    const busy = (brigades ?? []).filter((b) => b.status !== 'idle').length;
    const nearFull = (points ?? []).filter(
      (p) => p.status === 'active' && p.occupancy_pct > 90,
    ).length;
    return [
      { to: '/dispatcher', label: tr.nav.map, icon: MapIcon, end: true },
      { to: '/dispatcher/sos', label: tr.nav.sos, icon: Siren, badge: newSos, tone: 'danger' },
      {
        to: '/dispatcher/alerts',
        label: tr.nav.alerts,
        icon: TriangleAlert,
        badge: alerts?.length ?? 0,
        tone: 'danger',
      },
      {
        to: '/dispatcher/brigades',
        label: tr.nav.brigades,
        icon: Truck,
        badge: busy,
        tone: 'neutral',
      },
      {
        to: '/dispatcher/points',
        label: tr.nav.points,
        icon: Building2,
        badge: nearFull,
        tone: 'warning',
      },
      { to: '/dispatcher/analytics', label: tr.nav.analytics, icon: BarChart3 },
    ];
  }, [sos, alerts, brigades, points]);

  return (
    <nav
      aria-label={tr.nav.label}
      className={cn(
        'flex shrink-0 flex-col border-r bg-slate-950/60 py-3 transition-[width] duration-200',
        collapsed ? 'w-[68px]' : 'w-[224px]',
      )}
    >
      <ul className="flex flex-1 flex-col gap-1 px-2">
        {items.map((it) => (
          <li key={it.to}>
            <NavItem item={it} collapsed={collapsed} />
          </li>
        ))}
      </ul>
      <div className="px-2">
        <button
          type="button"
          onClick={toggle}
          className="flex h-10 w-full items-center gap-3 rounded-xl px-3 text-sm text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={collapsed ? tr.nav.expand : tr.nav.collapse}
          aria-expanded={!collapsed}
        >
          {collapsed ? (
            <ChevronsRight className="h-5 w-5 shrink-0" aria-hidden />
          ) : (
            <ChevronsLeft className="h-5 w-5 shrink-0" aria-hidden />
          )}
          {!collapsed && <span>{tr.nav.collapse}</span>}
        </button>
      </div>
    </nav>
  );
}

const TONE = {
  danger: 'bg-danger text-white',
  warning: 'bg-warning text-slate-950',
  neutral: 'bg-secondary text-secondary-foreground',
} as const;

function NavItem({ item, collapsed }: { item: Item; collapsed: boolean }) {
  const Icon = item.icon;
  const showBadge = (item.badge ?? 0) > 0;
  const link = (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) =>
        cn(
          'relative flex h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          isActive
            ? 'bg-primary/15 text-foreground before:absolute before:inset-y-2 before:left-0 before:w-1 before:rounded-full before:bg-primary'
            : 'text-muted-foreground hover:bg-accent hover:text-foreground',
        )
      }
      aria-label={showBadge ? `${item.label}: ${item.badge}` : item.label}
    >
      <Icon className="h-5 w-5 shrink-0" aria-hidden />
      {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
      {showBadge && (
        <span
          className={cn(
            'tabular grid h-5 min-w-5 place-items-center rounded-full px-1.5 text-[11px] font-bold',
            TONE[item.tone ?? 'neutral'],
            collapsed && 'absolute right-1 top-1 h-4 min-w-4 px-1 text-[10px]',
          )}
        >
          {item.badge}
        </span>
      )}
    </NavLink>
  );
  if (!collapsed) return link;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">{item.label}</TooltipContent>
    </Tooltip>
  );
}
