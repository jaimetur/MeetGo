"""Helpers shared by several routers."""

import re
from datetime import date

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.i18n import t
from app.core.models import User
from app.core.schemas import MeOut, UserOut, UserSummary
from app.mail.notify_email import prefs_of
from app.core.utils import age_range_from_dob

_CALLING_CODES = {"ES": "34", "PT": "351", "FR": "33", "IT": "39", "DE": "49", "GB": "44", "US": "1", "MX": "52", "AR": "54", "CO": "57"}


# The alias is one word: letters (any language), digits, "_" and "."; 3 to 30 of them.
ALIAS_RE = re.compile(r"^[^\W][\w.]{2,29}$")


async def clean_alias(db: AsyncSession, value: str | None, user_id: int | None = None) -> str:
    """The alias as typed (an "@" in front goes), or 400 when it is not one word, or 409 when someone has it."""
    alias = (value or "").strip().lstrip("@")
    if not ALIAS_RE.fullmatch(alias) or alias.endswith("."):
        raise HTTPException(400, t("err_alias_format"))
    q = select(User.id).where(func.lower(User.display_name) == alias.lower())
    if user_id is not None:
        q = q.where(User.id != user_id)
    if (await db.execute(q)).first():
        raise HTTPException(409, t("err_alias_taken"))
    return alias


def clean_person_name(value: str | None, max_len: int, err: str) -> str:
    """A first name or surname(s): not empty, spaces tidied."""
    name = " ".join((value or "").split())
    if not name or len(name) > max_len:
        raise HTTPException(400, t(err))
    return name


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
        id=u.id, display_name=u.display_name, first_name=u.first_name, last_name=u.last_name, dob=u.dob, age_range=ar, country=u.country or "ES",
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
        role=u.role or "user", bot_role=u.bot_role, phone=u.phone, login_count=u.login_count or 0, visit_count=u.visit_count or 0, last_login_at=u.last_login_at,
        last_seen_at=u.last_seen_at, total_connected_seconds=u.total_connected_seconds or 0,
        session_active=bool(u.session_active), session_started_at=u.session_started_at,
        email_prefs=prefs_of(u), read_receipts=u.read_receipts is not False, last_seen_privacy=u.last_seen_privacy or "all",
    )


def summary(u: User) -> UserSummary:
    return UserSummary(id=u.id, display_name=u.display_name, avatar_url=u.avatar_url)
