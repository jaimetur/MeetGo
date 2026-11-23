"""Helpers shared by several routers."""

import re
from datetime import date

from fastapi import HTTPException

from app.core.i18n import t
from app.core.models import User
from app.core.schemas import MeOut, UserOut, UserSummary
from app.mail.notify_email import prefs_of
from app.core.utils import age_range_from_dob

_CALLING_CODES = {"ES": "34", "PT": "351", "FR": "33", "IT": "39", "DE": "49", "GB": "44", "US": "1", "MX": "52", "AR": "54", "CO": "57"}


def normalize_phone(phone: str, country: str | None = "ES") -> str:
    """Return the number in +<country code><number> form."""
    raw = (phone or "").strip()
    digits = "".join(ch for ch in raw if ch.isdigit())
    if not digits:
        return ""
    if raw.startswith("+"):
        return f"+{digits}"
    if digits.startswith("00"):
        return f"+{digits[2:]}"
    return f"+{_CALLING_CODES.get((country or 'ES').upper(), '34')}{digits}"


def _is_valid_date(value: str) -> bool:
    try:
        date.fromisoformat(value)
        return True
    except ValueError:
        return False


def parse_dob(dob: str):
    """Validate YYYY-MM-DD and the 18+ rule, answering 400 instead of a server error."""
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", dob or "") or not _is_valid_date(dob):
        raise HTTPException(400, t("err_invalid_dob"))
    try:
        return age_range_from_dob(dob)
    except ValueError:
        raise HTTPException(400, t("register_err_underage"))


def user_out(u: User) -> UserOut:
    try:
        ar = age_range_from_dob(u.dob)
    except Exception:
        ar = u.age_range
    return UserOut(
        id=u.id, display_name=u.display_name, dob=u.dob, age_range=ar, country=u.country or "ES",
        province=u.province, city=u.city, accept_dm=u.accept_dm, avatar_url=u.avatar_url, bio=u.bio,
    )


EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s.]{2,}$")


def valid_email(email: str) -> bool:
    """An address people can receive mail at (name@domain.tld), required to sign up."""
    return len(email) <= 255 and bool(EMAIL_RE.match(email))


def me_out(u: User) -> MeOut:
    return MeOut(
        **user_out(u).model_dump(),
        email=u.email, dob_change_count=u.dob_change_count or 0, email_verified=bool(u.email_verified),
        role=u.role or "user", phone=u.phone, login_count=u.login_count or 0, last_login_at=u.last_login_at,
        last_seen_at=u.last_seen_at, total_connected_seconds=u.total_connected_seconds or 0,
        session_active=bool(u.session_active), session_started_at=u.session_started_at,
        email_prefs=prefs_of(u),
    )


def summary(u: User) -> UserSummary:
    return UserSummary(id=u.id, display_name=u.display_name, avatar_url=u.avatar_url)
