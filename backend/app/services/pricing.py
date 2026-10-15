"""Money maths for quotations, sales orders and invoices. The server recomputes every figure from the line items - an amount sent by a client is never trusted.

Discount is a % on the line gross; tax is applied on the discounted (taxable) amount at the line's own GST rate; GST splits into CGST + SGST (intra-state supply) or IGST
(inter-state, i.e. the customer's GSTIN state code differs from ours)."""
import re
from datetime import date, timedelta

DEFAULT_TAX_RATE = 18
DEFAULT_STATE_CODE = "29"
GSTIN = re.compile(r"^\d{2}[A-Z0-9]{13}$", re.I)
EPS = 0.005


def round2(value) -> float:
    return round((float(value) + 1e-9) * 100) / 100


def state_code(gstin: str | None) -> str | None:
    match = re.match(r"^(\d{2})[A-Z0-9]{13}$", (gstin or "").strip(), re.I)
    return match.group(1) if match else None


def infer_tax_type(gstin: str | None, org_state_code: str = DEFAULT_STATE_CODE) -> str:
    code = state_code(gstin)
    return "inter" if code and code != org_state_code else "intra"


def normalise_item(raw: dict) -> dict:
    tax = raw.get("taxRate")
    return {
        **{k: raw.get(k) for k in ("productId", "productCode", "category", "unit", "billingCycle", "listPrice")},
        "name": str(raw.get("name") or "").strip(), "description": str(raw.get("description") or "").strip(), "qty": _num(raw.get("qty")), "unitPrice": _num(raw.get("unitPrice")),
        "discount": _num(raw.get("discount")), "taxRate": DEFAULT_TAX_RATE if tax in (None, "") else _num(tax), "fulfilledQty": _num(raw.get("fulfilledQty")),
    }


def _num(value) -> float:
    try:
        return float(value) if value not in (None, "") else 0.0
    except (TypeError, ValueError):
        return 0.0


def validate_items(items: list, label: str = "item") -> list[dict]:
    from app.core.errors import invalid

    if not isinstance(items, list) or not items:
        raise invalid("Add at least one line item.", {"items": "Add at least one product or service."})
    out, errors = [], {}
    for index, raw in enumerate(items):
        item = normalise_item(raw if isinstance(raw, dict) else {})
        if not item["name"]:
            errors[f"{label}-{index}-name"] = "Name required"
        if not item["qty"] > 0:
            errors[f"{label}-{index}-qty"] = "Qty must be > 0"
        if item["unitPrice"] < 0:
            errors[f"{label}-{index}-unitPrice"] = "Price cannot be negative"
        if not 0 <= item["discount"] <= 100:
            errors[f"{label}-{index}-discount"] = "0-100%"
        if not 0 <= item["taxRate"] <= 100:
            errors[f"{label}-{index}-taxRate"] = "0-100%"
        out.append(item)
    if errors:
        raise invalid(next(iter(errors.values())), errors)
    return out


def compute_order(items: list[dict], tax_type: str = "intra") -> dict:
    lines = []
    for raw in items or []:
        it = normalise_item(raw)
        gross = it["qty"] * it["unitPrice"]
        discount = gross * (it["discount"] / 100)
        taxable = gross - discount
        tax = taxable * (it["taxRate"] / 100)
        lines.append({"gross": round2(gross), "discount": round2(discount), "taxable": round2(taxable), "tax": round2(tax), "total": round2(taxable + tax)})
    total = lambda key: round2(sum(line[key] for line in lines))  # noqa: E731
    tax_total, taxable_amount = total("tax"), total("taxable")
    cgst = round2(tax_total / 2) if tax_type == "intra" else 0.0
    return {"lines": lines, "subtotal": total("gross"), "discountAmount": total("discount"), "taxableAmount": taxable_amount, "tax": tax_total, "cgst": cgst,
            "sgst": round2(tax_total - cgst) if tax_type == "intra" else 0.0, "igst": tax_total if tax_type == "inter" else 0.0, "amount": round2(taxable_amount + tax_total)}


def quotation_totals(items: list[dict]) -> dict:
    """Quotation-style totals: subtotal (after discount), tax, total."""
    t = compute_order(items, "intra")
    return {"subtotal": t["taxableAmount"], "tax": t["tax"], "amount": t["amount"]}


def pricing_block(items: list[dict], tax_type: str) -> dict:
    t = compute_order(items, tax_type)
    t.pop("lines")
    return {"taxType": tax_type, **t}


def compute_invoice(items: list[dict], *, tax_type: str = "intra", extra_taxes: list | None = None, round_off: bool = True, total: float | None = None) -> dict:
    base = compute_order(items, tax_type)
    other = [{"name": str(t.get("name") or "").strip(), "rate": _num(t.get("rate")), "amount": round2(base["taxableAmount"] * (_num(t.get("rate")) / 100))} for t in (extra_taxes or [])]
    other = [t for t in other if t["name"] and t["rate"] > 0]
    other_total = round2(sum(t["amount"] for t in other))
    pre_round = round2(base["taxableAmount"] + base["tax"] + other_total)
    amount = round2(total) if total is not None else (float(round(pre_round)) if round_off else pre_round)
    base.pop("lines")
    return {**base, "extraTaxes": other, "otherTaxAmount": other_total, "roundOff": round2(amount - pre_round), "amount": amount, "taxType": tax_type}


# ---- terms and dates -------------------------------------------------------------------------------------------------------
def terms_to_days(terms: str | None) -> int | None:
    t = (terms or "").lower()
    if re.search(r"due on receipt|immediate|on receipt", t) or (re.search(r"advance", t) and "%" not in t):
        return 0
    m = re.search(r"(\d{1,3})\s*(?:calendar\s*)?days?", t) or re.search(r"net\s*(\d{1,3})", t)
    return int(m.group(1)) if m else None


def due_date_from(terms: str | None, issue: date, default_days: int = 15) -> date:
    days = terms_to_days(terms)
    return issue + timedelta(days=default_days if days is None else days)


# ---- invoice state ---------------------------------------------------------------------------------------------------------
LIFECYCLE = ("Draft", "Sent", "Viewed", "Cancelled", "Void")
ISSUED = ("Sent", "Viewed", "Partially Paid", "Paid", "Overdue")
DEAD = ("Cancelled", "Void")
COUNTED_PAYMENT = ("Completed", "Partially Refunded")


def payment_net(status: str | None, amount, refunded) -> float:
    if status in (None, "Completed"):
        return _num(amount)
    if status == "Partially Refunded":
        return max(0.0, round2(_num(amount) - _num(refunded)))
    return 0.0


def derive_invoice_state(lifecycle: str, amount, due: date | None, paid, today: date | None = None) -> dict:
    today = today or date.today()
    amount, paid = _num(amount), round2(paid)
    balance = round2(max(0.0, amount - paid))
    status = lifecycle
    if lifecycle not in ("Draft", "Cancelled", "Void"):
        if amount > 0 and paid >= amount - EPS:
            status = "Paid"
        elif due is not None and due < today and balance > EPS:
            status = "Overdue"
        elif paid > 0:
            status = "Partially Paid"
    payment_status = "Not issued" if lifecycle == "Draft" else "Not applicable" if lifecycle in ("Cancelled", "Void") else "Unpaid" if paid <= 0 else "Paid" if balance <= EPS else "Partially Paid"
    return {"status": status, "paid": paid, "balance": balance, "paymentStatus": payment_status, "overdueDays": max(1, (today - due).days) if status == "Overdue" and due else 0}
