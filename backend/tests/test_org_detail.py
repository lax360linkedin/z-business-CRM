"""The people & organisation detail screens: every field the pages read must be present, correct for the caller, and safe for a restricted user."""
from tests.conftest import ROOT_EMAIL, ROOT_PASSWORD, headers_of, login, make_account

API = "/api/v1"

EMPLOYEE_KEYS = {"perms", "workload", "related", "directReports", "chain", "timeline", "ledTeams", "isTeamLeader", "isDeptHead", "teamLeaderName", "fullName", "departmentName"}
WORKLOAD_KEYS = {"pendingTasks", "overdueTasks", "activeProjects", "openTickets", "activeDeals", "openLeads", "level"}
RELATED_KEYS = {"tasks", "projects", "deals", "leads", "tickets"}
DEPARTMENT_KEYS = {"total", "active", "onLeave", "inactive", "teamCount", "leaderCount", "openTasks", "overdueTasks", "activeProjects", "openTickets", "workloadLevel", "teams", "members", "perms", "headName"}
TEAM_KEYS = {"size", "active", "openTasks", "completedTasks", "overdueTasks", "activeProjects", "openTickets", "activeDeals", "revenueWon", "completionRate", "onTimeRate", "history", "members", "subTeams",
             "perms", "departmentName", "leaderName", "workloadLevel"}


def build_org(client, sa):
    """A department with a team, a leader and a member who reports to the leader and has real work (all in the Salem branch)."""
    sa = {**sa, "X-Branch-Scope": "Salem"}
    lead = client.post(f"{API}/employees", json={"fullName": "Lena Lead", "officialEmail": "lena@lax360.com", "designation": "Team Lead", "joinDate": "2026-01-05", "departmentId": "DEP-009", "branch": "Salem"}, headers=sa).json()
    team = client.post(f"{API}/teams", json={"name": "Alpha", "departmentId": "DEP-009", "leaderId": lead["id"]}, headers=sa)
    assert team.status_code == 201, team.text
    team = team.json()
    member = client.post(f"{API}/employees", json={"fullName": "Mo Member", "officialEmail": "mo@lax360.com", "designation": "Analyst", "joinDate": "2026-02-01", "departmentId": "DEP-009", "teamId": team["id"],
                                                    "reportsTo": lead["id"], "branch": "Salem"}, headers=sa)
    assert member.status_code == 201, member.text
    client.put(f"{API}/employees/{lead['id']}", json={"teamId": team["id"]}, headers=sa)
    return lead, team, member.json()


def test_employee_detail_has_everything_the_page_reads(client, sa):
    lead, team, member = build_org(client, sa)
    d = client.get(f"{API}/employees/{member['id']}", headers=sa)
    assert d.status_code == 200, d.text
    d = d.json()
    assert EMPLOYEE_KEYS <= set(d)
    assert WORKLOAD_KEYS <= set(d["workload"]) and RELATED_KEYS == set(d["related"])
    assert d["chain"][0]["id"] == lead["id"] and d["teamLeaderId"] == lead["id"] and d["teamLeaderName"] == "Lena Lead"
    assert d["perms"]["edit"] and d["perms"]["grantAccess"] and d["perms"]["viewAccount"]
    assert [e["type"] for e in d["timeline"]] == ["Created"] and d["timeline"][0]["id"] and d["timeline"][0]["byName"]
    boss = client.get(f"{API}/employees/{lead['id']}", headers=sa).json()
    assert [r["id"] for r in boss["directReports"]] == [member["id"]] and boss["isTeamLeader"] is True and boss["ledTeams"][0]["id"] == team["id"] and boss["team"]["members"] == 2
    assert client.get(f"{API}/employees/EMP-9999", headers=sa).status_code == 404


def test_workload_is_counted_from_the_real_work(client, sa):
    lead, team, member = build_org(client, sa)
    salem = headers_of(login(client, ROOT_EMAIL, ROOT_PASSWORD), scope="Salem")
    for title in ("One", "Two"):
        t = client.post(f"{API}/tasks", json={"title": title, "dueDate": "2020-01-01", "assignees": [member["id"]], "priority": "High"}, headers=salem)
        assert t.status_code == 201, t.text
    w = client.get(f"{API}/employees/{member['id']}", headers=sa).json()["workload"]
    assert w["pendingTasks"] == 2 and w["overdueTasks"] == 2 and w["level"] in ("Light", "Moderate")
    assert {t["title"] for t in client.get(f"{API}/employees/{member['id']}", headers=sa).json()["related"]["tasks"]} == {"One", "Two"}
    listed = {e["id"]: e for e in client.get(f"{API}/employees", params={"all": "true"}, headers=sa).json()}
    assert listed[member["id"]]["workload"]["pendingTasks"] == 2 and listed[lead["id"]]["isTeamLeader"] is True
    dep = client.get(f"{API}/departments/DEP-009", headers=sa).json()
    assert DEPARTMENT_KEYS <= set(dep) and dep["total"] == 2 and dep["openTasks"] == 2 and dep["overdueTasks"] == 2 and dep["teamCount"] == 1 and dep["leaderCount"] == 1
    assert {m["id"] for m in dep["members"]} == {lead["id"], member["id"]} and dep["teams"][0]["size"] == 2


def test_team_detail_stats_history_and_members(client, sa):
    lead, team, member = build_org(client, sa)
    t = client.get(f"{API}/teams/{team['id']}", headers=sa)
    assert t.status_code == 200, t.text
    t = t.json()
    assert TEAM_KEYS <= set(t) and t["size"] == 2 and t["leaderName"] == "Lena Lead" and t["completionRate"] is None and t["revenueWon"] == 0
    assert [h["text"] for h in t["history"]] == ["Team created"]
    sub = client.post(f"{API}/teams", json={"name": "Alpha-1", "departmentId": "DEP-009", "parentTeamId": team["id"]}, headers=sa).json()
    client.put(f"{API}/teams/{team['id']}", json={"leaderId": member["id"], "name": "Alpha Prime"}, headers=sa)
    t = client.get(f"{API}/teams/{team['id']}", headers=sa).json()
    assert t["subTeams"][0]["id"] == sub["id"] and t["leaderName"] == "Mo Member"
    texts = [h["text"] for h in t["history"]]
    assert "Team leader changed" in texts and "Team renamed" in texts and t["history"][0]["byName"]
    rows = client.get(f"{API}/teams", params={"all": "true"}, headers=sa).json()
    assert all("history" not in r and "size" in r for r in rows)  # the list stays light


def test_a_restricted_employee_gets_the_pages_without_hr_secrets_or_admin_powers(client, sa):
    lead, team, member = build_org(client, sa)
    make_account(client, sa, first="Rep", last="One", role="Sales Manager", branch="Salem", username="rep.one")
    make_account(client, sa, first="Exe", last="Cutive", role="Sales Executive", branch="Salem", username="exe.cutive")
    rep = headers_of(login(client, "rep.one"))
    assert client.get(f"{API}/employees/{member['id']}", headers=headers_of(login(client, "exe.cutive"))).status_code == 403  # no employee directory for this role
    d = client.get(f"{API}/employees/{member['id']}", headers=rep)
    assert d.status_code == 200, d.text
    d = d.json()
    assert EMPLOYEE_KEYS - {"directReports"} <= set(d)
    assert d["perms"]["edit"] is False and d["perms"]["grantAccess"] is False and d["perms"]["viewAccount"] is False and d["account"] is None
    assert d["sensitiveHidden"] is True and d["dob"] is None
    assert client.get(f"{API}/departments/DEP-009", headers=rep).json()["perms"]["manageOrg"] is False
    assert client.get(f"{API}/teams/{team['id']}", headers=rep).status_code in (200, 403)
    # without any access to the module, the pages are refused, not half-shown
    make_account(client, sa, first="No", last="Access", role="Employee", branch="Salem", username="no.access", permissions={"Leads": {"view": True}})
    assert client.get(f"{API}/employees/{member['id']}", headers=headers_of(login(client, "no.access"))).status_code == 403
