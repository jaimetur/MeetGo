from datetime import date
from app.core.models import AgeRange

def age_from_dob(dob_yyyy_mm_dd: str) -> int:
    y, m, d = [int(x) for x in dob_yyyy_mm_dd.split("-")]
    today = date.today()
    return today.year - y - ((today.month, today.day) < (m, d))

def age_range_from_dob(dob_yyyy_mm_dd: str) -> AgeRange:
    age = age_from_dob(dob_yyyy_mm_dd)
    if age < 18:
        raise ValueError("User must be 18+")
    from app.core.age_bounds import key_for_age  # the limits the administration set (Settings → Age ranges)
    return AgeRange(key_for_age(age))

# Earlier values, used only when a date of birth cannot be read.
_OLD = {
    AgeRange.R18_30_LEGACY: AgeRange.R18_30,
    AgeRange.R31_50: AgeRange.R31_60, AgeRange.R31_55: AgeRange.R31_60,
    AgeRange.R31_50_LEGACY: AgeRange.R31_60, AgeRange.R31_55_LEGACY: AgeRange.R31_60,
    AgeRange.R51_PLUS: AgeRange.R61_PLUS, AgeRange.R55_PLUS: AgeRange.R61_PLUS,
    AgeRange.R51_PLUS_LEGACY: AgeRange.R61_PLUS, AgeRange.R55_PLUS_LEGACY: AgeRange.R61_PLUS,
}

def normalize_age_range(ar: AgeRange) -> AgeRange:
    return _OLD.get(AgeRange(ar), AgeRange(ar))

def age_range_aliases(ar: AgeRange) -> list[AgeRange]:
    ar = normalize_age_range(ar)
    return [ar] + [old for old, new in _OLD.items() if new == ar]

def can_access_age_range(user_age: int, user_range: AgeRange, room_range: AgeRange) -> bool:
    user_range = normalize_age_range(user_range)
    room_range = normalize_age_range(room_range)
    if user_range == room_range:
        return True
    # a year of overlap at each border (the last age of a range also enters the next one, and the first age the one
    # before), as long as that range has years
    from app.core.age_bounds import bounds, ranges
    b = bounds()
    empty = {r["key"] for r in ranges() if r["empty"]}
    if room_range.value in empty:
        return False
    if user_range == AgeRange.R18_30 and room_range == AgeRange.R31_60:
        return user_age >= b["young"]
    if user_range == AgeRange.R31_60 and room_range == AgeRange.R18_30:
        return user_age <= b["young"] + 1
    if user_range == AgeRange.R31_60 and room_range == AgeRange.R61_PLUS:
        return user_age >= b["middle"]
    if user_range == AgeRange.R61_PLUS and room_range == AgeRange.R31_60:
        return user_age <= b["middle"] + 1
    return False
