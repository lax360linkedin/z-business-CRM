"""Spreadsheet imports: the schema the Excel template is built from, row-by-row checking without writing, import with a per-row result, duplicates, branch isolation and permissions."""
from tests.conftest import PASSWORD, headers_of, login, make_account, perms

API = "/api/v1"


def in_salem(sa):
    return {**sa, "X-Branch-Scope": "Salem"}


def preview(client, headers, module, rows):
    return client.post(f"{API}/imports/{module}/preview", json={"rows": rows}, headers=headers)


def commit(client, headers, module, rows):
    return client.post(f"{API}/imports/{module}/commit", json={"rows": rows}, headers=headers)


def schema(client, headers, module):
    r = client.get(f"{API}/imports/{module}/schema", headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


# ---- schema -------------------------------------------------------------------------------------------------------------------------------
def test_the_schema_describes_the_real_columns_and_live_allowed_values(client, sa):
    s = schema(client, in_salem(sa), "leads")
    cols = {c["key"]: c for c in s["columns"]}
    assert cols["name"]["required"] is True and [k for k, c in cols.items() if c["required"]] == ["name"]
    assert cols["priority"]["options"] == ["Low", "Medium", "High", "Urgent"] and cols["priority"]["kind"] == "choice"
    assert "Website Enquiry Form" in cols["source"]["options"] and "Import" in cols["source"]["options"]
    assert cols["budget"]["kind"] == "number" and cols["nextFollowUp"]["kind"] == "date" and cols["email"]["kind"] == "email"
    assert s["blocked"] is None and s["maxRows"] == 500 and s["mode"] == "partial" and any("New" in n for n in s["notes"])
    enq = {c["key"]: c for c in schema(client, in_salem(sa), "enquiries")["columns"]}
    assert enq["priority"]["options"] == ["Critical", "High", "Medium", "Low"] and "General Enquiry" in enq["enquiryType"]["options"]
    emp = schema(client, sa, "employees")
    cols = {c["key"]: c for c in emp["columns"]}
    assert cols["branch"]["required"] is True and set(cols["branch"]["options"]) >= {"Salem", "Mumbai"}  # the Super Admin must name a branch on every row
    assert cols["department"]["required"] and cols["department"]["options"] and cols["status"]["options"] == ["Active", "Probation", "On Leave", "Remote"]
    assert cols["workLocation"]["options"] == ["Office", "Remote", "Hybrid"] and emp["mode"] == "atomic"


def test_the_super_admin_must_choose_a_branch_before_importing_leads(client, sa):
    assert "branch" in (schema(client, sa, "leads")["blocked"] or "").lower()
    assert commit(client, sa, "leads", [{"name": "No branch"}]).status_code == 422
    assert schema(client, in_salem(sa), "leads")["blocked"] is None


def test_only_people_who_may_create_can_import(client, sa):
    make_account(client, sa, first="View", last="Only", username="view.only", permissions={"Leads": {"view": True}})
    h = headers_of(login(client, "view.only"))
    assert client.get(f"{API}/imports/leads/schema", headers=h).status_code == 403
    assert preview(client, h, "leads", [{"name": "x"}]).status_code == 403
    assert commit(client, h, "leads", [{"name": "x"}]).status_code == 403
    assert client.get(f"{API}/imports/leads/schema").status_code == 401
    assert client.get(f"{API}/imports/deals/schema", headers=sa).status_code == 404  # modules without an import have none


# ---- checking rows ------------------------------------------------------------------------------------------------------------------------
def test_every_kind_of_problem_is_named_per_row(client, sa):
    h = in_salem(sa)
    rows = [
        {"name": "Good Lead", "email": "good@example.com", "phone": "9876543210", "source": "website enquiry form", "priority": "high", "budget": "₹1,50,000", "nextFollowUp": "15/12/2026", "_row": 2},
        {"name": "", "_row": 3},
        {"name": "Bad Email", "email": "not-an-email", "_row": 4},
        {"name": "Bad Phone", "phone": "abc", "_row": 5},
        {"name": "Bad Priority", "priority": "Extreme", "_row": 6},
        {"name": "Bad Source", "source": "Smoke Signals", "_row": 7},
        {"name": "Bad Date", "nextFollowUp": "31/02/2026", "_row": 8},
        {"name": "Bad Budget", "budget": "lots", "_row": 9},
        {"name": "Bad Owner", "assignedTo": "Nobody Atall", "_row": 10},
        {"name": "Too long", "company": "x" * 201, "_row": 11},
    ]
    body = preview(client, h, "leads", rows).json()
    assert body["total"] == 10 and body["valid"] == 1 and body["invalid"] == 9
    by_row = {r["row"]: r["errors"] for r in body["rows"]}
    assert by_row[2] == []
    assert "Contact Name is required" in by_row[3]
    assert any("email" in e.lower() for e in by_row[4]) and any("phone" in e.lower() for e in by_row[5])
    assert any("Priority" in e and "Low" in e for e in by_row[6]) and len([e for e in by_row[7] if "Source" in e]) == 1
    assert any("valid date" in e for e in by_row[8]) and any("not a number" in e for e in by_row[9])
    assert any("Assigned To" in e and "not found" in e for e in by_row[10]) and any("too long" in e for e in by_row[11])


def test_duplicates_inside_the_file_and_against_existing_records_are_reported(client, sa):
    h = in_salem(sa)
    first = commit(client, h, "leads", [{"name": "Original", "email": "dup@example.com", "phone": "98400 11111"}])
    assert first.status_code == 200 and first.json()["count"] == 1
    body = preview(client, h, "leads", [
        {"name": "Same Email", "email": "DUP@example.com"},
        {"name": "Same Phone", "phone": "+91 98400-11111"},
        {"name": "Fresh A", "email": "fresh@example.com"},
        {"name": "Fresh B", "email": "fresh@example.com"},
    ]).json()
    errors = [r["errors"] for r in body["rows"]]
    assert "already has the email" in errors[0][0] and "LD-" in errors[0][0]
    assert "already has this phone" in errors[1][0]
    assert errors[2] == [] and "row 4 of this file" in errors[3][0]
    assert body["valid"] == 1 and body["invalid"] == 3


def test_duplicate_checks_stay_inside_the_branch(client, sa):
    commit(client, {**sa, "X-Branch-Scope": "Mumbai"}, "leads", [{"name": "Mumbai person", "email": "shared@example.com"}])
    body = preview(client, in_salem(sa), "leads", [{"name": "Salem person", "email": "shared@example.com"}]).json()
    assert body["valid"] == 1  # another branch's records are invisible, so they never block this one


# ---- importing ----------------------------------------------------------------------------------------------------------------------------
def test_importing_leads_creates_real_records_and_reports_the_rest(client, sa):
    h = in_salem(sa)
    staff = make_account(client, sa, first="Asha", last="Owner", username="asha.owner", role="Sales Executive", permissions=perms(Leads=True))
    rows = [
        {"name": "Meera Iyer", "company": "Iyer Textiles", "email": "meera@iyer.in", "phone": "9840012345", "source": "referral", "priority": "high", "budget": "250,000", "assignedTo": staff["employeeId"],
         "expectedPurchaseDate": "2026-12-15", "nextFollowUp": "03/11/2026", "_row": 2},
        {"name": "Plain Lead", "_row": 3},
        {"name": "Broken Lead", "email": "nope", "_row": 4},
    ]
    done = commit(client, h, "leads", rows)
    assert done.status_code == 200, done.text
    body = done.json()
    assert body["count"] == 2 and [c["row"] for c in body["created"]] == [2, 3] and body["failed"] == [{"row": 4, "errors": [body["failed"][0]["errors"][0]]}] and "email" in body["failed"][0]["errors"][0].lower()
    lead = client.get(f"{API}/leads/{body['created'][0]['id']}", headers=h).json()
    assert lead["name"] == "Meera Iyer" and lead["source"] == "Customer Referral" and lead["priority"] == "High" and lead["budget"] == 250000 and lead["status"] == "New"
    assert lead["createdVia"] == "Import" and lead["assignedTo"] == staff["employeeId"] and lead["nextFollowUp"] == "2026-11-03" and lead["expectedPurchaseDate"] == "2026-12-15" and lead["branch"] == "Salem" and lead["captureMethod"] == "Import"
    plain = client.get(f"{API}/leads/{body['created'][1]['id']}", headers=h).json()
    assert plain["source"] == "Import" and plain["priority"] == "Medium" and not plain["assignedTo"]  # empty cells take the stated defaults; no hidden owner
    assert preview(client, h, "leads", [rows[0]]).json()["rows"][0]["errors"][0].startswith("Duplicate")  # importing the same file again creates nothing new
    again = commit(client, h, "leads", [rows[0]]).json()
    assert again["count"] == 0 and again["failed"][0]["errors"][0].startswith("Duplicate")


def test_importing_enquiries_follows_the_enquiry_rules(client, sa):
    h = in_salem(sa)
    staff = make_account(client, sa, first="Sam", last="Owner", username="sam.owner", role="Sales Executive", permissions=perms(Enquiries=True))
    rows = [{"name": "Kavitha Menon", "company": "Menon Foods", "email": "kavitha@menon.in", "city": "Coimbatore", "enquiryType": "service enquiry", "priority": "critical", "assignedUser": staff["employeeId"],
             "interestedService": "AI Chatbots", "preferredContactMethod": "whatsapp", "_row": 2},
            {"name": "Quick One", "_row": 3}, {"name": "Bad Priority", "priority": "Urgent", "_row": 4}]
    pv = preview(client, h, "enquiries", rows).json()
    assert pv["valid"] == 2 and any("Priority" in e for e in pv["rows"][2]["errors"])  # Urgent is a lead priority, not an enquiry priority
    body = commit(client, h, "enquiries", rows).json()
    assert body["count"] == 2 and len(body["failed"]) == 1
    e1 = client.get(f"{API}/enquiries/{body['created'][0]['id']}", headers=h).json()
    assert e1["status"] == "Assigned" and e1["priority"] == "Critical" and e1["enquiryType"] == "Service Enquiry" and e1["preferredContactMethod"] == "WhatsApp" and e1["branch"] == "Salem"
    e2 = client.get(f"{API}/enquiries/{body['created'][1]['id']}", headers=h).json()
    assert e2["status"] == "New" and e2["source"] == "Import" and e2["enquiryType"] == "General Enquiry" and e2["country"] == "India"


def test_a_branch_user_imports_into_their_own_branch_only(client, sa, salem_admin):
    body = commit(client, salem_admin, "leads", [{"name": "Priya's lead"}]).json()
    assert body["count"] == 1
    lead = client.get(f"{API}/leads/{body['created'][0]['id']}", headers=salem_admin).json()
    assert lead["branch"] == "Salem"
    assert client.get(f"{API}/leads/{body['created'][0]['id']}", headers={**sa, "X-Branch-Scope": "Mumbai"}).status_code == 404


def test_row_limits(client, sa):
    h = in_salem(sa)
    assert preview(client, h, "leads", []).status_code == 422
    assert preview(client, h, "leads", [{"name": f"L{i}"} for i in range(501)]).status_code == 422
    assert commit(client, h, "leads", [{"name": f"L{i}"} for i in range(101)]).status_code == 422  # imports are saved a few at a time


# ---- employees (all or nothing) ---------------------------------------------------------------------------------------------------------
def test_employee_rows_get_the_same_cleaning_and_the_branch_column_works(client, sa):
    dept = next(c for c in schema(client, sa, "employees")["columns"] if c["key"] == "department")["options"][0]
    row = {"branch": "salem", "fullName": "Imp Excel", "officialEmail": "Imp.Excel@LAX360.com", "designation": "Analyst", "department": dept, "joinDate": "01/02/2026", "employmentType": "intern",
           "workMode": "HYBRID", "workLocation": "Client site, Pune", "status": "probation", "_row": 2}
    pv = preview(client, sa, "employees", [row]).json()
    assert pv["valid"] == 1 and pv["invalid"] == 0 and pv["rows"][0]["row"] == 2
    bad = preview(client, sa, "employees", [{**row, "joinDate": "someday", "employmentType": "Astronaut", "mobile": "x"}]).json()
    assert bad["invalid"] == 1 and any("valid date" in e for e in bad["rows"][0]["errors"]) and any("Employment Type" in e for e in bad["rows"][0]["errors"])
    done = commit(client, sa, "employees", [row])
    assert done.status_code == 200 and done.json()["count"] == 1
    emp = client.get(f"{API}/employees/{done.json()['created'][0]['id']}", headers=sa).json()
    assert emp["branch"] == "Salem" and emp["joinDate"] == "2026-02-01" and emp["employmentType"] == "Intern" and emp["workMode"] == "Hybrid" and emp["workLocation"] == "Client site, Pune"
    assert emp["status"] == "Probation" and emp["officialEmail"] == "imp.excel@lax360.com"
    assert commit(client, sa, "employees", [row]).status_code == 422  # the same file again: duplicate email, nothing written
