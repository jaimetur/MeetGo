import secrets
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import and_, delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, get_db, require_write_access
from app.core.i18n import t
from app.core.models import (
    Conversation, ConversationMember, DMRequest, DMStatus, FriendRequest, FriendRequestStatus, Friendship, Interest, User,
    UserInterest,
)
from app.core.schemas import EmailPrefsIn, InterestOut, MeOut, SetInterestsIn, UpdateProfileIn, UserOut
from app.communities.service import interest_allows
from app.core.app_settings import get_settings_row
from app.conversations.service import (
    AGE_LABELS, can_join_channel, channel_for, get_membership, join, join_interest_channel, leave_interest_channel,
    move_channels_to_zone, user_age_key,
)
from app.mail.notify_email import account_email
from app.realtime.service import online_ids
from app.core.security import hash_password
from app.accounts.common import clean_alias, clean_person_name, me_out, normalize_phone, parse_dob, user_out, valid_email

router = APIRouter(tags=["me"])


@router.get("/me", response_model=MeOut)
async def me(user: User = Depends(get_current_user)):
    return me_out(user)


@router.get("/settings/public", response_model=dict)
async def public_settings(db: AsyncSession = Depends(get_db)):
    data = (await get_settings_row(db)).data or {}
    out = {key: data.get(key) or ([] if key not in ("provinces_by_country", "cities_by_country", "region_kinds", "group_kinds", "region_groups") else {})
           for key in ("languages", "age_ranges", "countries", "calling_codes", "provinces_by_country", "cities_by_country", "region_kinds", "group_kinds", "region_groups")}
    # While subscriptions are off, the apps hide everything about plans and codes.
    out["subscriptions"] = bool((data.get("billing") or {}).get("enabled"))
    return out


@router.patch("/me/profile", response_model=MeOut)
async def update_profile(payload: UpdateProfileIn, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    old_province, old_age = user.province, user_age_key(user)
    if payload.display_name is not None and payload.display_name.strip().lstrip("@") != user.display_name:
        user.display_name = await clean_alias(db, payload.display_name, user.id)
    if payload.first_name is not None:
        user.first_name = clean_person_name(payload.first_name, 64, "err_first_name")
    if payload.last_name is not None:
        user.last_name = clean_person_name(payload.last_name, 96, "err_last_name")
    password_changed = False
    if payload.email is not None:
        email = payload.email.strip().lower()
        if not email:
            raise HTTPException(400, t("err_email_required"))
        if not valid_email(email):
            raise HTTPException(400, t("err_invalid_email"))
        if email != user.email:
            if (await db.execute(select(User.id).where(User.email == email))).first():
                raise HTTPException(409, t("err_email_already_used"))
            token = secrets.token_urlsafe(32)
            user.email = email
            user.email_verified = False
            user.email_verification_token = token
            user.email_verification_sent_at = datetime.utcnow()
            await account_email(db, user, "email_verify", None, f"/app/?verify_token={token}")
    if payload.password is not None:
        if len(payload.password) < 6:
            raise HTTPException(400, t("err_password_too_short"))
        user.password_hash = hash_password(payload.password)
        user.password_temp = False
        password_changed = True
    if payload.dob is not None and payload.dob != user.dob:
        if (user.dob_change_count or 0) >= 1:
            raise HTTPException(409, t("err_dob_change_used"))
        user.age_range = parse_dob(payload.dob)
        user.dob = payload.dob
        user.dob_change_count = (user.dob_change_count or 0) + 1
    if payload.country is not None:
        user.country = payload.country or None
    if payload.province is not None:
        province = payload.province.strip()
        if not province:
            raise HTTPException(400, t("err_province_required"))
        user.province = province
    if payload.phone is not None:
        phone_norm = normalize_phone(payload.phone, payload.country or user.country)
        if not phone_norm:
            raise HTTPException(400, t("err_invalid_phone"))
        if phone_norm != user.phone:
            if user.phone_changed_at and datetime.utcnow() - user.phone_changed_at < timedelta(days=30):
                raise HTTPException(409, t("err_phone_change_limited"))
            if (await db.execute(select(User.id).where(User.phone == phone_norm))).first():
                raise HTTPException(409, t("err_phone_already_used"))
            user.phone = phone_norm
            user.phone_changed_at = datetime.utcnow()
    if payload.city is not None:
        user.city = payload.city.strip() or None
    if payload.accept_dm is not None:
        user.accept_dm = bool(payload.accept_dm)
    if payload.read_receipts is not None:
        user.read_receipts = payload.read_receipts
    if payload.last_seen_privacy is not None:
        user.last_seen_privacy = payload.last_seen_privacy
    if payload.avatar_url is not None:
        user.avatar_url = payload.avatar_url.strip() or None
    if payload.bio is not None:
        user.bio = payload.bio[:500]
    user.last_active_at = datetime.utcnow()
    if (user.province, user_age_key(user)) != (old_province, old_age):
        # A new zone: communities of other zones become away, those of this zone come back.
        await move_channels_to_zone(db, user, old_province, old_age)
    await db.commit()
    await db.refresh(user)
    if password_changed:
        await account_email(db, user, "email_password_changed", None, "/app/")
    return me_out(user)


@router.patch("/me/email-prefs", response_model=MeOut)
async def update_email_prefs(payload: EmailPrefsIn, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """Which automatic emails you get."""
    prefs = dict(user.email_prefs or {})
    for key, value in payload.model_dump(exclude_none=True).items():
        if key != "reports" or user.role == "admin":
            prefs[key] = bool(value)
    user.email_prefs = prefs
    await db.commit()
    await db.refresh(user)
    return me_out(user)


@router.get("/users/search", response_model=list[dict])
async def search_users(q: str = "", db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """People you can talk to: your friends and people from your province."""
    q = q.strip()
    if len(q) < 2:
        return []
    friend_ids = select(Friendship.friend_id).where(Friendship.user_id == user.id)
    res = await db.execute(select(User).where(
        User.id != user.id, User.is_banned.is_(False),
        # by alias, or by first name and surnames ("javier calde")
        or_(User.display_name.ilike(f"%{q.lstrip('@')}%"),
            func.concat_ws(" ", User.first_name, User.last_name).ilike(f"%{q}%")),
        or_(User.id.in_(friend_ids), User.province == user.province),
    ).order_by(User.display_name).limit(20))
    users = res.scalars().all()
    friends = set((await db.execute(friend_ids)).scalars().all())
    online = await online_ids([u.id for u in users])
    ids = [u.id for u in users]
    # what I already asked them for, so the buttons say so
    friend_asked = set((await db.execute(select(FriendRequest.to_user_id).where(
        FriendRequest.from_user_id == user.id, FriendRequest.to_user_id.in_(ids),
        FriendRequest.status == FriendRequestStatus.PENDING))).scalars().all()) if ids else set()
    dm_asked = set((await db.execute(select(DMRequest.to_user_id).where(
        DMRequest.from_user_id == user.id, DMRequest.to_user_id.in_(ids),
        DMRequest.status == DMStatus.PENDING))).scalars().all()) if ids else set()
    return [{"id": u.id, "display_name": u.display_name, "first_name": u.first_name, "last_name": u.last_name,
             "avatar_url": u.avatar_url, "province": u.province,
             "friend": u.id in friends, "accept_dm": u.accept_dm, "online": u.id in online,
             "friend_requested": u.id in friend_asked, "dm_requested": u.id in dm_asked} for u in users]


@router.get("/users/{user_id}", response_model=dict)
async def get_user(user_id: int, db: AsyncSession = Depends(get_db), me_user: User = Depends(get_current_user)):
    u = await db.get(User, user_id)
    if not u:
        raise HTTPException(404, t("err_user_not_found"))
    is_friend = bool((await db.execute(select(Friendship).where(
        Friendship.user_id == me_user.id, Friendship.friend_id == user_id))).first())
    shares = bool((await db.execute(
        select(ConversationMember.conversation_id).where(ConversationMember.user_id == me_user.id)
        .intersect(select(ConversationMember.conversation_id).where(ConversationMember.user_id == user_id)))).first())
    if u.province != me_user.province and not is_friend and not shares and me_user.role != "admin":
        raise HTTPException(403, t("err_forbidden_diff_province"))
    out = user_out(u).model_dump(mode="json")
    out.pop("dob", None)
    out["online"] = u.id in await online_ids([u.id])
    out["friend"] = is_friend
    # a request of mine still waiting: the button says so instead of asking again
    out["friend_requested"] = not is_friend and bool((await db.execute(select(FriendRequest.id).where(
        FriendRequest.from_user_id == me_user.id, FriendRequest.to_user_id == user_id,
        FriendRequest.status == FriendRequestStatus.PENDING))).first())
    return out


def interest_out(i: Interest) -> InterestOut:
    return InterestOut(id=i.id, slug=i.slug, name=i.name, category=i.category, icon=i.icon, color=i.color,
                       age_ranges=list(i.age_ranges or []), active=i.active is not False, tags=list(i.tags or [i.slug]),
                       min_age=i.min_age, max_age=i.max_age, access_mode=i.access_mode or "open", board_mode=i.board_mode or "open",
                       retention_days=i.retention_days or 365, join_questions=list(i.join_questions or []))


@router.get("/interests", response_model=list[InterestOut])
async def list_interests(db: AsyncSession = Depends(get_db)):
    """Every interest with its look and restrictions (the app offers the active ones open to your age range)."""
    res = await db.execute(select(Interest).order_by(Interest.name))
    return [interest_out(i) for i in res.scalars().all()]


@router.get("/me/interests", response_model=list[str])
async def my_interests(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    res = await db.execute(select(Interest.slug).join(UserInterest, UserInterest.interest_id == Interest.id).where(
        UserInterest.user_id == user.id))
    return list(res.scalars().all())


@router.post("/me/interests", response_model=dict)
async def set_my_interests(payload: SetInterestsIn, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """Choosing an interest joins its channel in your zone; dropping it leaves that channel."""
    age = user_age_key(user)
    res = await db.execute(select(Interest).where(Interest.slug.in_(payload.interest_slugs or [])))
    current = set((await db.execute(select(UserInterest.interest_id).where(UserInterest.user_id == user.id))).scalars().all())
    # a restricted interest cannot be chosen now, but one chosen before is kept
    wanted = {i.id for i in res.scalars().all() if interest_allows(i, age, user) or i.id in current}
    for interest_id in current - wanted:
        await db.execute(delete(UserInterest).where(UserInterest.user_id == user.id, UserInterest.interest_id == interest_id))
        await leave_interest_channel(db, user, interest_id, user.province, age)
    for interest_id in wanted - current:
        db.add(UserInterest(user_id=user.id, interest_id=interest_id))
        await join_interest_channel(db, user, interest_id)
    await db.commit()
    return {"ok": True}


@router.get("/channels/explore", response_model=list[dict])
async def explore_channels(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """Every interest's channel (community) in your zone, with how many people are in it and whether you are.
    Away memberships (other zones) do not count; invitation-only communities show only to their members."""
    age = user_age_key(user)
    interests = [i for i in (await db.execute(select(Interest).order_by(Interest.name))).scalars().all() if interest_allows(i, age, user)]
    res = await db.execute(
        select(Conversation.interest_id, Conversation.id, Conversation.access_mode, func.count(ConversationMember.user_id))
        .outerjoin(ConversationMember, and_(ConversationMember.conversation_id == Conversation.id,
                                            ConversationMember.banned.is_(False), ConversationMember.away.is_(False)))
        .where(Conversation.kind == "channel", Conversation.province == user.province, Conversation.age_range.in_((age, "custom")),
               Conversation.interest_id.isnot(None))
        .group_by(Conversation.interest_id, Conversation.id, Conversation.access_mode))
    by_interest = {iid: (cid, mode, n) for iid, cid, mode, n in res.all()}
    mine = set((await db.execute(select(ConversationMember.conversation_id).where(
        ConversationMember.user_id == user.id, ConversationMember.away.is_(False)))).scalars().all())
    out = []
    for i in interests:
        cid, mode, n = by_interest.get(i.id, (None, "open", 0))
        if mode == "invite" and cid not in mine:
            continue
        out.append({"interest": {"id": i.id, "slug": i.slug, "name": i.name}, "conversation_id": cid,
                    "member_count": n, "joined": bool(cid and cid in mine), "access_mode": mode,
                    "zone": f"{user.province} · {AGE_LABELS.get(age, age)}"})
    out.sort(key=lambda c: (-c["member_count"], c["interest"]["name"]))
    return out


@router.post("/channels/{interest_id}/join", response_model=dict)
async def join_channel(interest_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(require_write_access)):
    interest = await db.get(Interest, interest_id)
    if not interest_allows(interest, user_age_key(user), user):
        raise HTTPException(404, t("err_interest_not_found"))
    conv = await channel_for(db, user.province, user_age_key(user), interest_id)
    existing = await get_membership(db, conv.id, user.id)
    if existing and existing.banned:
        raise HTTPException(403, t("err_banned_here"))
    if not existing and conv.access_mode != "open":  # ask or use the invitation from the community page
        raise HTTPException(403, t("err_community_closed"))
    await join(db, conv, user.id)
    if not await db.get(UserInterest, (user.id, interest_id)):
        db.add(UserInterest(user_id=user.id, interest_id=interest_id))
    member = (await db.execute(select(ConversationMember).where(
        ConversationMember.conversation_id == conv.id, ConversationMember.user_id == user.id))).scalar_one()
    if member.banned:
        raise HTTPException(403, t("err_banned_here"))
    if not can_join_channel(user, conv):
        raise HTTPException(403, t("err_forbidden"))
    await db.commit()
    return {"conversation_id": conv.id}
