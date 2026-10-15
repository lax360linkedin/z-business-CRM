from datetime import date, timedelta

from sqlalchemy import select

from app.db.session import get_session_factory
from app.models import Activity, Notification, Task
from tests.conftest import headers_of, login, make_account

API = "/api/v1"


def person(client, sa, name, branch="Salem", role="Sales Executive", level="Employee", department="Sales"):
    make_account(client, sa, first=name, last="T", level=level, branch=branch, role=role, username=f"{name.lower()}.t", department=department)
    return headers_of(login(client, f"{name.lower()}.t"))


def me(client, h):
    return client.get(f"{API}/auth/me", headers=h).json()["id"]


def new_task(client, h, **extra):
    r = client.post(f"{API}/tasks", json={"title": "Call the client", "dueDate": (date.today() + timedelta(days=2)).isoformat(), **extra}, headers=h)
    assert r.status_code == 201, r.text
    return r.json()


def test_create_defaults_assign_to_self_and_log_events(client, sa):
    h = person(client, sa, "Asha")
    t = new_task(client, h)
    assert t["id"].startswith("TSK-") and t["status"] == "To Do" and t["assignees"] == [me(client, h)] and t["assignedTo"] == me(client, h)
    assert t["_can"]["complete"] and t["overdue"] is False
    detail = client.get(f"{API}/tasks/{t['id']}/detail", headers=h).json()
    assert [e["type"] for e in detail["events"]] == ["Assigned", "Created"]


def test_validation(client, sa):
    h = person(client, sa, "Asha")
    for body, field in (({"title": " "}, "title"), ({"title": "x", "priority": "Huge"}, "priority"), ({"title": "x", "dueDate": "tomorrow"}, "dueDate"),
                        ({"title": "x", "startDate": "2026-12-05", "dueDate": "2026-12-01"}, "dueDate"), ({"title": "x", "reminderMinutes": "30"}, "reminderMinutes"), ({"title": "x", "visibility": "Everyone"}, "visibility")):
        r = client.post(f"{API}/tasks", json=body, headers=h)
        assert r.status_code == 422 and field in r.json()["fields"], (body, r.text)


def test_status_workflow_rules(client, sa):
    h = person(client, sa, "Asha")
    t = new_task(client, h)
    assert client.post(f"{API}/tasks/{t['id']}/reopen", json={}, headers=h).status_code == 409  # not closed
    assert client.post(f"{API}/tasks/{t['id']}/cancel", json={}, headers=h).status_code == 422  # reason required
    done = client.post(f"{API}/tasks/{t['id']}/complete", json={"note": "Spoke to them"}, headers=h)
    assert done.status_code == 200 and done.json()["status"] == "Completed" and done.json()["completedAt"]
    assert client.post(f"{API}/tasks/{t['id']}/status", json={"status": "In Progress"}, headers=h).status_code == 409  # completed tasks only reopen
    assert client.put(f"{API}/tasks/{t['id']}", json={"title": "Edited"}, headers=h).status_code == 409
    assert client.post(f"{API}/tasks/{t['id']}/reopen", json={"reason": "More to do"}, headers=h).json()["status"] == "Reopened"


def test_completing_a_linked_task_writes_the_activity_and_withdraws_it_on_reopen(client, sa):
    h = person(client, sa, "Asha")
    company = client.post(f"{API}/companies", json={"name": "Link Co"}, headers=h).json()
    t = new_task(client, h, relatedType="Company", relatedId=company["id"], taskType="Call")
    assert t["relatedName"] == "Link Co" and t["links"]["companyId"] == company["id"]
    client.post(f"{API}/tasks/{t['id']}/complete", json={}, headers=h)
    with get_session_factory()() as db:
        acts = db.execute(select(Activity).where(Activity.related_id == company["id"], Activity.type == "Task")).scalars().all()
        assert len(acts) == 1 and acts[0].status == "Completed" and acts[0].branch == "Salem"
    client.post(f"{API}/tasks/{t['id']}/reopen", json={"reason": "again"}, headers=h)
    with get_session_factory()() as db:
        assert db.execute(select(Activity).where(Activity.related_id == company["id"], Activity.type == "Task")).first() is None


def test_subtasks_block_completion_until_forced(client, sa):
    h = person(client, sa, "Asha")
    parent = new_task(client, h)
    sub = new_task(client, h, title="Sub", parentId=parent["id"])
    assert sub["parentId"] == parent["id"]
    assert client.post(f"{API}/tasks/{new_task(client, h, title='Nested', parentId=parent['id'])['id']}/complete", json={}, headers=h).status_code == 200
    blocked = client.post(f"{API}/tasks/{parent['id']}/complete", json={}, headers=h)
    assert blocked.status_code == 409 and blocked.json()["code"] == "OPEN_SUBTASKS"
    assert client.post(f"{API}/tasks/{parent['id']}/complete", json={"force": True}, headers=h).status_code == 200
    assert client.post(f"{API}/tasks", json={"title": "grandchild", "parentId": sub["id"]}, headers=h).status_code == 422  # one level only


def test_recurring_task_spawns_the_next_occurrence_once(client, sa):
    h = person(client, sa, "Asha")
    t = new_task(client, h, dueDate="2026-11-10", recurrence={"frequency": "weekly", "interval": 1})
    done = client.post(f"{API}/tasks/{t['id']}/complete", json={}, headers=h).json()
    assert done["nextTaskId"]
    nxt = client.get(f"{API}/tasks/{done['nextTaskId']}", headers=h).json()
    assert nxt["dueDate"] == "2026-11-17" and nxt["status"] == "To Do" and nxt["recurringRootId"] == t["id"]
    client.post(f"{API}/tasks/{t['id']}/reopen", json={"reason": "x"}, headers=h)
    client.post(f"{API}/tasks/{t['id']}/complete", json={}, headers=h)
    assert client.get(f"{API}/tasks", params={"all": "true"}, headers=h).json().__len__() == 2  # not a second copy


def test_assigning_others_needs_the_assign_permission_and_notifies(client, sa):
    emp = person(client, sa, "Ravi")
    boss = person(client, sa, "Meena", role="Sales Manager")
    ravi_id = me(client, emp)
    assert client.post(f"{API}/tasks", json={"title": "For Meena", "assignees": [me(client, boss)]}, headers=emp).status_code == 403
    t = client.post(f"{API}/tasks", json={"title": "Do this", "assignees": [ravi_id]}, headers=boss)
    assert t.status_code == 201
    with get_session_factory()() as db:
        n = db.execute(select(Notification).where(Notification.user_id == ravi_id, Notification.type == "Task Assigned")).scalars().all()
        assert len(n) == 1 and "Do this" in n[0].message
    assert client.get(f"{API}/tasks/me", headers=emp).json()["perms"]["assign"] is False


def test_visibility_private_tasks_stay_private_and_managers_see_their_team(client, sa):
    a = person(client, sa, "Asha")
    b = person(client, sa, "Bala")
    boss = person(client, sa, "Meena", role="Sales Manager")
    private = new_task(client, a, title="Secret", visibility="Private")
    team = new_task(client, a, title="Shared", visibility="Team")
    seen_by_b = {t["title"] for t in client.get(f"{API}/tasks", params={"all": "true"}, headers=b).json()}
    assert seen_by_b == set()  # an employee does not get team-level visibility: only managers do
    assert client.get(f"{API}/tasks/{private['id']}", headers=b).status_code == 403
    seen_by_boss = {t["title"] for t in client.get(f"{API}/tasks", params={"all": "true"}, headers=boss).json()}
    assert seen_by_boss == {"Shared"}
    assert client.get(f"{API}/tasks/{team['id']}", headers=boss).status_code == 200
    assert {t["title"] for t in client.get(f"{API}/tasks", params={"all": "true"}, headers=sa).json()} == {"Secret", "Shared"}


def test_tasks_are_branch_scoped(client, sa):
    salem = person(client, sa, "Asha", branch="Salem")
    mumbai = person(client, sa, "Mira", branch="Mumbai")
    salem_task = new_task(client, salem, visibility="Organization")
    assert client.get(f"{API}/tasks/{salem_task['id']}", headers=mumbai).status_code == 404
    assert client.get(f"{API}/tasks", params={"all": "true"}, headers=mumbai).json() == []
    assert salem_task["branch"] == "Salem"


def test_comments_and_mentions_follow_the_task(client, sa):
    a = person(client, sa, "Asha")
    b = person(client, sa, "Bala")
    t = new_task(client, a, visibility="Organization")
    r = client.post(f"{API}/tasks/{t['id']}/comments", json={"text": "Over to you @Bala", "mentions": [me(client, b)]}, headers=a)
    assert r.status_code == 201 and r.json()["type"] == "Comment"
    assert client.get(f"{API}/tasks/{t['id']}", headers=b).json()["watchers"] == [me(client, b)]
    assert client.post(f"{API}/tasks/{t['id']}/comments", json={"text": " "}, headers=a).status_code == 422


def test_engine_sends_reminders_and_overdue_alerts_once(client, sa):
    h = person(client, sa, "Asha")
    yesterday = (date.today() - timedelta(days=2)).isoformat()
    t = new_task(client, h, dueDate=yesterday)
    admin = headers_of(login(client, "root@lax360.com", "Root@Pass123"))
    first = client.post(f"{API}/tasks/engine/run", headers=admin).json()
    assert first["overdue"] >= 1
    second = client.post(f"{API}/tasks/engine/run", headers=admin).json()
    assert second["overdue"] == 0  # already alerted at this level
    assert client.post(f"{API}/tasks/engine/run", headers=h).status_code == 403
    assert client.get(f"{API}/tasks/{t['id']}", headers=h).json()["overdue"] is True


def test_delete_needs_permission_and_removes_subtasks(client, sa):
    h = person(client, sa, "Asha")
    admin_perms = {"Tasks": {"view": True, "create": True, "edit": True, "delete": True, "export": True}, "Dashboard": {"view": True}}
    make_account(client, sa, first="Del", last="T", branch="Salem", role="Project Manager", username="del.t", permissions=admin_perms)
    d = headers_of(login(client, "del.t"))
    t = new_task(client, d)
    s = new_task(client, d, title="child", parentId=t["id"])
    assert client.delete(f"{API}/tasks/{t['id']}", headers=h).status_code == 403
    assert client.delete(f"{API}/tasks/{t['id']}", headers=d).status_code == 200
    assert client.get(f"{API}/tasks/{s['id']}", headers=d).status_code == 404
