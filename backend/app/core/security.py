"""Password hashing (Argon2 via pwdlib), the password policy, opaque tokens and JWT access tokens. Secrets come from settings only."""
import hashlib
import hmac
import re
import secrets
from datetime import UTC, datetime, timedelta

import jwt
from pwdlib import PasswordHash

from app.core.config import get_settings

_hasher = PasswordHash.recommended()  # argon2id

PASSWORD_RULES = (
    (r".{8,}", "at least 8 characters"),
    (r"[A-Z]", "an uppercase letter"),
    (r"[a-z]", "a lowercase letter"),
    (r"\d", "a number"),
    (r"[^A-Za-z0-9]", "a special character"),
)


def password_problems(password: str) -> list[str]:
    """What a candidate password is still missing (empty list = acceptable)."""
    return [label for pattern, label in PASSWORD_RULES if not re.search(pattern, password or "")]


def hash_password(plain: str) -> str:
    return _hasher.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return _hasher.verify(plain, hashed)
    except Exception:  # malformed / foreign hash: never a match
        return False


def sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def new_token(nbytes: int = 32) -> str:
    return secrets.token_urlsafe(nbytes)


def safe_equal(a: str, b: str) -> bool:
    return hmac.compare_digest(a.encode("utf-8"), b.encode("utf-8"))


def temp_password() -> str:
    """A policy-compliant random password for admin resets (shown once, never stored in clear)."""
    core = secrets.token_urlsafe(9).replace("-", "x").replace("_", "y")
    return f"{core[:6].capitalize()}{secrets.randbelow(90) + 10}{secrets.choice('!@#$%&*')}{core[6:9].lower()}"


# ---- JWT access tokens -------------------------------------------------------------------------------------------------
def create_access_token(user_id: str, session_id: str) -> tuple[str, datetime]:
    settings = get_settings()
    if not settings.jwt_configured:
        raise RuntimeError("JWT_SECRET_KEY is not configured.")
    now = datetime.now(UTC)
    expires = now + timedelta(minutes=settings.access_token_expire_minutes)
    payload = {"sub": user_id, "sid": session_id, "type": "access", "iat": int(now.timestamp()), "exp": int(expires.timestamp()), "jti": secrets.token_hex(8)}
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm), expires


def decode_access_token(token: str) -> dict:
    """Raises jwt.PyJWTError for anything that is not a valid, unexpired access token signed with our secret."""
    settings = get_settings()
    payload = jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm], options={"require": ["exp", "sub", "sid"]})
    if payload.get("type") != "access":
        raise jwt.InvalidTokenError("not an access token")
    return payload
