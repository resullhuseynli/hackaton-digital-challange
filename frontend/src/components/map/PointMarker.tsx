import { Accessibility } from 'lucide-react';
import { memo } from 'react';
import { Marker } from 'react-map-gl/maplibre';
import { tr } from '@/i18n';
import { formatPct } from '@/lib/format';
import { occupancyColor, POINT_META } from '@/lib/status';
import { cn } from '@/lib/utils';
import type { AssemblyPoint } from '@/types/api';

interface Props {
  point: AssemblyPoint;
  selected?: boolean;
  showLabel?: boolean;
  dimmed?: boolean;
  onClick?: (p: AssemblyPoint) => void;
  size?: number;
}

/** Assembly point marker: type icon in the middle, occupancy ring around it. */
export const PointMarker = memo(function PointMarker({
  point,
  selected,
  showLabel,
  dimmed,
  onClick,
  size = 44,
}: Props) {
  const meta = POINT_META[point.type];
  const Icon = meta.icon;
  const pct = Math.max(0, Math.min(100, point.occupancy_pct));
  const reserve = point.status === 'reserve';
  const closed = point.status === 'closed';
  const color = closed ? '#64748B' : reserve ? '#2563EB' : occupancyColor(pct);
  const r = size / 2 - 3;
  const c = 2 * Math.PI * r;
  const label = `${meta.label}: ${point.name}, ${tr.occupancy.label} ${formatPct(pct)}${
    reserve ? `, ${tr.pointStatus.reserve}` : ''
  }${point.wheelchair_accessible ? `, ${tr.a11y.wheelchairAccessible}` : ''}`;

  return (
    <Marker
      latitude={point.lat}
      longitude={point.lng}
      anchor="center"
      style={{ zIndex: selected ? 5 : 1 }}
      onClick={(e) => {
        e.originalEvent.stopPropagation();
        onClick?.(point);
      }}
    >
      <button
        type="button"
        aria-label={label}
        title={label}
        className={cn(
          'group relative grid place-items-center transition-transform hover:scale-110 focus-visible:scale-110',
          selected && 'scale-125',
          dimmed && 'opacity-50',
        )}
        style={{ width: size, height: size }}
      >
        <svg width={size} height={size} className="absolute inset-0 -rotate-90" aria-hidden>
          <circle cx={size / 2} cy={size / 2} r={r} fill="white" className="dark:fill-slate-900" />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="currentColor"
            strokeWidth={4}
            className="text-slate-200 dark:text-slate-700"
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={4}
            strokeLinecap="round"
            strokeDasharray={reserve ? '4 4' : `${(pct / 100) * c} ${c}`}
            style={{ transition: 'stroke-dasharray 600ms ease' }}
          />
        </svg>
        <Icon className="relative h-5 w-5" style={{ color }} aria-hidden />
        {point.wheelchair_accessible && (
          <span
            className="absolute -right-1 -top-1 grid h-5 w-5 place-items-center rounded-full border-2 border-white bg-blue-700 text-white shadow dark:border-slate-900"
            aria-hidden
          >
            <Accessibility className="h-3 w-3" strokeWidth={2.75} />
          </span>
        )}
        {selected && (
          <span
            className="absolute inset-0 animate-pulse-ring rounded-full border-2"
            style={{ borderColor: color }}
            aria-hidden
          />
        )}
        {showLabel && (
          <span className="pointer-events-none absolute left-1/2 top-full mt-1 -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-900/85 px-1.5 py-0.5 text-[10px] font-semibold text-white shadow">
            {point.name} · {formatPct(pct)}
          </span>
        )}
      </button>
    </Marker>
  );
});
