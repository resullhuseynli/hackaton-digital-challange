"""Uniform, localized error envelope: {"error": {"code": "...", "message": "..."}}.

Raise `AppError(status, CODE, **params)`; the message is resolved from app.i18n.MESSAGES in the
language negotiated for the request (Azerbaijani by default, English on request).
"""
import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.i18n import lang_of, t

log = logging.getLogger("app.errors")


class AppError(Exception):
    def __init__(self, status_code: int, code: str, details: dict | None = None,
                 headers: dict[str, str] | None = None, **params):
        super().__init__(code)
        self.status_code = status_code
        self.code = code
        self.details = details
        self.headers = headers
        self.params = params


# Shorthand constructors for errors used in several places
def citizen_not_registered() -> AppError:
    return AppError(401, "CITIZEN_NOT_REGISTERED")


def point_not_found() -> AppError:
    return AppError(404, "POINT_NOT_FOUND")


def no_route() -> AppError:
    return AppError(422, "NO_ROUTE")


_HTTP_CODES = {400: "BAD_REQUEST", 401: "UNAUTHORIZED", 403: "FORBIDDEN", 404: "NOT_FOUND",
               405: "METHOD_NOT_ALLOWED", 409: "CONFLICT", 429: "TOO_MANY_REQUESTS"}


def _response(request: Request, status: int, code: str, details=None, headers=None, **params) -> JSONResponse:
    lang = lang_of(request)
    err = {"code": code, "message": t(code, lang, **params)}
    if details:
        err["details"] = details
    hdrs = {"Content-Language": lang, "Vary": "Accept-Language"} | (headers or {})
    return JSONResponse(status_code=status, content={"error": err}, headers=hdrs)


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def _app_error(request: Request, exc: AppError):
        return _response(request, exc.status_code, exc.code, exc.details, headers=exc.headers, **exc.params)

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(request: Request, exc: StarletteHTTPException):
        return _response(request, exc.status_code, _HTTP_CODES.get(exc.status_code, "HTTP_ERROR"),
                         headers=dict(exc.headers or {}))

    @app.exception_handler(RequestValidationError)
    async def _validation_error(request: Request, exc: RequestValidationError):
        details = [{"loc": list(e["loc"]), "msg": e["msg"]} for e in exc.errors()]
        return _response(request, 422, "VALIDATION_ERROR", details)

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception):
        log.exception("unhandled error", exc_info=exc)
        return _response(request, 500, "INTERNAL_ERROR")
