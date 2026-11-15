"""Localization: Azerbaijani (default) and English.

Language selection, highest priority first:
  1. `?lang=az|en` query parameter
  2. `Accept-Language` header (q-values respected, e.g. "en-US,en;q=0.9,az;q=0.8")
  3. DEFAULT_LANG
Every user-facing message lives in MESSAGES, keyed by the stable error/message code that clients
can rely on regardless of language.
"""
import string
from typing import Literal

from fastapi import Header, Query
from starlette.requests import HTTPConnection

SUPPORTED_LANGS: tuple[str, ...] = ("az", "en")
DEFAULT_LANG = "az"
Lang = Literal["az", "en"]

MESSAGES: dict[str, dict[str, str]] = {
    # --- generic HTTP ---
    "BAD_REQUEST": {"az": "Sorğu yanlışdır.", "en": "Bad request."},
    "UNAUTHORIZED": {"az": "Avtorizasiya tələb olunur (Bearer token).",
                     "en": "Authorization required (Bearer token)."},
    "FORBIDDEN": {"az": "Bu əməliyyata icazəniz yoxdur.", "en": "You are not allowed to perform this action."},
    "NOT_FOUND": {"az": "Resurs tapılmadı.", "en": "Resource not found."},
    "METHOD_NOT_ALLOWED": {"az": "Bu metod dəstəklənmir.", "en": "Method not allowed."},
    "CONFLICT": {"az": "Əməliyyat cari vəziyyətlə ziddiyyət təşkil edir.",
                 "en": "The operation conflicts with the current state."},
    "TOO_MANY_REQUESTS": {"az": "Çox sayda sorğu göndərilib.", "en": "Too many requests."},
    "HTTP_ERROR": {"az": "Sorğu emal edilə bilmədi.", "en": "The request could not be processed."},
    "VALIDATION_ERROR": {"az": "Sorğu məlumatları yanlışdır.", "en": "Invalid request data."},
    "INTERNAL_ERROR": {"az": "Daxili server xətası.", "en": "Internal server error."},
    # --- identity / auth ---
    "MISSING_DEVICE_ID": {"az": "X-Device-Id başlığı tələb olunur.", "en": "The X-Device-Id header is required."},
    "CITIZEN_NOT_REGISTERED": {"az": "Cihaz qeydiyyatdan keçməyib. Əvvəlcə /citizens/register çağırın.",
                               "en": "Device is not registered. Call /citizens/register first."},
    "INVALID_CREDENTIALS": {"az": "İstifadəçi adı və ya şifrə yanlışdır.", "en": "Invalid username or password."},
    "INVALID_TOKEN": {"az": "Token etibarsızdır.", "en": "Invalid token."},
    # --- assembly points / routes ---
    "POINT_NOT_FOUND": {"az": "Toplanma məntəqəsi tapılmadı.", "en": "Assembly point not found."},
    "POINT_NOT_ACTIVE": {"az": "Toplanma məntəqəsi hazırda aktiv deyil.", "en": "The assembly point is not active."},
    "POINT_FULL": {"az": "Toplanma məntəqəsi doludur.", "en": "The assembly point is full."},
    "POINT_CLOSED": {"az": "Toplanma məntəqəsi bağlıdır.", "en": "The assembly point is closed."},
    "NO_ROUTE": {"az": "Açıq yollarla bu nöqtəyə marşrut tapılmadı.",
                 "en": "No route to this point over open roads."},
    "ROUTE_NOT_FOUND": {"az": "Aktiv marşrut tapılmadı.", "en": "No active route."},
    "NO_ACCESSIBLE_ROUTE": {"az": "Bu nöqtəyə maneəsiz (pilləkənsiz) marşrut tapılmadı.",
                            "en": "No step-free route to this point."},
    "POINT_NOT_ACCESSIBLE": {"az": "Bu toplanma məntəqəsi hərəkət məhdudiyyətli şəxslər üçün əlçatan deyil.",
                             "en": "This assembly point is not accessible for persons with reduced mobility."},
    # --- SOS / brigades / alerts ---
    "SOS_NOT_FOUND": {"az": "SOS siqnalı tapılmadı.", "en": "SOS signal not found."},
    "SOS_ALREADY_RESOLVED": {"az": "SOS siqnalı artıq həll olunub.", "en": "The SOS signal is already resolved."},
    "SOS_COOLDOWN": {"az": "SOS siqnalını yenidən göndərmək üçün {seconds} saniyə gözləyin.",
                     "en": "Please wait {seconds} seconds before sending another SOS."},
    "BRIGADE_NOT_FOUND": {"az": "Briqada tapılmadı.", "en": "Brigade not found."},
    "BRIGADE_BUSY": {"az": "Briqada hazırda boş deyil.", "en": "The brigade is not idle."},
    "BRIGADE_UNREACHABLE": {"az": "Briqada açıq yollarla hadisə yerinə çata bilmir.",
                            "en": "The brigade cannot reach the incident over open roads."},
    "ALERT_NOT_FOUND": {"az": "Həyəcan siqnalı tapılmadı.", "en": "Alert not found."},
    "ALERT_NOT_ACTIVE": {"az": "Həyəcan siqnalı artıq emal olunub.", "en": "The alert has already been handled."},
    # --- abuse protection / RBAC ---
    "RATE_LIMITED": {"az": "Çox sayda sorğu göndərilib. {seconds} saniyə sonra yenidən cəhd edin.",
                     "en": "Too many requests. Try again in {seconds} seconds."},
    "LOGIN_LOCKED": {"az": "Çox sayda uğursuz giriş cəhdi. {seconds} saniyə sonra yenidən cəhd edin.",
                     "en": "Too many failed login attempts. Try again in {seconds} seconds."},
    "INSUFFICIENT_ROLE": {"az": "Bu əməliyyat üçün səlahiyyətiniz çatmır ({role} rolu tələb olunur).",
                          "en": "You are not allowed to perform this action (requires role: {role})."},
    "SUSPECTED_SPAM": {"az": "Şübhəli siqnal (yoxlanılmalıdır)", "en": "Suspected spam (needs review)"},
    # --- routing service status ---
    "ROUTING_FALLBACK": {"az": "Oflayn/Ehtiyat marşrut rejimində işləyir",
                         "en": "Running in offline/backup routing mode"},
    "ROUTING_FAULT_UNAVAILABLE": {"az": "Xəta simulyasiyası servisi əlçatan deyil.",
                                  "en": "The fault-injection service is not reachable."},
    # --- labels shown on dispatcher panels ---
    "MOBILITY_IMPAIRED": {"az": "Hərəkət məhdudiyyətli şəxs", "en": "Person with reduced mobility"},
    # --- dispatcher / simulation ---
    "SEGMENT_NOT_FOUND": {"az": "Yol seqmenti tapılmadı.", "en": "Road segment not found."},
    "INVALID_BBOX": {"az": "bbox formatı: minLng,minLat,maxLng,maxLat.",
                     "en": "bbox format: minLng,minLat,maxLng,maxLat."},
}


def placeholders(text: str) -> set[str]:
    return {name for _, name, _, _ in string.Formatter().parse(text) if name}


def normalize(lang: str | None) -> str | None:
    """'en-US' -> 'en'; returns None for unsupported languages."""
    if not lang:
        return None
    primary = lang.strip().lower().replace("_", "-").split("-")[0]
    return primary if primary in SUPPORTED_LANGS else None


def parse_accept_language(header: str | None) -> str | None:
    """Best supported language from an Accept-Language header, honouring q-values."""
    if not header:
        return None
    candidates: list[tuple[float, int, str]] = []
    for i, part in enumerate(header.split(",")):
        tag, *params = part.strip().split(";")
        q = 1.0
        for p in params:
            k, _, v = p.strip().partition("=")
            if k == "q":
                try:
                    q = float(v)
                except ValueError:
                    q = 0.0
        lang = normalize(tag)
        if lang and q > 0:
            candidates.append((-q, i, lang))
    return min(candidates)[2] if candidates else None


def negotiate(query_lang: str | None, accept_language: str | None) -> str:
    return normalize(query_lang) or parse_accept_language(accept_language) or DEFAULT_LANG


def lang_of(conn: HTTPConnection) -> str:
    """Language for an HTTP request or WebSocket connection."""
    return negotiate(conn.query_params.get("lang"), conn.headers.get("accept-language"))


def localize_labels(obj, lang: str):
    """Return a copy of an event payload with every `labels[].text` rendered in `lang`
    (events are produced once and fanned out to sockets that may use different languages)."""
    if isinstance(obj, dict):
        out = {}
        for k, v in obj.items():
            if k == "labels" and isinstance(v, list):
                out[k] = [{**lbl, "text": t(lbl["code"], lang)} if isinstance(lbl, dict) and "code" in lbl else lbl
                          for lbl in v]
            elif k == "notice" and isinstance(v, dict) and "code" in v:
                out[k] = {**v, "text": t(v["code"], lang)}
            else:
                out[k] = localize_labels(v, lang)
        return out
    if isinstance(obj, list):
        return [localize_labels(v, lang) for v in obj]
    return obj


def t(code: str, lang: str = DEFAULT_LANG, **params) -> str:
    entry = MESSAGES.get(code)
    if entry is None:
        return code
    text = entry.get(lang) or entry[DEFAULT_LANG]
    try:
        return text.format(**params)
    except (KeyError, IndexError):
        return text


async def language_params(
    accept_language: str | None = Header(None, alias="Accept-Language",
                                         description="Response language: `az` (default) or `en`.",
                                         examples=["en"]),
    lang: Lang | None = Query(None, description="Overrides Accept-Language: `az` or `en`."),
) -> str:
    """Declared on every /api/v1 route so the language options appear in the OpenAPI docs.
    The actual negotiation happens in the error handlers / middleware via `lang_of`."""
    return negotiate(lang, accept_language)
