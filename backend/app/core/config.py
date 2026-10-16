"""Application settings, loaded from environment variables / the local `.env` file (never from source code)."""
import json
from functools import lru_cache
from pathlib import Path
from typing import Annotated, Literal
from urllib.parse import quote, unquote

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]
PLACEHOLDER_MARKERS = ("YOUR_", "CHANGE_ME", "example.com")


def looks_like_placeholder(value: str | None) -> bool:
    """True while a setting still holds the value copied from `.env.example`."""
    return not value or any(marker in value for marker in PLACEHOLDER_MARKERS)


def normalise_database_url(url: str) -> str:
    """Forces the psycopg 3 driver scheme and percent-encodes credentials (the LAST @ separates credentials from host, so a raw @ in a password is tolerated)."""
    if not url:
        return url
    scheme, sep, rest = url.partition("://")
    if not sep:
        return url
    if scheme in ("postgres", "postgresql", "postgresql+psycopg2"):
        scheme = "postgresql+psycopg"
    authority, slash, tail = rest.partition("/")
    userinfo, at, hostport = authority.rpartition("@")
    if at and ":" in userinfo:
        user, _, password = userinfo.partition(":")
        userinfo = f"{quote(unquote(user), safe='')}:{quote(unquote(password), safe='')}"
    return f"{scheme}://{userinfo}{at}{hostport}{slash}{tail}"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BACKEND_DIR / ".env", env_file_encoding="utf-8", extra="ignore")

    # application
    app_name: str = "LAX360 Business CRM API"
    app_env: Literal["development", "staging", "production", "test"] = "development"
    debug: bool = False
    api_v1_prefix: str = "/api/v1"
    # comma-separated in the environment; NoDecode stops pydantic-settings from expecting JSON
    # the browser origins allowed to call the API (scheme + host + port, no path). Default: local development plus the production frontend; CORS_ORIGINS replaces the whole list.
    cors_origins: Annotated[list[str], NoDecode] = Field(default_factory=lambda: ["http://localhost:5173", "http://localhost:5178", "https://z-business-crm.vercel.app"])

    # database (Supabase PostgreSQL through SQLAlchemy + psycopg 3)
    database_url: str = ""
    db_pool_size: int = 5
    db_max_overflow: int = 5
    db_pool_timeout_seconds: int = 30
    db_echo: bool = False

    # supabase api (Storage and other Supabase-only services)
    supabase_url: str = ""
    supabase_anon_key: str = ""
    supabase_service_role_key: str = ""
    supabase_storage_bucket: str = "crm-documents"
    # where uploaded file bytes live: "auto" = Supabase Storage when configured (otherwise the database), or force one of them
    storage_backend: Literal["auto", "supabase", "database"] = "auto"

    # authentication
    jwt_secret_key: str = ""
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 60
    max_failed_logins: int = 5
    lockout_minutes: int = 15
    password_reset_minutes: int = 30
    session_days: int = 14  # a signed-in session lives this long at most, unless revoked; access tokens are renewed through it
    idle_timeout_minutes: int = 30  # a session whose person has done nothing for this long is ended (5-480); the Super Admin can change it in Settings -> Security

    # background work, organisation clock, uploads
    scheduler_enabled: bool = True
    scheduler_interval_seconds: int = 120
    org_timezone: str = "Asia/Kolkata"
    max_upload_mb: int = 10

    # first super admin (used by the seed script)
    superadmin_email: str = ""
    superadmin_name: str = "Super Admin"
    superadmin_password: str = ""

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_origins(cls, value):
        """CORS_ORIGINS is read as plain text: comma-separated origins (`https://a.app,https://b.app`) or a JSON array (`["https://a.app"]`). Each origin is cleaned up, because the
        browser's Origin header is compared as an exact string (`https://z-business-crm.vercel.app` - scheme included, no trailing slash, no path): a value pasted without its scheme
        would otherwise be accepted silently and then refuse every request. A bare host gets `https://` (`http://` for localhost / a bare IP address)."""
        if isinstance(value, str):
            text = value.strip()
            if text.startswith("["):
                try:
                    value = json.loads(text)
                except ValueError:
                    value = text.strip("[]").split(",")
            else:
                value = text.split(",")
        if not isinstance(value, (list, tuple)):
            return value
        out: list[str] = []
        for item in value:
            origin = str(item).strip().strip("\"'").strip().rstrip("/")
            if not origin or origin == "*":
                if origin == "*":
                    out.append(origin)
                continue
            if "://" not in origin:
                host = origin.split(":")[0].split("/")[0]
                local = host in ("localhost", "127.0.0.1") or host.replace(".", "").isdigit()
                origin = f"{'http' if local else 'https'}://{origin}"
            origin = origin.split("/", 3)[0] + "//" + origin.split("/", 3)[2] if origin.count("/") >= 3 else origin  # drop any path: an origin is scheme + host + port
            if origin not in out:
                out.append(origin)
        return out

    @property
    def sqlalchemy_url(self) -> str:
        """DATABASE_URL normalised for SQLAlchemy + psycopg 3."""
        return normalise_database_url(self.database_url)

    @property
    def supabase_configured(self) -> bool:
        return not looks_like_placeholder(self.supabase_url) and not looks_like_placeholder(self.supabase_service_role_key)

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"

    @property
    def is_test(self) -> bool:
        return self.app_env == "test"

    @property
    def database_configured(self) -> bool:
        return not looks_like_placeholder(self.database_url)

    @property
    def jwt_configured(self) -> bool:
        return not looks_like_placeholder(self.jwt_secret_key) and len(self.jwt_secret_key) >= 32

    def configuration_problems(self) -> dict[str, str]:
        """Why each unusable setting is unusable (never the value itself): the difference between 'not set' and 'set but rejected' is what an operator needs to see."""
        problems: dict[str, str] = {}

        def why(value: str | None) -> str:
            return "not set" if not value else "still a placeholder"

        if not self.database_configured:
            problems["DATABASE_URL"] = why(self.database_url)
        if not self.jwt_configured:
            problems["JWT_SECRET_KEY"] = "too short (needs at least 32 characters)" if self.jwt_secret_key and not looks_like_placeholder(self.jwt_secret_key) else why(self.jwt_secret_key)
        for name, value in (("SUPABASE_URL", self.supabase_url), ("SUPABASE_ANON_KEY", self.supabase_anon_key), ("SUPABASE_SERVICE_ROLE_KEY", self.supabase_service_role_key)):
            if looks_like_placeholder(value):
                problems[name] = why(value)
        return problems

    def missing_configuration(self) -> list[str]:
        """Names of the settings that still hold placeholders (reported by /health - never their values)."""
        missing = []
        if not self.database_configured:
            missing.append("DATABASE_URL")
        if looks_like_placeholder(self.supabase_url):
            missing.append("SUPABASE_URL")
        if looks_like_placeholder(self.supabase_anon_key):
            missing.append("SUPABASE_ANON_KEY")
        if looks_like_placeholder(self.supabase_service_role_key):
            missing.append("SUPABASE_SERVICE_ROLE_KEY")
        if not self.jwt_configured:
            missing.append("JWT_SECRET_KEY")
        return missing


@lru_cache
def get_settings() -> Settings:
    return Settings()
