import { haversine } from './geo';

/** Client-side brigade ETA estimate in minutes (road factor 1.3, ~36 km/h average). */
export const estimateEta = (from: { lat: number; lng: number }, to: { lat: number; lng: number }) =>
  Math.max(1, Math.round((haversine(from, to) * 1.3) / 600));
