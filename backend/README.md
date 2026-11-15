# Baku Evacuation & Dispatch — Backend

FastAPI backend for an emergency evacuation and dispatch platform for Baku (earthquakes, floods,
industrial accidents, mass events): citizen evacuation routing on a real road graph, automatic
rerouting, SOS triage, a RED ALERT crisis engine with one-click execution, brigade dispatch
simulation and real-time WebSockets.

**Stack:** Python 3.12 · FastAPI · Pydantic v2 · SQLAlchemy 2 (async) · PostgreSQL 16 + PostGIS ·
GeoAlchemy2 · Alembic · Redis (pub/sub + sliding windows) · NetworkX (A*) · native WebSockets · pytest.

## Quick start

```bash
cd backend
docker compose up --build        # api on :8000, postgres/postgis on :5432, redis on :6379
```

On first start the API container runs `alembic upgrade head`, seeds Baku (11 zones, 33 assembly
points, 10 brigades, road graph, dispatcher `admin` / `admin123`) and starts Uvicorn with 2 workers.

- Swagger UI with examples: <http://localhost:8000/docs>
- Health: <http://localhost:8000/health>
- Demo scenario: `docker compose exec api python scripts/demo.py`

Copy `.env.example` to `.env` to change anything; without it, the defaults below apply.

## Configuration (environment variables)

| Variable | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | set by compose | `postgresql+asyncpg://…` |
| `REDIS_URL` | set by compose | pub/sub, sliding windows, cooldowns, job locks |
| `JWT_SECRET` | `dev-only-secret-change-me` | **change in any shared environment** |
| `JWT_EXPIRE_MINUTES` | `720` | dispatcher token lifetime |
| `CORS_ORIGINS` | `http://localhost:5173,http://localhost:3000` | comma-separated frontend origins |
| `WEB_WORKERS` | `2` | Uvicorn workers (events fan out across workers via Redis) |
| `GRAPH_SOURCE` | `synthetic` | `synthetic` (offline grid) or `osm` (OSMnx, falls back to synthetic) |
| `INSTALL_OSMNX` | `false` | build arg: install OSMnx into the image |
| `CLUSTER_RADIUS_M` | `500` | SOS cluster radius |
| `CLUSTER_WINDOW_MIN` | `5` | SOS cluster time window |
| `CLUSTER_MIN_DISTINCT` | `4` | distinct citizens needed for a cluster |
| `REROUTE_OCCUPANCY_PCT` | `90` | point occupancy that triggers rerouting |
| `RED_ALERT_OCCUPANCY_PCT` | `95` | point occupancy that raises POINT_OVERLOAD |
| `SOS_COOLDOWN_SEC` | `60` | per-citizen SOS cooldown (HTTP 429) |
| `NEAREST_SEARCH_RADIUS_M` | `5000` | PostGIS candidate radius for nearest points |
| `CONGESTION_REROUTE_FACTOR` | `2.0` | congestion factor at which a road counts as "heavily congested" |
| `WALK_SPEED_KMH` | `5` | evacuation walking speed |
| `ACCESSIBLE_WALK_SPEED_KMH` | `3.5` | speed for step-free routes (persons with reduced mobility) |
| `BRIGADE_SPEED_KMH` | `40` | brigade simulation speed |
| `ENABLE_BACKGROUND_TASKS` | `true` | priority (30 s) + brigade movement (2 s) loops |

## Project layout

```
app/
  main.py, config.py, db.py, errors.py, deps.py, security.py, geo.py
  models/        SQLAlchemy + GeoAlchemy2 models (GIST index on every geometry column)
  schemas/       Pydantic request/response schemas (public contract)
  api/v1/        citizens, routes, zones, assembly_points, sos, dispatch, brigades, alerts, sim, auth
  services/      routing, nearest, rerouting, crisis_engine, priority, brigade_sim,
                 roads, occupancy, sos, overview, state (reset), jobs, serialize
  realtime/      events.py (Redis bus), ws_manager.py (per-worker fan-out), ws_routes.py
  seed/          data.py (Baku), build_graph.py (OSMnx + offline grid), seed.py
alembic/         migrations (0001_initial_schema)
scripts/         start.sh (container entrypoint), demo.py
tests/           pytest suite (real PostGIS + Redis)
```

## How it works

### Routing
At startup each worker loads `road_nodes` / `road_segments` into a NetworkX `DiGraph`.
Edge weight = `length_m / (speed_kmh / 3.6) * congestion_factor` (seconds). Evacuation uses
**walking mode** (5 km/h, `length_m / walk_speed * congestion_factor`); brigades use driving mode.
A* with a haversine heuristic (admissible: distance ÷ max speed). Start and end coordinates are
snapped to the nearest graph node that still has open roads. Closed segments are removed from
the graph; every status change updates the graph immediately and is broadcast over Redis so all
workers stay in sync.

### Nearest assembly points
PostGIS `ST_DWithin` (geography) finds active candidates within `NEAREST_SEARCH_RADIUS_M`. With
`zone_id`, same-zone points are considered first but neighbours are still included. Each candidate
gets a real A* walking route; `score = eta_min * (1 + occupancy_penalty)` (penalty 0 below 70 %,
linear to 1.0 at 100 %). Points at or above `REROUTE_OCCUPANCY_PCT` are returned with
`near_full: true` and ranked last.

### Automatic rerouting
- A segment becomes `closed`, or `congested` with factor ≥ `CONGESTION_REROUTE_FACTOR`: citizens
  whose active route contains it are rerouted (GIN index on `routes.segment_ids`).
- A point reaches ≥ `REROUTE_OCCUPANCY_PCT`: citizens heading there are rerouted, excluding that point.

The new route excludes closed roads and near-full points, gets `version + 1` and a reason, and the
old route is deactivated. The citizen receives `route.rerouted` with old route, new route, reason
and ETA difference; dispatchers receive an aggregated `route.rerouted` with a count. Citizens
already marked `safe` are not rerouted.

### SOS priority (recomputed every 30 s)
`type_weight (collapse 40, medical 35, fire 30, flood 20) + min(wait_min * 2, 30) +
5 * other SOS within CLUSTER_RADIUS_M in the last 5 min + 15 if an active alert exists in the zone`.

### Crisis engine (RED ALERT)
Runs on every new SOS and every occupancy change.
- **SOS_CLUSTER**: at least `CLUSTER_MIN_DISTINCT` *distinct* citizens within `CLUSTER_WINDOW_MIN`
  either within `CLUSTER_RADIUS_M` of the new SOS (PostGIS, spheroid distance, inclusive) or in the
  same zone. The same-zone rule uses a **Redis sliding window** (one sorted set per zone, member =
  citizen, score = latest SOS time), confirmed against the DB.
- **POINT_OVERLOAD**: occupancy ≥ `RED_ALERT_OCCUPANCY_PCT`.
- **De-duplication**: an active alert in the same zone, or with its center within `CLUSTER_RADIUS_M`
  (or for the same point), is updated (`sos_ids` merged, `distinct_citizens` recounted) and
  `alert.updated` is emitted.
- **Recommendations**: the idle brigade with the lowest driving ETA, preferring the type that matches
  the dominant SOS type (medical→medical, fire→fire, collapse/flood→rescue), plus the nearest
  `reserve` point reachable on open roads with enough free capacity for the affected citizens.

`POST /alerts/{id}/confirm` does everything in **one DB transaction**: assigns the brigade to the
highest-priority SOS and computes its route, marks the related SOS `assigned`, activates the reserve
point, reroutes the affected citizens (`alert_new_point`), confirms the alert and writes `audit_log`.
Any failure rolls all of it back. The body may override `brigade_id` and/or `new_point_id`.
Events are published only after commit.

### Brigade simulation
Every 2 s, en-route and returning brigades move along their route geometry at 40 km/h
(`brigade.updated`). On arrival an en-route brigade becomes `on_site`. Resolving its last open SOS
sends it home (`returning`), and it becomes `idle` at base.

With several workers, each periodic job takes a short Redis lock, so it runs once per tick for the
whole cluster.

## API summary (prefix `/api/v1`)

Citizens identify with the `X-Device-Id: <uuid>` header (no login). Dispatcher endpoints need
`Authorization: Bearer <token>` from `POST /auth/login`.

| Method | Path | Who |
|---|---|---|
| POST | `/citizens/register` | citizen |
| PATCH | `/citizens/me/location`, `/citizens/me/status` | citizen |
| POST/GET | `/citizens/me/route` | citizen |
| GET | `/zones`, `/assembly-points`, `/assembly-points/nearest` | public |
| POST | `/assembly-points/{id}/check-in` | citizen |
| POST | `/sos` (429 on cooldown) · GET `/sos/me` | citizen |
| POST | `/auth/login` | dispatcher |
| GET | `/dispatch/overview`, `/dispatch/timeseries?minutes=` | dispatcher |
| GET | `/sos?status=&zone_id=&type=` · POST `/sos/{id}/resolve` | dispatcher |
| GET | `/brigades` · POST `/brigades/{id}/assign` | dispatcher |
| GET | `/alerts?status=` · POST `/alerts/{id}/confirm`, `/alerts/{id}/dismiss` | dispatcher |
| GET | `/traffic/segments?bbox=minLng,minLat,maxLng,maxLat&status=` | dispatcher |
| POST | `/sim/road-closure`, `/sim/barrier`, `/sim/occupancy`, `/sim/sos-burst`, `/sim/reset` | dispatcher |

Errors always look like `{"error": {"code": "SOS_COOLDOWN", "message": "…"}}` (validation errors
add `details`). Timestamps are ISO 8601 UTC (`…Z`).

## Persons with reduced mobility (Hərəkət məhdudiyyətli şəxs)

The registration form has a checkbox **Hərəkət məhdudiyyətli şəxs** → `mobility_impaired`:

```json
POST /api/v1/citizens/register
{"device_id": "3f2b8c1e-7a4d-4b6e-9f1a-2c3d4e5f6a7b", "phone": "+994501234567", "mobility_impaired": true}
```

- Calling `register` again updates the profile (omit the field to keep the current value). A change
  is copied to the citizen's open SOS signals.
- Each SOS stores `citizen_mobility_impaired`. Such SOS are **Priority #1**: `GET /sos` always lists
  them first (then `priority_score` desc, then oldest), and one-click alert confirm sends the brigade
  to them first. The documented priority-score formula itself is unchanged.
- Each SOS carries `labels` for the dispatcher panel to render as badges:
  `[{"code": "MOBILITY_IMPAIRED", "text": "Hərəkət məhdudiyyətli şəxs"}]` (English with
  `Accept-Language: en`: "Person with reduced mobility"). WebSocket events render the label text in
  each socket's language (`/ws/dispatch?token=…&lang=en`).
- Alerts expose `mobility_impaired_sos_ids` plus the same `labels`; the overview adds
  `active_sos_mobility_impaired`.

### Step-free (accessible) routes

Persons with reduced mobility are **never routed over stairs or other obstacles**:

- `road_segments.barrier` marks obstacles: `stairs`, `underpass`, `steep`, `curb`, `narrow`,
  `inaccessible` (NULL means step-free). The offline grid gets a deterministic ~11 % of links with
  barriers. The OSM builder maps `highway=steps`, `wheelchair=no`, pedestrian tunnels and
  `incline > 8 %`; use `--network walk` (the default), since the drive network has no steps.
- `assembly_points.wheelchair_accessible`: metro shelters (stairs/escalators) and the basement cinema
  shelter are not accessible.
- For a citizen with `mobility_impaired = true`:
  - `GET /assembly-points/nearest` returns only accessible points with step-free routes. Pass
    `accessible=true`, or send the citizen's `X-Device-Id` and it switches on automatically.
  - `POST /citizens/me/route` builds a step-free route at `ACCESSIBLE_WALK_SPEED_KMH` (3.5 km/h).
    It returns 409 `POINT_NOT_ACCESSIBLE` or 422 `NO_ACCESSIBLE_ROUTE` when that is impossible.
  - Every automatic reroute (road closed, point full, alert) stays step-free. If a dispatcher forces
    a point with no step-free path, the citizen is still evacuated and the route says
    `accessible: false`.
- `Route.accessible` tells the app whether the route is step-free. The crisis engine prefers an
  accessible reserve point when such persons are among the evacuees.
- `POST /sim/barrier {segment_id | lat,lng, barrier: "stairs" | null}` adds or removes an obstacle at
  runtime. Only mobility-impaired citizens using that segment are rerouted (reason `barrier`).
  `GET /traffic/segments?has_barrier=true` shows obstacles on the map. `/sim/reset` restores the
  seed barriers.
- After upgrading an existing database, regenerate the graph to get barriers:
  `docker compose exec api python -m app.seed.build_graph --source synthetic && docker compose restart api`.

## Resilient routing: external API outage (circuit breaker + fallback)

Citizen routes use an **external map & routing API** (OSRM-compatible, `EXTERNAL_ROUTING_URL`) as the
primary source. When it fails (HTTP 5xx, a response slower than `EXTERNAL_ROUTING_TIMEOUT_SEC` = 5 s,
a connection error, or a malformed body), the request **never fails**:

```
external API ──(5 s hard deadline)──► circuit breaker ──► fallback chain
                                      closed: calls pass        1. local road graph (A*, live closures/barriers)
                                      open:   3 failures ➜ skip  2. last cached route (Redis, in-memory LRU)
                                              for 30 s           3. static coordinate matrix (zone centroid × point)
                                      half_open: 1 trial call
```

- Routes served while the provider is down carry `routing_status: "fallback"`, their `source`
  (`local_graph` | `cache` | `static_matrix`) and a localized notice:
  `"notice": {"code": "ROUTING_FALLBACK", "text": "Oflayn/Ehtiyat marşrut rejimində işləyir"}`
  (EN: "Running in offline/backup routing mode"). Healthy: `routing_status: "online"`,
  `source: "external"`, `notice: null`.
- `GET /api/v1/routing/status` returns the mode, breaker state, failure count, last error and seconds
  until the next trial. Each breaker transition is pushed as the WebSocket event `routing.status` to
  dispatchers **and every citizen**, and all API workers adopt the state over Redis pub/sub. The
  overview and `/health` include `routing_status`.
- **Safety:** the provider doesn't know about our incidents, so an external route that touches a
  closed road is rejected and the local graph is used. External, cached and static routes have no
  local segment ids; closures still reroute them, matched by geometry. Step-free requests always use
  the local graph (the provider has no barrier data).
- Nearest-point ranking always uses the local graph. If the graph itself fails, the static matrix is
  used (`source: "static_matrix"` per item).
- **Demo / drill:** compose starts `routing-mock` (port 8090), an OSRM-compatible stand-in.
  `POST /sim/routing-fault {"mode": "error_503" | "timeout" | "ok", "delay_sec": 8}` breaks or repairs
  it. Setting `EXTERNAL_ROUTING_URL=` (empty) disables the external provider; the local graph is then
  primary and the status is always `online`.

| Variable | Default | Meaning |
|---|---|---|
| `EXTERNAL_ROUTING_URL` | `http://routing-mock:8080` (compose) | OSRM-compatible base URL; empty = disabled |
| `EXTERNAL_ROUTING_PROFILE` | `foot` | OSRM profile |
| `EXTERNAL_ROUTING_TIMEOUT_SEC` | `5` | hard deadline per call |
| `ROUTING_CB_FAILURE_THRESHOLD` | `3` | consecutive failures that open the breaker |
| `ROUTING_CB_RESET_SEC` | `30` | open → half-open after this many seconds |
| `ROUTE_CACHE_TTL_SEC` | `21600` | cached routes for the fallback |

Privacy: the external provider receives start/end coordinates. Point it only at a provider you are
allowed to share citizen locations with.

## SOS flood protection and RBAC

This section covers a panic-driven or bot-driven SOS flood (500+ fake requests at once). The goal is
that fake SOS never block the dispatcher panel, while real SOS keep flowing.

### Rate limits and login lock
- Limits are **sliding windows in Redis** (current window plus the weighted previous one), so there
  is no reset burst at window edges. They run *before* any DB work.
  - `POST /sos`: `RATE_SOS_PER_IP_PER_MIN` (30) per client IP. This is deliberately generous, because
    mobile carriers put many users behind one IP (CGNAT).
  - `POST /citizens/register`: `RATE_REGISTER_PER_IP_PER_MIN` (20) per IP.
  - Rejections return `429 RATE_LIMITED` with a `Retry-After` header and `details.retry_after_sec`.
    The per-device cooldown is still in place (`429 SOS_COOLDOWN`, also with `Retry-After`).
- **Login brute-force lock:** after `LOGIN_MAX_FAILURES` (5) failed logins per (IP, username), that
  pair is locked for `LOGIN_LOCK_SEC` (900 s) and gets `429 LOGIN_LOCKED`. The real user on another
  network can still log in. Failed logins are written to `audit_log`.
- Client IPs come from uvicorn `--proxy-headers`: `X-Forwarded-For` is honoured only from trusted
  proxies (127.0.0.1 by default). IPs are stored only as a keyed hash (`source_ip_hash`).
- If Redis is down, the checks **fail open**. In an emergency, availability matters more than strictness.

### Duplicates
- `Idempotency-Key` header: a client retry with the same key returns the SOS it already created
  (`200`, header `Idempotent-Replay: true`), even inside the cooldown.
- Identical reports from **different devices** with the same type, the same ~11 m cell and the same
  IP within `SPAM_DUP_WINDOW_SEC` (120 s) are merged into the first SOS: `duplicate_count += 1`,
  response `200` with header `X-Duplicate-Of`. The response carries the caller's own `citizen_id` and
  never the other reporter's note. Reports from different IPs are never merged.

### Quarantine
SOS from **new devices** (younger than `SPAM_NEW_DEVICE_SEC`, 600 s) are quarantined
(`is_suspected = true`) when either rule applies:
- `ip_mass_registration`: their IP registered more than `SPAM_REG_PER_IP_10MIN` (15) devices in the
  last 10 minutes;
- `flood_new_device`: the global SOS rate exceeds `SPAM_FLOOD_SOS_PER_10S` (100) ("flood mode").

Devices registered before the crisis are never quarantined. Quarantined SOS are stored, so nothing is
lost, but they:
- are hidden from `GET /sos` (use `suspected_only=true` or `include_suspected=true`);
- don't count in the overview (`suspected_sos` is shown separately) and don't mark the citizen
  `in_danger`;
- are ignored by the crisis engine and priority scoring;
- never get Priority #1, even if a bot ticks the reduced-mobility box;
- carry the label `SUSPECTED_SPAM`.

The bot gets a normal `201` with a plausible score, so it doesn't learn it was detected.

- `POST /sos/review {sos_ids: [...≤1000], verdict: "genuine" | "spam"}` (dispatcher role).
  `genuine` releases the SOS into the queue and runs the crisis engine; `spam` sets status `rejected`.
- Instead of one event per fake SOS, the panel gets an aggregated **`sos.suspected`** WebSocket event,
  **at most once every 5 seconds** (`{quarantined_pending, reason, flood_mode}`).

### Roles (RBAC)
| Action | operator | dispatcher | admin |
|---|:-:|:-:|:-:|
| Read SOS queue, overview, timeseries, brigades, alerts, traffic, `/ws/dispatch` | ✅ | ✅ | ✅ |
| Assign brigade, resolve SOS, confirm/dismiss alert, review quarantine | ❌ 403 | ✅ | ✅ |
| `/sim/*` (simulation and drills) | ❌ 403 | ❌ 403 | ✅ |

- A missing role returns `403 INSUFFICIENT_ROLE` (localized, names the required role).
- **JWT checks:** HS256 only (`alg: none` is rejected); `iss`, `aud`, `exp`, `iat`, `sub` and `role`
  are required; every token gets a `jti`.
- **The role is re-checked against the database on every request.** A demoted user's old token stops
  working, and a deactivated account (`is_active = false`) loses access immediately.
- Login returns `{access_token, token_type, role, expires_in}`.
- **Demo accounts** (seed): `admin/admin123` (admin), `dispatcher/dispatcher123` (dispatcher),
  `operator/operator123` (operator).
  > ⚠️ Change these passwords and `JWT_SECRET` before any shared deployment.

### Async crisis queue and worker process
- `POST /sos` only stores the SOS, announces it (`sos.created`) and pushes its id to a Redis list.
  The crisis engine runs in the **`worker` service** (`python -m app.worker`, `WORKER_CONSUMERS`
  consumers): priority, RED ALERT detection and merging, and recommendations. Results arrive as
  `sos.updated` and `alert.*` events.
- The worker also runs the periodic jobs (priority refresh, brigade movement) and follows the Redis
  bus to keep its road graph in sync. In compose the API runs with `CRISIS_CONSUMERS_PER_WORKER=0`
  and `ENABLE_BACKGROUND_TASKS=false`.
  If you run the API without the worker, keep the default `CRISIS_CONSUMERS_PER_WORKER=1`, or the
  queue is never processed.
- **Safety net:** each processed SOS gets `evaluated_at`. Every 30 s, unprocessed SOS older than
  15 s are re-enqueued (for example after a worker crash). If the queue can't be reached, the SOS is
  evaluated inline. Processing is idempotent.
- Recommendations use one reverse Dijkstra for all brigades instead of one A\* per brigade.
- The hot path is kept short. All Redis checks run in one pipeline *before* the DB, and the DB
  connection is held only for `SELECT citizen + INSERT + COMMIT`. Zones are looked up in memory, the
  DB pool is warmed at startup, and the Redis pool is bounded.

### Environment variables
| Variable | Default | Meaning |
|---|---|---|
| `RATE_LIMIT_ENABLED` | `true` | master switch |
| `RATE_SOS_PER_IP_PER_MIN` | `30` | SOS per client IP per minute |
| `RATE_REGISTER_PER_IP_PER_MIN` | `20` | registrations per IP per minute |
| `LOGIN_MAX_FAILURES` / `LOGIN_LOCK_SEC` | `5` / `900` | login brute-force lock |
| `SPAM_DUP_WINDOW_SEC` | `120` | duplicate-merge window |
| `SPAM_NEW_DEVICE_SEC` | `600` | device age below which the quarantine rules apply |
| `SPAM_REG_PER_IP_10MIN` | `15` | new devices per IP per 10 min before their SOS are quarantined |
| `SPAM_FLOOD_SOS_PER_10S` | `100` | global SOS rate that switches on flood mode |
| `JWT_ISSUER` / `JWT_AUDIENCE` | `baku-dispatch` / `dispatch-panel` | required JWT claims |
| `CRISIS_ASYNC` | `true` | crisis engine via the queue (tests set `false`) |
| `CRISIS_CONSUMERS_PER_WORKER` | `1` (compose: `0`) | consumers inside each API worker |
| `WORKER_CONSUMERS` | `4` | consumers in the worker process |
| `WEB_WORKERS` | `4` | uvicorn workers |
| `DB_POOL_SIZE` / `DB_MAX_OVERFLOW` | `6` / `3` | per worker (see measurements) |
| `REDIS_MAX_CONNECTIONS` | `64` | per-process Redis pool |

Postgres runs with `max_connections=200`.

### Load test and measured results
The test is a 690-request burst, all requests started at the same instant:
- 300 SOS from a single-IP bot farm (fresh devices; registration itself is rate limited);
- 300 SOS from a botnet of 150 IPs (2 fresh devices each);
- 50 real citizens with established devices;
- 40 dispatcher reads.

It runs against an **isolated** server (4 workers + worker process on the test DB and Redis DB 14), so
the dev stack is not touched.

```bash
# Python generator (multi-process):
docker compose run --rm -e PYTHONPATH=/srv api sh scripts/run_load_test.sh
# k6 generator (more accurate client timings): prepare + serve, fire with k6, report
docker compose run -d --name lt-server -e PYTHONPATH=/srv api sh scripts/run_load_test.sh --serve
#   wait until scripts/.lt_ready exists (scripts/ must be mounted from the host), then:
docker run --rm --network container:lt-server -v "$PWD/scripts:/scripts" grafana/k6:0.54.0 run /scripts/k6_burst.js
docker exec lt-server python scripts/load_test.py --base-url http://127.0.0.1:8100 --report scripts/.lt_jobs.json
docker rm -f lt-server
```

Results with the best configuration (4 API workers, DB pool 6+3, crisis queue, separate worker; k6):

| | average | p95 |
|---|---|---|
| server-side (`Server-Timing`) | **≈ 99 ms** | ≈ 330 ms |
| end to end (k6) | **≈ 440 ms** | ≈ 665 ms |
| *no-op `GET /health`, same 690-request burst (k6)* | *≈ 260 ms* | *≈ 470–525 ms* |

Outcome of the attack:
- all 50 real SOS reached the dispatcher queue;
- ≈ 240 bot SOS were quarantined;
- 270 of the bot farm's 300 requests got `429` (p50 ≈ 9 ms server-side).

**Honest reading:** the 300 ms average target is **met server-side but not end to end on this host**.
On this single Docker Desktop machine, a no-op endpoint already averages ≈ 260 ms under the same burst
of 690 simultaneous new connections. That floor comes from TCP and connection handling, not
application work. Closing the gap needs more hardware, horizontal scaling across hosts, or an edge
proxy that absorbs connection storms and reuses upstream connections.

Things that did *not* help: larger DB pools (worker × 20+10 caused connection storms and 500s) and
more API workers on the same host (CPU contention with the generator).

`docker/nginx/` contains an **optional, untested** edge-proxy configuration (keep-alive upstream, sets
`X-Forwarded-For` from the real peer). It is not part of compose and was never run.

## Localization (Azerbaijani / English)

All user-facing messages are available in **Azerbaijani (`az`, default)** and **English (`en`)**.

| Priority | How | Example |
|---|---|---|
| 1 | `?lang=` query parameter | `GET /api/v1/sos/me?lang=en` |
| 2 | `Accept-Language` header (q-values respected, regional tags such as `en-US` accepted) | `Accept-Language: en-US,en;q=0.9` |
| 3 | default | `az` |

```jsonc
// Accept-Language: en
{"error": {"code": "SOS_COOLDOWN", "message": "Please wait 42 seconds before sending another SOS."}}
// default / Accept-Language: az
{"error": {"code": "SOS_COOLDOWN", "message": "SOS siqnalını yenidən göndərmək üçün 42 saniyə gözləyin."}}
```

- Error `code` values never change with the language, so branch on `code` and show `message`.
- Every response carries `Content-Language` and `Vary: Accept-Language`.
- WebSocket close reasons follow the same rules (`/ws/dispatch?token=…&lang=en`).
- All texts live in one catalog, [`app/i18n.py`](app/i18n.py). To add a message, add a code with
  both translations and raise `AppError(status, "CODE", **params)`. A test fails if any raised
  code lacks a translation, or if the two translations use different `{placeholders}`.
- To add a language, extend `SUPPORTED_LANGS` and add the new key to every catalog entry.
- Place names (zones, assembly points, brigades) are proper nouns and stay in Azerbaijani.
  Validation `details` (field paths and pydantic messages) are technical and stay in English.

## WebSockets

| URL | Receives |
|---|---|
| `/ws/citizen?device_id=…` | `route.rerouted`, `sos.updated`, `point.occupancy` (own target point only), `broadcast.message` |
| `/ws/dispatch?token=<jwt>` | `sos.created`, `sos.updated`, `point.occupancy`, `road.updated`, `route.rerouted` (aggregated), `brigade.updated`, `alert.raised`, `alert.updated`, `alert.resolved`, `overview.updated` |

Envelope: `{"type": "<event>", "data": {...}, "ts": "<ISO>"}`. The server sends `ping` every 20 s.
Clients may send `ping` and get `pong` back. Sockets with an unknown device or an invalid token are
rejected at the handshake (close code 4401).

## Road graph

```bash
# offline synthetic grid (default; ~4.3k nodes / ~17k directed segments clipped to the districts)
docker compose exec api python -m app.seed.build_graph --source synthetic
# real OpenStreetMap drivable network (needs internet + OSMnx)
INSTALL_OSMNX=true docker compose build api
docker compose exec api python -m app.seed.build_graph --source osm
docker compose restart api   # workers reload the graph
```
`--source osm` falls back to the synthetic grid automatically if OSMnx or the network is unavailable.
Changing the graph invalidates stored routes: run `POST /sim/reset` afterwards.

## Tests

```bash
docker compose run --rm api pytest -q
```

The suite uses a separate `baku_test` database (created by `docker/postgres-init/20_test_db.sh`) and
Redis DB 15. It covers crisis-engine edge cases (3 vs 4 distinct citizens, one citizen ×4,
499 m vs 501 m, 4:59 vs 5:01, same-zone rule and window expiry), the 90 % reroute trigger (89 % does
not trigger), the 95 % alert trigger (94 % does not trigger), alert de-duplication, confirm
atomicity (success and full rollback), A* avoiding closed segments, SOS cooldown, the API contract,
simulation endpoints, brigade movement and WebSocket fan-out over Redis.

> If the Postgres volume existed before `20_test_db.sh` was added, create the test DB once:
> `docker compose exec db psql -U baku -c 'CREATE DATABASE baku_test' && docker compose exec db psql -U baku -d baku_test -c 'CREATE EXTENSION postgis'`

## Demo scenario (`scripts/demo.py`)

1. Resets the simulation, creates a citizen in Yasamal and routes them to the nearest park.
2. Closes a road on that route, which triggers a reroute (`road_closed`).
3. Raises the citizen's current target point to 91 %, which triggers a reroute (`point_full`).
4. Sends an SOS burst of 4 distinct citizens within 400 m over 2 minutes, which raises a RED ALERT
   with brigade and reserve-point recommendations.
5. Confirms the alert: the brigade is dispatched, the reserve point opens, citizens are rerouted, and
   brigade movement is shown.

Live WebSocket events for the dispatcher and the citizen are printed as they arrive.

## Design decisions and assumptions

- **Threshold comparisons are inclusive** (`>=`): 90 % reroutes and 95 % raises POINT_OVERLOAD;
  `ST_DWithin` is inclusive at exactly `CLUSTER_RADIUS_M`.
- **Road closures close both directions** by default (`both_directions: false` closes one).
- **Congestion slows pedestrians too** (crowded streets); the congestion factor applies in walking mode.
- On a road closure, the reroute picks the **best point overall** (not necessarily the same target),
  as the spec says "recompute the best route".
- `routes.node_path` is `bigint[]` because OSM node ids do not fit in `int4`.
- Brigades carry extra columns (`home_location`, `route_length_m`, `route_progress_m`) for the
  movement simulation; alerts store `recommended_new_point_distance_m` and `dismiss_reason`.
- Brigade ETA = route distance ÷ `BRIGADE_SPEED_KMH`, so the recommended ETA matches the
  movement simulation.
- For POINT_OVERLOAD alerts, no brigade is recommended (no SOS to assign); a reserve point is.
- `admin` / `admin123` is a demo credential from the seed. Change it, and `JWT_SECRET`, before any
  shared deployment.
