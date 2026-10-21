"""Task assignment notifications, change notifications, the standard due-date reminders (1 day / 5 hours / 1 hour) and overdue alerts."""
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import select

from app.db.session import get_session_factory
from app.models import Notification
from app.services import tasks as svc
from tests.conftest import headers_of, login, make_account

API = "/api/v1"
TZ = ZoneInfo("Asia/Kolkata")


def person(client, sa, name, branch="Salem", role="Sales Executive", level="Employee", department="Sales"):
    make_account(client, sa, first=name, last="T", level=level, branch=branch, role=role, username=f"{name.lower()}.t", department=department)
    return headers_of(login(client, f"{name.lower()}.t"))


def me(client, h):
    return client.get(f"{API}/auth/me", headers=h).json()["id"]


def notes(user_id, type=None):
    with get_session_factory()() as db:
        q = select(Notification).where(Notification.user_id == user_id)
        if type:
            q = q.where(Notification.type == type)
        return list(db.execute(q.order_by(Notification.created_at)).scalars())


def run_engine(now):
    with get_session_factory()() as db:
        out = svc.run_engine(db, now)
        db.commit()
        return out


def due_in(minutes_from_now):
    """(date, 'HH:MM') in the organisation's time zone for a moment some minutes from now, and the exact moment as an aware datetime."""
    when = (datetime.now(UTC) + timedelta(minutes=minutes_from_now)).astimezone(TZ).replace(second=0, microsecond=0)
    return when.date().isoformat(), when.strftime("%H:%M"), when


def make_task(client, h, assignee=None, minutes=3 * 1440, **extra):
    d, t, when = due_in(minutes)
    body = {"title": "Send the revised quote", "priority": "High", "dueDate": d, "dueTime": t, **extra}
    if assignee:
        body["assignees"] = [assignee]
    r = client.post(f"{API}/tasks", json=body, headers=h)
    assert r.status_code == 201, r.text
    return r.json(), when.astimezone(UTC)


# ---- assignment ------------------------------------------------------------------------------------------------------------
def test_assignment_notifies_the_assignee_with_assigner_title_priority_and_due_and_links_to_the_task(client, sa):
    boss = person(client, sa, "Meena", role="Sales Manager")
    emp = person(client, sa, "Ravi")
    t, _ = make_task(client, boss, me(client, emp))
    [n] = notes(me(client, emp), "Task Assigned")
    assert "Meena T" in n.message and "Send the revised quote" in n.message and "High-priority" in n.message and "due " in n.message and ":" in n.message
    assert n.related_type == "Task" and n.related_id == t["id"] and n.task_id == t["id"] and n.read is False and n.branch == "Salem"
    assert notes(me(client, boss)) == []  # the person who assigned it is not told about their own action
    # the assignee sees it in their own list (and nobody else does)
    listed = client.get(f"{API}/notifications", params={"all": "true"}, headers=emp).json()
    assert [x["relatedId"] for x in listed if x["type"] == "Task Assigned"] == [t["id"]]
    other = person(client, sa, "Bala")
    assert client.get(f"{API}/notifications", params={"all": "true"}, headers=other).json() == []


def test_assigning_to_yourself_sends_nothing_and_unassigned_tasks_notify_nobody(client, sa):
    h = person(client, sa, "Asha")
    make_task(client, h)
    make_task(client, h, assignees=[])
    assert notes(me(client, h)) == []


def test_a_task_can_only_go_to_people_of_its_own_branch(client, sa):
    boss = person(client, sa, "Meena", role="Sales Manager", branch="Salem")
    far = person(client, sa, "Mira", branch="Mumbai")
    r = client.post(f"{API}/tasks", json={"title": "Cross-branch", "assignees": [me(client, far)]}, headers=boss)
    assert r.status_code in (404, 422), r.text  # a Salem manager cannot even see the Mumbai employee
    # the Super Admin working in Salem is held to the same branch wall (the Mumbai employee is not part of what she is looking at)
    r = client.post(f"{API}/tasks", json={"title": "Cross-branch", "assignees": [me(client, far)]}, headers={**sa, "X-Branch-Scope": "Salem"})
    assert r.status_code == 422, r.text
    assert notes(me(client, far)) == []
    # working in Mumbai she can assign Mira, and Mira is notified in her own branch
    ok = client.post(f"{API}/tasks", json={"title": "Mumbai job", "assignees": [me(client, far)]}, headers={**sa, "X-Branch-Scope": "Mumbai"})
    assert ok.status_code == 201 and ok.json()["branch"] == "Mumbai"
    [n] = notes(me(client, far), "Task Assigned")
    assert n.branch == "Mumbai" and n.related_id == ok.json()["id"]


# ---- changes ---------------------------------------------------------------------------------------------------------------
def test_priority_and_due_date_changes_notify_the_assignee_once_and_in_one_message(client, sa):
    boss = person(client, sa, "Meena", role="Sales Manager")
    emp = person(client, sa, "Ravi")
    t, _ = make_task(client, boss, me(client, emp))
    d, tm, _ = due_in(5 * 1440)
    r = client.put(f"{API}/tasks/{t['id']}", json={"priority": "Urgent", "dueDate": d, "dueTime": tm}, headers=boss)
    assert r.status_code == 200, r.text
    [n] = notes(me(client, emp), "Task Updated")
    assert "Meena T" in n.message and "priority High → Urgent" in n.message and "due date" in n.message and "Urgent priority" in n.message and n.related_id == t["id"]
    # saving the same values again changes nothing, so nothing is sent
    client.put(f"{API}/tasks/{t['id']}", json={"priority": "Urgent", "dueDate": d, "dueTime": tm}, headers=boss)
    assert len(notes(me(client, emp), "Task Updated")) == 1
    assert notes(me(client, boss)) == []


def test_reassigning_tells_the_new_person_in_full_and_the_old_person_briefly(client, sa):
    boss = person(client, sa, "Meena", role="Sales Manager")
    a = person(client, sa, "Asha")
    b = person(client, sa, "Bala")
    t, _ = make_task(client, boss, me(client, a))
    r = client.put(f"{API}/tasks/{t['id']}", json={"assignees": [me(client, b)], "reason": "Asha is on leave"}, headers=boss)
    assert r.status_code == 200, r.text
    [new] = notes(me(client, b), "Task Assigned")
    assert "assigned you" in new.message and "Send the revised quote" in new.message and new.related_id == t["id"]
    old = notes(me(client, a), "Task Updated")
    assert len(old) == 1 and "no longer on your list" in old[0].message
    assert len(notes(me(client, a), "Task Assigned")) == 1  # the first assignment, not repeated


# ---- reminders -------------------------------------------------------------------------------------------------------------
def test_the_three_reminders_are_sent_once_each_at_their_moments_to_the_assignee_only(client, sa):
    boss = person(client, sa, "Meena", role="Sales Manager")
    emp = person(client, sa, "Ravi")
    other = person(client, sa, "Bala")
    t, due = make_task(client, boss, me(client, emp), minutes=3 * 1440)
    assert run_engine(due - timedelta(hours=30))["dueReminders"] == 0  # too early for any of them
    assert run_engine(due - timedelta(hours=23, minutes=50))["dueReminders"] == 1
    assert run_engine(due - timedelta(hours=23, minutes=40))["dueReminders"] == 0  # once
    assert run_engine(due - timedelta(hours=4, minutes=55))["dueReminders"] == 1
    assert run_engine(due - timedelta(minutes=55))["dueReminders"] == 1
    assert run_engine(due - timedelta(minutes=50))["dueReminders"] == 0
    got = notes(me(client, emp), "Task Reminder")
    assert len(got) == 3
    assert "23 hours 50 minutes" in got[0].message and "4 hours 55 minutes" in got[1].message and "55 minutes" in got[2].message
    assert all("Send the revised quote" in n.message and t["dueDate"].split("-")[2] in n.message and n.related_id == t["id"] for n in got)
    assert notes(me(client, other), "Task Reminder") == [] and notes(me(client, boss), "Task Reminder") == []


def test_only_applicable_reminders_are_sent_for_a_task_raised_close_to_its_due_time(client, sa):
    h = person(client, sa, "Asha")
    soon, due_soon = make_task(client, h, minutes=40)  # raised 40 minutes before it is due: no reminder interval is still ahead
    mid, due_mid = make_task(client, h, minutes=180, title="Three hours left")  # 1 day and 5 hours have passed already, 1 hour has not
    for moment in (due_soon - timedelta(minutes=30), due_soon - timedelta(minutes=5), due_mid - timedelta(hours=2), due_mid - timedelta(minutes=58)):
        run_engine(moment)
    mine = {n.related_id: n for n in notes(me(client, h), "Task Reminder")}
    assert soon["id"] not in mine
    assert list(mine) == [mid["id"]] and "58 minutes" in mine[mid["id"]].message
    assert len(notes(me(client, h), "Task Reminder")) == 1


def test_a_missed_window_sends_only_the_closest_reminder_not_a_burst(client, sa):
    h = person(client, sa, "Asha")
    t, due = make_task(client, h, minutes=3 * 1440)
    assert run_engine(due - timedelta(minutes=20))["dueReminders"] == 1  # the engine was down: 1 day, 5 hours and 1 hour have all passed - one reminder, saying 20 minutes are left
    assert run_engine(due - timedelta(minutes=10))["dueReminders"] == 0
    [n] = notes(me(client, h), "Task Reminder")
    assert "20 minutes" in n.message


def test_changing_the_due_date_recalculates_the_reminders(client, sa):
    h = person(client, sa, "Asha")
    t, due = make_task(client, h, minutes=3 * 1440)
    assert run_engine(due - timedelta(hours=23, minutes=50))["dueReminders"] == 1
    d, tm, new_due = due_in(6 * 1440)
    assert client.put(f"{API}/tasks/{t['id']}", json={"dueDate": d, "dueTime": tm}, headers=h).status_code == 200
    new_due = new_due.astimezone(UTC)
    assert run_engine(due - timedelta(hours=4, minutes=55))["dueReminders"] == 0  # the old schedule is gone
    assert run_engine(new_due - timedelta(hours=23, minutes=50))["dueReminders"] == 1  # and the new one starts over
    assert len(notes(me(client, h), "Task Reminder")) == 2


def test_completed_or_cancelled_tasks_get_no_more_reminders(client, sa):
    h = person(client, sa, "Asha")
    done, due = make_task(client, h, minutes=3 * 1440)
    gone, due2 = make_task(client, h, minutes=3 * 1440, title="Cancel me")
    assert client.post(f"{API}/tasks/{done['id']}/complete", json={}, headers=h).status_code == 200
    assert client.post(f"{API}/tasks/{gone['id']}/cancel", json={"reason": "No longer needed"}, headers=h).status_code == 200
    assert run_engine(due - timedelta(hours=23, minutes=50))["dueReminders"] == 0
    assert notes(me(client, h), "Task Reminder") == []


def test_the_administrator_chooses_which_reminders_are_sent(client, sa):
    h = person(client, sa, "Asha")
    r = client.put(f"{API}/tasks/settings", json={"reminders": {"enabled": True, "intervals": [60, 999]}}, headers=sa)  # 999 is not an offered choice
    assert r.status_code == 200 and r.json()["reminders"]["intervals"] == [60]
    assert client.get(f"{API}/tasks/me", headers=h).json()["settings"]["reminders"]["intervals"] == [60]
    assert client.put(f"{API}/tasks/settings", json={"reminders": {"enabled": True}}, headers=h).status_code == 403
    t, due = make_task(client, h, minutes=3 * 1440)
    run_engine(due - timedelta(hours=23, minutes=50))
    run_engine(due - timedelta(minutes=55))
    assert [("1 day" in n.message) for n in notes(me(client, h), "Task Reminder")] == [False]
    client.put(f"{API}/tasks/settings", json={"reminders": {"enabled": False}}, headers=sa)
    t2, due2 = make_task(client, h, minutes=3 * 1440, title="Quiet one")
    assert run_engine(due2 - timedelta(minutes=55))["dueReminders"] == 0


# ---- overdue ---------------------------------------------------------------------------------------------------------------
def test_an_unfinished_task_past_its_due_time_is_overdue_and_the_assignee_is_told_once(client, sa):
    boss = person(client, sa, "Meena", role="Sales Manager")
    emp = person(client, sa, "Ravi")
    t, due = make_task(client, boss, me(client, emp), minutes=90)
    assert client.get(f"{API}/tasks/{t['id']}", headers=emp).json()["overdue"] is False
    assert run_engine(due + timedelta(minutes=5))["overdue"] == 1
    assert run_engine(due + timedelta(minutes=30))["overdue"] == 0  # same level: not repeated
    [n] = notes(me(client, emp), "Task Overdue")
    assert "overdue" in n.message and "Send the revised quote" in n.message and "High priority" in n.message and n.related_id == t["id"]
    # the policy repeats it only as it gets later (3 days, 7 days)
    assert run_engine(due + timedelta(days=3, hours=1))["overdue"] == 1
    assert len(notes(me(client, emp), "Task Overdue")) == 2
    # a completed task is never reported
    t2, due2 = make_task(client, boss, me(client, emp), minutes=60, title="Done in time")
    client.post(f"{API}/tasks/{t2['id']}/complete", json={}, headers=emp)
    run_engine(due2 + timedelta(hours=1))
    assert all(n.related_id != t2["id"] for n in notes(me(client, emp), "Task Overdue"))
