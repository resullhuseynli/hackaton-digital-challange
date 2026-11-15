from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.errors import AppError
from app.config import settings
from app.models import AuditLog, Dispatcher
from app.services import antispam
from app.schemas.common import ErrorResponse
from app.security import create_access_token, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginIn(BaseModel):
    model_config = ConfigDict(json_schema_extra={"examples": [{"username": "admin", "password": "admin123"}]})
    username: str
    password: str


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: str        # operator | dispatcher | admin
    expires_in: int  # seconds


@router.post("/login", response_model=TokenOut,
             responses={401: {"model": ErrorResponse}, 429: {"model": ErrorResponse, "description": "LOGIN_LOCKED"}},
             description="Brute-force protection: after LOGIN_MAX_FAILURES failed attempts per (IP, username) "
                         "the login is locked for LOGIN_LOCK_SEC (429 `LOGIN_LOCKED`). The token carries the role "
                         "(RBAC) and is bound to iss/aud/exp.")
async def login(body: LoginIn, request: Request, session: AsyncSession = Depends(get_session)):
    ip_hash = antispam.request_ip_hash(request)
    if (retry := await antispam.login_lock_remaining(ip_hash, body.username)) > 0:
        raise AppError(429, "LOGIN_LOCKED", {"retry_after_sec": retry}, headers={"Retry-After": str(retry)},
                       seconds=retry)
    d = await session.scalar(select(Dispatcher).where(Dispatcher.username == body.username))
    if d is None or not d.is_active or not verify_password(body.password, d.password_hash):
        await antispam.login_failed(ip_hash, body.username)
        session.add(AuditLog(actor=body.username[:64], action="auth.login_failed", payload={"ip_hash": ip_hash}))
        await session.commit()
        raise AppError(401, "INVALID_CREDENTIALS")
    await antispam.login_succeeded(ip_hash, body.username)
    return TokenOut(access_token=create_access_token(d.username, d.role), role=d.role,
                    expires_in=settings.jwt_expire_minutes * 60)
