"""Configurable option lists: defaults, who may change them, rename carried to records, delete refused while in use (deactivate instead), reorder and reset."""
from urllib.parse import quote

from app.services import option_lists
from tests.test_lead_sources import who

API = "/api/v1"


def lists(client, h):
    r = client.get(f"{API}/options", headers=h)
    assert r.status_code == 200, r.text
    return r.json()["lists"]


def values(client, h, key, only_active=False):
    return [i["value"] for i in lists(client, h)[key]["items"] if i["active"] or not only_active]


def item(key, value):
    return f"{API}/options/{key}/items/{quote(value, safe='')}"


def test_every_list_starts_with_its_defaults_and_anyone_can_read_them(client, sa):
    rep = who(client, sa, "rep", "Sales Executive", "Salem")
    got = lists(client, rep)
    assert set(got) == {s.key for s in option_lists.LISTS}
    for spec in option_lists.LISTS:
        assert [i["value"] for i in got[spec.key]["items"]] == list(spec.defaults) and all(i["active"] for i in got[spec.key]["items"])
    assert "Healthcare" in values(client, rep, "industries")
    assert client.get(f"{API}/options").status_code == 401


def test_only_the_super_admin_can_change_lists(client, sa, salem_admin):
    rep = who(client, sa, "rep", "Sales Executive", "Salem")
    for h in (rep, salem_admin):
        assert client.post(f"{API}/options/industries/items", json={"value": "Aviation"}, headers=h).status_code == 403
        assert client.put(item("industries", "Healthcare"), json={"active": False}, headers=h).status_code == 403
        assert client.delete(item("industries", "Healthcare"), headers=h).status_code == 403
        assert client.get(f"{API}/options/usage", headers=h).status_code == 403
    assert "Aviation" not in values(client, rep, "industries")


def test_add_validate_disable_and_reorder(client, sa):
    ok = client.post(f"{API}/options/industries/items", json={"value": "  Aviation  "}, headers=sa)
    assert ok.status_code == 201 and ok.json()["items"][-1] == {"value": "Aviation", "active": True}
    assert client.post(f"{API}/options/industries/items", json={"value": "aviation"}, headers=sa).status_code == 422  # same option, other case
    assert client.post(f"{API}/options/industries/items", json={"value": "  "}, headers=sa).status_code == 422
    assert client.post(f"{API}/options/industries/items", json={"value": "x" * 121}, headers=sa).status_code == 422
    assert client.post(f"{API}/options/nope/items", json={"value": "a"}, headers=sa).status_code == 404
    off = client.put(item("industries", "Aviation"), json={"active": False}, headers=sa)
    assert off.status_code == 200 and "Aviation" not in values(client, sa, "industries", only_active=True) and "Aviation" in values(client, sa, "industries")
    order = values(client, sa, "enquiry_types")
    flipped = list(reversed(order))
    assert client.put(f"{API}/options/enquiry_types/order", json={"values": flipped}, headers=sa).status_code == 200
    assert values(client, sa, "enquiry_types") == flipped
    assert client.put(f"{API}/options/enquiry_types/order", json={"values": order[:-1]}, headers=sa).status_code == 422  # must be the whole list


def test_slashes_and_symbols_in_a_value_work(client, sa):
    assert client.put(item("ticket_categories", "Login / Access"), json={"value": "Login & Access"}, headers=sa).status_code == 200
    assert "Login & Access" in values(client, sa, "ticket_categories") and "Login / Access" not in values(client, sa, "ticket_categories")


def test_a_rename_reaches_the_records_and_a_used_option_cannot_be_deleted(client, sa):
    rep = who(client, sa, "rep", "Sales Executive", "Salem")
    made = client.post(f"{API}/enquiries", json={"name": "Asha", "enquiryType": "Pricing Enquiry", "category": "Healthcare"}, headers=rep)
    assert made.status_code == 201
    use = client.get(f"{API}/options/usage", headers=sa).json()["usage"]
    assert use["enquiry_types"]["Pricing Enquiry"] == 1 and use["industries"]["Healthcare"] == 1
    blocked = client.delete(item("enquiry_types", "Pricing Enquiry"), headers=sa)
    assert blocked.status_code == 409 and blocked.json()["code"] == "IN_USE" and "Deactivate" in blocked.json()["message"]
    assert client.put(item("enquiry_types", "Pricing Enquiry"), json={"active": False}, headers=sa).status_code == 200  # deactivating is always fine
    renamed = client.put(item("enquiry_types", "Pricing Enquiry"), json={"value": "Price Enquiry"}, headers=sa)
    assert renamed.status_code == 200
    assert client.get(f"{API}/enquiries/{made.json()['id']}", headers=rep).json()["enquiryType"] == "Price Enquiry"  # the record follows
    assert client.put(item("enquiry_types", "Product Enquiry"), json={"value": "Service Enquiry"}, headers=sa).status_code == 422  # clash
    assert client.delete(item("requirement_types", "Renewal"), headers=sa).status_code == 200  # unused: removed
    assert "Renewal" not in values(client, sa, "requirement_types")


def test_values_kept_inside_record_details_are_counted_and_protected(client, sa):
    rep = who(client, sa, "rep", "Sales Executive", "Salem")
    enq = client.post(f"{API}/enquiries", json={"name": "Bala", "qualification": {"purchaseIntent": "High", "businessNeeds": ["Lead Management"]}}, headers=rep).json()
    use = client.get(f"{API}/options/usage", headers=sa).json()["usage"]
    assert use["purchase_intents"].get("High", 0) >= 1 and use["business_needs"].get("Lead Management", 0) >= 1, enq
    assert client.delete(item("purchase_intents", "High"), headers=sa).status_code == 409
    assert client.put(item("purchase_intents", "High"), json={"value": "Very likely"}, headers=sa).status_code == 409  # cannot be carried: deactivate + add instead
    assert client.put(item("purchase_intents", "Low"), json={"value": "Unlikely"}, headers=sa).status_code == 200  # unused: free to rename


def test_reset_restores_defaults_and_keeps_used_values_as_inactive(client, sa):
    rep = who(client, sa, "rep", "Sales Executive", "Salem")
    assert client.put(item("cities", "Chennai"), json={"value": "Chennai City"}, headers=sa).status_code == 200
    assert client.post(f"{API}/enquiries", json={"name": "Esha", "city": "Chennai City"}, headers=rep).status_code == 201
    r = client.post(f"{API}/options/cities/reset", headers=sa).json()
    got = {i["value"]: i["active"] for i in r["items"]}
    assert got["Chennai"] is True and got["Chennai City"] is False  # the record keeps its value, no longer offered
    assert client.post(f"{API}/options/cities/reset", headers=sa).status_code == 200
