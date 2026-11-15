import { useMutation } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertCircle, Clock, CloudOff, Copy, Loader2, MapPinOff, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { citizenApi } from '@/api/endpoints';
import { ApiError, errorMessage } from '@/api/http';
import { Button } from '@/components/ui/button';
import { fill, tr } from '@/i18n';
import { formatMmSs } from '@/lib/format';
import { SOS_META, SOS_TYPES } from '@/lib/status';
import { uuid, vibrate } from '@/lib/utils';
import { useCitizenStore } from '@/stores/citizenStore';
import { useConnectionStore } from '@/stores/connectionStore';
import type { LatLng, SosType } from '@/types/api';
import { SosSteps } from './SosStatus';
import { BrigadeEta } from './BrigadeEta';
import { sosStatusText } from './sosText';

type Phase =
  | { k: 'choose' }
  | { k: 'countdown'; type: SosType }
  | { k: 'sending'; type: SosType; key: string }
  /** `duplicate`: merged into an identical report from the same spot (already reported). */
  | { k: 'sent'; duplicate?: boolean }
  | { k: 'queued' }
  | { k: 'cooldown'; message: string }
  /** `key`: the Idempotency-Key of the failed attempt, reused by "Retry". */
  | { k: 'error'; type: SosType; key: string; message: string };

const COUNTDOWN_S = 3;

interface Props {
  open: boolean;
  onClose: () => void;
  location: LatLng | null;
  hasPreciseLocation: boolean;
}

export function SosSheet({ open, onClose, location, hasPreciseLocation }: Props) {
  const [phase, setPhase] = useState<Phase>({ k: 'choose' });
  const [note, setNote] = useState('');
  const cooldownUntil = useCitizenStore((s) => s.cooldownUntil);
  const activeSos = useCitizenStore((s) => s.activeSos);
  const cleanNote = note.trim() || undefined;

  useEffect(() => {
    if (!open) return;
    setNote('');
    if (cooldownUntil && cooldownUntil > Date.now() && activeSos) setPhase({ k: 'sent' });
    else if (cooldownUntil && cooldownUntil > Date.now())
      setPhase({ k: 'cooldown', message: tr.citizen.sos.cooldown });
    else setPhase({ k: 'choose' });
    // Only re-evaluate when the sheet opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const send = useMutation({
    mutationFn: ({ type, key }: { type: SosType; key: string }) => {
      if (!location) throw new ApiError(0, 'NO_LOCATION', tr.citizen.sos.noLocation);
      return citizenApi.createSos(
        { type, lat: location.lat, lng: location.lng, note: cleanNote },
        key,
      );
    },
    onSuccess: ({ sos, duplicateOf }) => {
      const st = useCitizenStore.getState();
      // A merged duplicate returns the incident it joined: track that one.
      st.setActiveSos(sos);
      st.setCooldownUntil(Date.now() + 60_000);
      vibrate([100, 60, 100]);
      setPhase({ k: 'sent', duplicate: duplicateOf != null });
    },
    onError: (e, { type, key }) => {
      if (e instanceof ApiError && e.status === 429) {
        // RATE_LIMITED or SOS_COOLDOWN: wait exactly as long as the server says; no auto-retry.
        const secs = e.retryAfter ?? 60;
        useCitizenStore.getState().setCooldownUntil(Date.now() + secs * 1000);
        setPhase({ k: 'cooldown', message: e.message || tr.citizen.sos.cooldown });
        return;
      }
      if (e instanceof ApiError && e.isNetwork && location) {
        queue(type, key);
        return;
      }
      setPhase({ k: 'error', type, key, message: errorMessage(e) });
    },
  });

  /** Offline: the queued item keeps the attempt's key, so a later flush cannot create a second SOS. */
  const queue = (type: SosType, key: string = uuid()) => {
    if (!location) return;
    useCitizenStore.getState().enqueueSos({
      localId: key,
      type,
      lat: location.lat,
      lng: location.lng,
      note: cleanNote,
      queuedAt: Date.now(),
    });
    vibrate([80, 40, 80]);
    setPhase({ k: 'queued' });
  };

  /** `key`: reuse the failed attempt's Idempotency-Key on retry; a fresh report gets a new one. */
  const fire = (type: SosType, key: string = uuid()) => {
    if (send.isPending) return; // no double submit
    const online = useConnectionStore.getState().online;
    if (!online) {
      queue(type, key);
      return;
    }
    setPhase({ k: 'sending', type, key });
    send.mutate({ type, key });
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[55] flex flex-col bg-slate-950 text-white"
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 40 }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="sos-title"
        >
          <div className="safe-top mx-auto flex w-full max-w-xl flex-1 flex-col overflow-y-auto p-4">
            <div className="flex items-center justify-between">
              <h2 id="sos-title" className="text-2xl font-extrabold">
                {phase.k === 'choose' ? tr.citizen.sos.title : tr.citizen.sos.button}
              </h2>
              <Button
                variant="ghost"
                size="icon-lg"
                className="text-white hover:bg-white/10 hover:text-white"
                onClick={onClose}
                aria-label={tr.citizen.sos.close}
                disabled={phase.k === 'sending'}
              >
                <X className="h-7 w-7" aria-hidden />
              </Button>
            </div>

            {phase.k === 'choose' && (
              <ChooseType
                onPick={(type) => setPhase({ k: 'countdown', type })}
                hasPreciseLocation={hasPreciseLocation}
                note={note}
                onNote={setNote}
              />
            )}
            {phase.k === 'countdown' && (
              <Countdown
                type={phase.type}
                onDone={() => fire(phase.type)}
                onCancel={() => setPhase({ k: 'choose' })}
              />
            )}
            {phase.k === 'sending' && (
              <Centered>
                <Loader2 className="h-16 w-16 animate-spin" aria-hidden />
                <p className="text-xl font-bold">{tr.citizen.sos.sending}</p>
              </Centered>
            )}
            {phase.k === 'sent' && activeSos && (
              <Centered>
                <motion.div
                  initial={{ scale: 0.5 }}
                  animate={{ scale: 1 }}
                  className="grid h-24 w-24 place-items-center rounded-full bg-danger"
                >
                  {(() => {
                    const Icon = SOS_META[activeSos.type].icon;
                    return <Icon className="h-12 w-12" aria-hidden />;
                  })()}
                </motion.div>
                <p className="text-3xl font-extrabold">{tr.citizen.sos.received}</p>
                {phase.duplicate && (
                  <p
                    className="flex max-w-sm items-start gap-2 rounded-xl bg-white/10 px-3 py-2 text-left text-base font-semibold"
                    role="status"
                  >
                    <Copy className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
                    {tr.citizen.sos.duplicate}
                  </p>
                )}
                <p className="text-lg text-white/85" aria-live="polite">
                  {sosStatusText(activeSos)}
                </p>
                <div className="w-full max-w-sm rounded-2xl bg-white p-4 text-slate-900">
                  <SosSteps status={activeSos.status} />
                  <BrigadeEta sos={activeSos} className="mt-3 justify-center" />
                </div>
                <p className="max-w-sm text-white/75">{tr.citizen.sos.stayCalm}</p>
                <Button size="xl" variant="secondary" className="w-full max-w-sm" onClick={onClose}>
                  {tr.citizen.sos.close}
                </Button>
              </Centered>
            )}
            {phase.k === 'queued' && (
              <Centered>
                <div className="grid h-24 w-24 place-items-center rounded-full bg-warning text-slate-950">
                  <CloudOff className="h-12 w-12" aria-hidden />
                </div>
                <p className="text-2xl font-extrabold">{tr.citizen.sos.queued}</p>
                <p className="max-w-sm text-lg text-white/85">{tr.citizen.sos.queuedHint}</p>
                <Button size="xl" variant="secondary" className="w-full max-w-sm" onClick={onClose}>
                  {tr.citizen.sos.close}
                </Button>
              </Centered>
            )}
            {phase.k === 'cooldown' && (
              <Cooldown
                message={phase.message}
                onExpired={() => setPhase({ k: 'choose' })}
                onClose={onClose}
              />
            )}
            {phase.k === 'error' && (
              <Centered>
                <div className="grid h-24 w-24 place-items-center rounded-full bg-danger">
                  <AlertCircle className="h-12 w-12" aria-hidden />
                </div>
                <p className="text-2xl font-extrabold">{tr.citizen.sos.error}</p>
                <p className="max-w-sm text-lg text-white/85">{phase.message}</p>
                <Button
                  size="xl"
                  variant="danger"
                  className="w-full max-w-sm"
                  onClick={() => fire(phase.type, phase.key)}
                  disabled={send.isPending}
                >
                  {tr.app.retry}
                </Button>
              </Centered>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-5 py-8 text-center">
      {children}
    </div>
  );
}

function ChooseType({
  onPick,
  hasPreciseLocation,
  note,
  onNote,
}: {
  onPick: (t: SosType) => void;
  hasPreciseLocation: boolean;
  note: string;
  onNote: (v: string) => void;
}) {
  return (
    <div className="mt-2 flex flex-1 flex-col gap-4">
      <p className="text-base text-white/80">{tr.citizen.sos.subtitle}</p>
      {!hasPreciseLocation && (
        <p className="flex items-center gap-2 rounded-xl bg-warning/20 px-3 py-2 text-sm font-medium text-amber-200">
          <MapPinOff className="h-4 w-4 shrink-0" aria-hidden />
          {tr.citizen.sos.noLocation}
        </p>
      )}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="sos-note" className="text-sm font-semibold text-white/90">
          {tr.citizen.sos.note}
        </label>
        <textarea
          id="sos-note"
          value={note}
          onChange={(e) => onNote(e.target.value)}
          maxLength={500}
          rows={2}
          placeholder={tr.citizen.sos.notePlaceholder}
          className="w-full rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-base text-white placeholder:text-white/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
        />
      </div>
      <div className="grid flex-1 grid-cols-2 gap-4">
        {SOS_TYPES.map((t, i) => {
          const m = SOS_META[t];
          const Icon = m.icon;
          return (
            <motion.button
              key={t}
              type="button"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: i * 0.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => {
                vibrate(40);
                onPick(t);
              }}
              className="flex min-h-[150px] flex-col items-center justify-center gap-3 rounded-3xl p-4 text-white shadow-xl ring-2 ring-white/10 focus-visible:ring-4 focus-visible:ring-white"
              style={{ backgroundColor: m.color }}
            >
              <Icon className="h-14 w-14" strokeWidth={2.2} aria-hidden />
              <span className="text-xl font-extrabold">{m.label}</span>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}

function Countdown({
  type,
  onDone,
  onCancel,
}: {
  type: SosType;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [left, setLeft] = useState(COUNTDOWN_S);
  const done = useRef(onDone);
  done.current = onDone;
  const m = SOS_META[type];
  const Icon = m.icon;

  useEffect(() => {
    vibrate(80);
    const started = Date.now();
    const id = window.setInterval(() => {
      const remaining = COUNTDOWN_S - Math.floor((Date.now() - started) / 1000);
      setLeft(remaining);
      if (remaining > 0) vibrate(80);
      if (remaining <= 0) {
        window.clearInterval(id);
        done.current();
      }
    }, 200);
    return () => window.clearInterval(id);
  }, []);

  const r = 88;
  const c = 2 * Math.PI * r;
  return (
    <Centered>
      <p className="text-xl font-bold" aria-live="assertive">
        {tr.citizen.sos.countdown}: {m.label}
      </p>
      <div className="relative grid h-56 w-56 place-items-center">
        <svg viewBox="0 0 200 200" className="absolute inset-0 -rotate-90" aria-hidden>
          <circle
            cx="100"
            cy="100"
            r={r}
            fill="none"
            stroke="rgba(255,255,255,0.15)"
            strokeWidth="12"
          />
          <motion.circle
            cx="100"
            cy="100"
            r={r}
            fill="none"
            stroke={m.color}
            strokeWidth="12"
            strokeLinecap="round"
            strokeDasharray={c}
            initial={{ strokeDashoffset: 0 }}
            animate={{ strokeDashoffset: c }}
            transition={{ duration: COUNTDOWN_S, ease: 'linear' }}
          />
        </svg>
        <div className="flex flex-col items-center">
          <Icon className="h-10 w-10" style={{ color: m.color }} aria-hidden />
          <AnimatePresence mode="popLayout">
            <motion.span
              key={left}
              initial={{ scale: 1.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.6, opacity: 0 }}
              className="tabular text-7xl font-black"
            >
              {Math.max(0, left)}
            </motion.span>
          </AnimatePresence>
        </div>
      </div>
      <p className="text-white/75">{tr.citizen.sos.countdownHint}</p>
      <Button
        size="xl"
        variant="secondary"
        className="h-16 w-full max-w-sm text-xl font-extrabold"
        onClick={onCancel}
        autoFocus
      >
        {tr.citizen.sos.cancel}
      </Button>
    </Centered>
  );
}

function Cooldown({
  message,
  onExpired,
  onClose,
}: {
  message: string;
  onExpired: () => void;
  onClose: () => void;
}) {
  const until = useCitizenStore((s) => s.cooldownUntil) ?? Date.now();
  const [left, setLeft] = useState(() => (until - Date.now()) / 1000);
  const expired = useRef(onExpired);
  expired.current = onExpired;
  useEffect(() => {
    const id = window.setInterval(() => {
      const l = (until - Date.now()) / 1000;
      setLeft(l);
      if (l <= 0) {
        window.clearInterval(id);
        expired.current();
      }
    }, 250);
    return () => window.clearInterval(id);
  }, [until]);

  return (
    <Centered>
      <div className="grid h-24 w-24 place-items-center rounded-full bg-info">
        <Clock className="h-12 w-12" aria-hidden />
      </div>
      <p className="max-w-sm text-2xl font-extrabold">{message}</p>
      <p className="tabular text-lg text-white/85" aria-live="polite">
        {fill(tr.citizen.sos.cooldownLeft, { s: formatMmSs(left) })}
      </p>
      <p className="max-w-sm text-white/75">{tr.citizen.sos.stayCalm}</p>
      <Button size="xl" variant="secondary" className="w-full max-w-sm" onClick={onClose}>
        {tr.citizen.sos.close}
      </Button>
    </Centered>
  );
}
