import { motion } from 'framer-motion';
import { Hand, Loader2, LocateFixed, MapPin, ShieldAlert } from 'lucide-react';
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';

import { Label } from '@/components/ui/misc';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ErrorState } from '@/components/ui/states';
import type { GeoPermission } from '@/hooks/useGeolocation';
import { tr } from '@/i18n';
import { zoneCenter } from '@/lib/zones';
import { useCitizenStore } from '@/stores/citizenStore';
import { ProfileForm } from './ProfileForm';
import { useZones } from './queries';

interface Props {
  permission: GeoPermission;
  locating: boolean;
  hasFix: boolean;
  onRequest: () => void;
  manualMode: boolean;
  setManualMode: (v: boolean) => void;
}

export function Onboarding({
  permission,
  locating,
  hasFix,
  onRequest,
  manualMode,
  setManualMode,
}: Props) {
  const zones = useZones();
  const zoneId = useCitizenStore((s) => s.zoneId);
  const manual = useCitizenStore((s) => s.manualLocation);
  const setZoneId = useCitizenStore((s) => s.setZoneId);
  const setManual = useCitizenStore((s) => s.setManualLocation);
  const setOnboarded = useCitizenStore((s) => s.setOnboarded);
  const profileDone = useCitizenStore((s) => s.profileDone);

  useEffect(() => {
    if (hasFix && profileDone) setOnboarded(true);
  }, [hasFix, profileDone, setOnboarded]);

  useEffect(() => {
    if (permission === 'denied' || permission === 'unavailable') setManualMode(true);
  }, [permission, setManualMode]);

  const finish = () => {
    if (!manual && zoneId != null) {
      const z = zones.data?.find((x) => String(x.id) === String(zoneId));
      const c = z ? zoneCenter(z) : null;
      if (c) setManual(c);
    }
    setOnboarded(true);
  };

  return (
    <motion.div
      initial={{ y: 60, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      className="safe-bottom fixed inset-x-0 bottom-0 z-40 mx-auto max-w-xl rounded-t-3xl border bg-card p-5 shadow-lift"
      role="dialog"
      aria-labelledby="onb-title"
    >
      {!profileDone ? (
        // Step 1: registration (phone + "Hərəkət məhdudiyyətli şəxs").
        <div className="scrollbar-thin flex max-h-[75vh] flex-col gap-4 overflow-y-auto">
          <div>
            <h1 id="onb-title" className="text-2xl font-extrabold leading-tight">
              {tr.citizen.register.title}
            </h1>
            <p className="mt-1 text-base text-muted-foreground">{tr.citizen.register.subtitle}</p>
          </div>
          <ProfileForm
            submitLabel={tr.citizen.register.continue}
            onSaved={() => useCitizenStore.getState().setProfileDone(true)}
          />
        </div>
      ) : !manualMode ? (
        <div className="flex flex-col gap-4">
          <div className="grid h-14 w-14 place-items-center rounded-2xl bg-info/10 text-info">
            <LocateFixed className="h-7 w-7" aria-hidden />
          </div>
          <div>
            <h1 id="onb-title" className="text-2xl font-extrabold leading-tight">
              {tr.citizen.onboarding.title}
            </h1>
            <p className="mt-1 text-base text-muted-foreground">{tr.citizen.onboarding.subtitle}</p>
          </div>
          <Button size="xl" onClick={onRequest} disabled={locating}>
            {locating ? (
              <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
            ) : (
              <MapPin className="h-6 w-6" aria-hidden />
            )}
            {locating ? tr.citizen.onboarding.locating : tr.citizen.onboarding.allow}
          </Button>
          <Button variant="ghost" size="lg" onClick={() => setManualMode(true)}>
            <Hand className="h-5 w-5" aria-hidden />
            {tr.citizen.onboarding.manual}
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            {tr.citizen.onboarding.privacy}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {permission === 'denied' && (
            <div className="flex items-start gap-3 rounded-2xl bg-warning/15 p-3 text-sm">
              <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden />
              <div>
                <p className="font-semibold">{tr.citizen.onboarding.denied}</p>
                <p className="text-muted-foreground">{tr.citizen.onboarding.deniedHint}</p>
              </div>
            </div>
          )}
          <h1 id="onb-title" className="text-xl font-extrabold">
            {tr.citizen.onboarding.chooseZone}
          </h1>
          {zones.isError ? (
            <ErrorState
              compact
              title={tr.app.unknownError}
              error={zones.error}
              onRetry={() => zones.refetch()}
            />
          ) : (
            <div className="flex flex-col gap-2">
              <Label htmlFor="zone-select">{tr.citizen.onboarding.chooseZone}</Label>
              <Select
                value={zoneId != null ? String(zoneId) : undefined}
                onValueChange={(v) => {
                  setZoneId(v);
                  const z = zones.data?.find((x) => String(x.id) === v);
                  const c = z ? zoneCenter(z) : null;
                  if (c) setManual(c);
                }}
                disabled={zones.isLoading}
              >
                <SelectTrigger id="zone-select" className="h-12 text-base">
                  <SelectValue
                    placeholder={
                      zones.isLoading ? tr.app.loading : tr.citizen.onboarding.chooseZone
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {zones.data?.map((z) => (
                    <SelectItem key={String(z.id)} value={String(z.id)} className="py-3 text-base">
                      {z.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <p className="flex items-center gap-2 rounded-xl bg-muted px-3 py-2 text-sm">
            <Hand className="h-4 w-4 shrink-0 text-info" aria-hidden />
            {manual ? `${tr.citizen.onboarding.tapMap} ✓` : tr.citizen.onboarding.tapMapHint}
          </p>
          <Button size="xl" onClick={finish} disabled={!manual && zoneId == null}>
            {tr.citizen.onboarding.continue}
          </Button>
          {permission !== 'denied' && permission !== 'unavailable' && (
            <Button variant="ghost" onClick={() => setManualMode(false)}>
              <LocateFixed className="h-5 w-5" aria-hidden />
              {tr.citizen.onboarding.allow}
            </Button>
          )}
        </div>
      )}
    </motion.div>
  );
}
