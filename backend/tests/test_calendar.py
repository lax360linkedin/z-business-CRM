from datetime import date, timedelta

from tests.conftest import headers_of, login, make_account

API = "/api/v1"


def rep(client, sa, name="Asha", role="Sales Executive", **extra):
    make_account(client, sa, first=name, last="Cal", branch="Salem", role=role, username=f"{name.lower()}.cal", **extra)
    h = headers_of(login(client, f"{name.lower()}.cal"))
    return h, client.get(f"{API}/auth/me", headers=h).json()["id"]


def events(client, h, **params):
    r = client.get(f"{API}/calendar/events", params=params, headers=h)
    assert r.status_code == 200, r.text
    return r.json()["events"]


def test_calendar_assembles_tasks_meetings_followups_and_reminders(client, sa):
    h, me = rep(client, sa)
    day = lambda n: (date.today() + timedelta(days=n)).isoformat()  # noqa: E731
    lead = client.post(f"{API}/leads", json={"name": "Calendar Lead", "company": "Cal Co", "assignedTo": me, "nextFollowUp": day(4)}, headers=h).json()
    task = client.post(f"{API}/tasks", json={"title": "Send brochure", "dueDate": day(1), "dueTime": "10:00", "relatedType": "Lead", "relatedId": lead["id"], "reminderMinutes": "30"}, headers=h)
    assert task.status_code == 201, task.text
    meeting = client.post(f"{API}/activities/log", json={"type": "Meeting", "subject": "Kick-off", "relatedType": "Lead", "relatedId": lead["id"], "date": day(2), "time": "15:30", "endTime": "16:00",
                                                         "meetingType": "Online Meeting"}, headers=h)
    assert meeting.status_code == 201, meeting.text
    by_id = {e["id"]: e for e in events(client, h)}
    t = by_id[f"task:{task.json()['id']}"]
    assert t["kind"] == "task" and t["date"] == day(1) and t["time"] == "10:00" and t["can"]["complete"] and t["related"][0]["type"] == "Lead"
    m = by_id[f"activity:{meeting.json()['id']}"]
    assert m["kind"] == "meeting" and m["time"] == "15:30" and m["endTime"] == "16:00" and m["state"] == "open" and m["can"]["reschedule"] is True
    assert f"reminder:activity:{meeting.json()['id']}" in by_id and f"reminder:task:{task.json()['id']}" in by_id  # reminders still to fire
    follow = by_id[f"followup:Lead:{lead['id']}"]
    assert follow["date"] == day(4) and follow["title"] == "Follow up: Calendar Lead" and follow["can"]["reschedule"]
    # a follow-up date that already has a task appears once
    client.put(f"{API}/leads/{lead['id']}", json={"nextFollowUp": day(1)}, headers=h)
    assert f"followup:Lead:{lead['id']}" not in {e["id"] for e in events(client, h)}
    # the window filter and ordering
    ranged = events(client, h, **{"from": day(2), "to": day(2)})
    assert {e["date"] for e in ranged} == {day(2)}
    assert [e["date"] for e in events(client, h)] == sorted(e["date"] for e in events(client, h))


def test_followup_reschedule_obeys_the_record_rules(client, sa):
    h, me = rep(client, sa)
    other, other_id = rep(client, sa, "Ben")
    lead = client.post(f"{API}/leads", json={"name": "Move me", "assignedTo": me}, headers=h).json()
    ok = client.post(f"{API}/calendar/followup/reschedule", json={"recordType": "Lead", "id": lead["id"], "date": "2031-01-05"}, headers=h)
    assert ok.status_code == 200 and client.get(f"{API}/leads/{lead['id']}", headers=h).json()["nextFollowUp"] == "2031-01-05"
    assert client.post(f"{API}/calendar/followup/reschedule", json={"recordType": "Lead", "id": lead["id"], "date": "soon"}, headers=h).status_code == 422
    assert client.post(f"{API}/calendar/followup/reschedule", json={"recordType": "Invoice", "id": "INV-1", "date": "2031-01-05"}, headers=h).status_code == 422
    assert client.post(f"{API}/calendar/followup/reschedule", json={"recordType": "Lead", "id": lead["id"], "date": "2031-02-05"}, headers=other).status_code == 404  # outside their scope
    assert client.post(f"{API}/calendar/followup/reschedule", json={"recordType": "Lead", "id": lead["id"], "date": "2031-02-05"}).status_code == 401


def test_each_person_sees_only_their_own_calendar(client, sa):
    h, me = rep(client, sa)
    other, other_id = rep(client, sa, "Ben")
    lead = client.post(f"{API}/leads", json={"name": "Private lead", "assignedTo": me, "nextFollowUp": (date.today() + timedelta(days=3)).isoformat()}, headers=h).json()
    client.post(f"{API}/tasks", json={"title": "Secret task", "dueDate": date.today().isoformat(), "visibility": "Private"}, headers=h)
    mine = {e["title"] for e in events(client, h)}
    theirs = {e["title"] for e in events(client, other)}
    assert "Secret task" in mine and "Follow up: Private lead" in mine
    assert "Secret task" not in theirs and "Follow up: Private lead" not in theirs
    assert {e["title"] for e in events(client, sa)} >= {"Follow up: Private lead"}
    make_account(client, sa, first="Nocal", last="User", role="Support", branch="Salem", username="nocal", permissions={"Dashboard": {"view": True, "create": False, "edit": False, "delete": False, "export": False}})
    assert client.get(f"{API}/calendar/events", headers=headers_of(login(client, "nocal"))).status_code == 403
    assert lead["id"]


def test_business_due_dates_appear_only_for_modules_the_role_can_open(client, sa):
    admin_h, _ = rep(client, sa, "Dana", role="Admin", level="Admin")
    exec_h, _ = rep(client, sa)
    soon = (date.today() + timedelta(days=6)).isoformat()
    cust = client.post(f"{API}/customers", json={"name": "Acme"}, headers=admin_h).json()
    project = client.post(f"{API}/projects", json={"name": "Rollout", "customerId": cust["id"], "projectType": "Implementation", "startDate": date.today().isoformat(), "deadline": soon}, headers=admin_h)
    assert project.status_code == 201, project.text
    titles = {e["title"] for e in events(client, admin_h)}
    assert any(t.startswith("Project deadline: Rollout") for t in titles)
    assert not any(t.startswith("Project deadline") for t in {e["title"] for e in events(client, exec_h)})  # executives cannot open projects
