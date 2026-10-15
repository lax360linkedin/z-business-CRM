"""Record <-> JSON codec. The API speaks flat camelCase records (what the React app already uses); the database stores the fields that are queried / related as real columns
and the rest in the JSON `attributes` column. Which is which is read from the SQLAlchemy model, so there is one definition of a record: its model."""
import re
from datetime import UTC, date, datetime
from decimal import Decimal

from sqlalchemy import JSON, Boolean, Date, DateTime, Float, Integer, Numeric, String, Text
from sqlalchemy.orm import DeclarativeBase

from app.core.errors import invalid
from app.db.base import JsonType, UTCDateTime

SYSTEM_KEYS = {"id", "attributes", "created_at", "updated_at", "created_by"}
MAX_ATTRIBUTES_BYTES = 400_000


def camel(name: str) -> str:
    head, *rest = name.split("_")
    return head + "".join(part.capitalize() for part in rest)


def snake(name: str) -> str:
    return re.sub(r"(?<!^)(?=[A-Z])", "_", name).lower()


def columns_of(model) -> dict:
    """camelCase JSON key -> mapped column, for every promoted (queryable / relational) field of a model."""
    return {camel(c.key): c for c in model.__table__.columns if c.key not in SYSTEM_KEYS}


def _column_kind(column) -> str:
    t = column.type
    if isinstance(t, UTCDateTime) or isinstance(t, DateTime):
        return "datetime"
    if isinstance(t, Date):
        return "date"
    if isinstance(t, Boolean):
        return "bool"
    if isinstance(t, Integer):
        return "int"
    if isinstance(t, (Numeric, Float)):
        return "number"
    if isinstance(t, (JSON,)) or t is JsonType or "JSON" in type(t).__name__.upper():
        return "json"
    if isinstance(t, (String, Text)):
        return "str"
    return "raw"


def _iso_datetime(value: datetime) -> str:
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def serialise_value(value):
    if value is None:
        return None
    if isinstance(value, datetime):
        return _iso_datetime(value)
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    return value


def to_json(obj) -> dict:
    """The flat camelCase record: attributes first, then columns (so a column always wins), then the system fields."""
    out = dict(obj.attributes or {})
    for key, column in columns_of(type(obj)).items():
        out[key] = serialise_value(getattr(obj, column.key))
    out["id"] = obj.id
    if hasattr(obj, "created_at"):
        out["createdAt"] = serialise_value(obj.created_at)
        out["updatedAt"] = serialise_value(obj.updated_at)
    if getattr(obj, "created_by", None) is not None:
        out["createdBy"] = obj.created_by
    return out


def coerce(column, key: str, value):
    """Validate and convert one incoming value for a column; raises a 422 naming the field."""
    kind = _column_kind(column)
    nullable = column.nullable
    if value is None or (value == "" and kind in ("date", "datetime", "int", "number")):
        if value is None and not nullable and kind not in ("str",):
            raise invalid(f"{key} is required.", {key: "Required."})
        if kind == "str" and not nullable:
            return ""
        return None
    try:
        if kind == "str":
            if isinstance(value, (dict, list)):
                raise ValueError
            text = str(value)
            limit = getattr(column.type, "length", None)
            if limit and len(text) > limit:
                raise invalid(f"{key} is too long (maximum {limit} characters).", {key: f"Maximum {limit} characters."})
            return text
        if kind == "bool":
            if isinstance(value, bool):
                return value
            if value in ("true", "True", 1, "1"):
                return True
            if value in ("false", "False", 0, "0"):
                return False
            raise ValueError
        if kind == "int":
            if isinstance(value, bool):
                raise ValueError
            return int(float(value))
        if kind == "number":
            if isinstance(value, bool):
                raise ValueError
            number = float(value)
            if number != number or number in (float("inf"), float("-inf")):
                raise ValueError
            return number
        if kind == "date":
            if isinstance(value, datetime):
                return value.date()
            if isinstance(value, date):
                return value
            return date.fromisoformat(str(value)[:10])
        if kind == "datetime":
            if isinstance(value, datetime):
                return value
            text = str(value).replace("Z", "+00:00")
            parsed = datetime.fromisoformat(text) if len(text) > 10 else datetime.fromisoformat(text + "T00:00:00+00:00")
            return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)
        if kind == "json":
            if not isinstance(value, (dict, list)):
                raise ValueError
            return value
        return value
    except (ValueError, TypeError):
        raise invalid(f"{key} has an invalid value.", {key: "Invalid value."}) from None


def split_payload(model, payload: dict, protected: set[str] = frozenset(), ignore: set[str] = frozenset()) -> tuple[dict, dict]:
    """(column values keyed by column attribute name, attribute values) from an incoming JSON body. Server-owned and ignored keys are dropped."""
    cols = columns_of(model)
    values, attrs = {}, {}
    for key, raw in payload.items():
        if key in SYSTEM_KEYS or key in ("createdAt", "updatedAt", "createdBy") or key in protected or key in ignore:
            continue
        if key in cols:
            values[cols[key].key] = coerce(cols[key], key, raw)
        else:
            attrs[key] = raw
    return values, attrs


def check_attributes_size(attrs: dict) -> None:
    import json

    if len(json.dumps(attrs, default=str)) > MAX_ATTRIBUTES_BYTES:
        raise invalid("The record carries too much data.", {"attributes": "Too large."})


def model_for_table(base: type[DeclarativeBase], table_name: str):
    for mapper in base.registry.mappers:
        if mapper.local_table.name == table_name:
            return mapper.class_
    return None
