import logging
import asyncio
import json
import os
import secrets
import threading
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import and_, delete, func, or_, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import ai, languages
from app.core.config import settings
from app.core.deps import get_db, require_admin
from app.core.i18n import t
from app.core.models import (
    AccessGrant, BoardPost, Conversation, ConversationMember, DMRequest, Follow, FriendRequest, Friendship, Interest, Message, Post, PromoCode, Report,
    StripeSubscription, PlaySubscription, User, UserInterest, utcnow,
)
from app.core.schemas import (
    AdminAccessIn, AdminInterestIn, AdminSmtpTestIn, AdminUserCreateIn, AdminUserUpdateIn, InterestOut, MeOut, PromoCodeIn,
    ReportResolveIn,
)
from app.core.security import create_access_token, decode_token, hash_password
from app.billing import service as billing
from app.core.app_settings import get_section, get_settings_row, set_section
from app.billing.service import normalise_code, promo_out
from app.conversations.service import messages_out, user_summary
from app.core.crypto import decrypt, encrypt
from app.mail.email import send_email
from app.core.app_settings import app_base_url
from app.messaging.service import delete_message
from app.board.service import delete_post_data
from app.accounts.common import clean_alias, clean_person_name, me_out, normalize_phone, parse_dob
from app.accounts.deletion import delete_account
from app.communities.service import AGE_KEYS
from app.realtime.service import online_ids

try:
    import docker
except Exception:  # pragma: no cover
    docker = None

logger = logging.getLogger("meetgo.admin")
router = APIRouter(prefix="/admin", tags=["admin"])
# Sections holding secrets: edited only through their own endpoints, never returned in full.
PROTECTED_SECTIONS = {"stripe", "play", "fcm", "webpush", "billing"}


# Mail secrets inside the "smtp" section: the browser gets "" and whether one is set (…_set), never the value.
SMTP_SECRETS = ("password", "gmail_client_secret", "gmail_refresh_token")


def _public_settings(data: dict) -> dict:
    out = {k: v for k, v in data.items() if k not in PROTECTED_SECTIONS}
    if isinstance(out.get("smtp"), dict):
        smtp = dict(out["smtp"])
        for k in SMTP_SECRETS:
            smtp[f"{k}_set"] = bool(smtp.get(k))
            smtp[k] = ""
        out["smtp"] = smtp
    return out


@router.get("/settings", response_model=dict)
async def get_settings(db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    data = (await get_settings_row(db)).data or {}
    return _public_settings(data)


@router.put("/settings", response_model=dict)
async def put_settings(payload: dict, db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    st = await get_settings_row(db)
    old_smtp = dict((st.data or {}).get("smtp") or {})
    data = {k: v for k, v in (st.data or {}).items() if k in PROTECTED_SECTIONS}
    data.update({k: v for k, v in (payload or {}).items() if k not in PROTECTED_SECTIONS})
    if isinstance(data.get("smtp"), dict):
        smtp = {k: v for k, v in data["smtp"].items() if not k.endswith("_set")}
        for k in SMTP_SECRETS:  # left empty: the stored one stays
            if not smtp.get(k) and old_smtp.get(k):
                smtp[k] = old_smtp[k]
        data["smtp"] = smtp
    st.data = data
    await db.commit()
    return _public_settings(data)


@router.post("/smtp/test", response_model=dict)
async def smtp_test(payload: AdminSmtpTestIn, db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    to_email = (payload.to_email or "").strip()
    if not to_email:
        raise HTTPException(400, t("err_missing_to_email"))
    await send_email(db, to_email, t("email_smtp_test_subject"), t("email_smtp_test_body"))
    return {"ok": True}


# ---------- users ----------

async def _plans(db: AsyncSession, ids: list[int]) -> dict[int, dict]:
    out: dict[int, dict] = {}
    for g in (await db.execute(select(AccessGrant).where(AccessGrant.user_id.in_(ids)))).scalars().all():
        out[g.user_id] = {"kind": "gift", "source": g.source, "until": g.until.isoformat() if g.until else None}
    for s in (await db.execute(select(StripeSubscription).where(StripeSubscription.user_id.in_(ids)))).scalars().all():
        out.setdefault(s.user_id, {"kind": "web", "plan": s.plan, "status": s.status,
                                   "until": s.period_end.isoformat() if s.period_end else None})
    for p in (await db.execute(select(PlaySubscription).where(PlaySubscription.user_id.in_(ids)))).scalars().all():
        out.setdefault(p.user_id, {"kind": "play", "plan": p.base_plan, "status": p.state,
                                   "until": p.expiry.isoformat() if p.expiry else None})
    return out


@router.get("/users", response_model=list[dict])
async def list_users(q: str | None = None, db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    query = select(User)
    if q:
        like = f"%{q}%"
        query = query.where(or_(User.display_name.ilike(like), func.concat_ws(" ", User.first_name, User.last_name).ilike(like),
                                User.email.ilike(like), User.phone.ilike(like)))
    users = (await db.execute(query.order_by(User.id.desc()).limit(500))).scalars().all()
    plans = await _plans(db, [u.id for u in users])
    try:
        online = await online_ids([u.id for u in users])
    except Exception:  # Redis down: nobody shows as online
        online = set()
    return [{**me_out(u).model_dump(mode="json"), "access_required": u.access_required,
             "plan": plans.get(u.id) or ({"kind": "free"} if not u.access_required else {"kind": "none"}),
             "is_banned": u.is_banned, "banned_until": _iso(u.banned_until), "created_at": _iso(u.created_at),
             "online": u.id in online} for u in users]


def _iso(value: datetime | None) -> str | None:
    """Naive UTC columns as ISO with "Z", so browsers read them in their own time zone."""
    if value is None:
        return None
    return value.isoformat() + ("Z" if value.tzinfo is None else "")


@router.get("/stats", response_model=dict)
async def stats(db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    """The administration overview: people, activity, moderation and subscriptions at a glance."""
    now = datetime.utcnow()
    people = User.bot_role.is_(None)

    async def count(*where) -> int:
        return int((await db.execute(select(func.count()).select_from(User).where(people, *where))).scalar() or 0)

    ids = (await db.execute(select(User.id).where(people))).scalars().all()
    try:
        online = len(await online_ids(ids))
    except Exception:
        online = 0
    since = now - timedelta(days=29)
    day = func.date_trunc("day", User.created_at)
    signups = dict((await db.execute(select(day, func.count()).where(people, User.created_at >= since.replace(hour=0, minute=0, second=0, microsecond=0)).group_by(day))).all())
    series = []
    for i in range(30):
        d = (since + timedelta(days=i)).date()
        series.append({"day": d.isoformat(), "count": int(next((v for k, v in signups.items() if k.date() == d), 0))})
    aware = utcnow()
    messages_24h = int((await db.execute(select(func.count()).select_from(Message).where(
        Message.created_at >= aware - timedelta(hours=24), Message.kind == "text"))).scalar() or 0)
    messages_7d = int((await db.execute(select(func.count()).select_from(Message).where(
        Message.created_at >= aware - timedelta(days=7), Message.kind == "text"))).scalar() or 0)
    # communities with messages today and this week, of all there are (the chats of joined zones are not counted)
    def channels(*where):
        return select(func.count()).select_from(Conversation).where(Conversation.kind == "channel", *where)
    communities = int((await db.execute(channels(Conversation.last_message_at >= aware - timedelta(days=7)))).scalar() or 0)
    communities_24h = int((await db.execute(channels(Conversation.last_message_at >= aware - timedelta(hours=24)))).scalar() or 0)
    communities_total = int((await db.execute(channels())).scalar() or 0)
    upcoming = int((await db.execute(select(func.count()).select_from(BoardPost).where(BoardPost.starts_at >= aware))).scalar() or 0)
    reports_open = int((await db.execute(select(func.count()).select_from(Report).where(Report.status == "open"))).scalar() or 0)
    provinces = [{"province": p, "count": int(c)} for p, c in (await db.execute(
        select(User.province, func.count()).where(people, User.province.is_not(None)).group_by(User.province)
        .order_by(func.count().desc()).limit(6))).all()]
    plans = await _plans(db, list(ids))
    return {
        "users": {
            "total": len(ids), "online": online,
            "new_7d": await count(User.created_at >= now - timedelta(days=7)),
            "active_24h": await count(User.last_seen_at >= now - timedelta(hours=24)),
            "active_7d": await count(User.last_seen_at >= now - timedelta(days=7)),
            "banned": await count(or_(User.is_banned.is_(True), User.banned_until > now)),
            "unverified": await count(User.email_verified.is_(False)),
            "admins": await count(User.role == "admin"),
        },
        "signups": series,
        "activity": {"messages_24h": messages_24h, "messages_7d": messages_7d, "communities": communities, "communities_24h": communities_24h,
                     "communities_total": communities_total, "upcoming_plans": upcoming},
        "reports_open": reports_open,
        "plans": {k: sum(1 for p in plans.values() if p["kind"] == k) for k in ("gift", "web", "play")},
        "provinces": provinces,
    }


@router.get("/users/{user_id}/summary", response_model=dict)
async def user_summary_stats(user_id: int, db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    """What a person does in MeetGo: messages, communities, groups, friends, plans and reports."""
    target = await db.get(User, user_id)
    if not target:
        raise HTTPException(404, t("err_user_not_found"))

    async def n(stmt) -> int:
        return int((await db.execute(stmt)).scalar() or 0)

    member_kinds = select(Conversation.kind, func.count()).join(
        ConversationMember, ConversationMember.conversation_id == Conversation.id).where(
        ConversationMember.user_id == user_id).group_by(Conversation.kind)
    kinds = dict((await db.execute(member_kinds)).all())
    return {
        "messages": await n(select(func.count()).select_from(Message).where(Message.sender_id == user_id, Message.kind == "text")),
        "communities": int(kinds.get("channel", 0)),
        "groups": int(kinds.get("group", 0)),
        "dms": int(kinds.get("dm", 0)),
        "friends": await n(select(func.count()).select_from(Friendship).where(Friendship.user_id == user_id)),
        "posts": await n(select(func.count()).select_from(BoardPost).where(BoardPost.author_id == user_id)),
        "reports_received": await n(select(func.count()).select_from(Report).join(Message, Message.id == Report.message_id).where(Message.sender_id == user_id)),
        "reports_made": await n(select(func.count()).select_from(Report).where(Report.reporter_id == user_id)),
        "online": await _is_online(user_id),
        # with the session open now (the app is connected)
        "connected_seconds": (target.total_connected_seconds or 0) + (
            int(max(0, min((datetime.utcnow() - target.session_started_at).total_seconds(), 12 * 3600)))
            if target.session_active and target.session_started_at else 0),
    }


async def _is_online(user_id: int) -> bool:
    try:
        return bool(await online_ids([user_id]))
    except Exception:
        return False


@router.post("/users/{user_id}/ban", response_model=dict)
async def ban_user(user_id: int, payload: dict, db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    """Block access: {"days": N} for a while, {"days": null} for good, {"days": 0} to lift it."""
    if admin.id == user_id:
        raise HTTPException(400, t("err_cannot_ban_self"))
    target = await db.get(User, user_id)
    if not target:
        raise HTTPException(404, t("err_user_not_found"))
    days = payload.get("days", 0) if isinstance(payload, dict) else 0
    if days is None:
        target.is_banned, target.banned_until = True, None
    elif isinstance(days, (int, float)) and days > 0:
        target.is_banned, target.banned_until = False, datetime.utcnow() + timedelta(days=float(days))
    else:
        target.is_banned, target.banned_until = False, None
    await db.commit()
    return {"is_banned": target.is_banned, "banned_until": _iso(target.banned_until)}


@router.post("/users", response_model=MeOut)
async def create_user(payload: AdminUserCreateIn, db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    email = payload.email.strip().lower()
    if (await db.execute(select(User.id).where(User.email == email))).first():
        raise HTTPException(409, t("err_email_already_used"))
    phone_norm = normalize_phone(payload.phone, payload.country)
    if not phone_norm:
        raise HTTPException(400, t("err_invalid_phone"))
    if (await db.execute(select(User.id).where(User.phone == phone_norm))).first():
        raise HTTPException(409, t("err_phone_already_used"))
    if len(payload.password) < 6:
        raise HTTPException(400, t("err_password_too_short"))
    u = User(email=email, phone=phone_norm, password_hash=hash_password(payload.password),
             display_name=await clean_alias(db, payload.display_name),
             first_name=clean_person_name(payload.first_name, 64, "err_first_name"),
             last_name=clean_person_name(payload.last_name, 96, "err_last_name"), dob=payload.dob, age_range=parse_dob(payload.dob),
             country=payload.country or "ES", province=payload.province.strip(),
             city=(payload.city.strip() if payload.city else None), accept_dm=False, bio="",
             role=payload.role or "user", email_verified=True)
    db.add(u)
    await db.commit()
    await db.refresh(u)
    return me_out(u)


@router.patch("/users/{user_id}", response_model=MeOut)
async def update_user(user_id: int, payload: AdminUserUpdateIn, db: AsyncSession = Depends(get_db),
                      admin: User = Depends(require_admin)):
    target = await db.get(User, user_id)
    if not target:
        raise HTTPException(404, t("err_user_not_found"))
    if payload.display_name is not None and payload.display_name.strip().lstrip("@") != target.display_name:
        target.display_name = await clean_alias(db, payload.display_name, target.id)
    if payload.first_name is not None:
        target.first_name = clean_person_name(payload.first_name, 64, "err_first_name")
    if payload.last_name is not None:
        target.last_name = clean_person_name(payload.last_name, 96, "err_last_name")
    if payload.email is not None:
        email = payload.email.strip().lower() or None
        if email != target.email:
            if email and (await db.execute(select(User.id).where(User.email == email))).first():
                raise HTTPException(409, t("err_email_already_used"))
            target.email = email
    if payload.phone is not None:
        phone_norm = normalize_phone(payload.phone, payload.country or target.country)
        if not phone_norm:
            raise HTTPException(400, t("err_invalid_phone"))
        if phone_norm != target.phone:
            if (await db.execute(select(User.id).where(User.phone == phone_norm))).first():
                raise HTTPException(409, t("err_phone_already_used"))
            target.phone = phone_norm
    if payload.password is not None:
        if len(payload.password) < 6:
            raise HTTPException(400, t("err_password_too_short"))
        target.password_hash = hash_password(payload.password)
    if payload.dob is not None:
        target.age_range = parse_dob(payload.dob)
        target.dob = payload.dob
    for field in ("country", "province", "city", "role", "email_verified", "is_banned"):
        value = getattr(payload, field)
        if value is not None:
            setattr(target, field, value)
    if payload.banned_until is not None:
        target.banned_until = payload.banned_until.replace(tzinfo=None)
    await db.commit()
    await db.refresh(target)
    return me_out(target)


@router.put("/users/{user_id}/access", response_model=dict)
async def set_access(user_id: int, payload: AdminAccessIn, db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    """Free access: "lifetime", until a date (YYYY-MM-DD) or "none"."""
    target = await db.get(User, user_id)
    if not target:
        raise HTTPException(404, t("err_user_not_found"))
    await billing.admin_set_free_access(db, target, payload.free_until)
    await db.commit()
    return await billing.access_status(db, target)


@router.post("/users/{user_id}/resend-verification", response_model=dict)
async def resend_verification(user_id: int, db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    target = await db.get(User, user_id)
    if not target:
        raise HTTPException(404, t("err_user_not_found"))
    if not target.email:
        raise HTTPException(400, t("err_user_no_email"))
    token = secrets.token_urlsafe(32)
    target.email_verification_token = token
    target.email_verification_sent_at = datetime.utcnow()
    await db.commit()
    link = f"{await app_base_url(db)}/app/?verify_token={token}"
    await send_email(db, target.email, t("email_verify_subject"), t("email_verify_body", {"link": link}))
    return {"ok": True}


async def _table_exists(db: AsyncSession, name: str) -> bool:
    return bool((await db.execute(text("SELECT to_regclass(:n)"), {"n": f"public.{name}"})).scalar())


@router.delete("/users/{user_id}", response_model=dict)
async def delete_user(user_id: int, db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    if admin.id == user_id:
        raise HTTPException(400, t("err_cannot_delete_self"))
    target = await db.get(User, user_id)
    if not target:
        raise HTTPException(404, t("err_user_not_found"))
    await delete_account(db, target)
    return {"ok": True}


# ---------- channels (interests) ----------

def _apply_interest(it: Interest, payload: AdminInterestIn) -> None:
    """Look and restrictions: an empty category, icon or colour goes back to automatic."""
    import re
    if payload.names is not None:  # the name in the other languages; an empty one shows the Spanish name
        it.names = {lang: name.strip()[:128] for lang, name in payload.names.items() if isinstance(name, str) and name.strip() and len(lang) <= 8}
    for field in ("category", "icon"):
        value = getattr(payload, field)
        if value is not None:
            setattr(it, field, value.strip()[:32] or None)
    if payload.color is not None:
        color = payload.color.strip()
        if color and not re.fullmatch(r"#[0-9a-fA-F]{6}", color):
            raise HTTPException(400, t("err_invalid_color"))
        it.color = color or None
    if payload.age_ranges is not None:
        it.age_ranges = [a for a in AGE_KEYS if a in payload.age_ranges]
    if payload.active is not None:
        it.active = payload.active
    if payload.geo_level is not None:
        it.geo_level = payload.geo_level
    # the settings of its communities, as in a community made by people
    if payload.age_mode == "span":
        if payload.min_age is None and payload.max_age is None:
            raise HTTPException(400, t("err_age_span"))
        if payload.min_age is not None and payload.max_age is not None and payload.min_age > payload.max_age:
            raise HTTPException(400, t("err_age_span"))
        it.min_age, it.max_age, it.age_ranges = payload.min_age, payload.max_age, []
    elif payload.age_mode == "ranges":
        it.min_age = it.max_age = None
    if payload.access_mode is not None:
        it.access_mode = payload.access_mode
    if payload.board_mode is not None:
        it.board_mode = payload.board_mode
    if payload.retention_days is not None:
        from app.communities.service import RETENTION_CHOICES
        if payload.retention_days not in RETENTION_CHOICES:
            raise HTTPException(400, t("err_retention"))
        it.retention_days = payload.retention_days
    if payload.join_questions is not None:
        it.join_questions = [q.strip()[:200] for q in payload.join_questions if q and q.strip()][:3]
    if payload.tags is not None:
        # its own interest first, then up to 4 more
        tags = [it.slug] + [s for s in dict.fromkeys(payload.tags) if s != it.slug]
        it.tags = tags[:5]


@router.get("/pending", response_model=dict)
async def pending(db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    """What waits for review in each section (moderation, categories, communities) and in all."""
    from app.admin.pending import pending_counts
    return await pending_counts(db)


@router.get("/interests", response_model=list[dict])
async def admin_interests(db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    """Every interest with how many zones have its community and how many people are in them."""
    from app.accounts.routes import interest_out
    from app.communities.zones import JOIN_UNDER, SPLIT_AT
    # per interest: its zones and age ranges apart, and its biggest and smallest community (members, not away)
    rows = (await db.execute(select(Conversation.interest_id, Conversation.province, Conversation.age_range, func.count(ConversationMember.user_id),
                                    Conversation.scope_label, Conversation.scope_provinces)
                             .outerjoin(ConversationMember, and_(ConversationMember.conversation_id == Conversation.id,
                                                                 ConversationMember.away.is_(False), ConversationMember.banned.is_(False)))
                             .where(Conversation.kind == "channel", Conversation.interest_id.is_not(None))
                             .group_by(Conversation.interest_id, Conversation.id, Conversation.province, Conversation.age_range,
                                       Conversation.scope_label, Conversation.scope_provinces))).all()
    stats: dict[int, dict] = {}
    from app.communities.zones import geo_data, place_names
    data = await geo_data(db)
    labels: dict[str, str] = {}
    places: dict[int, set[str]] = {}
    for iid, zone, age, n, label, provinces in rows:
        places.setdefault(iid, set()).update(place_names(data, list(provinces or ([zone] if zone else [])))) 
        s = stats.setdefault(iid, {"zones": set(), "ages": set(), "sizes": []})
        s["zones"].add(zone)
        labels[zone] = label or zone
        s["ages"].add(age)
        s["sizes"].append(int(n))
    people = dict((await db.execute(select(UserInterest.interest_id, func.count()).group_by(UserInterest.interest_id))).all())
    interests = (await db.execute(select(Interest).order_by(Interest.name))).scalars().all()
    out = []
    for i in interests:
        s = stats.get(i.id, {"zones": set(), "ages": set(), "sizes": []})
        level = i.geo_level or "country"
        biggest = max(s["sizes"], default=0)
        # split when one community passes SPLIT_AT people; join into the wider level when every one has fewer than
        # JOIN_UNDER (and it has some: an interest nobody has chosen yet suggests nothing)
        suggest = ("split" if level != "province" and biggest > SPLIT_AT
                   else "join" if level != "country" and s["sizes"] and biggest < JOIN_UNDER else None)
        out.append({**interest_out(i).model_dump(), "zones": len(s["zones"]), "age_bands": len(s["ages"]),
                    "communities": len(s["sizes"]), "people": int(people.get(i.id, 0)), "biggest": biggest, "suggest": suggest,
                    # which zones (key and name) and age bands it has, to filter by them
                    "zone_list": sorted(({"key": z, "label": labels.get(z, z)} for z in s["zones"] if z), key=lambda x: x["label"]),
                    "age_list": sorted(a for a in s["ages"] if a),
                    "places": sorted(places.get(i.id, set()))})
    return out


@router.post("/interests", response_model=InterestOut)
async def create_interest(payload: AdminInterestIn, db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    from app.accounts.routes import interest_out
    if (await db.execute(select(Interest.id).where(Interest.slug == payload.slug))).first():
        raise HTTPException(409, t("err_interest_exists"))
    it = Interest(slug=payload.slug, name=payload.name, age_ranges=[], active=True)
    _apply_interest(it, payload)
    db.add(it)
    await db.commit()
    await db.refresh(it)
    return interest_out(it)


@router.patch("/interests/{interest_id}", response_model=InterestOut)
async def update_interest(interest_id: int, payload: AdminInterestIn, db: AsyncSession = Depends(get_db),
                          admin: User = Depends(require_admin)):
    from app.accounts.routes import interest_out
    it = await db.get(Interest, interest_id)
    if not it:
        raise HTTPException(404, t("err_interest_not_found"))
    from app.communities.interest_settings import apply_interest_settings, has_span
    had_span = has_span(it)
    old_level = it.geo_level
    it.slug, it.name = payload.slug, payload.name
    _apply_interest(it, payload)
    if it.geo_level != old_level:  # its communities joined into wider zones, or split into narrower ones
        from app.communities.interest_settings import regroup_geo
        await regroup_geo(db, it)
    await db.commit()
    # every zone's community of the interest follows its settings (joined per province with an age span)
    await apply_interest_settings(db, it, had_span)
    await db.refresh(it)
    return interest_out(it)


@router.delete("/interests/{interest_id}", response_model=dict)
async def delete_interest(interest_id: int, db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    in_use = (await db.execute(select(func.count()).select_from(Conversation).where(Conversation.interest_id == interest_id))).scalar_one()
    if in_use or (await _table_exists(db, "rooms") and (await db.execute(
            text("SELECT count(*) FROM rooms WHERE interest_id = :i"), {"i": interest_id})).scalar_one()):
        raise HTTPException(409, t("err_interest_in_use"))
    await db.execute(delete(UserInterest).where(UserInterest.interest_id == interest_id))
    await db.execute(delete(Interest).where(Interest.id == interest_id))
    await db.commit()
    return {"ok": True}


# ---------- languages ----------

async def _languages_out(db: AsyncSession) -> list[dict]:
    cfg = await languages.settings_of(db)
    out = []
    for code in languages.builtin_codes():
        done, total = languages.counts(code)
        out.append({"code": code, "name": languages.BUILTIN_NAMES.get(code, code), "builtin": True,
                    "enabled": code not in cfg["disabled"], "translated": done, "total": total, "job": None})
    for code, name in cfg["custom"].items():
        done, total = languages.counts(code) if languages.custom_path(code).exists() else (0, len(languages._load_lang("en")))
        out.append({"code": code, "name": name, "builtin": False, "enabled": code not in cfg["disabled"],
                    "translated": done, "total": total, "job": languages.jobs.get(code)})
    return out


@router.get("/languages", response_model=list[dict])
async def list_languages(db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    return await _languages_out(db)


@router.post("/languages", response_model=list[dict])
async def add_language(payload: dict, db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    """{"code": "ro", "name": "Română"}: adds the language and translates MeetGo into it with Claude (in the background)."""
    code = (payload.get("code") or "").strip().lower()
    name = (payload.get("name") or "").strip()[:40]
    cfg = await languages.settings_of(db)
    if not languages.valid_code(code) or not name:
        raise HTTPException(400, t("err_language_code"))
    if code in languages.builtin_codes() or code in cfg["custom"]:
        raise HTTPException(409, t("err_language_exists"))
    await ai.refresh(db)
    if not ai.api_key():
        raise HTTPException(400, t("err_ai_no_key"))
    cfg["custom"][code] = name
    if code not in cfg["disabled"]:
        cfg["disabled"].append(code)  # shown to people once it is translated and switched on
    await languages.save_settings(db, cfg)
    languages.jobs[code] = {"done": 0, "total": languages.counts("en")[1], "state": "running", "error": ""}
    asyncio.create_task(languages.translate(code, name))
    return await _languages_out(db)


@router.post("/languages/{code}/translate", response_model=list[dict])
async def complete_language(code: str, db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    """Translates what is missing of an added language (after an error, or new texts of MeetGo)."""
    cfg = await languages.settings_of(db)
    if code not in cfg["custom"]:
        raise HTTPException(404, t("err_language_not_found"))
    if (languages.jobs.get(code) or {}).get("state") != "running":
        await ai.refresh(db)
        if not ai.api_key():
            raise HTTPException(400, t("err_ai_no_key"))
        languages.jobs[code] = {"done": languages.counts(code)[0], "total": languages.counts("en")[1], "state": "running", "error": ""}
        asyncio.create_task(languages.translate(code, cfg["custom"][code]))
    return await _languages_out(db)


@router.patch("/languages/{code}", response_model=list[dict])
async def edit_language(code: str, payload: dict, db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    """{"enabled": bool} shows or hides a language in the pickers; {"name": "…"} renames an added one."""
    cfg = await languages.settings_of(db)
    if code not in languages.builtin_codes() and code not in cfg["custom"]:
        raise HTTPException(404, t("err_language_not_found"))
    if "enabled" in payload:
        if code == "en" and not payload["enabled"]:
            raise HTTPException(400, t("err_language_english"))
        cfg["disabled"] = [c for c in cfg["disabled"] if c != code] + ([] if payload["enabled"] else [code])
    if payload.get("name") and code in cfg["custom"]:
        cfg["custom"][code] = str(payload["name"]).strip()[:40]
    await languages.save_settings(db, cfg)
    return await _languages_out(db)


@router.delete("/languages/{code}", response_model=list[dict])
async def delete_language(code: str, db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    cfg = await languages.settings_of(db)
    if code not in cfg["custom"]:
        raise HTTPException(404, t("err_language_not_found"))
    cfg["custom"].pop(code)
    cfg["disabled"] = [c for c in cfg["disabled"] if c != code]
    await languages.save_settings(db, cfg)
    languages.custom_path(code).unlink(missing_ok=True)
    languages.jobs.pop(code, None)
    from app.core.i18n import reload
    reload(code)
    return await _languages_out(db)


# ---------- community bots ----------

@router.get("/bots", response_model=list[dict])
async def list_bots(db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    bots = (await db.execute(select(User).where(User.bot_role.is_not(None)).order_by(User.id))).scalars().all()
    return [{**user_summary(b), "bot_role": b.bot_role} for b in bots]


@router.get("/automod", response_model=dict)
async def automod_status(db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    """Whether the moderation bot checks the communities' rules (it needs a Claude API key)."""
    await ai.refresh(db)
    return {"enabled": bool(ai.api_key()), "model": ai.model()}


# ---------- Claude (moderation bot, translations) ----------

def _ai_out() -> dict:
    return {"configured": bool(ai.api_key()), "source": ai.source(), "hint": ai.hint(), "model": ai.model(), "models": list(ai.MODELS)}


@router.get("/ai", response_model=dict)
async def ai_status(db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    await ai.refresh(db)
    return _ai_out()


@router.put("/ai", response_model=dict)
async def ai_save(payload: dict, db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    """{"api_key": "sk-ant-…"} to store a key, {"clear": true} to forget it, {"model": "…"} to pick the model."""
    key = (payload.get("api_key") or "").strip()
    model_name = payload.get("model") or None
    if key and not key.startswith("sk-ant-"):
        raise HTTPException(400, t("err_ai_key_format"))
    if model_name and model_name not in ai.MODELS:
        raise HTTPException(400, t("err_ai_model"))
    await ai.save(db, key or None, model_name, clear=bool(payload.get("clear")))
    return _ai_out()


@router.post("/ai/test", response_model=dict)
async def ai_test(db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    """One tiny request with the key in use: {"ok": true} or {"ok": false, "error": "…"}."""
    await ai.refresh(db)
    if not ai.api_key():
        return {"ok": False, "error": t("err_ai_no_key")}
    try:
        await ai.client().messages.create(model=ai.model(), max_tokens=16, messages=[{"role": "user", "content": "Reply with OK."}])
    except Exception as e:  # the message of the API (invalid key, no credit…) is what the administrator needs
        return {"ok": False, "error": getattr(e, "message", None) or str(e)}
    return {"ok": True}


@router.post("/bots/{user_id}/session", response_model=dict)
async def bot_session(user_id: int, db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    """A session as a bot account (bot-admin, bot-moderator) for MeetGo's administrators."""
    bot = await db.get(User, user_id)
    if not bot or not bot.bot_role:
        raise HTTPException(404, t("err_user_not_found"))
    logger.info("Administrator %s opened a session as %s", admin.id, bot.display_name)
    return {"access_token": create_access_token(str(bot.id), 12 * 60)}


# ---------- moderation ----------

@router.get("/reports", response_model=list[dict])
async def list_reports(status: str = "open", db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    # child safety reports first, then the newest
    rows = (await db.execute(select(Report).where(Report.status == status).order_by(
        (Report.reason == "child_safety").desc(), Report.id.desc()).limit(200))).scalars().all()
    msgs = {m.id: m for m in (await db.execute(select(Message).where(Message.id.in_([r.message_id for r in rows if r.message_id])))).scalars().all()}
    posts = {p.id: p for p in (await db.execute(select(BoardPost).where(BoardPost.id.in_([r.post_id for r in rows if r.post_id])))).scalars().all()}
    user_ids = {r.reporter_id for r in rows} | {p.author_id for p in posts.values() if p.author_id}
    users = {u.id: u for u in (await db.execute(select(User).where(User.id.in_(user_ids)))).scalars().all()}
    out = []
    for r in rows:
        item = {"id": r.id, "kind": "post" if r.post_id else "message", "reason": r.reason, "details": r.details,
                "status": r.status, "created_at": r.created_at.isoformat(), "reporter": user_summary(users.get(r.reporter_id)),
                "message": None, "post": None}
        if r.post_id:
            p = posts.get(r.post_id)
            if p:
                item["post"] = {"id": p.id, "community_id": p.conversation_id, "kind": p.kind, "title": p.title,
                                "body": p.body, "author": user_summary(users.get(p.author_id)),
                                "created_at": p.created_at.isoformat(), "deleted": bool(p.deleted_at)}
                # The same shape as a message, so the moderation queue shows it as it is.
                item["message"] = {"id": p.id, "conversation_id": p.conversation_id, "sender": item["post"]["author"],
                                   "body": f"{p.title}\n\n{p.body or ''}".strip(), "created_at": item["post"]["created_at"],
                                   "deleted": bool(p.deleted_at), "original_body": p.body if p.deleted_at else None,
                                   "attachments": []}
        else:
            m = msgs.get(r.message_id)
            shown = (await messages_out(db, [m], admin.id))[0] if m else None
            if shown and m.deleted_at:
                shown["original_body"] = m.body  # moderators see what was removed
            item["message"] = shown
        out.append(item)
    return out


@router.post("/reports/{report_id}/resolve", response_model=dict)
async def resolve_report(report_id: int, payload: ReportResolveIn, db: AsyncSession = Depends(get_db),
                         admin: User = Depends(require_admin)):
    report = await db.get(Report, report_id)
    if not report:
        raise HTTPException(404, t("err_request_not_found"))
    if report.post_id:
        post = await db.get(BoardPost, report.post_id)
        if payload.delete_message and post and not post.deleted_at:
            await delete_post_data(db, post)
        same = Report.post_id == report.post_id
    else:
        if payload.delete_message:
            msg = await db.get(Message, report.message_id)
            if msg:
                await delete_message(db, msg, admin, None)
        same = Report.message_id == report.message_id
    await db.execute(update(Report).where(same, Report.status == "open").values(
        status=payload.status, resolved_by_id=admin.id, resolved_at=utcnow()))
    await db.commit()
    from app.admin.pending import tell_admins
    await tell_admins(db)
    return {"ok": True}


# ---------- subscriptions ----------

@router.get("/billing", response_model=dict)
async def get_billing(db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    stripe = await get_section(db, "stripe")
    play = await get_section(db, "play")
    fcm = await get_section(db, "fcm")
    base = settings.PUBLIC_API_BASE.rstrip("/")
    counts = {
        "gift": (await db.execute(select(func.count()).select_from(AccessGrant))).scalar_one(),
        "web": (await db.execute(select(func.count()).select_from(StripeSubscription).where(
            StripeSubscription.status.in_(billing.STRIPE_ACTIVE)))).scalar_one(),
        "play": (await db.execute(select(func.count()).select_from(PlaySubscription))).scalar_one(),
    }
    def ends(enc: str | None) -> str | None:  # "…4f2a": enough to recognise a key, never the key
        value = decrypt(enc or "")
        return value[-4:] if len(value) >= 12 else None

    def sa_email(enc: str | None) -> str | None:
        try:
            return json.loads(decrypt(enc or "") or "{}").get("client_email")
        except ValueError:
            return None

    return {
        **await billing.billing_config(db),
        "stripe": {"configured": bool(stripe.get("secret_enc")), "webhook_configured": bool(stripe.get("webhook_enc")),
                   "secret_ends": ends(stripe.get("secret_enc")), "webhook_ends": ends(stripe.get("webhook_enc")),
                   "prices": stripe.get("prices") or {}, "webhook_url": f"{base}/billing/stripe/webhook"},
        "play": {"package": play.get("package") or "app.meetgo.android", "product": play.get("product") or "meetgo",
                 "configured": bool(play.get("service_account_enc")), "store_url": play.get("store_url") or "",
                 "account": sa_email(play.get("service_account_enc")), "reports_bucket": play.get("reports_bucket") or ""},
        "fcm": {"configured": bool(fcm.get("service_account_enc")), "project_id": fcm.get("project_id"),
                "account": sa_email(fcm.get("service_account_enc"))},
        "counts": counts,
    }


@router.put("/billing", response_model=dict)
async def put_billing(payload: dict, db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    """Turns subscriptions on or off and stores Stripe, Google Play and Firebase credentials."""
    cfg = await get_section(db, "billing")
    if "enabled" in payload:
        cfg["enabled"] = bool(payload["enabled"])
    if "trial_days" in payload:
        cfg["trial_days"] = max(0, min(int(payload["trial_days"] or 0), 90))
    await set_section(db, "billing", cfg)

    stripe_in = payload.get("stripe") or {}
    if stripe_in:
        stripe = await get_section(db, "stripe")
        if stripe_in.get("secret"):
            secret = stripe_in["secret"].strip()
            stripe["prices"] = await billing.stripe_ensure_prices(secret)
            stripe["secret_enc"] = encrypt(secret)
        if stripe_in.get("webhook"):
            stripe["webhook_enc"] = encrypt(stripe_in["webhook"].strip())
        await set_section(db, "stripe", stripe)

    play_in = payload.get("play") or {}
    if play_in:
        play = await get_section(db, "play")
        for key in ("package", "product", "store_url", "reports_bucket"):
            if key in play_in:
                play[key] = (play_in[key] or "").strip()
        if play_in.get("service_account"):
            sa = json.loads(play_in["service_account"])
            if not sa.get("client_email") or not sa.get("private_key"):
                raise HTTPException(400, t("err_service_account"))
            play["service_account_enc"] = encrypt(json.dumps(sa))
        await set_section(db, "play", play)

    fcm_in = payload.get("fcm") or {}
    if fcm_in.get("service_account"):
        sa = json.loads(fcm_in["service_account"])
        if not sa.get("project_id") or not sa.get("private_key"):
            raise HTTPException(400, t("err_service_account"))
        await set_section(db, "fcm", {"service_account_enc": encrypt(json.dumps(sa)), "project_id": sa["project_id"]})
    from app.business.service import clear_cache
    clear_cache()
    return await get_billing(db, admin)


@router.get("/promo-codes", response_model=list[dict])
async def list_codes(db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    res = await db.execute(select(PromoCode).order_by(PromoCode.created_at))
    return [promo_out(p) for p in res.scalars().all()]


@router.put("/promo-codes", response_model=dict)
async def put_code(payload: PromoCodeIn, db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    code = normalise_code(payload.code)
    p = await db.get(PromoCode, code)
    if p and payload.max_uses is not None and payload.max_uses < p.used:
        raise HTTPException(409, t("err_promo_below_used"))
    if not p:
        p = PromoCode(code=code, used=0)
        db.add(p)
    p.aliases = [normalise_code(a) for a in payload.aliases if a.strip()]
    p.duration, p.max_uses, p.public, p.expires_on = payload.duration, payload.max_uses, payload.public, payload.expires_on
    await db.commit()
    return promo_out(p)


@router.delete("/promo-codes/{code}", response_model=dict)
async def delete_code(code: str, db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    await db.execute(delete(PromoCode).where(PromoCode.code == normalise_code(code)))
    await db.commit()
    return {"ok": True}


# ---------- container logs (needs the Docker socket and DEBUG_COMPOSE_LOGS) ----------

@router.get("/compose-logs")
async def compose_logs(token: str = "", db: AsyncSession = Depends(get_db)):
    if not settings.DEBUG_COMPOSE_LOGS:
        raise HTTPException(404, t("err_debug_disabled"))
    # EventSource cannot send headers, so the administrator token comes as a query parameter.
    try:
        admin = await db.get(User, int(decode_token(token)))
    except Exception:
        raise HTTPException(401, t("err_invalid_token"))
    if not admin or admin.role != "admin":
        raise HTTPException(403, t("err_admin_required"))
    if docker is None:
        raise HTTPException(500, t("err_docker_sdk_missing"))
    try:
        client = docker.from_env()
        project = os.getenv("COMPOSE_PROJECT_NAME")
        label = f"com.docker.compose.project={project}" if project else "com.docker.compose.project"
        containers = client.containers.list(filters={"label": label})
    except Exception as e:
        raise HTTPException(500, t("err_docker_unavailable", {"error": e}))
    if not containers:
        raise HTTPException(404, t("err_no_compose_containers"))

    queue: asyncio.Queue[dict] = asyncio.Queue()
    stop_event = threading.Event()
    loop = asyncio.get_running_loop()

    def pump(container, service: str):
        try:
            for raw in container.logs(stream=True, follow=True, timestamps=True, tail=200):
                if stop_event.is_set():
                    break
                line = raw.decode("utf-8", errors="replace").rstrip("\n")
                loop.call_soon_threadsafe(queue.put_nowait, {"ts": datetime.utcnow().isoformat() + "Z", "service": service, "line": line})
        except Exception as e:
            loop.call_soon_threadsafe(queue.put_nowait, {"ts": datetime.utcnow().isoformat() + "Z", "service": service,
                                                         "line": t("log_error_line", {"error": e})})

    workers = []
    for c in containers:
        worker = threading.Thread(target=pump, args=(c, c.labels.get("com.docker.compose.service", c.name)), daemon=True)
        worker.start()
        workers.append(worker)

    async def stream():
        try:
            while True:
                yield f"data: {json.dumps(await queue.get())}\n\n"
        finally:
            stop_event.set()

    return StreamingResponse(stream(), media_type="text/event-stream")
