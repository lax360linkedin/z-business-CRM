"""Work location: Office / Remote / Hybrid, or a typed place (the dropdown's "Others"). The record stores the one text; the Branch field is separate and untouched."""
import pytest

API = "/api/v1"
BASE = {"fullName": "Kiran Das", "officialEmail": "kiran.das@lax360.com", "branch": "Mumbai", "designation": "Analyst", "joinDate": "2026-01-05", "departmentId": "DEP-001"}


def create(client, sa, **extra):
    return client.post(f"{API}/employees", json={**BASE, **extra}, headers=sa)


@pytest.mark.parametrize("place", ["Office", "Remote", "Hybrid"])
def test_a_predefined_location_is_saved_as_chosen(client, sa, place):
    r = create(client, sa, workLocation=place)
    assert r.status_code == 201, r.text
    assert client.get(f"{API}/employees/{r.json()['id']}", headers=sa).json()["workLocation"] == place


def test_a_typed_location_is_saved_trimmed_and_the_branch_stays_separate(client, sa):
    r = create(client, sa, workLocation="  Client site —   Pune  ")
    assert r.status_code == 201, r.text
    got = client.get(f"{API}/employees/{r.json()['id']}", headers=sa).json()
    assert got["workLocation"] == "Client site — Pune" and got["branch"] == "Mumbai"


def test_validation(client, sa):
    assert create(client, sa, workLocation="x" * 81).status_code == 422
    r = create(client, sa, workLocation="Others")  # the dropdown word itself is not a place
    assert r.status_code == 422 and "workLocation" in r.json()["fields"]
    assert create(client, sa, workLocation="x" * 80).status_code == 201


def test_editing_keeps_the_saved_location_and_other_data(client, sa):
    eid = create(client, sa, workLocation="Warehouse 4, Salem").json()["id"]
    r = client.put(f"{API}/employees/{eid}", json={"designation": "Senior Analyst"}, headers=sa)
    assert r.status_code == 200, r.text
    got = client.get(f"{API}/employees/{eid}", headers=sa).json()
    assert got["workLocation"] == "Warehouse 4, Salem" and got["designation"] == "Senior Analyst" and got["branch"] == "Mumbai"
    assert client.put(f"{API}/employees/{eid}", json={"workLocation": "Hybrid"}, headers=sa).status_code == 200
    assert client.get(f"{API}/employees/{eid}", headers=sa).json()["workLocation"] == "Hybrid"


def test_older_records_with_a_blank_or_legacy_location_can_still_be_edited(client, sa):
    eid = create(client, sa, workLocation="Chennai HQ").json()["id"]
    assert client.put(f"{API}/employees/{eid}", json={"mobile": "9876543210"}, headers=sa).status_code == 200
    assert client.get(f"{API}/employees/{eid}", headers=sa).json()["workLocation"] == "Chennai HQ"
    blank = create(client, sa, officialEmail="b.lank@lax360.com", workLocation="").json()["id"]
    assert client.put(f"{API}/employees/{blank}", json={"mobile": "9876543210"}, headers=sa).status_code == 200


def test_the_org_config_offers_the_four_options(client, sa):
    assert client.get(f"{API}/org/config", headers=sa).json()["locations"] == ["Office", "Remote", "Hybrid", "Others"]
