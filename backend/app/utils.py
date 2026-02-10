from datetime import date
from .models import AgeRange

def age_range_from_dob(dob_yyyy_mm_dd: str) -> AgeRange:
    y, m, d = [int(x) for x in dob_yyyy_mm_dd.split("-")]
    today = date.today()
    age = today.year - y - ((today.month, today.day) < (m, d))
    if age < 18:
        raise ValueError("User must be 18+")
    if age <= 30:
        return AgeRange.R18_30
    if age <= 55:
        return AgeRange.R31_55
    return AgeRange.R55_PLUS
