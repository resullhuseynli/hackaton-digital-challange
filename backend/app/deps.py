from fastapi import Depends, Header
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.errors import AppError, citizen_not_registered
from app.models import Citizen, Dispatcher
from app.security import ROLE_LEVEL, decode_token

bearer = HTTPBearer(auto_error=False)


async def current_citizen(x_device_id: str | None = Header(None, alias="X-Device-Id"),
                          session: AsyncSession = Depends(get_session)) -> Citizen:
    if not x_device_id:
        raise AppError(401, "MISSING_DEVICE_ID")
    citizen = await session.scalar(select(Citizen).where(Citizen.device_id == x_device_id))
    if citizen is None:
        raise citizen_not_registered()
    return citizen


async def dispatcher_from_token(token: str | None, session: AsyncSession) -> Dispatcher | None:
    """Valid signature/expiry/issuer/audience AND an active account whose *current* role in the DB
    equals the role in the token - so demoting or disabling a user revokes their tokens immediately."""
    payload = decode_token(token) if token else None
    if not payload:
        return None
    d = await session.scalar(select(Dispatcher).where(Dispatcher.username == payload["sub"]))
    if d is None or not d.is_active or d.role != payload.get("role"):
        return None
    return d


async def current_dispatcher(creds: HTTPAuthorizationCredentials | None = Depends(bearer),
                             session: AsyncSession = Depends(get_session)) -> Dispatcher:
    """Any authenticated panel user (operator, dispatcher or admin) - read access."""
    dispatcher = await dispatcher_from_token(creds.credentials if creds else None, session)
    if dispatcher is None:
        raise AppError(401, "UNAUTHORIZED")
    return dispatcher


def require_role(min_role: str):
    async def _dep(d: Dispatcher = Depends(current_dispatcher)) -> Dispatcher:
        if ROLE_LEVEL.get(d.role, 0) < ROLE_LEVEL[min_role]:
            raise AppError(403, "INSUFFICIENT_ROLE", role=min_role)
        return d
    return _dep


# critical operations: brigade dispatch, alert confirm/dismiss, SOS resolve/review
require_dispatcher = require_role("dispatcher")
# simulation / drills
require_admin = require_role("admin")
