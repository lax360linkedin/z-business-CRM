"""Small column factories so the module models stay readable. Text columns are NOT NULL with an empty-string default (the React app treats "no value" as ""),
relations / dates / timestamps are nullable."""
from sqlalchemy import Date, ForeignKey, Integer, Numeric, String
from sqlalchemy.orm import mapped_column

from app.db.base import UTCDateTime


def text(length: int = 255):
    return mapped_column(String(length), default="", nullable=False)


def money():
    return mapped_column(Numeric(14, 2), default=0, nullable=False)


def rate():
    return mapped_column(Numeric(7, 2), default=0, nullable=False)


def count(default: int = 0):
    return mapped_column(Integer, default=default, nullable=False)


def day():
    return mapped_column(Date, nullable=True)


def stamp():
    return mapped_column(UTCDateTime, nullable=True)


def ref(table: str, ondelete: str = "SET NULL", index: bool = True, column: str = "id"):
    """A nullable link to another record."""
    return mapped_column(String(40), ForeignKey(f"{table}.{column}", ondelete=ondelete), nullable=True, index=index)


def person(index: bool = True):
    """A link to an employee (owner, assignee, manager ...)."""
    return ref("employees", "SET NULL", index)


def plain_ref(index: bool = True):
    """A back-pointer to a record without a database foreign key (used where two tables point at each other, or the target set is open-ended)."""
    return mapped_column(String(60), nullable=True, index=index)
