"""SOS flood / spam-attack protection.

Layers, cheapest first (everything is Redis-only, so rejected traffic never touches PostgreSQL):
  1. Rate limits (fixed windows): SOS and registrations per client IP, failed logins per (IP, user).
  2. Idempotency-Key: a client retry returns the SOS it already created.
  3. Cross-device duplicates: the same type, at the same spot (~11 m cell), from the same IP within
     SPAM_DUP_WINDOW_SEC is merged into the first SOS (duplicate_count += 1).
  4. Quarantine: SOS from *new* devices (< SPAM_NEW_DEVICE_SEC) are flagged `is_suspected` when their IP
     registered many devices recently, or while the global SOS rate is in flood mode. Quarantined SOS
     are stored (nothing is lost) but hidden from the dispatcher queue, ignored by the crisis engine,
     never Priority #1, until a dispatcher reviews them.
Redis failures fail *open*: in an emergency, availability beats strictness.
"""
import logging
import time
from datetime import datetime

from fastapi import Request

from app.config import settings
from app.errors import AppError
from app.models import Citizen
from app.realtime.events import Event, EventList, bus
from app.security import ip_fingerprint

log = logging.getLogger("app.antispam")

FLOOD_WINDOW_SEC = 10
REG_WINDOW_SEC = 600


def client_ip(request: Request) -> str:
    """uvicorn --proxy-headers already resolves X-Forwarded-For from trusted proxies only."""
    return request.client.host if request.client else "unknown"


def request_ip_hash(request: Request) -> str:
    return ip_fingerprint(client_ip(request))


# --------------------------------------------------------------------------- rate limiting
async def sliding_count(key: str, window_sec: int) -> float:
    """Increment and return a sliding-window estimate: current window + the previous window weighted by
    how much of it still overlaps (no reset burst at window boundaries, one round trip)."""
    now = time.time()
    slot = int(now // window_sec)
    pipe = bus.redis.pipeline(transaction=False)
    pipe.incr(f"{key}:{slot}")
    pipe.expire(f"{key}:{slot}", window_sec * 2 + 1)
    pipe.get(f"{key}:{slot - 1}")
    current, _, previous = await pipe.execute()
    overlap = 1.0 - (now % window_sec) / window_sec
    return int(current) + int(previous or 0) * overlap


async def hit(key: str, limit: int, window_sec: int) -> tuple[bool, int]:
    """Sliding-window rate limit. Returns (allowed, retry_after_sec)."""
    if not settings.rate_limit_enabled or bus.redis is None:
        return True, 0
    try:
        count = await sliding_count(f"rl:{key}", window_sec)
    except Exception as exc:  # noqa: BLE001 - fail open
        log.warning("rate limiter unavailable: %r", exc)
        return True, 0
    if count > limit:
        return False, max(1, int(window_sec - time.time() % window_sec))
    return True, 0


def _limited(retry: int) -> AppError:
    return AppError(429, "RATE_LIMITED", {"retry_after_sec": retry}, headers={"Retry-After": str(retry)},
                    seconds=retry)


async def limit_sos(request: Request) -> None:
    """Route dependency: runs before the citizen lookup, so floods are rejected without DB work."""
    ok, retry = await hit(f"sos:{request_ip_hash(request)}", settings.rate_sos_per_ip_per_min, 60)
    if not ok:
        raise _limited(retry)


async def limit_register(request: Request) -> None:
    ok, retry = await hit(f"reg:{request_ip_hash(request)}", settings.rate_register_per_ip_per_min, 60)
    if not ok:
        raise _limited(retry)


# --------------------------------------------------------------------------- login brute force
def _login_key(ip_hash: str, username: str) -> str:
    return f"spam:login:{ip_hash}:{username.lower()}"


async def login_lock_remaining(ip_hash: str, username: str) -> int:
    if bus.redis is None:
        return 0
    try:
        key = _login_key(ip_hash, username)
        fails = int(await bus.redis.get(key) or 0)
        if fails >= settings.login_max_failures:
            return max(1, await bus.redis.ttl(key))
    except Exception:  # noqa: BLE001
        pass
    return 0


async def login_failed(ip_hash: str, username: str) -> None:
    if bus.redis is None:
        return
    try:
        key = _login_key(ip_hash, username)
        pipe = bus.redis.pipeline(transaction=True)
        pipe.incr(key)
        pipe.expire(key, settings.login_lock_sec)
        await pipe.execute()
    except Exception:  # noqa: BLE001
        pass


async def login_succeeded(ip_hash: str, username: str) -> None:
    if bus.redis is not None:
        try:
            await bus.redis.delete(_login_key(ip_hash, username))
        except Exception:  # noqa: BLE001
            pass


# --------------------------------------------------------------------------- signals
async def _incr(key: str, ttl: int) -> int:
    pipe = bus.redis.pipeline(transaction=True)
    pipe.incr(key)
    pipe.expire(key, ttl)
    count, _ = await pipe.execute()
    return int(count)


async def note_registration(ip_hash: str) -> None:
    if bus.redis is None:
        return
    try:
        await _incr(f"spam:reg:{ip_hash}:{int(time.time()) // REG_WINDOW_SEC}", REG_WINDOW_SEC + 1)
    except Exception:  # noqa: BLE001
        pass


async def registrations_from(ip_hash: str) -> int:
    if bus.redis is None:
        return 0
    try:
        return int(await bus.redis.get(f"spam:reg:{ip_hash}:{int(time.time()) // REG_WINDOW_SEC}") or 0)
    except Exception:  # noqa: BLE001
        return 0


async def note_sos_and_check_flood() -> bool:
    """Counts accepted SOS globally; True when the current window exceeds the flood threshold."""
    if bus.redis is None:
        return False
    try:
        return await sliding_count("spam:global", FLOOD_WINDOW_SEC) > settings.spam_flood_sos_per_10s
    except Exception:  # noqa: BLE001
        return False


async def assess(citizen: Citizen, ip_hash: str, flood: bool, now: datetime) -> tuple[bool, str | None]:
    """Quarantine decision for an SOS. Established devices are never quarantined."""
    created = citizen.created_at or now
    if (now - created).total_seconds() >= settings.spam_new_device_sec:
        return False, None
    if await registrations_from(ip_hash) > settings.spam_reg_per_ip_10min:
        return True, "ip_mass_registration"
    if flood:
        return True, "flood_new_device"
    return False, None


async def precheck(device_id: str, cooldown_sec: int, fp: str, ip_hash: str) -> tuple[bool, int, int | None, bool, int]:
    """All per-SOS Redis checks in ONE round trip, BEFORE any DB work (so a DB connection is only held
    for the short write): returns (cooldown_ok, cooldown_ttl, duplicate_of_id, flood_mode, registrations)."""
    if bus.redis is None:
        return True, 0, None, False, 0
    now = time.time()
    slot = int(now // FLOOD_WINDOW_SEC)
    cd_key = f"sos:cooldown:{device_id}"
    try:
        pipe = bus.redis.pipeline(transaction=False)
        pipe.set(cd_key, "1", nx=True, ex=cooldown_sec)
        pipe.ttl(cd_key)
        pipe.get(fp)
        pipe.incr(f"spam:global:{slot}")
        pipe.expire(f"spam:global:{slot}", FLOOD_WINDOW_SEC * 2 + 1)
        pipe.get(f"spam:global:{slot - 1}")
        pipe.get(f"spam:reg:{ip_hash}:{int(now) // REG_WINDOW_SEC}")
        cd_ok, ttl, dup, cur, _, prev, regs = await pipe.execute()
    except Exception as exc:  # noqa: BLE001 - fail open
        log.warning("anti-spam precheck unavailable: %r", exc)
        return True, 0, None, False, 0
    overlap = 1.0 - (now % FLOOD_WINDOW_SEC) / FLOOD_WINDOW_SEC
    flood = int(cur) + int(prev or 0) * overlap > settings.spam_flood_sos_per_10s
    return bool(cd_ok), int(ttl or 0), int(dup) if dup else None, flood, int(regs or 0)


def assess_with(citizen: Citizen, registrations: int, flood: bool, now: datetime) -> tuple[bool, str | None]:
    """Same rules as `assess`, from precheck() results (no extra round trip)."""
    created = citizen.created_at or now
    if (now - created).total_seconds() >= settings.spam_new_device_sec:
        return False, None
    if registrations > settings.spam_reg_per_ip_10min:
        return True, "ip_mass_registration"
    if flood:
        return True, "flood_new_device"
    return False, None


# --------------------------------------------------------------------------- duplicates / idempotency
def fingerprint(type_: str, lat: float, lng: float, ip_hash: str) -> str:
    return f"spam:fp:{type_}:{lat:.4f}:{lng:.4f}:{ip_hash}"


async def get_int(key: str) -> int | None:
    if bus.redis is None:
        return None
    try:
        v = await bus.redis.get(key)
        return int(v) if v else None
    except Exception:  # noqa: BLE001
        return None


async def remember(key: str, sos_id: int, ttl: int) -> None:
    if bus.redis is None:
        return
    try:
        await bus.redis.set(key, sos_id, ex=ttl, nx=True)
    except Exception:  # noqa: BLE001
        pass


def idempotency_key(device_id: str, key: str) -> str:
    return f"idem:{device_id}:{key[:128]}"


# --------------------------------------------------------------------------- dispatcher notification
async def notify_quarantine(events: EventList, build_payload) -> None:
    """At most one aggregated `sos.suspected` event per 5 s instead of one event per fake SOS,
    so a flood cannot drown the dispatcher's live feed. `build_payload` (async) runs only when an
    event is actually sent - no counting query for every quarantined request."""
    if bus.redis is None:
        return
    try:
        if await bus.redis.set("spam:notify", "1", nx=True, px=5000):
            events.append(Event("sos.suspected", await build_payload()))
    except Exception:  # noqa: BLE001
        pass
