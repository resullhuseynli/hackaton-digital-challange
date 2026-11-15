import { useMutation } from '@tanstack/react-query';
import { Accessibility, Clock, Loader2 } from 'lucide-react';
import { useId, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { citizenApi } from '@/api/endpoints';
import { ApiError, errorMessage } from '@/api/http';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/misc';
import { fill, tr } from '@/i18n';
import { formatMmSs } from '@/lib/format';
import { getDeviceId } from '@/lib/deviceId';
import { useCitizenStore } from '@/stores/citizenStore';
import { useLimitCountdown, useRateLimitStore } from '@/stores/rateLimitStore';

/** +994 followed by 9 digits; spaces and dashes are allowed. Empty is fine (optional). */
const PHONE_RE = /^\+994[\s-]?\d{2}[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}$/;

/**
 * Phone + "Hərəkət məhdudiyyətli şəxs" checkbox → POST /citizens/register (idempotent).
 * Used for first registration and later edits on the profile screen.
 */
export function ProfileForm({
  submitLabel,
  onSaved,
}: {
  submitLabel: string;
  onSaved?: () => void;
}) {
  const savedPhone = useCitizenStore((s) => s.phone);
  const savedMi = useCitizenStore((s) => s.mobilityImpaired);
  const [phone, setPhone] = useState(savedPhone);
  const [mi, setMi] = useState(savedMi);
  const [touched, setTouched] = useState(false);
  const ids = {
    phone: useId(),
    hint: useId(),
    mi: useId(),
    miHelp: useId(),
    err: useId(),
    wait: useId(),
  };
  const trimmed = phone.trim();
  const phoneValid = !trimmed || PHONE_RE.test(trimmed);
  // 429 RATE_LIMITED on registration: the button stays disabled until the server's wait is over.
  const limited = useLimitCountdown('register');

  const m = useMutation({
    mutationFn: () =>
      citizenApi.register(getDeviceId(), { phone: trimmed || null, mobility_impaired: mi }),
    onSuccess: (c) => {
      const st = useCitizenStore.getState();
      st.setProfile({ phone: c.phone ?? trimmed, mobilityImpaired: c.mobility_impaired });
      st.setRegistered(true);
      if (c.status) st.setCitizenStatus(c.status);
      onSaved?.();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 429) {
        useRateLimitStore.getState().block('register', e.retryAfter ?? 60);
      }
      toast.error(tr.citizen.register.error, { description: errorMessage(e) });
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!phoneValid || limited > 0 || m.isPending) return;
    m.mutate();
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={ids.phone} className="text-sm font-semibold">
          {tr.citizen.register.phone}
        </label>
        <Input
          id={ids.phone}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="+994 50 123 45 67"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          onBlur={() => setTouched(true)}
          aria-describedby={`${ids.hint}${touched && !phoneValid ? ` ${ids.err}` : ''}`}
          aria-invalid={touched && !phoneValid}
          className="h-12 text-base"
        />
        <p id={ids.hint} className="text-xs text-muted-foreground">
          {tr.citizen.register.phoneHint}
        </p>
        {touched && !phoneValid && (
          <p
            id={ids.err}
            role="alert"
            className="text-sm font-medium text-red-700 dark:text-red-400"
          >
            {tr.citizen.register.phoneInvalid}
          </p>
        )}
      </div>

      {/* A real checkbox with a label and a description (brief §6). */}
      <div className="flex items-start gap-3 rounded-2xl border-2 border-violet-600/40 bg-violet-600/5 p-4">
        <input
          id={ids.mi}
          type="checkbox"
          checked={mi}
          onChange={(e) => setMi(e.target.checked)}
          aria-describedby={ids.miHelp}
          className="mt-0.5 h-6 w-6 shrink-0 cursor-pointer accent-violet-700"
        />
        <div className="min-w-0">
          <label
            htmlFor={ids.mi}
            className="flex cursor-pointer items-center gap-2 text-base font-bold"
          >
            <Accessibility className="h-5 w-5 text-violet-700 dark:text-violet-400" aria-hidden />
            {tr.citizen.register.mi}
          </label>
          <p id={ids.miHelp} className="mt-1 text-sm text-muted-foreground">
            {tr.citizen.register.miHelp}
          </p>
        </div>
      </div>

      <Button
        type="submit"
        size="xl"
        disabled={m.isPending || limited > 0}
        aria-describedby={limited > 0 ? ids.wait : undefined}
      >
        {m.isPending ? (
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
        ) : (
          limited > 0 && <Clock className="h-5 w-5" aria-hidden />
        )}
        {m.isPending ? tr.citizen.register.saving : submitLabel}
      </Button>
      {limited > 0 && (
        <p
          id={ids.wait}
          className="tabular -mt-2 text-center text-sm text-muted-foreground"
          role="status"
        >
          {fill(tr.limits.retryIn, { t: formatMmSs(limited) })}
        </p>
      )}
    </form>
  );
}
