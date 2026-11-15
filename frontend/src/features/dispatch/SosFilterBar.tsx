import { Search } from 'lucide-react';
import { Input } from '@/components/ui/misc';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { tr } from '@/i18n';
import { SOS_META, SOS_TYPES } from '@/lib/status';
import { cn } from '@/lib/utils';
import { useDispatchStore } from '@/stores/dispatchStore';
import type { SosStatus, SosType } from '@/types/api';
import { useDispatchZones } from './queries';

/** Search + zone/type/status filters, shared by the map feed and the SOS page. */
export function SosFilterBar({ wide }: { wide?: boolean }) {
  const zones = useDispatchZones();
  const filters = useDispatchStore((s) => s.filters);
  const setFilters = useDispatchStore((s) => s.setFilters);
  const trigger = wide ? 'h-10 text-sm' : 'h-9 px-2 text-xs';

  return (
    <div className={cn('flex gap-2', wide ? 'flex-row flex-wrap items-center' : 'flex-col')}>
      <div className={cn('relative', wide && 'min-w-[260px] flex-1')}>
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          value={filters.search}
          onChange={(e) => setFilters({ search: e.target.value })}
          placeholder={tr.dispatch.feed.search}
          aria-label={tr.dispatch.feed.searchAria}
          className={cn('pl-9', wide ? 'h-10' : 'h-9')}
        />
      </div>
      <div className={cn('grid grid-cols-3 gap-1.5', wide && 'w-[560px] gap-2')}>
        <Select value={filters.zone} onValueChange={(zone) => setFilters({ zone })}>
          <SelectTrigger className={trigger} aria-label={tr.dispatch.popover.zone}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{tr.dispatch.feed.allZones}</SelectItem>
            {(zones.data ?? []).map((z) => (
              <SelectItem key={String(z.id)} value={String(z.id)}>
                {z.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={filters.type}
          onValueChange={(type) => setFilters({ type: type as SosType | 'all' })}
        >
          <SelectTrigger className={trigger} aria-label={tr.dispatch.popover.type}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{tr.dispatch.feed.allTypes}</SelectItem>
            {SOS_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {SOS_META[t].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={filters.status}
          onValueChange={(status) => setFilters({ status: status as SosStatus | 'active' | 'all' })}
        >
          <SelectTrigger className={trigger} aria-label={tr.dispatch.popover.status}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="active">{tr.dispatch.feed.activeOnly}</SelectItem>
            <SelectItem value="all">{tr.dispatch.feed.allStatuses}</SelectItem>
            <SelectItem value="new">{tr.sosStatus.new}</SelectItem>
            <SelectItem value="assigned">{tr.sosStatus.assigned}</SelectItem>
            <SelectItem value="resolved">{tr.sosStatus.resolved}</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
