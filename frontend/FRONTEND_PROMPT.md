# Frontend build brief: Baku Evacuation & Dispatch

You are a senior frontend engineer. Build the frontend for an emergency evacuation and dispatch
platform for the city of Baku (earthquakes, floods, industrial accidents, mass events). The backend
is finished and running. Your job is a production-quality UI on top of its API, with no backend
changes. Work in phases, verify each phase against the running backend, and do not skip any
requirement below.

There are two user groups in one app:
1. **Citizens** (mobile-first web app, no login): register their device, find the nearest assembly
   point, follow an evacuation route, receive automatic reroutes, send SOS, check in.
2. **Dispatchers** (desktop control panel, JWT login): live situation overview, triage SOS by
   priority, handle RED ALERTs with one click, track brigades on the map, run simulations.

**Accessibility is a core feature.** Citizens can register as **"Hərəkət məhdudiyyətli şəxs"**
(person with reduced mobility). For them the backend computes **step-free routes** (no stairs, steep
slopes or underpasses), sends them only to **wheelchair-accessible** points, and puts their SOS
**first** in the dispatcher queue with a visible **label**. The UI must make all of this obvious.

---

## 1. Tech stack

- React 18 + TypeScript + Vite, in the existing `frontend/` folder of this repo
- React Router (`/` citizen app, `/dispatcher/*` dispatcher panel)
- TanStack Query for REST data, plus a small typed WebSocket client (native `WebSocket`, **not**
  Socket.IO)
- MapLibre GL JS (or react-leaflet) with OpenStreetMap raster tiles; map center Baku `40.4093, 49.8671`
- Tailwind CSS (or CSS modules), a small component set, no heavy UI kit required
- i18n: `react-i18next` (or a tiny custom hook) with **Azerbaijani (default) and English**
- Charts: Recharts (or similar) for the dispatcher time series
- Config via env: `VITE_API_URL=http://localhost:8000`, `VITE_WS_URL=ws://localhost:8000`
- The backend allows CORS from `http://localhost:5173` (the Vite default). Keep that port.

Run the backend first: `cd backend && docker compose up --build`. Swagger with examples is at
`http://localhost:8000/docs`; use it as the source of truth for request/response shapes.
Demo dispatcher login: `admin` / `admin123`.

---

## 2. API contract (prefix `/api/v1`, JSON, ISO 8601 UTC timestamps)

### 2.1 Conventions
- **Citizen identity:** header `X-Device-Id: <uuid v4>`. Generate it once on first launch with
  `crypto.randomUUID()` and keep it in `localStorage`. Citizens never log in.
- **Dispatcher auth:** `POST /auth/login {username, password}` returns `{access_token, token_type}`.
  Send `Authorization: Bearer <token>`. Keep the token in memory plus `sessionStorage`, and log out
  on any 401.
- **Language:** send `Accept-Language: az|en` on **every** request (from the UI language switcher).
  `?lang=az|en` also works and wins over the header. Responses carry `Content-Language`.
- **Errors** always look like:
  ```json
  {"error": {"code": "SOS_COOLDOWN", "message": "Please wait 42 seconds before sending another SOS.",
             "details": {"retry_after_sec": 42}}}
  ```
  `message` is already localized, so show it as is. Branch logic on `code`, which never changes with
  the language. Validation errors are `422 VALIDATION_ERROR` with `details[]`.

### 2.2 Types (field names are exact)
```ts
type Lang = "az" | "en";
type Label = { code: "MOBILITY_IMPAIRED" | string; text: string };   // text is localized

type Citizen = { id: string; device_id: string; phone: string | null; lat: number | null; lng: number | null;
  zone_id: number | null; status: "unknown" | "in_danger" | "safe"; target_point_id: number | null;
  mobility_impaired: boolean; updated_at: string };

type Zone = { id: number; name: string; population: number; polygon: GeoJSON.Polygon };

type AssemblyPoint = { id: number; name: string; type: "shelter" | "park" | "stadium"; lat: number; lng: number;
  zone_id: number | null; capacity: number; current_count: number; occupancy_pct: number;
  status: "active" | "reserve" | "closed"; wheelchair_accessible: boolean };

type NearestPoint = { point: AssemblyPoint; distance_m: number; eta_min: number; score: number; near_full: boolean };

type Route = { id: number; target_point_id: number; geometry: GeoJSON.LineString; distance_m: number;
  eta_min: number; version: number;
  reason: "initial" | "road_closed" | "point_full" | "alert_new_point" | "barrier";
  accessible: boolean;              // true = step-free route (no stairs/steep/underpass)
  source: "external" | "local_graph" | "cache" | "static_matrix";
  routing_status: "online" | "fallback";   // see FRONTEND_PROMPT_ROUTING_FALLBACK.md
  notice: { code: string; text: string } | null;
  created_at: string };

type Sos = { id: number; citizen_id: string; type: "fire" | "collapse" | "flood" | "medical"; lat: number; lng: number;
  zone_id: number | null; note: string | null; priority_score: number; status: "new" | "assigned" | "resolved";
  assigned_brigade_id: number | null; brigade_eta_min: number | null; created_at: string;
  citizen_mobility_impaired: boolean; labels: Label[] };

type Brigade = { id: number; name: string; type: "fire" | "medical" | "rescue"; lat: number; lng: number;
  status: "idle" | "en_route" | "on_site" | "returning"; target_sos_id: number | null;
  route_geometry: GeoJSON.LineString | null };

type Alert = { id: number; kind: "SOS_CLUSTER" | "POINT_OVERLOAD"; zone_id: number | null; zone_name: string | null;
  center: { lat: number; lng: number }; radius_m: number; sos_ids: number[]; distinct_citizens: number;
  point_id: number | null;
  recommended_brigade: { id: number; name: string; type: string; eta_min: number | null } | null;
  recommended_new_point: { id: number; name: string; capacity: number; distance_m: number | null } | null;
  mobility_impaired_sos_ids: number[]; labels: Label[];
  status: "active" | "confirmed" | "dismissed"; created_at: string; updated_at: string };

type Overview = { active_sos: number; active_sos_mobility_impaired: number; resolved_sos: number;
  citizens_safe: number; citizens_in_danger: number; brigades_idle: number; brigades_busy: number;
  avg_occupancy_pct: number; active_alerts: number };

type Timeseries = { minutes: number; series: { minute: string; total: number;
  by_type: { fire: number; collapse: number; flood: number; medical: number } }[] };
```

### 2.3 Citizen endpoints (header `X-Device-Id`)
| Method | Path | Body / query | Returns |
|---|---|---|---|
| POST | `/citizens/register` | `{device_id, phone?, mobility_impaired?}` | `Citizen` (idempotent; calling again updates the profile; omit `mobility_impaired` to keep it) |
| PATCH | `/citizens/me/location` | `{lat, lng}` | `Citizen` (zone resolved server-side) |
| PATCH | `/citizens/me/status` | `{status: "safe" \| "in_danger"}` | `Citizen` |
| GET | `/zones` | | `Zone[]` |
| GET | `/assembly-points` | `?zone_id=&status=` | `AssemblyPoint[]` |
| GET | `/assembly-points/nearest` | `?lat=&lng=&zone_id=&limit=5&accessible=` | `NearestPoint[]` sorted best-first; `near_full` items come last. **Send `X-Device-Id`**: for mobility-impaired citizens, step-free mode is applied automatically. |
| POST | `/citizens/me/route` | `{point_id, lat, lng}` | `Route` (becomes the active route) |
| GET | `/citizens/me/route` | | active `Route` or 404 `ROUTE_NOT_FOUND` |
| POST | `/assembly-points/{id}/check-in` | | `AssemblyPoint`; the citizen becomes `safe` |
| POST | `/sos` | `{type, lat, lng, note?}` | `Sos` (201). 429 `SOS_COOLDOWN` with `details.retry_after_sec` |
| GET | `/sos/me` | | `Sos[]` with status and `brigade_eta_min` |

Citizen error codes to handle: `MISSING_DEVICE_ID`, `CITIZEN_NOT_REGISTERED` (re-register silently),
`POINT_NOT_ACTIVE`, `POINT_FULL`, `POINT_NOT_ACCESSIBLE`, `NO_ROUTE`, `NO_ACCESSIBLE_ROUTE`,
`SOS_COOLDOWN`.

### 2.4 Dispatcher endpoints (Bearer token)
| Method | Path | Notes |
|---|---|---|
| GET | `/dispatch/overview` | `Overview` |
| GET | `/dispatch/timeseries?minutes=30` | `Timeseries` (SOS per minute, per type) |
| GET | `/sos?status=&zone_id=&type=` | `Sos[]` **already ordered**: mobility-impaired first, then `priority_score` desc, then oldest. **Never re-sort on the client.** |
| POST | `/sos/{id}/resolve` | returns `Sos`; the brigade drives back to base |
| GET | `/brigades` | `Brigade[]` |
| POST | `/brigades/{id}/assign` | `{sos_id}`; 409 `BRIGADE_BUSY` / `BRIGADE_UNREACHABLE` |
| GET | `/alerts?status=active` | `Alert[]` |
| POST | `/alerts/{id}/confirm` | optional body `{brigade_id?, new_point_id?}` (overrides); one transaction; 409 `ALERT_NOT_ACTIVE` / `BRIGADE_BUSY` |
| POST | `/alerts/{id}/dismiss` | `{reason}` |
| GET | `/traffic/segments?bbox=minLng,minLat,maxLng,maxLat&status=&has_barrier=` | GeoJSON FeatureCollection; properties `{id, status: open\|closed\|congested, congestion_factor, speed_kmh, length_m, barrier: stairs\|underpass\|steep\|curb\|narrow\|inaccessible\|null, accessible}`. **Always pass the viewport bbox**: the whole city is about 17k segments. |
| POST | `/sim/road-closure` | `{segment_id \| lat,lng, status: closed\|open\|congested, reason?, congestion_factor?}` returns `{segment_ids, status, congestion_factor, rerouted}` |
| POST | `/sim/barrier` | `{segment_id \| lat,lng, barrier: "stairs"\|"steep"\|"underpass"\|"curb"\|"narrow"\|"inaccessible"\|null, reason?}` returns `{segment_ids, barrier, rerouted}` (reroutes mobility-impaired citizens only) |
| POST | `/sim/occupancy` | `{point_id, current_count}` **or** `{point_id, delta}` returns `{point, rerouted, alert_id}` |
| POST | `/sim/sos-burst` | `{lat, lng, count, radius_m, window_sec, type, seed?}` returns `{citizen_ids, sos_ids, alert_ids}` |
| POST | `/sim/reset` | restores the seeded baseline |

### 2.5 WebSockets (native)
- Citizen: `${VITE_WS_URL}/ws/citizen?device_id=<uuid>&lang=<az|en>`
- Dispatcher: `${VITE_WS_URL}/ws/dispatch?token=<jwt>&lang=<az|en>`
- Envelope: `{"type": "<event>", "data": {...}, "ts": "<ISO>"}`. The server sends `{"type":"ping"}`
  every 20 s, and the client may send the text `ping` and get `pong` back. A first `connected`
  message confirms the socket. Bad device or token: the handshake is rejected (treat it as an auth error).
- Reconnect with exponential backoff (1 s → 30 s max). After reconnecting, **refetch** the affected
  queries, since events missed while disconnected are not replayed. Reopen the socket when the
  language changes (labels arrive localized per socket).

Events:
| Event | Citizen | Dispatcher | `data` |
|---|---|---|---|
| `route.rerouted` | yes (own) | yes (aggregated) | citizen: `{citizen_id, old_route: Route\|null, new_route: Route, reason, eta_diff_min}`; dispatcher: `{count, reason, segment_ids? \| point_id? \| alert_id?}` |
| `sos.created` | | yes | `Sos` |
| `sos.updated` | yes (own) | yes | `Sos`, or a partial `{id, priority_score, status}` from the periodic priority recompute: merge by `id` |
| `point.occupancy` | yes (own target only) | yes | `AssemblyPoint` |
| `road.updated` | | yes | `{segments: [{id, status, congestion_factor, barrier, accessible}], reason}` |
| `brigade.updated` | | yes | `Brigade` (every 2 s while moving) |
| `alert.raised` / `alert.updated` | | yes | `Alert` |
| `alert.resolved` | | yes | `Alert` (+ `result` summary on confirm, or `reason` on dismiss) |
| `overview.updated` | | yes | `Overview` |
| `sim.reset` | | yes | `{}`: refetch everything |
| `broadcast.message` | yes | | reserved for future announcements: show as a banner if received |

---

## 3. Citizen app (mobile-first, route `/`)

### 3.1 Onboarding and registration
- On first launch show a short registration screen:
  - Language switcher (AZ / EN), always visible in the header afterwards
  - Optional phone number (`+994…` format hint)
  - **Checkbox: "Hərəkət məhdudiyyətli şəxs"** (EN: "Person with reduced mobility"), with helper text:
    *"Sizə pilləkənsiz, maneəsiz marşrut göstəriləcək və SOS siqnalınız dispetçerdə prioritet
    olacaq."* / *"You will get step-free routes without stairs, and your SOS will be prioritised by
    dispatchers."*
  - Button "Davam et" / "Continue" calls `POST /citizens/register` with
    `{device_id, phone, mobility_impaired}`.
- A **Profile/Settings** screen lets the user change the phone number and the checkbox later (same
  endpoint). Show a confirmation toast after saving.
- Ask for geolocation (`navigator.geolocation.watchPosition`). Send `PATCH /citizens/me/location`
  at most every 15 s or after moving 50 m or more. Handle denial: show a manual "pick on map" fallback.
- Silently re-register if any call returns `CITIZEN_NOT_REGISTERED`.

### 3.2 Home / map
- Full-screen map with the user's position, zone polygons (light outlines), and assembly points:
  - Icon by type (shelter / park / stadium), colour by occupancy (green < 70 %, amber 70–90 %, red ≥ 90 %)
  - A **wheelchair icon (♿)** on points with `wheelchair_accessible: true`
  - Reserve and closed points are hidden for citizens
- Bottom sheet: "Ən yaxın toplanma məntəqələri" / "Nearest assembly points" from
  `GET /assembly-points/nearest` **with the `X-Device-Id` header**. Each card shows name, type,
  distance, walking ETA, an occupancy bar, a `near_full` warning badge, and ♿ when accessible.
- For mobility-impaired users, show a persistent banner/chip **"♿ Maneəsiz rejim aktivdir"** /
  "♿ Step-free mode is on". The list contains only accessible points (the backend filters it), so
  explain that in a subtitle.

### 3.3 Route
- Tapping "Marşrut qur" / "Get route" calls `POST /citizens/me/route`. Draw `geometry` on the map,
  and show distance, ETA and version.
- If `route.accessible === true`, show a clear badge **"♿ Pilləkənsiz marşrut"** /
  "♿ Step-free route" and use a distinct route colour (e.g. blue with a ♿ marker at the start).
- If the user is mobility-impaired but `route.accessible === false` (rare: the dispatcher forced a
  point with no step-free path), show an amber warning: *"Bu marşrutda maneələr ola bilər"* /
  "This route may contain obstacles".
- Handle `POINT_NOT_ACCESSIBLE` (409) and `NO_ACCESSIBLE_ROUTE` (422): show the localized message and
  suggest the next accessible point from the nearest list.
- On app start, load `GET /citizens/me/route` (404 means no route yet).

### 3.4 Live reroutes (citizen WebSocket)
- On `route.rerouted`: replace the route on the map, animate the change, vibrate
  (`navigator.vibrate`), and show a prominent modal/toast with the reason and the ETA difference:
  - `road_closed`: "Yol bağlandı, yeni marşrut" / "Road closed: new route"
  - `point_full`: "Məntəqə doludur, yeni məntəqə" / "Point is full: new destination"
  - `alert_new_point`: "Dispetçer yeni məntəqə açdı" / "Dispatcher opened a new point"
  - `barrier`: "Marşrutda maneə aşkarlandı, pilləkənsiz yeni marşrut" / "Obstacle on your route:
    new step-free route"
  - `eta_diff_min`: e.g. "+3.2 dəq" / "−6 min" (green when faster)
- On `point.occupancy` for the target point, update the occupancy bar live.
- Show a small connection indicator (green / grey) and reconnect automatically.

### 3.5 SOS
- A big red **SOS** button that is always reachable, with a confirmation step to prevent accidental
  presses. Choose a type (Yanğın/Fire, Uçqun/Collapse, Daşqın/Flood, Tibbi/Medical) and an optional
  note. Location comes from GPS.
- After sending: the status card from `GET /sos/me` shows status (`new` → `assigned` → `resolved`),
  the assigned brigade and a `brigade_eta_min` countdown. It updates on `sos.updated`.
- 429 `SOS_COOLDOWN`: disable the button and show a countdown from `details.retry_after_sec`.

### 3.6 Check-in and safety
- When the user is within about 100 m of the target point, show "Çatdım" / "I've arrived", which
  calls `POST /assembly-points/{id}/check-in`. Show a success screen; the user's status is now `safe`.
- A "Təhlükəsizəm" / "I'm safe" switch calls `PATCH /citizens/me/status`.

---

## 4. Dispatcher panel (desktop, route `/dispatcher`)

### 4.1 Login
`POST /auth/login`. Show the localized error message for `INVALID_CREDENTIALS`. Language switcher on
the login page and in the top bar.

### 4.2 Layout
Top KPI bar, a large central map, a right sidebar with tabs **SOS | Alerts | Brigades | Simulation**,
and a bottom strip with the time-series chart.

### 4.3 KPI bar (`/dispatch/overview`, live via `overview.updated`)
Active SOS (with a **"♿ N"** chip from `active_sos_mobility_impaired`), resolved, citizens in danger /
safe, brigades idle / busy, average occupancy %, active alerts (red, pulsing when > 0).

### 4.4 SOS queue: Priority #1 and the label (key requirement)
- Render `GET /sos` **in exactly the order returned**. The backend already puts SOS from persons
  with reduced mobility first, even when their `priority_score` is lower. Do not re-sort; when
  merging WebSocket updates, insert new or updated items using the same ordering rule
  (`citizen_mobility_impaired` desc, `priority_score` desc, `created_at` asc).
- For every item with `labels.length > 0`, render each label as a **badge** using `label.text` (it is
  already localized). For `code === "MOBILITY_IMPAIRED"`: a high-contrast badge with a ♿ icon, e.g.
  purple background and white text **"♿ Hərəkət məhdudiyyətli şəxs"**, plus a coloured left border on
  the row, a **"#1 PRİORİTET" / "#1 PRIORITY"** marker, and a ♿ map marker with a halo for that SOS.
- Each row: type icon, priority score, age ("3 dəq əvvəl"), zone, note, status, assigned brigade +
  ETA, and actions **Assign brigade** (select from idle brigades → `POST /brigades/{id}/assign`) and
  **Resolve**.
- Filters: status, zone, type. A filter must never break the ♿-first order.
- A new `sos.created` from a mobility-impaired person plays a distinct sound and briefly highlights
  the row.

### 4.5 Alerts (RED ALERT)
- `alert.raised` opens a modal/banner that can't be missed (red, sound) showing kind, zone, distinct
  citizens, a radius circle on the map, the recommended brigade (name, type, ETA) and the recommended
  reserve point (name, capacity, distance).
- If `mobility_impaired_sos_ids.length > 0`, show the alert's `labels` as badges and list those SOS
  first: "Bu klasterdə hərəkət məhdudiyyətli şəxs var" / "This cluster includes persons with reduced
  mobility".
- Actions: **Təsdiqlə / Confirm** (one click, `POST /alerts/{id}/confirm`), **Override**
  (select another idle brigade and/or reserve point, then confirm with `{brigade_id, new_point_id}`),
  **Dismiss** (reason required). Disable buttons while the request runs. Show the result summary
  from `alert.resolved`.
- `alert.updated` updates the open alert in place (merged SOS, new citizen count).

### 4.6 Map layers (toggleable)
- Zones; assembly points (occupancy colours, ♿ icon, reserve points dashed); SOS (by type, ♿ halo);
  brigades (live, moving every 2 s on `brigade.updated`, with their `route_geometry`); alert circles.
- **Traffic layer** from `/traffic/segments?bbox=<viewport>` (debounce 300 ms on map move): closed =
  red, congested = orange (thickness by `congestion_factor`). Hide open roads by default
  (`status=closed` / `congested`), or show them thin and grey at high zoom.
- **Barriers layer** (`has_barrier=true`): stairs, underpass, steep and other obstacles with small
  icons (🪜 stairs, ⤓ underpass, ⛰ steep) and a legend, so dispatchers can see what step-free routing
  avoids. Update on `road.updated` (`barrier` / `accessible` fields).

### 4.7 Simulation tab (drills and demo)
Forms for each `/sim/*` endpoint, with **click-on-map to pick coordinates**:
- Road closure / reopen / congestion (shows the `rerouted` count)
- **Add / remove barrier** (stairs, steep, underpass, curb, narrow, inaccessible / none), which shows
  how many mobility-impaired citizens were rerouted
- Occupancy (absolute or delta) per point
- SOS burst (lat/lng from the map, count, radius, window, type) to trigger a RED ALERT
- Reset (confirmation dialog)

### 4.8 Time series
A stacked bar chart of SOS per minute per type (`/dispatch/timeseries?minutes=30`). Refresh every
30 s and on `sos.created`.

---

## 5. Localization (AZ default, EN)

- All UI strings live in `locales/az.json` and `locales/en.json`. No hard-coded text in components.
- Remember the chosen language in `localStorage`, send it as `Accept-Language` on every request and as
  `lang=` on WebSockets, and set `<html lang>`.
- Server texts (`error.message`, `labels[].text`) arrive localized, so render them directly.
- Format numbers, distances ("1,2 km" / "1.2 km") and relative times with `Intl` for `az-AZ` / `en-US`.
- Place names (zones, points, brigades) are proper nouns in Azerbaijani. Do not translate them.
- Key terms: Toplanma məntəqəsi = Assembly point; Marşrut = Route; Briqada = Brigade;
  Həyəcan siqnalı = Alert; Maneəsiz / Pilləkənsiz marşrut = Step-free route;
  Hərəkət məhdudiyyətli şəxs = Person with reduced mobility.

## 6. Accessibility and UX quality (WCAG 2.1 AA)
- This app is used by people with disabilities and under stress. It must be usable with a screen
  reader, keyboard only, large text (200 % zoom), and high contrast.
- Touch targets ≥ 44 px; the SOS button ≥ 72 px; never rely on colour alone (add icons and text).
- Announce reroutes and SOS status changes through an `aria-live="assertive"` region.
- The registration checkbox is a real `<input type="checkbox">` with a `<label>` and a description.
- Respect `prefers-reduced-motion` and `prefers-color-scheme` (light and dark themes).
- Mobile: 360 px wide minimum, no horizontal scroll, works one-handed. Dispatcher: ≥ 1280 px layout.
- Loading skeletons, empty states, offline banner, and retry buttons on failed requests.

## 7. Project structure (suggested)
```
frontend/src/
  api/          client.ts (fetch wrapper: base URL, headers, error envelope → ApiError{code,message,details})
                types.ts, citizen.ts, dispatcher.ts
  realtime/     socket.ts (reconnect, heartbeat, typed events), useCitizenSocket.ts, useDispatchSocket.ts
  i18n/         index.ts, locales/az.json, locales/en.json
  features/citizen/    Register, Profile, MapHome, NearestList, RouteView, SosButton, SosStatus, CheckIn
  features/dispatcher/ Login, KpiBar, SosQueue, LabelBadge, AlertModal, BrigadeList, MapLayers, SimPanel, Timeseries
  components/   Map, Badge, Button, Modal, Toast, ConnectionIndicator
```

## 8. Phases (verify each against the running backend)
1. Scaffold, env, API client with error envelope, i18n (AZ/EN), routing, layout shells.
2. Citizen: registration with the **Hərəkət məhdudiyyətli şəxs** checkbox, profile, geolocation, map, nearest list.
3. Citizen: routes (step-free badge and warnings), WebSocket reroutes, SOS with cooldown, check-in.
4. Dispatcher: login, KPI bar, **SOS queue with ♿ Priority #1 and label badges**, assign/resolve, map layers.
5. Dispatcher: alerts (confirm / override / dismiss), brigades live, traffic and **barrier layers**, simulation tab, time series.
6. Polish: accessibility audit, dark mode, empty/error states, README with run instructions and screenshots.

## 9. Acceptance criteria
1. A citizen registers with the checkbox ticked: `mobility_impaired: true` is stored, and the profile shows it and can change it.
2. That citizen's nearest list contains only ♿ points, and their route shows "♿ Pilləkənsiz marşrut" (`route.accessible === true`).
3. A dispatcher adds stairs on that route (`/sim/barrier`): the citizen gets a `route.rerouted` with reason `barrier` and a new step-free route; a regular citizen on the same street is not rerouted.
4. That citizen sends a flood SOS while others send collapse SOS (higher score): the dispatcher queue still shows the ♿ SOS **at the top**, with the badge "♿ Hərəkət məhdudiyyətli şəxs" (EN: "Person with reduced mobility").
5. An SOS burst raises a RED ALERT; if it includes such a person, the alert shows the label; one-click confirm sends the brigade to that person first, and the brigade visibly moves on the map.
6. Closing a road / raising a point to 91 % reroutes citizens live, with the right reason texts.
7. Switching AZ ↔ EN changes all UI text, server error messages and label texts (including over WebSocket after reconnect).
8. The SOS cooldown shows a countdown; expired tokens log the dispatcher out; offline and reconnect states are visible.
9. Lighthouse accessibility ≥ 95 on the citizen app; keyboard-only operation of the dispatcher queue works.

## 10. Demo script to verify end to end
1. Dispatcher → Simulation → **Reset**.
2. Citizen (phone width) registers with **Hərəkət məhdudiyyətli şəxs** ticked, at about `40.3800, 49.8450`
   (central Nəsimi). The nearest list shows only ♿ points (no metro shelters). Get a route: step-free badge.
3. Dispatcher adds **stairs** on a segment of that route → the citizen sees the "barrier" reroute.
4. A second citizen (unticked) and the first one send SOS. The dispatcher queue shows the ♿ one first with the badge.
5. SOS burst near the first citizen (4 SOS, 400 m, 120 s) → RED ALERT with label → **Confirm** →
   the brigade moves, the reserve point opens, and citizens are rerouted (`alert_new_point`).
