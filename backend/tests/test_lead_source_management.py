"""Lead source management: the standard catalogue, categories added without code, scope (common / branch) and duplicate rules, safe deletion, honest integration status, source results and the
attribution that travels from enquiry to lead."""
from sqlalchemy import select

from app.db.session import get_session_factory
from app.models import Enquiry, Lead, LeadSource, LeadSourceIntegration
from app.services import lead_sources
from tests.conftest import headers_of, login, make_account
from tests.test_crm_workflow import QUAL
from tests.test_lead_sources import names, who

API = "/api/v1"
STANDARD = {
    "Paid Advertising": ["Meta Ads (Facebook and Instagram)", "Google Ads", "Other Paid Campaigns"],
    "Website": ["Website Contact Form", "Website Enquiry Form", "Landing Page"],
    "Social Media and Messaging": ["Instagram Organic", "Facebook Organic", "LinkedIn", "WhatsApp", "Other Social Media"],
    "Offline": ["Direct Visit", "Phone Call", "Walk-in", "Event or Exhibition"],
    "Referral and Internal": ["Customer Referral", "Employee Referral", "Partner Referral", "Other"],
}


def listing(client, h, **params):
    r = client.get(f"{API}/lead-sources", params=params, headers=h)
    assert r.status_code == 200, r.text
    return {x["name"]: x for x in r.json()}


def make(client, h, name, category="Offline", **extra):
    return client.post(f"{API}/lead-sources", json={"name": name, "category": category, **extra}, headers=h)


# ---- the standard catalogue ---------------------------------------------------------------------------------------------------------
def test_the_standard_categories_and_sources_exist_and_are_common(client, sa):
    rows = listing(client, sa)
    for category, wanted in STANDARD.items():
        for name in wanted:
            assert rows[name]["category"] == category and rows[name]["scope"] == "Common" and rows[name]["active"] is True and rows[name]["branch"] is None
    cats = client.get(f"{API}/lead-sources/categories", headers=sa).json()["categories"]
    assert list(STANDARD) == cats[: len(STANDARD)]


def test_seeding_again_changes_nothing(client, sa):
    with get_session_factory()() as db:  # sessions are always closed: an open one would block the next test's table clean-up on PostgreSQL
        before = set(db.execute(select(LeadSource.id)).scalars())
        assert lead_sources.seed_defaults(db) == 0
        db.commit()
        assert set(db.execute(select(LeadSource.id)).scalars()) == before


def test_an_older_catalogue_is_renamed_in_place_and_records_keep_their_source(client, sa):
    with get_session_factory()() as db:
        old = db.execute(select(LeadSource).where(LeadSource.name == "Website Contact Form")).scalar_one()
        old_id = old.id
        old.name = "Contact Form"  # as it was before this change
        used = LeadSource(id="LS-901", name="Facebook", category="Paid", source_type="Digital", capture_method="API", system=True, active=True, description="", attributes={})
        idle = LeadSource(id="LS-902", name="Advertisement", category="Paid", source_type="Digital", capture_method="API", system=True, active=True, description="", attributes={})
        db.add_all([used, idle])
        db.flush()
        db.add(Enquiry(id="ENQ-9001", name="Old", source="Contact Form", lead_source_id=old_id, branch="Salem", attributes={}))
        db.add(Enquiry(id="ENQ-9002", name="Older", source="Facebook", lead_source_id="LS-901", branch="Salem", attributes={}))
        db.commit()
        lead_sources.seed_defaults(db)
        db.commit()
    with get_session_factory()() as db:
        same = db.get(LeadSource, old_id)
        assert same.name == "Website Contact Form" and same.active is True  # same row, new name
        assert db.get(Enquiry, "ENQ-9001").source == "Website Contact Form" and db.get(Enquiry, "ENQ-9001").lead_source_id == old_id
        assert db.get(LeadSource, "LS-901").active is True  # still referenced: left alone
        assert db.get(LeadSource, "LS-902").active is False  # unused and replaced: switched off, not deleted
        assert db.get(Enquiry, "ENQ-9002").source == "Facebook"


# ---- categories --------------------------------------------------------------------------------------------------------------------
def test_authorised_people_add_categories_and_use_them_without_a_code_change(client, sa):
    mark = who(client, sa, "mark", "Marketing", "Salem")
    rep = who(client, sa, "rep", "Sales Executive", "Salem")
    assert client.post(f"{API}/lead-sources/categories", json={"name": "Print Media"}, headers=rep).status_code == 403
    assert make(client, mark, "Newspaper Insert", "Print Media").status_code == 422  # not a category yet
    added = client.post(f"{API}/lead-sources/categories", json={"name": "Print Media"}, headers=mark)
    assert added.status_code == 201 and "Print Media" in added.json()["categories"]
    assert client.post(f"{API}/lead-sources/categories", json={"name": " print  media "}, headers=mark).status_code == 422  # same category by another spelling
    assert client.post(f"{API}/lead-sources/categories", json={"name": "x"}, headers=mark).status_code == 422
    made = make(client, mark, "Newspaper Insert", "Print Media")
    assert made.status_code == 201 and made.json()["category"] == "Print Media"
    assert "Print Media" in client.get(f"{API}/lead-sources/categories", headers=rep).json()["categories"]


# ---- names, scope and duplicates ---------------------------------------------------------------------------------------------------------
def test_names_are_unique_after_normalising_and_by_scope(client, sa):
    mark_s, mark_m = who(client, sa, "mark", "Marketing", "Salem"), who(client, sa, "mark", "Marketing", "Mumbai")
    assert make(client, sa, "walk in", scope="common").status_code == 422  # "Walk-in" already exists (case, space and hyphen ignored)
    assert make(client, mark_s, "WALK-IN").status_code == 422  # a branch cannot re-use a common name either
    first = make(client, mark_s, "Salem Roadshow")
    assert first.status_code == 201 and first.json()["branch"] == "Salem"
    assert make(client, mark_s, "salem road-show").status_code == 422  # same branch, same normalised name
    assert make(client, mark_m, "Salem Roadshow").status_code == 201  # a different branch may use the same name
    assert make(client, sa, "Salem Roadshow", scope="common").status_code == 422  # a common source cannot shadow a branch's
    edit = client.put(f"{API}/lead-sources/{first.json()['id']}", json={"name": "Google Ads"}, headers=mark_s)
    assert edit.status_code == 422 and edit.json()["fields"]["name"]
    assert client.put(f"{API}/lead-sources/{first.json()['id']}", json={"name": "Salem Roadshow 2027"}, headers=mark_s).status_code == 200


def test_scope_is_decided_by_who_asks(client, sa):
    mark_s = who(client, sa, "mark", "Marketing", "Salem")
    assert make(client, mark_s, "National TV", scope="common").status_code == 403  # only the Super Admin makes common sources
    assert make(client, mark_s, "Mumbai Only", branch="Mumbai").status_code == 403  # nor another branch's
    common = make(client, sa, "National TV", scope="common", **{})
    assert common.status_code == 201 and common.json()["branch"] is None
    assert make(client, sa, "Bangalore Fair", scope="branch", branch="Bangalore").json()["branch"] == "Bangalore"
    assert make(client, sa, "Nowhere Fair", scope="branch").status_code == 422  # a branch source needs its branch
    assert make(client, sa, "Mars Fair", scope="branch", branch="Mars").status_code == 422
    assert make(client, sa, "Odd Fair", scope="everywhere").status_code == 422
    assert "National TV" in listing(client, mark_s)  # visible to every branch ...
    own = listing(client, who(client, sa, "mark", "Marketing", "Mumbai"))
    assert "National TV" in own and "Bangalore Fair" not in own  # ... but another branch's own source is not


def test_a_source_in_use_keeps_its_scope_and_cannot_be_deleted(client, sa):
    mark = who(client, sa, "mark", "Marketing", "Salem")
    rep = who(client, sa, "rep", "Sales Executive", "Salem")
    src = make(client, mark, "Temple Fair").json()
    assert client.post(f"{API}/enquiries", json={"name": "Esha", "source": "Temple Fair"}, headers=rep).status_code == 201
    moved = client.put(f"{API}/lead-sources/{src['id']}", json={"scope": "common"}, headers={**sa, "X-Branch-Scope": "Salem"})
    assert moved.status_code == 409  # in use: cannot move between branch and common
    gone = client.delete(f"{API}/lead-sources/{src['id']}", headers=mark)
    assert gone.status_code == 409 and "Deactivate" in gone.json()["message"]
    assert client.delete(f"{API}/lead-sources/{make(client, mark, 'Unused Idea').json()['id']}", headers=mark).status_code == 200
    system = next(x for x in listing(client, sa).values() if x["name"] == "Walk-in")
    assert client.delete(f"{API}/lead-sources/{system['id']}", headers=sa).status_code == 409


def test_renaming_or_deactivating_leaves_existing_records_on_their_source(client, sa):
    mark = who(client, sa, "mark", "Marketing", "Salem")
    rep = who(client, sa, "rep", "Sales Executive", "Salem")
    src = make(client, mark, "Bus Stand Banner").json()
    enq = client.post(f"{API}/enquiries", json={"name": "Esha", "source": "Bus Stand Banner"}, headers=rep).json()
    renamed = client.put(f"{API}/lead-sources/{src['id']}", json={"name": "Bus Stand Hoarding"}, headers=mark)
    assert renamed.status_code == 200
    again = client.get(f"{API}/enquiries/{enq['id']}", headers=rep).json()
    assert again["leadSourceId"] == src["id"] and again["source"] == "Bus Stand Hoarding"
    assert client.put(f"{API}/lead-sources/{src['id']}", json={"active": False}, headers=mark).status_code == 200
    kept = client.get(f"{API}/enquiries/{enq['id']}", headers=rep).json()
    assert kept["leadSourceId"] == src["id"]  # the record keeps it
    assert client.put(f"{API}/enquiries/{enq['id']}", json={"notes": "edited"}, headers=rep).status_code == 200  # and stays editable
    assert client.post(f"{API}/enquiries", json={"name": "New", "leadSourceId": src["id"]}, headers=rep).status_code == 422  # but it is not offered any more


def test_only_people_with_the_source_permissions_see_or_change_sources(client, sa):
    rep = who(client, sa, "rep", "Sales Executive", "Salem")
    mgr = who(client, sa, "mgr", "Sales Manager", "Salem")
    assert client.get(f"{API}/lead-sources", headers=rep).status_code == 403
    assert client.get(f"{API}/lead-sources", headers=mgr).status_code == 200
    assert make(client, mgr, "Manager Idea").status_code == 403  # view only
    assert client.get(f"{API}/lead-sources/options", headers=rep).status_code == 200  # but every seller can still choose one


# ---- integrations: metadata, honest status -----------------------------------------------------------------------------------------------
def test_every_source_starts_not_connected_and_nothing_pretends_otherwise(client, sa):
    rows = listing(client, sa)
    assert {r["integrationStatus"] for r in rows.values()} == {"Not Connected"}
    meta = rows["Meta Ads (Facebook and Instagram)"]
    detail = client.get(f"{API}/lead-sources/{meta['id']}", headers=sa).json()
    assert detail["integrations"] == [] and detail["integrationStatus"] == "Not Connected"


def test_integration_mappings_are_recorded_by_the_super_admin_and_never_marked_connected_by_hand(client, sa):
    mark = who(client, sa, "mark", "Marketing", "Salem")
    meta = listing(client, sa)["Meta Ads (Facebook and Instagram)"]
    url = f"{API}/lead-sources/{meta['id']}/integrations"
    body = {"provider": "Meta Lead Ads", "accountName": "LAX360 Salem page", "mappedBranch": "Salem", "status": "Connected", "lastSyncAt": "2026-01-01T00:00:00Z", "accessToken": "secret"}
    assert client.post(url, json=body, headers=mark).status_code == 403  # a branch user cannot
    made = client.post(url, json=body, headers=sa)
    assert made.status_code == 201
    m = made.json()
    assert m["status"] == "Not Connected" and m["lastSyncAt"] is None and m["mappedBranch"] == "Salem"  # claimed status is ignored
    assert "accessToken" not in m and "secret" not in str(m)  # nothing secret is accepted or kept
    assert client.post(url, json={**body, "provider": "Carrier pigeon"}, headers=sa).status_code == 422
    assert client.post(url, json={**body, "mappedBranch": "Mars"}, headers=sa).status_code == 422
    assert client.get(url, headers=mark).status_code == 200
    # a second mapping for another branch: the same source feeds several branches
    other = client.post(url, json={"provider": "Meta Lead Ads", "accountName": "Mumbai page", "mappedBranch": "Mumbai"}, headers=sa).json()
    assert listing(client, sa)["Meta Ads (Facebook and Instagram)"]["integrationCount"] == 2

    with get_session_factory()() as db:  # only the Integrations module reports results
        lead_sources.record_sync_success(db, m["id"])
        db.commit()
    assert listing(client, sa)["Meta Ads (Facebook and Instagram)"]["integrationStatus"] == "Connected"
    shown = client.get(url, headers=mark).json()
    assert next(x for x in shown if x["id"] == m["id"])["lastSyncAt"]
    with get_session_factory()() as db:
        lead_sources.record_sync_error(db, other["id"], "Token expired")
        db.commit()
    assert listing(client, sa)["Meta Ads (Facebook and Instagram)"]["integrationStatus"] == "Error"
    assert next(x for x in client.get(url, headers=sa).json() if x["id"] == other["id"])["lastError"] == "Token expired"
    # switching mappings off never leaves a stale "Connected"
    for item in (m, other):
        assert client.put(f"{url}/{item['id']}", json={"active": False}, headers=sa).json()["status"] == "Inactive"
    assert listing(client, sa)["Meta Ads (Facebook and Instagram)"]["integrationStatus"] == "Inactive"
    assert client.put(f"{url}/{m['id']}", json={"active": True}, headers=sa).json()["status"] == "Not Connected"  # back on, but unproven
    assert client.delete(f"{url}/{other['id']}", headers=mark).status_code == 403
    assert client.delete(f"{url}/{other['id']}", headers=sa).status_code == 200


def test_a_branch_source_can_only_be_mapped_to_its_own_branch(client, sa):
    mark = who(client, sa, "mark", "Marketing", "Salem")
    src = make(client, mark, "Salem Hoardings").json()
    url = f"{API}/lead-sources/{src['id']}/integrations"
    assert client.post(url, json={"provider": "Other platform", "mappedBranch": "Mumbai"}, headers=sa).status_code == 422
    ok = client.post(url, json={"provider": "Other platform"}, headers=sa)
    assert ok.status_code == 201 and ok.json()["mappedBranch"] == "Salem"


# ---- results ---------------------------------------------------------------------------------------------------------------------
def convert(client, h, enq_id):
    for status in ("Contacted", "Qualified"):
        assert client.put(f"{API}/enquiries/{enq_id}", json={"status": status, **({"qualification": QUAL} if status == "Qualified" else {})}, headers=h).status_code == 200
    r = client.post(f"{API}/enquiries/{enq_id}/convert", headers=h)
    assert r.status_code == 200, r.text
    return r.json()


def test_counts_conversion_rate_filters_and_branch_isolation(client, sa):
    rep_s, rep_m = who(client, sa, "rep", "Sales Manager", "Salem"), who(client, sa, "rep", "Sales Manager", "Mumbai")
    mark_s, mark_m = who(client, sa, "mark", "Marketing", "Salem"), who(client, sa, "mark", "Marketing", "Mumbai")
    assert listing(client, mark_s)["Google Ads"]["enquiryCount"] == 0 and listing(client, mark_s)["Google Ads"]["enquiryConversionRate"] == 0  # nothing yet: no division by zero
    ids = [client.post(f"{API}/enquiries", json={"name": f"S{n}", "company": f"Co{n}", "email": f"s{n}@x.in", "phone": f"98000000{n}0", "source": "Google Ads"}, headers=rep_s).json()["id"] for n in range(4)]
    client.post(f"{API}/enquiries", json={"name": "M0", "company": "MCo", "email": "m@x.in", "phone": "9811111110", "source": "Google Ads"}, headers=rep_m)
    old = client.post(f"{API}/enquiries", json={"name": "Old", "company": "OldCo", "email": "o@x.in", "phone": "9822222220", "source": "Google Ads", "date": "2020-03-01"}, headers=rep_s)
    assert old.status_code == 201
    convert(client, rep_s, ids[0])
    row = listing(client, mark_s)["Google Ads"]
    assert (row["enquiryCount"], row["convertedLeadCount"], row["enquiryConversionRate"]) == (5, 1, 20.0)
    assert listing(client, mark_m)["Google Ads"]["enquiryCount"] == 1  # a branch counts only its own enquiries
    assert listing(client, sa)["Google Ads"]["enquiryCount"] == 6
    assert listing(client, sa, branch="Mumbai")["Google Ads"]["enquiryCount"] == 1
    ranged = listing(client, sa, **{"from": "2026-01-01"})["Google Ads"]
    assert ranged["enquiryCount"] == 5 and listing(client, sa, to="2020-12-31")["Google Ads"]["enquiryCount"] == 1
    assert listing(client, mark_s, branch="Mumbai")["Google Ads"]["enquiryCount"] == 5  # the branch filter is the Super Admin's: it never widens a branch user's view
    assert client.get(f"{API}/lead-sources", params={"branch": "Mars"}, headers=sa).status_code == 422
    csv = client.get(f"{API}/marketing/export", params={"type": "sources"}, headers=mark_s)
    assert csv.status_code == 200 and "Integration status" in csv.text and "Google Ads" in csv.text and "Enquiry to lead rate" in csv.text


# ---- attribution --------------------------------------------------------------------------------------------------------------------
def test_attribution_is_optional_server_stamped_and_survives_conversion(client, sa):
    mgr = who(client, sa, "mgr", "Sales Manager", "Salem")
    plain = client.post(f"{API}/enquiries", json={"name": "Plain"}, headers=mgr)
    assert plain.status_code == 201 and plain.json()["createdVia"] == "Manual" and plain.json()["sourceCategory"] == ""  # nothing is required
    body = {"name": "Ravi Kumar", "company": "Kumar Traders", "email": "ravi@kumar.in", "phone": "9876543210", "source": "Meta Ads (Facebook and Instagram)", "adName": "Diwali Offer", "adId": "AD-77",
            "landingPage": "diwali-landing", "utmSource": "facebook", "utmMedium": "cpc", "utmCampaign": "diwali", "utmContent": "carousel", "sourceCategory": "Hacked", "createdVia": "Integration"}
    enq = client.post(f"{API}/enquiries", json=body, headers=mgr).json()
    assert enq["sourceCategory"] == "Paid Advertising" and enq["createdVia"] == "Manual"  # server-owned: what the browser sent is ignored
    assert enq["adName"] == "Diwali Offer" and enq["utmCampaign"] == "diwali" and enq["landingPage"] == "diwali-landing"
    # re-categorising the source later does not rewrite the record
    meta = listing(client, sa)["Meta Ads (Facebook and Instagram)"]
    assert client.put(f"{API}/lead-sources/{meta['id']}", json={"category": "Website"}, headers=sa).status_code == 200
    assert client.get(f"{API}/enquiries/{enq['id']}", headers=mgr).json()["sourceCategory"] == "Paid Advertising"
    out = convert(client, mgr, enq["id"])
    lead = out["lead"]
    for key in ("sourceCategory", "adName", "adId", "landingPage", "utmSource", "utmMedium", "utmCampaign", "utmContent", "leadSourceId", "source"):
        assert lead[key] == enq[key], key
    assert lead["createdVia"] == "Conversion" and lead["enquiryReceivedDate"] and lead["sourceEnquiryId"] == enq["id"]
    assert client.get(f"{API}/enquiries/{enq['id']}", headers=mgr).json()["createdVia"] == "Manual"  # the original is untouched
    assert client.put(f"{API}/leads/{lead['id']}", json={"adName": "Changed later"}, headers=mgr).json()["adName"] == "Changed later"  # editable on the lead
    assert client.get(f"{API}/enquiries/{enq['id']}", headers=mgr).json()["adName"] == "Diwali Offer"


def test_attribution_values_are_validated(client, sa):
    mgr = who(client, sa, "mgr", "Sales Manager", "Salem")
    assert client.post(f"{API}/enquiries", json={"name": "Long", "utmSource": "x" * 500}, headers=mgr).status_code == 422
    other = make_account(client, sa, first="Far", last="Away", branch="Mumbai", role="Sales Executive", username="far.away")
    ok_peer = make_account(client, sa, first="Near", last="By", branch="Salem", role="Sales Executive", username="near.by")
    far = client.post(f"{API}/enquiries", json={"name": "Ref", "referringEmployeeId": other["employeeId"]}, headers=mgr)
    assert far.status_code == 422 and far.json()["fields"]["referringEmployeeId"]
    assert client.post(f"{API}/enquiries", json={"name": "Ref", "referringEmployeeId": "EMP-9999"}, headers=mgr).status_code == 422
    near = client.post(f"{API}/enquiries", json={"name": "Ref", "referringEmployeeId": ok_peer["employeeId"]}, headers=mgr)
    assert near.status_code == 201 and near.json()["referringEmployeeId"] == ok_peer["employeeId"]
    assert headers_of(login(client, "near.by"))  # sanity: the account is real
