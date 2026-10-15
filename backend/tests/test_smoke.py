from tests.conftest import ROOT_EMAIL, ROOT_PASSWORD, login


def test_super_admin_signs_in_to_all_branches(client):
    body = login(client, ROOT_EMAIL, ROOT_PASSWORD).json()
    assert body["user"]["accessLevel"] == "Super Admin"
    assert body["user"]["allBranches"] is True and body["user"]["branch"] is None
    assert body["tokens"]["accessToken"] and body["tokens"]["refreshToken"]
    assert not {"password", "passwordHash", "password_hash"} & set(body["user"])  # a credential is never part of the response


def test_me_and_company_roundtrip(client, sa):
    me = client.get("/api/v1/auth/me", headers=sa)
    assert me.status_code == 200 and me.json()["name"] == "Root Admin"
    created = client.post("/api/v1/companies", json={"name": "Acme Ltd", "branch": "Salem"}, headers=sa)
    assert created.status_code == 201, created.text
    company = created.json()
    assert company["branch"] == "Salem" and company["id"].startswith("CMP-")
    assert client.get(f"/api/v1/companies/{company['id']}", headers=sa).json()["name"] == "Acme Ltd"
