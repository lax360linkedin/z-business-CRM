"""End-to-end check of the sign-in + employee-management workflow against a RUNNING API (and so against the database behind it).

    python -m scripts.e2e_employee_flow http://127.0.0.1:8010 <super-admin-email> <super-admin-password>

What it does (every step is a real HTTP call; nothing is mocked):
  1. the Super Admin signs in (a wrong password is refused first);
  2. opens employee management: lists employees, departments, role templates;
  3. adds two employees with a role and a permission set and creates their login credentials;
  4. each new employee signs in with the credentials just created (and is forced to change the temporary password);
  5. each employee can reach only the modules their role / permissions allow - and is refused (403) everywhere else, including the admin-only screens;
  6. the Super Admin edits one employee's permissions and the change takes effect on that employee's next request;
  7. a deactivated employee can no longer sign in.

It creates records. Point it ONLY at a throw-away database / scratch schema (it prints the names of what it created). Passwords are never printed.
"""
import secrets
import sys

import httpx

PASSWORD_OK = "Aa1!" + secrets.token_urlsafe(8)  # meets the policy; generated per run, never printed


def main(base: str, email: str, password: str) -> int:
    api = httpx.Client(base_url=f"{base.rstrip('/')}/api/v1", timeout=90)
    failures: list[str] = []

    def check(label: str, ok: bool, detail: str = "") -> bool:
        print(("PASS " if ok else "FAIL ") + label + (f"  [{detail}]" if detail and not ok else ""))
        if not ok:
            failures.append(label)
        return ok

    def login(identifier: str, pw: str):
        return api.post("/auth/login", json={"identifier": identifier, "password": pw})

    def bearer(resp) -> dict:
        return {"Authorization": "Bearer " + resp.json()["tokens"]["accessToken"]}

    # 1 - Super Admin sign-in
    check("wrong password is refused", login(email, "Not-the-password-1!").status_code == 401)
    r = login(email, password)
    if not check("Super Admin signs in with the configured credentials", r.status_code == 200, f"{r.status_code}"):
        return 1
    if r.json()["user"].get("forcePasswordChange"):  # the bootstrap password must be replaced before anything else
        new_pw = PASSWORD_OK + "x"
        c = api.post("/auth/change-password", headers=bearer(r), json={"currentPassword": password, "newPassword": new_pw})
        check("bootstrap password can be replaced at first sign-in", c.status_code == 200, f"{c.status_code}")
        password = new_pw
        r = login(email, password)
    sa = {**bearer(r), "X-Branch-Scope": "Salem"}
    check("signed-in user is the Super Admin", r.json()["user"]["accessLevel"] == "Super Admin")

    # 2 - employee management is open to the Super Admin
    check("employee list opens", api.get("/employees", headers=sa, params={"all": "true"}).status_code == 200)
    check("departments list opens", api.get("/departments", headers=sa, params={"all": "true"}).status_code == 200)
    templates = api.get("/userAccounts/permission-templates", headers=sa)
    check("role / permission templates load", templates.status_code == 200 and bool(templates.json()))

    # 3 - add employees with roles + permissions + login credentials
    tag = secrets.token_hex(3)
    sales_user, limited_user = f"e2e.sales.{tag}", f"e2e.limited.{tag}"
    made = api.post("/userAccounts", headers=sa, json={"firstName": "E2E", "lastName": "Sales", "email": f"{sales_user}@example.com", "username": sales_user, "password": PASSWORD_OK, "accessLevel": "Employee",
                                                        "role": "Sales Executive", "branch": "Salem", "department": "Sales", "forcePasswordChange": True})
    check("employee with the Sales Executive role is created", made.status_code == 201, f"{made.status_code} {made.text[:120]}")
    limited = api.post("/userAccounts", headers=sa, json={"firstName": "E2E", "lastName": "Limited", "email": f"{limited_user}@example.com", "username": limited_user, "password": PASSWORD_OK,
                                                           "accessLevel": "Employee", "role": "Employee", "branch": "Salem", "department": "Sales", "forcePasswordChange": False,
                                                           "permissions": {"Leads": {"view": True, "create": True}}})
    check("employee with a custom 'Leads: view + create only' permission set is created", limited.status_code == 201, f"{limited.status_code} {limited.text[:120]}")
    check("weak credentials are refused for a new employee", api.post("/userAccounts", headers=sa, json={"firstName": "Weak", "email": f"weak.{tag}@example.com", "username": f"weak.{tag}", "password": "abc",
                                                                                                     "accessLevel": "Employee", "branch": "Salem", "department": "Sales"}).status_code == 422)
    check("a duplicate username is refused", api.post("/userAccounts", headers=sa, json={"firstName": "Dup", "email": f"dup.{tag}@example.com", "username": sales_user, "password": PASSWORD_OK,
                                                                                         "accessLevel": "Employee", "branch": "Salem", "department": "Sales"}).status_code == 409)
    employees = api.get("/employees", headers=sa, params={"all": "true"}).json()
    check("the new employees appear in the employee directory", {f"E2E Sales", "E2E Limited"} <= {e.get("fullName") for e in employees})

    # 4 - the employees sign in with the credentials just created
    s = login(sales_user, PASSWORD_OK)
    check("Sales Executive signs in with the new credentials", s.status_code == 200, f"{s.status_code}")
    check("a temporary password forces a change at first sign-in", s.status_code == 200 and s.json()["user"].get("forcePasswordChange") is True)
    lim = login(limited_user, PASSWORD_OK)
    check("limited employee signs in with the new credentials", lim.status_code == 200, f"{lim.status_code}")
    if s.status_code != 200 or lim.status_code != 200:
        return 1
    sales_h, lim_h = bearer(s), bearer(lim)

    # 5 - access is limited to what the role / permissions allow
    check("Sales Executive can open Leads", api.get("/leads", headers=sales_h).status_code == 200)
    check("Sales Executive can create a lead", api.post("/leads", headers=sales_h, json={"name": f"E2E lead {tag}", "company": "E2E Co"}).status_code == 201)
    for path in ("/userAccounts", "/roles", "/branches", "/invoices", "/payments"):
        check(f"Sales Executive is refused {path}", api.get(path, headers=sales_h).status_code == 403)
    own = api.get("/expenses", headers=sales_h)  # every employee raises their own expense claims - and sees nobody else's
    check("Sales Executive sees only their own expense claims", own.status_code == 200 and own.json()["total"] == 0)
    check("limited employee can open Leads", api.get("/leads", headers=lim_h).status_code == 200)
    check("limited employee can create a lead", api.post("/leads", headers=lim_h, json={"name": f"E2E limited lead {tag}"}).status_code == 201)
    check("limited employee cannot change a lead (no edit permission)", api.put("/leads/LD-0000", headers=lim_h, json={"notes": "x"}).status_code in (403, 404))
    for path in ("/deals", "/customers", "/quotations", "/userAccounts", "/roles", "/invoices", "/tasks/settings"):
        check(f"limited employee is refused {path}", api.get(path, headers=lim_h).status_code == 403)
    check("an employee cannot create another employee", api.post("/userAccounts", headers=lim_h, json={"firstName": "X"}).status_code == 403)
    check("an employee cannot read the Super Admin's account list", api.get("/userAccounts", headers=sales_h).status_code == 403)
    check("requests without a token are refused", api.get("/leads").status_code == 401)

    # 6 - the Super Admin changes permissions; they apply on the next request
    lim_id = limited.json()["id"]
    upd = api.put(f"/userAccounts/{lim_id}", headers=sa, json={"permissions": {"Leads": {"view": True, "create": True}, "Deals": {"view": True}}})
    check("Super Admin edits the employee's permissions", upd.status_code == 200, f"{upd.status_code} {upd.text[:100]}")
    check("the new permission takes effect on the employee's next request", api.get("/deals", headers=lim_h).status_code == 200)
    check("a permission that was not granted is still refused", api.get("/customers", headers=lim_h).status_code == 403)

    # 7 - deactivation ends access
    off = api.put(f"/userAccounts/{lim_id}", headers=sa, json={"status": "Inactive"})
    check("Super Admin deactivates the employee", off.status_code == 200, f"{off.status_code}")
    check("a deactivated employee cannot sign in", login(limited_user, PASSWORD_OK).status_code in (401, 403))
    check("and the existing session stops working", api.get("/leads", headers=lim_h).status_code in (401, 403))

    print(f"\ncreated for this run (delete them if the database is not throw-away): {sales_user}, {limited_user}")
    print("RESULT:", "ALL PASSED" if not failures else f"{len(failures)} FAILED -> " + "; ".join(failures))
    return 0 if not failures else 1


if __name__ == "__main__":
    if len(sys.argv) != 4:
        print(__doc__)
        sys.exit(2)
    sys.exit(main(*sys.argv[1:4]))
