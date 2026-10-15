"""Lead score (0-100): a plain, explainable rule - how reachable the lead is, how well the requirement is known, how important it is, and how far it has been worked.
It is computed by the server whenever a lead is saved, so it can never be typed in or left at a placeholder.

    reachable      email 10 + phone 10                                        (20)
    identified     company 5 + source 5                                       (10)
    requirement    service 10 + requirement written 5 + budget stated 15      (30)
    priority       Urgent 10, High 7, Medium 4, Low 0                         (10)
    progress       Contacted 10, Qualified 20; a follow-up date set +5;
                   contacted within the last 14 days +5                       (30)
    Unqualified / Lost leads score 0 for progress and are capped at 30 overall."""
from datetime import date

PRIORITY = {"Urgent": 10, "High": 7, "Medium": 4, "Low": 0}
STATUS = {"New": 0, "Contacted": 10, "Qualified": 20, "Converted": 20}


def lead_score(lead, today: date | None = None) -> int:
    today = today or date.today()
    score = 0
    score += 10 if (lead.email or "").strip() else 0
    score += 10 if (lead.phone or "").strip() else 0
    score += 5 if (lead.company or "").strip() else 0
    score += 5 if (lead.source or "").strip() else 0
    score += 10 if (lead.service or "").strip() else 0
    score += 5 if (lead.requirement or "").strip() else 0
    score += 15 if float(lead.budget or 0) > 0 else 0
    score += PRIORITY.get(lead.priority, 0)
    if lead.status in ("Unqualified", "Lost"):
        return min(score, 30)
    score += STATUS.get(lead.status, 0)
    score += 5 if lead.next_follow_up else 0
    if lead.last_contacted_date and 0 <= (today - lead.last_contacted_date).days <= 14:
        score += 5
    return max(0, min(score, 100))
