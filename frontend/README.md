# Bakı Təxliyə: frontend

The web frontend for the Baku emergency evacuation and dispatch platform. One React app serves two user
groups:

| Who | Where | What they do |
| --- | --- | --- |
| **Citizens** (no login, mobile-first) | `/` | Register the device, find the nearest assembly point, follow an evacuation route, get live reroutes, send SOS, check in |
| **Dispatchers** (JWT login, desktop) | `/dispatcher` | Watch the live situation, triage SOS by priority, handle RED ALERTs, track brigades, run drills |

**Accessibility is a core feature.** A citizen can register as **"Hərəkət məhdudiyyətli şəxs"** (person
with reduced mobility). The backend then computes **step-free routes** and only offers
**wheelchair-accessible** points, and that person's SOS goes **first** in the dispatcher queue. The UI
makes each of these visible (see [Accessibility features](#accessibility-features)).

The UI is in **Azerbaijani (default)** and **English**.

## Quick start

Requires Node 20+ and Docker.

```bash
# 1. Backend (FastAPI + PostGIS + Redis). Swagger: http://localhost:8000/docs
cd backend && docker compose up --build

# 2. Frontend
cd frontend
npm install
npm run dev            # http://localhost:5173  (the port the backend allows for CORS)
```

- Citizen app: <http://localhost:5173/>. Use a phone-sized window (DevTools device mode).
- Dispatcher: <http://localhost:5173/dispatcher>. Demo login `admin` / `admin123`.

| Variable | Default | Meaning |
| --- | --- | --- |
| `VITE_API_URL` | `http://localhost:8000` | Backend origin. `/api/v1` is appended. |
| `VITE_WS_URL` | `ws://localhost:8000` | WebSocket origin. `/ws/citizen` and `/ws/dispatch` are appended. |
| `VITE_USE_MOCKS` | `false` | `true` serves everything from an in-browser mock (MSW) instead of the backend |

Copy `.env.example` to `.env` to change them.

### Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server on :5173 against the real backend |
| `npm run dev:dispatch` | Dispatcher-only dev server on **:3001**. `/` opens the panel; `/api` and `/ws` are proxied to :8000, so CORS doesn't matter (`.env.dispatch`). |
| `npm run dev:mock` | Dev server with the in-browser mock backend (no Docker needed) |
| `npm run build` | Typecheck + production build (includes the PWA service worker) |
| `npm run lint` / `npm run format` | ESLint (`no-explicit-any` is an error) / Prettier |
| `npm test` | Vitest unit tests |

## Routes

| Path | Screen |
| --- | --- |
| `/` | Citizen: map, nearest points, active route (tab **Xəritə**) |
| `/points` | Citizen: all assembly points with type filters (tab **Məntəqələr**) |
| `/sos` | Citizen: SOS status, offline queue, history (tab **Siqnallarım**) |
| `/me` | Citizen: safety switch, profile (phone + ♿ checkbox), location, emergency numbers (tab **Mən**) |
| `/dispatcher/login` | Dispatcher sign-in |
| `/dispatcher` | Main view: KPI bar, map, right tabs **SOS · Alerts · Brigades · Simulation**, SOS-per-minute chart |
| `/dispatcher/sos`, `/alerts`, `/brigades`, `/points`, `/analytics` | Full-width detail pages (left menu) |

Old `/dispatch/*` links redirect to `/dispatcher/*`.

## Accessibility features

**Citizen**
- The registration form has a real checkbox for **Hərəkət məhdudiyyətli şəxs**, with a label and a
  description. It is sent as `mobility_impaired` to `POST /citizens/register`, and can be changed later
  in **Mən → Profil**.
- While it is on, a **"♿ Maneəsiz rejim aktivdir"** chip shows in the header and a banner on the map.
  The nearest list (filtered by the backend) shows a subtitle explaining that only accessible points are listed.
- ♿ badges appear on wheelchair-accessible points, both on the map and on cards.
- When `route.accessible` is true, the route has a **"♿ Pilləkənsiz marşrut"** badge, a distinct violet line
  and a ♿ start marker. If a mobility-impaired user gets a non-accessible route, an amber
  *"Bu marşrutda maneələr ola bilər"* warning is shown.
- `POINT_NOT_ACCESSIBLE` and `NO_ACCESSIBLE_ROUTE` show the server message, plus a one-tap suggestion for the
  next accessible point.
- A `barrier` reroute shows *"Marşrutda maneə aşkarlandı, pilləkənsiz yeni marşrut"*.

**Dispatcher**
- The SOS queue is rendered **in exactly the order the server returns** and is never re-sorted. WebSocket
  updates are merged with the same rule (`citizen_mobility_impaired` desc, `priority_score` desc,
  `created_at` asc; see `src/lib/sosOrder.ts`). Filters only remove rows, so the ♿-first order is kept.
- Every `labels[]` entry is rendered as a badge from its server-localized `text`. `MOBILITY_IMPAIRED` gets a
  violet ♿ badge, a coloured left border, a **"#1 PRİORİTET"** marker, a ♿ map marker with a halo, and
  a distinct chime when it arrives.
- Map clusters keep a ♿ count, so a mobility-impaired SOS never disappears inside a cluster.
- RED ALERT shows the alert's labels, *"Bu klasterdə hərəkət məhdudiyyətli şəxs var"*, and lists those SOS first.
- The barriers layer shows stairs, underpasses, steep slopes and other obstacles with icons and a legend.
  The Simulation tab can add or remove them.

**General (WCAG 2.1 AA)**
- Never colour alone: every status has an icon and text.
- Touch targets are at least 44 px; the SOS button is 88 px.
- Reroutes and SOS status changes are announced through an `aria-live="assertive"` region.
- Keyboard: the dispatcher queue supports ↑/↓/Enter, and dialogs trap focus.
- `prefers-reduced-motion` and `prefers-color-scheme` are respected.
- Lighthouse accessibility for the citizen app is 100 on the registration, map and profile screens.

## Demo script

This follows brief §10. Use the real backend, with the dispatcher in one window and the citizen in a
phone-sized window.

1. **Dispatcher**: Simulation tab → **Sıfırla / Reset** → confirm.
2. **Citizen**: register with **Hərəkət məhdudiyyətli şəxs** ticked, at about `40.3800, 49.8450`. In DevTools →
   Sensors, set the location, then allow location. The list shows only ♿ points. Tap **Marşrut qur**: the route
   shows **♿ Pilləkənsiz marşrut**.
3. **Dispatcher**: Simulation → *Add / remove barrier* → **Pilləkən** → tap a road on that route. The citizen
   gets the "barrier" reroute; a regular citizen on the same street is not rerouted.
4. **Dispatcher**: a second (unticked) citizen and the first one each send an SOS. The queue shows the ♿ SOS on top
   with **#1 PRİORİTET** and the **Hərəkət məhdudiyyətli şəxs** badge, even with a lower score.
5. **Dispatcher**: Simulation → *SOS seriyası* → pick a spot near the first citizen, 4 SOS, 400 m, 120 s →
   **Yarat**. RED ALERT opens with the label. **Təsdiqlə və icra et**: the summary shows the brigade sent to
   the ♿ SOS, the brigade moves, the reserve point opens, and citizens are rerouted (`alert_new_point`).

## Localization

- Strings live in [`src/i18n/locales/az.json`](src/i18n/locales/az.json) and
  [`en.json`](src/i18n/locales/en.json). The `Dict` type is derived from `az.json`, so a key missing in English fails
  `tsc`, and `src/i18n/i18n.test.ts` compares both files key by key.
- Components read strings through `tr` (`import { tr } from '@/i18n'`), which always resolves against the
  active language. Placeholders use `fill(tr.time.minutesAgo, { n: 3 })`, and plurals use
  `plural(forms, n)` (`Intl.PluralRules`).
- To add keys to both files at once: `node scripts/i18n-set.mjs patch.json` with
  `{ "a.b.c": ["az text", "en text"] }`.
- The language is saved per device (`localStorage` key `evac.lang`) and sets `<html lang>`. It is sent as
  `Accept-Language` on every request and as `lang=` on both WebSockets. Switching refetches all cached data,
  because server texts (`error.message`, `labels[].text`) arrive localized.
- Numbers, distances and times use `Intl` (`az-Latn-AZ` / `en-US`): "1,2 km" / "1.2 km". Place names are
  never translated.

## Real-time

- `src/api/ws.ts` (`LiveSocket`) is a native WebSocket client. It reconnects with exponential backoff
  (1 s → 30 s, ±20 % jitter), sends a text `ping` every 20 s, treats 50 s of silence as a dead connection,
  and reconnects as soon as the browser is back online. After a reconnect it refetches all active queries,
  because missed events are not replayed.
- WebSocket events patch the TanStack Query cache in place (`setQueryData`); nothing is refetched per
  event. Partial `sos.updated` payloads are merged by `id`. `sim.reset` refetches everything. A rejected
  handshake logs the dispatcher out, or silently re-registers the citizen.
- Errors use the `{error: {code, message, details}}` envelope and become an `ApiError`. Logic branches on
  `code`; `message` is shown as-is. `SOS_COOLDOWN` reads `details.retry_after_sec` for the countdown, and
  `CITIZEN_NOT_REGISTERED` re-registers automatically and retries once.
- The dispatcher token is kept in memory plus `sessionStorage`, and any 401 logs out.

## Routing fallback

When the external map and routing API is down (HTTP 503 or slower than 5 s), the backend's circuit breaker
switches to a local backup (road graph → cached route → static coordinate matrix) and keeps serving routes.
The UI shows this as a calm, non-blocking state, never an error screen.

- **Mode store** (`src/stores/routingStore.ts`, synced by `features/routing/useRoutingStatus.ts`):
  - Loaded from `GET /routing/status` on start, after every socket reconnect and after a language switch.
  - Checked again every 60 s while in backup mode.
  - Updated by the `routing.status` socket event, and switched to backup by any route that has
    `routing_status: "fallback"`.
- **Citizen banner** (`RoutingBanner`): amber, under the header, `role="status"`. It shows the server's
  `notice.text` plus "Routes are calculated from local backup data." Map overlays and tab pages move below it,
  so it never covers SOS or map controls.
  - On recovery: a "restored" toast, a refetch of the active route, and a **Refresh route** button on the route
    card. The route is not rebuilt automatically.
- **Route card and lists:**
  - A "Backup mode" badge next to the ETA for routes served in backup mode.
  - "Last saved route" for `source: "cache"`.
  - For `source: "static_matrix"`: a dashed line, "≈" before distance and ETA, an "Approximate route" hint, and the
    obstacle warning when the route is not step-free.
  - Nearest lists show "Distances are approximate" and "≈" on estimated items.
- **Dispatcher:** a "Routing service" tile in the top stats bar shows Online or Backup mode. In backup mode it also
  shows breaker state, failure count, last error and a live countdown to the next trial, and refreshes
  `/routing/status` when the countdown reaches 0. Each mode change raises a toast and is listed in the log on the
  Simulation tab.
- **Drill:** Dispatcher → Simulation → **External routing API** card (`POST /sim/routing-fault`).
  1. Press **503 xətası**, then build a route as a citizen. The route works, and the banner and badge appear.
  2. After 3 failures the tile shows `open`, `HTTP 503` and a countdown. Open citizen tabs show the banner live.
  3. **Gecikmə > 5 s** sets a slow provider (`delay_sec`, default 8). The first request takes about 5 s, and later
     ones are instant while the breaker is open.
  4. Press **Normal (ok)** and wait for the countdown. The next route request recovers: the banner hides, a toast
     appears, and the tile turns green.
  - A `502 ROUTING_FAULT_UNAVAILABLE` response, sent when no mock provider is configured, disables the card and
    shows the server's message.

## Architecture

```
src/
  app/              App shell, router, QueryClient, auth guard
  pages/            citizen/* (layout + 4 tabs), DispatchPage (layout), dispatch/* (lazy), Login, NotFound
  features/citizen/ header, registration/profile form, map, bottom sheet, cards, route card,
                    reroute banner, SOS sheet/status, safety switch, socket + sync hooks
  features/dispatch/ KPI bar, map + layers (SOS clusters, traffic, barriers, alerts), SOS feed/table,
                    label badges, RED ALERT modal, brigades, simulation tab, time-series chart
  features/routing/ routing-fallback banner, route hints/badges, dispatcher tile, fault drill card
  components/ui/    shadcn-style primitives, states (empty/error/skeleton), live announcer, language switch
  components/map/   BaseMap, PointMarker, UserMarker, RouteLayer
  api/              http client (ApiError), endpoints, normalisers, query keys, LiveSocket
  i18n/             tr + language store; locales/az.json, en.json
  lib/              geo, formatting, status colours/icons, SOS ordering, announce, alarm
  stores/           Zustand: auth, citizen, dispatch, connection, routing
  mocks/            MSW handlers + in-browser simulation engine (mock mode only)
```

## Testing

- `npm test` runs Vitest: SOS queue ordering, dictionary parity (AZ ↔ EN), API normalisers, geo maths,
  formatting and occupancy thresholds.
- The brief's acceptance criteria were checked in headless Chrome against the running backend:
  - AC1–3: the ♿ flag is stored and editable, the nearest list and route are step-free, and a barrier
    reroutes only the mobility-impaired citizen.
  - AC4: the ♿ SOS is first despite a lower score.
  - AC5: RED ALERT with the label; confirm dispatches the brigade to the ♿ SOS and the brigade moves.
  - AC6: a point at 91 % triggers a `point_full` reroute.
  - AC7: AZ ↔ EN switches UI text, labels and server errors.
  - AC8: the SOS cooldown countdown works, and an invalid token logs the dispatcher out.
  - AC9: Lighthouse accessibility is 100 on the citizen app.

## Screenshots

1. Run the backend and `npm run dev`, then follow the [demo script](#demo-script).
2. Citizen: DevTools device toolbar at **390×844**, DPR 2, then ⌘/Ctrl+Shift+P → "Capture screenshot".
3. Dispatcher: a **1600×900** or larger window. Capture the queue with a ♿ SOS on top, the RED ALERT modal, and the
   confirm summary.
4. Save them to `docs/screenshots/` and link them here.

## Mock mode

`npm run dev:mock` runs without Docker. MSW serves REST and WebSocket traffic from an in-browser simulation
of Baku (zones, points, roads, brigades), synced across tabs. It follows the contract's shapes, but it
does not reproduce the backend's step-free routing or barrier logic. Use the real backend to demo the
accessibility features.

Routing fallback is not mocked either. `src/mocks/handlers.ts` has no handler for `/routing/status` or
`/sim/routing-fault`, so in mock mode the routing mode stays unknown: no banner, and the tile shows "—".
Run the routing drill against the real backend.
