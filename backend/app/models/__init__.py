"""Importing this package registers every table on Base.metadata (Alembic and the engine both rely on that)."""
from app.models import columns  # noqa: F401
from app.models.crm import Company, Contact, Customer, Deal, Enquiry, Lead, LeadSource, LeadSourceIntegration, Product
from app.models.finance import Expense, ExpenseCategory, Invoice, Payment, Vendor
from app.models.identity import AuthSession, Branch, Department, Employee, PasswordReset, Team, User
from app.models.marketing import Campaign
from app.models.ops import Contract, Document, DocumentAudit, DocumentFolder, DocumentShare, DocumentVersion, Project
from app.models.sales import DocumentTemplate, Proposal, Quotation, SalesOrder
from app.models.system import AppSetting, AuditLog, Counter, Notification, StoredFile
from app.models.work import Activity, SavedFilter, Task, TaskEvent, TaskPerson, Ticket

__all__ = [
    "Activity", "AppSetting", "AuditLog", "AuthSession", "Branch", "Campaign", "Company", "Contact", "Contract", "Counter", "Customer", "Deal", "Department", "Document", "DocumentAudit", "DocumentFolder", "DocumentShare", "DocumentVersion",
    "DocumentTemplate", "Employee", "Enquiry", "Expense", "ExpenseCategory", "Invoice", "Lead", "LeadSource", "LeadSourceIntegration", "Notification", "PasswordReset", "Payment", "Product", "Project", "Proposal",
    "Quotation", "SalesOrder", "SavedFilter", "StoredFile", "Task", "TaskEvent", "TaskPerson", "Team", "Ticket", "User", "Vendor",
]
