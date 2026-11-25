"""Communities: channels of a zone (interest ones and custom ones) with access modes, roles and join requests."""

import re
import unicodedata
from datetime import timedelta

from fastapi import HTTPException
from sqlalchemy import and_, func, or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.i18n import t
from app.core.models import (
    BoardPost, CommunityRequest, Conversation, ConversationMember, Interest, User, utcnow,
)
from app.conversations.service import DEFAULT_RULES, age_fits_sql, fits_age, get_membership, iso, user_age_key
from app.realtime.service import online_ids

ROLE_RANK = {"owner": 0, "admin": 1, "moderator": 2, "member": 3}
# How long a community's chat keeps its messages, in days: interest communities a year; people's communities choose.
RETENTION_CHOICES = (1, 2, 3, 7, 30, 90, 180, 365)
INTEREST_RETENTION = 365
NEW_COMMUNITY_RETENTION = 30
STAFF = ("owner", "admin", "moderator")


def slugify(text: str) -> str:
    plain = unicodedata.normalize("NFKD", text or "").encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", plain).strip("-")[:60] or "community"


def join_questions(conv: Conversation) -> list[str]:
    """Up to 3 questions people answer when they ask to join (communities that need approval)."""
    return [q for q in ((conv.policy_json or {}).get("join_questions") or []) if isinstance(q, str) and q.strip()][:3]


def clean_questions(questions: list[str] | None) -> list[str]:
    return [q.strip()[:200] for q in (questions or []) if q and q.strip()][:3]


def in_zone(user: User, conv: Conversation) -> bool:
    """My province, and my age fits (the zone's range, or the community's own age span)."""
    return conv.province == user.province and fits_age(user, conv)


def active(member: ConversationMember | None) -> bool:
    """A membership that counts: not away (other zone) and not banned."""
    return bool(member and not member.away and not member.banned)


def staff_of(member: ConversationMember | None, user: User) -> bool:
    """Owner, admins and moderators (people linked to bot-admin or bot-moderator), and MeetGo's administrators."""
    return user.role == "admin" or bool(active(member) and member.role in STAFF)


def admin_of(member: ConversationMember | None, user: User) -> bool:
    """Owner and admins (linked to bot-admin), and MeetGo's administrators: invitations, requests, lifting bans."""
    return user.role == "admin" or bool(active(member) and member.role in ("owner", "admin"))


def rank_of(member: ConversationMember | None, user: User) -> int:
    """Lower is higher: MeetGo's administrators rank as owners."""
    if user.role == "admin":
        return 0
    return ROLE_RANK.get(member.role, 9) if active(member) else 9


def banned_now(member: ConversationMember | None) -> bool:
    return bool(member and member.ban_until and member.ban_until > utcnow())


# The bots' sanctions for breaking the rules: 6 hours, then 24 hours, then for good.
SANCTION_HOURS = (6, 24)


def ban(member: ConversationMember, hours: int | None) -> None:
    """Ban for some hours (reads but cannot write), or for good (out of the community, cannot come back)."""
    if hours:
        member.ban_until = utcnow() + timedelta(hours=hours)
    else:
        member.banned = True
        member.ban_until = None
        member.role = "member"
        member.hidden = True


def sanction(member: ConversationMember) -> int | None:
    """One more rule broken: the next ban of the ladder. Returns its hours, or None for a ban for good."""
    member.strikes = (member.strikes or 0) + 1
    member.last_strike_at = utcnow()
    hours = SANCTION_HOURS[member.strikes - 1] if member.strikes <= len(SANCTION_HOURS) else None
    ban(member, hours)
    return hours


def lift_ban(member: ConversationMember) -> None:
    member.ban_until = None
    if member.banned:
        member.banned = False
        member.hidden = False


async def bot_ids(db: AsyncSession) -> dict[str, int]:
    """{"admin": id of bot-admin, "moderator": id of bot-moderator}."""
    return dict((await db.execute(select(User.bot_role, User.id).where(User.bot_role.is_not(None)))).all())


def can_see(user: User, conv: Conversation, member: ConversationMember | None) -> bool:
    if conv.kind != "channel":
        return False
    if user.role == "admin" or (member and not member.away):
        return True
    return in_zone(user, conv) and conv.access_mode != "invite"


async def get_community(db: AsyncSession, community_id: int, user: User) -> tuple[Conversation, ConversationMember | None]:
    """The community and my membership (may be None); 404 when I cannot see it."""
    conv = await db.get(Conversation, community_id)
    member = await get_membership(db, community_id, user.id) if conv else None
    if not conv or not can_see(user, conv, member):
        raise HTTPException(404, t("err_community_not_found"))
    return conv, member


def interest_allows(interest: Interest | None, age: str | None, user: User | None = None) -> bool:
    """An interest's restrictions: it is active and, with an age span, the person's age fits it (from the date of
    birth); otherwise, when it lists age ranges, `age` is one of them."""
    from app.communities.interest_settings import has_span
    from app.conversations.service import user_years
    if not interest or interest.active is False:
        return False
    if has_span(interest):
        years = user_years(user) if user else None
        return years is not None and (interest.min_age or 0) <= years <= (interest.max_age if interest.max_age is not None else 200)
    return not interest.age_ranges or age in interest.age_ranges


def interest_visible():
    """SQL: the channel has no interest, or its interest is active and open to the channel's age range."""
    return or_(Conversation.interest_id.is_(None), and_(
        Interest.active.is_not(False),
        or_(func.jsonb_array_length(Interest.age_ranges) == 0,
            Interest.age_ranges.op("@>")(func.jsonb_build_array(Conversation.age_range)))))


async def ensure_interest_channels(db: AsyncSession, user: User, zone: tuple[str, str] | None = None) -> None:
    """Every interest has its community in each zone: create the missing ones of my zone (or of `zone`)."""
    from app.communities.interest_settings import channel_values, interest_key
    province, age = zone or (user.province, user_age_key(user))
    interests = [i for i in (await db.execute(select(Interest))).scalars().all() if interest_allows(i, age, user)]
    if not interests:
        return
    defaults = {"min_age": None, "max_age": None}
    rows = [dict(kind="channel", province=province, age_range=interest_key(i, age), interest_id=i.id, created_at=utcnow(),
                 slow_mode_seconds=0, rules_markdown=DEFAULT_RULES, **{**defaults, **channel_values(i)})
            for i in interests]
    await db.execute(pg_insert(Conversation).values(rows).on_conflict_do_nothing(constraint="uq_channel_key"))
    await db.commit()


async def staff_ids(db: AsyncSession, conversation_id: int) -> list[int]:
    bots = set((await bot_ids(db)).values())
    res = await db.execute(select(ConversationMember.user_id).where(
        ConversationMember.conversation_id == conversation_id, ConversationMember.role.in_(STAFF),
        ConversationMember.away.is_(False), ConversationMember.banned.is_(False)))
    return [u for u in res.scalars().all() if u not in bots]


async def communities_out(db: AsyncSession, user: User, convs: list[Conversation], detail: bool = False) -> list[dict]:
    if not convs:
        return []
    ids = [c.id for c in convs]
    interest_ids = {c.interest_id for c in convs if c.interest_id}
    interests = {}
    if interest_ids:
        interests = {i.id: i for i in (await db.execute(select(Interest).where(Interest.id.in_(interest_ids)))).scalars().all()}
    members: dict[int, list[int]] = {}
    bots = set((await bot_ids(db)).values())
    for cid, uid in (await db.execute(select(ConversationMember.conversation_id, ConversationMember.user_id).where(
            ConversationMember.conversation_id.in_(ids), ConversationMember.banned.is_(False),
            ConversationMember.away.is_(False), ConversationMember.user_id.not_in(bots or {0})))).all():
        members.setdefault(cid, []).append(uid)
    online = await online_ids({u for uids in members.values() for u in uids})
    mine = {m.conversation_id: m for m in (await db.execute(select(ConversationMember).where(
        ConversationMember.conversation_id.in_(ids), ConversationMember.user_id == user.id))).scalars().all()}
    pending = set((await db.execute(select(CommunityRequest.conversation_id).where(
        CommunityRequest.conversation_id.in_(ids), CommunityRequest.user_id == user.id,
        CommunityRequest.status == "pending"))).scalars().all())
    upcoming = dict((await db.execute(select(BoardPost.conversation_id, func.count()).where(
        BoardPost.conversation_id.in_(ids), BoardPost.kind.in_(("meetup", "event")), BoardPost.deleted_at.is_(None),
        func.coalesce(BoardPost.ends_at, BoardPost.starts_at) >= utcnow()).group_by(BoardPost.conversation_id))).all())
    out = []
    for c in convs:
        interest = interests.get(c.interest_id)
        member = mine.get(c.id)
        joined = active(member)
        title = interest.name if interest else (c.title or "")
        out.append({
            "id": c.id,
            "kind": "interest" if c.interest_id else "custom",
            "title": title,
            "slug": interest.slug if interest else slugify(title),
            "description": c.description,
            "avatar_url": c.avatar_url,
            "province": c.province,
            "age_range": c.age_range,
            "my_zone": in_zone(user, c),
            "access_mode": c.access_mode,
            "board_mode": c.board_mode,
            "member_count": len(members.get(c.id, [])),
            "online_count": sum(1 for u in members.get(c.id, []) if u in online),
            "joined": joined,
            "role": member.role if joined else None,
            "request_pending": c.id in pending and not joined,
            "upcoming_count": upcoming.get(c.id, 0),
            "conversation_id": c.id,
            "rules": c.rules_markdown or "",
            "invite_code": c.invite_code if detail and admin_of(member, user) else None,
            "ban_until": iso(member.ban_until) if joined and banned_now(member) else None,
            "created_at": iso(c.created_at),
            "retention_days": c.retention_days,
            # the interests it is about: suggestions to people with those interests
            "tags": (list(interest.tags or [interest.slug]) if interest else list(c.interest_tags or [])),
            "min_age": c.min_age,
            "max_age": c.max_age,
            "join_questions": join_questions(c),
            # set in the administration (None: the app picks them from the name)
            "category": interest.category if interest else None,
            "icon": interest.icon if interest else None,
            "color": interest.color if interest else None,
        })
    return out


AGE_KEYS = ("18_30", "31_60", "61_plus")


async def valid_zone(db: AsyncSession, province: str | None, age_range: str | None, country: str | None = None,
                     area: str | None = None) -> tuple[tuple[str, ...], str] | None:
    """A zone to look at: one province (region), a group of them (an autonomous community...) or a whole country,
    with an age range. Its regions and the age range, or None."""
    from app.core.app_settings import get_settings_row
    if age_range not in AGE_KEYS or not (province or country):
        return None
    data = (await get_settings_row(db)).data or {}
    by_country = data.get("provinces_by_country") or {}
    if province:
        provinces = {p.get("value") for ps in by_country.values() for p in ps}
        return ((province,), age_range) if province in provinces else None
    regions = [p.get("value") for p in by_country.get(country or "", [])]
    if not regions:
        return None
    if area:
        group = next((g for g in (data.get("region_groups") or {}).get(country, []) if g.get("value") == area), None)
        if not group:
            return None
        regions = [r for r in group.get("regions") or [] if r in regions]
    return (tuple(regions), age_range) if regions else None


async def list_communities(db: AsyncSession, user: User, q: str = "", mine: bool = False,
                           zone: tuple[tuple[str, ...], str] | None = None) -> list[dict]:
    """My zone's communities; with `zone`, those of another province, of a group of provinces or of a whole country,
    to discover them (only my zone's can be joined). Over several provinces, only communities with people in them."""
    if zone and zone == ((user.province,), user_age_key(user)):
        zone = None
    if zone:
        provinces, age = zone
        query = select(Conversation).outerjoin(Interest, Interest.id == Conversation.interest_id).where(
            Conversation.kind == "channel", Conversation.province.in_(provinces), age_fits_sql(user),
            Conversation.access_mode != "invite", interest_visible())
        if len(provinces) == 1:
            await ensure_interest_channels(db, user, (provinces[0], age))
        else:
            bots = set((await bot_ids(db)).values())
            query = query.where(Conversation.id.in_(select(ConversationMember.conversation_id).where(
                ConversationMember.away.is_(False), ConversationMember.banned.is_(False),
                ConversationMember.user_id.not_in(bots or {0}))))
        if q.strip():
            like = f"%{q.strip()}%"
            query = query.where(or_(Conversation.title.ilike(like), Interest.name.ilike(like), Conversation.description.ilike(like)))
        out = await communities_out(db, user, list((await db.execute(query.limit(400))).scalars().all()))
        out.sort(key=lambda c: (c["title"].lower(), -c["member_count"]) if len(provinces) == 1 else (-c["member_count"], c["title"].lower()))
        return out
    if not user.bot_role:
        await ensure_interest_channels(db, user)
    my_ids = select(ConversationMember.conversation_id).where(
        ConversationMember.user_id == user.id, ConversationMember.away.is_(False), ConversationMember.banned.is_(False))
    query = select(Conversation).outerjoin(Interest, Interest.id == Conversation.interest_id).where(Conversation.kind == "channel")
    if user.bot_role:  # the bots are in every community, of every zone
        query = query.where(Conversation.id.in_(my_ids)).limit(300)
    else:
        query = query.where(Conversation.province == user.province, age_fits_sql(user))
    if mine:
        query = query.where(Conversation.id.in_(my_ids))
    else:
        query = query.where(or_(and_(Conversation.access_mode != "invite", interest_visible()), Conversation.id.in_(my_ids)))
    if q.strip():
        like = f"%{q.strip()}%"
        query = query.where(or_(Conversation.title.ilike(like), Interest.name.ilike(like), Conversation.description.ilike(like)))
    convs = list((await db.execute(query)).scalars().all())
    out = await communities_out(db, user, convs)
    out.sort(key=lambda c: (not c["joined"], -c["member_count"], c["title"].lower()))
    return out


async def hand_over_ownership(db: AsyncSession, conv: Conversation, leaving_user_id: int) -> None:
    """The owner leaves: the oldest admin, or else the oldest member, becomes the owner."""
    bots = set((await bot_ids(db)).values())
    base = select(ConversationMember).where(
        ConversationMember.conversation_id == conv.id, ConversationMember.user_id != leaving_user_id,
        ConversationMember.user_id.not_in(bots or {0}),
        ConversationMember.away.is_(False), ConversationMember.banned.is_(False))
    nxt = (await db.execute(base.where(ConversationMember.role == "admin").order_by(ConversationMember.joined_at).limit(1))).scalar_one_or_none()
    if not nxt:
        nxt = (await db.execute(base.order_by(ConversationMember.joined_at).limit(1))).scalar_one_or_none()
    if nxt:
        nxt.role = "owner"


async def pending_request(db: AsyncSession, conversation_id: int, user_id: int) -> CommunityRequest | None:
    res = await db.execute(select(CommunityRequest).where(
        CommunityRequest.conversation_id == conversation_id, CommunityRequest.user_id == user_id,
        CommunityRequest.status == "pending").order_by(CommunityRequest.id.desc()).limit(1))
    return res.scalar_one_or_none()


def community_member_filter(conversation_id: int):
    return and_(ConversationMember.conversation_id == conversation_id, ConversationMember.banned.is_(False),
                ConversationMember.away.is_(False))


async def clean_interest_tags(db: AsyncSession, slugs: list[str] | None) -> list[str]:
    """Up to 5 existing interests, in the order given."""
    wanted = list(dict.fromkeys(s for s in (slugs or []) if s))[:5]
    if not wanted:
        return []
    known = set((await db.execute(select(Interest.slug).where(Interest.slug.in_(wanted)))).scalars().all())
    return [s for s in wanted if s in known]


async def suggested_communities(db: AsyncSession, user: User, limit: int = 5) -> list[dict]:
    """The communities of my zone I am not in that fit my interests best: the more of my interests they are about, the
    higher; then the ones with more people. Interest communities count their related interests, people's communities
    the interests their creator chose."""
    from app.core.models import UserInterest
    mine = set((await db.execute(select(Interest.slug).join(UserInterest, UserInterest.interest_id == Interest.id).where(
        UserInterest.user_id == user.id))).scalars().all())
    if not mine:
        return []
    scored = []
    for c in await list_communities(db, user):
        if c["joined"] or c["request_pending"] or c["access_mode"] == "invite" or c.get("my_zone") is False:
            continue
        matches = [t for t in c.get("tags") or [] if t in mine]
        if matches:
            scored.append((len(matches), c["member_count"], {**c, "matches": matches}))
    scored.sort(key=lambda x: (-x[0], -x[1], x[2]["title"].lower()))
    return [c for _, _, c in scored[:limit]]
