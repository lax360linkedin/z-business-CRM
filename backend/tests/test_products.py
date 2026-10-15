"""Products & Services: the standard catalogue, categories added without code, who can list it, how it stays connected to the modules that pick from it, and the server-side
guards (unique code, no delete while anything uses it, rename carried to the records that point at it)."""
from sqlalchemy import select

from app.db.session import get_session_factory
from app.models import Product, Quotation
from app.services import catalogue
from tests.test_lead_sources import who

API = "/api/v1"


def listing(client, h):
    r = client.get(f"{API}/products", params={"all": "true"}, headers=h)
    assert r.status_code == 200, r.text
    return r.json()


def test_the_standard_categories_and_services_exist(client, sa):
    rows = listing(client, sa)
    by_name = {r["name"]: r for r in rows}
    for category, prefix, services in catalogue.CATALOGUE:
        for name in services:
            r = by_name[name]
            assert r["category"] == category and r["status"] == "Active" and r["type"] == "Service" and r["code"].startswith(prefix + "-") and r["price"] == 0
    assert len(rows) == 22 and len({r["code"] for r in rows}) == 22
    cats = client.get(f"{API}/products/categories", headers=sa).json()["categories"]
    assert cats[:4] == ["Software & IT Services", "Digital Marketing", "CAD Services", "AI & Automation"]


def test_seeding_again_changes_nothing_and_respects_edits(client, sa):
    pid = next(r["id"] for r in listing(client, sa) if r["name"] == "SEO")
    assert client.put(f"{API}/products/{pid}", json={"name": "Search Engine Optimisation", "price": 15000}, headers=sa).status_code == 200
    with get_session_factory()() as db:
        assert catalogue.seed_catalogue(db) == 1  # only the renamed one is missing by its standard name; nothing else is touched
        db.commit()
    rows = listing(client, sa)
    assert len(rows) == 23 and next(r for r in rows if r["id"] == pid)["price"] == 15000


def test_categories_are_data_and_a_product_must_use_one(client, sa):
    sales = who(client, sa, "rep", "Sales Executive", "Salem")
    assert client.post(f"{API}/products/categories", json={"name": "Training"}, headers=sales).status_code == 403
    bad = client.post(f"{API}/products", json={"name": "Workshop", "category": "Training", "price": 100}, headers=sa)
    assert bad.status_code == 422 and bad.json()["fields"]["category"]
    added = client.post(f"{API}/products/categories", json={"name": "Training"}, headers=sa)
    assert added.status_code == 201 and "Training" in added.json()["categories"]
    assert client.post(f"{API}/products/categories", json={"name": " training "}, headers=sa).status_code == 422
    assert client.post(f"{API}/products", json={"name": "Workshop", "category": "Training", "price": 100}, headers=sa).status_code == 201
    assert "Training" in client.get(f"{API}/products/categories", headers=sales).json()["categories"]  # everyone who picks products sees the list


def test_everyone_who_picks_a_product_can_list_the_catalogue(client, sa):
    sales = who(client, sa, "rep", "Sales Executive", "Salem")  # no Products & Services screen, but works with leads, enquiries, deals and quotations
    assert len(listing(client, sales)) == 22
    assert client.post(f"{API}/products", json={"name": "Sneaky", "price": 1}, headers=sales).status_code == 403  # listing is not editing
    plain = who(client, sa, "emp", "Employee", "Salem")  # dashboard only
    assert listing(client, plain) == []


def test_item_code_is_unique_on_the_server(client, sa):
    taken = next(r["code"] for r in listing(client, sa) if r["name"] == "Google Ads")
    dup = client.post(f"{API}/products", json={"name": "Another", "code": taken.lower(), "price": 5}, headers=sa)
    assert dup.status_code == 409 and "item code" in dup.json()["message"]


def test_a_rename_reaches_the_records_that_point_at_the_product(client, sa):
    rep = who(client, sa, "rep", "Sales Executive", "Salem")
    seo = next(r for r in listing(client, sa) if r["name"] == "SEO")
    lead = client.post(f"{API}/leads", json={"name": "Asha", "service": "SEO", "productId": seo["id"]}, headers=rep).json()
    enq = client.post(f"{API}/enquiries", json={"name": "Bala", "interestedService": "SEO", "interestedProduct": "Something else", "productId": seo["id"]}, headers=rep).json()
    assert client.put(f"{API}/products/{seo['id']}", json={"name": "SEO & Content"}, headers=sa).status_code == 200
    assert client.get(f"{API}/leads/{lead['id']}", headers=rep).json()["service"] == "SEO & Content"
    got = client.get(f"{API}/enquiries/{enq['id']}", headers=rep).json()
    assert got["interestedService"] == "SEO & Content" and got["interestedProduct"] == "Something else"  # only a field that held the old name follows


def test_a_product_in_use_cannot_be_deleted(client, sa):
    rep = who(client, sa, "rep", "Sales Executive", "Salem")
    rows = {r["name"]: r for r in listing(client, sa)}
    used, linked, free = rows["Civil CAD"], rows["Meta Ads"], rows["Branding"]
    client.post(f"{API}/leads", json={"name": "Asha", "service": "Civil CAD", "productId": used["id"]}, headers=rep)
    blocked = client.delete(f"{API}/products/{used['id']}", headers=sa)
    assert blocked.status_code == 409 and blocked.json()["code"] == "IN_USE" and "Deactivate" in blocked.json()["message"]
    with get_session_factory()() as db:  # a quotation line that merely names the product (documents keep their own snapshot) counts too
        db.add(Quotation(id="QUO-T1", number="QUO-2026-T1", branch="Salem", attributes={"items": [{"productId": linked["id"], "name": "Meta Ads", "qty": 1}]}))
        db.commit()
    assert client.delete(f"{API}/products/{linked['id']}", headers=sa).status_code == 409
    assert client.get(f"{API}/products/{linked['id']}/usage", headers=sa).json()["quotations"] == 1
    assert client.put(f"{API}/products/{used['id']}", json={"status": "Inactive"}, headers=sa).status_code == 200  # deactivating is always allowed
    assert client.delete(f"{API}/products/{free['id']}", headers=sa).status_code == 200
    with get_session_factory()() as db:
        assert db.execute(select(Product.id).where(Product.id == free["id"])).first() is None


def test_global_search_finds_products(client, sa):
    hits = client.get(f"{API}/search", params={"q": "chatbot"}, headers=sa).json()
    assert any(h["type"] == "Product" and h["title"] == "AI Chatbots" for h in hits)


# ---- managing categories ------------------------------------------------------------------------------------------------------------------
def cats(client, h):
    return client.get(f"{API}/products/categories", headers=h).json()["categories"]


def test_renaming_a_category_reaches_every_product_and_picker(client, sa):
    r = client.put(f"{API}/products/categories/Digital%20Marketing", json={"name": "Marketing & Ads"}, headers=sa)
    assert r.status_code == 200 and "Marketing & Ads" in r.json()["categories"] and "Digital Marketing" not in r.json()["categories"]
    assert r.json()["categories"].index("Marketing & Ads") == 1  # keeps its place in the list
    rows = listing(client, sa)
    assert {x["category"] for x in rows if x["name"] in ("SEO", "Google Ads")} == {"Marketing & Ads"} and not any(x["category"] == "Digital Marketing" for x in rows)
    assert client.post(f"{API}/products", json={"name": "Podcasts", "category": "Marketing & Ads", "price": 1}, headers=sa).status_code == 201  # the new name is selectable at once
    assert client.post(f"{API}/products", json={"name": "Old name", "category": "Digital Marketing", "price": 1}, headers=sa).status_code == 422  # the old one is gone


def test_category_names_are_unique_and_clean(client, sa):
    dup = client.put(f"{API}/products/categories/CAD%20Services", json={"name": " ai & automation "}, headers=sa)
    assert dup.status_code == 422 and dup.json()["fields"]["name"]
    assert client.put(f"{API}/products/categories/CAD%20Services", json={"name": "x"}, headers=sa).status_code == 422
    assert client.put(f"{API}/products/categories/CAD%20Services", json={"name": "CAD / Drafting"}, headers=sa).status_code == 422
    assert client.put(f"{API}/products/categories/Nope", json={"name": "Whatever"}, headers=sa).status_code == 404
    assert client.put(f"{API}/products/categories/CAD%20Services", json={"name": "cad services"}, headers=sa).status_code == 200  # a change of case is a rename of itself, not a clash
    assert "cad services" in cats(client, sa)


def test_deleting_a_category_needs_its_products_moved(client, sa):
    assert client.post(f"{API}/products/categories", json={"name": "Training"}, headers=sa).status_code == 201
    assert client.delete(f"{API}/products/categories/Training", headers=sa).status_code == 200  # empty: simply removed
    assert "Training" not in cats(client, sa)
    blocked = client.delete(f"{API}/products/categories/CAD%20Services", headers=sa)
    assert blocked.status_code == 409 and blocked.json()["code"] == "IN_USE" and "5 product" in blocked.json()["message"]
    assert client.delete(f"{API}/products/categories/CAD%20Services", params={"moveTo": "CAD Services"}, headers=sa).status_code == 422  # not into itself
    moved = client.delete(f"{API}/products/categories/CAD%20Services", params={"moveTo": "Digital Marketing"}, headers=sa)
    assert moved.status_code == 200 and "CAD Services" not in moved.json()["categories"]
    rows = {x["name"]: x for x in listing(client, sa)}
    assert rows["Civil CAD"]["category"] == "Digital Marketing" and len(rows) == 22  # nothing was lost
    assert client.delete(f"{API}/products/categories/Missing", headers=sa).status_code == 404


def test_only_people_with_product_rights_manage_categories(client, sa):
    sales = who(client, sa, "rep", "Sales Executive", "Salem")
    assert client.put(f"{API}/products/categories/CAD%20Services", json={"name": "Drafting"}, headers=sales).status_code == 403
    assert client.delete(f"{API}/products/categories/AI%20%26%20Automation", params={"moveTo": "CAD Services"}, headers=sales).status_code == 403
    assert "AI & Automation" in cats(client, sales)  # but everyone who picks products sees the current list


def test_a_category_that_only_exists_through_its_products_can_be_renamed_and_removed(client, sa):
    with get_session_factory()() as db:
        db.add(Product(id="PRD-L1", name="Legacy item", category="Software", price=10, attributes={}))
        db.commit()
    assert "Software" in cats(client, sa)
    assert client.put(f"{API}/products/categories/Software", json={"name": "Legacy Software"}, headers=sa).status_code == 200
    assert next(x for x in listing(client, sa) if x["id"] == "PRD-L1")["category"] == "Legacy Software"
    assert client.delete(f"{API}/products/categories/Legacy%20Software", params={"moveTo": "Digital Marketing"}, headers=sa).status_code == 200
    assert "Legacy Software" not in cats(client, sa)
