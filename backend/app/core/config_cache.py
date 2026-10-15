"""A tiny in-process cache for configuration that is read on EVERY request but changes a few times a year: the idle-timeout setting, the role templates and the branch list.

Without it each request paid three to six extra database round trips just to learn things that were true a second ago - on a hosted database a round trip is hundreds of
milliseconds, so this is most of what a request costs. Correctness rules:

* a write to `app_settings` or `branches` through ANY session of this process clears the cache the moment it commits (see `db/session.py`), so a change made here is seen at once;
* another worker process learns of a change within `TTL` seconds at the latest (the configuration is only ever changed by the Super Admin);
* accounts, sessions and permissions of people are NOT cached: they are read on every request, so deactivating someone still takes effect immediately."""
import threading
import time
from collections.abc import Callable
from typing import Any

TTL = 15.0
_lock = threading.Lock()
_store: dict[str, tuple[float, Any]] = {}


def get(key: str, loader: Callable[[], Any]) -> Any:
    now = time.monotonic()
    hit = _store.get(key)
    if hit is not None and hit[0] > now:
        return hit[1]
    value = loader()  # outside the lock: a slow load must not block other requests (two loaders racing is harmless)
    with _lock:
        _store[key] = (now + TTL, value)
    return value


def clear() -> None:
    with _lock:
        _store.clear()
