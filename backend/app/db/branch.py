"""Branch scoping, enforced centrally at the database-session level so no module can forget it.

A request session carries a `BranchScope` (session.info["scope"]):
  * reads  - every ORM SELECT on a BranchedMixin table is filtered to `scope.read` (None = all branches, only for an account with explicit all-branch access);
  * writes - a new row is stamped with `scope.write`; a Super Admin working in "all branches" supplies the branch (or it is taken from the record it is linked to);
  * links  - a record and the records it points to must share a branch, so a branch can never be tied to another branch's data through the API.

This is real enforcement (server-side), unlike the earlier in-browser demo scoping. Database-level isolation beyond the API (Postgres RLS per branch) would be a further layer.
"""
from dataclasses import dataclass

from sqlalchemy import event, select
from sqlalchemy.orm import Session, with_loader_criteria

from app.core.errors import forbidden, invalid
from app.db.base import BranchedMixin


PEOPLE_TABLES = {"employees", "users", "departments"}  # people may legitimately span branches (a manager in head office); teams are branch-owned, so an employee can only join a team of their own branch


@dataclass(frozen=True)
class BranchScope:
    read: str | None  # None: no restriction (all-branch account viewing everything)
    write: str | None  # branch stamped on new records; None: the caller must supply one / it is derived from a linked record
    all_access: bool = False  # an account holding explicit all-branch authorisation


def set_scope(session: Session, scope: BranchScope | None) -> None:
    session.info["scope"] = scope


def get_scope(session: Session) -> BranchScope | None:
    return session.info.get("scope")


@event.listens_for(Session, "do_orm_execute")
def _scope_reads(state) -> None:
    scope: BranchScope | None = state.session.info.get("scope")
    if scope is None or scope.read is None or not state.is_select:
        return
    branch = scope.read
    state.statement = state.statement.options(with_loader_criteria(BranchedMixin, lambda cls: cls.branch == branch, include_aliases=True))


def _linked_branches(session: Session, obj) -> list[tuple[str, str | None]]:
    """(column name, branch of the record it points to) for every foreign key of `obj` that points at a branched table and is set."""
    out = []
    for fk in obj.__table__.foreign_keys:
        target = fk.column.table
        if "branch" not in target.c or fk.parent.name == "branch" or target.name in PEOPLE_TABLES:
            continue  # people / org structure may legitimately span branches (a manager in head office); business records may not
        value = getattr(obj, fk.parent.key, None) if fk.parent.key in obj.__mapper__.c else None
        if value is None:
            continue
        out.append((fk.parent.name, session.execute(select(target.c.branch).where(fk.column == value)).scalar_one_or_none()))
    return out


@event.listens_for(Session, "before_flush")
def _stamp_and_check_branch(session: Session, flush_context, instances) -> None:
    scope: BranchScope | None = session.info.get("scope")
    for obj in list(session.new):
        if not isinstance(obj, BranchedMixin):
            continue
        links = _linked_branches(session, obj)
        explicit = obj.branch
        if scope is not None and scope.write is not None:
            if explicit and explicit != scope.write:
                raise forbidden("You can only create records in your own branch." if not scope.all_access else f"You are working in the {scope.write} branch: switch to All branches to create a record elsewhere.")
            obj.branch = scope.write
        elif not explicit:
            known = {b for _, b in links if b}
            if len(known) == 1:
                obj.branch = next(iter(known))
            elif len(known) > 1:
                raise invalid("The linked records belong to different branches.")
            elif getattr(obj, "BRANCH_OPTIONAL", False):
                continue  # e.g. the all-branch Super Admin's own employee record
            else:
                hint = "Pick the branch you are working in (the branch selector in the header) before creating it." if scope is not None and scope.all_access else "Choose a branch for this record."
                raise invalid(hint, {"branch": "Choose a branch."})
        for column, parent_branch in links:
            if parent_branch is not None and parent_branch != obj.branch:
                raise invalid(f"The linked record ({column.replace('_id', '').replace('_', ' ')}) belongs to another branch.", {column: "Belongs to another branch."})
