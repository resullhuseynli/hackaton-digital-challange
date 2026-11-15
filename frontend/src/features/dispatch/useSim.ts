import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { simApi } from '@/api/endpoints';
import { errorMessage } from '@/api/http';
import { qk } from '@/api/queryKeys';
import { fill, tr } from '@/i18n';
import { useDispatchStore } from '@/stores/dispatchStore';
import type { BarrierType, LatLng, RoadStatus, SimOccupancy, SimSosBurst } from '@/types/api';

function report(text: string) {
  useDispatchStore.getState().setSimResult(text);
  toast.success(tr.sim.done, { description: text });
}
const fail = (e: unknown) => toast.error(tr.sim.error, { description: errorMessage(e) });

/** All /sim/* commands, shared by map clicks and the Simulation tab. Results are summarised. */
export function useSim() {
  const qc = useQueryClient();

  const road = useMutation({
    mutationFn: (v: LatLng & { status: RoadStatus }) => simApi.roadClosure(v),
    onSuccess: (r) => report(fill(tr.sim.result.road, { n: r.segment_ids.length, r: r.rerouted })),
    onError: fail,
  });

  const barrier = useMutation({
    mutationFn: (v: LatLng & { barrier: BarrierType | null }) => simApi.barrier(v),
    onSuccess: (r) =>
      report(
        r.barrier
          ? fill(tr.sim.result.barrier, { n: r.segment_ids.length, r: r.rerouted })
          : fill(tr.sim.result.barrierRemoved, { n: r.segment_ids.length }),
      ),
    onError: fail,
  });

  const occupancy = useMutation({
    mutationFn: (v: SimOccupancy) => simApi.occupancy(v),
    onSuccess: (r) => {
      const parts = [
        fill(tr.sim.result.occupancy, {
          name: r.point.name,
          pct: Math.round(r.point.occupancy_pct),
          r: r.rerouted,
        }),
      ];
      if (r.alert_id != null) parts.push(fill(tr.sim.result.alert, { id: r.alert_id }));
      report(parts.join(' · '));
      void qc.invalidateQueries({ queryKey: qk.dispatchPoints });
    },
    onError: fail,
  });

  const burst = useMutation({
    mutationFn: (v: SimSosBurst) => simApi.sosBurst(v),
    onSuccess: (r) => {
      report(fill(tr.sim.result.burst, { n: r.sos_ids.length, a: r.alert_ids.length }));
      useDispatchStore.getState().setBurstLocation(null);
    },
    onError: fail,
  });

  const reset = useMutation({
    mutationFn: simApi.reset,
    onSuccess: () => {
      useDispatchStore.setState({
        burstLocation: null,
        simMode: null,
        selection: null,
        openAlertId: null,
        unseenAlertIds: [],
      });
      report(tr.sim.resetDone);
      void qc.invalidateQueries();
    },
    onError: fail,
  });

  return { road, barrier, occupancy, burst, reset };
}
