from tests.conftest import headers_of, login, make_account

API = "/api/v1"


def person(client, sa, first, role, department="Sales", branch="Salem"):
    make_account(client, sa, first=first, last="Scope", role=role, branch=branch, department=department, username=f"{first.lower()}.scope")
    h = headers_of(login(client, f"{first.lower()}.scope"))
    return h, client.get(f"{API}/auth/me", headers=h).json()["id"]


def ids_of(client, h, path):
    r = client.get(f"{API}/{path}", params={"all": "true"}, headers=h)
    assert r.status_code == 200, r.text
    return sorted(x["id"] for x in r.json())


def test_sales_executives_reach_only_their_own_records_and_managers_their_team(client, sa):
    amy, amy_id = person(client, sa, "Amy", "Sales Executive")
    ben, ben_id = person(client, sa, "Ben", "Sales Executive")
    mgr, _ = person(client, sa, "Mona", "Sales Manager")
    other_mgr, _ = person(client, sa, "Omar", "Sales Manager", department="Support")
    mine = client.post(f"{API}/leads", json={"name": "Amy lead", "assignedTo": amy_id}, headers=amy).json()["id"]
    theirs = client.post(f"{API}/leads", json={"name": "Ben lead", "assignedTo": ben_id}, headers=ben).json()["id"]
    assert ids_of(client, amy, "leads") == [mine] and ids_of(client, ben, "leads") == [theirs]
    assert client.get(f"{API}/leads/{theirs}", headers=amy).status_code == 404
    assert client.put(f"{API}/leads/{theirs}", json={"notes": "mine now"}, headers=amy).status_code == 404
    assert client.delete(f"{API}/leads/{theirs}", headers=amy).status_code == 403  # executives have no delete right at all
    assert ids_of(client, mgr, "leads") == sorted([mine, theirs])  # same department
    assert ids_of(client, other_mgr, "leads") == []  # another department's manager sees nobody else's team
    assert ids_of(client, sa, "leads") == sorted([mine, theirs])
    # handing a record over moves it from one person's scope to the other's
    assert client.put(f"{API}/leads/{mine}", json={"assignedTo": ben_id}, headers=amy).status_code == 200
    assert ids_of(client, ben, "leads") == sorted([mine, theirs])
    assert ids_of(client, amy, "leads") == [mine]  # the creator never loses sight of what they created


def test_scope_covers_the_whole_chain_not_only_leads(client, sa):
    amy, amy_id = person(client, sa, "Amy", "Sales Executive")
    ben, ben_id = person(client, sa, "Ben", "Sales Executive")
    mgr, _ = person(client, sa, "Mona", "Sales Manager")
    deal = client.post(f"{API}/deals", json={"name": "Ben deal", "salesperson": ben_id}, headers=ben).json()["id"]
    company = client.post(f"{API}/companies", json={"name": "Ben Co", "assignedTo": ben_id}, headers=ben).json()["id"]
    contact = client.post(f"{API}/contacts", json={"name": "Ben contact", "assignedTo": ben_id}, headers=ben).json()["id"]
    for path, rid in (("deals", deal), ("companies", company), ("contacts", contact)):
        assert client.get(f"{API}/{path}/{rid}", headers=amy).status_code == 404, path
        assert ids_of(client, amy, path) == [], path
        assert rid in ids_of(client, mgr, path), path
    assert client.get(f"{API}/search", params={"q": "Ben"}, headers=amy).json() == []
    assert {h["type"] for h in client.get(f"{API}/search", params={"q": "Ben"}, headers=mgr).json()} >= {"Deal", "Company", "Contact"}
    # a document uploaded to Ben's deal is not reachable through the deal by someone who cannot open the deal
    import io
    pdf = b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n"
    up = client.post(f"{API}/documents", files={"file": ("ben.pdf", io.BytesIO(pdf), "application/pdf")}, data={"meta": '{"relatedType": "Deal", "relatedId": "%s"}' % deal}, headers=ben)
    assert up.status_code == 201, up.text
    assert client.get(f"{API}/documents/{up.json()['id']}", headers=amy).status_code == 404
