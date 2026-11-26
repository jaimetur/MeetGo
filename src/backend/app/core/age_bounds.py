"""The three age ranges (18_30, 31_60, 61_plus as keys) with limits the administration moves (Settings → Age ranges):
`young` is the last age of the first range and `middle` the last of the second. A range of 0 years disappears and its
people belong to the one that took its years; its communities stay as they were, asleep, until it has years again.

The keys never change (communities are made per key); only the ages each one covers and its label ("18-30")."""

from __future__ import annotations

MIN_AGE = 18
MAX_AGE = 100          # the last age the scale shows; a third range ending here has no years left
DEFAULT = {"young": 30, "middle": 60}
SECTION = "age_bounds"

_bounds = dict(DEFAULT)


def bounds() -> dict:
    return dict(_bounds)


def clean(young: int, middle: int) -> dict:
    young = max(MIN_AGE - 1, min(int(young), MAX_AGE))
    middle = max(young, min(int(middle), MAX_AGE))
    return {"young": young, "middle": middle}


def set_bounds(young: int, middle: int) -> dict:
    _bounds.update(clean(young, middle))
    return bounds()


def key_for_age(age: int) -> str:
    if age <= _bounds["young"]:
        return "18_30"
    if age <= _bounds["middle"]:
        return "31_60"
    return "61_plus"


def ranges(b: dict | None = None) -> list[dict]:
    """The ranges as the apps show them: key, first and last age (None: no end), label and whether it is empty."""
    b = b or _bounds
    young, middle = b["young"], b["middle"]
    out = [
        {"key": "18_30", "min": MIN_AGE, "max": young},
        {"key": "31_60", "min": max(young + 1, MIN_AGE), "max": middle},
        {"key": "61_plus", "min": max(middle + 1, MIN_AGE), "max": None},
    ]
    for r in out:
        r["empty"] = (r["max"] is not None and r["max"] < r["min"]) or (r["max"] is None and r["min"] > MAX_AGE)
        r["label"] = "" if r["empty"] else (f"{r['min']}+" if r["max"] is None else f"{r['min']}-{r['max']}")
    return out


def label(key: str | None) -> str:
    return next((r["label"] for r in ranges() if r["key"] == key), key or "")


def neighbours(key: str) -> list[str]:
    order = ["18_30", "31_60", "61_plus"]
    i = order.index(key) if key in order else -1
    return [order[j] for j in (i - 1, i + 1) if 0 <= j < len(order)]


async def load(db) -> dict:
    from app.core.app_settings import get_section
    saved = await get_section(db, SECTION)
    return set_bounds(saved.get("young", DEFAULT["young"]), saved.get("middle", DEFAULT["middle"]))
