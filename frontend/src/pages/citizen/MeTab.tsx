import {
  Info,
  LocateFixed,
  MapPin,
  Phone,
  ShieldCheck,
  ShieldQuestion,
  UserRound,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useCitizen } from '@/features/citizen/citizenContext';
import { LanguageSwitcher } from '@/components/ui/language-switcher';
import { ProfileForm } from '@/features/citizen/ProfileForm';
import { SafeSwitch } from '@/features/citizen/SafeSwitch';
import { fill, tr } from '@/i18n';
import { getDeviceId } from '@/lib/deviceId';
import { formatClock } from '@/lib/format';
import { useCitizenStore } from '@/stores/citizenStore';
import { TabPage } from './TabPage';

const NUMBERS = ['112', '101', '102', '103'] as const;

/** Personal status, location settings, emergency numbers and short safety tips. */
export default function MeTab() {
  const { location, zones, setManualMode } = useCitizen();
  const safeSince = useCitizenStore((s) => s.safeSince);
  const citizenStatus = useCitizenStore((s) => s.citizenStatus);
  const zoneId = useCitizenStore((s) => s.zoneId);
  const navigate = useNavigate();
  const zone = zones?.find((z) => String(z.id) === String(zoneId));

  const changeLocation = () => {
    const st = useCitizenStore.getState();
    st.setOnboarded(false);
    setManualMode(location?.source !== 'gps');
    navigate('/');
  };

  return (
    <TabPage icon={UserRound} title={tr.citizen.me.title} subtitle={tr.citizen.me.subtitle}>
      <section className="rounded-2xl border bg-card p-4" aria-labelledby="st-title">
        <h3
          id="st-title"
          className="mb-3 text-sm font-bold uppercase tracking-wide text-muted-foreground"
        >
          {tr.citizen.me.status}
        </h3>
        <p className="mb-3 flex items-center gap-2 text-sm">
          {citizenStatus === 'safe' && safeSince ? (
            <>
              <ShieldCheck className="h-5 w-5 text-safe" aria-hidden />
              {fill(tr.citizen.me.safeSince, { t: formatClock(new Date(safeSince)) })}
            </>
          ) : (
            <>
              <ShieldQuestion className="h-5 w-5 text-warning" aria-hidden />
              {tr.citizen.me.notMarked}
            </>
          )}
        </p>
        <SafeSwitch />
      </section>

      <section className="rounded-2xl border bg-card p-4" aria-labelledby="profile-title">
        <h3
          id="profile-title"
          className="mb-3 text-sm font-bold uppercase tracking-wide text-muted-foreground"
        >
          {tr.citizen.profile.title}
        </h3>
        <ProfileForm
          submitLabel={tr.citizen.profile.save}
          onSaved={() => toast.success(tr.citizen.profile.saved)}
        />
      </section>

      <section className="rounded-2xl border bg-card p-4" aria-labelledby="loc-title">
        <h3
          id="loc-title"
          className="mb-3 text-sm font-bold uppercase tracking-wide text-muted-foreground"
        >
          {tr.citizen.me.location}
        </h3>
        <dl className="flex flex-col gap-2 text-sm">
          <div className="flex items-center justify-between gap-3">
            <dt className="flex items-center gap-2 text-muted-foreground">
              <LocateFixed className="h-4 w-4" aria-hidden />
              {tr.citizen.me.location}
            </dt>
            <dd className="font-medium">
              {location?.source === 'gps'
                ? tr.citizen.me.gps
                : location
                  ? tr.citizen.me.manual
                  : tr.citizen.me.none}
            </dd>
          </div>
          {zone && (
            <div className="flex items-center justify-between gap-3">
              <dt className="flex items-center gap-2 text-muted-foreground">
                <MapPin className="h-4 w-4" aria-hidden />
                {tr.citizen.me.district}
              </dt>
              <dd className="font-medium">{zone.name}</dd>
            </div>
          )}
        </dl>
        <Button variant="outline" size="lg" className="mt-4 w-full" onClick={changeLocation}>
          <MapPin className="h-5 w-5" aria-hidden />
          {tr.citizen.me.change}
        </Button>
      </section>

      <section className="rounded-2xl border bg-card p-4" aria-labelledby="lang-title">
        <h3
          id="lang-title"
          className="mb-3 text-sm font-bold uppercase tracking-wide text-muted-foreground"
        >
          {tr.language.label}
        </h3>
        <LanguageSwitcher className="w-full justify-between" />
      </section>

      <section className="rounded-2xl border bg-card p-4" aria-labelledby="em-title">
        <h3
          id="em-title"
          className="mb-3 text-sm font-bold uppercase tracking-wide text-muted-foreground"
        >
          {tr.citizen.me.emergency}
        </h3>
        <ul className="grid grid-cols-2 gap-2">
          {NUMBERS.map((n) => (
            <li key={n}>
              <a
                href={`tel:${n}`}
                aria-label={fill(tr.citizen.me.call, { n: n })}
                className="flex min-h-[64px] flex-col justify-center rounded-xl border bg-background/60 px-3 py-2 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="flex items-center gap-2 text-xl font-black">
                  <Phone className="h-4 w-4 text-danger" aria-hidden />
                  {n}
                </span>
                <span className="text-xs text-muted-foreground">{tr.citizen.me.numbers[n]}</span>
              </a>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-2xl border bg-card p-4" aria-labelledby="tips-title">
        <h3
          id="tips-title"
          className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-muted-foreground"
        >
          <Info className="h-4 w-4" aria-hidden />
          {tr.citizen.me.tipsTitle}
        </h3>
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm">
          {tr.citizen.me.tips.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </section>

      <p className="tabular text-center text-xs text-muted-foreground">
        {tr.citizen.me.device}: {getDeviceId().slice(0, 8)}
      </p>
    </TabPage>
  );
}
