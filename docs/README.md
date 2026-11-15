# Bakı Təxliyə və Dispetçer Platforması

Bakı şəhəri üçün fövqəladə hallarda (zəlzələ, daşqın, sənaye qəzası, kütləvi tədbir) əhalinin
təxliyəsini və xilasedici briqadaların idarəsini birləşdirən platforma.

| İstifadəçi | Ünvan | Nə edir |
| --- | --- | --- |
| **Vətəndaş** (girişsiz, mobil) | `/` | Cihazı qeydiyyatdan keçirir, ən yaxın toplanma məntəqəsini tapır, təxliyə marşrutu ilə gedir, avtomatik yenidən marşrutlaşdırma alır, SOS göndərir, məntəqədə qeydiyyatdan keçir |
| **Dispetçer** (JWT, masaüstü) | `/dispatcher` | Canlı vəziyyəti izləyir, SOS-ları prioritetə görə emal edir, RED ALERT-i bir kliklə icra edir, briqadaları xəritədə izləyir, təlim ssenariləri işlədir |

Ətraflı texniki sənədlər: [backend/README.md](../backend/README.md), [frontend/README.md](../frontend/README.md).
Digər sənədlər: [AI_DECLARATION.md](AI_DECLARATION.md), [Texniki_Izah.docx](Texniki_Izah.docx).

---

## 1. Lokal mühitdə işə salma

### 1.1 Tələblər

| Alət | Versiya | Nə üçün |
| --- | --- | --- |
| Docker Desktop (Compose v2) | son versiya | Backend, PostgreSQL/PostGIS, Redis, routing-mock |
| Node.js | 20+ | Frontend (Vite) |
| Python | 3.12 | Yalnız backend-i Docker-siz işə salanda |

Portlar: `8000` (API), `5432` (PostgreSQL), `6379` (Redis), `8090` (routing-mock), `5173` (frontend).

### 1.2 Variant A — Docker ilə (tövsiyə olunur)

```bash
# 1. Backend: API + PostgreSQL 16/PostGIS + Redis 7 + xarici routing API-nin mock-u
cd backend
cp .env.example .env            # istəyə bağlı; olmasa, standart dəyərlər işləyir
docker compose up --build
```

İlk açılışda API konteyneri avtomatik olaraq:
1. `alembic upgrade head` ilə miqrasiyaları (0001–0006) tətbiq edir;
2. Bakı məlumatlarını yükləyir: 11 zona, 33 toplanma məntəqəsi, 10 briqada, yol qrafı, demo dispetçer `admin` / `admin123`;
3. Uvicorn-u bir neçə worker ilə işə salır.

```bash
# 2. Frontend (ayrı terminalda)
cd frontend
cp .env.example .env            # VITE_API_URL=http://localhost:8000, VITE_WS_URL=ws://localhost:8000
npm install
npm run dev                     # http://localhost:5173
```

| Ünvan | Nə var |
| --- | --- |
| <http://localhost:5173/> | Vətəndaş tətbiqi (DevTools-da telefon ölçüsündə açın) |
| <http://localhost:5173/dispatcher> | Dispetçer paneli (`admin` / `admin123`) |
| <http://localhost:8000/docs> | Swagger UI (nümunələrlə) |
| <http://localhost:8000/health> | Sağlamlıq yoxlaması |

Faydalı əmrlər:

```bash
docker compose exec api python scripts/demo.py        # tam demo ssenarisi (konsolda canlı WS hadisələri)
docker compose run --rm api pytest -q                 # backend testləri (ayrı baku_test bazası, Redis DB 15)
docker compose run --rm api sh scripts/run_load_test.sh   # SOS flood yük testi (izolə olunmuş server)
cd frontend && npm test && npm run lint && npm run build  # frontend testləri, lint, build
```

### 1.3 Variant B — Lokal runtime (Docker-siz backend)

PostgreSQL 16 + PostGIS 3.4 və Redis 7 lokal quraşdırılmış olmalıdır.

```bash
# Baza
psql -U postgres -c "CREATE USER baku WITH PASSWORD 'baku'"
psql -U postgres -c "CREATE DATABASE baku OWNER baku"
psql -U postgres -d baku -c "CREATE EXTENSION postgis"

# Backend
cd backend
python -m venv .venv
source .venv/bin/activate              # Windows: .venv\Scripts\activate
pip install -r requirements.txt -r requirements-dev.txt
cp .env.example .env
# .env-də: DATABASE_URL=postgresql+asyncpg://baku:baku@localhost:5432/baku
#          REDIS_URL=redis://localhost:6379/0
#          EXTERNAL_ROUTING_URL=        (boş = xarici routing söndürülür, lokal qraf əsasdır)
#          EXTERNAL_ROUTING_FAULT_URL=
alembic upgrade head
python -m app.seed.seed --if-empty --graph synthetic
uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 2 --proxy-headers

# (istəyə bağlı) Xarici routing API-nin mock-u — circuit breaker drill-i üçün
uvicorn mock_routing.main:app --port 8090
# bu halda .env-də EXTERNAL_ROUTING_URL=http://localhost:8090
#                    EXTERNAL_ROUTING_FAULT_URL=http://localhost:8090/__fault
```

Frontend addımları Variant A ilə eynidir.

### 1.4 Backend-siz rejim (yalnız UI nümayişi)

```bash
cd frontend && npm run dev:mock
```

MSW brauzer daxilində REST və WebSocket trafikini simulyasiya edir. Pilləkənsiz marşrutlaşdırma, maneə
məntiqi və routing fallback burada **yoxdur** — bunları real backend ilə nümayiş etdirin.

### 1.5 Konfiqurasiya

Bütün parametrlər mühit dəyişənləri ilə idarə olunur (tam siyahı: [backend/.env.example](../backend/.env.example),
[frontend/.env.example](../frontend/.env.example)). Ən vacibləri:

| Dəyişən | Standart | Məna |
| --- | --- | --- |
| `JWT_SECRET` | `dev-only-secret-change-me` | **İstənilən paylaşılan mühitdə dəyişdirin** |
| `CORS_ORIGINS` | `http://localhost:5173,http://localhost:3000` | İcazəli frontend mənbələri |
| `WEB_WORKERS` | compose-da `6` | Uvicorn worker sayı |
| `GRAPH_SOURCE` | `synthetic` | `synthetic` (oflayn qəfəs) və ya `osm` (OSMnx) |
| `EXTERNAL_ROUTING_URL` | `http://routing-mock:8080` | OSRM-uyğun xarici API; boş = söndürülüb |
| `CLUSTER_MIN_DISTINCT` / `CLUSTER_RADIUS_M` / `CLUSTER_WINDOW_MIN` | `4` / `500` / `5` | RED ALERT klaster qaydası |
| `REROUTE_OCCUPANCY_PCT` / `RED_ALERT_OCCUPANCY_PCT` | `90` / `95` | Doluluq hədləri |

> `admin` / `admin123` və standart `JWT_SECRET` yalnız demo üçündür.

---

## 2. Challenge Drop dəyişikliklərinə uyğunlaşma

Əsas tapşırıq (təxliyə marşrutu, SOS, RED ALERT, briqada simulyasiyası) üzərinə hakaton boyu yeni
tələblər (Challenge Drop) gəldi. Hər biri **mövcud API müqaviləsini sındırmadan** əlavə edildi:
yeni sahələr əlavə olunur, köhnələr dəyişmir, DB dəyişiklikləri ayrıca Alembic miqrasiyası ilə gəlir.

### Drop 1 — Hərəkət məhdudiyyətli şəxslər (əlçatanlıq)

**Tələb:** əlil arabasında olan / hərəkəti məhdud vətəndaşlar pilləkənsiz marşrut almalı, yalnız
əlçatan məntəqələrə yönləndirilməli, SOS-ları isə növbədə birinci olmalıdır.

| Qat | Dəyişiklik |
| --- | --- |
| DB | `0002`: `citizens.mobility_impaired`, `sos_signals.citizen_mobility_impaired`. `0003`: `road_segments.barrier` (`stairs`, `underpass`, `steep`, `curb`, `narrow`, `inaccessible`), `assembly_points.wheelchair_accessible`, `routes.accessible` |
| Backend | Maneəli seqmentlərdən keçməyən A* marşrutu, 3.5 km/saat sürət; yalnız əlçatan məntəqələr; bütün avtomatik reroute-lar pilləkənsiz qalır; `GET /sos` belə SOS-ları həmişə birinci verir; RED ALERT təsdiqində briqada əvvəlcə onlara göndərilir; `POST /sim/barrier` ilə canlı maneə; yeni xəta kodları `POINT_NOT_ACCESSIBLE`, `NO_ACCESSIBLE_ROUTE` |
| Frontend | Qeydiyyatda “Hərəkət məhdudiyyətli şəxs” checkbox-u, “♿ Maneəsiz rejim” çipi, bənövşəyi pilləkənsiz marşrut xətti, dispetçerdə “#1 PRİORİTET” nişanı, ayrıca səs siqnalı, klasterlərdə ♿ sayğacı, maneələr qatı; WCAG 2.1 AA, Lighthouse a11y = 100 |

### Drop 2 — Xarici xəritə/marşrut API-nin sıradan çıxması

**Tələb:** xarici API 503 qaytaranda və ya 5 saniyədən gec cavab verəndə vətəndaş marşrutsuz qalmamalıdır.

| Qat | Dəyişiklik |
| --- | --- |
| DB | `0004`: `routes.source`, `routes.degraded` |
| Backend | `routing_gateway` + `circuit_breaker`: 5 s sərt limit; 3 ardıcıl xəta → breaker 30 s açıq → half-open sınaq. Fallback zənciri: **lokal yol qrafı → Redis/LRU keşdəki son marşrut → statik koordinat matrisi**. Bağlı yola toxunan xarici marşrut rədd edilir. Breaker vəziyyəti Redis pub/sub ilə bütün worker-lərə və `routing.status` WS hadisəsi ilə hamıya yayılır. `GET /routing/status`, `POST /sim/routing-fault` (drill) |
| Frontend | Sakit, bloklamayan sarı banner (“Oflayn/Ehtiyat marşrut rejimində işləyir”), “Ehtiyat rejim” nişanı, təxmini marşrut üçün qırıq xətt və “≈”; dispetçerdə breaker vəziyyəti, xəta sayı və sınağa qədər geri sayım plitəsi |

### Drop 3 — SOS flood / spam hücumu və rol əsaslı giriş

**Tələb:** bot fermaları və botnetlər minlərlə saxta SOS göndərəndə real SOS-lar itməməli, dispetçer
paneli işləməyə davam etməlidir.

| Qat | Dəyişiklik |
| --- | --- |
| DB | `0005`: `sos_signals.is_suspected`, `suspicion_reason`, `duplicate_count`, `source_ip_hash`; `citizens.created_at`; `dispatchers.role`, `is_active` |
| Backend | Qatlı müdafiə (hamısı Redis-də, rədd edilən trafik PostgreSQL-ə çatmır): IP üzrə sliding-window rate limit, `Idempotency-Key`, eyni nöqtə+tip+IP dublikatlarının birləşdirilməsi, yeni cihazlardan gələn şübhəli SOS-ların karantini (silinmir, `POST /sos/review` ilə yoxlanır), login brute-force kilidi. RBAC: `operator` < `dispatcher` < `admin`; rol dəyişəndə köhnə tokenlər dərhal etibarsız olur. IP-lər xam saxlanmır (HMAC hash) |

### Drop 4 — Yük altında performans

**Tələb:** flood zamanı `POST /sos` gecikməsi artmamalıdır.

| Qat | Dəyişiklik |
| --- | --- |
| DB | `0006`: `sos_signals.evaluated_at` |
| Backend | Crisis engine sorğu yolundan çıxarıldı: `POST /sos` yalnız yazır və SOS id-ni Redis növbəsinə qoyur; hər worker-də consumer tapşırıqlar prioritet, klaster və RED ALERT hesabını ayrıca tranzaksiyada aparır. İdempotentdir; işlənməmiş SOS-lar periodik iş tərəfindən yenidən növbəyə qoyulur. Redis əlçatmazdırsa, inline qiymətləndirmə. Yoxlama: `scripts/load_test.py`, `scripts/k6_burst.js` |

### Uyğunlaşma prinsipləri

- **Geriyə uyğunluq:** yeni sahələr yalnız əlavə olunur; frontend köhnə cavablarla da işləyir.
- **Hər Drop = miqrasiya + test + sənəd:** hər dəyişiklik üçün pytest testləri yazılıb (məs. `test_accessible_routing.py`, `test_routing_resilience.py`, `test_flood_protection.py`).
- **Fail-open vs fail-closed:** fövqəladə vəziyyətdə əlçatanlıq sərtlikdən vacibdir — Redis düşəndə rate limit açıq buraxılır, növbə yerinə inline emal edilir; təhlükəsizlik isə (bağlı yol, maneə) heç vaxt güzəştə getmir.
- **Lokalizasiya:** bütün yeni mesajlar AZ/EN kataloqda (`app/i18n.py`, `src/i18n/locales/*.json`); tərcüməsi olmayan kod testi sındırır.

---

## 3. Sistem arxitekturası

### 3.1 Ümumi sxem

```mermaid
flowchart LR
    subgraph Client["Brauzer (React 18 + Vite PWA)"]
        C["Vətəndaş tətbiqi<br/>/ (mobil)"]
        D["Dispetçer paneli<br/>/dispatcher (JWT)"]
    end

    subgraph API["FastAPI (Uvicorn, N worker)"]
        R["REST /api/v1<br/>Pydantic v2"]
        WS["WebSocket<br/>/ws/citizen, /ws/dispatch"]
        AS["Anti-spam<br/>rate limit, karantin"]
        RG["Routing gateway<br/>circuit breaker"]
        G["NetworkX A*<br/>yol qrafı (yaddaşda)"]
        CQ["Crisis queue<br/>consumer-lər"]
        BG["Fon işləri<br/>prioritet 30 s, briqada 2 s"]
    end

    PG[("PostgreSQL 16<br/>+ PostGIS")]
    RD[("Redis 7<br/>pub/sub, növbə, limitlər, keş")]
    EXT["Xarici routing API<br/>(OSRM-uyğun / routing-mock)"]
    OSM["OpenStreetMap<br/>xəritə plitələri"]

    C -- "HTTPS + X-Device-Id" --> R
    D -- "HTTPS + Bearer JWT" --> R
    C <-- "WS hadisələr" --> WS
    D <-- "WS hadisələr" --> WS
    C & D -- "plitələr" --> OSM

    R --> AS --> RD
    R -- "SQLAlchemy async / asyncpg" --> PG
    R --> RG
    RG -- "5 s limit" --> EXT
    RG -- "fallback" --> G
    RG -- "son marşrut keşi" --> RD
    R -- "SOS id" --> CQ
    CQ <--> RD
    CQ --> PG
    BG --> PG
    R & CQ & BG -- "publish" --> RD
    RD -- "subscribe (bütün worker-lər)" --> WS
```

### 3.2 Əsas axın: vətəndaş SOS → RED ALERT → briqada

```mermaid
sequenceDiagram
    autonumber
    participant V as Vətəndaş (React)
    participant API as FastAPI
    participant RD as Redis
    participant PG as PostgreSQL/PostGIS
    participant Q as Crisis consumer
    participant DP as Dispetçer (React)

    V->>API: POST /api/v1/sos (X-Device-Id, Idempotency-Key)
    API->>RD: rate limit, dublikat, karantin yoxlaması
    API->>PG: INSERT sos_signals
    API->>RD: LPUSH crisis:queue
    API-->>V: 201 Created (dərhal)
    Q->>RD: RPOP crisis:queue
    Q->>PG: prioritet + ST_DWithin klaster (≥4 fərqli vətəndaş, 500 m, 5 dəq)
    Q->>PG: INSERT/UPDATE alerts (+ briqada və ehtiyat məntəqə tövsiyəsi)
    Q->>RD: PUBLISH alert.raised
    RD-->>DP: WS /ws/dispatch: alert.raised
    DP->>API: POST /alerts/{id}/confirm (Bearer JWT)
    API->>PG: tək tranzaksiya: briqada təyini, məntəqə aktivləşdirmə, reroute, audit_log
    API->>RD: PUBLISH brigade.updated, route.rerouted
    RD-->>V: WS /ws/citizen: route.rerouted, sos.updated
    RD-->>DP: WS: brigade.updated (hər 2 s hərəkət)
```

### 3.3 Qatlar

| Qat | Texnologiya | Məsuliyyət |
| --- | --- | --- |
| Frontend | React 18, TypeScript, Vite, TanStack Query, Zustand, MapLibre GL, Tailwind, Recharts, PWA | UI, xəritə, WS hadisələri ilə keşin yerində yenilənməsi, oflayn SOS növbəsi, AZ/EN |
| API | FastAPI, Pydantic v2, Uvicorn | REST müqaviləsi, autentifikasiya (JWT/RBAC, X-Device-Id), validasiya, vahid xəta formatı |
| Domen servisləri | Python (`app/services/`) | Marşrutlaşdırma (A*), reroute, crisis engine, prioritet, briqada simulyasiyası, anti-spam |
| Real-time | Native WebSocket + Redis pub/sub | Hadisələrin bütün worker-lərə və klientlərə yayılması |
| Verilənlər | PostgreSQL 16 + PostGIS (GIST indekslər), Alembic | Məkan sorğuları (`ST_DWithin`), tranzaksiyalar, audit |
| Keş/növbə | Redis 7 | Sliding window-lar, cooldown-lar, iş kilidləri, crisis növbəsi, marşrut keşi |
| Xarici | OSRM-uyğun routing API, OSM plitələri | Əsas marşrut mənbəyi (fallback ilə qorunur) |

### 3.4 Qovluq strukturu

```
hackaton/
├── backend/          FastAPI tətbiqi, Alembic miqrasiyaları, testlər, skriptlər, docker-compose.yml
│   ├── app/          api/v1, services, models, schemas, realtime, seed
│   ├── mock_routing/ xarici routing API-nin OSRM-uyğun mock-u (fault injection ilə)
│   └── tests/        pytest (real PostGIS + Redis)
├── frontend/         React + Vite tətbiqi (vətəndaş + dispetçer)
└── docs/             bu sənədlər
```
