import { ShieldAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { fill, tr } from '@/i18n';
import { useDispatchStore } from '@/stores/dispatchStore';
import { MAP_PATH } from './useDispatchActions';

/** Flood mode is shown while events keep arriving (the backend sends one every ≤5 s). */
const STALE_MS = 60_000;

/**
 * Amber, non-blocking strip above the page while the backend is in SOS flood mode. It sits in the
 * layout (not over it), so the main queue stays readable underneath.
 */
export function FloodBanner() {
  const s = useDispatchStore((st) => st.suspected);
  const navigate = useNavigate();
  const [, tick] = useState(0);
  const fresh = !!s && s.flood_mode && Date.now() - s.at < STALE_MS;

  // Re-render once it goes stale, so the banner hides without a new event.
  useEffect(() => {
    if (!fresh || !s) return;
    const t = window.setTimeout(() => tick((n) => n + 1), STALE_MS - (Date.now() - s.at) + 50);
    return () => window.clearTimeout(t);
  }, [fresh, s]);

  return (
    <div role="status" aria-live="polite">
      {fresh && s && (
        <div className="flex items-center gap-3 border-b border-amber-500/50 bg-amber-500/15 px-4 py-2 text-sm text-amber-100">
          <ShieldAlert className="h-5 w-5 shrink-0 text-amber-400" aria-hidden />
          <p className="min-w-0 flex-1">
            <span className="font-bold">{tr.quarantine.floodTitle}</span>{' '}
            {fill(tr.quarantine.floodText, { n: s.quarantined_pending })}
          </p>
          <Button
            size="sm"
            variant="outline"
            className="h-8 border-amber-500/60 text-amber-100"
            onClick={() => {
              useDispatchStore.getState().setRightTab('quarantine');
              navigate(MAP_PATH);
            }}
          >
            {tr.quarantine.review}
          </Button>
        </div>
      )}
    </div>
  );
}
