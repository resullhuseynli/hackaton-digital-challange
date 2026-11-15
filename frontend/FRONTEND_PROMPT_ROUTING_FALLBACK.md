# Frontend change brief: offline / backup routing mode

You are a frontend engineer working on the existing Baku Evacuation & Dispatch frontend (built from
`frontend/FRONTEND_PROMPT.md`). The backend now keeps serving routes when the **external map &
routing API** is down (HTTP 503 or a response slower than 5 s). It uses a circuit breaker and falls
back to a local backup: road graph, cached routes, static coordinate matrix. Your job is to make that
state **visible and calm** in the UI, so the app never looks broken, and to give dispatchers control
over it. Make only frontend changes. Keep everything else working. Verify against the running backend
(`cd backend && docker compose up --build`, Swagger at `http://localhost:8000/docs`).

## 1. What changed in the API

### 1.1 Route objects (POST/GET `/api/v1/citizens/me/route`, and `new_route`/`old_route` in `route.rerouted`)
New fields:
```ts
type RoutingStatus = "online" | "fallback";
type Notice = { code: "ROUTING_FALLBACK" | string; text: string };   // text is already localized

type Route = {
  // ...existing fields (id, target_point_id, geometry, distance_m, eta_min, version, reason, accessible, created_at)
  reason: "initial" | "road_closed" | "point_full" | "alert_new_point" | "barrier";
  source: "external" | "local_graph" | "cache" | "static_matrix";
  routing_status: RoutingStatus;  // "fallback" = served while the external API is unavailable
  notice: Notice | null;          // e.g. {code:"ROUTING_FALLBACK", text:"Oflayn/Ehtiyat marşrut rejimində işləyir"}
};
```
- `source: "static_matrix"` means a rough estimate: the geometry is only 2–3 straight segments, and
  distance and ETA are approximate.
- `source: "cache"` means the last known route for this trip; it may not reflect the newest road events.

### 1.2 Nearest points (`GET /api/v1/assembly-points/nearest`)
Each item has a new `source: "local_graph" | "static_matrix"`. `static_matrix` means distance and ETA
are estimates.

### 1.3 New endpoint: `GET /api/v1/routing/status` (public, no auth)
```ts
type RoutingStatusOut = {
  status: RoutingStatus;
  external_configured: boolean;
  breaker: { state: "closed" | "open" | "half_open"; failures: number; last_error: string | null;
             retry_in_sec: number | null };
  fallback_chain: string[];       // ["local_graph", "cache", "static_matrix"]
  notice: Notice | null;          // localized by Accept-Language / ?lang=
};
```

### 1.4 New WebSocket event `routing.status`
Sent to **dispatchers and every connected citizen** whenever the mode changes (provider down, or
recovered). `data` has the same shape as `RoutingStatusOut`, and `notice.text` is localized per socket.

### 1.5 Dispatcher additions
- `GET /api/v1/dispatch/overview` and the `overview.updated` event have a new `routing_status: "online" | "fallback"`.
- `POST /api/v1/sim/routing-fault` with `{"mode": "error_503" | "timeout" | "ok", "delay_sec": 8}`
  (Bearer token). It returns `{provider, routing}` and breaks or repairs the mock external provider
  for drills. Error `502 ROUTING_FAULT_UNAVAILABLE` (localized message) when no mock provider is
  configured.

The error envelope, localization (`Accept-Language` / `?lang=`) and all other endpoints are unchanged.
The backend never returns 5xx because the provider is down, so do **not** show error screens for this case.

## 2. Citizen app changes

1. **Global routing-mode state** (a store or context): `status`, `notice`, `breaker.retry_in_sec`.
   - Initialise it from `GET /routing/status` on app start and after every WebSocket reconnect.
   - Update it from `routing.status` events, and also from any route response: if
     `route.routing_status === "fallback"`, switch to fallback even before the event arrives.
   - Optional polling: every 60 s while in fallback (the WebSocket is the primary signal).
2. **Fallback banner**: while `status === "fallback"`, show a persistent, non-blocking banner under
   the header.
   - Text: exactly `notice.text` from the server (AZ default: **"Oflayn/Ehtiyat marşrut rejimində
     işləyir"**; EN: "Running in offline/backup routing mode"). Never hard-code it; fall back to the
     i18n key `routing.fallback` only if `notice` is missing.
   - Style: amber/neutral, not red (the service still works). Icon: a cloud-off or route icon. Role:
     `status` with `aria-live="polite"`. Don't let it cover the SOS button or map controls.
   - A secondary line (i18n): "Marşrutlar lokal ehtiyat məlumatları ilə hesablanır." /
     "Routes are calculated from local backup data."
3. **Route card and map**:
   - When `route.routing_status === "fallback"`, show a small badge next to the ETA:
     "Ehtiyat rejimi" / "Backup mode".
   - `source === "cache"`: add the hint "Son saxlanılmış marşrut" / "Last saved route".
   - `source === "static_matrix"`: draw the route **dashed**, prefix distance and ETA with "≈", and
     add the hint "Təxmini marşrut, yol işarələrinə diqqət edin" / "Approximate route: follow road
     signs".
   - `source === "external" | "local_graph"` with `routing_status === "online"`: unchanged.
4. **Recovery**: when `routing.status` reports `online`, hide the banner and show a short success
   toast: "Onlayn marşrut xidməti bərpa olundu" / "Online routing restored". Then, if the citizen has
   an active route in fallback, refetch `GET /citizens/me/route`. Don't rebuild the route
   automatically; offer the button "Marşrutu yenilə" / "Refresh route", which calls
   `POST /citizens/me/route` again with the same point.
5. **Nearest list**: if any item has `source === "static_matrix"`, show "≈" before distance and ETA,
   plus a one-line note at the top of the list: "Məsafələr təxminidir" / "Distances are approximate".
6. **Rerouted toasts**: `route.rerouted` events may now carry `new_route.routing_status === "fallback"`.
   Keep the existing reason texts and add the backup badge.
7. **Step-free users**: no change in behaviour (step-free routes always come from the local graph).
   If the route has `accessible === false` **and** `source === "static_matrix"`, show the existing
   amber warning "Bu marşrutda maneələr ola bilər" / "This route may contain obstacles".

## 3. Dispatcher panel changes

1. **KPI bar**: a "Marşrut xidməti" / "Routing service" tile driven by `overview.routing_status` and
   the `routing.status` event: green "Onlayn" / "Online", or amber "Ehtiyat rejimi" / "Backup mode".
   In backup mode, show `breaker.state`, `breaker.failures`, `last_error` (e.g. "HTTP 503",
   "timeout after 5.0s") and a live countdown from `retry_in_sec` to the next half-open trial
   (refresh `GET /routing/status` when it reaches 0).
2. **Event log / toast**: on every `routing.status` transition add an entry with the time and the
   state (closed → open → half-open → closed).
3. **Simulation tab**: a new "Xarici marşrut API-si" / "External routing API" card with three
   buttons: **Normal (ok)**, **503 xətası**, **Gecikmə > 5 s (timeout)** (with a `delay_sec` input,
   default 8). They call `POST /sim/routing-fault`.
   - Show the returned `routing` status.
   - Handle `502 ROUTING_FAULT_UNAVAILABLE` by showing the server message and disabling the card.
   - Add the help text "Breaker 3 ardıcıl xətadan sonra açılır, 30 s sonra yoxlama sorğusu göndərir."
     / "The breaker opens after 3 consecutive failures and sends a trial request after 30 s."
4. **SOS / alert flows**: no changes needed; they don't depend on the external provider.

## 4. i18n keys to add (az / en)
| key | az | en |
|---|---|---|
| `routing.fallback` | Oflayn/Ehtiyat marşrut rejimində işləyir | Running in offline/backup routing mode |
| `routing.fallbackDetail` | Marşrutlar lokal ehtiyat məlumatları ilə hesablanır. | Routes are calculated from local backup data. |
| `routing.restored` | Onlayn marşrut xidməti bərpa olundu | Online routing restored |
| `routing.backupBadge` | Ehtiyat rejimi | Backup mode |
| `routing.cached` | Son saxlanılmış marşrut | Last saved route |
| `routing.approximate` | Təxmini marşrut, yol işarələrinə diqqət edin | Approximate route: follow road signs |
| `routing.approxDistances` | Məsafələr təxminidir | Distances are approximate |
| `routing.refresh` | Marşrutu yenilə | Refresh route |
| `routing.service` | Marşrut xidməti | Routing service |
| `routing.online` | Onlayn | Online |
| `routing.nextTrial` | Növbəti yoxlama: {{s}} s | Next check in {{s}} s |
| `sim.routingApi` | Xarici marşrut API-si | External routing API |

## 5. Acceptance criteria (verify each against the running stack)
1. Dispatcher → Simulation → "503 xətası". A citizen builds a route: it succeeds (no error screen),
   the banner shows exactly **"Oflayn/Ehtiyat marşrut rejimində işləyir"**, and the route card shows
   the backup badge.
2. After 3 such requests the dispatcher tile shows "Ehtiyat rejimi", breaker `open`, `HTTP 503` and a
   countdown. Every open citizen tab shows the banner without reloading (WebSocket `routing.status`).
3. "Gecikmə > 5 s": route requests still complete. The first one takes about 5 s (show the normal
   loading state; no frozen UI or double submit), and later ones are instant while the breaker is open.
4. "Normal (ok)", then wait for the countdown: the next route request recovers. The banner disappears,
   the "Onlayn marşrut xidməti bərpa olundu" toast appears, and the dispatcher tile turns green.
5. Switching AZ ↔ EN changes the banner text (it comes from `notice.text`; after a language switch,
   refetch `/routing/status` and reopen the WebSocket).
6. A `static_matrix` route renders dashed with "≈" values. A `cache` route shows "Son saxlanılmış marşrut".
7. Screen-reader check: the banner is announced once politely, and recovery is announced too.
   Colour is never the only signal.

## 6. Constraints
- No backend changes. Don't re-sort lists or reinterpret `routing_status` on the client beyond what is
  described here.
- Never block the SOS button or map interaction because of routing mode.
- Keep the existing typed API client: add the new fields to `types.ts`, and add the `routing.status`
  event to the WebSocket event union.
