"""n8n workflow integration: the CRM hands business events to n8n webhooks, records what happened to each hand-over, and accepts n8n's status callbacks.

How it fits together
* The Super Admin connects n8n in Settings -> Automation (address + a shared secret) and lists the workflows: each one listens to ONE CRM event (a lead was created, a deal moved stage, an
  insight raised ...) and has the webhook address of its n8n "Webhook" node. Both live in `app_settings` (`n8n`, `n8n_workflows`); the secret is stored encrypted and is never sent back to a browser.
* When a record changes through the normal screens the record engine calls `capture` (inside the same transaction, so a rolled-back change sends nothing) and `fire` (after the commit). Each
  matching workflow gets one `automation_runs` row (Queued) and a small signed JSON message is POSTed to its webhook in a background thread - a slow or broken n8n can never slow down or
  fail a save in the CRM.
* Outcome per run: Success / Failed with a plain-language reason. Network trouble, timeouts and 5xx answers are retried automatically (3 attempts in all); a 4xx (wrong URL, rejected key)
  is not - fix it and press Retry. A workflow marked "waits for callback" stays Running until n8n reports back to POST /automation/callback (or 15 minutes pass).
* Every message carries `X-CRM-Run-Id`, the shared secret in the configured header and an HMAC signature, so the workflow can authenticate the CRM; callbacks must present the same secret."""
import base64
import hashlib
import hmac
import ipaddress
import json
import logging
import socket
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from urllib.parse import urlparse

import httpx
from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.api.deps import Principal
from app.core.config import get_settings
from app.core.errors import ApiError, conflict, forbidden, invalid, not_found
from app.db import config_events
from app.db.session import get_session_factory
from app.models import AppSetting, AutomationRun
from app.services import audit
from app.services.codec import serialise_value, to_json

log = logging.getLogger("app.automation")
CONFIG_KEY, WORKFLOWS_KEY = "n8n", "n8n_workflows"
MAX_WORKFLOWS = 50
MAX_ATTEMPTS = 3
RETRY_DELAYS = (60, 300)  # seconds before attempt 2 and 3
CALLBACK_WAIT = timedelta(minutes=15)
MAX_PAYLOAD_BYTES = 200_000
STATUSES = ("Queued", "Running", "Success", "Failed")

# The CRM events a workflow can listen to (key -> label, module). `insight.*` events are raised from AI Insights on request (see services/insights.py).
RECORD_EVENTS = {
    "lead.created": ("A lead is created", "Leads"), "lead.status_changed": ("A lead's status changes", "Leads"),
    "enquiry.created": ("An enquiry is created", "Enquiries"), "enquiry.status_changed": ("An enquiry's status changes", "Enquiries"),
    "deal.created": ("A deal is created", "Deals"), "deal.stage_changed": ("A deal moves to another stage", "Deals"), "deal.won": ("A deal is won", "Deals"), "deal.lost": ("A deal is lost", "Deals"),
    "quotation.created": ("A quotation is created", "Quotations"), "quotation.status_changed": ("A quotation's status changes", "Quotations"),
    "invoice.created": ("An invoice is created", "Invoices"), "invoice.status_changed": ("An invoice's status changes", "Invoices"),
    "ticket.created": ("A support ticket is created", "Support"), "ticket.status_changed": ("A support ticket's status changes", "Support"),
    "customer.created": ("A customer is created", "Customers"),
}
ENTITY = {"leads": "lead", "enquiries": "enquiry", "deals": "deal", "quotations": "quotation", "invoices": "invoice", "tickets": "ticket", "customers": "customer"}
STATE_FIELD = {"deal": "stage"}  # every other entity's state field is "status"
LABEL_FIELDS = ("name", "number", "subject", "title")
LOST_STAGES = ("Closed Lost", "Closed Lost – Competition")
MANUAL_EVENTS = {"manual.test": ("Manual test (sent from the Automation screen)", "Automation")}

_pool = ThreadPoolExecutor(max_workers=4, thread_name_prefix="crm-n8n")


def catalogue() -> list[dict]:
    from app.services import insights

    items = [{"key": k, "label": v[0], "module": v[1], "kind": "record"} for k, v in RECORD_EVENTS.items()]
    items += [{"key": f"insight.{k}", "label": f"AI Insights: {label}", "module": "AI Insights", "kind": "insight"} for k, label in insights.AUTOMATABLE.items()]
    items += [{"key": k, "label": v[0], "module": v[1], "kind": "manual"} for k, v in MANUAL_EVENTS.items()]
    return items


def event_keys() -> set[str]:
    """The events a workflow may be bound to (the manual test message is something the CRM sends, not something to listen to)."""
    return {e["key"] for e in catalogue() if e["kind"] != "manual"}


# ---- configuration -----------------------------------------------------------------------------------------------------------
def _fernet() -> Fernet:
    key = hashlib.sha256(("n8n-secret|" + get_settings().jwt_secret_key).encode()).digest()
    return Fernet(base64.urlsafe_b64encode(key))


def _encrypt(secret: str) -> str:
    return _fernet().encrypt(secret.encode()).decode()


def _decrypt(token: str) -> str | None:
    try:
        return _fernet().decrypt(token.encode()).decode() if token else None
    except InvalidToken:  # the server's JWT secret changed: the stored secret cannot be read any more and must be entered again
        return None


def _read(db: Session) -> dict:
    cfg = db.get(AppSetting, CONFIG_KEY)
    wf = db.get(AppSetting, WORKFLOWS_KEY)
    return {"cfg": dict(cfg.value or {}) if cfg else {}, "workflows": list((wf.value or {}).get("items", [])) if wf else []}


def state(db: Session) -> dict:
    return config_events.cached(db, "automation", lambda: _read(db))


def _config(db: Session) -> dict:
    c = state(db)["cfg"]
    return {"enabled": bool(c.get("enabled")), "baseUrl": c.get("baseUrl", ""), "authHeader": c.get("authHeader") or "X-CRM-Key", "publicApiUrl": c.get("publicApiUrl", ""),
            "timeoutSeconds": int(c.get("timeoutSeconds") or 10), "secretEnc": c.get("secretEnc", "")}


def _save(db: Session, p: Principal, key: str, value: dict) -> None:
    row = db.get(AppSetting, key)
    if row is None:
        db.add(AppSetting(key=key, value=value, updated_by=p.actor_id))
    else:
        row.value, row.updated_by = value, p.actor_id


def _require_admin(p: Principal) -> None:
    if p.level not in ("Super Admin", "Admin"):
        raise forbidden("Only an administrator can use workflow automation.")


def _require_super(p: Principal) -> None:
    if not p.is_super_admin:
        raise forbidden("Only the Super Admin can change the automation settings.")


def check_url(url: str, *, what: str = "address") -> str:
    """The address must be http(s). In production it must be https and must not point inside the server's own network (the CRM server would otherwise be a tool for probing it)."""
    u = urlparse((url or "").strip())
    if u.scheme not in ("http", "https") or not u.hostname:
        raise invalid(f"Enter a full {what} starting with https://", {"baseUrl": f"Enter a full {what} starting with https://"})
    if u.username or u.password:
        raise invalid(f"Do not put a user name or password in the {what}; use the secret field.", {"baseUrl": "No credentials in the address."})
    if get_settings().is_production:
        if u.scheme != "https":
            raise invalid(f"The {what} must start with https:// on this server.", {"baseUrl": "Use https://"})
        try:
            addresses = {ipaddress.ip_address(i[4][0]) for i in socket.getaddrinfo(u.hostname, u.port or 443, proto=socket.IPPROTO_TCP)}
        except socket.gaierror:
            raise invalid(f"The {what} could not be found (check the spelling).", {"baseUrl": "Address not found."}) from None
        if any(a.is_private or a.is_loopback or a.is_link_local or a.is_reserved or a.is_multicast or a.is_unspecified for a in addresses):
            raise invalid(f"The {what} points to a private network address, which this server cannot use.", {"baseUrl": "Not a public address."})
    return url.strip().rstrip("/") if what == "n8n address" else url.strip()


def public_config(db: Session, p: Principal) -> dict:
    c = _config(db)
    secret_ok = bool(c["secretEnc"]) and _decrypt(c["secretEnc"]) is not None
    out = {"enabled": c["enabled"], "configured": bool(c["baseUrl"]) and secret_ok, "hasSecret": bool(c["secretEnc"]), "secretReadable": secret_ok or not c["secretEnc"],
           "authHeader": c["authHeader"], "timeoutSeconds": c["timeoutSeconds"]}
    if p.is_super_admin:  # addresses only for the Super Admin; the secret itself never leaves the server
        out.update({"baseUrl": c["baseUrl"], "publicApiUrl": c["publicApiUrl"]})
    return out


def put_config(db: Session, p: Principal, body: dict) -> dict:
    _require_super(p)
    c = _config(db)
    errors: dict[str, str] = {}
    base = str(body.get("baseUrl", c["baseUrl"]) or "").strip()
    if base:
        base = check_url(base, what="n8n address")
    public = str(body.get("publicApiUrl", c["publicApiUrl"]) or "").strip().rstrip("/")
    if public:
        public = check_url(public, what="public API address")
    header = str(body.get("authHeader", c["authHeader"]) or "").strip() or "X-CRM-Key"
    if not header.replace("-", "").isalnum() or len(header) > 60:
        errors["authHeader"] = "Use letters, digits and dashes only (for example X-CRM-Key)."
    try:
        timeout = int(body.get("timeoutSeconds", c["timeoutSeconds"]))
    except (TypeError, ValueError):
        timeout = 0
    if not 3 <= timeout <= 60:
        errors["timeoutSeconds"] = "Choose between 3 and 60 seconds."
    secret = body.get("secret")
    if secret is not None and secret != "":
        secret = str(secret).strip()
        if len(secret) < 16:
            errors["secret"] = "Use at least 16 characters (a long random string)."
        elif len(secret) > 200:
            errors["secret"] = "That secret is too long."
    if errors:
        raise invalid(next(iter(errors.values())), errors)
    enabled = bool(body.get("enabled", c["enabled"]))
    enc = _encrypt(secret) if secret else c["secretEnc"]
    if enabled and (not base or not enc):
        raise invalid("Enter the n8n address and a secret before switching automation on.", {"baseUrl": "Required." if not base else "", "secret": "Required." if not enc else ""})
    _save(db, p, CONFIG_KEY, {"enabled": enabled, "baseUrl": base, "authHeader": header, "publicApiUrl": public, "timeoutSeconds": timeout, "secretEnc": enc, "updatedAt": _now().isoformat()})
    audit.record(db, user=p.user, action="Change n8n connection", module="Automation", details=f"enabled={enabled}, address={'set' if base else 'empty'}, secret={'changed' if secret else 'kept'}", info=p.info)
    db.commit()
    return public_config(db, p)


# ---- workflows ---------------------------------------------------------------------------------------------------------------
def _now() -> datetime:
    return datetime.now(UTC)


def _workflow_json(w: dict, p: Principal) -> dict:
    out = {k: w.get(k) for k in ("id", "name", "event", "enabled", "awaitCallback", "onlyWhen", "description", "createdAt", "updatedAt")}
    out["eventLabel"] = next((e["label"] for e in catalogue() if e["key"] == w["event"]), w["event"])
    if p.is_super_admin:
        out["webhookUrl"] = w.get("webhookUrl", "")
    return out


def list_workflows(db: Session, p: Principal) -> list[dict]:
    _require_admin(p)
    return [_workflow_json(w, p) for w in state(db)["workflows"]]


def _validate_workflow(db: Session, body: dict, current: dict | None) -> dict:
    errors: dict[str, str] = {}
    name = str(body.get("name", (current or {}).get("name", "")) or "").strip()
    if not 2 <= len(name) <= 120:
        errors["name"] = "Give the workflow a name (2-120 characters)."
    event = str(body.get("event", (current or {}).get("event", "")) or "")
    if event not in event_keys():
        errors["event"] = "Choose the event this workflow should react to."
    url = str(body.get("webhookUrl", (current or {}).get("webhookUrl", "")) or "").strip()
    if not url:
        errors["webhookUrl"] = "Enter the webhook address of the n8n workflow."
    elif url.startswith("/"):
        if not _config(db)["baseUrl"]:
            errors["webhookUrl"] = "Enter the n8n address first, or paste the full webhook address."
    else:
        try:
            check_url(url, what="webhook address")
        except ApiError as exc:
            errors["webhookUrl"] = exc.message
    only_when = str(body.get("onlyWhen", (current or {}).get("onlyWhen", "")) or "").strip()
    if only_when and not (event.endswith(".status_changed") or event.endswith(".stage_changed")):
        errors["onlyWhen"] = "This condition only applies to status / stage change events."
    if len(only_when) > 60:
        errors["onlyWhen"] = "Too long."
    description = str(body.get("description", (current or {}).get("description", "")) or "").strip()
    if len(description) > 300:
        errors["description"] = "Keep the description under 300 characters."
    if errors:
        raise invalid(next(iter(errors.values())), errors)
    others = [w for w in state(db)["workflows"] if not current or w["id"] != current["id"]]
    if any(w["name"].lower() == name.lower() for w in others):
        raise conflict("Another workflow already has this name.", code="DUPLICATE", fields={"name": "Already used."})
    return {"name": name, "event": event, "webhookUrl": url, "enabled": bool(body.get("enabled", (current or {}).get("enabled", True))),
            "awaitCallback": bool(body.get("awaitCallback", (current or {}).get("awaitCallback", False))), "onlyWhen": only_when, "description": description}


def create_workflow(db: Session, p: Principal, body: dict) -> dict:
    _require_super(p)
    items = list(state(db)["workflows"])
    if len(items) >= MAX_WORKFLOWS:
        raise invalid(f"At most {MAX_WORKFLOWS} workflows can be set up.")
    w = {"id": f"WF-{uuid.uuid4().hex[:8]}", **_validate_workflow(db, body, None), "createdAt": _now().isoformat(), "updatedAt": _now().isoformat()}
    _save(db, p, WORKFLOWS_KEY, {"items": [*items, w]})
    audit.record(db, user=p.user, action="Add workflow", module="Automation", record_id=w["id"], details=f"{w['name']} ({w['event']})", info=p.info)
    db.commit()
    return _workflow_json(w, p)


def update_workflow(db: Session, p: Principal, workflow_id: str, body: dict) -> dict:
    _require_super(p)
    items = list(state(db)["workflows"])
    current = next((w for w in items if w["id"] == workflow_id), None)
    if current is None:
        raise not_found("Workflow not found.")
    updated = {**current, **_validate_workflow(db, body, current), "updatedAt": _now().isoformat()}
    _save(db, p, WORKFLOWS_KEY, {"items": [updated if w["id"] == workflow_id else w for w in items]})
    audit.record(db, user=p.user, action="Change workflow", module="Automation", record_id=workflow_id, details=f"{updated['name']} ({updated['event']}), enabled={updated['enabled']}", info=p.info)
    db.commit()
    return _workflow_json(updated, p)


def delete_workflow(db: Session, p: Principal, workflow_id: str) -> dict:
    _require_super(p)
    items = list(state(db)["workflows"])
    current = next((w for w in items if w["id"] == workflow_id), None)
    if current is None:
        raise not_found("Workflow not found.")
    _save(db, p, WORKFLOWS_KEY, {"items": [w for w in items if w["id"] != workflow_id]})  # its past runs stay as history
    audit.record(db, user=p.user, action="Delete workflow", module="Automation", record_id=workflow_id, details=current["name"], info=p.info)
    db.commit()
    return {"success": True}


# ---- sending -----------------------------------------------------------------------------------------------------------------
def _target_url(cfg: dict, wf: dict) -> str:
    url = wf["webhookUrl"]
    return cfg["baseUrl"].rstrip("/") + url if url.startswith("/") else url


def _headers(cfg: dict, secret: str, run_id: str, event: str, body: bytes) -> dict:
    return {"Content-Type": "application/json", "User-Agent": "LAX360-CRM-Automation/1", cfg["authHeader"]: secret, "X-CRM-Run-Id": run_id, "X-CRM-Event": event,
            "X-CRM-Timestamp": str(int(time.time())), "X-CRM-Signature": "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()}


def explain_status(code: int) -> str:
    return {
        400: "n8n rejected the message (400). Check the workflow's Webhook node settings.",
        401: "n8n refused the credentials (401). The header name and secret must match the Webhook node's authentication.",
        403: "n8n refused the credentials (403). The header name and secret must match the Webhook node's authentication.",
        404: "n8n could not find that webhook (404). Check the address, that the workflow is switched ON in n8n, and that you used the Production URL (not the Test URL).",
        405: "The webhook does not accept POST (405). Set the Webhook node's HTTP method to POST.",
        413: "n8n says the message is too large (413).",
        429: "n8n is limiting requests (429). It will be tried again.",
    }.get(code, f"n8n answered with an error ({code}).")


def _classify(exc: Exception, timeout: int) -> tuple[str, bool]:
    """(plain message, worth retrying). Never includes the secret or the full address."""
    if isinstance(exc, httpx.TimeoutException):
        return f"n8n did not answer within {timeout} seconds.", True
    if isinstance(exc, httpx.ConnectError):
        return "Could not reach n8n. Check that it is running and the address is right.", True
    if isinstance(exc, httpx.TransportError):
        return f"The connection to n8n failed ({type(exc).__name__}).", True
    return f"Unexpected problem while contacting n8n ({type(exc).__name__}).", False


def _post(url: str, headers: dict, body: bytes, timeout: int) -> httpx.Response:
    with httpx.Client(timeout=timeout, follow_redirects=False) as client:
        return client.post(url, content=body, headers=headers)


def _claim(db: Session, run_id: str) -> AutomationRun | None:
    claimed = db.execute(update(AutomationRun).where(AutomationRun.id == run_id, AutomationRun.status.in_(("Queued", "Failed"))).values(status="Running", started_at=_now(), next_retry_at=None)).rowcount
    db.commit()
    return db.get(AutomationRun, run_id) if claimed else None


def execute(run_id: str) -> None:
    """Sends one run (own session). Safe to call from any thread; a run that is already being sent is skipped."""
    try:
        with get_session_factory()() as db:
            run = _claim(db, run_id)
            if run is None:
                return
            db.refresh(run)
            cfg = _config_fresh(db)
            wf = next((w for w in _read(db)["workflows"] if w["id"] == run.workflow_id), None)
            secret = _decrypt(cfg["secretEnc"])
            problem = None
            if wf is None:
                problem = "This workflow no longer exists."
            elif not wf.get("enabled"):
                problem = "This workflow is switched off."
            elif not cfg["enabled"]:
                problem = "Automation is switched off in Settings."
            elif not cfg["baseUrl"] and not wf["webhookUrl"].startswith("http"):
                problem = "The n8n address is not set."
            elif not secret:
                problem = "The shared secret is missing or must be entered again (Settings -> Automation)."
            run.attempts += 1
            if problem:
                _finish(run, "Failed", problem, None, None, retry=False)
                db.commit()
                return
            body = json.dumps({**run.payload, "runId": run.id, "attempt": run.attempts}, default=str, separators=(",", ":")).encode()
            url = _target_url(cfg, wf)
            await_cb = bool(wf.get("awaitCallback"))
            timeout, headers = cfg["timeoutSeconds"], _headers(cfg, secret, run.id, run.event, body)
            db.commit()  # attempts + Running are visible while the request is in flight
            started = time.monotonic()
            try:
                check_url(url, what="webhook address")
                resp = _post(url, headers, body, timeout)
                took = int((time.monotonic() - started) * 1000)
                if 200 <= resp.status_code < 300:
                    note = _answer_note(resp)
                    if await_cb:
                        run.status, run.message, run.response_code, run.duration_ms = "Running", "Sent. Waiting for n8n to report back. " + note, resp.status_code, took
                    else:
                        _finish(run, "Success", note or "Delivered to n8n.", resp.status_code, took, retry=False)
                else:
                    _finish(run, "Failed", explain_status(resp.status_code), resp.status_code, took, retry=resp.status_code in (408, 425, 429) or resp.status_code >= 500)
            except ApiError as exc:
                _finish(run, "Failed", exc.message, None, None, retry=False)
            except Exception as exc:  # noqa: BLE001
                message, retry = _classify(exc, timeout)
                _finish(run, "Failed", message, None, int((time.monotonic() - started) * 1000), retry=retry)
            db.commit()
    except Exception:  # noqa: BLE001  - a background send must never raise into the request thread
        log.exception("automation run %s could not be processed", run_id)


def _config_fresh(db: Session) -> dict:
    c = _read(db)["cfg"]
    return {"enabled": bool(c.get("enabled")), "baseUrl": c.get("baseUrl", ""), "authHeader": c.get("authHeader") or "X-CRM-Key", "timeoutSeconds": int(c.get("timeoutSeconds") or 10), "secretEnc": c.get("secretEnc", "")}


def _answer_note(resp: httpx.Response) -> str:
    try:
        data = resp.json()
        text = data.get("message") if isinstance(data, dict) else None
    except ValueError:
        text = None
    return str(text)[:200] if text else ""


def _finish(run: AutomationRun, status: str, message: str, code: int | None, took: int | None, *, retry: bool) -> None:
    run.status, run.message, run.response_code, run.duration_ms, run.finished_at = status, message[:500], code, took, _now()
    run.next_retry_at = _now() + timedelta(seconds=RETRY_DELAYS[min(run.attempts, len(RETRY_DELAYS)) - 1]) if status == "Failed" and retry and run.attempts < MAX_ATTEMPTS else None
    if status == "Failed" and retry and run.attempts < MAX_ATTEMPTS:
        run.message = f"{run.message[:440]} Will try again automatically (attempt {run.attempts + 1} of {MAX_ATTEMPTS})."


def fire(run_ids: list[str]) -> None:
    """Hands queued runs to the background pool (inline in tests, where the HTTP call is replaced)."""
    for rid in run_ids:
        if get_settings().is_test:
            execute(rid)
        else:
            _pool.submit(execute, rid)


# ---- events from the CRM -----------------------------------------------------------------------------------------------------
def _label(obj) -> str:
    for f in LABEL_FIELDS:
        v = getattr(obj, f, None)
        if v:
            return str(v)[:200]
    return obj.id


def _matching(db: Session, event: str, new_state: str | None) -> list[dict]:
    st = state(db)
    if not st["cfg"].get("enabled"):
        return []
    return [w for w in st["workflows"] if w.get("enabled") and w["event"] == event and (not w.get("onlyWhen") or (new_state or "").lower() == w["onlyWhen"].lower())]


def queue_run(db: Session, wf: dict, event: str, payload: dict, *, trigger: str, p: Principal | None, record_type: str | None = None, record_id: str | None = None, label: str = "",
              branch: str | None = None) -> AutomationRun:
    run_id = f"RUN-{uuid.uuid4().hex[:12]}"
    cb = _config(db)["publicApiUrl"]
    body = {"event": event, "occurredAt": _now().isoformat(), "source": "LAX360 Business CRM", "branch": branch, "trigger": trigger,
            "actor": {"id": p.actor_id, "name": p.name} if p else None, **payload}
    if cb:
        body["callbackUrl"] = f"{cb}/api/v1/automation/callback"
    if len(json.dumps(body, default=str)) > MAX_PAYLOAD_BYTES:
        body = {k: v for k, v in body.items() if k != "record"} | {"record": {**(body.get("record") or {}), "data": {"note": "Record too large to include; fetch it from the CRM."}}}
    run = AutomationRun(id=run_id, workflow_id=wf["id"], workflow_name=wf["name"], event=event, trigger=trigger, record_type=record_type, record_id=record_id, record_label=label[:200],
                        branch=branch, status="Queued", payload=json.loads(json.dumps(body, default=str)), created_by=p.actor_id if p else None)
    db.add(run)
    return run


def capture(db: Session, p: Principal, spec_key: str, action: str, obj, changes: dict | None = None) -> list[str]:
    """Called by the record engine just before it commits: queues a run for every workflow listening to what just happened. Returns the run ids to pass to `fire` after the commit."""
    entity = ENTITY.get(spec_key)
    if entity is None or not state(db)["cfg"].get("enabled"):
        return []
    events: list[tuple[str, str | None]] = []
    field = STATE_FIELD.get(entity, "status")
    if action == "created":
        events.append((f"{entity}.created", getattr(obj, field, None)))
    elif changes and field in changes:
        new = getattr(obj, field, None)
        events.append((f"{entity}.{'stage' if entity == 'deal' else 'status'}_changed", new))
        if entity == "deal" and new == "Closed Won":
            events.append(("deal.won", new))
        if entity == "deal" and new in LOST_STAGES:
            events.append(("deal.lost", new))
    ids: list[str] = []
    for event, new_state in events:
        for wf in _matching(db, event, new_state):
            data = {"record": {"type": entity, "id": obj.id, "label": _label(obj), "data": to_json(obj)}}
            if changes:
                data["changes"] = {k: serialise_value(v) if not isinstance(v, (dict, list)) else v for k, v in changes.items()}
            ids.append(queue_run(db, wf, event, data, trigger="event", p=p, record_type=entity, record_id=obj.id, label=_label(obj), branch=getattr(obj, "branch", None)).id)
    return ids


# ---- manual runs, retry, callback ---------------------------------------------------------------------------------------------
def run_manually(db: Session, p: Principal, workflow_id: str, body: dict | None = None) -> dict:
    """Sends a clearly marked test message to one workflow (works even if the workflow is bound to another event), so the connection and the n8n side can be checked."""
    _require_admin(p)
    wf = next((w for w in state(db)["workflows"] if w["id"] == workflow_id), None)
    if wf is None:
        raise not_found("Workflow not found.")
    _ready_or_raise(db, wf)
    run = queue_run(db, {**wf, "event": wf["event"]}, "manual.test", {"test": True, "note": "This is a test message sent from the CRM's Automation screen.", "workflowEvent": wf["event"]}, trigger="manual", p=p,
                    label="Test message", branch=p.branch)
    db.commit()
    fire([run.id])
    db.expire_all()  # the send ran in its own session: read its outcome
    return run_json(db.get(AutomationRun, run.id))


def _ready_or_raise(db: Session, wf: dict) -> None:
    cfg = _config(db)
    if not cfg["enabled"]:
        raise conflict("Automation is switched off. Turn it on in Settings -> Automation first.", code="AUTOMATION_OFF")
    if not wf.get("enabled"):
        raise conflict("This workflow is switched off.", code="WORKFLOW_OFF")


def retry_run(db: Session, p: Principal, run_id: str) -> dict:
    _require_admin(p)
    run = _visible(db, p, run_id)
    if run.status != "Failed":
        raise conflict("Only a failed run can be retried.", code="NOT_FAILED")
    run.attempts = 0 if run.attempts >= MAX_ATTEMPTS else run.attempts  # a manual retry always gets a fresh set of attempts
    run.trigger = "retry"
    db.commit()
    fire([run.id])
    db.expire_all()  # the send ran in its own session: read its outcome
    return run_json(db.get(AutomationRun, run.id))


def run_insight(db: Session, p: Principal, key: str, workflow_id: str) -> dict:
    """Sends one AI Insight - exactly as the server computes it for this person - to a workflow that listens to `insight.<key>`."""
    from app.services import insights

    _require_admin(p)
    if key not in insights.AUTOMATABLE:
        raise invalid("This insight cannot be sent to a workflow.")
    wf = next((w for w in state(db)["workflows"] if w["id"] == workflow_id), None)
    if wf is None:
        raise not_found("Workflow not found.")
    if wf["event"] != f"insight.{key}":
        raise invalid("This workflow is not set up for this insight.")
    _ready_or_raise(db, wf)
    found = insights.find(db, p, key)
    if found is None:
        raise conflict("This insight no longer applies, so there is nothing to send.", code="NOTHING_TO_SEND")
    payload = {"insight": {k: found[k] for k in ("key", "category", "severity", "title", "summary", "metric", "total", "items")}}
    run = queue_run(db, wf, f"insight.{key}", payload, trigger="insight", p=p, record_type="insight", record_id=key, label=found["title"], branch=p.branch)
    audit.record(db, user=p.user, action="Send insight to workflow", module="Automation", record_id=run.id, details=f"{found['title']} -> {wf['name']}", info=p.info)
    db.commit()
    fire([run.id])
    db.expire_all()  # the send ran in its own session: read its outcome
    return run_json(db.get(AutomationRun, run.id))


def callback(db: Session, headers, body: dict) -> dict:
    """n8n reports how a run ended: { runId, status: success|failed, message }. Authenticated with the same shared secret the CRM sends."""
    cfg = _config(db)
    secret = _decrypt(cfg["secretEnc"])
    auth = headers.get("authorization") or ""
    presented = headers.get(cfg["authHeader"]) or (auth[7:] if auth.lower().startswith("bearer ") else "")
    if not secret or not presented or not hmac.compare_digest(presented.encode(), secret.encode()):
        raise ApiError(401, "The callback was not authenticated.", "UNAUTHENTICATED")
    run = db.get(AutomationRun, str(body.get("runId", "")))
    if run is None:
        raise not_found("Unknown run.")
    status = str(body.get("status", "")).strip().lower()
    if status not in ("success", "succeeded", "ok", "failed", "failure", "error"):
        raise invalid("status must be success or failed.", {"status": "success | failed"})
    ok = status in ("success", "succeeded", "ok")
    note = str(body.get("message") or "").strip()[:400]
    run.status = "Success" if ok else "Failed"
    run.message = note or ("n8n reported the workflow finished." if ok else "n8n reported that the workflow failed.")
    run.finished_at, run.next_retry_at = _now(), None
    db.commit()
    return {"success": True, "run": run.id, "status": run.status}


# ---- history -----------------------------------------------------------------------------------------------------------------
def run_json(r: AutomationRun) -> dict:
    return {"id": r.id, "workflowId": r.workflow_id, "workflowName": r.workflow_name, "event": r.event, "trigger": r.trigger, "recordType": r.record_type, "recordId": r.record_id,
            "recordLabel": r.record_label, "branch": r.branch, "status": r.status, "attempts": r.attempts, "responseCode": r.response_code, "message": r.message, "durationMs": r.duration_ms,
            "createdAt": serialise_value(r.created_at), "startedAt": serialise_value(r.started_at), "finishedAt": serialise_value(r.finished_at), "nextRetryAt": serialise_value(r.next_retry_at)}


def _visible_filter(p: Principal):
    return () if p.is_super_admin else (AutomationRun.branch == p.branch,)


def _visible(db: Session, p: Principal, run_id: str) -> AutomationRun:
    run = db.get(AutomationRun, run_id)
    if run is None or (not p.is_super_admin and run.branch != p.branch):
        raise not_found("Run not found.")
    return run


def list_runs(db: Session, p: Principal, params: dict) -> dict:
    _require_admin(p)
    q = select(AutomationRun).where(*_visible_filter(p))
    if params.get("status") in STATUSES:
        q = q.where(AutomationRun.status == params["status"])
    if params.get("workflowId"):
        q = q.where(AutomationRun.workflow_id == params["workflowId"])
    total = db.execute(select(func.count()).select_from(q.subquery())).scalar_one()
    size = min(max(int(params.get("pageSize", 15) or 15), 1), 100)
    page = max(int(params.get("page", 1) or 1), 1)
    rows = db.execute(q.order_by(AutomationRun.created_at.desc()).limit(size).offset((page - 1) * size)).scalars().all()
    return {"data": [run_json(r) for r in rows], "total": total, "page": page, "pageSize": size}


def overview(db: Session, p: Principal) -> dict:
    _require_admin(p)
    since = _now() - timedelta(hours=24)
    counts = dict(db.execute(select(AutomationRun.status, func.count()).where(AutomationRun.created_at >= since, *_visible_filter(p)).group_by(AutomationRun.status)).all())
    last = db.execute(select(AutomationRun).where(*_visible_filter(p)).order_by(AutomationRun.created_at.desc()).limit(1)).scalar_one_or_none()
    return {"config": public_config(db, p), "events": catalogue(), "workflows": [_workflow_json(w, p) for w in state(db)["workflows"]],
            "last24h": {s: counts.get(s, 0) for s in STATUSES}, "lastRun": run_json(last) if last else None}


# ---- n8n connection test -----------------------------------------------------------------------------------------------------
def test_connection(db: Session, p: Principal) -> dict:
    _require_super(p)
    cfg = _config(db)
    if not cfg["baseUrl"]:
        raise invalid("Enter and save the n8n address first.", {"baseUrl": "Required."})
    url = check_url(cfg["baseUrl"], what="n8n address") + "/healthz"
    started = time.monotonic()
    try:
        resp = _get(url, 8)
        took = int((time.monotonic() - started) * 1000)
        ok = resp.status_code == 200
        return {"ok": ok, "status": resp.status_code, "ms": took, "message": "n8n is reachable." if ok else f"n8n answered {resp.status_code}. The address may be wrong, or this is not the n8n main address."}
    except Exception as exc:  # noqa: BLE001
        message, _ = _classify(exc, 8)
        return {"ok": False, "status": None, "ms": int((time.monotonic() - started) * 1000), "message": message}


def _get(url: str, timeout: int) -> httpx.Response:
    with httpx.Client(timeout=timeout, follow_redirects=False) as client:
        return client.get(url, headers={"User-Agent": "LAX360-CRM-Automation/1"})


# ---- background upkeep (scheduler) ------------------------------------------------------------------------------------------
def sweep(db: Session) -> dict:
    """Retries failed sends whose time has come, and ends runs that wait for a callback that never arrived."""
    now = _now()
    due = db.execute(select(AutomationRun.id).where(AutomationRun.status == "Failed", AutomationRun.next_retry_at.is_not(None), AutomationRun.next_retry_at <= now, AutomationRun.attempts < MAX_ATTEMPTS).limit(50)).scalars().all()
    stale = db.execute(select(AutomationRun).where(AutomationRun.status == "Running", AutomationRun.started_at < now - CALLBACK_WAIT)).scalars().all()
    for r in stale:
        r.status, r.finished_at = "Failed", now
        r.message = "n8n did not report back within 15 minutes."
    db.commit()
    fire(list(due))
    return {"retried": len(due), "timedOut": len(stale)}

