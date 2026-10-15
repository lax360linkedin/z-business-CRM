"""Where uploaded bytes live. Metadata is always in PostgreSQL; the bytes go to a private Supabase Storage bucket (the supabase client is used for Storage only) or, when Storage is
not configured / not wanted, into the `stored_files` table. A version row points at exactly one of the two. Object names are generated here - never taken from the client."""
import hashlib
import logging
import uuid
from functools import lru_cache

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import ApiError
from app.models import DocumentVersion, StoredFile

log = logging.getLogger("app.storage")


def backend_name() -> str:
    s = get_settings()
    if s.storage_backend == "supabase":
        return "supabase"
    if s.storage_backend == "database":
        return "database"
    return "supabase" if (s.supabase_configured and not s.is_test) else "database"


@lru_cache
def _bucket():
    """The private bucket (created on first use). Raises ApiError when Storage cannot be reached."""
    from supabase import create_client  # imported lazily: tests and database-only deployments never load the client

    try:  # some corporate / antivirus-proxied networks (typical on Windows) re-sign TLS: trust the operating system's certificate store as browsers do
        import truststore

        truststore.inject_into_ssl()
    except ImportError:
        pass

    s = get_settings()
    client = create_client(s.supabase_url, s.supabase_service_role_key)
    try:
        names = {b.name for b in client.storage.list_buckets()}
        if s.supabase_storage_bucket not in names:
            client.storage.create_bucket(s.supabase_storage_bucket, options={"public": False})
    except Exception as exc:  # noqa: BLE001
        log.warning("storage bucket check failed: %s", type(exc).__name__)
        raise ApiError(503, "Secure file storage is unavailable - the file was not saved.", "STORAGE_UNAVAILABLE") from exc
    return client.storage.from_(s.supabase_storage_bucket)


def reset() -> None:
    _bucket.cache_clear()


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def put(db: Session, *, document_id: str, name: str, mime: str, data: bytes, ext: str) -> dict:
    """Stores the bytes; returns the pointer columns for the DocumentVersion (`stored_file_id` or `storage_path`)."""
    if backend_name() == "supabase":
        path = f"documents/{document_id}/{uuid.uuid4().hex}.{ext or 'bin'}"
        try:
            _bucket().upload(path, data, {"content-type": mime, "upsert": "false"})
        except ApiError:
            raise
        except Exception as exc:  # noqa: BLE001
            log.warning("storage upload failed: %s", type(exc).__name__)
            raise ApiError(503, "Secure file storage is unavailable - the file was not saved.", "STORAGE_UNAVAILABLE") from exc
        return {"storage_path": path, "stored_file_id": None}
    sid = f"SF-{uuid.uuid4().hex[:24]}"
    db.add(StoredFile(id=sid, name=name[:255], mime=mime, size_bytes=len(data), sha256=sha256(data), data=data))
    db.flush()
    return {"storage_path": None, "stored_file_id": sid}


def get(db: Session, version: DocumentVersion) -> bytes | None:
    if version.stored_file_id:
        row = db.get(StoredFile, version.stored_file_id)
        return bytes(row.data) if row else None
    if version.storage_path:
        try:
            return bytes(_bucket().download(version.storage_path))
        except ApiError:
            raise
        except Exception as exc:  # noqa: BLE001
            log.warning("storage download failed: %s", type(exc).__name__)
            return None
    return None


def remove(db: Session, versions: list[DocumentVersion]) -> None:
    """Deletes the bytes behind these versions unless another (kept) version still points at the same object."""
    ids = {v.id for v in versions}
    for stored_id in {v.stored_file_id for v in versions if v.stored_file_id}:
        if db.execute(select(func.count()).select_from(DocumentVersion).where(DocumentVersion.stored_file_id == stored_id, DocumentVersion.id.notin_(ids))).scalar_one() == 0:
            row = db.get(StoredFile, stored_id)
            if row is not None:
                db.delete(row)
    paths = {v.storage_path for v in versions if v.storage_path}
    keep = [p for p in paths if db.execute(select(func.count()).select_from(DocumentVersion).where(DocumentVersion.storage_path == p, DocumentVersion.id.notin_(ids))).scalar_one() == 0]
    if keep:
        try:
            _bucket().remove(keep)
        except Exception as exc:  # noqa: BLE001  - an orphaned object is harmless; the metadata is what matters
            log.warning("storage delete failed: %s", type(exc).__name__)
