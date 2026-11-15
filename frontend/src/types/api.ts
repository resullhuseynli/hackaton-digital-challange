/**
 * API types — field names match the backend contract exactly (Swagger: /docs).
 * IDs are `number | string` so the in-browser mock can share them; compare with `sameId`.
 */
import type { Feature, FeatureCollection, LineString, MultiPolygon, Polygon } from 'geojson';

export type Id = number | string;

export interface LatLng {
  lat: number;
  lng: number;
}

/** Server-localized badge, e.g. { code: 'MOBILITY_IMPAIRED', text: 'Hərəkət məhdudiyyətli şəxs' }. */
export interface Label {
  code: 'MOBILITY_IMPAIRED' | (string & {});
  text: string;
}

export type PointType = 'shelter' | 'park' | 'stadium';
export type PointStatus = 'active' | 'reserve' | 'closed';

export interface AssemblyPoint {
  id: Id;
  name: string;
  type: PointType;
  lat: number;
  lng: number;
  zone_id: Id | null;
  capacity: number;
  current_count: number;
  occupancy_pct: number;
  status: PointStatus;
  wheelchair_accessible: boolean;
}

export interface NearestPoint {
  point: AssemblyPoint;
  distance_m: number;
  eta_min: number;
  score: number;
  near_full: boolean;
  /** `static_matrix` = distance/ETA are estimates (routing backup mode). Absent in the mock. */
  source?: 'local_graph' | 'static_matrix';
}

export interface Zone {
  id: Id;
  name: string;
  population?: number;
  /** The backend sends `polygon`; the client normalises it to `geometry`. */
  geometry?: Polygon | MultiPolygon | null;
  center?: LatLng | null;
}

export type RouteReason = 'initial' | 'road_closed' | 'point_full' | 'alert_new_point' | 'barrier';

export interface Route {
  id: Id;
  target_point_id: Id;
  geometry: LineString;
  distance_m: number;
  eta_min: number;
  version: number;
  reason: RouteReason;
  /** true = step-free route (no stairs, steep slopes or underpasses). */
  accessible: boolean;
  created_at: string;
  /** Routing-fallback fields; optional only because the in-browser mock omits them. */
  source?: RouteSource;
  routing_status?: RoutingStatus;
  notice?: Notice | null;
}

export type SosType = 'fire' | 'collapse' | 'flood' | 'medical';
/** `rejected` = marked as spam during quarantine review. */
export type SosStatus = 'new' | 'assigned' | 'resolved' | 'rejected';

export interface Sos {
  id: Id;
  citizen_id: Id;
  type: SosType;
  lat: number;
  lng: number;
  zone_id: Id | null;
  note: string | null;
  priority_score: number;
  status: SosStatus;
  assigned_brigade_id: Id | null;
  brigade_eta_min: number | null;
  created_at: string;
  citizen_mobility_impaired: boolean;
  labels: Label[];
  /** Dispatcher view only (the citizen contract omits them); optional for the in-browser mock. */
  is_suspected?: boolean;
  suspicion_reason?: SuspicionReason | null;
  /** Identical reports from other devices merged into this SOS. */
  duplicate_count?: number;
}

export type BrigadeType = 'fire' | 'medical' | 'rescue';
export type BrigadeStatus = 'idle' | 'en_route' | 'on_site' | 'returning';

export interface Brigade {
  id: Id;
  name: string;
  type: BrigadeType;
  lat: number;
  lng: number;
  status: BrigadeStatus;
  target_sos_id: Id | null;
  route_geometry: LineString | null;
}

export type AlertKind = 'SOS_CLUSTER' | 'POINT_OVERLOAD';
export type AlertStatus = 'active' | 'confirmed' | 'dismissed';

export interface Alert {
  id: Id;
  kind: AlertKind;
  zone_id: Id | null;
  zone_name: string | null;
  center: LatLng;
  radius_m: number;
  sos_ids: Id[];
  distinct_citizens: number;
  point_id: Id | null;
  recommended_brigade: { id: Id; name: string; type: string; eta_min: number | null } | null;
  recommended_new_point: {
    id: Id;
    name: string;
    capacity: number;
    distance_m: number | null;
  } | null;
  mobility_impaired_sos_ids: Id[];
  labels: Label[];
  status: AlertStatus;
  created_at: string;
  updated_at: string;
  /** Present on `alert.resolved` after a confirm. */
  result?: Record<string, unknown> | null;
  /** Present on `alert.resolved` after a dismiss. */
  reason?: string | null;
  /** Not in the contract; the UI assumes a 10-minute cluster window when absent. */
  window_min?: number;
}

export interface Overview {
  active_sos: number;
  active_sos_mobility_impaired: number;
  resolved_sos: number;
  citizens_safe: number;
  citizens_in_danger: number;
  brigades_idle: number;
  brigades_busy: number;
  avg_occupancy_pct: number;
  active_alerts: number;
  /** `null` when the backend does not send it (mock). */
  routing_status?: RoutingStatus | null;
  /** Quarantined SOS awaiting review (not counted in active_sos). */
  suspected_sos?: number;
}

/** One minute of the time series (normalised from `{minute, total, by_type}`). */
export interface TimeseriesBucket {
  ts: string;
  fire: number;
  collapse: number;
  flood: number;
  medical: number;
}

export type CitizenStatus = 'safe' | 'in_danger' | 'unknown';

export interface Citizen {
  id: Id;
  device_id: string;
  phone: string | null;
  lat: number | null;
  lng: number | null;
  zone_id: Id | null;
  status: CitizenStatus;
  target_point_id: Id | null;
  mobility_impaired: boolean;
  updated_at: string;
}

export type PanelRole = 'operator' | 'dispatcher' | 'admin';

export interface LoginResponse {
  access_token: string;
  token_type?: string;
  /** Absent in the in-browser mock (treated as admin there). */
  role?: PanelRole;
  expires_in?: number;
}

export type RoadStatus = 'open' | 'congested' | 'closed';
export type BarrierType = 'stairs' | 'underpass' | 'steep' | 'curb' | 'narrow' | 'inaccessible';

export interface RoadProps {
  id: Id;
  status: RoadStatus;
  congestion_factor?: number;
  speed_kmh?: number;
  length_m?: number;
  barrier?: BarrierType | null;
  accessible?: boolean;
  /** Mock data only. */
  name?: string;
}

export type RoadFeature = Feature<LineString, RoadProps>;
export type RoadCollection = FeatureCollection<LineString, RoadProps>;

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
    /** Legacy/mock field; the backend uses details.retry_after_sec. */
    retry_after?: number;
  };
}

// --- Simulation (/sim/*) ---
export interface SimRoadClosure {
  segment_id?: Id;
  lat?: number;
  lng?: number;
  status: RoadStatus;
  reason?: string;
  congestion_factor?: number;
}
export interface SimRoadClosureResult {
  segment_ids: Id[];
  status: RoadStatus;
  congestion_factor: number;
  rerouted: number;
}
export interface SimBarrier {
  segment_id?: Id;
  lat?: number;
  lng?: number;
  barrier: BarrierType | null;
  reason?: string;
}
export interface SimBarrierResult {
  segment_ids: Id[];
  barrier: BarrierType | null;
  rerouted: number;
}
export type SimOccupancy = { point_id: Id } & ({ current_count: number } | { delta: number });
export interface SimOccupancyResult {
  point: AssemblyPoint;
  rerouted: number;
  alert_id: Id | null;
}
export interface SimSosBurst {
  lat: number;
  lng: number;
  count: number;
  radius_m: number;
  window_sec: number;
  type: SosType;
  seed?: number;
}
export interface SimSosBurstResult {
  citizen_ids: Id[];
  sos_ids: Id[];
  alert_ids: Id[];
}

// --- Routing fallback (external routing API down → local backup) ---
/** `fallback` = served from the local backup while the external routing API is unavailable. */
export type RoutingStatus = 'online' | 'fallback';
/** Server-localized notice, e.g. { code: 'ROUTING_FALLBACK', text: 'Oflayn/Ehtiyat …' }. */
export interface Notice {
  code: 'ROUTING_FALLBACK' | (string & {});
  text: string;
}
/** `static_matrix` = rough 2–3 segment estimate; `cache` = last known route for this trip. */
export type RouteSource = 'external' | 'local_graph' | 'cache' | 'static_matrix';
export type BreakerState = 'closed' | 'open' | 'half_open';
export interface RoutingStatusOut {
  status: RoutingStatus;
  external_configured: boolean;
  breaker: {
    state: BreakerState;
    failures: number;
    last_error: string | null;
    retry_in_sec: number | null;
  };
  fallback_chain: string[];
  notice: Notice | null;
}
export type RoutingFaultMode = 'ok' | 'error_503' | 'timeout';
export interface SimRoutingFault {
  mode: RoutingFaultMode;
  delay_sec?: number;
}
export interface SimRoutingFaultResult {
  provider: unknown;
  routing: RoutingStatusOut;
}

// --- SOS flood protection (quarantine) ---
export type SuspicionReason = 'ip_mass_registration' | 'flood_new_device';
export interface SosReviewResult {
  updated: number;
  alert_ids: Id[];
}
/** Aggregated `sos.suspected` event (at most every 5 s). */
export interface SuspectedData {
  quarantined_pending: number;
  reason: SuspicionReason | null;
  flood_mode: boolean;
}
