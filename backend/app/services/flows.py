"""Business workflow graphs - the server-side source of truth for which status / stage changes are legal (the browser only reflects them)."""

LEAD_STATUSES = ("New", "Contacted", "Qualified", "Unqualified", "Lost", "Converted")
LEAD_FLOW = {
    "New": ("Contacted", "Unqualified"),
    "Contacted": ("Qualified", "Unqualified", "Lost"),
    "Qualified": ("Converted", "Lost"),
    "Unqualified": (),
    "Lost": (),
    "Converted": (),
}

ENQUIRY_STATUSES = ("New", "Assigned", "Contacted", "Under Review", "Qualified", "Converted", "Unqualified", "Duplicate", "Spam", "Not Interested", "Closed")
ENQUIRY_FLOW = {
    "New": ("Assigned", "Contacted", "Duplicate", "Spam", "Not Interested", "Closed"),
    "Assigned": ("Contacted", "Duplicate", "Not Interested", "Closed"),
    "Contacted": ("Under Review", "Qualified", "Unqualified", "Not Interested", "Closed"),
    "Under Review": ("Qualified", "Unqualified", "Not Interested", "Closed"),
    "Qualified": ("Converted", "Unqualified", "Closed"),
    "Converted": (),
    "Unqualified": ("Closed",),
    "Duplicate": (),
    "Spam": (),
    "Not Interested": ("Closed",),
    "Closed": (),
}

DEAL_PROBABILITY = {
    "Deal Created": 10, "Requirement Analysis": 20, "Solution Discussion": 35, "Decision Maker Review": 50, "Proposal / Quotation": 70,
    "Negotiation": 85, "Final Decision": 95, "Closed Won": 100, "Closed Lost": 0, "Closed Lost – Competition": 0,
}
DEAL_STAGES = tuple(DEAL_PROBABILITY)
CLOSED_DEAL_STAGES = ("Closed Won", "Closed Lost", "Closed Lost – Competition")
LOST_DEAL_STAGES = ("Closed Lost", "Closed Lost – Competition")
_ACTIVE = tuple(s for s in DEAL_STAGES if s not in CLOSED_DEAL_STAGES)
DEAL_FLOW = {**{s: tuple(x for x in _ACTIVE if x != s) + CLOSED_DEAL_STAGES for s in _ACTIVE}, **{s: () for s in CLOSED_DEAL_STAGES}}

PRIORITIES = ("Low", "Medium", "High", "Urgent")
ENQUIRY_PRIORITIES = ("Critical", "High", "Medium", "Low")


def can_move(flow: dict, current: str, target: str) -> bool:
    return target == current or target in flow.get(current, ())
