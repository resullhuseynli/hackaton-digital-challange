from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+asyncpg://baku:baku@localhost:5432/baku"
    redis_url: str = "redis://localhost:6379/0"

    db_pool_size: int = 10
    db_max_overflow: int = 5
    redis_max_connections: int = 64  # per worker

    jwt_secret: str = "dev-only-secret-change-me"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 720
    jwt_issuer: str = "baku-dispatch"
    jwt_audience: str = "dispatch-panel"

    # crisis engine runs off the request path (Redis queue consumed by every API worker)
    crisis_async: bool = True
    crisis_consumers_per_worker: int = 1  # consumers inside each API worker (0 when a worker process runs)
    worker_consumers: int = 4             # consumers in the dedicated `python -m app.worker` process

    # --- abuse protection (SOS flood / spam attack) ---
    rate_limit_enabled: bool = True
    rate_sos_per_ip_per_min: int = 30        # generous: mobile carriers put many users behind one IP (CGNAT)
    rate_register_per_ip_per_min: int = 20
    login_max_failures: int = 5              # per (IP, username)
    login_lock_sec: int = 900
    spam_dup_window_sec: int = 120           # same spot + type + IP from different devices -> one SOS
    spam_new_device_sec: int = 600           # devices younger than this are "new"
    spam_reg_per_ip_10min: int = 15          # more new devices from one IP -> their SOS are quarantined
    spam_flood_sos_per_10s: int = 100        # global SOS rate that switches on flood mode
    cors_origins: str = "http://localhost:5173,http://localhost:3000"

    # crisis engine / routing thresholds
    cluster_radius_m: float = 500
    cluster_window_min: float = 5
    cluster_min_distinct: int = 4
    reroute_occupancy_pct: float = 90
    red_alert_occupancy_pct: float = 95
    sos_cooldown_sec: int = 60
    nearest_search_radius_m: float = 5000
    congestion_reroute_factor: float = 2.0
    walk_speed_kmh: float = 5.0
    accessible_walk_speed_kmh: float = 3.5  # wheelchair / reduced-mobility speed for step-free routes
    brigade_speed_kmh: float = 40.0

    # background loops
    enable_background_tasks: bool = True
    brigade_tick_sec: float = 2.0
    priority_tick_sec: float = 30.0
    ws_heartbeat_sec: float = 20.0

    graph_source: str = "synthetic"

    # external map & routing API (OSRM-compatible). Empty URL = disabled, local graph is primary.
    external_routing_url: str = ""
    external_routing_profile: str = "foot"
    external_routing_timeout_sec: float = 5.0
    external_routing_fault_url: str = ""  # fault-injection endpoint of the mock provider (demo only)
    routing_cb_failure_threshold: int = 3
    routing_cb_reset_sec: float = 30.0
    route_cache_ttl_sec: int = 6 * 3600

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()
