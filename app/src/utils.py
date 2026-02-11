from datetime import date
from .models import AgeRange

def age_from_dob(dob_yyyy_mm_dd: str) -> int:
    y, m, d = [int(x) for x in dob_yyyy_mm_dd.split("-")]
    today = date.today()
    return today.year - y - ((today.month, today.day) < (m, d))

def age_range_from_dob(dob_yyyy_mm_dd: str) -> AgeRange:
    age = age_from_dob(dob_yyyy_mm_dd)
    if age < 18:
        raise ValueError("User must be 18+")
    if age <= 30:
        return AgeRange.R18_30
    if age <= 50:
        return AgeRange.R31_50
    return AgeRange.R51_PLUS

def normalize_age_range(ar: AgeRange) -> AgeRange:
    if ar in (AgeRange.R31_55, AgeRange.R31_55_LEGACY):
        return AgeRange.R31_50
    if ar in (AgeRange.R55_PLUS, AgeRange.R55_PLUS_LEGACY):
        return AgeRange.R51_PLUS
    if ar == AgeRange.R18_30_LEGACY:
        return AgeRange.R18_30
    if ar == AgeRange.R31_50_LEGACY:
        return AgeRange.R31_50
    if ar == AgeRange.R51_PLUS_LEGACY:
        return AgeRange.R51_PLUS
    return ar

def age_range_aliases(ar: AgeRange) -> list[AgeRange]:
    ar = normalize_age_range(ar)
    if ar == AgeRange.R31_50:
        return [AgeRange.R31_50, AgeRange.R31_55, AgeRange.R31_50_LEGACY, AgeRange.R31_55_LEGACY]
    if ar == AgeRange.R51_PLUS:
        return [AgeRange.R51_PLUS, AgeRange.R55_PLUS, AgeRange.R51_PLUS_LEGACY, AgeRange.R55_PLUS_LEGACY]
    if ar == AgeRange.R18_30:
        return [AgeRange.R18_30, AgeRange.R18_30_LEGACY]
    return [ar]

def can_access_age_range(user_age: int, user_range: AgeRange, room_range: AgeRange) -> bool:
    user_range = normalize_age_range(user_range)
    room_range = normalize_age_range(room_range)
    if user_range == room_range:
        return True
    if user_range == AgeRange.R18_30 and room_range == AgeRange.R31_50:
        return user_age >= 30
    if user_range == AgeRange.R31_50 and room_range == AgeRange.R18_30:
        return user_age <= 31
    if user_range == AgeRange.R31_50 and room_range == AgeRange.R51_PLUS:
        return user_age >= 50
    if user_range == AgeRange.R51_PLUS and room_range == AgeRange.R31_50:
        return user_age <= 51
    return False
