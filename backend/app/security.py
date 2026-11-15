import hashlib
import hmac
import uuid
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt

from app.config import settings

ROLES = ("operator", "dispatcher", "admin")
ROLE_LEVEL = {"operator": 1, "dispatcher": 2, "admin": 3}


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode(), password_hash.encode())
    except ValueError:
        return False


def create_access_token(username: str, role: str) -> str:
    now = datetime.now(timezone.utc)
    payload = {"sub": username, "role": role, "iat": now, "nbf": now,
               "exp": now + timedelta(minutes=settings.jwt_expire_minutes),
               "iss": settings.jwt_issuer, "aud": settings.jwt_audience, "jti": uuid.uuid4().hex}
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_token(token: str) -> dict | None:
    """Verifies signature (only the configured algorithm - never `none`), expiry, issuer and audience."""
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm],
                          audience=settings.jwt_audience, issuer=settings.jwt_issuer,
                          options={"require": ["exp", "iat", "sub", "role", "iss", "aud"]})
    except jwt.PyJWTError:
        return None


def ip_fingerprint(ip: str) -> str:
    """Keyed hash of a client IP: enough to group abuse, without storing the raw address."""
    return hmac.new(settings.jwt_secret.encode(), ip.encode(), hashlib.sha256).hexdigest()[:24]
