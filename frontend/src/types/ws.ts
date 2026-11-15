import type {
  Alert,
  AssemblyPoint,
  Brigade,
  Id,
  RoadFeature,
  RoadProps,
  RoadStatus,
  Route,
  RouteReason,
  RoutingStatusOut,
  SuspectedData,
  Sos,
} from './api';

export interface WsEnvelope<T extends string, D> {
  type: T;
  data: D;
  ts: string;
}

export interface ReroutedData {
  old_route: Route | null;
  new_route: Route;
  reason: RouteReason;
  /** `null` from the backend when there was no previous route. */
  eta_diff_min: number | null;
  /** Present on the dispatcher channel. */
  citizen_id?: Id;
}

/** point.occupancy may carry a full point or just the counters. */
export type PointOccupancyData = Partial<AssemblyPoint> & {
  point_id?: Id;
  id?: Id;
  current_count: number;
  occupancy_pct: number;
};

export interface BroadcastData {
  title?: string;
  message: string;
  level?: 'info' | 'warning' | 'danger';
}

export type CitizenEvent =
  | WsEnvelope<'route.rerouted', ReroutedData>
  | WsEnvelope<'sos.updated', Sos>
  | WsEnvelope<'point.occupancy', PointOccupancyData>
  | WsEnvelope<'broadcast.message', BroadcastData>
  | WsEnvelope<'routing.status', RoutingStatusOut>
  | WsEnvelope<'pong', unknown>;

/** Backend sends `{segments: [{id, status, congestion_factor}]}`; the mock sends one feature. */
export type RoadUpdatedData =
  | RoadFeature
  | {
      segments: ({ id: Id; status: RoadStatus } & Partial<
        Pick<RoadProps, 'congestion_factor' | 'barrier' | 'accessible'>
      >)[];
      reason?: string | null;
    };

/** Dispatchers get an aggregated `{count, reason}` from the backend, per-citizen data from the mock. */
export type DispatchReroutedData = Partial<ReroutedData> & { count?: number };

/** Partial payloads are possible (e.g. priority recalculation); handlers merge them. */
type WithId<T extends { id: Id }> = Partial<T> & Pick<T, 'id'>;

export type DispatchEvent =
  | WsEnvelope<'sos.created', Sos>
  | WsEnvelope<'sos.updated', WithId<Sos>>
  | WsEnvelope<'point.occupancy', PointOccupancyData>
  | WsEnvelope<'road.updated', RoadUpdatedData>
  | WsEnvelope<'route.rerouted', DispatchReroutedData>
  | WsEnvelope<'brigade.updated', WithId<Brigade>>
  | WsEnvelope<'alert.raised', Alert>
  | WsEnvelope<'alert.updated', WithId<Alert>>
  | WsEnvelope<'alert.resolved', WithId<Alert>>
  | WsEnvelope<'sim.reset', Record<string, never>>
  | WsEnvelope<'overview.updated', unknown>
  | WsEnvelope<'sos.suspected', SuspectedData>
  | WsEnvelope<'routing.status', RoutingStatusOut>
  | WsEnvelope<'pong', unknown>;
