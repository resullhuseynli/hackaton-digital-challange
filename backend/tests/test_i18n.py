"""Localization (az default, en on request)."""
import pathlib
import re
import uuid

import pytest

from app.errors import _HTTP_CODES
from app.i18n import MESSAGES, SUPPORTED_LANGS, negotiate, parse_accept_language, placeholders, t
from tests.conftest import register_citizen

API = "/api/v1"
APP_DIR = pathlib.Path(__file__).resolve().parents[1] / "app"


def test_catalog_is_complete_and_consistent():
    for code, entry in MESSAGES.items():
        assert set(entry) == set(SUPPORTED_LANGS), code
        assert all(entry[lang].strip() for lang in SUPPORTED_LANGS), code
        # both translations use the same {placeholders}
        assert placeholders(entry["az"]) == placeholders(entry["en"]), code


def test_every_raised_code_has_translations():
    used = set(_HTTP_CODES.values()) | {"HTTP_ERROR", "VALIDATION_ERROR", "INTERNAL_ERROR"}
    pattern = re.compile(r'AppError\(\s*\d{3},\s*"([A-Z_]+)"|t\("([A-Z_]+)"')
    for path in APP_DIR.rglob("*.py"):
        for m in pattern.finditer(path.read_text(encoding="utf-8")):
            used.add(m.group(1) or m.group(2))
    missing = sorted(used - MESSAGES.keys())
    assert missing == [], f"codes without translations: {missing}"


@pytest.mark.parametrize("query,header,expected", [
    (None, None, "az"),
    (None, "en", "en"),
    (None, "en-US,en;q=0.9", "en"),
    (None, "az-AZ", "az"),
    (None, "fr-FR,en;q=0.5", "en"),
    (None, "en;q=0.3,az;q=0.8", "az"),
    (None, "fr,de", "az"),
    (None, "en;q=0", "az"),
    ("en", "az", "en"),          # query parameter wins
    ("xx", "en", "en"),          # unsupported query value falls back to the header
])
def test_negotiation(query, header, expected):
    assert negotiate(query, header) == expected


def test_parse_accept_language_garbage():
    assert parse_accept_language(";;,q=abc") is None


def test_t_formats_params_and_falls_back():
    assert t("SOS_COOLDOWN", "en", seconds=42) == "Please wait 42 seconds before sending another SOS."
    assert t("SOS_COOLDOWN", "az", seconds=42) == "SOS siqnalını yenidən göndərmək üçün 42 saniyə gözləyin."
    assert t("UNKNOWN_CODE", "en") == "UNKNOWN_CODE"


async def test_errors_default_to_azerbaijani(client):
    r = await client.get(f"{API}/citizens/me/route")
    assert r.json()["error"] == {"code": "MISSING_DEVICE_ID", "message": "X-Device-Id başlığı tələb olunur."}
    assert r.headers["content-language"] == "az"


async def test_errors_in_english_via_header(client):
    r = await client.get(f"{API}/citizens/me/route", headers={"Accept-Language": "en-US,en;q=0.9"})
    assert r.json()["error"] == {"code": "MISSING_DEVICE_ID", "message": "The X-Device-Id header is required."}
    assert r.headers["content-language"] == "en"


async def test_query_param_overrides_header(client):
    r = await client.get(f"{API}/citizens/me/route", params={"lang": "az"},
                         headers={"Accept-Language": "en", "X-Device-Id": str(uuid.uuid4())})
    assert r.json()["error"]["code"] == "CITIZEN_NOT_REGISTERED"
    assert r.json()["error"]["message"].startswith("Cihaz qeydiyyatdan keçməyib")


async def test_invalid_lang_query_value_is_a_validation_error(client):
    r = await client.get(f"{API}/zones", params={"lang": "fr"}, headers={"Accept-Language": "en"})
    assert r.status_code == 422
    assert r.json()["error"] == {"code": "VALIDATION_ERROR", "message": "Invalid request data.",
                                 "details": r.json()["error"]["details"]}


async def test_parametrized_message_in_both_languages(client):
    h = await register_citizen(client)
    body = {"type": "fire", "lat": 40.38, "lng": 49.84}
    assert (await client.post(f"{API}/sos", json=body, headers=h)).status_code == 201
    en = (await client.post(f"{API}/sos", json=body, headers=h | {"Accept-Language": "en"})).json()["error"]
    assert en["code"] == "SOS_COOLDOWN"
    assert re.fullmatch(r"Please wait \d+ seconds before sending another SOS\.", en["message"])
    az = (await client.post(f"{API}/sos", json=body, headers=h)).json()["error"]
    assert re.fullmatch(r"SOS siqnalını yenidən göndərmək üçün \d+ saniyə gözləyin\.", az["message"])


async def test_framework_errors_are_localized(client):
    r = await client.get(f"{API}/does-not-exist", headers={"Accept-Language": "en"})
    assert r.status_code == 404 and r.json()["error"] == {"code": "NOT_FOUND", "message": "Resource not found."}
    r = await client.post(f"{API}/auth/login", json={"username": "admin", "password": "x"}, params={"lang": "en"})
    assert r.json()["error"]["message"] == "Invalid username or password."


async def test_successful_responses_carry_content_language(client):
    r = await client.get(f"{API}/zones", headers={"Accept-Language": "en"})
    assert r.status_code == 200 and r.headers["content-language"] == "en"
    assert "accept-language" in r.headers["vary"].lower()


async def test_openapi_documents_language_options(client):
    spec = (await client.get("/openapi.json")).json()
    params = spec["paths"]["/api/v1/zones"]["get"]["parameters"]
    names = {(p["in"], p["name"]) for p in params}
    assert ("header", "Accept-Language") in names and ("query", "lang") in names
