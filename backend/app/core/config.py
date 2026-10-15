"""Application settings, loaded from environment variables / the local `.env` file (never from source code)."""
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
    cors_origins: Annotated[list[str], NoDecode] = Field(default_factory=lambda: ["http://localhost:5173"])

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
        if isinstance(value, str):
            return [item.strip() for item in value.split(",") if item.strip()]
        return value

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
