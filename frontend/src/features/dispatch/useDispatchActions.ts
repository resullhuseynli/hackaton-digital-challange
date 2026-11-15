import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { dispatchApi } from '@/api/endpoints';
import { qk } from '@/api/queryKeys';
import { tr } from '@/i18n';
import { sameId } from '@/lib/utils';
import { useDispatchStore, type Selection } from '@/stores/dispatchStore';
import type { LatLng, Sos } from '@/types/api';
import { actionErrorToast } from '@/lib/actionError';

export const MAP_PATH = '/dispatcher';

/** Select an object and fly to it — switching to the map page first when needed. */
export function useShowOnMap() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  return useCallback(
    (selection: NonNullable<Selection>, at: LatLng, zoom = 15) => {
      const st = useDispatchStore.getState();
      st.select(selection);
      st.focusOn(at, zoom);
      if (pathname !== MAP_PATH) navigate(MAP_PATH);
    },
    [navigate, pathname],
  );
}

export function useResolveSos(sos: Sos) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => dispatchApi.resolveSos(sos.id),
    onSuccess: (updated) => {
      qc.setQueryData<Sos[]>(qk.sos, (old) =>
        old?.map((s) => (sameId(s.id, sos.id) ? { ...s, ...updated, status: 'resolved' } : s)),
      );
      toast.success(tr.dispatch.assign.resolved);
    },
    onError: (e) => actionErrorToast(e, tr.app.unknownError),
  });
}
