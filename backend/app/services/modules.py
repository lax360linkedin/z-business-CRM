"""Registry of the business modules served by the record engine, and the module-specific rules (workflow transitions, derived fields) attached to them."""
from datetime import UTC, datetime, timedelta

from sqlalchemy import false, select

from app.core.errors import forbidden, invalid
from app.models import (Notification, Activity, Campaign, Company, Contact, Contract, Customer, Deal, DocumentTemplate, Enquiry, Expense, ExpenseCategory, Invoice, Lead, LeadSource, Payment, Product, Project,
                        Proposal, Quotation, SalesOrder, Task, Ticket, Vendor)
from app.services import crm_flow, flows, timeline
from app.services.lead_score import lead_score
from app.services.activities import ActivityHooks
from app.services import billing, catalogue, data_scope, expenses, lead_sources, marketing, operations, sales_docs
from app.services.records import Ctx, Hooks, ModuleSpec


def _now() -> datetime:
    return datetime.now(UTC)


class StatusFlowHooks(Hooks):
    """A status / stage that may only move along its workflow graph. Some targets (conversion) are reachable only through their dedicated endpoint."""

    related_type = ""
    owner_attr: str | None = None  # the column holding the person responsible (logged when it changes)

    def __init__(self, field: str, flow: dict, known: tuple, label: str, endpoint_only: tuple = (), start: tuple | None = None):
        self.field, self.flow, self.known, self.label, self.endpoint_only, self.start = field, flow, known, label, endpoint_only, start

    def after_create(self, ctx: Ctx, obj, payload: dict) -> None:
        marketing.apply_attribution(ctx.db, obj)
        if self.related_type:
            via = getattr(obj, "source", "") or ""
            timeline.log_activity(ctx.db, related_type=self.related_type, related_id=obj.id, related_name=getattr(obj, "name", ""), type="Created",
                                  subject=f"{self.label.capitalize()} created{f' via {via}' if via else ''}", by=ctx.principal.actor_id, branch=obj.branch)
            owner = getattr(obj, self.owner_attr, None) if self.owner_attr else None
            if owner and owner != ctx.principal.actor_id:
                timeline.notify(ctx.db, user_id=owner, message=f"{getattr(obj, 'name', obj.id)} was assigned to you.", type=f"{self.label.capitalize()} Assignment", related_type=self.related_type, related_id=obj.id, branch=obj.branch)

    def before_create(self, ctx: Ctx, obj, payload: dict) -> None:
        value = getattr(obj, self.field)
        if value not in self.known:
            raise invalid(f"{self.field} must be one of: {', '.join(self.known)}.", {self.field: "Not an allowed value."})
        if value in self.endpoint_only:
            raise invalid(f"A {self.label} cannot be created as {value}.", {self.field: "Use the conversion action."})

    def before_update(self, ctx: Ctx, obj, changes: dict, payload: dict) -> None:
        if self.field not in changes:
            return
        target, current = changes[self.field], getattr(obj, self.field)
        if target not in self.known:
            raise invalid(f"{self.field} must be one of: {', '.join(self.known)}.", {self.field: "Not an allowed value."})
        if target in self.endpoint_only:
            raise invalid(f"Use the conversion action to mark a {self.label} as {target}.", {self.field: "Use the conversion action."})
        if not flows.can_move(self.flow, current, target):
            raise invalid(f"A {self.label} cannot move from {current} to {target}.", {self.field: f"Not allowed from {current}."})
        ctx.state["old_" + self.field] = current

    def after_update(self, ctx: Ctx, obj, changes: dict, payload: dict) -> None:
        marketing.apply_attribution(ctx.db, obj)
        if self.field in changes and "old_" + self.field in ctx.state:
            old = ctx.state["old_" + self.field]
            new = getattr(obj, self.field)
            timeline.log_activity(ctx.db, related_type=self.related_type, related_id=obj.id, related_name=getattr(obj, "name", ""), type="StatusChange", subject=f"{self.field.capitalize()} changed from {old} to {new}",
                                  notes=payload.get("stageNote") or payload.get("statusNote"), by=ctx.principal.actor_id, branch=obj.branch, from_status=old, to_status=new)
        if self.owner_attr and self.owner_attr in {camel_attr(k) for k in changes}:
            owner = getattr(obj, self.owner_attr)
            if owner:
                timeline.log_activity(ctx.db, related_type=self.related_type, related_id=obj.id, related_name=getattr(obj, "name", ""), type="Assignment", subject=f"Assigned to {owner}", by=ctx.principal.actor_id, branch=obj.branch)
                if owner != ctx.principal.actor_id:
                    timeline.notify(ctx.db, user_id=owner, message=f"{getattr(obj, 'name', obj.id)} was assigned to you.", type=f"{self.label.capitalize()} Assignment", related_type=self.related_type, related_id=obj.id, branch=obj.branch)


def camel_attr(key: str) -> str:
    """JSON key -> column attribute name (assignedTo -> assigned_to)."""
    return "".join("_" + c.lower() if c.isupper() else c for c in key)


class LeadHooks(StatusFlowHooks):
    related_type, owner_attr = "Lead", "assigned_to"

    def __init__(self):
        super().__init__("status", flows.LEAD_FLOW, flows.LEAD_STATUSES, "lead", endpoint_only=("Converted",))

    def before_create(self, ctx: Ctx, obj, payload: dict) -> None:
        super().before_create(ctx, obj, payload)
        now = _now()
        obj.captured_at = obj.captured_at or now
        obj.created_date = now.date()
        marketing.check_source(ctx.db, obj)
        lead_sources.check_attribution(ctx.db, ctx.principal, obj)
        lead_sources.stamp_created_via(obj)
        obj.capture_method = obj.capture_method or "Manual"
        if obj.assigned_to:
            obj.assigned_by, obj.assigned_at = ctx.principal.actor_id, now
        obj.score = lead_score(obj)

    def before_update(self, ctx: Ctx, obj, changes: dict, payload: dict) -> None:
        super().before_update(ctx, obj, changes, payload)
        now = _now()
        if "assignedTo" in changes:
            obj.assigned_by, obj.assigned_at = ctx.principal.actor_id, now
        ctx.state["check_source"] = bool({"source", "leadSourceId"} & set(changes))
        ctx.state["source_by_name"] = "source" in changes and "leadSourceId" not in changes
        target = changes.get("status")
        if target in ("Unqualified", "Lost"):  # closing out a lead needs a reason; who and when are the server's
            kind = "unqualified" if target == "Unqualified" else "lost"
            if not str(payload.get(f"{kind}Reason") or getattr(obj, f"{kind}_reason") or "").strip():
                raise invalid("Give a reason.", {f"{kind}Reason": "Required."})
            setattr(obj, f"{kind}_by", ctx.principal.actor_id)
            setattr(obj, f"{kind}_date", now.date())

    def after_update(self, ctx: Ctx, obj, changes: dict, payload: dict) -> None:
        marketing.check_source(ctx.db, obj, changed=ctx.state.get("check_source", False), by_name=ctx.state.get("source_by_name", False))  # before the attribution step below, which trusts the id
        lead_sources.check_attribution(ctx.db, ctx.principal, obj, changes)
        super().after_update(ctx, obj, changes, payload)
        obj.score = lead_score(obj)
        if "qualification" in changes:
            timeline.log_activity(ctx.db, related_type="Lead", related_id=obj.id, related_name=obj.name, type="Qualification", subject="Qualification details captured", by=ctx.principal.actor_id, branch=obj.branch)


class EnquiryHooks(StatusFlowHooks):
    related_type, owner_attr = "Enquiry", "assigned_user"

    def __init__(self):
        super().__init__("status", flows.ENQUIRY_FLOW, flows.ENQUIRY_STATUSES, "enquiry", endpoint_only=("Converted",))

    def before_create(self, ctx: Ctx, obj, payload: dict) -> None:
        super().before_create(ctx, obj, payload)
        now = _now()
        obj.date = obj.date or now.date()
        obj.created_date = now.date()
        marketing.check_source(ctx.db, obj)
        lead_sources.check_attribution(ctx.db, ctx.principal, obj)
        lead_sources.stamp_created_via(obj)
        obj.initials = "".join(part[0] for part in (obj.name or "").split()[:2]).upper()
        if (obj.company or "").strip() and not obj.company_id:  # the company exists in Company Management as soon as an enquiry names it (found by name, never duplicated)
            company, _ = crm_flow.find_or_create_company(ctx.db, ctx.principal, branch=obj.branch or ctx.principal.scope.write, name=obj.company, defaults=dict(
                industry=obj.category or "", contact_person=obj.name, email=obj.email or "", phone=obj.phone or "", city=obj.city or "", address=obj.address or "", billing_address=obj.address or "", shipping_address=obj.address or ""))
            obj.company_id = company.id
        if obj.assigned_user:
            obj.assigned_by, obj.assigned_at = ctx.principal.actor_id, now
            if obj.status == "New":
                obj.status = "Assigned"
        if obj.status in ("Duplicate", "Spam"):  # flagged as such when it was captured: closed in the same breath, by the person who flagged it
            obj.closed_at, obj.closed_by = now, ctx.principal.actor_id
            obj.close_reason = obj.close_reason or ("Flagged as a duplicate at creation." if obj.status == "Duplicate" else "Flagged as spam at creation.")

    CLOSING = ("Duplicate", "Spam", "Not Interested", "Closed", "Unqualified")

    def before_update(self, ctx: Ctx, obj, changes: dict, payload: dict) -> None:
        super().before_update(ctx, obj, changes, payload)
        ctx.state["check_source"] = bool({"source", "leadSourceId"} & set(changes))
        ctx.state["source_by_name"] = "source" in changes and "leadSourceId" not in changes
        if "assignedUser" in changes:
            obj.assigned_by, obj.assigned_at = ctx.principal.actor_id, _now()
            if obj.status == "New" and changes["assignedUser"]:
                changes["status"] = "Assigned"  # the first assignment is a real step in the lifecycle
                ctx.state["old_status"] = "New"
                obj.status = "Assigned"
        target = changes.get("status")
        if target in self.CLOSING:
            if not str(payload.get("closeReason") or obj.close_reason or "").strip():
                raise invalid("Give a reason.", {"closeReason": "Required."})
            obj.closed_at, obj.closed_by = _now(), ctx.principal.actor_id

    def after_update(self, ctx: Ctx, obj, changes: dict, payload: dict) -> None:
        marketing.check_source(ctx.db, obj, changed=ctx.state.get("check_source", False), by_name=ctx.state.get("source_by_name", False))  # before the attribution step below, which trusts the id
        lead_sources.check_attribution(ctx.db, ctx.principal, obj, changes)
        super().after_update(ctx, obj, changes, payload)
        if "qualification" in changes:
            timeline.log_activity(ctx.db, related_type="Enquiry", related_id=obj.id, related_name=obj.name, type="Qualification", subject="Qualification details captured", by=ctx.principal.actor_id, branch=obj.branch)


class DealHooks(StatusFlowHooks):
    """Deal stage: the probability is derived from the stage (never typed), closing stamps who / when, and every move is kept in the stage history."""

    related_type, owner_attr = "Deal", "salesperson"

    def __init__(self):
        super().__init__("stage", flows.DEAL_FLOW, flows.DEAL_STAGES, "deal")

    def before_update(self, ctx: Ctx, obj, changes: dict, payload: dict) -> None:
        super().before_update(ctx, obj, changes, payload)
        target = changes.get("stage")
        if target in flows.LOST_DEAL_STAGES and not (payload.get("lostReason") or obj.lost_reason):
            raise invalid("A lost reason is required before this deal can be closed.", {"lostReason": "Required."})

    def _record(self, ctx: Ctx, obj, note: str) -> None:
        obj.probability = flows.DEAL_PROBABILITY.get(obj.stage, 0)
        history = list((obj.attributes or {}).get("stageHistory") or [])
        history.append({"stage": obj.stage, "changedAt": _now().isoformat().replace("+00:00", "Z"), "changedBy": ctx.principal.actor_id, "note": note})
        obj.attributes = {**(obj.attributes or {}), "stageHistory": history}
        if obj.stage in flows.CLOSED_DEAL_STAGES:
            obj.closed_at, obj.closed_by = _now(), ctx.principal.actor_id

    def after_create(self, ctx: Ctx, obj, payload: dict) -> None:
        super().after_create(ctx, obj, payload)
        self._record(ctx, obj, payload.get("stageNote") or "Deal created.")

    def after_update(self, ctx: Ctx, obj, changes: dict, payload: dict) -> None:
        super().after_update(ctx, obj, changes, payload)
        if "stage" in changes:
            self._record(ctx, obj, payload.get("stageNote") or f"Moved to {obj.stage}.")
            if obj.stage in flows.LOST_DEAL_STAGES:
                obj.lost_date, obj.lost_by = _now().date(), ctx.principal.actor_id
                timeline.notify(ctx.db, user_id=obj.salesperson, message=f"{obj.name} was marked as {obj.stage}.", type="Deal Lost", related_type="Deal", related_id=obj.id, branch=obj.branch)
            if obj.stage == "Closed Won":
                timeline.notify(ctx.db, user_id=obj.salesperson, message=f"{obj.name} was marked as Closed Won.", type="Deal Won", related_type="Deal", related_id=obj.id, branch=obj.branch)
                crm_flow.link_customer_for_won_deal(ctx.db, ctx.principal, obj)


class AttributionHooks(Hooks):
    """Customers: carry the marketing attribution (source / campaign) ids."""

    def after_create(self, ctx: Ctx, obj, payload: dict) -> None:
        marketing.apply_attribution(ctx.db, obj)

    def after_update(self, ctx: Ctx, obj, changes: dict, payload: dict) -> None:
        marketing.apply_attribution(ctx.db, obj)


class SourceHooks(Hooks):
    """Lead sources are managed by people holding the marketing capability."""

    def authorize(self, ctx: Ctx, action: str) -> None:
        if action != "view" and not marketing.perms_of(ctx.principal)["manageSources"]:
            raise forbidden("You do not have permission to manage lead sources.")


class ForbidDirectCreate(Hooks):
    """Records that only exist as the by-product of another action."""

    def __init__(self, message: str):
        self.message = message

    def before_create(self, ctx, obj, payload):
        raise forbidden(self.message)


class TicketHooks(Hooks):
    """A ticket's customer details, due date, service level, conversation and timeline belong to the server, not the browser: the timeline is written here as things change,
    and replies / internal notes arrive only through POST /tickets/{id}/messages."""

    DUE_DAYS = {"Urgent": 1, "High": 2, "Medium": 3, "Low": 5}
    DONE = ("Resolved", "Closed", "Cancelled")
    TRACKED = (("status", "Status changed"), ("priority", "Priority changed"), ("assignedStaff", "Reassigned"))

    @staticmethod
    def sla_of(obj: Ticket, now: datetime) -> str:
        if not obj.due_date:
            return "On Track"
        due = obj.due_date if obj.due_date.tzinfo else obj.due_date.replace(tzinfo=UTC)
        if due < now:
            return "Breached"
        return "Warning" if due - now <= timedelta(hours=8) else "On Track"

    def present(self, ctx: Ctx, obj: Ticket, data: dict) -> dict:
        if obj.status not in self.DONE:  # an open ticket's service level is always read against the clock
            data["slaStatus"] = self.sla_of(obj, _now())
        return data

    def after_update(self, ctx: Ctx, obj: Ticket, changes: dict, payload: dict) -> None:
        now = _now()
        who = ctx.principal.actor_id
        events = []
        for key, label in self.TRACKED:
            if key in changes:
                events.append({"action": label, "by": who, "details": f"{label.split(' ')[0]} → {changes[key] or 'unassigned'}", "date": now.isoformat()})
        if events:
            obj.attributes = {**obj.attributes, "timeline": [*(obj.attributes.get("timeline") or []), *events][-500:]}
        if "status" in changes and obj.status in self.DONE:
            obj.sla_status = self.sla_of(obj, now)  # the service level is frozen at the moment the ticket is closed out

    def before_create(self, ctx: Ctx, obj: Ticket, payload: dict) -> None:
        db = ctx.db
        customer = db.execute(select(Customer).where(Customer.id == obj.customer_id)).scalar_one_or_none() if obj.customer_id else None
        company = db.execute(select(Company).where(Company.id == (obj.company_id or (customer.company_id if customer else None)))).scalar_one_or_none() if (obj.company_id or customer) else None
        contact = db.execute(select(Contact).where(Contact.id == obj.contact_id)).scalar_one_or_none() if obj.contact_id else None
        if customer is not None:
            obj.customer_name = customer.name
        if company is not None:
            obj.company_id, obj.company_name = company.id, company.name
        if contact is not None:
            obj.contact_name = contact.name
            obj.contact_phone = obj.contact_phone or contact.phone or (customer.phone if customer else "") or ""
            obj.contact_email = obj.contact_email or contact.email or (customer.email if customer else "") or ""
        if obj.status not in ("New", "Open", "Assigned"):
            raise invalid("A ticket starts as New.", {"status": "Not an allowed value."})
        today = _now()
        obj.due_date = obj.due_date or today + timedelta(days=self.DUE_DAYS.get(obj.priority, 3))
        obj.sla_status = "On Track"
        obj.created_date = today.date()
        obj.updated_date = today.date()
        obj.attributes = {**obj.attributes, "createdBy": ctx.principal.actor_id, "timeline": [{"action": "Ticket Created", "by": ctx.principal.actor_id, "date": today.isoformat()}]}

    def before_update(self, ctx: Ctx, obj: Ticket, changes: dict, payload: dict) -> None:
        obj.updated_date = _now().date()


class ProductHooks(Hooks):
    """The catalogue keeps the history of a price: who set it, when, and what it was before - written here, never by the browser. Its category must be one of the configured ones, a rename is
    carried to the records that point at it, and a product that anything uses cannot be deleted (see services/catalogue.py)."""

    def before_create(self, ctx: Ctx, obj: Product, payload: dict) -> None:
        catalogue.check_category(ctx.db, obj.category)
        obj.attributes = {**obj.attributes, "priceHistory": [{"price": float(obj.price or 0), "at": _now().isoformat(), "by": ctx.principal.actor_id, "note": "Opening price"}]}

    def before_update(self, ctx: Ctx, obj: Product, changes: dict, payload: dict) -> None:
        if "category" in changes and changes["category"] != obj.category:
            catalogue.check_category(ctx.db, changes["category"])
        if "name" in changes and str(changes["name"]).strip() != obj.name:
            ctx.state["old_name"] = obj.name
        if "price" in changes and float(changes["price"] or 0) != float(obj.price or 0):
            ctx.state["old_price"] = float(obj.price or 0)

    def before_delete(self, ctx: Ctx, obj: Product) -> None:
        catalogue.guard_delete(ctx.db, obj)

    def after_update(self, ctx: Ctx, obj: Product, changes: dict, payload: dict) -> None:
        if "old_name" in ctx.state and ctx.state["old_name"] != obj.name:
            catalogue.carry_rename(ctx.db, obj, ctx.state["old_name"])
        if "old_price" in ctx.state:
            note = f"Changed from ₹{ctx.state['old_price']:,.2f}"
            obj.attributes = {**obj.attributes, "priceHistory": [*obj.attributes.get("priceHistory", []), {"price": float(obj.price or 0), "at": _now().isoformat(), "by": ctx.principal.actor_id, "note": note}]}


PRODUCT_PICKERS = ("Leads", "Enquiries", "Deals", "Quotations", "Sales Orders", "Proposals", "Invoices", "Projects", "Campaigns", "Contracts", "Tickets")


def product_scope(p):
    """The catalogue is organisation-wide, and everyone who picks a product or service anywhere (lead, enquiry, deal, quotation ...) has to be able to LIST it even without the Products &
    Services screen: otherwise their pickers would silently be empty. Changing it still needs the Products & Services permissions (the router checks create / edit / delete)."""
    return None if p.can("Products & Services", "view") or any(p.can(m, "view") for m in PRODUCT_PICKERS) else false()


MONEY_NOT_NEGATIVE = ("amount", "value", "budget", "price")

SPECS: list[ModuleSpec] = [
    ModuleSpec("companies", Company, "Companies", "CMP", 4, required=("name",), search=("name", "email", "phone", "city", "industry", "contactPerson"),
               enums={"status": ("Active", "Inactive", "Prospect")}, unique=((("branch", "name"), "A company with this name already exists in this branch."),)),
    ModuleSpec("contacts", Contact, "Contacts", "CT", 4, required=("name",), search=("name", "email", "phone", "companyName", "designation")),
    ModuleSpec("customers", Customer, "Customers", "CUS", 4, required=("name",), search=("name", "email", "phone", "contactPerson", "industry"),
               enums={"status": ("Active", "Inactive")}, hooks=AttributionHooks()),
    ModuleSpec("leads", Lead, "Leads", "LD", 4, required=("name",), search=("name", "company", "email", "phone", "service", "source"),
               enums={"priority": flows.PRIORITIES}, hooks=LeadHooks(), protected=frozenset({"convertedAt", "convertedBy", "dealId", "score", "assignedBy", "assignedAt", "createdDate", "capturedAt", "unqualifiedBy", "unqualifiedDate", "lostBy", "lostDate", "sourceCategory", "createdVia"})),
    ModuleSpec("enquiries", Enquiry, "Enquiries", "ENQ", 6, required=("name",), search=("name", "company", "email", "phone", "interestedProduct", "city", "source"),
               enums={"priority": flows.ENQUIRY_PRIORITIES}, hooks=EnquiryHooks(), protected=frozenset({"convertedLeadId", "convertedAt", "convertedBy", "assignedBy", "assignedAt", "createdDate", "closedAt", "closedBy", "initials", "sourceCategory", "createdVia"})),
    ModuleSpec("deals", Deal, "Deals", "DL", 4, required=("name",), search=("name", "companyName", "contactName", "service"),
               enums={"priority": flows.PRIORITIES}, hooks=DealHooks(), protected=frozenset({"probability", "closedAt", "closedBy"})),
    ModuleSpec("products", Product, "Products & Services", "PRD", 4, required=("name",), search=("name", "code", "category", "type", "description"), unique=((("code",), "Another product already uses this item code."),),
               enums={"status": ("Active", "Inactive")}, hooks=ProductHooks(), protected=frozenset({"priceHistory", "createdAt", "updatedAt"}), open_actions=("view",), row_filter=product_scope),
    ModuleSpec("leadSources", LeadSource, "Lead Sources", "LS", 3, required=("name",), search=("name", "category", "sourceType"),
               unique=((("name",), "A lead source with this name already exists."),), hooks=SourceHooks()),
    ModuleSpec("campaigns", Campaign, "Campaigns", "CMPG", 4, number_prefix="CMP", required=("name",), search=("name", "number", "type", "channel"),
               enums={"status": ("Draft", "Planned", "Scheduled", "Active", "Paused", "Completed", "Cancelled")}),
    ModuleSpec("quotations", Quotation, "Quotations", "QT", 4, number_prefix="QUO", search=("number", "customerName", "contactName", "requirement"),
               enums={"status": ("Draft", "Pending Approval", "Sent", "Viewed", "Negotiation", "Accepted", "Rejected", "Expired")}, hooks=sales_docs.QuotationHooks(),
               protected=frozenset({"attachments", "attachmentId", "sends", "sentAt", "salesOrderId", "proposalId", "proposalNumber", "proposalVersion"})),
    ModuleSpec("salesOrders", SalesOrder, "Sales Orders", "SO", 4, number_prefix="SO", search=("number", "customerName", "companyName", "quotationNumber"),
               enums={"status": ("Draft", "Confirmed", "Processing", "Partially Fulfilled", "Fulfilled", "Cancelled")}, hooks=sales_docs.SalesOrderHooks()),
    ModuleSpec("proposals", Proposal, "Proposals", "PRO", 4, number_prefix="PRP", search=("number", "title", "customerName", "service"),
               enums={"status": ("Draft", "Internal Review", "Sent", "Viewed", "Revision Requested", "Accepted", "Rejected", "Expired")}, hooks=sales_docs.ProposalHooks()),
    ModuleSpec("projects", Project, "Projects", "PRJ", 4, required=("name",), search=("name", "customerName", "projectType", "description"),
               enums={"status": ("Planned", "Active", "On Hold", "Completed", "Cancelled"), "priority": flows.PRIORITIES}, hooks=operations.ProjectHooks(), row_filter=operations.project_scope),
    ModuleSpec("contracts", Contract, "Contracts", "CON", 4, number_prefix="CNT", search=("number", "title", "customerName", "contractType"),
               enums={"status": ("Draft", "Internal Review", "Pending Approval", "Approved", "Sent", "Signed", "Active", "Expiring Soon", "Expired", "Renewed", "Terminated", "Cancelled")}, hooks=operations.ContractHooks(),
               protected=frozenset({"signedAt", "renewedFromId", "renewedToId", "audit", "approval", "sentAt", "sentBy", "sentVia", "signedRecordedBy", "activatedAt", "terminatedAt", "terminationReason",
                                    "cancelledAt", "cancelReason", "renewedAt", "createdBy", "createdAt", "updatedAt", "auditEntry", "statusReason", "reason", "comments", "date", "method", "allowDuplicate"})),
    ModuleSpec("invoices", Invoice, "Invoices", "INV", 4, number_prefix="INV", search=("number", "customerName", "companyName", "contactName"),
               enums={"status": ("Draft", "Sent", "Viewed", "Partially Paid", "Paid", "Overdue", "Cancelled", "Void")}, hooks=billing.InvoiceHooks(), row_filter=billing.invoice_scope),
    ModuleSpec("payments", Payment, "Payments", "PAY", 4, number_prefix="PAY", search=("number", "invoiceNumber", "customerName", "reference"),
               enums={"status": ("Completed", "Pending", "Failed", "Cancelled", "Refunded", "Partially Refunded")}, hooks=billing.PaymentHooks(), row_filter=billing.payment_scope),
    ModuleSpec("vendors", Vendor, "Expenses", "VND", 3, required=("name",), search=("name", "contactName", "email"), unique=((("name",), "A vendor with this name already exists."),), hooks=expenses.CatalogHooks("manageVendors"), open_actions=("view",)),
    ModuleSpec("expenseCategories", ExpenseCategory, "Expenses", "EXC", 3, required=("name",), search=("name",), unique=((("name",), "A category with this name already exists."),), hooks=expenses.CatalogHooks("manageCategories")),
    ModuleSpec("tickets", Ticket, "Helpdesk / Tickets", "TK", 4, required=("subject",), search=("subject", "customerName", "contactName", "category"),
               enums={"status": ("New", "Open", "Assigned", "In Progress", "Waiting for Customer", "Resolved", "Closed", "Reopened", "Cancelled"), "priority": flows.PRIORITIES}, hooks=TicketHooks(),
               protected=frozenset({"slaStatus", "createdBy", "timeline", "messages", "internalNotes", "createdDate", "updatedDate"})),
]

class NotificationHooks(ForbidDirectCreate):
    """Notifications are written by the server for a person; a person may only read their own and mark them read."""

    def __init__(self):
        super().__init__("Notifications are created by the CRM itself.")

    def before_update(self, ctx: Ctx, obj, changes: dict, payload: dict) -> None:
        if set(changes) - {"read"}:
            raise forbidden("Only the read state of a notification can be changed.")


SPECS += [
    ModuleSpec("activities", Activity, "Activities", "ACT", 5, search=("subject", "relatedName", "notes", "type"), hooks=ActivityHooks(), protected=frozenset({"by", "source"}), default_sort="created_at"),
    ModuleSpec("notifications", Notification, "Notifications", "NTF", 5, search=("message", "type"), hooks=NotificationHooks(), open_actions=("view", "edit"),
               row_filter=lambda p: (Notification.user_id == p.actor_id) | Notification.user_id.is_(None)),
]

class TemplateHooks(Hooks):
    """Quotation / proposal layouts shared by the organisation: one table, told apart by `kind`; at most one default per kind."""

    def __init__(self, kind: str):
        self.kind = kind

    MANAGERS = ("MD", "Sales Manager")

    def authorize(self, ctx: Ctx, action: str) -> None:
        p = ctx.principal
        if action != "view" and p.level not in ("Super Admin", "Admin") and p.user.job_role not in self.MANAGERS:
            raise forbidden(f"Only an administrator, the MD or a sales manager can manage {self.kind} templates.")

    def before_create(self, ctx: Ctx, obj, payload: dict) -> None:
        obj.kind = self.kind
        if obj.content is None:
            obj.content = {}
        obj.attributes = {**obj.attributes, "uploadedBy": ctx.principal.actor_id, "uploadedByName": ctx.principal.name, "uploadedAt": _now().isoformat()}

    def before_update(self, ctx: Ctx, obj, changes: dict, payload: dict) -> None:
        obj.kind = self.kind  # a template never changes kind

    def _single_default(self, ctx: Ctx, obj) -> None:
        if obj.is_default:
            for other in ctx.db.execute(select(DocumentTemplate).where(DocumentTemplate.kind == self.kind, DocumentTemplate.id != obj.id, DocumentTemplate.is_default.is_(True))).scalars():
                other.is_default = False

    def after_create(self, ctx: Ctx, obj, payload: dict) -> None:
        self._single_default(ctx, obj)

    def after_update(self, ctx: Ctx, obj, changes: dict, payload: dict) -> None:
        self._single_default(ctx, obj)


class ContractTemplateHooks(TemplateHooks):
    """Contract wording is managed by administrators and sales managers."""

    def authorize(self, ctx: Ctx, action: str) -> None:
        p = ctx.principal
        if p.level not in ("Super Admin", "Admin") and p.user.job_role != "Sales Manager":
            raise forbidden("Only an administrator or a sales manager can manage contract templates.")


SPECS += [
    ModuleSpec("contractTemplates", DocumentTemplate, "Contracts", "CTPL", 3, required=("name",), search=("name",), hooks=ContractTemplateHooks("contract"), protected=frozenset({"kind"}), client_ids=True,
               row_filter=lambda p: DocumentTemplate.kind == "contract"),
    ModuleSpec("quotationTemplates", DocumentTemplate, "Quotations", "QTP", 3, required=("name",), search=("name",), hooks=TemplateHooks("quotation"), protected=frozenset({"kind", "uploadedBy", "uploadedByName", "uploadedAt"}),
               row_filter=lambda p: DocumentTemplate.kind == "quotation"),
    ModuleSpec("proposalTemplates", DocumentTemplate, "Proposals", "PTP", 3, required=("name",), search=("name",), hooks=TemplateHooks("proposal"), protected=frozenset({"kind", "uploadedBy", "uploadedByName", "uploadedAt"}),
               row_filter=lambda p: DocumentTemplate.kind == "proposal"),
]

# record-level data scope (Own / Team): the caller only reaches the records they own, created, or - for a team scope - that someone in their department owns
SCOPED_OWNERS = {"companies": ("Companies", "assigned_to"), "contacts": ("Contacts", "assigned_to"), "customers": ("Customers", "account_manager"), "leads": ("Leads", "assigned_to"),
                 "enquiries": ("Enquiries", "assigned_user"), "deals": ("Deals", "salesperson"), "quotations": ("Quotations", "assigned_to"), "proposals": ("Proposals", "assigned_to"),
                 "tickets": ("Tickets", "assigned_staff")}


def _scoped_filter(module: str, model, owner_attr: str):
    return lambda p: data_scope.owner_filter(p, module, getattr(model, owner_attr), model.created_by)


for _spec in SPECS:
    if _spec.key in SCOPED_OWNERS and _spec.row_filter is None:
        _spec.row_filter = _scoped_filter(*SCOPED_OWNERS[_spec.key][:1], _spec.model, SCOPED_OWNERS[_spec.key][1])

SPEC_BY_KEY = {spec.key: spec for spec in SPECS}
