import json
from typing import Any
from urllib.parse import quote

from fastapi import APIRouter, Body, Depends, File, Form, Request, Response, UploadFile
from sqlalchemy.orm import Session

from app.api.deps import Principal, current_principal
from app.core.errors import invalid
from app.db.session import get_db
from app.services import documents as svc

router = APIRouter(prefix="/documents", tags=["Documents"])
HARD_LIMIT = 50 * 1024 * 1024  # the largest file size the settings may ever allow


def _meta(raw: str) -> dict:
    try:
        value = json.loads(raw or "{}")
    except ValueError:
        raise invalid("The upload details are not valid JSON.") from None
    return value if isinstance(value, dict) else {}


def _read(file: UploadFile, db: Session) -> bytes:
    limit = min(int(float(svc.get_config(db)["maxSizeMb"]) * 1024 * 1024), HARD_LIMIT)
    return file.file.read(limit + 1)  # one byte over the limit is enough for validation to say "too large" without buffering the whole upload


# ---- static sub-resources first (they must not be read as document ids) ----------------------------------------------------
@router.get("/config", summary="Document settings, your capabilities and the module permissions that apply")
def get_config(p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    return svc.config_payload(db, p)


@router.put("/config", summary="Change document settings (administrators)")
def put_config(payload: dict[str, Any] = Body(...), p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    return svc.put_config(db, p, payload)


@router.get("/me")
def me(p: Principal = Depends(current_principal)):
    return {"id": p.actor_id}


@router.get("/folders")
def folders(p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    return svc.list_folders(db)


@router.post("/folders", status_code=201)
def create_folder(payload: dict[str, Any] = Body(...), p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    return svc.create_folder(db, p, payload)


@router.put("/folders/{folder_id}")
def rename_folder(folder_id: str, payload: dict[str, Any] = Body(...), p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    return svc.rename_folder(db, p, folder_id, payload)


@router.delete("/folders/{folder_id}")
def delete_folder(folder_id: str, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    return svc.delete_folder(db, p, folder_id)


# ---- documents ------------------------------------------------------------------------------------------------------------
@router.get("", summary="Documents the caller may open (trash=true lists the bin)")
def list_(request: Request, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    return svc.list_documents(db, p, dict(request.query_params))


@router.post("", status_code=201, summary="Upload a file (multipart: file + meta JSON)")
def upload(file: UploadFile = File(...), meta: str = Form("{}"), fileName: str | None = Form(None), p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    data = _read(file, db)
    return svc.upload(db, p, data=data, file_name=fileName or file.filename or "", content_type=file.content_type, meta=_meta(meta))


@router.get("/{doc_id}")
def get_(doc_id: str, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    return svc.get_document(db, p, doc_id)


@router.put("/{doc_id}")
def update(doc_id: str, payload: dict[str, Any] = Body(...), p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    return svc.update_document(db, p, doc_id, payload)


@router.get("/{doc_id}/audit")
def audit_trail(doc_id: str, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    return svc.audit_trail(db, p, doc_id)


@router.get("/{doc_id}/file", summary="The only way bytes leave storage (mode=preview|download)")
def file(doc_id: str, mode: str = "preview", version: int | None = None, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    data, mime, name, n = svc.file_bytes(db, p, doc_id, mode, version)
    disposition = "attachment" if mode == "download" else "inline"
    return Response(content=data, media_type=mime, headers={"Content-Disposition": f"{disposition}; filename*=UTF-8''{quote(name)}", "X-File-Name": quote(name), "X-File-Version": str(n),
                                                          "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store", "Content-Security-Policy": "default-src 'none'; sandbox"})


@router.post("/{doc_id}/versions", summary="Add a new version (multipart: file + meta JSON)")
def add_version(doc_id: str, file: UploadFile = File(...), meta: str = Form("{}"), fileName: str | None = Form(None), p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    data = _read(file, db)
    return svc.add_version(db, p, doc_id, data=data, file_name=fileName or file.filename or "", content_type=file.content_type, meta=_meta(meta))


@router.post("/{doc_id}/versions/{version}/restore")
def restore_version(doc_id: str, version: int, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    return svc.restore_version(db, p, doc_id, version)


@router.post("/{doc_id}/share")
def share(doc_id: str, payload: dict[str, Any] = Body(...), p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    return svc.share(db, p, doc_id, payload)


@router.delete("/{doc_id}/share/{share_id}")
def revoke_share(doc_id: str, share_id: str, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    return svc.revoke_share(db, p, doc_id, share_id)


@router.post("/{doc_id}/delete", summary="Move to the bin")
def soft_delete(doc_id: str, payload: dict[str, Any] = Body(default={}), p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    return svc.soft_delete(db, p, doc_id, payload)


@router.post("/{doc_id}/restore", summary="Recover from the bin")
def restore(doc_id: str, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    return svc.restore(db, p, doc_id)


@router.delete("/{doc_id}", summary="Permanently delete a binned document (administrators)")
def purge(doc_id: str, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    return svc.purge(db, p, doc_id)
