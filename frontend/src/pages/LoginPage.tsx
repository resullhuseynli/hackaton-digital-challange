import { useMutation } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { AlertCircle, Clock, Loader2, LogIn, ShieldHalf } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { dispatchApi } from '@/api/endpoints';
import { ApiError, errorMessage } from '@/api/http';
import { Button } from '@/components/ui/button';
import { LanguageSwitcher } from '@/components/ui/language-switcher';
import { Input, Label } from '@/components/ui/misc';
import { useForceDark } from '@/hooks/useSystemTheme';
import { fill, tr } from '@/i18n';
import { formatMmSs } from '@/lib/format';
import { env } from '@/lib/env';
import { useAuthStore } from '@/stores/authStore';
import { useLimitCountdown, useRateLimitStore } from '@/stores/rateLimitStore';

export default function LoginPage() {
  useForceDark();
  const token = useAuthStore((s) => s.token);
  const role = useAuthStore((s) => s.role);
  const reason = useAuthStore((s) => s.logoutReason);
  const login = useAuthStore((s) => s.login);
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  // 429 LOGIN_LOCKED: locked for this username (and IP) until the countdown ends.
  const lockLeft = useLimitCountdown('login');
  const lockedUser = useRateLimitStore((s) => s.loginUser);
  const locked = lockLeft > 0 && (!lockedUser || lockedUser === username.trim());

  const m = useMutation({
    mutationFn: () => dispatchApi.login(username.trim(), password),
    onSuccess: (res) => {
      useRateLimitStore.getState().clear('login');
      // The in-browser mock has no roles: it acts as admin there.
      login(res.access_token, username.trim(), res.role ?? 'admin');
      const from = (location.state as { from?: string } | null)?.from ?? '/dispatcher';
      navigate(from, { replace: true });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'LOGIN_LOCKED') {
        useRateLimitStore.getState().block('login', e.retryAfter ?? 900, username.trim());
      }
    },
  });

  if (token && role) return <Navigate to="/dispatcher" replace />;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password || locked || m.isPending) return;
    m.mutate();
  };

  return (
    <main className="relative grid min-h-full place-items-center overflow-hidden bg-slate-950 p-4">
      <div
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          backgroundImage:
            'radial-gradient(circle at 20% 20%, rgba(220,38,38,0.25), transparent 40%), radial-gradient(circle at 80% 70%, rgba(37,99,235,0.25), transparent 45%)',
        }}
        aria-hidden
      />
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative w-full max-w-md rounded-2xl border bg-card/90 p-8 shadow-lift backdrop-blur"
      >
        <LanguageSwitcher size="sm" className="absolute right-4 top-4" />
        <div className="mb-6 flex items-center gap-3">
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-danger text-white">
            <ShieldHalf className="h-7 w-7" aria-hidden />
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
              {tr.app.fhn} · {tr.app.dispatchTitle}
            </p>
            <h1 className="text-2xl font-extrabold">{tr.auth.title}</h1>
          </div>
        </div>
        <p className="mb-6 text-sm text-muted-foreground">{tr.auth.subtitle}</p>

        {(m.isError || reason) && (
          <div
            role="alert"
            className="mb-4 flex items-start gap-2 rounded-xl border border-danger/40 bg-danger/10 p-3 text-sm text-red-300"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>{m.isError ? errorMessage(m.error) : reason}</span>
          </div>
        )}

        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <div className="flex flex-col gap-2">
            <Label htmlFor="username">{tr.auth.username}</Label>
            <Input
              id="username"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoFocus
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="password">{tr.auth.password}</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <Button
            type="submit"
            size="lg"
            disabled={m.isPending || locked || !username.trim() || !password}
            aria-describedby={locked ? 'login-lock' : undefined}
          >
            {m.isPending ? (
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
            ) : locked ? (
              <Clock className="h-5 w-5" aria-hidden />
            ) : (
              <LogIn className="h-5 w-5" aria-hidden />
            )}
            {m.isPending ? tr.auth.submitting : tr.auth.submit}
          </Button>
          {locked && (
            <p
              id="login-lock"
              role="status"
              className="tabular -mt-1 text-center text-sm font-semibold text-amber-300"
            >
              {fill(tr.auth.lockedFor, { t: formatMmSs(lockLeft) })}
            </p>
          )}
        </form>
        {env.useMocks && (
          <p className="mt-4 text-center text-xs text-muted-foreground">{tr.auth.demoHint}</p>
        )}
      </motion.div>
    </main>
  );
}
