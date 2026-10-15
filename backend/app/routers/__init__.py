"""Assembles every router. Order matters: modules with their own extra endpoints are mounted BEFORE the generic CRUD routers so that
paths such as /invoices/engine/run are not swallowed by /invoices/{record_id}."""
from fastapi import APIRouter

from app.routers import accounts, activities, auth, billing, catalogue, crm, documents, expenses, finance_extras, helpdesk, marketing, misc, operations, options, org, roles, sales, tasks
from app.routers.records import make_router
from app.services import modules
from app.services.org import DEPARTMENT_SPEC, EMPLOYEE_SPEC, TEAM_SPEC

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(accounts.router)
api_router.include_router(org.router)
api_router.include_router(roles.router)

# module-specific routers (workflows, actions) are added here, ahead of the generic CRUD routers
EXTRA_ROUTERS: list[APIRouter] = [options.router, catalogue.router, finance_extras.router, crm.router, tasks.router, activities.router, billing.router, sales.router, operations.router, expenses.router, documents.router, marketing.router, helpdesk.router, misc.router]
for extra in EXTRA_ROUTERS:
    api_router.include_router(extra)

for spec in [EMPLOYEE_SPEC, DEPARTMENT_SPEC, TEAM_SPEC, *modules.SPECS]:
    api_router.include_router(make_router(spec))
