"""Branch isolation is enforced by the server for every branched module, not by the browser."""
from tests.conftest import headers_of, login, make_account

API = "/api/v1"


def company(client, h, name, **extra):
    r = client.post(f"{API}/companies", json={"name": name, **extra}, headers=h)
    assert r.status_code == 201, r.text
    return r.json()


def test_users_only_see_and_touch_their_own_branch(client, sa, salem_admin, mumbai_admin):
    salem = company(client, salem_admin, "Salem Traders")
    mumbai = company(client, mumbai_admin, "Mumbai Mills")
    assert salem["branch"] == "Salem" and mumbai["branch"] == "Mumbai"  # stamped by the server from the account, not by the request
    rows = client.get(f"{API}/companies", headers=salem_admin).json()
    assert [r["name"] for r in rows["data"]] == ["Salem Traders"] and rows["total"] == 1
    assert client.get(f"{API}/companies", params={"all": "true"}, headers=salem_admin).json()[0]["name"] == "Salem Traders"
    assert client.get(f"{API}/companies/{mumbai['id']}", headers=salem_admin).status_code == 404
    assert client.put(f"{API}/companies/{mumbai['id']}", json={"name": "Hijacked"}, headers=salem_admin).status_code == 404
    assert client.delete(f"{API}/companies/{mumbai['id']}", headers=salem_admin).status_code == 404
    assert client.get(f"{API}/companies/{mumbai['id']}", headers=sa).json()["name"] == "Mumbai Mills"  # untouched


def test_search_filters_and_counts_cannot_reach_other_branches(client, salem_admin, mumbai_admin):
    company(client, salem_admin, "Shared Name Ltd")
    company(client, mumbai_admin, "Shared Name Ltd")  # the same name in another branch is a different company
    assert client.get(f"{API}/companies", params={"q": "shared"}, headers=salem_admin).json()["total"] == 1
    assert client.get(f"{API}/companies", params={"branch": "Mumbai"}, headers=salem_admin).json()["total"] == 0
    assert client.get(f"{API}/companies", params={"branch": "Mumbai,Salem"}, headers=salem_admin).json()["total"] == 1


def test_a_branch_user_cannot_widen_their_scope_or_create_elsewhere(client, salem_admin):
    r = client.get(f"{API}/companies", headers={**salem_admin, "X-Branch-Scope": "all"})
    assert r.status_code == 200 and r.json()["total"] == 0
    r = client.post(f"{API}/companies", json={"name": "Sneaky", "branch": "Mumbai"}, headers=salem_admin)
    assert r.status_code == 201 and r.json()["branch"] == "Salem"  # the requested branch is ignored
    other = client.get(f"{API}/companies", headers={**salem_admin, "X-Branch-Scope": "Mumbai"}).json()
    assert [c["branch"] for c in other["data"]] == ["Salem"]


def test_super_admin_sees_everything_or_one_branch_by_selection(client, sa, salem_admin, mumbai_admin):
    company(client, salem_admin, "Salem Co")
    company(client, mumbai_admin, "Mumbai Co")
    assert client.get(f"{API}/companies", headers=sa).json()["total"] == 2
    assert client.get(f"{API}/companies", headers={**sa, "X-Branch-Scope": "all"}).json()["total"] == 2
    only = client.get(f"{API}/companies", headers={**sa, "X-Branch-Scope": "Mumbai"}).json()
    assert only["total"] == 1 and only["data"][0]["name"] == "Mumbai Co"
    assert client.get(f"{API}/companies", headers={**sa, "X-Branch-Scope": "Atlantis"}).status_code == 422


def test_super_admin_must_choose_a_branch_when_nothing_decides_it(client, sa):
    r = client.post(f"{API}/companies", json={"name": "Orphan Ltd"}, headers=sa)
    assert r.status_code == 422 and "branch" in r.json()["fields"]
    ok = client.post(f"{API}/companies", json={"name": "Orphan Ltd"}, headers={**sa, "X-Branch-Scope": "Bangalore"})
    assert ok.status_code == 201 and ok.json()["branch"] == "Bangalore"
    wrong = client.post(f"{API}/companies", json={"name": "Elsewhere", "branch": "Salem"}, headers={**sa, "X-Branch-Scope": "Bangalore"})
    assert wrong.status_code == 403  # viewing Bangalore: switch to All branches to create in Salem


def test_linked_records_inherit_the_branch_and_cannot_cross_branches(client, sa, salem_admin, mumbai_admin):
    salem = company(client, salem_admin, "Salem Co")
    mumbai = company(client, mumbai_admin, "Mumbai Co")
    contact = client.post(f"{API}/contacts", json={"name": "Asha", "companyId": salem["id"]}, headers=sa)
    assert contact.status_code == 201 and contact.json()["branch"] == "Salem"  # a Super Admin in All branches inherits it from the linked company
    cross = client.post(f"{API}/contacts", json={"name": "Ravi", "companyId": mumbai["id"]}, headers=salem_admin)
    assert cross.status_code == 422  # the Mumbai company does not exist as far as Salem is concerned
    both = client.post(f"{API}/deals", json={"name": "D", "companyId": salem["id"], "contactId": contact.json()["id"], "branch": "Mumbai"}, headers=sa)
    assert both.status_code == 422 and "another branch" in both.json()["message"]


def test_every_branched_module_is_scoped_not_just_companies(client, sa, salem_admin, mumbai_admin):
    cust = client.post(f"{API}/customers", json={"name": "Anchor"}, headers=salem_admin).json()["id"]
    campaign = {"name": "Mailers", "type": "Email Marketing", "channel": "Email", "startDate": "2030-01-01", "endDate": "2030-02-01", "budget": 100, "leadSourceId": "LS-001"}
    project = {"name": "P", "customerId": cust, "projectType": "Implementation", "startDate": "2026-01-01", "deadline": "2026-03-01"}
    for name, body in (("leads", {"name": "L"}), ("contacts", {"name": "C"}), ("customers", {"name": "K"}), ("enquiries", {"name": "E"}), ("deals", {"name": "D"}),
                       ("tickets", {"subject": "T"}), ("projects", project), ("campaigns", campaign)):
        created = client.post(f"{API}/{name}", json=body, headers=salem_admin)
        assert created.status_code == 201, (name, created.text)
        assert client.get(f"{API}/{name}", headers=mumbai_admin).json()["total"] == 0, name
        assert client.get(f"{API}/{name}/{created.json()['id']}", headers=mumbai_admin).status_code == 404, name
        assert client.get(f"{API}/{name}", headers=salem_admin).json()["total"] == (2 if name == "customers" else 1), name


def test_people_lists_are_scoped_to_the_branch_too(client, sa, salem_admin):
    make_account(client, sa, first="Mia", last="Mumbai", branch="Mumbai", username="mia.mumbai")
    names = [e["fullName"] for e in client.get(f"{API}/employees", params={"all": "true"}, headers=salem_admin).json()]
    assert "Mia Mumbai" not in names and "Priya Salem" in names
    all_names = [e["fullName"] for e in client.get(f"{API}/employees", params={"all": "true"}, headers=sa).json()]
    assert {"Mia Mumbai", "Priya Salem", "Root Admin"} <= set(all_names)
