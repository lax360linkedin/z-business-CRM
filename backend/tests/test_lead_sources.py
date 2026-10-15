"""Lead Sources are connected to the CRM: what marketing configures is what people pick on leads and enquiries, the choice survives conversion, it respects branches, and reports count it."""
from tests.conftest import ROOT_EMAIL, ROOT_PASSWORD, headers_of, login, make_account
from tests.test_crm_workflow import QUAL

API = "/api/v1"


def who(client, sa, key, role, branch, level="Employee"):
    make_account(client, sa, first=key.title(), last=branch, level=level, role=role, branch=branch, username=f"{key}.{branch.lower()}")
    return headers_of(login(client, f"{key}.{branch.lower()}"))


def names(r):
    return {x["name"] for x in r.json()}


def test_options_list_shared_and_own_branch_sources_for_anyone_who_works_with_leads(client, sa):
    rep_s, rep_m = who(client, sa, "rep", "Sales Executive", "Salem"), who(client, sa, "rep", "Sales Executive", "Mumbai")
    mark_s = who(client, sa, "mark", "Marketing", "Salem")
    assert client.get(f"{API}/lead-sources", headers=rep_s).status_code == 403  # the sources screen is for marketing
    opts = client.get(f"{API}/lead-sources/options", headers=rep_s)
    assert opts.status_code == 200 and {"Website Contact Form", "Customer Referral", "Walk-in"} <= names(opts) and all(o["shared"] for o in opts.json())
    made = client.post(f"{API}/lead-sources", json={"name": "Salem Roadshow", "category": "Offline"}, headers=mark_s)
    assert made.status_code == 201 and made.json()["branch"] == "Salem"
    assert "Salem Roadshow" in names(client.get(f"{API}/lead-sources/options", headers=rep_s))  # their own branch's source appears
    assert "Salem Roadshow" not in names(client.get(f"{API}/lead-sources/options", headers=rep_m))  # another branch never sees it
    assert client.get(f"{API}/lead-sources/{made.json()['id']}", headers=mark_s).status_code == 200
    mark_m = who(client, sa, "mark", "Marketing", "Mumbai")
    assert client.get(f"{API}/lead-sources/{made.json()['id']}", headers=mark_m).status_code == 404
    assert "Salem Roadshow" not in names(client.get(f"{API}/lead-sources", headers=mark_m))
    inactive = client.put(f"{API}/lead-sources/{made.json()['id']}", json={"active": False}, headers=mark_s).json()
    assert inactive["active"] is False and "Salem Roadshow" not in names(client.get(f"{API}/lead-sources/options", headers=rep_s))  # inactive ones are not offered


def test_shared_sources_belong_to_the_super_admin_and_branch_sources_to_their_branch(client, sa):
    mark_s = who(client, sa, "mark", "Marketing", "Salem")
    shared = client.post(f"{API}/lead-sources", json={"name": "National Campaign", "category": "Paid Advertising"}, headers=sa)  # all branches view = shared
    assert shared.status_code == 201 and shared.json()["branch"] is None
    in_salem = client.post(f"{API}/lead-sources", json={"name": "Salem Hoardings", "category": "Paid Advertising"}, headers={**sa, "X-Branch-Scope": "Salem"})
    assert in_salem.status_code == 201 and in_salem.json()["branch"] == "Salem"
    sid = shared.json()["id"]
    assert client.put(f"{API}/lead-sources/{sid}", json={"active": False}, headers=mark_s).status_code == 403  # a branch cannot change a shared source
    assert client.delete(f"{API}/lead-sources/{sid}", headers=mark_s).status_code == 403
    row = next(x for x in client.get(f"{API}/lead-sources", headers=mark_s).json() if x["id"] == sid)
    assert row["shared"] is True and row["perms"]["edit"] is False
    own = next(x for x in client.get(f"{API}/lead-sources", headers=mark_s).json() if x["id"] == in_salem.json()["id"])
    assert own["perms"]["edit"] is True
    assert client.put(f"{API}/lead-sources/{in_salem.json()['id']}", json={"description": "Highway boards"}, headers=mark_s).status_code == 200


def test_leads_and_enquiries_must_use_a_configured_source_available_in_their_branch(client, sa):
    rep_s = who(client, sa, "rep", "Sales Executive", "Salem")
    mark_m = who(client, sa, "mark", "Marketing", "Mumbai")
    mumbai_only = client.post(f"{API}/lead-sources", json={"name": "Mumbai Local Train Ads", "category": "Paid Advertising"}, headers=mark_m).json()
    ok = client.post(f"{API}/leads", json={"name": "Asha", "source": "Website Contact Form"}, headers=rep_s)
    assert ok.status_code == 201 and ok.json()["leadSourceId"] and ok.json()["source"] == "Website Contact Form"
    assert client.post(f"{API}/leads", json={"name": "Bala", "source": "Skywriting"}, headers=rep_s).status_code == 422  # not configured
    assert client.post(f"{API}/leads", json={"name": "Chitra", "source": "Mumbai Local Train Ads"}, headers=rep_s).status_code == 422  # another branch's source
    assert client.post(f"{API}/leads", json={"name": "Dev", "leadSourceId": mumbai_only["id"]}, headers=rep_s).status_code == 422
    assert client.post(f"{API}/leads", json={"name": "No source at all"}, headers=rep_s).status_code == 201  # a source is optional on the API (the screens ask for one)
    enq = client.post(f"{API}/enquiries", json={"name": "Esha", "source": "Existing Customer"}, headers=rep_s)  # the old wording still resolves to the configured source
    assert enq.status_code == 201 and enq.json()["source"] == "Customer Referral"
    assert client.post(f"{API}/enquiries", json={"name": "Farid", "source": "Nowhere"}, headers=rep_s).status_code == 422
    # changing the source is checked, leaving it alone is not; an inactive source cannot be newly chosen but old records keep it
    lead = ok.json()
    assert client.put(f"{API}/leads/{lead['id']}", json={"source": "Customer Referral"}, headers=rep_s).json()["source"] == "Customer Referral"
    assert client.put(f"{API}/leads/{lead['id']}", json={"source": "Made up"}, headers=rep_s).status_code == 422
    referral = next(x for x in client.get(f"{API}/lead-sources/options", headers=rep_s).json() if x["name"] == "Customer Referral")
    root = {**sa}
    assert client.put(f"{API}/lead-sources/{referral['id']}", json={"active": False}, headers=root).status_code == 200
    assert client.put(f"{API}/leads/{lead['id']}", json={"notes": "still editable"}, headers=rep_s).status_code == 200
    assert client.post(f"{API}/leads", json={"name": "Gita", "source": "Customer Referral"}, headers=rep_s).status_code == 422


def test_the_source_survives_enquiry_to_lead_to_deal_to_customer(client, sa):
    mgr = who(client, sa, "mgr", "Sales Manager", "Salem")
    mark = who(client, sa, "mark", "Marketing", "Salem")
    own = client.post(f"{API}/lead-sources", json={"name": "Salem Expo 2026", "category": "Offline"}, headers=mark).json()
    enq = client.post(f"{API}/enquiries", json={"name": "Ravi Kumar", "company": "Kumar Traders", "email": "ravi@kumar.in", "phone": "9876543210", "source": "Salem Expo 2026", "priority": "High"}, headers=mgr).json()
    assert enq["leadSourceId"] == own["id"]
    for status in ("Contacted", "Qualified"):
        assert client.put(f"{API}/enquiries/{enq['id']}", json={"status": status, **({"qualification": QUAL} if status == "Qualified" else {})}, headers=mgr).status_code == 200
    conv = client.post(f"{API}/enquiries/{enq['id']}/convert", headers=mgr)
    assert conv.status_code == 200, conv.text
    lead = conv.json()["lead"]
    assert lead["leadSourceId"] == own["id"] and lead["source"] == "Salem Expo 2026" and lead["sourceEnquiryId"] == enq["id"]
    for status in ("Contacted", "Qualified"):
        client.put(f"{API}/leads/{lead['id']}", json={"status": status, **({"qualification": QUAL} if status == "Qualified" else {})}, headers=mgr)
    deal = client.post(f"{API}/leads/{lead['id']}/convert", headers=mgr)
    assert deal.status_code == 200, deal.text
    out = deal.json()
    assert out["deal"]["leadSourceId"] == own["id"] and out["deal"]["source"] == "Salem Expo 2026"
    assert out["customer"]["leadSourceId"] == own["id"]  # the customer remembers where they first came from


def test_source_results_count_only_the_callers_branch(client, sa):
    rep_s, rep_m = who(client, sa, "rep", "Sales Executive", "Salem"), who(client, sa, "rep", "Sales Executive", "Mumbai")
    mark_s, mark_m = who(client, sa, "mark", "Marketing", "Salem"), who(client, sa, "mark", "Marketing", "Mumbai")
    for n in range(3):
        assert client.post(f"{API}/leads", json={"name": f"Salem lead {n}", "source": "Website Contact Form"}, headers=rep_s).status_code == 201
    assert client.post(f"{API}/leads", json={"name": "Mumbai lead", "source": "Website Contact Form"}, headers=rep_m).status_code == 201

    def website(h):
        return next(x for x in client.get(f"{API}/lead-sources", headers=h).json() if x["name"] == "Website Contact Form")

    assert website(mark_s)["leads"] == 3 and website(mark_m)["leads"] == 1  # the same shared source, each branch sees its own results
    assert website({**sa})["leads"] == 4  # the Super Admin on all branches sees the total
    assert website({**sa, "X-Branch-Scope": "Mumbai"})["leads"] == 1
    sources = {x["name"]: x for x in client.get(f"{API}/marketing/analytics", headers=mark_s).json()["sources"]}
    assert sources["Website Contact Form"]["leads"] == 3
    assert client.get(f"{API}/lead-sources/{website(mark_s)['id']}", headers=mark_s).json()["usage"]["leads"] == 3
