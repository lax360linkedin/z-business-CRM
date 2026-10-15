"""Request dependencies: the signed-in principal (user, permissions, branch scope) and permission checks."""
from dataclasses import dataclass

from fastapi import Depends, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import ApiError, forbidden, unauthorized
from app.db.branch import BranchScope, set_scope
from app.db.session import get_db
from app.models.identity import AuthSession, User
from app.services import audit, auth_service
from app.services.audit import RequestInfo

ALL = "all"


def client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for", "")
    return (forwarded.split(",")[0].strip() if forwarded else (request.client.host if request.client else ""))[:64]


def request_info(request: Request) -> RequestInfo:
    return RequestInfo(ip=client_ip(request), user_agent=request.headers.get("user-agent", ""), device=request.headers.get("x-device-id", ""))


@dataclass
class Principal:
    user: User
    session: AuthSession
    permissions: dict
    scope: BranchScope
    info: RequestInfo

    @property
    def actor_id(self) -> str:
        """The id stored on records this person creates / owns: their employee id."""
        return self.user.employee_id

    @property
    def name(self) -> str:
        return self.user.name

    @property
    def level(self) -> str:
        return self.user.access_level

    @property
    def is_super_admin(self) -> bool:
        return self.user.access_level == "Super Admin"

    @property
    def branch(self) -> str | None:
        return self.user.branch

    def can(self, module: str, action: str = "view") -> bool:
        return bool(self.permissions.get(module, {}).get(action))


def build_scope(db: Session, user: User, requested: str | None) -> BranchScope:
    """A Super Admin with all-branch authorisation works in the branch she picked in the header (or everywhere); everyone else is fixed to their own branch."""
    if user.access_level == "Super Admin" and user.branch_access == ALL:
        choice = (requested or ALL).strip() or ALL
        if choice == ALL:
            return BranchScope(read=None, write=None, all_access=True)
        if choice not in auth_service.branch_statuses(db):
            raise ApiError(422, "Unknown branch.", "BRANCH_INVALID")
        return BranchScope(read=choice, write=choice, all_access=True)
    return BranchScope(read=user.branch, write=user.branch, all_access=False)  # the header is ignored: a branch user cannot widen their own scope


def current_principal(request: Request, db: Session = Depends(get_db)) -> Principal:
    header = request.headers.get("authorization", "")
    if not header.lower().startswith("bearer "):
        raise unauthorized("Not signed in.", "UNAUTHENTICATED")
    user, session = auth_service.validate_access(db, header[7:].strip())
    scope = build_scope(db, user, request.headers.get("x-branch-scope"))
    set_scope(db, scope)
    return Principal(user=user, session=session, permissions=auth_service.permissions_of(user), scope=scope, info=request_info(request))


def require(module: str, action: str = "view"):
    """Dependency factory: the caller must hold (module, action). A denial is audited and answers 403 - no data is touched."""

    def dependency(request: Request, principal: Principal = Depends(current_principal), db: Session = Depends(get_db)) -> Principal:
        if not principal.can(module, action):
            audit.record(db, user=principal.user, action=f"Denied: {action} {module}", module=module, result="Denied", details=f"{request.method} {request.url.path}", info=principal.info)
            db.commit()  # keep the denial although the request ends in an error
            raise forbidden("You do not have permission to do that.")
        return principal

    return dependency


def require_super_admin(request: Request, principal: Principal = Depends(current_principal), db: Session = Depends(get_db)) -> Principal:
    if not principal.is_super_admin:
        audit.record(db, user=principal.user, action="Denied: Super Admin only", module="Administration", result="Denied", details=f"{request.method} {request.url.path}", info=principal.info)
        db.commit()
        raise forbidden("Only the Super Admin can do that.")
    return principal
