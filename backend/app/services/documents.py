"""Documents: the central file repository. Metadata, versions, shares, folders and an append-only audit trail live in PostgreSQL; the bytes live in private Storage (storage.py).

Every rule the React mock used to apply in the browser is applied here, per request: what the caller's role may do with documents, who may see a given document (owner, explicit
share, visibility, and - for documents that belong to a CRM record - the caller's own right to that record), content validation of the real bytes, duplicate detection,
versioning, expiring shares, soft delete with retention, and an audit entry for every sensitive action (including refusals)."""
import re
import uuid
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import delete as sa_delete
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import Principal
from app.core.config import get_settings
from app.core.errors import ApiError, conflict, forbidden, invalid, not_found
from app.db import ids
from app.models import (Activity, AppSetting, Campaign, Company, Contact, Contract, Customer, Deal, Document, DocumentAudit, DocumentFolder, DocumentShare, DocumentVersion, Employee,
                        Enquiry, Expense, Invoice, Lead, Payment, Project, Proposal, Quotation, SalesOrder, Task, Ticket, User)
from app.services import document_rules as R
from app.services import expenses as expense_svc
from app.services import storage, tasks as task_svc, timeline
from app.services.modules import SPEC_BY_KEY

CONFIG_KEY = "document_config"
RANK = {"view": 1, "download": 2, "edit": 3}
MODELS = {"contracts": Contract, "projects": Project, "salesOrders": SalesOrder, "invoices": Invoice, "expenses": Expense, "payments": Payment, "quotations": Quotation, "proposals": Proposal,
          "deals": Deal, "leads": Lead, "enquiries": Enquiry, "tasks": Task, "tickets": Ticket, "activities": Activity, "contacts": Contact, "companies": Company, "customers": Customer, "employees": Employee,
          "campaigns": Campaign}
LABEL_ATTRS = ("number", "name", "title", "subject", "full_name")
ACTIVITY_TEXT = {"Uploaded": "uploaded", "New version": "added a new version of", "Replaced": "replaced", "Viewed": "viewed", "Downloaded": "downloaded", "Shared": "shared", "Renamed": "renamed",
                 "Moved": "moved", "Deleted": "deleted", "Restored": "restored", "Visibility changed": "changed the visibility of", "Archived": "archived", "Version restored": "restored an earlier version of",
                 "Review set": "set a review date on"}
ACTIVE_EMPLOYEE = ("Active", "Probation", "On Leave", "Remote")
_recent_views: dict[tuple, float] = {}


def now() -> datetime:
    return datetime.now(UTC)


def iso(dt: datetime | None) -> str | None:
    return dt.astimezone(UTC).isoformat().replace("+00:00", "Z") if dt else None


# ---- configuration -------------------------------------------------------------------------------------------------------
def get_config(db: Session) -> dict:
    row = db.get(AppSetting, CONFIG_KEY)
    stored = dict(row.value) if row else {}
    cats = stored.get("categories") if isinstance(stored.get("categories"), list) and stored.get("categories") else R.DEFAULT_CATEGORIES
    return {**R.DEFAULT_DOC_CONFIG, **stored, "categories": cats}


def active_category(cfg: dict, name: str) -> dict | None:
    return next((c for c in cfg["categories"] if c["name"] == name and c.get("active")), None)


# ---- request context ----------------------------------------------------------------------------------------------------
class RC:
    """Everything one request needs to decide access, with the lookups cached."""

    def __init__(self, db: Session, p: Principal):
        self.db, self.p = db, p
        self.role = "Super Admin" if p.is_super_admin else ("Admin" if p.level == "Admin" else p.user.job_role)
        self.caps = set(R.DOC_ROLE_CAPS.get(self.role, []))
        self.me = p.actor_id
        self.admin = self.role in R.ADMIN_DOC_ROLES
        self._rec: dict = {}
        self._ok: dict = {}
        self._dept: dict[str, str] | None = None
        self._names: dict[str, str] | None = None
        self._shares: dict[str, list[DocumentShare]] = {}

    def hp(self, module: str, action: str) -> bool:
        return self.p.can(module, action)

    def _load_people(self) -> None:
        rows = self.db.execute(select(User.employee_id, User.department, User.name)).all()
        self._dept = {r[0]: r[1] for r in rows}
        self._names = {r[0]: r[2] for r in rows}
        for eid, nm in self.db.execute(select(Employee.id, Employee.full_name)).all():
            self._names.setdefault(eid, nm)

    def dept_of(self, employee_id: str | None) -> str | None:
        if self._dept is None:
            self._load_people()
        return self._dept.get(employee_id) if employee_id else None

    def name_of(self, employee_id: str | None) -> str | None:
        if self._names is None:
            self._load_people()
        return self._names.get(employee_id) if employee_id else None

    def find(self, collection: str, record_id: str | None):
        if not record_id or collection not in MODELS:
            return None
        key = (collection, record_id)
        if key not in self._rec:
            model = MODELS[collection]
            self._rec[key] = self.db.execute(select(model).where(model.id == record_id)).scalar_one_or_none()
        return self._rec[key]

    def record_ok(self, rtype: str, record_id: str) -> bool:
        """May the caller open the CRM record this document belongs to? (a deleted record leaves the document reachable through its own rules)"""
        key = (rtype, record_id)
        if key in self._ok:
            return self._ok[key]
        entry = R.LINK_BY_TYPE.get(rtype)
        ok = False
        if entry:
            collection = entry[1]
            rec = self.find(collection, record_id)
            if rec is None:
                ok = True
            elif collection == "tasks":
                actor = task_svc.actor_of(self.p)
                ok = task_svc.can_view(actor, task_svc.perms_of(self.db, actor), rec)
            elif collection == "expenses":
                ok = expense_svc.visible(self.db, self.p, rec)
            elif collection == "employees":
                ok = record_id == self.me or (self.hp("Employees", "view") and (self.admin or self.p.user.job_role == "HR"))
            elif collection in SPEC_BY_KEY:
                spec = SPEC_BY_KEY[collection]
                if self.hp(spec.label, "view"):
                    stmt = select(spec.model.id).where(spec.model.id == record_id)
                    extra = spec.row_filter(self.p) if spec.row_filter else None
                    if extra is not None:
                        stmt = stmt.where(extra)
                    ok = self.db.execute(stmt).first() is not None
        self._ok[key] = ok
        return ok

    def shares_of(self, doc_id: str) -> list[DocumentShare]:
        if doc_id not in self._shares:
            self._shares[doc_id] = list(self.db.execute(select(DocumentShare).where(DocumentShare.document_id == doc_id).order_by(DocumentShare.created_at)).scalars())
        return self._shares[doc_id]

    def preload_shares(self, doc_ids: list[str]) -> None:
        if not doc_ids:
            return
        grouped: dict[str, list] = {i: [] for i in doc_ids}
        for s in self.db.execute(select(DocumentShare).where(DocumentShare.document_id.in_(doc_ids)).order_by(DocumentShare.created_at)).scalars():
            grouped[s.document_id].append(s)
        self._shares.update(grouped)


def share_valid(s: DocumentShare) -> bool:
    return s.revoked_at is None and (s.expires_at is None or s.expires_at > now())


def primary_of(d: Document) -> dict | None:
    if d.primary_type and d.primary_id:
        return {"type": d.primary_type, "id": d.primary_id}
    for key, _, rtype in R.LINK_DEFS:
        if getattr(d, R.snake(key), None):
            return {"type": rtype, "id": getattr(d, R.snake(key))}
    return None


def evaluate(rc: RC, d: Document) -> dict:
    caps = rc.caps
    owner = rc.me in (d.owner_id, d.uploaded_by)
    mine = [s for s in rc.shares_of(d.id) if share_valid(s) and ((s.target_type == "user" and s.target_id == rc.me) or (s.target_type == "team" and s.target_id == rc.p.user.department))]
    share = max(mine, key=lambda s: RANK[s.access]) if mine else None
    prim = primary_of(d)
    rec_ok = rc.record_ok(prim["type"], prim["id"]) if prim else True
    see = False
    if rc.admin or owner or share:
        see = True
    elif "view" in caps:
        module_ok = rc.hp("Documents", "view") or (prim is not None and rec_ok)
        same_dept = rc.dept_of(d.owner_id) == rc.p.user.department
        vis = d.visibility
        if vis == "Assigned User":
            by_vis = d.assigned_to == rc.me or "viewAll" in caps
        elif vis == "Team":
            by_vis = ("viewTeam" in caps and same_dept) or "viewAll" in caps
        elif vis == "Department":
            by_vis = ("viewDepartment" in caps and same_dept) or "viewAll" in caps
        elif vis in ("Related CRM Users", "Organization"):
            by_vis = True
        elif vis == "Confidential":
            by_vis = "viewConfidential" in caps
        else:  # Private (and anything unknown) is for the owner, shares and administrators only
            by_vis = False
        see = module_ok and rec_ok and by_vis
    live = d.status != "Deleted"
    base = see and live
    mgr = rc.admin or owner or (share is not None and share.access == "edit") or (rc.hp("Documents", "edit") and see)
    writable = base and d.status == "Active" and not d.managed_by
    conf_ok = d.visibility != "Confidential" or owner or rc.admin
    return {
        "view": see and (live or rc.admin or "delete" in caps),
        "preview": base and "preview" in caps,
        "download": base and "download" in caps and (share is None or rc.admin or owner or RANK[share.access] >= RANK["download"]),
        "editDetails": base and "editDetails" in caps and mgr and conf_ok,
        "replace": writable and "replace" in caps and mgr and conf_ok,
        "manageVersions": writable and "manageVersions" in caps and mgr and conf_ok,
        "share": base and "share" in caps and (rc.admin or owner or rc.hp("Documents", "edit")) and conf_ok,
        "delete": see and live and "delete" in caps and (rc.admin or owner or rc.hp("Documents", "delete")) and conf_ok and not d.managed_by,
        "restore": see and not live and "delete" in caps and (rc.admin or owner or rc.hp("Documents", "delete")),
        "purge": see and not live and rc.admin,
        "createTask": base and rc.hp("Tasks", "create"),
        "viewAudit": see and (rc.admin or owner or "viewAll" in caps),
        "viewShares": see and (rc.admin or owner or mgr),
        "owner": owner, "admin": rc.admin, "shareLevel": share.access if share else None,
    }


# ---- audit, timeline, notifications -------------------------------------------------------------------------------------
def audit(rc: RC | None, doc: Document | None, action: str, *, version: int | None = None, result: str = "Success", details: str = "", actor_name: str | None = None, actor_role: str | None = None,
          db: Session | None = None) -> None:
    prim = primary_of(doc) if doc else None
    session = db or rc.db
    session.add(DocumentAudit(document_id=doc.id if doc else None, user_id=rc.me if rc else None, user_name=(actor_name or (rc.p.name if rc else "System"))[:160], role=(actor_role or (rc.role if rc else ""))[:40],
                              action=action[:80], version=version if version is not None else (doc.version if doc else None), result=result, details=details[:2000],
                              related_type=prim["type"] if prim else None, related_id=prim["id"] if prim else None))


def refuse(rc: RC, doc: Document | None, action: str, why: str, *, hide: bool = False):
    """Records the refusal (committed, because the request is about to fail) and raises."""
    if doc is not None:
        audit(rc, doc, action, result="Denied", details="No access" if hide else why)
        rc.db.commit()
    if hide or doc is None:
        raise not_found("Document not found.")
    raise forbidden(why)


def log_activity(rc: RC, d: Document, action: str, *, version: int | None = None, extra: str = "") -> None:
    prim = primary_of(d)
    if not prim:
        return
    collection = R.LINK_BY_TYPE[prim["type"]][1]
    rec = rc.find(collection, prim["id"])
    label = next((str(getattr(rec, a)) for a in LABEL_ATTRS if rec is not None and getattr(rec, a, None)), prim["id"])
    secret = d.visibility in ("Private", "Confidential")
    what = "a confidential document" if secret else f"“{d.name}”"
    links = {k: getattr(d, R.snake(k)) for k in R.LINK_KEYS if getattr(d, R.snake(k), None)}
    subject = f"{rc.p.name} {ACTIVITY_TEXT.get(action, action.lower())} {what}{f' (v{version})' if version else ''}{f' {extra}' if extra else ''}"
    timeline.log_activity(rc.db, related_type=prim["type"], related_id=prim["id"], related_name=label, type="Attachment", subject=subject, by=rc.me, branch=d.branch,
                          extra={"attachmentAction": action, "attachmentName": None if secret else d.name, "attachmentVersion": version or d.version, "documentId": d.id, "links": links})


def log_view_once(rc: RC, d: Document, version: int) -> None:
    key = (rc.me, d.id, version)
    t = now().timestamp()
    if t - _recent_views.get(key, 0) < 300:
        return
    _recent_views[key] = t
    log_activity(rc, d, "Viewed", version=version)


def notify(rc: RC, user_ids: list[str | None], d: Document, message: str) -> None:
    wanted = {u for u in user_ids if u and u != rc.me}
    if not wanted:
        return
    live = set(rc.db.execute(select(User.employee_id).where(User.employee_id.in_(wanted), User.status == "Active")).scalars())
    for uid in live:
        timeline.notify(rc.db, user_id=uid, message=message, type="Document Update", icon="file", related_type="Document", related_id=d.id, branch=d.branch)


# ---- presentation -------------------------------------------------------------------------------------------------------
def versions_of(db: Session, doc_id: str) -> list[DocumentVersion]:
    return list(db.execute(select(DocumentVersion).where(DocumentVersion.document_id == doc_id).order_by(DocumentVersion.version)).scalars())


def public_version(rc: RC, v: DocumentVersion) -> dict:
    return {"version": v.version, "fileName": v.file_name, "size": v.size_bytes, "mime": v.mime, "by": v.uploaded_by, "byName": rc.name_of(v.uploaded_by), "at": iso(v.created_at), "note": v.note,
            "active": v.active, "previousVersion": v.previous_version, "source": v.source or "upload", "placeholder": False, "restoredFrom": v.restored_from}


def _label(rec) -> str | None:
    return next((str(getattr(rec, a)) for a in LABEL_ATTRS if rec is not None and getattr(rec, a, None)), None)


def related_of(rc: RC, d: Document) -> list[dict]:
    out = []
    for key, collection, rtype in R.LINK_DEFS:
        rid = getattr(d, R.snake(key), None)
        if not rid:
            continue
        if rc.record_ok(rtype, rid):
            out.append({"type": rtype, "key": key, "id": rid, "label": _label(rc.find(collection, rid)) or rid, "href": R.HREFS[rtype].format(rid)})
        else:
            out.append({"type": rtype, "key": key, "restricted": True})
    return out


def public(rc: RC, d: Document, versions: list[DocumentVersion], acc: dict) -> dict:
    attrs = d.attributes or {}
    related = related_of(rc, d)
    shares = rc.shares_of(d.id)
    out = {
        "id": d.id, "name": d.name, "fileName": d.file_name, "fileType": d.file_type, "mime": d.mime, "sizeBytes": d.size_bytes, "sizeKb": max(1, round(d.size_bytes / 1024)) if d.size_bytes else 0,
        "category": d.category, "subCategory": d.sub_category, "branch": d.branch,
        **{k: getattr(d, R.snake(k)) for k in R.LINK_KEYS}, "relatedCustomerId": d.related_customer_id, "relatedTo": d.related_to or None,
        "primary": primary_of(d) if (d.primary_type and d.primary_id) else None,
        "ownerId": d.owner_id, "uploadedBy": d.uploaded_by, "uploadedDate": iso(d.created_at), "updatedAt": iso(d.updated_at), "updatedBy": d.updated_by, "visibility": d.visibility,
        "assignedTo": d.assigned_to, "folderId": d.folder_id, "tags": attrs.get("tags", []), "description": d.description, "status": d.status, "reviewBy": d.review_by.isoformat() if d.review_by else None,
        "reviewNote": attrs.get("reviewNote", ""), "version": d.version, "kind": attrs.get("kind"), "managedBy": d.managed_by, "deletedAt": iso(d.deleted_at), "deletedBy": d.deleted_by,
        "deleteReason": attrs.get("deleteReason"), "purgeAfter": iso(d.purge_after), "versions": [public_version(rc, v) for v in versions], "access": acc, "related": related,
        "uploaderName": rc.name_of(d.uploaded_by), "updatedByName": rc.name_of(d.updated_by), "assignedToName": rc.name_of(d.assigned_to),
        "refs": {r["type"]: r["label"] for r in related if not r.get("restricted")}, "shareCount": sum(1 for s in shares if share_valid(s)), "hasFile": True,
    }
    if acc["viewShares"]:
        out["shares"] = [{"id": s.id, "type": s.target_type, "targetId": s.target_id, "access": s.access, "expiresAt": iso(s.expires_at), "by": s.shared_by, "at": iso(s.created_at), "note": s.note,
                          "revokedAt": iso(s.revoked_at), "targetName": rc.name_of(s.target_id) if s.target_type == "user" else s.target_id, "byName": rc.name_of(s.shared_by),
                          "expired": bool(s.expires_at and s.expires_at <= now()), "active": share_valid(s)} for s in shares]
    return out


def present(rc: RC, d: Document) -> dict:
    return public(rc, d, versions_of(rc.db, d.id), evaluate(rc, d))


# ---- lookups -------------------------------------------------------------------------------------------------------------
def load(rc: RC, doc_id: str, action: str) -> tuple[Document, dict]:
    d = rc.db.execute(select(Document).where(Document.id == doc_id)).scalar_one_or_none()
    if d is None:
        raise not_found("Document not found.")
    acc = evaluate(rc, d)
    if not acc["view"]:
        refuse(rc, d, action, "", hide=True)
    return d, acc


def mark(d: Document, rc: RC) -> None:
    d.updated_by = rc.me
    d.updated_at = now()


def set_attr(d: Document, **values) -> None:
    d.attributes = {**(d.attributes or {}), **values}


def list_documents(db: Session, p: Principal, params: dict) -> list[dict]:
    rc = RC(db, p)
    purge_expired(db)
    trash = str(params.get("trash", "")).lower() == "true"
    stmt = select(Document).where(Document.status == "Deleted" if trash else Document.status != "Deleted").order_by(Document.created_at.desc(), Document.id.desc()).limit(5000)
    if params.get("relatedType") and params.get("relatedId"):
        entry = R.LINK_BY_TYPE.get(params["relatedType"])
        if not entry:
            raise invalid("Unknown record type.")
        stmt = stmt.where(getattr(Document, R.snake(entry[0])) == params["relatedId"])
    docs = list(db.execute(stmt).scalars())
    rc.preload_shares([d.id for d in docs])
    visible = []
    for d in docs:
        acc = evaluate(rc, d)
        if acc["restore"] if trash else acc["view"]:
            visible.append((d, acc))
    by_doc: dict[str, list[DocumentVersion]] = {d.id: [] for d, _ in visible}
    if visible:
        for v in db.execute(select(DocumentVersion).where(DocumentVersion.document_id.in_(list(by_doc))).order_by(DocumentVersion.version)).scalars():
            by_doc[v.document_id].append(v)
    return [public(rc, d, by_doc[d.id], acc) for d, acc in visible]


def get_document(db: Session, p: Principal, doc_id: str) -> dict:
    rc = RC(db, p)
    d, _ = load(rc, doc_id, "Opened details")
    return present(rc, d)


def audit_trail(db: Session, p: Principal, doc_id: str) -> list[dict]:
    rc = RC(db, p)
    d, acc = load(rc, doc_id, "Opened audit")
    if not acc["viewAudit"]:
        refuse(rc, d, "Opened audit", "You do not have access to this document’s audit history.")
    rows = db.execute(select(DocumentAudit).where(DocumentAudit.document_id == d.id).order_by(DocumentAudit.at.desc(), DocumentAudit.id.desc())).scalars()
    return [{"id": f"AUD-{r.id}", "documentId": r.document_id, "at": iso(r.at), "by": r.user_id, "byName": r.user_name, "role": r.role, "action": r.action, "version": r.version, "result": r.result,
             "details": r.details, "relatedType": r.related_type, "relatedId": r.related_id} for r in rows]


def file_bytes(db: Session, p: Principal, doc_id: str, mode: str, version: int | None) -> tuple[bytes, str, str, int]:
    rc = RC(db, p)
    d, acc = load(rc, doc_id, "File request")
    mode = "download" if mode == "download" else "preview"
    action = "Downloaded" if mode == "download" else "Viewed"
    if not acc[mode]:
        refuse(rc, d, action, f"You do not have permission to {mode} this document.")
    n = version or d.version
    v = db.execute(select(DocumentVersion).where(DocumentVersion.document_id == d.id, DocumentVersion.version == n)).scalar_one_or_none()
    if v is None:
        raise not_found("That version does not exist.")
    data = storage.get(db, v)
    if data is None:
        audit(rc, d, action, version=n, result="Failed", details="File missing from storage")
        db.commit()
        raise ApiError(410, "The stored file is missing or unreadable.", "FILE_MISSING")
    audit(rc, d, action, version=n)
    if mode == "download":
        log_activity(rc, d, "Downloaded", version=n)
    else:
        log_view_once(rc, d, n)
    db.commit()
    return data, v.mime or d.mime, v.file_name, n


# ---- upload --------------------------------------------------------------------------------------------------------------
def _links_from(rc: RC, rtype: str, rid: str, record) -> dict:
    """The record the file is uploaded from plus every record that one points at (so the file also shows up on the customer, deal ...)."""
    links = {}
    for key, _, _ in R.LINK_DEFS:
        value = getattr(record, R.snake(key), None) if hasattr(record, R.snake(key)) else None
        if value:
            links[key] = value
    held = (getattr(record, "attributes", None) or {}).get("links")
    if isinstance(held, dict):
        for key, value in held.items():
            if key in R.LINK_KEYS and value:
                links.setdefault(key, value)
    links[R.LINK_BY_TYPE[rtype][0]] = rid
    return links


def upload_allowed(rc: RC, prim: dict | None) -> str:
    if "upload" not in rc.caps:
        return "Your role cannot upload documents."
    if not prim:
        return "" if rc.hp("Documents", "create") else "You do not have permission to add general documents."
    if rc.find(R.LINK_BY_TYPE[prim["type"]][1], prim["id"]) is None:
        return "The related record was not found."
    if not rc.record_ok(prim["type"], prim["id"]):
        return "You do not have access to that record."
    if prim["type"] in ("Contract", "Project") and not rc.hp("Documents", "create") and not rc.hp(prim["type"] + "s", "edit"):
        return f"You cannot attach documents to this {prim['type'].lower()}."
    return ""


def _read_checked(rc: RC, d_for_audit: Document | None, name, mime, data: bytes, cfg: dict, action: str):
    check = R.validate_file_content(name, mime, data, cfg)
    if not check.ok:
        audit(rc, d_for_audit, action, result="Rejected", details=f"{name or 'file'}: {check.errors[0]}")
        rc.db.commit()
        raise ApiError(422, check.errors[0], "FILE_REJECTED", None, {"errors": check.errors})
    return check


def _same_place(stmt, prim: dict | None):
    return stmt.where(Document.primary_type == prim["type"], Document.primary_id == prim["id"]) if prim else stmt.where(Document.primary_type.is_(None))


def _new_version(db: Session, d: Document, rc: RC, *, number: int, name: str, ext: str, mime: str, size: int, sha: str, note: str, source: str, previous: int | None,
                 data: bytes | None = None, pointers: dict | None = None, restored_from: int | None = None) -> DocumentVersion:
    """Adds a version row (and the new bytes through Storage, unless `pointers` reuses already-stored bytes) and makes it the active one."""
    pointers = pointers or storage.put(db, document_id=d.id, name=name, mime=mime, data=data or b"", ext=ext)
    db.query(DocumentVersion).filter(DocumentVersion.document_id == d.id).update({"active": False})
    v = DocumentVersion(id=ids.new_id(db, "DV", 5), document_id=d.id, version=number, file_name=name, size_bytes=size, mime=mime, sha256=sha, uploaded_by=rc.me, note=note[:300],
                        source=source[:30], active=True, previous_version=previous, restored_from=restored_from, **pointers)
    db.add(v)
    return v


def upload(db: Session, p: Principal, *, data: bytes, file_name: str, content_type: str | None, meta: dict) -> dict:
    rc = RC(db, p)
    cfg = get_config(db)
    prim = None
    links: dict = {}
    record = None
    if meta.get("relatedType") or meta.get("relatedId"):
        entry = R.LINK_BY_TYPE.get(meta.get("relatedType"))
        if not entry or not meta.get("relatedId"):
            raise invalid("Unknown related record.")
        record = rc.find(entry[1], meta["relatedId"])
        if record is None:
            raise not_found("The related record was not found.")
        prim = {"type": meta["relatedType"], "id": meta["relatedId"]}
        links = _links_from(rc, prim["type"], prim["id"], record)
    denied = upload_allowed(rc, prim)
    if denied:
        audit(rc, None, "Upload", result="Denied", details=denied)
        db.commit()
        raise forbidden(denied)
    cat = meta.get("category") or "Other"
    if not active_category(cfg, cat) and meta.get("categoryFallback") and active_category(cfg, meta["categoryFallback"]):
        cat = meta["categoryFallback"]  # a module that files its own documents names a fallback for when an admin switched its usual category off
    if not active_category(cfg, cat):
        raise invalid(f"“{cat}” is not an active document category.", {"category": "Choose an active category."})
    vis = meta.get("visibility") if meta.get("visibility") in R.VISIBILITIES else ("Organization" if (not prim and cfg["defaultVisibility"] == "Related CRM Users") else cfg["defaultVisibility"])
    assigned = meta.get("assignedTo") or None
    if assigned and db.get(Employee, assigned) is None:
        raise invalid("The assigned user does not exist.", {"assignedTo": "Choose an existing user."})
    folder = meta.get("folderId") or None
    if folder and db.get(DocumentFolder, folder) is None:
        raise invalid("That folder does not exist.", {"folderId": "Choose an existing folder."})
    check = _read_checked(rc, None, file_name, content_type, data, cfg, "Upload")
    sha = storage.sha256(data)
    same_hash = db.execute(_same_place(select(Document.id, Document.name).join(DocumentVersion, DocumentVersion.document_id == Document.id)
                                       .where(Document.status != "Deleted", DocumentVersion.sha256 == sha), prim)).first()
    if same_hash:
        raise ApiError(409, f"This exact file is already stored as “{same_hash[1]}” ({same_hash[0]}) here.", "DUPLICATE_FILE", None, {"existingId": same_hash[0]})
    same_name = db.execute(_same_place(select(Document.id).where(Document.status != "Deleted", func.lower(Document.file_name) == check.name.lower()), prim)).first()
    if same_name:
        raise ApiError(409, f"A document named “{check.name}” already exists here ({same_name[0]}). Add a new version to it instead of uploading a second copy.", "DUPLICATE_NAME", None, {"existingId": same_name[0]})
    customer = rc.find("customers", links.get("customerId"))
    tags = [str(t)[:30] for t in meta["tags"][:10]] if isinstance(meta.get("tags"), list) else []
    d = Document(id=ids.new_id(db, "DOC", 4), name=(str(meta.get("name") or "").strip()[:150] or check.name), file_name=check.name, file_type=check.ext, mime=check.mime, size_bytes=len(data),
                 category=cat, sub_category=(meta.get("subCategory") or None), related_customer_id=links.get("customerId"), related_to=(customer.name if customer else ""), visibility=vis, status="Active",
                 version=1, description=str(meta.get("description") or "")[:500], owner_id=rc.me, uploaded_by=rc.me, uploaded_date=date.today(), updated_by=rc.me, assigned_to=assigned, folder_id=folder,
                 primary_type=prim["type"] if prim else None, primary_id=prim["id"] if prim else None, created_by=rc.me,
                 attributes={"tags": tags, "reviewNote": "", "kind": meta.get("kind") or None},
                 **{R.snake(k): v for k, v in links.items() if k in R.LINK_KEYS})
    if record is not None and getattr(record, "branch", None):
        d.branch = record.branch
    db.add(d)
    db.flush()
    _new_version(db, d, rc, number=1, name=check.name, ext=check.ext, mime=check.mime, size=len(data), data=data, sha=sha, note=str(meta.get("note") or "Initial upload"),
                 source=str(meta.get("source") or "upload"), previous=None)
    audit(rc, d, "Uploaded", version=1, details=f"{check.name} ({size_label(len(data))})")
    log_activity(rc, d, "Uploaded", version=1)
    db.commit()
    return present(rc, d)


def size_label(n: int) -> str:
    return f"{n / 1048576:.1f} MB" if n >= 1048576 else f"{round(n / 1024)} KB" if n >= 1024 else f"{n} B"


# ---- edit details --------------------------------------------------------------------------------------------------------
def update_document(db: Session, p: Principal, doc_id: str, b: dict) -> dict:
    rc = RC(db, p)
    d, acc = load(rc, doc_id, "Edit")
    cfg = get_config(db)
    if not acc["editDetails"]:
        refuse(rc, d, "Edited details", "You cannot edit this document’s details.")
    changes: list[tuple[str, str, str]] = []
    touched: list[str] = []
    if "name" in b:
        n = str(b["name"] or "").strip()[:150]
        if not n:
            raise invalid("The name cannot be empty.", {"name": "Give the document a name."})
        if n != d.name:
            changes.append(("Renamed", d.name, n))
            d.name = n
        touched.append("name")
    if "category" in b and b["category"] != d.category:
        if not active_category(cfg, b["category"]):
            raise invalid(f"“{b['category']}” is not an active category.", {"category": "Choose an active category."})
        changes.append(("Moved", d.category, b["category"]))
        d.category = b["category"]
    if "folderId" in b and (b["folderId"] or None) != d.folder_id:
        if b["folderId"] and db.get(DocumentFolder, b["folderId"]) is None:
            raise invalid("That folder does not exist.", {"folderId": "Choose an existing folder."})
        changes.append(("Moved", d.folder_id or "No folder", b["folderId"] or "No folder"))
        d.folder_id = b["folderId"] or None
    if "visibility" in b and b["visibility"] != d.visibility:
        if b["visibility"] not in R.VISIBILITIES:
            raise invalid("Unknown visibility.", {"visibility": "Choose a visibility."})
        if "Confidential" in (b["visibility"], d.visibility) and not (acc["owner"] or acc["admin"]):
            refuse(rc, d, "Visibility changed", "Only the owner or an administrator can change confidentiality.")
        changes.append(("Visibility changed", d.visibility, b["visibility"]))
        d.visibility = b["visibility"]
    if "description" in b:
        d.description = str(b["description"] or "")[:500]
        touched.append("description")
    if isinstance(b.get("tags"), list):
        set_attr(d, tags=[str(t)[:30] for t in b["tags"]][:10])
        touched.append("tags")
    previous_assignee = d.assigned_to
    if "assignedTo" in b:
        if b["assignedTo"] and db.get(Employee, b["assignedTo"]) is None:
            raise invalid("The assigned user does not exist.", {"assignedTo": "Choose an existing user."})
        d.assigned_to = b["assignedTo"] or None
        touched.append("assignedTo")
    if "reviewBy" in b:
        if b["reviewBy"] and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(b["reviewBy"])):
            raise invalid("Use a valid date.", {"reviewBy": "Use a valid date."})
        old = d.review_by.isoformat() if d.review_by else "—"
        d.review_by = date.fromisoformat(b["reviewBy"]) if b["reviewBy"] else None
        set_attr(d, reviewNote=str(b.get("reviewNote", (d.attributes or {}).get("reviewNote", "")) or "")[:200])
        changes.append(("Review set", old, b["reviewBy"] or "cleared"))
    if "status" in b and b["status"] != d.status:
        if b["status"] not in ("Active", "Archived") or d.status == "Deleted":
            raise invalid("Use delete / restore for that status change.", {"status": "Not allowed."})
        changes.append(("Archived" if b["status"] == "Archived" else "Restored", d.status, b["status"]))
        d.status = b["status"]
    mark(d, rc)
    for action, old, new in changes:
        audit(rc, d, action, details=f"{old} → {new}")
        if action != "Review set":
            log_activity(rc, d, action, extra=f"to “{new}”" if action == "Renamed" else f"to {new}" if action == "Moved" else "")
    if not changes and touched:
        audit(rc, d, "Edited details", details=", ".join(touched))
    if d.assigned_to and d.assigned_to != previous_assignee:
        notify(rc, [d.assigned_to], d, f"{rc.p.name} assigned you the document “{d.name}”.")
    db.commit()
    return present(rc, d)


# ---- versions ------------------------------------------------------------------------------------------------------------
def add_version(db: Session, p: Principal, doc_id: str, *, data: bytes, file_name: str, content_type: str | None, meta: dict) -> dict:
    rc = RC(db, p)
    d, acc = load(rc, doc_id, "New version")
    if not acc["replace"]:
        refuse(rc, d, "New version", "Archived documents are read-only — restore it first." if d.status == "Archived" else "This file is managed from its own module." if d.managed_by else "You cannot replace this document.")
    cfg = get_config(db)
    note = str(meta.get("note") or "").strip()[:300]
    count = db.execute(select(func.count()).select_from(DocumentVersion).where(DocumentVersion.document_id == d.id)).scalar_one()
    if count >= cfg["maxVersions"]:
        raise invalid(f"This document already has {cfg['maxVersions']} versions.")
    if d.primary_type == "Contract":
        contract = rc.find("contracts", d.primary_id)
        if contract is not None and contract.status in ("Signed", "Active", "Expiring Soon"):
            if len(note) < 5:
                raise invalid("Say why this signed contract document is being replaced (at least 5 characters).", {"note": "Give a reason."})
            if not meta.get("acknowledged"):
                raise invalid("Confirm that you are replacing a document on a signed or active contract.", {"acknowledged": "Confirm to continue."})
    check = _read_checked(rc, d, file_name, content_type, data, cfg, "New version")
    sha = storage.sha256(data)
    if db.execute(select(DocumentVersion.id).where(DocumentVersion.document_id == d.id, DocumentVersion.sha256 == sha)).first():
        raise conflict("This exact file is already one of this document’s versions.")
    n = d.version + 1
    _new_version(db, d, rc, number=n, name=check.name, ext=check.ext, mime=check.mime, size=len(data), data=data, sha=sha, note=note or f"Version {n}", source="upload", previous=d.version)
    d.version, d.file_name, d.file_type, d.mime, d.size_bytes = n, check.name, check.ext, check.mime, len(data)
    mark(d, rc)
    audit(rc, d, "New version", version=n, details=f"{check.name}{f' — {note}' if note else ''}")
    log_activity(rc, d, "New version", version=n)
    if d.assigned_to:
        notify(rc, [d.assigned_to], d, f"{rc.p.name} added version {n} of “{d.name}”.")
    db.commit()
    return present(rc, d)


def restore_version(db: Session, p: Principal, doc_id: str, version: int) -> dict:
    rc = RC(db, p)
    d, acc = load(rc, doc_id, "Version restored")
    if not acc["manageVersions"]:
        refuse(rc, d, "Version restored", "You cannot manage versions of this document.")
    target = db.execute(select(DocumentVersion).where(DocumentVersion.document_id == d.id, DocumentVersion.version == version)).scalar_one_or_none()
    if target is None:
        raise not_found("That version does not exist.")
    if target.active:
        raise conflict("That is already the current version.")
    count = db.execute(select(func.count()).select_from(DocumentVersion).where(DocumentVersion.document_id == d.id)).scalar_one()
    if count >= get_config(db)["maxVersions"]:
        raise invalid("The version limit has been reached.")
    n = d.version + 1
    ext = R.ext_of(target.file_name)
    # the new version points at the SAME stored bytes; nothing is copied
    _new_version(db, d, rc, number=n, name=target.file_name, ext=ext, mime=target.mime, size=target.size_bytes, sha=target.sha256, note=f"Restored from version {target.version}",
                 source=target.source or "upload", previous=d.version, pointers={"stored_file_id": target.stored_file_id, "storage_path": target.storage_path}, restored_from=target.version)
    d.version, d.file_name, d.file_type, d.mime, d.size_bytes = n, target.file_name, ext, target.mime, target.size_bytes
    mark(d, rc)
    audit(rc, d, "Version restored", version=n, details=f"from v{target.version}")
    log_activity(rc, d, "Version restored", version=n, extra=f"(from v{target.version})")
    db.commit()
    return present(rc, d)


# ---- sharing -------------------------------------------------------------------------------------------------------------
def share(db: Session, p: Principal, doc_id: str, b: dict) -> dict:
    rc = RC(db, p)
    d, acc = load(rc, doc_id, "Shared")
    if not acc["share"]:
        refuse(rc, d, "Shared", "You cannot share this document.")
    cfg = get_config(db)
    targets = b.get("targets") if isinstance(b.get("targets"), list) else []
    if not targets:
        raise invalid("Choose who to share with.", {"targets": "Choose who to share with."})
    if b.get("access") not in RANK:
        raise invalid("Choose an access level.", {"access": "Choose an access level."})
    expires = None
    if b.get("expiresAt"):
        try:
            y, m, day = (int(x) for x in str(b["expiresAt"])[:10].split("-"))
            expires = datetime(y, m, day, 23, 59, 59, tzinfo=ZoneInfo(get_settings().org_timezone)).astimezone(UTC)
        except (ValueError, TypeError):
            raise invalid("The expiry must be a valid date.", {"expiresAt": "Use a valid date."}) from None
        if expires < now():
            raise invalid("The expiry must be a future date.", {"expiresAt": "Choose a future date."})
        if expires - now() > timedelta(days=cfg["shareMaxDays"]):
            raise invalid(f"Access can be shared for at most {cfg['shareMaxDays']} days.", {"expiresAt": "Too far ahead."})
    elif d.visibility == "Confidential":
        raise invalid("Sharing a confidential document needs an expiry date.", {"expiresAt": "Set an expiry."})
    departments = set(db.execute(select(User.department).where(User.status == "Active")).scalars())
    made: list[DocumentShare] = []
    for t in targets:
        kind, target = t.get("type"), t.get("targetId")
        if kind == "user":
            if db.execute(select(User.id).where(User.employee_id == target, User.status == "Active")).first() is None:
                raise invalid("One of the users does not exist or is inactive.", {"targets": "Unknown user."})
            if target == rc.me:
                continue
        elif kind == "team":
            if target not in departments:
                raise invalid("Unknown team.", {"targets": "Unknown team."})
        else:
            raise invalid("Unknown share target.", {"targets": "Unknown target."})
        if any(share_valid(s) and s.target_type == kind and s.target_id == target and s.access == b["access"] for s in rc.shares_of(d.id)) or any(m.target_type == kind and m.target_id == target for m in made):
            continue
        made.append(DocumentShare(id=ids.new_id(db, "SHR", 5), document_id=d.id, target_type=kind, target_id=target, access=b["access"], expires_at=expires, shared_by=rc.me, note=str(b.get("note") or "")[:200]))
    if not made:
        raise conflict("It is already shared that way.")
    db.add_all(made)
    rc._shares.pop(d.id, None)
    d.updated_at = now()
    secret = d.visibility in ("Private", "Confidential")
    for s in made:
        who = rc.name_of(s.target_id) if s.target_type == "user" else f"{s.target_id} team"
        audit(rc, d, "Shared", details=f"{who} — {s.access}{f' until {expires.date().isoformat()}' if expires else ''}")
        if s.target_type == "user":
            recipients = [s.target_id]
        else:
            recipients = list(db.execute(select(User.employee_id).where(User.department == s.target_id, User.status == "Active")).scalars())
        notify(rc, recipients, d, f"{rc.p.name} shared {'a confidential document' if secret else f'“{d.name}”'} with you.")
    log_activity(rc, d, "Shared")
    db.commit()
    return present(rc, d)


def revoke_share(db: Session, p: Principal, doc_id: str, share_id: str) -> dict:
    rc = RC(db, p)
    d, acc = load(rc, doc_id, "Share revoked")
    if not acc["share"]:
        refuse(rc, d, "Share revoked", "You cannot change sharing on this document.")
    s = next((x for x in rc.shares_of(d.id) if x.id == share_id), None)
    if s is None:
        raise not_found("That share does not exist.")
    s.revoked_at, s.revoked_by = now(), rc.me
    audit(rc, d, "Share revoked", details=rc.name_of(s.target_id) if s.target_type == "user" else f"{s.target_id} team")
    db.commit()
    return present(rc, d)


# ---- delete / restore / purge --------------------------------------------------------------------------------------------
def soft_delete(db: Session, p: Principal, doc_id: str, b: dict) -> dict:
    rc = RC(db, p)
    d, acc = load(rc, doc_id, "Deleted")
    if d.managed_by:
        raise conflict("This file is managed from its own module — remove it there.")
    if not acc["delete"]:
        refuse(rc, d, "Deleted", "You cannot delete this document.")
    cfg = get_config(db)
    reason = str(b.get("reason") or "")[:200]
    set_attr(d, deleteReason=reason, prevStatus=d.status)
    d.status, d.deleted_at, d.deleted_by = "Deleted", now(), rc.me
    d.purge_after = now() + timedelta(days=cfg["retentionDays"])
    d.updated_at = now()
    audit(rc, d, "Deleted", details=f"{reason or 'No reason given'} (recoverable for {cfg['retentionDays']} days)")
    log_activity(rc, d, "Deleted")
    db.commit()
    return present(rc, d)


def restore(db: Session, p: Principal, doc_id: str) -> dict:
    rc = RC(db, p)
    d, acc = load(rc, doc_id, "Restored")
    if d.status != "Deleted":
        raise conflict("This document is not in the bin.")
    if not acc["restore"]:
        refuse(rc, d, "Restored", "You cannot restore this document.")
    d.status = "Archived" if (d.attributes or {}).get("prevStatus") == "Archived" else "Active"
    d.deleted_at = d.deleted_by = d.purge_after = None
    set_attr(d, deleteReason=None, prevStatus=None)
    d.updated_at = now()
    audit(rc, d, "Restored", details="Recovered from the bin")
    log_activity(rc, d, "Restored")
    db.commit()
    return present(rc, d)


def _erase(db: Session, d: Document) -> int:
    versions = versions_of(db, d.id)
    storage.remove(db, versions)
    db.execute(sa_delete(DocumentVersion).where(DocumentVersion.document_id == d.id))
    db.delete(d)
    return len(versions)


def purge(db: Session, p: Principal, doc_id: str) -> dict:
    rc = RC(db, p)
    d, acc = load(rc, doc_id, "Permanently deleted")
    if d.status != "Deleted":
        raise conflict("Move the document to the bin first.")
    if not acc["purge"]:
        refuse(rc, d, "Permanently deleted", "Only an administrator can permanently delete a document.")
    audit(rc, d, "Permanently deleted", details=f"{len(versions_of(db, d.id))} version(s) removed from storage")
    _erase(db, d)
    db.commit()
    return {"success": True}


def purge_expired(db: Session) -> int:
    """Retention: bin entries older than the retention period are removed for good (also run by the scheduler)."""
    gone = list(db.execute(select(Document).where(Document.status == "Deleted", Document.purge_after.is_not(None), Document.purge_after < now())).scalars())
    for d in gone:
        audit(None, d, "Permanently deleted", details="Retention period elapsed", actor_name="Retention policy", actor_role="", db=db)
        _erase(db, d)
    if gone:
        db.commit()
    return len(gone)


# ---- folders -------------------------------------------------------------------------------------------------------------
def public_folder(f: DocumentFolder) -> dict:
    return {"id": f.id, "name": f.name, "createdBy": f.owner_id, "createdAt": iso(f.created_at)}


def list_folders(db: Session) -> list[dict]:
    return [public_folder(f) for f in db.execute(select(DocumentFolder).order_by(DocumentFolder.created_at, DocumentFolder.id)).scalars()]


def _folder_name(b: dict) -> str:
    name = str(b.get("name") or "").strip()[:60]
    if not name:
        raise invalid("Give the folder a name.", {"name": "Give the folder a name."})
    return name


def create_folder(db: Session, p: Principal, b: dict) -> dict:
    rc = RC(db, p)
    if "createFolders" not in rc.caps:
        raise forbidden("You cannot create folders.")
    name = _folder_name(b)
    if db.execute(select(DocumentFolder.id).where(func.lower(DocumentFolder.name) == name.lower())).first():
        raise conflict("A folder with that name already exists.", {"name": "Already exists."})
    f = DocumentFolder(id=ids.new_id(db, "FLD", 4), name=name, owner_id=rc.me, created_by=rc.me)
    db.add(f)
    db.commit()
    return public_folder(f)


def rename_folder(db: Session, p: Principal, folder_id: str, b: dict) -> dict:
    rc = RC(db, p)
    if "createFolders" not in rc.caps:
        raise forbidden("You cannot change folders.")
    name = _folder_name(b)
    f = db.get(DocumentFolder, folder_id)
    if f is None:
        raise not_found("Folder not found.")
    if db.execute(select(DocumentFolder.id).where(func.lower(DocumentFolder.name) == name.lower(), DocumentFolder.id != f.id)).first():
        raise conflict("A folder with that name already exists.", {"name": "Already exists."})
    f.name = name
    db.commit()
    return public_folder(f)


def delete_folder(db: Session, p: Principal, folder_id: str) -> dict:
    rc = RC(db, p)
    if "createFolders" not in rc.caps:
        raise forbidden("You cannot delete folders.")
    f = db.get(DocumentFolder, folder_id)
    if f is None:
        raise not_found("Folder not found.")
    if db.execute(select(Document.id).where(Document.folder_id == folder_id, Document.status != "Deleted")).first():
        raise conflict("Move the documents out of this folder first.")
    db.execute(sa_delete(DocumentFolder).where(DocumentFolder.id == folder_id))
    db.commit()
    return {"success": True}


# ---- configuration -------------------------------------------------------------------------------------------------------
def config_payload(db: Session, p: Principal) -> dict:
    rc = RC(db, p)
    cfg = get_config(db)
    cats = cfg["categories"] if "manageCategories" in rc.caps else [c for c in cfg["categories"] if c.get("active")]
    return {"config": {**cfg, "categories": cats}, "caps": sorted(rc.caps, key=R.DOC_PERMISSION_KEYS.index),
            "matrix": {a: rc.hp("Documents", a) for a in ("view", "create", "edit", "delete")}, "user": {"id": rc.me, "name": p.name, "role": rc.role, "department": p.user.department}}


def put_config(db: Session, p: Principal, b: dict) -> dict:
    rc = RC(db, p)
    if "manageCategories" not in rc.caps:
        audit(rc, None, "Settings changed", result="Denied", details="Not allowed to manage document settings")
        db.commit()
        raise forbidden("Only administrators can change document settings.")
    cur = get_config(db)
    nxt = dict(cur)
    if b.get("categories") is not None:
        raw = b["categories"] if isinstance(b["categories"], list) else []
        cats = [{"id": c.get("id") or f"CAT-{R.slug(c.get('name', ''))}-{uuid.uuid4().hex[:4]}", "name": str(c.get("name") or "").strip()[:40], "active": c.get("active") is not False, "system": bool(c.get("system"))} for c in raw]
        if any(not c["name"] for c in cats):
            raise invalid("Every category needs a name.", {"categories": "Every category needs a name."})
        if len({c["name"].lower() for c in cats}) != len(cats):
            raise invalid("Category names must be unique.", {"categories": "Names must be unique."})
        if not any(c["name"] == "Other" and c["active"] for c in cats):
            raise invalid("The “Other” category must stay active.", {"categories": "Keep “Other” active."})
        in_use = set(db.execute(select(Document.category).where(Document.status != "Deleted").distinct()).scalars())
        missing = [c for c in cur["categories"] if not any(x["id"] == c["id"] for x in cats) and c["name"] in in_use]
        if missing:
            raise conflict(f"Documents still use “{missing[0]['name']}” — deactivate it instead of deleting it.")
        nxt["categories"] = cats
    if b.get("allowedExtensions") is not None:
        ext = [e for e in b["allowedExtensions"] if e in R.ALL_EXTENSIONS]
        if not ext:
            raise invalid("Allow at least one file type.", {"allowedExtensions": "Allow at least one type."})
        nxt["allowedExtensions"] = ext

    def num(key: str, lo: int, hi: int) -> None:
        if b.get(key) is not None:
            try:
                x = round(float(b[key]))
            except (TypeError, ValueError):
                return
            if lo <= x <= hi:
                nxt[key] = x

    num("maxSizeMb", 1, 50)
    num("retentionDays", 1, 365)
    num("maxFilesPerUpload", 1, 25)
    num("shareMaxDays", 1, 365)
    num("reviewWarnDays", 1, 90)
    if b.get("defaultVisibility") is not None:
        if b["defaultVisibility"] not in R.VISIBILITIES or b["defaultVisibility"] == "Confidential":
            raise invalid("Choose a valid default visibility.", {"defaultVisibility": "Choose a valid visibility."})
        nxt["defaultVisibility"] = b["defaultVisibility"]
    row = db.get(AppSetting, CONFIG_KEY)
    if row is None:
        db.add(AppSetting(key=CONFIG_KEY, value=nxt, updated_by=rc.me))
    else:
        row.value, row.updated_by = nxt, rc.me
    audit(rc, None, "Settings changed", details=", ".join(b.keys()))
    db.commit()
    return nxt


# ---- files owned by another module (quotation attachments ...) ---------------------------------------------------------------
def sync_managed(db: Session, p: Principal, *, managed_by: str, primary_type: str, record, data: bytes, file_name: str, mime: str | None, category: str, note: str,
                 source: str, description: str = "", only: tuple | None = None) -> tuple[Document, int]:
    """Files a module's own attachment in the central repository. One document per record and module; a new file becomes a new version. Validation is the same as any upload.
    Returns (document, version)."""
    rc = RC(db, p)
    cfg = get_config(db)
    if only:
        cfg = {**cfg, "allowedExtensions": [e for e in cfg["allowedExtensions"] if e in only]}
    check = R.validate_file_content(file_name, mime, data, cfg)
    if not check.ok:
        raise ApiError(422, check.errors[0], "FILE_REJECTED", None, {"errors": check.errors})
    sha = storage.sha256(data)
    d = db.execute(select(Document).where(Document.managed_by == managed_by, Document.primary_type == primary_type, Document.primary_id == record.id, Document.status == "Active")).scalars().first()
    if d is None:
        links = _links_from(rc, primary_type, record.id, record)
        cat = category if active_category(cfg, category) else "Other"
        customer = rc.find("customers", links.get("customerId"))
        d = Document(id=ids.new_id(db, "DOC", 4), name=check.name, file_name=check.name, file_type=check.ext, mime=check.mime, size_bytes=len(data), category=cat, visibility="Related CRM Users", status="Active",
                     version=1, description=description[:2000], owner_id=rc.me, uploaded_by=rc.me, uploaded_date=date.today(), updated_by=rc.me, primary_type=primary_type, primary_id=record.id,
                     managed_by=managed_by, created_by=rc.me, related_customer_id=links.get("customerId"), related_to=(customer.name if customer else ""), branch=getattr(record, "branch", None),
                     attributes={"tags": [], "reviewNote": "", "kind": None}, **{R.snake(k): v for k, v in links.items() if k in R.LINK_KEYS})
        db.add(d)
        db.flush()
        _new_version(db, d, rc, number=1, name=check.name, ext=check.ext, mime=check.mime, size=len(data), data=data, sha=sha, note=note, source=source, previous=None)
        audit(rc, d, "Uploaded", version=1, details=f"{check.name} ({size_label(len(data))}) — {managed_by}")
        return d, 1
    n = d.version + 1
    _new_version(db, d, rc, number=n, name=check.name, ext=check.ext, mime=check.mime, size=len(data), data=data, sha=sha, note=note, source=source, previous=d.version)
    d.version, d.file_name, d.file_type, d.mime, d.size_bytes, d.name = n, check.name, check.ext, check.mime, len(data), check.name
    mark(d, rc)
    audit(rc, d, "New version", version=n, details=f"{check.name} — {managed_by}")
    return d, n


def archive_managed(db: Session, p: Principal, *, managed_by: str, primary_type: str, primary_id: str) -> None:
    rc = RC(db, p)
    for d in db.execute(select(Document).where(Document.managed_by == managed_by, Document.primary_type == primary_type, Document.primary_id == primary_id, Document.status == "Active")).scalars():
        d.status = "Archived"
        mark(d, rc)
        audit(rc, d, "Archived", details=f"Removed from its {managed_by.replace('-', ' ')}")
