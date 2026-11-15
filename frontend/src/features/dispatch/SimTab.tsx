import {
  Ban,
  Crosshair,
  Loader2,
  RotateCcw,
  Route,
  Siren,
  TrafficCone,
  Accessibility,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input, Label, Slider } from '@/components/ui/misc';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { tr } from '@/i18n';
import { SOS_META, SOS_TYPES } from '@/lib/status';
import { cn, sameId } from '@/lib/utils';
import { useDispatchStore, type SimMode } from '@/stores/dispatchStore';
import type { BarrierType, SosType } from '@/types/api';
import { useDispatchPoints } from './queries';
import { BarrierIcon } from './BarrierIcon';
import { RoutingFaultCard } from '@/features/routing/RoutingFaultCard';
import { useSim } from './useSim';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2 rounded-xl border bg-background/40 p-3">
      <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

/** Toggle a "click on the map" mode; pressed state is exposed to assistive tech. */
function ModeButton({
  mode,
  icon: Icon,
  children,
}: {
  mode: Exclude<SimMode, null>;
  icon: typeof Ban;
  children: ReactNode;
}) {
  const current = useDispatchStore((s) => s.simMode);
  const setMode = useDispatchStore((s) => s.setSimMode);
  const on = current === mode;
  return (
    <Button
      size="sm"
      variant={on ? 'warning' : 'outline'}
      className="h-auto min-h-11 flex-col gap-1 py-2 text-[11px]"
      onClick={() => setMode(on ? null : mode)}
      aria-pressed={on}
    >
      <Icon className="h-4 w-4" aria-hidden />
      {children}
    </Button>
  );
}

const BARRIERS: BarrierType[] = ['stairs', 'steep', 'underpass', 'curb', 'narrow', 'inaccessible'];

export function SimTab() {
  const sim = useSim();
  const simMode = useDispatchStore((s) => s.simMode);
  const simBarrier = useDispatchStore((s) => s.simBarrier);
  const setSimBarrier = useDispatchStore((s) => s.setSimBarrier);
  const result = useDispatchStore((s) => s.simResult);

  return (
    <div className="flex flex-col gap-3 pb-2">
      <p className="sr-only" aria-live="polite">
        {result?.text}
      </p>
      {result && (
        <div
          className="rounded-xl border border-green-600/40 bg-green-600/10 p-2.5 text-sm"
          aria-hidden
        >
          <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
            {tr.sim.lastResult}
          </p>
          <p className="font-medium">{result.text}</p>
        </div>
      )}

      <Section title={tr.dispatch.layers.roads}>
        <div className="grid grid-cols-3 gap-1.5">
          <ModeButton mode="close" icon={Ban}>
            {tr.sim.closeRoad}
          </ModeButton>
          <ModeButton mode="open" icon={Route}>
            {tr.sim.openRoad}
          </ModeButton>
          <ModeButton mode="congest" icon={TrafficCone}>
            {tr.sim.congest}
          </ModeButton>
        </div>
        {(simMode === 'close' || simMode === 'open' || simMode === 'congest') && (
          <p className="text-xs text-amber-300">{tr.sim.clickHint}</p>
        )}
        {sim.road.isPending && (
          <Loader2 className="h-4 w-4 animate-spin" aria-label={tr.app.loading} />
        )}
      </Section>

      <Section title={tr.sim.addBarrier}>
        <Label htmlFor="sim-barrier" className="text-xs text-muted-foreground">
          {tr.sim.barrierType}
        </Label>
        <Select
          value={simBarrier ?? 'none'}
          onValueChange={(v) => setSimBarrier(v === 'none' ? null : (v as BarrierType))}
        >
          <SelectTrigger id="sim-barrier" className="h-10 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {BARRIERS.map((b) => (
              <SelectItem key={b} value={b}>
                <span className="inline-flex items-center gap-1.5">
                  <BarrierIcon type={b} />
                  {tr.barrier[b]}
                </span>
              </SelectItem>
            ))}
            <SelectItem value="none">{tr.barrier.none}</SelectItem>
          </SelectContent>
        </Select>
        <ModeButton mode="barrier" icon={Accessibility}>
          {tr.sim.barrierHint}
        </ModeButton>
        {sim.barrier.isPending && (
          <Loader2 className="h-4 w-4 animate-spin" aria-label={tr.app.loading} />
        )}
      </Section>

      <OccupancyForm />
      <BurstForm />
      <RoutingFaultCard />
      <ResetButton />
    </div>
  );
}

function OccupancyForm() {
  const sim = useSim();
  const points = useDispatchPoints().data ?? [];
  const [pointId, setPointId] = useState('');
  const [mode, setMode] = useState<'abs' | 'delta'>('abs');
  const [count, setCount] = useState(0);
  const [delta, setDelta] = useState(100);
  const p = points.find((x) => sameId(x.id, pointId));
  const pct = p ? Math.round((count / p.capacity) * 100) : 0;

  return (
    <Section title={tr.sim.occupancy}>
      <Select
        value={pointId}
        onValueChange={(v) => {
          setPointId(v);
          const sel = points.find((x) => sameId(x.id, v));
          if (sel) setCount(sel.current_count);
        }}
      >
        <SelectTrigger className="h-10 text-sm" aria-label={tr.sim.selectPoint}>
          <SelectValue placeholder={tr.sim.selectPoint} />
        </SelectTrigger>
        <SelectContent>
          {points.map((x) => (
            <SelectItem key={String(x.id)} value={String(x.id)}>
              {x.name} ({Math.round(x.occupancy_pct)}%)
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div role="radiogroup" aria-label={tr.sim.occMode} className="grid grid-cols-2 gap-1.5">
        {(['abs', 'delta'] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={mode === m}
            onClick={() => setMode(m)}
            className={cn(
              'h-9 rounded-lg border text-xs font-semibold',
              mode === m ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-accent',
            )}
          >
            {m === 'abs' ? tr.sim.occAbsolute : tr.sim.occDelta}
          </button>
        ))}
      </div>
      {mode === 'abs' ? (
        <div className="flex flex-col gap-1">
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">{tr.sim.occCount}</span>
            <span className="tabular font-semibold">
              {count} {p ? `/ ${p.capacity} (${pct}%)` : ''}
            </span>
          </div>
          <Slider
            value={[count]}
            min={0}
            max={p ? Math.round(p.capacity * 1.1) : 100}
            step={p ? Math.max(1, Math.round(p.capacity / 200)) : 1}
            onValueChange={([v]) => setCount(v)}
            thumbLabel={tr.sim.occCount}
            disabled={!p}
          />
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          <Label htmlFor="occ-delta" className="text-xs text-muted-foreground">
            {tr.sim.occDelta}
          </Label>
          <Input
            id="occ-delta"
            type="number"
            inputMode="numeric"
            value={delta}
            onChange={(e) => setDelta(Number(e.target.value))}
            className="h-10"
            disabled={!p}
          />
        </div>
      )}
      <Button
        size="sm"
        variant="secondary"
        className="h-10"
        disabled={!p || sim.occupancy.isPending}
        onClick={() =>
          p &&
          sim.occupancy.mutate(
            mode === 'abs' ? { point_id: p.id, current_count: count } : { point_id: p.id, delta },
          )
        }
      >
        {sim.occupancy.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
        {tr.sim.apply}
      </Button>
    </Section>
  );
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="tabular font-semibold">{value}</span>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={([v]) => onChange(v)}
        thumbLabel={label}
      />
    </div>
  );
}

function BurstForm() {
  const sim = useSim();
  const loc = useDispatchStore((s) => s.burstLocation);
  const [count, setCount] = useState(4);
  const [radius, setRadius] = useState(400);
  const [windowSec, setWindowSec] = useState(120);
  const [type, setType] = useState<SosType>('collapse');

  return (
    <Section title={tr.sim.burst}>
      <ModeButton mode="burst" icon={Crosshair}>
        {loc
          ? `${tr.sim.burstPicked} (${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)})`
          : tr.sim.burstPick}
      </ModeButton>
      <SliderRow label={tr.sim.count} value={count} min={1} max={30} step={1} onChange={setCount} />
      <SliderRow
        label={tr.sim.radius}
        value={radius}
        min={100}
        max={2000}
        step={50}
        onChange={setRadius}
      />
      <SliderRow
        label={tr.sim.window}
        value={windowSec}
        min={30}
        max={900}
        step={30}
        onChange={setWindowSec}
      />
      <div className="flex flex-col gap-1">
        <Label htmlFor="burst-type" className="text-xs text-muted-foreground">
          {tr.sim.type}
        </Label>
        <Select value={type} onValueChange={(v) => setType(v as SosType)}>
          <SelectTrigger id="burst-type" className="h-10 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SOS_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {SOS_META[t].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button
        size="sm"
        variant="danger"
        className="h-10"
        disabled={!loc || sim.burst.isPending}
        onClick={() =>
          loc &&
          sim.burst.mutate({
            lat: loc.lat,
            lng: loc.lng,
            count,
            radius_m: radius,
            window_sec: windowSec,
            type,
          })
        }
      >
        {sim.burst.isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <Siren className="h-4 w-4" aria-hidden />
        )}
        {tr.sim.create}
      </Button>
    </Section>
  );
}

function ResetButton() {
  const sim = useSim();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="outline"
        className="h-11 border-danger/50 text-red-300"
        onClick={() => setOpen(true)}
        disabled={sim.reset.isPending}
      >
        {sim.reset.isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <RotateCcw className="h-4 w-4" aria-hidden />
        )}
        {tr.sim.reset}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{tr.sim.resetConfirmTitle}</DialogTitle>
            <DialogDescription>{tr.sim.resetConfirmText}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {tr.app.cancel}
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setOpen(false);
                sim.reset.mutate();
              }}
            >
              <RotateCcw className="h-4 w-4" aria-hidden />
              {tr.sim.resetConfirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
