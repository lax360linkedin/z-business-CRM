# Task assignment, notifications and reminders

## Assigning
Anyone with the *assign* right (Admin, managers, HR by default; set per role in Tasks → Task settings → Permissions) can give a task to one or more employees. Fields: title, description, priority, assignee(s), start date, due date (and time), status. A task belongs to one branch and can only be given to people of that branch (the branch wall of the app already hides other branches' people; the task service refuses it as well). Team assignments expand inside the task's branch only.

## Notifications (in-app; bell, the badge on *Tasks* in the menu, Notifications)
| Event | Who is told | Text (type) |
| --- | --- | --- |
| Task assigned (new task, or newly added assignee) | each new assignee, not the person who assigned | "Meena assigned you a High-priority task: “…” - due Fri 23 Oct 2026, 5:00 PM" (*Task Assigned*) |
| Priority and/or due date changed | everyone already on the task, once, in one message | "Meena changed “…”: priority High → Urgent; due date … → …. Now Urgent priority, due …" (*Task Updated*) |
| Reassigned | the new person gets the assignment message; the previous one is told it is no longer on their list | *Task Assigned* / *Task Updated* |
| Reminder | the assignees | "Reminder: “…” is due in 23 hours 50 minutes (Fri 23 Oct 2026, 5:00 PM). High priority." (*Task Reminder*) |
| Overdue | the assignees (and the manager from the escalation day) | "“…” is overdue (Overdue 1 day): it was due … . Urgent priority." (*Task Overdue*) |

Clicking a notification (bell or Notifications) marks it read and opens the task (`/tasks/<id>`). Each notification is created in the *recipient's* branch, so the right person sees it wherever the task was raised. Every notification has a key built from the event (the log entry that caused it, the due moment and the reminder interval); the same event can never be announced twice to the same person, and saving a task without changes sends nothing. Administrators can switch a whole type off in Administration → Notification Settings.

## Due-date reminders
Default 1 day, 5 hours and 1 hour before the due time; Task settings → Reminders & uploads lets an administrator switch the feature off or choose any of 2 days, 1 day, 12 h, 5 h, 3 h, 1 h, 30 min, 15 min.
* The due moment is the task's date and time in the organisation's time zone (`ORG_TIMEZONE`, default Asia/Kolkata); a task without a time is due at 23:59 that day.
* Only reminders still ahead when the due date was set: a task created 40 minutes before it is due gets none; one created 3 hours before gets only the 1-hour reminder.
* Each reminder is sent once per task, person and interval. If the server was not running at the exact moment the closest applicable one is sent when it is back (with the time really left); the longer ones that were also missed are skipped, not sent late in a burst.
* Changing the due date or time starts over (outdated pending reminders disappear, new ones are computed from that moment). Completed, cancelled or overdue tasks get none. A person's own per-task reminder (the "Reminder" field) still works; the standard one of the same length is not repeated.
* Runs in the server's timer job (`tasks`, every `SCHEDULER_INTERVAL_SECONDS`, 120 s by default) and by hand with *Run automation now*. If the hosting puts the server to sleep, reminders are late by that long.

## Overdue
An open task past its due moment is shown as overdue (red, with the overdue tab and count) and the assignee is told once; it is repeated only by the existing policy at 3 and 7 days (the manager from the escalation day set in Task settings). Completing or cancelling the task stops it.

## Task page
Metric tiles (total, mine, due today, upcoming, overdue, high priority, in progress, completed, unassigned), views (my tasks, list, kanban, calendar, team, overdue, today, upcoming, completed, unassigned), filters by assignee, status, priority, **branch** (Super Admin), due date range, team, department, type and more, and a strip showing the unread task notifications (open one, or mark all read). People see their own tasks and what their role may see in their branch; the server decides.

Code: `backend/app/services/tasks.py` (`alert`, `due_reminders`, `run_engine`, `edit_task`), `backend/tests/test_task_notifications.py`, `frontend/src/hooks/useNotifications.js`, `pages/Tasks/*`.
