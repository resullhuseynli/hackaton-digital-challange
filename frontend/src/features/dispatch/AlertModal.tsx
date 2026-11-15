import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import type { FeatureCollection, Point, Polygon } from 'geojson';
import {
  Building2,
  Check,
  CheckCircle2,
  Loader2,
  MapPin,
  Siren,
  Truck,
  Users,
  XCircle,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Layer, Marker, Source } from 'react-map-gl/maplibre';
import { toast } from 'sonner';
import { dispatchApi } from '@/api/endpoints';
import { qk } from '@/api/queryKeys';
import { BaseMap } from '@/components/map/BaseMap';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Checkbox, Label, Textarea } from '@/components/ui/misc';
import { OccupancyBar } from '@/components/ui/occupancy-bar';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { fill, tr } from '@/i18n';
import { alarm } from '@/lib/alarm';
import { formatDistance, formatEta, formatNumber } from '@/lib/format';
import { circleRing, haversine } from '@/lib/geo';
import { compareSos, isMiSos } from '@/lib/sosOrder';
import { BRIGADE_META, SOS_META, priorityValue } from '@/lib/status';
import { cn, sameId } from '@/lib/utils';
import { useDispatchStore } from '@/stores/dispatchStore';
import { estimateEta } from '@/lib/eta';
import type { Alert, Id } from '@/types/api';
import { LabelList, PriorityOneMarker } from './LabelBadge';
import { useAlerts, useBrigades, useDispatchPoints, useSosList } from './queries';
import { actionErrorToast } from '@/lib/actionError';
import { usePermissions } from '@/stores/authStore';

type Stage = 'idle' | 'running' | 'done';
const STEPS = [
  {
    key: 'brigade',
    get label() {
      return tr.alert.steps.brigade;
    },
    icon: Truck,
  },
  {
    key: 'point',
    get label() {
      return tr.alert.steps.point;
    },
    icon: Building2,
  },
  {
    key: 'citizens',
    get label() {
      return tr.alert.steps.citizens;
    },
    icon: Users,
  },
] as const;

/** Full-screen pulsing red frame while any alert is active. */
export function AlertBorder() {
  const alerts = useAlerts();
  if (!alerts.data?.length) return null;
  return (
    <div className="pointer-events-none fixed inset-0 z-[45] animate-alert-border" aria-hidden />
  );
}

export function AlertModal() {
  const openAlertId = useDispatchStore((s) => s.openAlertId);
  const alerts = useAlerts();
  const live = alerts.data?.find((a) => sameId(a.id, openAlertId)) ?? null;
  // Keep the last snapshot so the success animation survives `alert.resolved`.
  const [snapshot, setSnapshot] = useState<Alert | null>(null);
  useEffect(() => {
    if (live) setSnapshot(live);
  }, [live]);
  useEffect(() => {
    if (openAlertId == null) setSnapshot(null);
  }, [openAlertId]);

  const alert = live ?? (snapshot && sameId(snapshot.id, openAlertId) ? snapshot : null);

  const close = () => {
    alarm.stop();
    const st = useDispatchStore.getState();
    const next = st.unseenAlertIds.find((id) => alerts.data?.some((a) => sameId(a.id, id)));
    st.openAlert(next ?? null);
  };

  return (
    <Dialog open={alert != null} onOpenChange={(o) => !o && close()}>
      <DialogContent
        className="max-w-4xl gap-0 overflow-hidden border-2 border-danger p-0"
        overlayClassName="bg-red-950/50"
        hideClose
        onEscapeKeyDown={close}
      >
        {alert && (
          <AlertBody
            key={String(alert.id)}
            alert={alert}
            stillActive={live != null}
            onClose={close}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function AlertBody({
  alert,
  stillActive,
  onClose,
}: {
  alert: Alert;
  stillActive: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { write } = usePermissions();
  const readOnly = write ? undefined : tr.rbac.readOnly;
  const brigadesData = useBrigades().data;
  const pointsData = useDispatchPoints().data;
  const sosData = useSosList().data;
  const brigades = useMemo(() => brigadesData ?? [], [brigadesData]);
  const points = useMemo(() => pointsData ?? [], [pointsData]);
  const sos = useMemo(() => sosData ?? [], [sosData]);

  const [brigadeId, setBrigadeId] = useState<string>(
    alert.recommended_brigade ? String(alert.recommended_brigade.id) : '',
  );
  const [pointId, setPointId] = useState<string>(
    alert.recommended_new_point ? String(alert.recommended_new_point.id) : '',
  );
  const [doBrigade, setDoBrigade] = useState(true);
  const [doPoint, setDoPoint] = useState(true);
  const [stage, setStage] = useState<Stage>('idle');
  const [step, setStep] = useState(-1);
  const [dismissing, setDismissing] = useState(false);
  const [reason, setReason] = useState('');

  const brigadeOptions = useMemo(() => {
    const list = brigades
      .filter((b) => b.status === 'idle' || sameId(b.id, alert.recommended_brigade?.id))
      .map((b) => ({ b, eta: estimateEta(b, alert.center) }))
      .sort((a, b) => a.eta - b.eta);
    return list;
  }, [brigades, alert.center, alert.recommended_brigade?.id]);

  const pointOptions = useMemo(
    () =>
      points
        .filter((p) => p.status === 'reserve' || sameId(p.id, alert.recommended_new_point?.id))
        .map((p) => ({ p, d: haversine(alert.center, p) }))
        .sort((a, b) => a.d - b.d),
    [points, alert.center, alert.recommended_new_point?.id],
  );

  // Persons with reduced mobility first (same rule as the queue), then priority, then oldest.
  const clusterSos = useMemo(
    () => sos.filter((s) => alert.sos_ids.some((id) => sameId(id, s.id))).sort(compareSos),
    [sos, alert.sos_ids],
  );
  const hasMi = (alert.mobility_impaired_sos_ids?.length ?? 0) > 0;
  const outcome = useDispatchStore((s) => s.alertOutcome);
  const result = outcome && sameId(outcome.id, alert.id) ? outcome.result : null;
  const overloadPoint =
    alert.point_id != null ? points.find((p) => sameId(p.id, alert.point_id)) : undefined;

  const confirm = useMutation({
    mutationFn: () =>
      dispatchApi.confirmAlert(alert.id, {
        ...(doBrigade && brigadeId ? { brigade_id: brigadeId as Id } : {}),
        ...(doPoint && pointId ? { new_point_id: pointId as Id } : {}),
      }),
    onMutate: () => {
      alarm.stop();
      setStage('running');
    },
    onSuccess: () => {
      // Step-by-step success animation.
      STEPS.forEach((_, i) => window.setTimeout(() => setStep(i), 350 + i * 650));
      window.setTimeout(() => setStage('done'), 350 + STEPS.length * 650);
      window.setTimeout(
        () => {
          qc.setQueryData<Alert[]>(qk.alerts, (old) => old?.filter((a) => !sameId(a.id, alert.id)));
          void qc.invalidateQueries({ queryKey: qk.dispatchPoints });
          onClose();
        },
        350 + STEPS.length * 650 + 4000,
      );
    },
    onError: (e) => {
      setStage('idle');
      actionErrorToast(e, tr.alert.error);
    },
  });

  const dismiss = useMutation({
    mutationFn: () => dispatchApi.dismissAlert(alert.id, reason.trim()),
    onSuccess: () => {
      qc.setQueryData<Alert[]>(qk.alerts, (old) => old?.filter((a) => !sameId(a.id, alert.id)));
      toast(tr.alert.dismissed);
      onClose();
    },
    onError: (e) => actionErrorToast(e, tr.alert.error),
  });

  const ring = useMemo<FeatureCollection<Polygon>>(
    () => ({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'Polygon',
            coordinates: [circleRing(alert.center, alert.radius_m || 500)],
          },
        },
      ],
    }),
    [alert.center, alert.radius_m],
  );
  const sosFc = useMemo<FeatureCollection<Point>>(
    () => ({
      type: 'FeatureCollection',
      features: clusterSos.map((s) => ({
        type: 'Feature',
        properties: { color: SOS_META[s.type].color },
        geometry: { type: 'Point', coordinates: [s.lng, s.lat] },
      })),
    }),
    [clusterSos],
  );

  const windowMin = alert.window_min ?? 10;

  return (
    <div className="grid max-h-[92vh] overflow-y-auto md:grid-cols-[1.1fr_1fr]">
      <header className="relative col-span-full flex items-center gap-4 overflow-hidden bg-danger px-6 py-4 text-white">
        <motion.div
          className="absolute inset-0 bg-gradient-to-r from-red-700 via-red-500 to-red-700"
          animate={{ opacity: [0.6, 1, 0.6] }}
          transition={{ repeat: Infinity, duration: 1.2 }}
          aria-hidden
        />
        <motion.div
          className="relative grid h-14 w-14 place-items-center rounded-2xl bg-white text-danger"
          animate={{ rotate: [0, -10, 10, -10, 0] }}
          transition={{ repeat: Infinity, duration: 1.6, repeatDelay: 0.6 }}
        >
          <Siren className="h-8 w-8" aria-hidden />
        </motion.div>
        <div className="relative min-w-0 flex-1">
          <DialogTitle className="text-2xl font-black tracking-wide">{tr.alert.title}</DialogTitle>
          <DialogDescription className="text-base font-semibold text-white/90">
            {tr.alert.kind[alert.kind]} · {alert.zone_name ?? '—'}
          </DialogDescription>
        </div>
        {!stillActive && stage === 'idle' && (
          <span className="relative rounded-full bg-white/20 px-3 py-1 text-xs font-bold">
            {tr.alert.done}
          </span>
        )}
      </header>

      {/* Left: facts + mini-map */}
      <div className="flex flex-col gap-4 p-5">
        <div className="grid grid-cols-2 gap-3">
          {alert.kind === 'SOS_CLUSTER' ? (
            <div className="rounded-2xl border border-danger/40 bg-danger/10 p-3">
              <p className="text-xs font-medium text-muted-foreground">{tr.alert.signals}</p>
              <AnimatePresence mode="popLayout">
                <motion.p
                  key={alert.distinct_citizens}
                  initial={{ scale: 1.5, color: '#fca5a5' }}
                  animate={{ scale: 1, color: '#ffffff' }}
                  className="tabular text-4xl font-black"
                  aria-live="polite"
                >
                  {alert.distinct_citizens}
                </motion.p>
              </AnimatePresence>
              <p className="text-xs text-muted-foreground">
                {fill(tr.alert.window, { n: windowMin })}
              </p>
            </div>
          ) : (
            <div className="rounded-2xl border border-danger/40 bg-danger/10 p-3">
              <p className="text-xs font-medium text-muted-foreground">{tr.alert.point}</p>
              <p className="truncate font-bold">{overloadPoint?.name ?? '—'}</p>
              {overloadPoint && <OccupancyBar pct={overloadPoint.occupancy_pct} className="mt-2" />}
            </div>
          )}
          <div className="rounded-2xl border p-3">
            <p className="text-xs font-medium text-muted-foreground">{tr.alert.zone}</p>
            <p className="flex items-center gap-1.5 text-lg font-bold">
              <MapPin className="h-4 w-4 text-danger" aria-hidden />
              {alert.zone_name ?? '—'}
            </p>
            <p className="text-xs text-muted-foreground">
              {fill(tr.alert.radius, { m: alert.radius_m || 500 })}
            </p>
          </div>
        </div>
        {hasMi && (
          <div className="flex flex-col gap-1.5 rounded-2xl border-2 border-violet-500 bg-violet-600/15 p-3">
            <LabelList labels={alert.labels} />
            <p className="text-sm font-bold text-violet-100">{tr.a11y.clusterHasMi}</p>
          </div>
        )}
        {clusterSos.length > 0 && (
          <section aria-labelledby="cluster-sos-title">
            <h3
              id="cluster-sos-title"
              className="mb-1.5 text-xs font-semibold text-muted-foreground"
            >
              {tr.alert.clusterSos}
            </h3>
            <ul className="scrollbar-thin flex max-h-36 flex-col gap-1 overflow-y-auto">
              {clusterSos.map((s) => {
                const m = SOS_META[s.type];
                const Icon = m.icon;
                const mi = isMiSos(s);
                return (
                  <li
                    key={String(s.id)}
                    className={cn(
                      'flex items-center gap-2 rounded-lg border px-2 py-1 text-xs',
                      mi && 'border-l-4 border-l-violet-500 bg-violet-600/10',
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" style={{ color: m.color }} aria-hidden />
                    <span className="font-semibold">{m.label}</span>
                    <span className="tabular text-muted-foreground">#{String(s.id).slice(-5)}</span>
                    {mi && <PriorityOneMarker />}
                    <span className="ml-auto flex items-center gap-1.5">
                      <span className="tabular">P{priorityValue(s.priority_score)}</span>
                      <span className="text-muted-foreground">{tr.sosStatus[s.status]}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
        <div className="h-64 overflow-hidden rounded-2xl border">
          <BaseMap
            theme="dark"
            className="h-full w-full"
            ariaLabel={tr.alert.title}
            initialCenter={alert.center}
            initialZoom={14.2}
            interactive={false}
          >
            <Source id="alert-ring" type="geojson" data={ring}>
              <Layer
                id="alert-ring-fill"
                type="fill"
                paint={{ 'fill-color': '#DC2626', 'fill-opacity': 0.18 }}
              />
              <Layer
                id="alert-ring-line"
                type="line"
                paint={{ 'line-color': '#EF4444', 'line-width': 2, 'line-dasharray': [2, 1] }}
              />
            </Source>
            <Source id="alert-sos" type="geojson" data={sosFc}>
              <Layer
                id="alert-sos-dots"
                type="circle"
                paint={{
                  'circle-color': ['get', 'color'],
                  'circle-radius': 6,
                  'circle-stroke-color': '#ffffff',
                  'circle-stroke-width': 2,
                }}
              />
            </Source>
            <Marker latitude={alert.center.lat} longitude={alert.center.lng} anchor="center">
              <span className="relative grid h-5 w-5 place-items-center">
                <span className="absolute inset-0 animate-pulse-ring rounded-full bg-danger" />
                <span className="relative h-3 w-3 rounded-full border-2 border-white bg-danger" />
              </span>
            </Marker>
          </BaseMap>
        </div>
      </div>

      {/* Right: recommendations + actions */}
      <div className="flex flex-col gap-4 border-t p-5 md:border-l md:border-t-0">
        <AnimatePresence mode="wait">
          {stage === 'idle' && !dismissing && (
            <motion.div key="form" className="flex flex-col gap-4" exit={{ opacity: 0, x: 20 }}>
              <div className="flex flex-col gap-2">
                <Label htmlFor="alert-brigade">{tr.alert.recommendedBrigade}</Label>
                {brigadeOptions.length ? (
                  <Select value={brigadeId} onValueChange={setBrigadeId}>
                    <SelectTrigger id="alert-brigade" className="h-auto min-h-12 py-2">
                      <SelectValue placeholder={tr.alert.override} />
                    </SelectTrigger>
                    <SelectContent>
                      {brigadeOptions.map(({ b, eta }) => (
                        <SelectItem key={String(b.id)} value={String(b.id)}>
                          {b.name} · {BRIGADE_META[b.type].label} ·{' '}
                          {formatEta(
                            sameId(b.id, alert.recommended_brigade?.id)
                              ? alert.recommended_brigade!.eta_min
                              : eta,
                          )}
                          {sameId(b.id, alert.recommended_brigade?.id) ? ' ★' : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <p className="text-sm text-muted-foreground">{tr.alert.noBrigade}</p>
                )}
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="alert-point">{tr.alert.recommendedPoint}</Label>
                {pointOptions.length ? (
                  <Select value={pointId} onValueChange={setPointId}>
                    <SelectTrigger id="alert-point" className="h-auto min-h-12 py-2">
                      <SelectValue placeholder={tr.alert.override} />
                    </SelectTrigger>
                    <SelectContent>
                      {pointOptions.map(({ p, d }) => (
                        <SelectItem key={String(p.id)} value={String(p.id)}>
                          {p.name} · {formatNumber(p.capacity)} {tr.units.people} ·{' '}
                          {formatDistance(d)}
                          {sameId(p.id, alert.recommended_new_point?.id) ? ' ★' : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <p className="text-sm text-muted-foreground">{tr.alert.noPoint}</p>
                )}
              </div>
              <fieldset className="flex flex-col gap-2 rounded-2xl border p-3">
                <legend className="px-1 text-sm font-semibold">{tr.alert.actions}</legend>
                <label className="flex items-center gap-3 rounded-lg p-1.5 text-sm hover:bg-accent">
                  <Checkbox
                    checked={doBrigade}
                    onCheckedChange={(v) => setDoBrigade(v === true)}
                    disabled={!brigadeId}
                  />
                  <Truck className="h-4 w-4 text-muted-foreground" aria-hidden />
                  {tr.alert.actionBrigade}
                </label>
                <label className="flex items-center gap-3 rounded-lg p-1.5 text-sm hover:bg-accent">
                  <Checkbox
                    checked={doPoint}
                    onCheckedChange={(v) => setDoPoint(v === true)}
                    disabled={!pointId}
                  />
                  <Building2 className="h-4 w-4 text-muted-foreground" aria-hidden />
                  {tr.alert.actionPoint}
                </label>
              </fieldset>
              <div className="mt-auto flex flex-col gap-2">
                {!write && (
                  <p
                    role="note"
                    className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200"
                  >
                    {tr.rbac.readOnlyHint}
                  </p>
                )}
                <Button
                  variant="danger"
                  size="xl"
                  onClick={() => confirm.mutate()}
                  disabled={
                    !write || !stillActive || (!(doBrigade && brigadeId) && !(doPoint && pointId))
                  }
                  title={readOnly}
                  autoFocus
                >
                  <CheckCircle2 className="h-6 w-6" aria-hidden />
                  {tr.alert.confirm}
                </Button>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setDismissing(true)}
                    disabled={!stillActive || !write}
                    title={readOnly}
                  >
                    <XCircle className="h-4 w-4" aria-hidden />
                    {tr.alert.dismiss}
                  </Button>
                  <Button variant="ghost" onClick={onClose}>
                    {tr.alert.later}
                  </Button>
                </div>
              </div>
            </motion.div>
          )}

          {stage === 'idle' && dismissing && (
            <motion.form
              key="dismiss"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              className="flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (reason.trim()) dismiss.mutate();
              }}
            >
              <Label htmlFor="dismiss-reason">{tr.alert.dismissReason}</Label>
              <Textarea
                id="dismiss-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={tr.alert.dismissPlaceholder}
                autoFocus
                required
              />
              <div className="grid grid-cols-2 gap-2">
                <Button variant="ghost" onClick={() => setDismissing(false)}>
                  {tr.app.back}
                </Button>
                <Button
                  type="submit"
                  variant="outline"
                  disabled={!reason.trim() || dismiss.isPending}
                >
                  {dismiss.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                  {tr.alert.dismissConfirm}
                </Button>
              </div>
            </motion.form>
          )}

          {stage !== 'idle' && (
            <motion.ol
              key="steps"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              className="flex flex-1 flex-col justify-center gap-3"
              aria-live="polite"
            >
              {STEPS.map((s, i) => {
                const done = step >= i;
                const Icon = s.icon;
                return (
                  <motion.li
                    key={s.key}
                    className="flex items-center gap-3 rounded-2xl border p-3"
                    animate={
                      done
                        ? { borderColor: '#16A34A', backgroundColor: 'rgba(22,163,74,0.12)' }
                        : {}
                    }
                  >
                    <span className="grid h-10 w-10 place-items-center rounded-full bg-muted">
                      {done ? (
                        <motion.span
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          className="grid h-10 w-10 place-items-center rounded-full bg-safe text-white"
                        >
                          <Check className="h-5 w-5" aria-hidden />
                        </motion.span>
                      ) : stage === 'running' && step === i - 1 ? (
                        <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
                      ) : (
                        <Icon className="h-5 w-5 text-muted-foreground" aria-hidden />
                      )}
                    </span>
                    <span className={done ? 'font-semibold' : 'text-muted-foreground'}>
                      {s.label}
                    </span>
                  </motion.li>
                );
              })}
              {stage === 'done' && (
                <motion.p
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-2 flex items-center justify-center gap-2 text-lg font-bold text-green-400"
                >
                  <CheckCircle2 className="h-6 w-6" aria-hidden />
                  {tr.alert.done}
                </motion.p>
              )}
              <ResultSummary
                result={result}
                brigadeName={(id) => brigades.find((b) => sameId(b.id, id))?.name}
                pointName={(id) => points.find((p) => sameId(p.id, id))?.name}
                isMi={(id) => alert.mobility_impaired_sos_ids?.some((x) => sameId(x, id)) ?? false}
              />
            </motion.ol>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

/** Summary from `alert.resolved` (result): who was dispatched to whom, what opened, how many moved. */
function ResultSummary({
  result,
  brigadeName,
  pointName,
  isMi,
}: {
  result: Record<string, unknown> | null | undefined;
  brigadeName: (id: Id) => string | undefined;
  pointName: (id: Id) => string | undefined;
  isMi: (id: Id) => boolean;
}) {
  if (!result) {
    return (
      <p className="mt-2 text-center text-xs text-muted-foreground">{tr.alert.result.waiting}</p>
    );
  }
  const brigadeId = result.brigade_id as Id | null;
  const assigned = (result.assigned_sos_ids as Id[] | undefined) ?? [];
  const pointId = result.new_point_id as Id | null;
  const rerouted = Number(result.rerouted ?? 0);
  const overridden = result.overridden as { brigade?: boolean; point?: boolean } | undefined;
  return (
    <section
      aria-labelledby="alert-result-title"
      className="mt-2 rounded-xl border border-green-600/40 bg-green-600/10 p-3 text-sm"
    >
      <h3
        id="alert-result-title"
        className="mb-1 text-xs font-bold uppercase tracking-wide text-muted-foreground"
      >
        {tr.alert.result.title}
      </h3>
      <ul className="flex flex-col gap-1">
        {brigadeId != null && assigned.length > 0 && (
          <li className="flex flex-wrap items-center gap-1.5">
            {fill(tr.alert.result.brigade, {
              brigade: brigadeName(brigadeId) ?? `#${brigadeId}`,
              sos: String(assigned[0]),
            })}
            {isMi(assigned[0]) && <PriorityOneMarker />}
          </li>
        )}
        {assigned.length > 1 && <li>{fill(tr.alert.result.assigned, { n: assigned.length })}</li>}
        {pointId != null && (
          <li>{fill(tr.alert.result.point, { point: pointName(pointId) ?? `#${pointId}` })}</li>
        )}
        <li>{fill(tr.alert.result.rerouted, { n: rerouted })}</li>
        {(overridden?.brigade || overridden?.point) && (
          <li className="text-muted-foreground">{tr.alert.result.overridden}</li>
        )}
      </ul>
    </section>
  );
}
