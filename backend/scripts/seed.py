"""Seed the reference data (branches, departments, lead sources, expense categories) and the first Super Admin from backend/.env (SUPERADMIN_*).

    python -m scripts.seed                           # the password in .env must meet the policy
    python -m scripts.seed --allow-weak-bootstrap     # start with a .env password that does not, and force a compliant one at first sign-in

Idempotent. Never prints the password. No demo business data is created.
"""
import sys

from app.core.config import get_settings, looks_like_placeholder
from app.core.errors import ApiError
from app.db.session import get_session_factory
from app.services.seed import seed_reference_data, seed_super_admin


def main(argv: list[str]) -> int:
    weak = "--allow-weak-bootstrap" in argv
    settings = get_settings()
    if not settings.database_configured:
        print("DATABASE_URL is not configured.")
        return 2
    if "@" not in settings.superadmin_email or looks_like_placeholder(settings.superadmin_email) or looks_like_placeholder(settings.superadmin_password):
        print("Set SUPERADMIN_EMAIL, SUPERADMIN_NAME and SUPERADMIN_PASSWORD in backend/.env first (they still hold placeholders).")
        return 2
    with get_session_factory()() as db:
        created = seed_reference_data(db)
        db.commit()
    print("reference data created:", created)
    with get_session_factory()() as db:
        try:
            admin = seed_super_admin(db, email=settings.superadmin_email, name=settings.superadmin_name, password=settings.superadmin_password, allow_weak_bootstrap=weak)
            db.commit()
        except ApiError as exc:  # most likely the password policy: say so, never echo the value
            db.rollback()
            print(f"super admin NOT created: {exc.message} Change SUPERADMIN_PASSWORD in backend/.env and run this again (or use --allow-weak-bootstrap to start with it and force a change at first sign-in).")
            return 3
    print("super admin:", f"created ({admin.email})" + (" - must change the password at first sign-in" if admin.force_password_change else "") if admin else "already exists - left untouched")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
