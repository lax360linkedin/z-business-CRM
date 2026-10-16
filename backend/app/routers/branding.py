"""Company branding (the logo). Reading is public - the sign-in page shows it before anybody has signed in; changing it is Super Admin only."""
from fastapi import APIRouter, Depends, File, Request, Response, UploadFile
from sqlalchemy.orm import Session

from app.api.deps import Principal, require_super_admin
from app.db.session import get_db
from app.services import branding

router = APIRouter(prefix="/branding", tags=["Branding"])


@router.get("", summary="The current logo's address and details (public)")
def get_branding(response: Response, db: Session = Depends(get_db)):
    response.headers["Cache-Control"] = "no-cache"
    return branding.public(db)


@router.get("/logo", summary="The uploaded logo file (public)")
def get_logo(request: Request, db: Session = Depends(get_db)):
    data, mime, sha = branding.logo(db)
    etag = f'"{sha[:32]}"'
    # the address carries ?v=<hash of the file>, so a given address never changes meaning and may be kept for a year; without it, always ask again (cheap: a 304)
    cache = "public, max-age=31536000, immutable" if request.query_params.get("v") else "no-cache"
    headers = {"ETag": etag, "Cache-Control": cache, "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox",
               "Cross-Origin-Resource-Policy": "cross-origin"}
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers=headers)
    return Response(content=data, media_type=mime, headers=headers)


@router.put("/logo", summary="Upload or replace the company logo (Super Admin; multipart file; PNG, JPG or SVG up to 1 MB)")
def put_logo(file: UploadFile = File(...), p: Principal = Depends(require_super_admin), db: Session = Depends(get_db)):
    data = file.file.read(branding.MAX_LOGO_BYTES + 1)  # one byte over the limit is enough to say "too large" without buffering the whole upload
    return branding.set_logo(db, p, data, file.filename or "", file.content_type)


@router.delete("/logo", summary="Remove the custom logo - the default one is shown again (Super Admin)")
def delete_logo(p: Principal = Depends(require_super_admin), db: Session = Depends(get_db)):
    return branding.remove_logo(db, p)
