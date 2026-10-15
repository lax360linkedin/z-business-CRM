"""Keeps `core.config_cache` honest: whenever a session writes `app_settings` or `branches`, the cache is bypassed for the rest of that transaction and cleared when it commits."""
from sqlalchemy import event
from sqlalchemy.orm import Session

from app.core import config_cache
from app.models.identity import Branch
from app.models.system import AppSetting

WATCHED = (AppSetting, Branch)


@event.listens_for(Session, "after_flush")
def _note_config_write(session: Session, _ctx) -> None:
    if any(isinstance(o, WATCHED) for o in (*session.new, *session.dirty, *session.deleted)):
        session.info["cfg_dirty"] = True


@event.listens_for(Session, "after_commit")
def _clear_after_commit(session: Session) -> None:
    if session.info.pop("cfg_dirty", False):
        config_cache.clear()


@event.listens_for(Session, "after_rollback")
def _forget_on_rollback(session: Session) -> None:
    session.info.pop("cfg_dirty", None)


def cached(db: Session, key: str, loader):
    """The cached value, or a fresh read when this transaction has itself changed configuration (it must see its own writes)."""
    if db.info.get("cfg_dirty"):
        return loader()
    return config_cache.get(key, loader)
